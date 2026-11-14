// Hawaii: the State Procurement Office's Price & Vendor List contracts, a TRX state (lib/trx.ts).
// Unlike NJSTART, Hawaii publishes no table of supplier contracts: each contract family is a PDF
// "price & vendor list" naming its participating jurisdictions, contractors, term and, for the
// state's own awards, item prices by island. So the import runs in three steps.
//
//   npm run import:hawaii -- --read <folder>      a fresh SPO download (the unzipped collection with
//                                                 Hawaii_Contract_Directory.csv and text/): copy the
//                                                 directory into the committed source and write review
//                                                 shards, one or more contract families each, to
//                                                 seed/cleanup/shards/hawaii-NN.json
//   (review agents read each family's text and write seed/cleanup/out/hawaii-NN.json)
//   npm run import:hawaii -- --collect <folder>   check every answer against the family's text and keep
//                                                 only what is found there: seed/catalog/source/hawaii/
//                                                 extracted.json (committed)
//   npm run import:hawaii                         build records.json.gz in the co-op catalog's raw shapes
//                                                 from the committed directory and extraction; then
//                                                 `npm run import:catalog-coops`
//
// The documents' text isn't committed: it holds procurement officers' names, phone numbers and
// emails. The checks below reject any extracted field that carries an email or phone number.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "seed/catalog/source/hawaii");
const SHARDS = join(ROOT, "seed/cleanup/shards");
const ANSWERS = join(ROOT, "seed/cleanup/out");
const COOP = "Hawaii SPO";
const SPO_LIST_URL = "https://spo.hawaii.gov/for-vendors/contract-awards/price-vendor-lists/";

// ------------------------------------------------------------------ CSV

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

/** The directory's fields Agora keeps: no hashes or local paths. */
interface Entry {
  entry_id: string;
  form_number: string;
  family: string;
  type: string;
  dated: string;
  subject: string;
  island: string;
  source: string;
  url: string;
  pages: number;
  text_file: string;
}
const readDirectory = (csvText: string): Entry[] =>
  parseCsv(csvText).map((x) => ({
    entry_id: x.entry_id,
    form_number: x.form_number,
    family: x.contract_family,
    type: x.document_type,
    dated: x.dated,
    subject: x.subject,
    island: x.island,
    source: x.cooperative_source,
    url: x.file_url,
    pages: Number(x.page_count) || 0,
    text_file: x.text_file,
  }));

const mode = process.argv[2];
const dir = process.argv[3] ? resolve(process.argv[3]) : "";

// ------------------------------------------------------------------ 1. read a download and shard it

if (mode === "--read") {
  if (!existsSync(join(dir, "Hawaii_Contract_Directory.csv"))) throw new Error(`Hawaii_Contract_Directory.csv isn't in ${dir}`);
  mkdirSync(OUT, { recursive: true });
  const entries = readDirectory(readFileSync(join(dir, "Hawaii_Contract_Directory.csv"), "utf8"));
  const retrieved = parseCsv(readFileSync(join(dir, "Hawaii_Contract_Directory.csv"), "utf8"))[0]?.retrieved_date ?? "";
  writeFileSync(join(OUT, "directory.json"), JSON.stringify({ source: SPO_LIST_URL, retrieved, entries }, null, 1) + "\n");
  // Links the PDFs carry (participating addenda, supplier pages, national contracts): URLs only.
  const refs = parseCsv(readFileSync(join(dir, "Hawaii_Document_References.csv"), "utf8")).map((r) => ({ entry_id: r.entry_id, form: r.form_number, page: Number(r.page), url: r.url }));
  writeFileSync(join(OUT, "links.json"), JSON.stringify(refs, null, 1) + "\n");

  // Shards: whole families, balanced by text size.
  const families = new Map<string, Entry[]>();
  for (const e of entries) (families.get(e.family) ?? families.set(e.family, []).get(e.family)!).push(e);
  const sized = [...families].map(([family, es]) => ({ family, entries: es, bytes: es.reduce((s, e) => s + (existsSync(join(dir, e.text_file)) ? readFileSync(join(dir, e.text_file)).length : 0), 0) }));
  sized.sort((a, b) => b.bytes - a.bytes);
  const N = 10;
  const bins = Array.from({ length: N }, () => ({ bytes: 0, families: [] as typeof sized }));
  for (const f of sized) {
    const bin = bins.reduce((m, b) => (b.bytes < m.bytes ? b : m));
    bin.families.push(f);
    bin.bytes += f.bytes;
  }
  mkdirSync(SHARDS, { recursive: true });
  bins.forEach((b, i) =>
    writeFileSync(
      join(SHARDS, `hawaii-${String(i + 1).padStart(2, "0")}.json`),
      JSON.stringify(
        b.families.map((f) => ({
          family: f.family,
          documents: f.entries.map((e) => ({ entry_id: e.entry_id, form: e.form_number, type: e.type, dated: e.dated, subject: e.subject, island: e.island, source: e.source, text: join(dir, e.text_file) })),
        })),
        null,
        1,
      ),
    ),
  );
  console.log(`Read ${entries.length} entries in ${families.size} families; ${N} shards: ${bins.map((b) => `${b.families.length} families/${Math.round(b.bytes / 1000)} KB`).join(", ")}.`);
  process.exit(0);
}

