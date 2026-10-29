// Contract parser: turns uploaded contract files into a header plus priced line
// items a human can review. LLM structuring when a key is set, a regex-and-table
// heuristic otherwise. Never invents a price: unreadable prices go to Unresolved.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import * as z from "zod/v4";
import { structured } from "./llm";
import { tokens } from "./assistant";
import { CATEGORIES } from "./types";
import type { Category, ContractHeader, ContractSource, Db, ExtractedItem, Supplier, TierPrice } from "./types";

export const UPLOAD_DIR = join(process.cwd(), "uploads");
const MAX_PAGES = 60;

// ---------------------------------------------------------------- extraction

export interface InputFile {
  filename: string;
  buffer: Buffer;
}

export interface ExtractedFile {
  filename: string;
  hash: string;
  mime: string;
  kind: "pdf" | "docx" | "sheet";
  pages: { num: number; text: string }[];
  rows?: unknown[][];
  page_count: number;
}

export class ParseError extends Error {}

const MIME: Record<string, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  csv: "text/csv",
};

export async function extractFile(file: InputFile): Promise<ExtractedFile> {
  const ext = file.filename.toLowerCase().split(".").pop() ?? "";
  const hash = createHash("sha256").update(file.buffer).digest("hex").slice(0, 16);
  mkdirSync(UPLOAD_DIR, { recursive: true });
  const stored = join(UPLOAD_DIR, `${hash}.${ext}`);
  if (!existsSync(stored)) writeFileSync(stored, file.buffer);
  const base = { filename: file.filename, hash, mime: MIME[ext] ?? "application/octet-stream" };

  if (ext === "pdf") {
    const { PDFParse } = await import("pdf-parse");
    const parser = new PDFParse({ data: new Uint8Array(file.buffer) });
    try {
      const res = await parser.getText();
      if (res.total > MAX_PAGES)
        throw new ParseError(`${file.filename} has ${res.total} pages. The prototype handles contracts up to ${MAX_PAGES} pages.`);
      const chars = res.pages.reduce((n, p) => n + p.text.replace(/\s|Page \d+/g, "").length, 0);
      if (chars < 40 * res.total)
        throw new ParseError(`${file.filename} looks like a scanned document. OCR is not in the prototype; upload a text PDF, DOCX or spreadsheet.`);
      return { ...base, kind: "pdf", pages: res.pages.map((p) => ({ num: p.num, text: p.text })), page_count: res.total };
    } finally {
      await parser.destroy();
    }
  }
  if (ext === "docx") {
    const mammoth = await import("mammoth");
    const { value } = await mammoth.extractRawText({ buffer: file.buffer });
    return { ...base, kind: "docx", pages: [{ num: 1, text: value }], page_count: 1 };
  }
  if (ext === "xlsx" || ext === "xls" || ext === "csv") {
    const XLSX = await import("xlsx");
    const wb = XLSX.read(file.buffer, { type: "buffer" });
    const rows: unknown[][] = [];
    const pages = wb.SheetNames.map((name, i) => {
      const sheetRows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[name], { header: 1, blankrows: false, defval: "" });
      rows.push(...sheetRows);
      return { num: i + 1, text: sheetRows.map((r, j) => `Row ${j + 1}: ${r.join(" | ")}`).join("\n") };
    });
    return { ...base, kind: "sheet", pages, rows, page_count: pages.length };
  }
  throw new ParseError(`${file.filename}: unsupported file type. Use PDF, DOCX, XLSX or CSV.`);
}

// ---------------------------------------------------------------- shared helpers

type DraftItem = Omit<ExtractedItem, "id" | "document_id" | "row_index" | "status" | "listing_id"> & {
  status: "pending" | "unresolved";
};

const MONEY = /\$?\s?(\d{1,3}(?:,\d{3})+|\d+)\.(\d{2})\b/g;
const money = (s: string) => parseFloat(s.replace(/[$,\s]/g, ""));
function amounts(text: string): number[] {
  return [...text.matchAll(MONEY)].map((m) => money(`${m[1]}.${m[2]}`));
}

