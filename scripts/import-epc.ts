// Empire Procure Connect (EPC): a TRX program that isn't a state. New York counties (Chemung, Rockland,
// Ulster) bid contracts on EPC's portal, with the Empire State Cooperative Procurement Alliance, and mark
// each one open to other governments ("Cooperative Purchasing Allowed: Yes") or kept for the county's own
// use ("No"). EPC also publishes a curated marketplace list with each contract's available regions.
//
//   npm run import:epc -- --read <folder>   a fresh EPC download (the unzipped collection): copy the
//                                           portal records, the marketplace list's fields and each
//                                           record's NIGP codes and attachment links into the committed
//                                           source (no purchaser names)
//   npm run import:epc                      build records.json.gz; then npm run import:catalog-coops
//
// No item prices: most portal records carry $0 placeholder items, and the few priced lines are one-off
// purchase amounts rather than contract prices.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "seed/catalog/source/epc");
const COOP = "Empire Procure Connect";
const SOURCE = "https://empireprocureconnect.info/empire-procure-connect-home";

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

interface Rec {
  number: string;
  description: string;
  title: string | null;
  vendor: string;
  county: string;
  begin: string;
  end: string;
  coop: boolean;
  on_list: boolean;
  regions: string | null;
  nigp: string[];
  url: string;
  attachments: { label: string; url: string }[];
}

if (process.argv[2] === "--read") {
  const dir = resolve(process.argv[3]);
  const portal = parseCsv(readFileSync(join(dir, "EPC_All_Public_Portal_Contracts.csv"), "utf8"));
  const list = parseCsv(readFileSync(join(dir, "EPC_Marketplace_Published_Contract_List.csv"), "utf8"));
  const full = JSON.parse(readFileSync(join(dir, "contracts.json"), "utf8")) as { source_record: Record<string, string>; item_information_text?: string; attachments?: { attachment_name: string; file_url: string }[] }[];
  const summary = JSON.parse(readFileSync(join(dir, "collection_summary.json"), "utf8"));
  const listBy = new Map(list.map((l) => [l.portal_contract_number, l]));
  const fullBy = new Map(full.map((c) => [c.source_record["Contract #"], c]));
  const recs: Rec[] = portal.map((p) => {
    const l = listBy.get(p["Contract #"]);
    const f = fullBy.get(p["Contract #"]);
    const nigp = [...new Set([...(f?.item_information_text ?? "").matchAll(/NIGP Code:\s*(\d{3})-?(\d{2})?/g)].map((m) => (m[2] ? `${m[1]}-${m[2]}` : m[1])))].sort();
    return {
      number: p["Contract #"],
      description: p.Description.replace(/\s+/g, " ").trim(),
      title: l?.extended_description?.trim() || null,
      vendor: p.Vendor.replace(/\s+/g, " ").trim(),
      county: p.Organization,
      begin: p["Begin Date"],
      end: p["End Date"],
      coop: p.cooperative_purchasing_allowed === "Yes",
      on_list: p.listed_in_november_marketplace_pdf === "Yes",
      regions: l?.available_regions_published?.trim() || null,
      nigp,
      url: p.contract_url,
      attachments: (f?.attachments ?? []).map((a) => ({ label: a.attachment_name.replace(/\s+/g, " ").trim(), url: a.file_url })),
    };
  });
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "contracts.json"), JSON.stringify({ source: SOURCE, list_url: summary.source_contract_list_url, list_period: summary.published_list_period, retrieved: summary.retrieved_date, contracts: recs }, null, 1) + "\n");
  console.log(`Read ${recs.length} portal records (${recs.filter((r) => r.coop).length} open to cooperative purchasing, ${recs.filter((r) => r.on_list).length} on the marketplace list).`);
  process.exit(0);
}

const src = JSON.parse(readFileSync(join(OUT, "contracts.json"), "utf8")) as { retrieved: string; list_url: string; list_period: string; contracts: Rec[] };
const hash = (s: string, n = 16) => createHash("sha1").update(s).digest("hex").slice(0, n);
const iso = (s: string) => {
  const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return m ? `${m[3]}-${m[1]}-${m[2]}` : null;
};
/** "RFB-2353-OFFICE SUPPLIES-STAPLES" → "Office Supplies": a leading solicitation number and a trailing
 * vendor name are on the record already. The trailing part goes only when it shares a word with the vendor. */
