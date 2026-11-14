// Searchable text of the state programs' contract documents, so "Ask a contract" and the contract brief
// can read them without fetching: one store per program, keyed by the document's URL, with the text
// split into its PDF pages. Contact details in the documents are kept, at the product owner's
// instruction. Spreadsheets become one page of rows; contract summary pages become one page.
//
//   npm run import:doctext -- --hawaii <dir> --arkansas <dir> --ny <dir> --njstart <dir> --epc <dir> --oregon <dir>
//
// Each folder is that program's unzipped collection (the same folders the program's importer reads); for
// Oregon, the cache npm run fetch:oregon writes (seed/catalog/source/oregon/cache).
// Writes seed/catalog/doctext/<program>.json.gz: { retrieved, documents: { [url]: { label, pages } } }.
// Server only (lib/docs.ts reads it lazily).

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "seed/catalog/doctext");
const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i].replace(/^--/, ""), resolve(process.argv[i + 1]));

function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = "";
  let q = false;
  const s = text.replace(/^﻿/, "");
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (q) {
      if (ch === '"' && s[i + 1] === '"') (cur += '"'), i++;
      else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") row.push(cur), (cur = "");
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && s[i + 1] === "\n") i++;
      row.push(cur), rows.push(row), (row = []), (cur = "");
    } else cur += ch;
  }
  if (cur || row.length) row.push(cur), rows.push(row);
  const [head, ...body] = rows.filter((r) => r.length > 1 || r[0]);
  return body.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ""])));
}

interface Page { num: number; text: string }
type Store = Record<string, { label: string; pages: Page[] }>;
/** PDF text split at form feeds into numbered pages; blank pages dropped, runs of spaces kept short. */
const pagesOf = (text: string): Page[] =>
  text
    .split("\f")
    .map((t, i) => ({ num: i + 1, text: t.replace(/[ \t]{3,}/g, "   ").replace(/\n{3,}/g, "\n\n").trim() }))
    .filter((p) => p.text.length > 20);
const sheetPages = (file: string): Page[] => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const XLSX = require("xlsx") as typeof import("xlsx");
  const wb = XLSX.readFile(file);
  return wb.SheetNames.map((n, i) => ({
    num: i + 1,
    text: `${n}\n${XLSX.utils
      .sheet_to_json<unknown[]>(wb.Sheets[n], { header: 1, blankrows: false })
      .map((r) => r.map((c) => (c == null ? "" : String(c).replace(/\s+/g, " ").trim())).filter(Boolean).join("  |  "))
      .filter(Boolean)
      .join("\n")}`,
  })).filter((p) => p.text.length > 20);
};
const stats: Record<string, { documents: number; pages: number; bytes: number }> = {};
function write(program: string, retrieved: string, store: Store) {
  mkdirSync(OUT, { recursive: true });
  const body = JSON.stringify({ retrieved, documents: store });
  writeFileSync(join(OUT, `${program}.json.gz`), gzipSync(body, { level: 9 }));
  stats[program] = { documents: Object.keys(store).length, pages: Object.values(store).reduce((n, d) => n + d.pages.length, 0), bytes: body.length };
}

// Hawaii: every price & vendor list, notice and pricing schedule.
if (args.has("hawaii")) {
  const dir = args.get("hawaii")!;
  const store: Store = {};
  for (const e of parseCsv(readFileSync(join(dir, "Hawaii_Contract_Directory.csv"), "utf8"))) {
    const f = join(dir, e.text_file);
    if (e.file_url && existsSync(f)) store[e.file_url] = { label: `${e.form_number}: ${e.subject}`, pages: pagesOf(readFileSync(f, "utf8")) };
  }
  write("hawaii", "2026-11-14", store);
}

// Arkansas: every directly linked document with a text layer, and each spreadsheet.
if (args.has("arkansas")) {
  const dir = args.get("arkansas")!;
  const store: Store = {};
  for (const d of JSON.parse(readFileSync(join(dir, "documents.json"), "utf8")) as Record<string, string>[]) {
    const t = d.text_file && join(dir, d.text_file);
    if (t && existsSync(t) && readFileSync(t, "utf8").replace(/\s/g, "").length > 200) store[d.url] = { label: d.link_name, pages: pagesOf(readFileSync(t, "utf8")) };
    else if (d.file_type === "XLSX" && existsSync(join(dir, d.local_file))) store[d.url] = { label: d.link_name, pages: sheetPages(join(dir, d.local_file)) };
  }
  write("arkansas", "2026-11-14", store);
}

