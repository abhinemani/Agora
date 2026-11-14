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
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
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
  // New York's preferred sources (State Finance Law § 162): Corcraft, NYSID and NIBNY, and the offerings
  // each is listed for, with the approval category the state gives each one. Providers' phone numbers and
  // emails are left out.
  const ps = join(dir, "preferred_sources");
  if (existsSync(join(ps, "offerings.json"))) {
    const offerings = JSON.parse(readFileSync(join(ps, "offerings.json"), "utf8")) as Record<string, string | number>[];
    const providers = JSON.parse(readFileSync(join(ps, "providers.json"), "utf8")) as Record<string, unknown>[];
    writeFileSync(
      join(OUT, "preferred.json"),
      JSON.stringify(
        {
          source: "https://ogs.ny.gov/procurement/list-preferred-source-offerings",
          revision: offerings[0]?.source_revision ?? null,
          providers: providers.map((x) => ({ name: x.provider_name, kind: x.provider_type, vendor_id: x.vendor_id, website: x.website_url, catalogs: x.catalog_urls ?? [] })),
          offerings: offerings.map((x) => ({
            id: x.offering_id,
            section: x.section,
            type: x.offering_type,
            approval: x.approval_status,
            category: x.category,
            subcategory: x.subcategory || null,
            name: x.offering_name_or_definition,
            providers: [x.corcraft_listed === "Yes" && "Corcraft", x.nibny_listed === "Yes" && "National Industries for the Blind New York (NIBNY)", x.nysid_listed === "Yes" && "New York State Industries for the Disabled (NYSID)"].filter(Boolean),
            page: x.source_pdf_page,
          })),
        },
        null,
        1,
      ) + "\n",
    );
  }
  console.log(`Read ${contracts.length} supplier contracts in ${awards.length} awards.`);
  process.exit(0);
}

// ------------------------------------------------------------------ prices

