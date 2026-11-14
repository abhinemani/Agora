// "Ask a contract": answers from a contract's own documents. Agora reads the
// price files it holds on disk and, when a person asks, the master agreements
// and price files a contract links to on a short list of document hosts. It
// finds the passages that bear on the question; with an API key the model
// answers from those passages, and every sentence it quotes must appear in
// them word for word or the answer is dropped and only the passages are shown.
// Server-only.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import * as z from "zod/v4";
import { catalogContract, catalogDocumentsFor, catalogSupplierById, type CatalogDocument } from "./catalog";
import { structured } from "./llm";
import { extractFile } from "./parser";
import { ungrounded } from "./shopper-ai";
import type { Db } from "./types";

/** Hosts that publish contract documents as plain files. Sites with bot walls or robots rules against fetching stay off this list. */
const DOCUMENT_HOSTS = new Set(["s3.us-east-1.amazonaws.com", "s3.us-west-2.amazonaws.com", "www.delltechnologies.com", "files.sourcewell.org", "spo.hawaii.gov"]);
const MAX_BYTES = 15 * 1024 * 1024;
const MAX_PAGES = 600;
const PRICE_FILES = join(process.cwd(), "seed/catalog/source/price-files");

interface Doc {
  id: string;
  label: string;
  /** A file Agora holds, or a document fetched from its publisher when asked. */
  path?: string;
  url?: string;
}
export interface ReadableContract {
  id: string;
  name: string;
  supplier: string;
  title: string;
  documents: { label: string; held: boolean }[];
}
interface Page {
  num: number;
  text: string;
}
export interface Passage {
  document: string;
  page: number;
  text: string;
}
export interface ContractAnswer {
  contract: string;
  read: { label: string; pages: number }[];
  /** Documents that couldn't be read, with the reason. */
  unread: string[];
  answer: { paragraphs: string[]; quotes: Passage[] } | null;
  passages: Passage[];
  note: string;
}

const isFile = (url: string) => /\.(pdf|xlsx|xls|docx|csv)(\?|$)/i.test(url);
const allowed = (url: string) => {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && DOCUMENT_HOSTS.has(u.host) && isFile(u.pathname);
  } catch {
    return false;
  }
};

/** A co-op catalog document Agora may fetch: GSA's contract terms (robots.txt bars only /advantage/rs/) and price files published as PDFs on a document host. */
export function readableCatalogDocument(d: Pick<CatalogDocument, "url" | "kind">): boolean {
  try {
    const u = new URL(d.url);
    if (u.protocol !== "https:") return false;
    if (u.host === "www.gsaadvantage.gov") return u.pathname.startsWith("/ref_text/") && /\.(htm|html|pdf)$/i.test(u.pathname);
    return (DOCUMENT_HOSTS.has(u.host) || u.host === "downloads.canon.com") && isFile(u.pathname);
  } catch {
    return false;
  }
}

interface Entry extends ReadableContract {
  docs: Doc[];
}

interface HeldFile {
  file: string;
  coop: string;
  number: string;
  supplier: string;
  vintage: string;
}
/** Price files in the repository, each tied to its contract by the rows read from it. */
function heldFiles(): HeldFile[] {
  const g = globalThis as unknown as { __agoraHeldFiles?: HeldFile[] };
  if (!g.__agoraHeldFiles) {
    const rowsPath = join(process.cwd(), "seed/catalog/price-rows.json");
    const seen = new Map<string, HeldFile>();
    const rows: HeldFile[] = existsSync(rowsPath) ? JSON.parse(readFileSync(rowsPath, "utf8")) : [];
    for (const r of rows) if (!seen.has(r.file) && existsSync(join(PRICE_FILES, r.file))) seen.set(r.file, { file: r.file, coop: r.coop, number: r.number, supplier: r.supplier, vintage: r.vintage });
    g.__agoraHeldFiles = [...seen.values()];
  }
  return g.__agoraHeldFiles;
}
const heldDoc = (f: HeldFile): Doc => ({ id: `file:${f.file}`, label: `Price file: ${f.vintage}`, path: join(PRICE_FILES, f.file) });