// ------------------------------------------------------------------ 2. check the answers

/** What a review agent returns for one contract family. Every string is copied from the text. */
interface Answer {
  family: string;
  contract_number: string | null;
  title: string | null;
  kind: "spo_award" | "cooperative_addendum" | "notice_only" | "form" | "other";
  master: string | null;
  solicitation: string | null;
  expires: string | null;
  expires_iso: string | null;
  jurisdictions: string[];
  contractors: { name: string; contract_no: string | null; islands: string[] }[];
  prices: { item: string; contractor: string; product: string | null; price: number; unit: string | null; island: string | null; line: string }[];
  changes: string[];
}

const norm = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();
const PERSONAL = /@|\(\d{3}\)\s*\d{3}-\d{4}|\b\d{3}-\d{3}-\d{4}\b/;
/** Every number in a line, as written: "$ 1,084.82" → 1084.82. */
const numbersIn = (line: string) => new Set((line.match(/\d[\d,]*(\.\d+)?/g) ?? []).map((n) => Number(n.replace(/,/g, ""))));

if (mode === "--collect") {
  const shards = readdirSync(SHARDS).filter((f) => /^hawaii-\d+\.json$/.test(f));
  const kept: Answer[] = [];
  const stats = { families: 0, answered: 0, contractors: 0, contractors_dropped: 0, jurisdictions: 0, jurisdictions_dropped: 0, prices: 0, prices_dropped: 0, expires_dropped: 0 };
  for (const f of shards) {
    const fams = JSON.parse(readFileSync(join(SHARDS, f), "utf8")) as { family: string; documents: { text: string }[] }[];
    const outFile = join(ANSWERS, f);
    const answers = existsSync(outFile) ? (JSON.parse(readFileSync(outFile, "utf8")) as Record<string, Answer>) : {};
    for (const fam of fams) {
      stats.families++;
      const a = answers[fam.family];
      if (!a) continue;
      stats.answered++;
      const text = norm(fam.documents.map((d) => (existsSync(d.text) ? readFileSync(d.text, "utf8") : "")).join("\n"));
      const found = (s: string | null | undefined) => Boolean(s && !PERSONAL.test(s) && text.includes(norm(s)));
      const contractors = (a.contractors ?? []).filter((c) => {
        const ok = found(c.name);
        ok ? stats.contractors++ : stats.contractors_dropped++;
        return ok;
      });
      const jurisdictions = (a.jurisdictions ?? []).filter((j) => {
        const ok = found(j);
        ok ? stats.jurisdictions++ : stats.jurisdictions_dropped++;
        return ok;
      });
      // A price stays only when its line is in the text and the line prints that number.
      const prices = (a.prices ?? []).filter((p) => {
        // The line must print words as well as the number: a bare "6,864.00" says nothing about what it prices.
        const ok = typeof p.price === "number" && p.price > 0 && /[A-Za-z]{3,}/.test(p.line) && found(p.line) && numbersIn(p.line).has(p.price) && found(p.contractor.split(/\s+/).slice(0, 2).join(" "));
        ok ? stats.prices++ : stats.prices_dropped++;
        return ok;
      });
      const expiresOk = !a.expires || found(a.expires);
      if (!expiresOk) stats.expires_dropped++;
      kept.push({
        ...a,
        family: fam.family,
        contract_number: found(a.contract_number) ? a.contract_number : null,
        title: a.title && !PERSONAL.test(a.title) ? a.title : null,
        master: found(a.master) ? a.master : null,
        solicitation: found(a.solicitation) ? a.solicitation : null,
        expires: expiresOk ? a.expires : null,
        expires_iso: expiresOk && /^\d{4}-\d{2}-\d{2}$/.test(a.expires_iso ?? "") ? a.expires_iso : null,
        jurisdictions,
        contractors: contractors.map((c) => ({ name: c.name, contract_no: found(c.contract_no) ? c.contract_no : null, islands: (c.islands ?? []).filter((x) => /^(statewide|oahu|hawaii|maui|kauai|molokai|lanai)$/i.test(x)) })),
        prices,
        changes: (a.changes ?? []).filter((c) => !PERSONAL.test(c)).map((c) => c.slice(0, 240)),
      });
    }
  }
  kept.sort((a, b) => a.family.localeCompare(b.family));
  writeFileSync(join(OUT, "extracted.json"), JSON.stringify({ checked: stats, families: kept }, null, 1) + "\n");
  console.log(stats);
  process.exit(0);
}