// New York: the awards' documents (PDF text and spreadsheets), the preferred-source list and Corcraft's guide.
if (args.has("ny")) {
  const dir = args.get("ny")!;
  const store: Store = {};
  for (const d of parseCsv(readFileSync(join(dir, "NY_OGS_Downloaded_Documents.csv"), "utf8"))) {
    const t = d.text_file && join(dir, d.text_file);
    if (t && existsSync(t) && readFileSync(t, "utf8").replace(/\s/g, "").length > 200) store[d.url] = { label: `${d.award_number ? `Award ${d.award_number}: ` : ""}${d.link_name}`, pages: pagesOf(readFileSync(t, "utf8")) };
    else if (d.file_type === "XLSX" && existsSync(join(dir, d.local_file))) store[d.url] = { label: `${d.award_number ? `Award ${d.award_number}: ` : ""}${d.link_name}`, pages: sheetPages(join(dir, d.local_file)) };
  }
  const master = join(dir, "centralized/OGS_Master_All_Statewide_Term_Contracts.txt");
  if (existsSync(master)) store["https://ogs.ny.gov/complete-listing-all-statewide-contracts"] = { label: "OGS master list of all statewide term contracts, November 3, 2026", pages: pagesOf(readFileSync(master, "utf8")) };
  const ps = join(dir, "preferred_sources/OGS_Preferred_Source_Offerings_Current.txt");
  if (existsSync(ps)) store["https://ogs.ny.gov/procurement/list-preferred-source-offerings"] = { label: "OGS List of Preferred Source Offerings, September 2026", pages: pagesOf(readFileSync(ps, "utf8")) };
  write("ny", "2026-11-14", store);
}

// NJSTART: each contract's public summary page (header, terms, controls, items). Attachments are fetched live.
if (args.has("njstart")) {
  const dir = args.get("njstart")!;
  const store: Store = {};
  for (const r of JSON.parse(readFileSync(join(dir, "NJSTART_Contracts.json"), "utf8")) as { contract: Record<string, string>; details: { contract_url: string; detail_text: string } }[])
    store[r.details.contract_url] = { label: `NJSTART contract summary page, ${r.contract["Contract #"]}`, pages: [{ num: 1, text: r.details.detail_text.replace(/\s+(?=[A-Z][A-Za-z /#%._-]{2,40}:)/g, "\n").trim() }] };
  write("njstart", "2026-11-14", store);
}

// Empire Procure Connect: each portal record's summary page. Attachments are fetched live.
if (args.has("epc")) {
  const dir = args.get("epc")!;
  const store: Store = {};
  for (const r of JSON.parse(readFileSync(join(dir, "contracts.json"), "utf8")) as { source_record: Record<string, string>; contract_url: string; detail_text?: string; text_file?: string }[]) {
    const text = r.detail_text ?? (r.text_file && existsSync(join(dir, r.text_file)) ? readFileSync(join(dir, r.text_file), "utf8") : "");
    if (text) store[r.contract_url] = { label: `Empire Procure Connect contract summary page, ${r.source_record["Contract #"]}`, pages: [{ num: 1, text: text.replace(/\s+(?=[A-Z][A-Za-z /#%._-]{2,40}:)/g, "\n").trim() }] };
  }
  write("epc", "2026-11-14", store);
}

// OregonBuys: each DAS price agreement's public summary page (ORS chapter 190 agreements aside, as in
// scripts/import-oregon.ts). Attachments are fetched live.
if (args.has("oregon")) {
  const dir = args.get("oregon")!;
  const store: Store = {};
  const meta = JSON.parse(readFileSync(join(dir, "list.json"), "utf8")) as { retrieved: string };
  for (const r of parseCsv(readFileSync(join(dir, "list.csv"), "utf8"))) {
    const id = r["Blanket #"].trim();
    const f = join(dir, "pages", `${id.replace(/[^A-Za-z0-9._-]/g, "_")}.html`);
    if (!existsSync(f)) continue;
    const text = readFileSync(f, "utf8")
      .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&#39;/g, "'")
      .replace(/&quot;/g, '"')
      .replace(/\s+/g, " ")
      .trim();
    if (/Discipline Type:\s*ORS ?190/i.test(text)) continue;
    const url = `https://oregonbuys.gov/bso/external/purchaseorder/poSummary.sda?docId=${encodeURIComponent(id)}&releaseNbr=0&external=true&parentUrl=close`;
    const from = text.indexOf("Header Information");
    store[url] = { label: `OregonBuys price agreement summary page, ${id}`, pages: [{ num: 1, text: (from >= 0 ? text.slice(from) : text).replace(/Copyright ©.*$/, "").replace(/\s+(?=[A-Z][A-Za-z /#%._&-]{2,40}:)/g, "\n").trim() }] };
  }
  write("oregon", meta.retrieved, store);
}

// Keep the counts of programs not rebuilt this run.
const SUMMARY = join(OUT, "summary.json");
if (existsSync(SUMMARY)) for (const [k, v] of Object.entries(JSON.parse(readFileSync(SUMMARY, "utf8")) as typeof stats)) stats[k] ??= v;
writeFileSync(SUMMARY, JSON.stringify(stats, null, 1) + "\n");
console.log(stats);