/** The documents Agora can read for one contract: by its id in Agora, in the co-op catalog, or as a held price file. */
function entryFor(db: Db, id: string): Entry | null {
  const listed = entries(db).find((e) => e.id === id);
  const cat = catalogContract(id) ?? catalogContract(db.contracts.find((c) => c.id === id)?.catalog_id);
  if (!cat) return listed ?? null;
  const docs: Doc[] = [...(listed?.docs ?? [])];
  for (const f of heldFiles()) if (f.coop === cat.coop && f.number === cat.number && !docs.some((d) => d.id === `file:${f.file}`)) docs.push(heldDoc(f));
  for (const d of catalogDocumentsFor(cat.id)) if (readableCatalogDocument(d) && !docs.some((x) => x.url === d.url)) docs.push({ id: d.id, label: cat.coop_id === "gsa_mas" ? "GSA contract terms and price list" : d.label, url: d.url });
  if (!docs.length) return null;
  return {
    id,
    name: listed?.name ?? `${cat.coop} ${cat.number}`,
    supplier: listed?.supplier ?? catalogSupplierById(cat.supplier)?.name ?? "",
    title: listed?.title ?? cat.title,
    documents: docs.slice(0, 3).map((d) => ({ label: d.label, held: Boolean(d.path) })),
    docs: docs.slice(0, 3),
  };
}

/** What Agora could read for a contract, without reading it. */
export function readableDocuments(db: Db, id: string): { label: string; held: boolean }[] {
  return entryFor(db, id)?.documents ?? [];
}

function entries(db: Db): Entry[] {
  const out: Entry[] = [];
  for (const f of heldFiles()) {
    const suppliers = f.coop === "BuyBoard" ? "Awarded dealers" : f.supplier;
    out.push({ id: `file:${f.file}`, name: `${f.coop} ${f.number}`, supplier: suppliers, title: f.vintage, documents: [{ label: `Price file: ${f.vintage}`, held: true }], docs: [heldDoc(f)] });
  }
  // Contracts whose master agreement or price file is published as a file on a document host.
  for (const c of db.contracts) {
    const docs = (c.documents ?? []).filter((d) => allowed(d.url)).slice(0, 3);
    if (!docs.length) continue;
    out.push({
      id: c.id,
      name: `${c.vehicle ?? c.owner} ${c.contract_number}`,
      supplier: db.suppliers.find((s) => s.id === c.supplier_id)?.name ?? "",
      title: c.title,
      documents: docs.map((d) => ({ label: d.label, held: false })),
      docs: docs.map((d, i) => ({ id: `${c.id}:${i}`, label: d.label, url: d.url })),
    });
  }
  return out;
}

export function readableContracts(db: Db): ReadableContract[] {
  return entries(db).map(({ docs: _docs, ...c }) => c);
}

const cache = ((globalThis as unknown as { __agoraDocText?: Map<string, Page[]> }).__agoraDocText ??= new Map<string, Page[]>());

async function pagesOf(doc: Doc): Promise<Page[]> {
  const have = cache.get(doc.id);
  if (have) return have;
  let buffer: Buffer;
  let filename: string;
  if (doc.path) {
    buffer = readFileSync(doc.path);
    filename = doc.path.split("/").pop()!;
  } else {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 25_000);
    try {
      const res = await fetch(doc.url!, { signal: controller.signal, headers: { "user-agent": "Agora contract reader" } });
      if (!res.ok) throw new Error(`its publisher answered ${res.status}`);
      if (Number(res.headers.get("content-length") ?? 0) > MAX_BYTES) throw new Error("it is over 15 MB");
      buffer = Buffer.from(await res.arrayBuffer());
      if (buffer.length > MAX_BYTES) throw new Error("it is over 15 MB");
      let from = new URL(doc.url!);
      // GSA's "online" page is a redirect stub to the contract's PDF in the same folder.
      const hop = buffer.length < 4000 ? buffer.toString("utf8").match(/http-equiv=["']?refresh["']?[^>]*url=([^"'>\s]+)/i) : null;
      if (hop) {
        const next = new URL(hop[1], from);
        if (next.host !== from.host || !next.pathname.startsWith("/ref_text/")) throw new Error("it points somewhere Agora doesn't read");
        const res2 = await fetch(next, { signal: controller.signal, headers: { "user-agent": "Agora contract reader" } });
        if (!res2.ok) throw new Error(`its publisher answered ${res2.status}`);
        if (Number(res2.headers.get("content-length") ?? 0) > MAX_BYTES) throw new Error("it is over 15 MB");
        buffer = Buffer.from(await res2.arrayBuffer());
        if (buffer.length > MAX_BYTES) throw new Error("it is over 15 MB");
        from = next;
      }
      filename = decodeURIComponent(from.pathname.split("/").pop() || "document.pdf");
    } catch (e) {
      const m = (e as Error).message;
      throw new Error((e as Error).name === "AbortError" ? "its publisher took too long" : !m || m === "fetch failed" ? "its publisher couldn't be reached" : m);
    } finally {
      clearTimeout(timer);
    }
  }
  let pages: Page[];
  if (/\.pdf$/i.test(filename)) {
    // Read directly: master agreements and price lists run past the upload reader's 60-page limit.
    const { PDFParse } = await import("pdf-parse");
    const parser = new PDFParse({ data: new Uint8Array(buffer) });
    try {
      const res = await parser.getText();
      pages = res.pages.slice(0, MAX_PAGES).map((p) => ({ num: p.num, text: p.text }));
    } finally {
      await parser.destroy();
    }
    if (pages.reduce((n, p) => n + p.text.replace(/\s/g, "").length, 0) < 40 * pages.length) throw new Error("it is a scanned document with no text layer");
  } else {
    const file = await extractFile({ filename, buffer });
    pages = file.rows?.length ? [{ num: 1, text: file.rows.map((r) => r.map((c) => String(c ?? "")).join("  ")).join("\n") }] : file.pages;
  }
  cache.set(doc.id, pages);
  return pages;
}