// ------------------------------------------------------------------ 3. build the records

const directory = JSON.parse(readFileSync(join(OUT, "directory.json"), "utf8")) as { retrieved: string; entries: Entry[] };
const extracted = JSON.parse(readFileSync(join(OUT, "extracted.json"), "utf8")) as { checked: Record<string, number>; families: Answer[] };
const retrieved = directory.retrieved;
const hash = (s: string, n = 16) => createHash("sha1").update(s).digest("hex").slice(0, n);
const byFamily = new Map<string, Entry[]>();
for (const e of directory.entries) (byFamily.get(e.family) ?? byFamily.set(e.family, []).get(e.family)!).push(e);

/** Hawaii's four counties, by the names the lists use for their governments (councils and water boards count). */
const COUNTIES: [string, RegExp][] = [
  ["City and County of Honolulu", /honolulu|board of water supply/i],
  ["County of Hawaii", /county of hawai.?i|hawai.?i county/i],
  ["County of Maui", /maui/i],
  ["County of Kauai", /kaua.?i/i],
];

interface RawSupplier { supplier_id: string; name: string; name_variants: string[]; cooperatives: string[] }
const suppliers = new Map<string, RawSupplier>();
const supplierFor = (name: string) => {
  const clean = name.replace(/\s+/g, " ").trim();
  const id = `sup_hi_${hash(clean.toLowerCase())}`;
  if (!suppliers.has(id)) suppliers.set(id, { supplier_id: id, name: clean, name_variants: [clean], cooperatives: [COOP] });
  return id;
};

const contracts: Record<string, unknown>[] = [];
const products = new Map<string, Record<string, unknown>>();
const offerings: Record<string, unknown>[] = [];
const documents: Record<string, unknown>[] = [];
const stats = { families: 0, contracts: 0, open_to_counties: 0, state_only: 0, unknown_jurisdictions: 0, priced_lines: 0, with_prices: 0, documents: 0, by_source: {} as Record<string, number> };
const today = retrieved;