const words = (s: string) => new Set(s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((w) => w.length > 2 && !["inc", "llc", "corp", "the", "dba", "and", "company"].includes(w)));
const tidy = (s: string, vendor: string) => {
  // Leading solicitation numbers ("RFB-2353-", "RCP-RC-EPC-2025-004 ") and trailing county resolution references ("-RES-25-196").
  let t = s.replace(/^(?:[A-Z]{2,4}-)*(?:UC)?\d[\d-]*\s*-?\s*(?:PC\d+\s*)?/, "").replace(/\s*-?\s*(?:RES|RESO)?-?\d{2}-\d{2,4}\s*$/i, "");
  // A hyphenated vendor ("SUIT-KOTE") counts as one tail.
  const vendorUpper = vendor.toUpperCase().replace(/[,.]?\s*(INC|LLC|CORP|CORPORATION|CO)\.?$/, "").trim();
  if (vendorUpper && t.toUpperCase().endsWith(`-${vendorUpper.split(/\s+/)[0]}`)) t = t.slice(0, t.length - vendorUpper.split(/\s+/)[0].length - 1);
  const tail = t.match(/\s*-\s*([^-]+)$/);
  if (tail) {
    const v = words(vendor);
    if ([...words(tail[1])].some((w) => v.has(w))) t = t.slice(0, tail.index);
  }
  t = t.replace(/\s*-?\s*(?:RES|RESO)?-?\d{2}-\d{2,4}\s*$/i, "").replace(/[-\s]+$/, "").trim() || s;
  return /[a-z]/.test(t) ? t : t.toLowerCase().replace(/\b([a-z])/g, (c) => c.toUpperCase()).replace(/\b(And|Of|For|The|Or|In)\b/g, (m) => m.toLowerCase());
};
const suppliers = new Map<string, Record<string, unknown>>();
const contracts: Record<string, unknown>[] = [];
const documents: Record<string, unknown>[] = [];
const stats = { contracts: 0, open: 0, county_only: 0, on_list: 0, region_limited: 0, with_nigp: 0, by_county: {} as Record<string, number> };
for (const r of src.contracts) {
  if (r.end && iso(r.end) && iso(r.end)! < src.retrieved) continue;
  const sid = `sup_epc_${hash(r.vendor.toLowerCase())}`;
  if (!suppliers.has(sid)) suppliers.set(sid, { supplier_id: sid, name: r.vendor, name_variants: [r.vendor], cooperatives: [COOP] });
  const id = `con_epc_${r.number}`;
  stats.contracts++;
  r.coop ? stats.open++ : stats.county_only++;
  if (r.on_list) stats.on_list++;
  const limited = r.regions && !/^statewide/i.test(r.regions) ? r.regions : null;
  if (limited) stats.region_limited++;
  if (r.nigp.length) stats.with_nigp++;
  stats.by_county[r.county] = (stats.by_county[r.county] ?? 0) + 1;
  contracts.push({
    contract_id: id,
    cooperative: COOP,
    contract_number: r.number,
    supplier_id: sid,
    supplier_name: r.vendor,
    title: tidy(r.description, r.vendor),
    start_date: iso(r.begin),
    end_date: iso(r.end),
    category_labels: [r.description, ...(r.title ? [r.title] : [])],
    regions_as_published: ["New York"],
    contract_url: r.url,
    lead_agency: r.county,
    source_metadata: {
      state_contract: {
        state: "NY",
        locals: r.coop,
        solicitation: `${r.county}${r.on_list ? ", on EPC's marketplace list" : ""}`,
        type_code: r.on_list ? "EPC marketplace list" : null,
        group: r.coop ? "Open to cooperative purchasing" : "County's own contract",
      },
      // Who may use it: the lead county always; others when it's open to cooperative purchasing.
      owner: r.county,
      ...(r.coop && r.regions ? { use_of_contracts: r.regions } : {}),
      nigp: r.nigp,
      line_items_paginated: false,
    },
  });
  documents.push({ document_id: `doc_epc_${hash(`${id}|summary`)}`, cooperative: COOP, url: r.url, label: "Empire Procure Connect contract summary page", contract_id: id });
  for (const a of r.attachments) documents.push({ document_id: `doc_epc_${hash(`${id}|${a.url}`)}`, cooperative: COOP, url: a.url, label: a.label || "Contract document", contract_id: id });
}
writeFileSync(join(OUT, "records.json.gz"), gzipSync(JSON.stringify({ retrieved: src.retrieved, suppliers: [...suppliers.values()], contracts, products: [], offerings: [], documents }), { level: 9 }));
const summary = { source: SOURCE, list_url: src.list_url, list_period: src.list_period, retrieved: src.retrieved, ...stats, suppliers: suppliers.size, documents: documents.length, priced_lines: 0 };
writeFileSync(join(OUT, "summary.json"), JSON.stringify(summary, null, 1) + "\n");
console.log(JSON.stringify(summary, null, 1));