const STOP = new Set("the and for are does did this that with from have has any can will what when where which who how its not but you your our their there about into under contract agreement".split(" "));
const stem = (w: string) => w.replace(/(ations?|ing|ed|es|s)$/, "");
const words = (text: string) => (text.toLowerCase().match(/[a-z][a-z0-9]{2,}/g) ?? []).filter((w) => !STOP.has(w)).map(stem);

/** A page cut into passages of a few sentences, at line breaks. */
function chunks(document: string, pages: Page[]): Passage[] {
  const out: Passage[] = [];
  for (const p of pages) {
    let cur = "";
    for (const line of p.text.split(/\n+/)) {
      if (cur.length + line.length > 900 && cur) {
        out.push({ document, page: p.num, text: cur.trim() });
        cur = "";
      }
      cur += `${line}\n`;
    }
    if (cur.trim()) out.push({ document, page: p.num, text: cur.trim() });
  }
  return out;
}

function topPassages(all: Passage[], question: string, k: number, minHits = 1): Passage[] {
  const q = [...new Set(words(question))];
  if (!q.length) return [];
  const sets = all.map((c) => new Set(words(c.text)));
  const idf = new Map(q.map((w) => [w, Math.log(1 + all.length / (1 + sets.filter((s) => s.has(w)).length))]));
  return all
    .map((c, i) => ({ c, score: q.reduce((s, w) => s + (sets[i].has(w) ? idf.get(w)! : 0), 0), hits: q.filter((w) => sets[i].has(w)).length }))
    .filter((x) => x.score > 0 && x.hits >= minHits)
    .sort((a, b) => b.hits - a.hits || b.score - a.score)
    .slice(0, k)
    .map((x) => x.c);
}

const Schema = z.object({
  can_answer: z.boolean().describe("False when the passages don't answer the question."),
  paragraphs: z.array(z.string()).describe("One to three short paragraphs. When can_answer is false, say what the passages do and don't cover."),
  quotes: z.array(z.object({ passage: z.number().int().describe("The passage number the quote is copied from."), text: z.string().describe("A sentence or clause copied word for word from that passage.") })).describe("The exact words the answer rests on."),
});

const flat = (s: string) => s.toLowerCase().replace(/[\s ]+/g, " ").replace(/[“”]/g, '"').replace(/[‘’]/g, "'").trim();