for (const a of extracted.families) {
  const entries = byFamily.get(a.family) ?? [];
  if (!entries.length || a.kind === "form" || !a.contractors.length) continue;
  stats.families++;
  const list = entries.find((e) => e.type === "Contract list") ?? entries[0];
  const counties = COUNTIES.filter(([, re]) => a.jurisdictions.some((j) => re.test(j))).map(([n]) => n);
  const locals = counties.length > 0;
  if (!a.jurisdictions.length) stats.unknown_jurisdictions++;
  const source = list.source || "Hawaii / other";
  stats.by_source[source] = (stats.by_source[source] ?? 0) + a.contractors.length;
  const title = (a.title ?? list.subject).replace(/\s+/g, " ").trim();
  const number = a.contract_number ?? `SPO ${a.family}`;
  const famDocs = entries.map((e) => ({ label: `${e.form_number}: ${e.type}${e.dated ? `, ${e.dated}` : ""}`, url: e.url }));
  for (const c of a.contractors) {
    const id = `con_hi_${hash(`${a.family}|${c.name.toLowerCase()}`, 12)}`;
    stats.contracts++;
    locals ? stats.open_to_counties++ : a.jurisdictions.length ? stats.state_only++ : null;
    contracts.push({
      contract_id: id,
      cooperative: COOP,
      contract_number: c.contract_no ? `${a.family} · ${c.contract_no}` : number.replace(/^SPO\b.*?Contract No\.?\s*/i, ""),
      supplier_id: supplierFor(c.name),
      supplier_name: c.name,
      title,
      start_date: null,
      end_date: a.expires_iso,
      category_labels: [list.subject, ...(source !== "Hawaii / other" ? [`${source} participating addendum`] : [])],
      regions_as_published: ["Hawaii"],
      contract_url: list.url,
      // The SPO awards most lists; the E26 food-service lists, for one, are the Department of Education's.
      lead_agency: a.kind === "spo_award" ? "State of Hawaii, State Procurement Office" : a.kind === "cooperative_addendum" ? `State of Hawaii participating addendum to ${source}` : "State of Hawaii",
      source_metadata: {
        state_contract: {
          state: "HI",
          locals,
          solicitation: a.solicitation ?? (a.master ? `${source} ${a.master}` : null),
          type_code: source,
          group: a.kind === "cooperative_addendum" ? `${source} participating addendum` : "SPO price & vendor list",
        },
        counties,
        jurisdictions: a.jurisdictions,
        islands: c.islands,
        master: a.master,
        changes: a.changes,
        family: a.family,
        line_items_paginated: false,
      },
    });
    for (const d of famDocs) {
      documents.push({ document_id: `doc_hi_${hash(`${id}|${d.url}`)}`, cooperative: COOP, url: d.url, label: d.label, contract_id: id });
      stats.documents++;
    }
    // This contractor's prices, read from the family's price list.
    const mine = a.prices.filter((p) => norm(p.contractor).startsWith(norm(c.name).slice(0, 12)) || norm(c.name).startsWith(norm(p.contractor).slice(0, 12)));
    if (mine.length) stats.with_prices++;
    for (const p of mine) {
      const name = `${p.item}${p.island && !/statewide/i.test(p.island) ? ` (${p.island})` : ""}`.replace(/\s+/g, " ").trim().slice(0, 180);
      const pid = `prd_hi_${hash(`${p.item}|${p.product ?? ""}`.toLowerCase())}`;
      if (!products.has(pid)) products.set(pid, { product_id: pid, product_name: p.product ? `${p.item}: ${p.product}`.slice(0, 180) : p.item.slice(0, 180), manufacturer: null, manufacturer_sku: null, record_type: "awarded_line_item", title_conflict_requires_review: false });
      offerings.push({
        offering_id: `off_hi_${hash(`${id}|${p.line}|${p.island ?? ""}|${p.item}|${p.price}`)}`,
        product_id: pid,
        supplier_id: supplierFor(c.name),
        contract_id: id,
        cooperative: COOP,
        product_name: name,
        vendor_sku: null,
        source_url: list.url,
        fixed_price: p.price,
        discount_percent: null,
        pricing_status: "published_price",
        unit_of_measure: p.unit,
        source_metadata: {
          // A rate the list prints as a ceiling is the most an agency pays, and says so.
          document_vintage: `Hawaii SPO awarded ${/ceiling|not.to.exceed/i.test(`${p.item} ${p.line} ${title}`) ? "ceiling rate" : "price"}${p.island ? `, ${p.island}` : ""}, price list ${a.family}${a.expires ? ` (expires ${a.expires})` : ""}; read ${today}`,
          category_as_published: `${title}: awarded price, SPO price list ${a.family}`,
          basis: "awarded_bid",
          line: p.line,
          island: p.island,
        },
      });
      stats.priced_lines++;
    }
  }
}

const records = { retrieved, suppliers: [...suppliers.values()], contracts, products: [...products.values()], offerings, documents };
writeFileSync(join(OUT, "records.json.gz"), gzipSync(JSON.stringify(records), { level: 9 }));
const summary = { source: SPO_LIST_URL, retrieved, directory_entries: directory.entries.length, checked: extracted.checked, ...stats, suppliers: suppliers.size, products: products.size };
writeFileSync(join(OUT, "summary.json"), JSON.stringify(summary, null, 1) + "\n");
console.log(JSON.stringify(summary, null, 1));