const UNRESOLVED = /\b(tbd|quote|quoted|per site survey|per attached|schedule [a-z]\b|call for|contact)\b/i;

const CATEGORY_WORDS: [RegExp, Category][] = [
  [/desk|chair|table|seating|bookcase|lateral file|file cabinet|panel|return,|furniture|cart/i, "Furniture"],
  [/toilet|tissue|towel|soap|liner|mop|microfiber|cleaner|disinfect|urinal|odor|sanitizer|glove|janitorial|floor machine|scrubber|dispensing/i, "Janitorial"],
  [/keyboard|mouse|usb|flash drive|monitor|laptop|surge protector|shredder/i, "IT hardware"],
  [/paper|pen|pencil|marker|highlighter|stapl|clip|tape|scissors|folder|binder|divider|protector|sticky|pad|notebook|envelope|label|batter|organizer|calculator|clock|eraser|letterhead|calendar|toner|plates/i, "Office supplies"],
];

function categorize(text: string, fallback: Category): Category {
  // Services first, then the document's own category if it fits, then anything.
  if (/\b(disposal|installation|labor|repair)\b/i.test(text)) return "Professional services";
  const own = CATEGORY_WORDS.find(([, c]) => c === fallback);
  if (own && own[0].test(text)) return fallback;
  return CATEGORY_WORDS.find(([re]) => re.test(text))?.[1] ?? fallback;
}

function docCategory(text: string): Category {
  if (/furniture/i.test(text)) return "Furniture";
  if (/janitorial|sanitary|custodial/i.test(text)) return "Janitorial";
  if (/office supplies|office products/i.test(text)) return "Office supplies";
  return "Other";
}

function toIso(s: string | undefined): string {
  if (!s) return "";
  const d = new Date(s.replace(/(\d)(st|nd|rd|th)\b/, "$1"));
  return isNaN(d.getTime()) ? s.trim() : d.toISOString().slice(0, 10);
}

function inferSource(owner: string): ContractSource {
  if (/gsa|general services administration/i.test(owner)) return "gsa";
  if (/cooperative|co-op|consortium/i.test(owner)) return "coop_contract";
  if (/reseller/i.test(owner)) return "reseller";
  if (/^state\b|state of|department of administrative/i.test(owner)) return "state_contract";
  return "own_contract";
}

// ---------------------------------------------------------------- offline heuristic