/** Answer a question from one contract's documents. */
export async function askDocument(db: Db, contractId: string, question: string): Promise<ContractAnswer> {
  const entry = entryFor(db, contractId);
  if (!entry) throw new Error("Agora doesn't hold a readable document for that contract.");
  const read: ContractAnswer["read"] = [];
  const unread: string[] = [];
  const all: Passage[] = [];
  for (const d of entry.docs) {
    try {
      const pages = await pagesOf(d);
      read.push({ label: d.label, pages: pages.length });
      all.push(...chunks(d.label, pages));
    } catch (e) {
      unread.push(`${d.label} couldn't be read: ${(e as Error).message}.`);
    }
  }
  const base = { contract: entry.name, read, unread };
  if (!all.length) return { ...base, answer: null, passages: [], note: "None of this contract's documents could be read." };
  const passages = topPassages(all, question, 6);
  if (!passages.length) return { ...base, answer: null, passages: [], note: "Nothing in these documents uses the words in your question. Try the term the contract would use." };

  const out = await structured({
    system:
      `You answer a government employee's question about a contract, using only the numbered PASSAGES from its documents.\n` +
      `- If the passages don't answer it, set can_answer to false and say what they do cover. Don't use outside knowledge about the supplier, the co-op or typical contract terms.\n` +
      `- Back every claim with a quote copied word for word from a passage, with its passage number. Don't paraphrase inside quotes.\n` +
      `- Never state a price, percentage or date that isn't in the passages.\n` +
      `- This is a reading of the document, not legal advice; say so only if the person asks whether they are allowed to do something.\n` +
      `- Short sentences, plain words, no lists.`,
    user: `CONTRACT: ${entry.name}, ${entry.supplier}\n\nPASSAGES\n${passages.map((p, i) => `[${i + 1}] (${p.document}, page ${p.page})\n${p.text}`).join("\n\n")}\n\nQUESTION\n${question}`,
    schema: Schema,
    maxTokens: 1500,
    timeoutMs: 30_000,
  });
  const shown = passages.slice(0, 4);
  if (!out) return { ...base, answer: null, passages: shown, note: "The AI connection is off, so here are the passages that bear on your question." };

  // Keep a quote only if it is in the passage it names, word for word.
  const quotes: Passage[] = [];
  for (const q of out.quotes) {
    const p = passages[q.passage - 1];
    const text = q.text.trim().replace(/^["“]|["”]$/g, "");
    if (p && text.length >= 12 && flat(p.text).includes(flat(text))) quotes.push({ document: p.document, page: p.page, text });
  }
  const paragraphs = out.paragraphs.map((p) => p.trim()).filter(Boolean).slice(0, 3);
  const bad = ungrounded(paragraphs.join("\n"), [], { passages: passages.map((p) => p.text), question }, []);
  if (!paragraphs.length || bad || (out.can_answer && !quotes.length)) {
    console.warn("[docs] answer discarded:", bad ?? "no quote could be verified");
    return { ...base, answer: null, passages: shown, note: "I couldn't verify an answer against the document's own words, so here are the passages that bear on your question." };
  }
  return { ...base, answer: { paragraphs, quotes }, passages: shown, note: out.can_answer ? "" : "The documents Agora can read don't settle this. Purchasing, the co-op or the supplier would know." };
}

// ------------------------------------------------------------------ the contract brief

/** The same six questions asked of every contract, so two contracts can be read side by side. */
const BRIEF_FIELDS = [
  { id: "scope", label: "What it covers", query: "scope products services covered included offered description categories equipment supplies special item" },
  { id: "eligibility", label: "Who can use it", query: "eligible entities agencies state local government governments participating members cooperative purchasing authorized users political subdivisions" },
  { id: "pricing", label: "How prices are set", query: "price prices pricing discount discounts list schedule rates percent catalog volume quantity" },
  { id: "fees", label: "Fees", query: "administrative fee fees industrial funding membership participation cost charge" },
  { id: "term", label: "Term and renewals", query: "term period effective expiration expires renewal renew option extend extension years through" },
  { id: "ordering", label: "How to order", query: "order orders ordering purchase procedure submit quote delivery payment terms minimum warranty" },
] as const;

export interface BriefField {
  id: string;
  label: string;
  /** The model's one or two sentences, kept only when its quote is in the document word for word. */
  summary: string | null;
  quote: Passage | null;
  /** Without a verified summary: the passage that best bears on the field. */
  passage: Passage | null;
}
export interface ContractBrief {
  contract: string;
  read: { label: string; pages: number }[];
  unread: string[];
  fields: BriefField[];
  mode: "ai" | "passages";
  note: string;
}

const BriefSchema = z.object({
  fields: z.array(
    z.object({
      id: z.string().describe("The field id, exactly as given."),
      found: z.boolean().describe("False when the field's passages don't say."),
      summary: z.string().describe("One or two short sentences answering the field from its passages. Empty when found is false."),
      passage: z.number().int().describe("The passage number the quote is copied from."),
      quote: z.string().describe("A sentence or clause copied word for word from that passage."),
    }),
  ),
});

