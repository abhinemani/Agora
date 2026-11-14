// New York: the Office of General Services' centralized contracts, a TRX state (lib/trx.ts).
// OGS's monthly master report lists every statewide supplier contract (1,411 rows), and each award's
// page says who may use it ("Use of Contracts: All State Agencies and Political Subdivisions").
// Both are regular enough to read by rule, as NJSTART is.
//
//   npm run import:ny -- --read <folder>   a fresh OGS download (the unzipped index collection):
//                                          copy the supplier contracts, award directory and each
//                                          award's use-of-contracts line into the committed source
//   npm run import:ny                      build records.json.gz; then npm run import:catalog-coops
//
// The award pages name OGS contract managers with phone numbers and emails; only the
// use-of-contracts wording is kept, cut before the first contact field and checked for none.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "seed/catalog/source/ny");
const COOP = "NYS OGS";
const SOURCE = "https://ogs.ny.gov/procurement/ogs-centralized-contracts-list";

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

const PERSONAL = /@|\(\d{3}\)\s*\d{3}-\d{4}|\b\d{3}-\d{3}-\d{4}\b|\[email/i;
const CONTACT_FIELDS = /(Contract Manager|Contact Manager|State Agencies Contact|Authorized User|Contractors? Contact|Non-Executive|Contract Issued|Contract Updated|Aggregate Buy|Contract Period|Group:|Award:)/;

if (process.argv[2] === "--read") {
  const dir = resolve(process.argv[3]);
  const contracts = parseCsv(readFileSync(join(dir, "centralized/NY_OGS_Centralized_Supplier_Contracts.csv"), "utf8"));
  const awards = parseCsv(readFileSync(join(dir, "centralized/NY_OGS_Award_Directory.csv"), "utf8"));
  const summary = JSON.parse(readFileSync(join(dir, "collection_summary.json"), "utf8"));
  // Each award's "Use of Contracts" wording, cut before the contact fields that follow it.
  const use: Record<string, string | null> = {};
  for (const a of awards) {
    const f = join(dir, a.text_file);
    const text = existsSync(f) ? readFileSync(f, "utf8") : "";
    const m = text.match(/Use of Contracts?:\s*(.{0,160})/i);
    let v = m ? m[1].split(CONTACT_FIELDS)[0].trim() : "";
    if (PERSONAL.test(v)) v = "";
    use[a.award_number] = v || null;
  }
  mkdirSync(OUT, { recursive: true });
  writeFileSync(
    join(OUT, "contracts.json"),
    JSON.stringify(
      {
        source: SOURCE,
        retrieved: summary.retrieved_date,
        master_report_date: summary.centralized_master_report_date,
        awards: awards.map((a) => ({ award: a.award_number, group: a.group_number, title: a.title, type: a.type, keywords: a.keywords, url: a.award_url, use: use[a.award_number] })),
        contracts: contracts.map((c) => ({
          award: c.award_number,
          group: c.group_number,
          number: c.contract_number,
          contractor: c.contractor_name.replace(/\s+/g, " ").trim(),
          description: c.description_master_list.replace(/\s+/g, " ").trim(),
          begin: c.begin_date_master_list,
          end: c.end_date_master_list,
          flags: c.certification_flags_as_published.trim(),
          page: Number(c.master_pdf_page),
        })),
      },
      null,
      1,
    ) + "\n",
  );
  console.log(`Read ${contracts.length} supplier contracts in ${awards.length} awards.`);
  process.exit(0);
}

// ------------------------------------------------------------------ build

interface Award { award: string; group: string; title: string; type: string; keywords: string; url: string; use: string | null }
interface Row { award: string; group: string; number: string; contractor: string; description: string; begin: string; end: string; flags: string; page: number }
const src = JSON.parse(readFileSync(join(OUT, "contracts.json"), "utf8")) as { retrieved: string; master_report_date: string; awards: Award[]; contracts: Row[] };
const hash = (s: string, n = 16) => createHash("sha1").update(s).digest("hex").slice(0, n);
const iso = (s: string) => {
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  return m ? `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}` : null;
};
const awardBy = new Map(src.awards.map((a) => [a.award, a]));
/** Political subdivisions may use it when the award says so ("Political Subdivisions", "Non-State Agencies"),
 * or says nothing either way; an award for state agencies, one agency or Albany-area agencies is state-only. */
const openToLocals = (use: string | null) => (use ? /political subdivision|non-state/i.test(use) || /^statewide/i.test(use) : true);
const FLAGS: Record<string, string> = { SB: "small business", MBE: "minority-owned", WBE: "women-owned", SDVOB: "service-disabled veteran-owned", NYS: "New York business" };

const suppliers = new Map<string, Record<string, unknown>>();
const supplierFor = (name: string) => {
  const id = `sup_ny_${hash(name.toLowerCase())}`;
  if (!suppliers.has(id)) suppliers.set(id, { supplier_id: id, name, name_variants: [name], cooperatives: [COOP] });
  return id;
};
const contracts: Record<string, unknown>[] = [];
const documents: Record<string, unknown>[] = [];
const stats = { awards: src.awards.length, contracts: 0, open_to_locals: 0, state_only: 0, use_unstated: 0, by_type: {} as Record<string, number>, certified: 0 };
for (const r of src.contracts) {
  const a = awardBy.get(r.award);
  const locals = openToLocals(a?.use ?? null);
  stats.contracts++;
  locals ? stats.open_to_locals++ : stats.state_only++;
  if (!a?.use) stats.use_unstated++;
  stats.by_type[a?.type ?? "Other"] = (stats.by_type[a?.type ?? "Other"] ?? 0) + 1;
  if (r.flags) stats.certified++;
  const id = `con_ny_${r.number.replace(/[^A-Za-z0-9]/g, "")}`;
  const flags = r.flags.split(/[\s,/]+/).filter(Boolean);
  contracts.push({
    contract_id: id,
    cooperative: COOP,
    contract_number: r.number,
    supplier_id: supplierFor(r.contractor),
    supplier_name: r.contractor,
    title: a?.title ?? r.description,
    start_date: iso(r.begin),
    end_date: iso(r.end),
    category_labels: [r.description, a?.keywords ?? "", a?.type ? `${a.type} contract` : "", ...flags.map((f) => FLAGS[f] ?? "").filter(Boolean)].filter(Boolean),
    regions_as_published: ["New York"],
    contract_url: a?.url ?? SOURCE,
    lead_agency: "New York State Office of General Services",
    source_metadata: {
      state_contract: { state: "NY", locals, solicitation: `Award ${r.award}`, type_code: flags.length ? flags.join(", ") : null, group: a?.type ?? null },
      use_of_contracts: a?.use ?? null,
      certifications: flags,
      master_page: r.page,
      line_items_paginated: false,
    },
  });
  documents.push({ document_id: `doc_ny_${hash(`${id}|master`)}`, cooperative: COOP, url: "https://ogs.ny.gov/complete-listing-all-statewide-contracts", label: `OGS master list of statewide contracts, ${src.master_report_date} (page ${r.page})`, contract_id: id });
}

writeFileSync(join(OUT, "records.json.gz"), gzipSync(JSON.stringify({ retrieved: src.retrieved, suppliers: [...suppliers.values()], contracts, products: [], offerings: [], documents }), { level: 9 }));
const summary = { source: SOURCE, retrieved: src.retrieved, master_report_date: src.master_report_date, ...stats, suppliers: suppliers.size, priced_lines: 0 };
writeFileSync(join(OUT, "summary.json"), JSON.stringify(summary, null, 1) + "\n");
console.log(JSON.stringify(summary, null, 1));