function heuristicHeader(files: ExtractedFile[]): ContractHeader {
  const text = files.filter((f) => f.kind !== "sheet").map((f) => f.pages.map((p) => p.text).join("\n")).join("\n");
  const grab = (re: RegExp) => text.match(re)?.[1]?.trim() ?? "";
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);

  const owner = grab(/^Owner\s*:\s*(.+)$/im) || lines.find((l) => /^(CITY|COUNTY|STATE|TOWN)\s+OF/i.test(l)) || "";
  const term = text.match(/Term\s*:\s*(.+?)\s+(?:through|to|-)\s+([A-Za-z]+ \d{1,2}, \d{4})/i);
  const titleLine =
    lines.find((l) => /(AGREEMENT|CONTRACT)/.test(l) && l === l.toUpperCase() && l.length > 20 && !/^(CITY|STATE|COUNTY)\s+OF\s+\w+$/.test(l)) ?? "";
  const title = titleLine
    .replace(/^(STATEWIDE\s+)?(PRICE AGREEMENT|MASTER AGREEMENT|CONTRACT)\s*(FOR|:)?\s*/i, "")
    .toLowerCase()
    .replace(/^\w/, (c) => c.toUpperCase());

  // Piggyback clause: rebuild sentences from wrapped lines, then find the one
  // that lets other agencies buy.
  const blob = lines
    .map((l) => (HEADING.test(l) || LABEL_LINE.test(l) || l === l.toUpperCase() ? "\n" : l))
    .join(" ");
  const sentences = blob.split(/\s*\n\s*|(?<=\.)\s+(?=[A-Z])/);
  const clause =
    sentences.find((s) => /(other public agencies|any public agency|orcpp member|cooperative purchasing program|participating (entities|agencies))/i.test(s) && /(may|available)/i.test(s)) ?? "";

  return {
    supplier_name: grab(/^(?:Contractor|Supplier|Vendor)\s*:\s*([^,\n]+)/im).replace(/,?\s*Inc\.?$/, ""),
    contract_number: grab(/(?:Contract|Agreement|Price Agreement)\s*(?:No\.?|Number|#)\s*:?\s*([A-Z0-9][A-Z0-9-]+)/i),
    owner: owner.replace(/,\s*Oregon$/, ""),
    source: inferSource(owner),
    title: title || "Untitled contract",
    start: toIso(grab(/Effective Date\s*:\s*(.+)$/im) || term?.[1]),
    end: toIso(grab(/Expiration Date\s*:\s*(.+)$/im) || term?.[2]),
    piggyback_clause_present: Boolean(clause),
    piggyback_clause_text: clause.trim(),
    payment_terms: grab(/^Payment Terms\s*:\s*(.+)$/im),
    delivery_terms: grab(/^Delivery Terms\s*:\s*(.+)$/im),
  };
}

const SKU_ROW = /^([A-Z]{2,5}-[A-Z0-9]{2,8})\s+(.+)$/;
const UNIT_TOKEN = /\s+((?:\d+\s*(?:rl\/)?\/?[a-z]{2,3})|(?:\d+\s+rl\/cs)|EA|CS|BX|DZ|PK|RM|GAL|ea|cs|pk|bx)\s*$/;
const LABEL_LINE = /^(Payment|Delivery|Contract|Agreement|Price Agreement|Effective|Expiration|Term|Owner|Contractor|Supplier|For the)\b[^:]*:/i;
const HEADING = /^((Article\s+\d+\.)|(\d+\.\s+[A-Z][^.]{0,60}$)|Page \d+$)/;
const SKIP_PROSE = /insurance|liability|per occurrence|discount|orders over|annually|restocking|minimum order|cpi/i;

function heuristicItems(files: ExtractedFile[], fallbackCat: Category): DraftItem[] {
  const out: DraftItem[] = [];
  for (const f of files) {
    if (f.kind === "sheet") out.push(...sheetItems(f, fallbackCat));
    else out.push(...textItems(f, fallbackCat));
  }
  return out;
}

function textItems(f: ExtractedFile, fallbackCat: Category): DraftItem[] {
  const out: DraftItem[] = [];
  for (const page of f.pages) {
    const lines = page.text.split("\n").map((l) => l.trim()).filter(Boolean);
    const prose: string[][] = [[]];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const sku = line.match(SKU_ROW);
      if (sku) {
        prose.push([]);
        let rest = sku[2];
        let conf = 0.95;
        const flags: string[] = [];
        let excerpt = line;
        // A price wrapped onto its own line.
        if (!amounts(rest).length && !UNRESOLVED.test(rest) && /^\$?[\d,]+\.\d{2}$/.test(lines[i + 1] ?? "")) {
          rest = `${rest} ${lines[i + 1]}`;
          excerpt = `${line} / ${lines[i + 1]}`;
          conf = 0.72;
          flags.push("Price was on the following line; check it belongs to this row");
          i++;
        }
        const tier = rest.match(/(\d+)\s*[-–]\s*\d+\s*\$?([\d,]+\.\d{2})\s*\/\s*(\d+)\+\s*\$?([\d,]+\.\d{2})/);
        let tiers: TierPrice[] | null = null;
        let price: number | null = null;
        let body = rest;
        if (tier) {
          tiers = [
            { min_qty: parseInt(tier[1], 10), unit_price: money(tier[2]) },
            { min_qty: parseInt(tier[3], 10), unit_price: money(tier[4]) },
          ];
          price = tiers[0].unit_price;
          body = rest.slice(0, tier.index).trim();
          conf = Math.min(conf, 0.88);
          flags.push("Tiered pricing: listed at the lowest-quantity tier");
        } else {
          const m = rest.match(/\$?((?:\d{1,3}(?:,\d{3})+|\d+)\.\d{2})\s*$/);
          if (m) {
            price = money(m[1]);
            body = rest.slice(0, m.index).trim();
          }
        }
        const unitMatch = body.match(UNIT_TOKEN);
        const unit = unitMatch ? unitMatch[1].toLowerCase().replace(/\s+/g, " ") : "ea";
        if (unitMatch) body = body.slice(0, unitMatch.index).trim();
        else if (price !== null) conf = Math.min(conf, 0.86);

        if (price === null) {
          const cut = rest.search(/\s+(pricing per|per site|per attached|tbd|quote|call for|contact)\b/i);
          const reason = cut >= 0 ? rest.slice(cut).trim() : "No readable price";
          let desc = cut >= 0 ? rest.slice(0, cut) : rest;
          const u = desc.match(UNIT_TOKEN);
          if (u) desc = desc.slice(0, u.index);
          out.push(draft({ sku: sku[1], description: desc.trim(), unit, unit_price: null, tier_pricing: null, category: categorize(body, fallbackCat), confidence: 0.3, source_excerpt: excerpt, source_page: page.num, source_file: f.filename, status: "unresolved", flags: [`Unresolved: ${reason}`] }));
        } else {
          out.push(draft({ sku: sku[1], description: body, unit, unit_price: price, tier_pricing: tiers, category: categorize(body, fallbackCat), confidence: conf, source_excerpt: excerpt, source_page: page.num, source_file: f.filename, status: "pending", flags }));
        }
        continue;
      }
      if (LABEL_LINE.test(line) || HEADING.test(line) || /^-{5,}$/.test(line) || /^(ITEM|Item#)/.test(line)) {
        prose.push([]);
        continue;
      }
      prose[prose.length - 1].push(line);
    }

    for (const para of prose.filter((p) => p.length)) {
      const sentences = para.join(" ").split(/(?<=\.)\s+(?=[A-Z])/);
      for (const s of sentences) out.push(...proseItems(s, page.num, f.filename, fallbackCat));
    }
  }
  return out;
}

function subjectOf(s: string) {
  return s
    .split(/:\s*\$|\s+(?:shall be supplied at|shall be priced at|will be priced at|are priced from|is priced at|are offered at|is offered at|is|are|at)\s+\$/i)[0]
    .replace(/^(The Supplier|The Contractor|Supplier|Contractor)\s+shall\s+(furnish|supply|provide)\s+/i, "")
    .replace(/[,:]\s*$/, "")
    .trim();
}

function proseItems(s: string, page: number, file: string, fallbackCat: Category): DraftItem[] {
  if (SKIP_PROSE.test(s) && !UNRESOLVED.test(s)) return [];
  const amts = amounts(s);
  const excerpt = s.trim();
  if (/\bfrom\s+\$[\d,.]+\s+to\s+\$|\$[\d,.]+\s+to\s+\$[\d,.]+/i.test(s)) {
    const description = subjectOf(s.replace(/\s+(?:are|is)\s+(?:priced|offered)\s+(?:from\s+)?\$.*$/i, ""));
    return [draft({ sku: null, description, unit: "ea", unit_price: null, tier_pricing: null, category: categorize(description, fallbackCat), confidence: 0.4, source_excerpt: excerpt, source_page: page, source_file: file, status: "unresolved", flags: ["Unresolved: price is a range, not a contract price"] })];
  }
  if (!amts.length) {
    if (!UNRESOLVED.test(s)) return [];
    const description = s.split(/:\s|\s+will be quoted|\s+pricing per/i)[0].trim();
    if (description.length > 90 || description === s.trim()) {
      if (!/quote|per attached/i.test(s)) return [];
    }
    return [draft({ sku: null, description: description.slice(0, 90), unit: "ea", unit_price: null, tier_pricing: null, category: categorize(s, fallbackCat), confidence: 0.3, source_excerpt: excerpt, source_page: page, source_file: file, status: "unresolved", flags: [`Unresolved: ${/per attached|schedule/i.test(s) ? "pricing refers to a schedule that was not uploaded" : "contact for quote"}`] })];
  }
  // Prose may hold several "<thing> ... $X per <unit>" clauses in one sentence.
  return amts.length === 1
    ? (() => {
        const m = s.match(/\$\s?([\d,]+\.\d{2})\s*(?:per\s+([a-z ]+?(?:of \d+)?)|each)?[.,;]?\s*$/i) ?? s.match(/\$\s?([\d,]+\.\d{2})\s*(?:per\s+([a-z]+(?: of \d+)?)|each)?/i);
        const description = subjectOf(s);
        const unit = (m?.[2] ?? "ea").trim();
        return [draft({ sku: null, description, unit, unit_price: amts[0], tier_pricing: null, category: categorize(description, fallbackCat), confidence: 0.7, source_excerpt: excerpt, source_page: page, source_file: file, status: "pending", flags: ["Read from contract prose; confirm description and unit"] })];
      })()
    : [];
}

function sheetItems(f: ExtractedFile, fallbackCat: Category): DraftItem[] {
  const rows = f.rows ?? [];
  const headerIdx = rows.findIndex((r) => r.some((c) => /sku|item/i.test(String(c))) && r.some((c) => /price/i.test(String(c))));
  if (headerIdx < 0) return [];
  const header = rows[headerIdx].map((c) => String(c));
  const col = (re: RegExp, not?: RegExp) => header.findIndex((h) => re.test(h) && !(not && not.test(h)));
  const cSku = col(/sku|item\s*(no|#|number)/i);
  const cDesc = col(/desc|product|name/i);
  const cUnit = col(/uom|unit|pack/i, /price/i);
  const cPrice = col(/price/i, /volume|tier|\d+\+/i);
  const cVol = col(/volume|tier|\d+\+/i);
  const volQty = parseInt(header[cVol]?.match(/(\d+)\+/)?.[1] ?? "10", 10);

  const out: DraftItem[] = [];
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const r = rows[i];
    const description = String(r[cDesc] ?? "").trim();
    if (!description) continue;
    const sku = cSku >= 0 ? String(r[cSku]).trim() || null : null;
    const unit = cUnit >= 0 ? String(r[cUnit]).trim().toLowerCase() || "ea" : "ea";
    const raw = r[cPrice];
    const excerpt = `Row ${i + 1}: ${r.map((c) => String(c)).filter(Boolean).join(" | ")}`;
    const base = { sku, description, unit, category: categorize(description, fallbackCat), source_excerpt: excerpt, source_page: null, source_file: f.filename };
    const vol = cVol >= 0 && typeof r[cVol] === "number" ? (r[cVol] as number) : null;

    if (typeof raw === "number") {
      out.push(draft({ ...base, unit_price: raw, tier_pricing: vol ? [{ min_qty: 1, unit_price: raw }, { min_qty: volQty, unit_price: vol }] : null, confidence: 0.97, status: "pending", flags: [] }));
      continue;
    }
    const found = amounts(String(raw)).concat(String(raw).match(/^\s*\d+(\.\d+)?\s*$/) ? [parseFloat(String(raw))] : []);
    if (found.length === 1) {
      out.push(draft({ ...base, unit_price: found[0], tier_pricing: null, confidence: 0.82, status: "pending", flags: [`Price was stored as text: "${raw}"`] }));
    } else if (found.length > 1) {
      out.push(draft({ ...base, unit_price: found[0], tier_pricing: null, confidence: 0.55, status: "pending", flags: [`Two prices in one cell: "${raw}". Using the first; confirm which applies.`] }));
    } else {
      out.push(draft({ ...base, unit_price: null, tier_pricing: null, confidence: 0.3, status: "unresolved", flags: [`Unresolved: price cell says "${raw || "blank"}"`] }));
    }
  }
  return out;
}

function draft(d: DraftItem): DraftItem {
  return d;
}

// ---------------------------------------------------------------- LLM structuring

const ItemSchema = z.object({
  sku: z.string().nullable(),
  description: z.string(),
  unit: z.string().describe("Unit of measure, lowercase, e.g. ea, cs, bx, gal, 'case of 200'"),
  unit_price: z.number().nullable().describe("Exactly as printed. null if no single price is readable."),
  tier_pricing: z.array(z.object({ min_qty: z.number(), unit_price: z.number() })).nullable(),
  category: z.enum(CATEGORIES),
  confidence: z.number().describe("0 to 1: how sure you are this row's price and description are right"),
  source_excerpt: z.string().describe("The exact text the row was read from, copied verbatim"),
  source_page: z.number().nullable(),
  source_file: z.string(),
  issue: z.string().nullable().describe("Why a human should look at this row, or null"),
});

const LlmSchema = z.object({
  header: z.object({
    supplier_name: z.string(),
    contract_number: z.string(),
    owner: z.string().describe("The agency, state or cooperative that owns the contract"),
    owner_type: z.enum(["agency", "state", "coop", "gsa", "reseller"]),
    title: z.string().describe("Short title, e.g. 'Office supplies'"),
    start: z.string().describe("ISO date YYYY-MM-DD, or empty"),
    end: z.string().describe("ISO date YYYY-MM-DD, or empty"),
    piggyback_clause_text: z.string().describe("Verbatim clause letting other public agencies buy, or empty"),
    payment_terms: z.string(),
    delivery_terms: z.string(),
  }),
  items: z.array(ItemSchema).describe("Every item with a single readable price"),
  unresolved: z.array(ItemSchema).describe("Items found without a single readable price: ranges, 'contact for quote', 'per attached schedule', TBD"),
});

const SYSTEM = `You extract public-sector contracts into structured listings for a government purchasing storefront.
Rules:
- Never invent or estimate a price. If a price is a range, missing, "TBD", "quote", or refers to a schedule that is not in the text, put the item in unresolved with unit_price null.
- If a cell or line holds more than one price for the same item without a clear quantity break, use the first, set confidence below 0.6 and explain in issue.
- Keep duplicates as separate rows; a later step dedupes.
- source_excerpt must be copied verbatim from the input so a reviewer can find it.
- Categories: ${CATEGORIES.join(", ")}.`;

async function llmParse(files: ExtractedFile[]) {
  const doc = files
    .map((f) => `=== FILE: ${f.filename} (${f.kind}) ===\n` + f.pages.map((p) => `--- page ${p.num} ---\n${p.text}`).join("\n"))
    .join("\n\n");
  if (doc.length > 180_000) return null; // chunking beyond this is out of prototype scope
  return structured({ system: SYSTEM, user: doc, schema: LlmSchema, maxTokens: 32000, timeoutMs: 90_000, effort: "low" });
}

// ---------------------------------------------------------------- orchestration

export interface ParseOutput {
  header: ContractHeader;
  items: DraftItem[];
  mode: "llm" | "offline";
}

const cacheDir = () => join(UPLOAD_DIR, "parsed");

export async function parseContract(files: ExtractedFile[]): Promise<ParseOutput> {
  const key = files.map((f) => f.hash).sort().join("-") + (process.env.ANTHROPIC_API_KEY ? "-llm" : "-offline");
  const cached = join(cacheDir(), `${key}.json`);
  if (existsSync(cached)) return JSON.parse(readFileSync(cached, "utf8"));

  const allText = files.map((f) => f.pages.map((p) => p.text).join("\n")).join("\n");
  const fallbackCat = docCategory(allText);
  let out: ParseOutput | null = null;

  const llm = await llmParse(files);
  if (llm) {
    const h = llm.header;
    const map: Record<string, ContractSource> = { agency: "own_contract", state: "state_contract", coop: "coop_contract", gsa: "gsa", reseller: "reseller" };
    const toDraft = (it: z.infer<typeof ItemSchema>, unresolved: boolean): DraftItem => {
      // Trust check: a price the model returns must appear in the source text.
      const priceSeen = it.unit_price !== null && amountAppears(allText, it.unit_price);
      const bad = !unresolved && it.unit_price !== null && !priceSeen;
      return {
        sku: it.sku,
        description: it.description,
        unit: it.unit || "ea",
        unit_price: unresolved || bad ? null : it.unit_price,
        tier_pricing: it.tier_pricing,
        category: it.category,
        confidence: unresolved || bad ? 0.3 : Math.max(0, Math.min(1, it.confidence)),
        source_excerpt: it.source_excerpt,
        source_page: it.source_page,
        source_file: it.source_file,
        status: unresolved || it.unit_price === null || bad ? "unresolved" : "pending",
        flags: [
          ...(it.issue ? [unresolved ? `Unresolved: ${it.issue}` : it.issue] : []),
          ...(bad ? ["Unresolved: extracted price not found in the document text"] : []),
        ],
      };
    };
    out = {
      mode: "llm",
      header: {
        supplier_name: h.supplier_name,
        contract_number: h.contract_number,
        owner: h.owner,
        source: map[h.owner_type] ?? inferSource(h.owner),
        title: h.title,
        start: h.start,
        end: h.end,
        piggyback_clause_present: Boolean(h.piggyback_clause_text),
        piggyback_clause_text: h.piggyback_clause_text,
        payment_terms: h.payment_terms,
        delivery_terms: h.delivery_terms,
      },
      items: [...llm.items.map((i) => toDraft(i, false)), ...llm.unresolved.map((i) => toDraft(i, true))],
    };
  }

  out ??= { mode: "offline", header: heuristicHeader(files), items: heuristicItems(files, fallbackCat) };

  mkdirSync(cacheDir(), { recursive: true });
  writeFileSync(cached, JSON.stringify(out));
  return out;
}

function amountAppears(text: string, n: number) {
  const fixed = n.toFixed(2);
  const withCommas = Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return text.includes(fixed) || text.includes(withCommas) || text.includes(String(n));
}

// ---------------------------------------------------------------- dedupe

export function normalizeDescription(s: string) {
  return tokens(s).sort().join(" ");
}

export function findSupplier(db: Db, name: string): Supplier | undefined {
  const n = name.toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\b(inc|llc|co|corp)\b/g, "").trim();
  return db.suppliers.find((s) => {
    const sn = s.name.toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\b(inc|llc|co|corp)\b/g, "").trim();
    return sn && n && (sn === n || sn.includes(n) || n.includes(sn));
  });
}