/** Officials' and sales reps' contact details stay out of what Agora shows: a line with an email address or phone number is dropped whole, since it usually carries a name too. */
const CONTACT = /[\w.+-]+@[\w-]+(\.[\w-]+)+|(\+?1[\s.-]?)?\(?\b\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}\b/;
const mask = (t: string) =>
  t
    .split("\n")
    .map((line) => (CONTACT.test(line) ? "[contact details removed]" : line))
    .join("\n");
const excerpt = (p: Passage): Passage => ({ ...p, text: mask(p.text.length > 600 ? `${p.text.slice(0, 600)}…` : p.text) });

const briefs = ((globalThis as unknown as { __agoraBriefs?: Map<string, ContractBrief> }).__agoraBriefs ??= new Map<string, ContractBrief>());

/** Read a contract's documents into the six brief fields. Each summary rests on a quote checked against the page. */
export async function contractBrief(db: Db, contractId: string): Promise<ContractBrief> {
  const entry = entryFor(db, contractId);
  if (!entry) throw new Error("Agora doesn't hold a readable document for that contract.");
  const key = `${contractId}|${process.env.ANTHROPIC_API_KEY ? "ai" : "off"}`;
  const have = briefs.get(key);
  if (have) return have;
  const read: ContractBrief["read"] = [];
  const unread: string[] = [];
  const all: Passage[] = [];
  for (const d of entry.docs) {
    try {
      const pages = await pagesOf(d);
      read.push({ label: d.label, pages: pages.length });
      all.push(...chunks(d.label, pages));
    } catch (e) {
      unread.push(`${d.label} couldn't be read: ${(e as Error).message}.`);
    }
  }
  const base = { contract: entry.name, read, unread };
  if (!all.length) return { ...base, fields: [], mode: "passages", note: "None of this contract's documents could be read." };

  // A passage has to share several of a field's words to count: a price file says nothing about eligibility.
  const per = BRIEF_FIELDS.map((f) => ({ f, passages: topPassages(all, f.query, 3, 3) }));
  const numbered: Passage[] = [];
  const numberOf = (p: Passage) => {
    const i = numbered.indexOf(p);
    return i >= 0 ? i + 1 : numbered.push(p);
  };
  const prompt = per.map(({ f, passages }) => `FIELD ${f.id}: ${f.label}\n${passages.map((p) => `[${numberOf(p)}] (${p.document}, page ${p.page})\n${p.text}`).join("\n\n") || "(no passage)"}`).join("\n\n----\n\n");

  const out = await structured({
    system:
      `You brief a government employee on a contract, using only the numbered PASSAGES from its documents, grouped by FIELD.\n` +
      `- For each field, say in one or two short sentences what its passages establish, and copy the one sentence or clause your answer rests on word for word, with its passage number.\n` +
      `- If a field's passages don't say, set found to false. Don't use outside knowledge about the supplier, the program or typical contract terms.\n` +
      `- Never state a price, percentage, fee or date that isn't in the passages, and never do arithmetic to make one.\n` +
      `- Leave out people's names, phone numbers, email addresses and street addresses.\n` +
      `- Plain words, no lists.`,
    user: `CONTRACT: ${entry.name}, ${entry.supplier}\n\n${prompt}`,
    schema: BriefSchema,
    maxTokens: 2500,
    timeoutMs: 45_000,
  });

  let verified = 0;
  const fields: BriefField[] = per.map(({ f, passages }) => {
    const fallback = passages[0] ? excerpt(passages[0]) : null;
    const a = out?.fields.find((x) => x.id === f.id);
    if (a?.found) {
      const p = numbered[a.passage - 1];
      const text = a.quote.trim().replace(/^["“]|["”]$/g, "");
      const summary = a.summary.trim();
      const ok = p && passages.includes(p) && text.length >= 12 && flat(p.text).includes(flat(text)) && summary && !ungrounded(summary, [], { passages: passages.map((x) => x.text) }, []);
      if (ok) {
        verified++;
        return { id: f.id, label: f.label, summary: mask(summary), quote: { document: p.document, page: p.page, text: mask(text) }, passage: null };
      }
    }
    return { id: f.id, label: f.label, summary: null, quote: null, passage: fallback };
  });
  const brief: ContractBrief = {
    ...base,
    fields,
    mode: verified ? "ai" : "passages",
    note: !out
      ? "The AI connection is off, so each field shows the passage that best bears on it instead of a summary."
      : verified < fields.length
        ? "Where a summary couldn't be checked against the document's own words, the closest passage is shown instead."
        : "",
  };
  briefs.set(key, brief);
  return brief;
}