// --prices <folder>: award 23452's per-contractor price workbook is a clean table (SKU, description,
// manufacturer, list price, discount, net price), read by rule. The other price files vary by award, so
// they're exported to text (current period only) and sharded for review agents; --collect-prices keeps
// what is found on the row or line it came from. Contact tabs are never read.
const PRICE_TEXT = join(ROOT, "seed/cleanup/shards/ny-price-text");
if (process.argv[2] === "--prices") {
  const dir = resolve(process.argv[3]);
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const XLSX = require("xlsx") as typeof import("xlsx");
  const docs = parseCsv(readFileSync(join(dir, "NY_OGS_Downloaded_Documents.csv"), "utf8"));
  const priceDocs = docs.filter((d) => /pric|rate|cost|award summary|lots/i.test(d.link_name) && !/price guide/i.test(d.link_name));
  const cell = (v: unknown) => (v == null ? "" : String(v).replace(/\s+/g, " ").trim());
  const rows: Record<string, unknown>[] = [];
  mkdirSync(PRICE_TEXT, { recursive: true });
  const shardDocs: { doc: string; award: string; label: string; text: string; url: string }[] = [];
  for (const d of priceDocs) {
    const file = join(dir, d.local_file);
    if (d.file_type === "XLSX" && existsSync(file)) {
      const wb = XLSX.readFile(file);
      // 23452: one tab per contract ("PC71108 ..."), header row with "Net Price".
      const pcTabs = wb.SheetNames.filter((n) => /^PC\d{5}/.test(n));
      if (pcTabs.length) {
        for (const tab of pcTabs) {
          const number = tab.match(/^(PC\d{5})/)![1];
          const g = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[tab], { header: 1, blankrows: false });
          const h = g.findIndex((r) => r.some((c) => /net price/i.test(cell(c))));
          if (h < 0) continue;
          const col = (re: RegExp) => g[h].findIndex((c) => re.test(cell(c)));
          const [sku, cat, desc, maker, mpn, list, net] = [col(/sku|part number/i), col(/category/i), col(/description/i), col(/manufacturer name/i), col(/manufacturer part/i), col(/list price/i), col(/net price/i)];
          for (const r of g.slice(h + 1)) {
            const price = Number(r[net]);
            if (!cell(r[desc]) || !(price > 0)) continue;
            rows.push({ award: d.award_number, contract: number, item: cell(r[desc]).slice(0, 180), category: cell(r[cat]) || null, maker: cell(r[maker]) || null, sku: cell(r[mpn]) || cell(r[sku]) || null, price: Math.round(price * 100) / 100, list: Number(r[list]) > 0 ? Number(r[list]) : null, unit: null, region: null, basis: "net_price", line: `${tab} | ${cell(r[sku])} | ${cell(r[desc]).slice(0, 120)} | list ${cell(r[list])} | net ${cell(r[net])}`, file: d.local_file.replace(/^documents\//, "") });
          }
        }
        continue;
      }
      // Other workbooks: the current period only when tabs are periods (months, date ranges, dated price lists).
      const periodic = wb.SheetNames.filter((n) => /\b(19|20)\d\d\b|\d{1,2}\.\d{1,2}\.\d{4}|pricelist|current/i.test(n));
      const tabs = (periodic.length >= 2 ? [wb.SheetNames.find((n) => /current/i.test(n)) ?? periodic[0]] : wb.SheetNames).filter((n) => !/contact|contractor info|dnu/i.test(n));
      const lines: string[] = [];
      for (const tab of tabs) {
        lines.push(`=== sheet: ${tab}`);
        XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[tab], { header: 1, blankrows: false }).forEach((r, i) => {
          const t = r.map(cell).filter(Boolean).join(" | ");
          if (t && !/@|\(\d{3}\)\s*\d{3}-\d{4}|\b\d{3}-\d{3}-\d{4}\b/.test(t)) lines.push(`r${i + 1}: ${t}`);
        });
      }
      const out = join(PRICE_TEXT, `${d.local_file.replace(/^documents\//, "").replace(/\.xlsx$/i, "")}.txt`);
      writeFileSync(out, lines.join("\n"));
      shardDocs.push({ doc: d.local_file.replace(/^documents\//, ""), award: d.award_number, label: d.link_name, text: out, url: d.url });
    } else if (d.file_type === "PDF" && d.text_file && existsSync(join(dir, d.text_file))) {
      shardDocs.push({ doc: d.local_file.replace(/^documents\//, ""), award: d.award_number, label: d.link_name, text: join(dir, d.text_file), url: d.url });
    }
  }
  writeFileSync(join(OUT, "prices-rule.json"), JSON.stringify({ basis: "contract net price (list less the contract discount), as published in the award's price file", rows }, null, 1) + "\n");
  // Shards for review agents, balanced by text size, each document with its award's contracts.
  const src0 = JSON.parse(readFileSync(join(OUT, "contracts.json"), "utf8")) as { contracts: { award: string; number: string; contractor: string }[] };
  const sized = shardDocs.map((x) => ({ ...x, bytes: readFileSync(x.text).length, contracts: src0.contracts.filter((c) => c.award === x.award).map((c) => ({ number: c.number, contractor: c.contractor })) })).sort((a, b) => b.bytes - a.bytes);
  const N = 4;
  const bins = Array.from({ length: N }, () => ({ bytes: 0, docs: [] as typeof sized }));
  for (const x of sized) {
    const b = bins.reduce((m, y) => (y.bytes < m.bytes ? y : m));
    b.docs.push(x);
    b.bytes += x.bytes;
  }
  bins.forEach((b, i) => writeFileSync(join(ROOT, "seed/cleanup/shards", `ny-prices-${String(i + 1).padStart(2, "0")}.json`), JSON.stringify(b.docs.map(({ bytes: _b, ...x }) => x), null, 1)));
  console.log(`${rows.length} net prices read by rule; ${shardDocs.length} documents for review in ${N} shards: ${bins.map((b) => `${b.docs.length} docs/${Math.round(b.bytes / 1000)} KB`).join(", ")}.`);
  process.exit(0);
}

// --collect-prices: keep each reviewed price only when its line is in the document's text, prints the
// price and words, belongs to a contract on that award, and carries no personal detail.
if (process.argv[2] === "--collect-prices") {
  const SH = join(ROOT, "seed/cleanup/shards");
  const ANS = join(ROOT, "seed/cleanup/out");
  const norm = (x: string) => x.replace(/\s+/g, " ").trim().toLowerCase();
  const numbersIn = (line: string) => new Set((line.match(/\d[\d,]*(\.\d+)?/g) ?? []).map((n) => Number(n.replace(/,/g, ""))));
  const kept: Record<string, unknown>[] = [];
  const stats = { documents: 0, answered: 0, prices: 0, dropped: { not_found: 0, wrong_contract: 0, no_words: 0, personal: 0, zero: 0 } };
  for (const f of readdirSync(SH).filter((f) => /^ny-prices-\d+\.json$/.test(f))) {
    const docs = JSON.parse(readFileSync(join(SH, f), "utf8")) as { doc: string; award: string; text: string; url: string; contracts: { number: string }[] }[];
    const ans = existsSync(join(ANS, f)) ? (JSON.parse(readFileSync(join(ANS, f), "utf8")) as Record<string, { period?: string; prices?: Record<string, unknown>[] }>) : {};
    for (const d of docs) {
      stats.documents++;
      const a = ans[d.doc];
      if (!a) continue;
      stats.answered++;
      const text = norm(readFileSync(d.text, "utf8"));
      const numbers = new Set(d.contracts.map((c) => c.number));
      for (const p of a.prices ?? []) {
        const line = String(p.line ?? ""), price = Number(p.price);
        let why: keyof typeof stats.dropped | null = null;
        if (!(price > 0)) why = "zero";
        else if (PERSONAL.test(`${line} ${p.item} ${p.product ?? ""}`)) why = "personal";
        else if (!/[A-Za-z]{3,}/.test(line.replace(/^r\d+:/, ""))) why = "no_words";
        else if (!text.includes(norm(line)) || !numbersIn(line).has(price)) why = "not_found";
        else if (!numbers.has(String(p.contract))) why = "wrong_contract";
        if (why) {
          stats.dropped[why]++;
          continue;
        }
        stats.prices++;
        kept.push({ award: d.award, contract: p.contract, item: String(p.item).slice(0, 180), category: null, maker: null, sku: p.product ? String(p.product).slice(0, 80) : null, price, list: null, unit: p.unit ?? null, region: p.region ?? null, basis: p.basis ?? "contract_price", period: a.period ?? null, line: line.slice(0, 400), file: d.doc, url: d.url });
      }
    }
  }
  writeFileSync(join(OUT, "prices-reviewed.json"), JSON.stringify({ checked: stats, rows: kept }, null, 1) + "\n");
  console.log(stats);
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

// Prices: award 23452's net prices read by rule, and the other price files' prices kept by --collect-prices.
const BASIS: Record<string, string> = { net_price: "contract net price (list less the contract discount)", contract_price: "awarded contract price", ceiling: "ceiling rate (the most an agency pays)", index_adjusted: "price set by the award's monthly index adjustment" };
const products = new Map<string, Record<string, unknown>>();
const offerings: Record<string, unknown>[] = [];
const priceStats = { rule: 0, reviewed: 0, by_basis: {} as Record<string, number> };
const contractIds = new Set(contracts.map((c) => c.contract_id as string));
// (Preferred-source contracts are added after prices, below.)
for (const [file, key] of [["prices-rule.json", "rule"], ["prices-reviewed.json", "reviewed"]] as const) {
  if (!existsSync(join(OUT, file))) continue;
  for (const r of (JSON.parse(readFileSync(join(OUT, file), "utf8")) as { rows: Record<string, string | number | null>[] }).rows) {
    const cid = `con_ny_${String(r.contract).replace(/[^A-Za-z0-9]/g, "")}`;
    if (!contractIds.has(cid)) continue;
    const c = contracts.find((x) => x.contract_id === cid)!;
    const name = `${r.item}${r.region ? ` (${r.region})` : ""}`.replace(/\s+/g, " ").trim().slice(0, 180);
    const pid = `prd_ny_${hash(`${r.item}|${r.maker ?? ""}|${r.sku ?? ""}`.toLowerCase())}`;
    if (!products.has(pid)) products.set(pid, { product_id: pid, product_name: String(r.item).slice(0, 180), manufacturer: r.maker ?? null, manufacturer_sku: r.sku ?? null, record_type: "awarded_line_item", title_conflict_requires_review: false });
    const basis = String(r.basis ?? "contract_price");
    priceStats[key]++;
    priceStats.by_basis[basis] = (priceStats.by_basis[basis] ?? 0) + 1;
    offerings.push({
      offering_id: `off_ny_${hash(`${cid}|${r.line}|${r.price}|${r.region ?? ""}`)}`,
      product_id: pid,
      supplier_id: c.supplier_id,
      contract_id: cid,
      cooperative: COOP,
      product_name: name,
      vendor_sku: r.sku ?? null,
      source_url: (r.url as string) ?? (c.contract_url as string),
      fixed_price: r.price,
      discount_percent: null,
      pricing_status: "published_price",
      unit_of_measure: r.unit ?? null,
      source_metadata: {
        document_vintage: `NYS OGS ${BASIS[basis] ?? "awarded price"}${r.region ? `, ${r.region}` : ""}${r.period ? `, ${r.period}` : ""}, award ${r.award} (${r.file}); read ${src.retrieved}`,
        category_as_published: `${c.title}: ${BASIS[basis] ?? "awarded price"}`,
        basis: basis === "net_price" ? "net_price" : "awarded_bid",
        line: r.line,
        ...(r.list ? { MSRP: r.list } : {}),
      },
    });
  }
}
// New York's preferred sources: one contract per provider, section and category, its offerings as items
// priced by quote (the list publishes no prices). Approval categories are kept as the state gives them:
// A and D approved, B approved for one agency and optional for others, C and E not approved.
const PS_PROGRAM = "NY Preferred Source";
const preferredStats = { providers: 0, contracts: 0, offerings: 0, by_section: {} as Record<string, number> };
if (existsSync(join(OUT, "preferred.json"))) {
  const ps = JSON.parse(readFileSync(join(OUT, "preferred.json"), "utf8")) as { source: string; revision: string; providers: { name: string; vendor_id: string; website: string; catalogs: string[] }[]; offerings: { id: string; section: string; type: string; approval: string; category: string; subcategory: string | null; name: string; providers: string[]; page: number }[] };
  const SECTION: Record<string, { label: string; kind: "approved" | "agency" | "not_approved" }> = {
    A: { label: "approved statewide", kind: "approved" },
    B: { label: "approved for a specific agency; optional for others", kind: "agency" },
    C: { label: "not approved as a preferred-source item; optional", kind: "not_approved" },
    D: { label: "approved preferred-source service", kind: "approved" },
    E: { label: "not approved as a preferred-source service; optional", kind: "not_approved" },
  };
  const tidy = (x: string) => x.toLowerCase().replace(/\b([a-z])/g, (m) => m.toUpperCase()).replace(/\b(And|Of|The|For|Or|In)\b/g, (m) => m.toLowerCase());
  const groups = new Map<string, typeof ps.offerings>();
  for (const o of ps.offerings) for (const prov of o.providers) {
    const k = `${prov}|${o.section}|${o.category}`;
    (groups.get(k) ?? groups.set(k, []).get(k)!).push(o);
  }
  preferredStats.providers = ps.providers.length;
  for (const [k, offs] of groups) {
    const [prov, section, category] = k.split("|");
    const p = ps.providers.find((x) => x.name === prov);
    const sec = SECTION[section];
    const sid = `sup_nyps_${hash(prov.toLowerCase())}`;
    if (!suppliers.has(sid)) suppliers.set(sid, { supplier_id: sid, name: prov, name_variants: [prov], cooperatives: [PS_PROGRAM], websites: p?.website ? [p.website] : [] });
    const cid = `con_nyps_${hash(k, 12)}`;
    preferredStats.contracts++;
    preferredStats.by_section[section] = (preferredStats.by_section[section] ?? 0) + offs.length;
    contracts.push({
      contract_id: cid,
      cooperative: PS_PROGRAM,
      contract_number: `${p?.vendor_id ? `Vendor ${p.vendor_id} · ` : ""}Section ${section}`,
      supplier_id: sid,
      supplier_name: prov,
      title: `${tidy(category)}: preferred source, ${sec.label}`,
      start_date: null,
      end_date: null,
      category_labels: [tidy(category), ...new Set(offs.map((o) => o.subcategory).filter((x): x is string => Boolean(x))), ...offs.map((o) => o.name)].slice(0, 60),
      regions_as_published: ["New York"],
      contract_url: p?.catalogs?.[0] ?? ps.source,
      lead_agency: "New York preferred source (State Finance Law § 162), listed by OGS",
      source_metadata: {
        state_contract: { state: "NY", locals: true, solicitation: `Preferred source, Section ${section}`, type_code: sec.label, group: "Preferred source" },
        preferred: sec.kind,
        preferred_section: section,
        line_items_paginated: false,
      },
    });
    documents.push({ document_id: `doc_nyps_${hash(cid)}`, cooperative: PS_PROGRAM, url: "https://ogs.ny.gov/procurement/list-preferred-source-offerings", label: `OGS List of Preferred Source Offerings, ${ps.revision}`, contract_id: cid });
    for (const o of offs) {
      const pid = `prd_nyps_${hash(`${o.id}`)}`;
      if (!products.has(pid)) products.set(pid, { product_id: pid, product_name: o.subcategory ? `${o.name} (${o.subcategory})` : o.name, manufacturer: null, manufacturer_sku: null, record_type: "preferred_source_offering", title_conflict_requires_review: false });
      offerings.push({
        offering_id: `off_nyps_${hash(`${cid}|${o.id}`)}`,
        product_id: pid,
        supplier_id: sid,
        contract_id: cid,
        cooperative: PS_PROGRAM,
        product_name: o.name,
        vendor_sku: null,
        source_url: ps.source,
        fixed_price: null,
        discount_percent: null,
        pricing_status: "quote",
        unit_of_measure: null,
        source_metadata: { category_as_published: `${tidy(category)} (Section ${section}, ${sec.label}), page ${o.page} of the ${ps.revision} list` },
      });
      preferredStats.offerings++;
    }
  }
}

// What each priced contract covers, in its price file's words.
for (const c of contracts) {
  const items = [...new Set(offerings.filter((o) => o.contract_id === c.contract_id).map((o) => String((products.get(o.product_id as string) ?? {}).product_name ?? "")).filter(Boolean))].slice(0, 25);
  if (items.length) c.category_labels = [...(c.category_labels as string[]), ...items];
}
writeFileSync(join(OUT, "records.json.gz"), gzipSync(JSON.stringify({ retrieved: src.retrieved, suppliers: [...suppliers.values()], contracts, products: [...products.values()], offerings, documents }), { level: 9 }));
const summary = { source: SOURCE, retrieved: src.retrieved, master_report_date: src.master_report_date, ...stats, preferred: preferredStats, suppliers: suppliers.size, priced_lines: offerings.filter((o) => o.fixed_price != null).length, prices: priceStats, with_prices: new Set(offerings.map((o) => o.contract_id)).size, products: products.size };
writeFileSync(join(OUT, "summary.json"), JSON.stringify(summary, null, 1) + "\n");
console.log(JSON.stringify(summary, null, 1));