export function dedupe(db: Db, items: ExtractedItem[], supplierName: string) {
  const supplier = findSupplier(db, supplierName);
  const storefront = db.listings.filter((l) => l.storefront_ids.includes("sf_riverbend"));
  const seen = new Map<string, number>();
  for (const it of items) {
    const norm = normalizeDescription(it.description);
    const key = `${it.sku ?? ""}|${norm}`;
    if (seen.has(key)) {
      it.duplicate_of_row = seen.get(key)!;
      it.confidence = Math.min(it.confidence, 0.5);
      it.flags.push(`Duplicate of row ${seen.get(key)! + 1} in this upload`);
    } else seen.set(key, it.row_index);

    const bySku = it.sku ? storefront.find((l) => l.sku === it.sku) : undefined;
    const byDesc = !bySku && supplier ? storefront.find((l) => l.supplier_id === supplier.id && normalizeDescription(l.title) === norm) : undefined;
    const match = bySku ?? byDesc;
    if (match && it.duplicate_of_row == null) {
      it.duplicate_of_listing_id = match.id;
      it.replace_existing = true;
      it.flags.push(`Already in the storefront as "${match.title}" at $${match.unit_price.toFixed(2)} (matched on ${bySku ? "SKU" : "description"})`);
    }
  }
}
