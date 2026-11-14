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

interface Entry extends ReadableContract {
  docs: Doc[];
}

function entries(db: Db): Entry[] {
  const out: Entry[] = [];
  // Price files in the repository, each tied to its contract by the rows read from it.
  const rowsPath = join(process.cwd(), "seed/catalog/price-rows.json");
  const g = globalThis as unknown as { __agoraHeldFiles?: { file: string; coop: string; number: string; supplier: string; vintage: string }[] };
  if (!g.__agoraHeldFiles) {
    const seen = new Map<string, { file: string; coop: string; number: string; supplier: string; vintage: string }>();
    const rows: { file: string; coop: string; number: string; supplier: string; vintage: string }[] = existsSync(rowsPath) ? JSON.parse(readFileSync(rowsPath, "utf8")) : [];
    for (const r of rows) if (!seen.has(r.file) && existsSync(join(PRICE_FILES, r.file))) seen.set(r.file, { file: r.file, coop: r.coop, number: r.number, supplier: r.supplier, vintage: r.vintage });
    g.__agoraHeldFiles = [...seen.values()];
  }
  for (const f of g.__agoraHeldFiles) {
    const suppliers = f.coop === "BuyBoard" ? "Awarded dealers" : f.supplier;
    out.push({ id: `file:${f.file}`, name: `${f.coop} ${f.number}`, supplier: suppliers, title: f.vintage, documents: [{ label: `Price file: ${f.vintage}`, held: true }], docs: [{ id: `file:${f.file}`, label: `Price file: ${f.vintage}`, path: join(PRICE_FILES, f.file) }] });
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
      filename = decodeURIComponent(new URL(doc.url!).pathname.split("/").pop() || "document.pdf");
    } catch (e) {
      throw new Error((e as Error).name === "AbortError" ? "its publisher took too long" : (e as Error).message || "it couldn't be downloaded");
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

function topPassages(all: Passage[], question: string, k: number): Passage[] {
  const q = [...new Set(words(question))];
  if (!q.length) return [];
  const sets = all.map((c) => new Set(words(c.text)));
  const idf = new Map(q.map((w) => [w, Math.log(1 + all.length / (1 + sets.filter((s) => s.has(w)).length))]));
  return all
    .map((c, i) => ({ c, score: q.reduce((s, w) => s + (sets[i].has(w) ? idf.get(w)! : 0), 0), hits: q.filter((w) => sets[i].has(w)).length }))
    .filter((x) => x.score > 0)
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
  const entry = entries(db).find((e) => e.id === contractId);
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
