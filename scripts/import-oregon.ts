// Oregon: the statewide price agreements DAS Procurement Services runs on OregonBuys, the fifth TRX state.
// Members of OrCPP (the Oregon Cooperative Procurement Program, free to join) may buy from an agreement whose
// page says "Cooperative Purchasing Allowed: Yes"; ORS 279A.205 and 279A.215 allow it as a permissive
// cooperative procurement. Agora prefers these for Oregon buyers (lib/trx.ts).
//
//   npm run fetch:oregon                   download the list, each agreement's page and the OrCPP member list
//   npm run import:oregon -- --read        read that download (seed/catalog/source/oregon/cache/) into the
//                                          committed source, then rebuild
//   npm run import:oregon                  rebuild the records from the committed source
//
// Committed source (seed/catalog/source/oregon/):
//   contracts.json.gz    each active DAS Procurement Services blanket: the list's fields plus what its public
//                        summary page says (cooperative use, discipline, terms, line items with NIGP codes,
//                        attachment names). Purchaser names and contact instructions are never copied.
//   members.json         OrCPP's member list as DAS publishes it: each public body's name, number and type.
//
// Writes records.json.gz in the co-op catalog's raw shapes and summary.json; then run npm run import:catalog-coops.
//
// Left out: agreements under ORS chapter 190 (intergovernmental and interagency agreements, which include
// OrCPP membership agreements themselves and surplus-property agreements with local governments). They aren't
// contracts anyone buys from.
//
// Prices: as on NJSTART, a page's unit cost is kept only when it prints in the line's own text, is more than a
// placeholder, carries no discount percentage and isn't a percentage. Most OregonBuys agreements print $0
// placeholder items and keep their prices in attached price sheets, which are linked for the document reader.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync, gzipSync } from "node:zlib";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "seed/catalog/source/oregon");
const CACHE = join(OUT, "cache");
const COOP = "OregonBuys";
const PORTAL = "https://oregonbuys.gov/bso";
const LIST_URL = `${PORTAL}/view/search/external/advancedSearchContractBlanket.xhtml`;

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

export const pageUrl = (id: string) => `${PORTAL}/external/purchaseorder/poSummary.sda?docId=${encodeURIComponent(id)}&releaseNbr=0&external=true&parentUrl=close`;
export const attachmentUrl = (id: string, file: string) => `${PORTAL}/external/purchaseorder/poSummary.sda?docId=${encodeURIComponent(id)}&releaseNbr=0&external=true&mode=download&downloadFileNbr=${file}`;
export const pageFile = (id: string) => `${id.replace(/[^A-Za-z0-9._-]/g, "_")}.html`;

const decode = (s: string) =>
  s
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
/** A summary page as one line of text: tags become spaces. */
export const pageText = (html: string) => decode(html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();

interface Item {
  seq: string;
  item: string;
  description: string;
  nigp: string | null;
  nigp_description: string | null;
  receipt: string | null;
  quantity: string | null;
  unit_cost: string | null;
  uom: string | null;
  discount: string | null;
  manufacturer: string | null;
  brand: string | null;
  model: string | null;
  /** The item block as the page prints it, for checking a price against. */
  line: string;
}
interface Rec {
  number: string;
  solicitation: string | null;
  description: string;
  vendor: string;
  type_code: string | null;
  spent: string;
  begin: string;
  end: string;
  coop: boolean | null;
  discipline: string | null;
  location: string | null;
  payment_terms: string | null;
  shipping_terms: string | null;
  items: Item[];
  attachments: { file: string; label: string; from: "agency" | "vendor" }[];
}

/** The value after a label, up to the next label in `next`. */
function field(text: string, label: string, next: string[]): string | null {
  const at = text.indexOf(`${label}:`);
  if (at < 0) return null;
  const rest = text.slice(at + label.length + 1);
  let end = rest.length;
  for (const n of next) {
    const i = rest.indexOf(`${n}:`);
    if (i >= 0 && i < end) end = i;
  }
  const v = rest.slice(0, end).trim();
  return v || null;
}
const HEAD_LABELS = ["Purchase Order Number", "Release Number", "Short Description", "Status", "Purchaser", "Receipt Method", "Fiscal Year", "PO Type", "Minor Status", "Organization", "Department", "Location", "Alternate ID", "Entered Date", "Days ARO", "Retainage %", "Discount %", "Release Type", "Contact Instructions", "Actual Cost", "Print Format", "Discipline Type", "Agency Attachments", "Vendor Attachments", "Primary Vendor Information & PO Terms Vendor", "Payment Terms", "Shipping Method", "Shipping Terms", "Freight Terms", "PO Acknowledgements", "Master Blanket Vendor Distributor List", "Master Blanket Controls Master Blanket Begin Date", "Master Blanket End Date", "Cooperative Purchasing Allowed"];

function readPage(html: string, row: Record<string, string>): Rec {
  const text = pageText(html);
  const cut = text.indexOf("Item Information");
  const head = cut >= 0 ? text.slice(0, cut) : text;
  const f = (label: string) => field(head, label, HEAD_LABELS.filter((l) => l !== label));
  const coop = /Cooperative Purchasing Allowed:\s*Yes/.test(head) ? true : /Cooperative Purchasing Allowed:\s*No/.test(head) ? false : null;
  // Line items: "Print Sequence # 1.0, Item # 1: <description> <status> NIGP Code: 936-40 <description> … Receipt Method Qty Unit Cost UOM
  // Discount % Total Discount Amt. Total Cost Quantity 1.0 25.0 EA - Each 0.0 0.0 25.0 Manufacturer: … Brand: … Model: … Make: … Packaging: …"
  const items: Item[] = [];
  if (cut >= 0) {
    const body = text.slice(cut + "Item Information".length).replace(/Copyright ©.*$/, "");
    const parts = body.split(/(?=Print Sequence # [\d.]+, Item # \d+:)/).filter((p) => /^Print Sequence #/.test(p));
    for (const p of parts) {
      const m = p.match(/^Print Sequence # ([\d.]+), Item # (\d+):\s*(.*?)\s+(?:\d[A-Z]{2} - [A-Za-z ]+?|Active|Inactive)\s+(?=NIGP Code:|Receipt Method|Bid #)/);
      const nigp = p.match(/NIGP Code:\s*(\d{3})-?(\d{2})?\s+(.*?)\s+(?=Bid # \/|Quote # \/|Receipt Method)/);
      const nums = p.match(/Total Cost\s+(\w+)\s+([\d.,-]+)\s+([\d.,-]+)\s+(.+?)\s+([\d.,-]+)\s+([\d.,-]+)\s+([\d.,-]+)\s+Manufacturer:/);
      const after = (label: string, nexts: string[]) => field(p, label, nexts);
      items.push({
        seq: m?.[1] ?? "",
        item: m?.[2] ?? p.match(/Item # (\d+):/)?.[1] ?? "",
        description: (m?.[3] ?? p.replace(/^Print Sequence # [\d.]+, Item # \d+:\s*/, "").split(/\s+NIGP Code:|\s+Receipt Method/)[0]).trim(),
        nigp: nigp ? (nigp[2] ? `${nigp[1]}-${nigp[2]}` : nigp[1]) : null,
        nigp_description: nigp?.[3]?.trim() ?? null,
        receipt: nums?.[1] ?? null,
        quantity: nums?.[2] ?? null,
        unit_cost: nums?.[3] ?? null,
        uom: nums?.[4] ?? null,
        discount: nums?.[5] ?? null,
        manufacturer: after("Manufacturer", ["Brand"]),
        brand: after("Brand", ["Model"]),
        model: after("Model", ["Make"]),
        line: p.trim().slice(0, 1500),
      });
    }
  }
  // Attachments: "javascript:downloadFile('163138')" links, in the agency's cell or the vendor's.
  const attachments: Rec["attachments"] = [];
  const vendorAt = html.search(/Vendor Attachments:/);
  for (const a of html.matchAll(/downloadFile\('(\d+)'\);?"\s*class="[^"]*">([^<]+)<\/a>/g))
    attachments.push({ file: a[1], label: decode(a[2]).replace(/\s+/g, " ").trim(), from: vendorAt >= 0 && (a.index ?? 0) > vendorAt ? "vendor" : "agency" });
  return {
    number: row["Blanket #"].trim(),
    solicitation: row["Bid Solicitation #"].trim() || null,
    description: row["Description"].replace(/\s+/g, " ").trim(),
    vendor: row["Vendor"].replace(/\s+/g, " ").trim(),
    type_code: row["Type Code"].trim() || null,
    spent: row["Dollars Spent to Date"],
    begin: row["Begin Date"],
    end: row["End Date"],
    coop,
    discipline: f("Discipline Type"),
    location: f("Location"),
    payment_terms: f("Payment Terms"),
    shipping_terms: f("Shipping Terms"),
    items,
    attachments,
  };
}

// ------------------------------------------------------------------ 1. read the download, if asked

if (process.argv[2] === "--read") {
  const dir = process.argv[3] ?? CACHE;
  const list = parseCsv(readFileSync(join(dir, "list.csv"), "utf8"));
  const meta = JSON.parse(readFileSync(join(dir, "list.json"), "utf8"));
  const have = new Set(readdirSync(join(dir, "pages")));
  const missing: string[] = [];
  const recs: Rec[] = [];
  for (const row of list) {
    const file = pageFile(row["Blanket #"].trim());
    if (!have.has(file)) {
      missing.push(row["Blanket #"]);
      continue;
    }
    recs.push(readPage(readFileSync(join(dir, "pages", file), "utf8"), row));
  }
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "contracts.json.gz"), gzipSync(JSON.stringify({ ...meta, missing_pages: missing, contracts: recs }), { level: 9 }));
  writeFileSync(join(OUT, "members.json"), readFileSync(join(dir, "members.json")));
  console.log(`Read ${recs.length} of ${list.length} agreements (${missing.length} pages missing) and the OrCPP member list.`);
}

// ------------------------------------------------------------------ 2. build the records

const src = JSON.parse(gunzipSync(readFileSync(join(OUT, "contracts.json.gz"))).toString("utf8")) as { retrieved: string; listed: number; missing_pages: string[]; contracts: Rec[] };
const members = JSON.parse(readFileSync(join(OUT, "members.json"), "utf8")) as { retrieved: string; members: { name: string; number: string | null; type: string | null }[] };
const retrieved = src.retrieved;
const hash = (s: string, n = 16) => createHash("sha1").update(s).digest("hex").slice(0, n);
const usDate = (s: string) => {
  const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return null;
  // OregonBuys marks open-ended agreements with far-future years (12/31/3030, 04/24/9999).
  return Number(m[3]) > 2100 ? null : `${m[3]}-${m[1]}-${m[2]}`;
};
const longDate = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
const money = (s: string) => {
  const n = Number(s.replace(/[$,]/g, ""));
  return Number.isFinite(n) ? n : null;
};

/** Titles as DAS writes them, less the program tags that the record says already ("NASPO OR PA", "ORFWD PA /"). */
function tidyTitle(desc: string): string {
  const t = desc
    .replace(/^(?:ORFWD|OR FWD)\s+PA\s*\/\s*/i, "")
    .replace(/^(?:ORFWD|OR FWD)\s+PA\s+/i, "")
    .replace(/\s*\/\s*[^/]+$/, (tail) => (/\b(llc|inc|center|company|corp|staffing|services)\b/i.test(tail) ? "" : tail))
    .replace(/\s+/g, " ")
    .trim();
  return t || desc;
}
/** Where an agreement came from, when its title says: a NASPO ValuePoint or MMCAP participating addendum, or Oregon Forward. */
function lineage(desc: string): string | null {
  if (/\bNASPO\b/i.test(desc)) return "Oregon's participating addendum to a NASPO ValuePoint master agreement";
  if (/\bMMCAP\b|\bMMS\d{5,}/i.test(desc)) return "Oregon's participation in an MMCAP Infuse contract";
  if (/\bORFWD\b|Oregon Forward/i.test(desc)) return "an Oregon Forward contract (ORS 279.835 to 279.855)";
  return null;
}

interface RawSupplier { supplier_id: string; name: string; name_variants: string[]; cooperatives: string[] }
interface RawContract { contract_id: string; cooperative: string; contract_number: string | null; supplier_id: string; supplier_name: string; title: string; start_date: string | null; end_date: string | null; category_labels?: string[]; regions_as_published?: string[]; contract_url: string; lead_agency?: string | null; source_metadata?: Record<string, unknown> }
interface RawProduct { product_id: string; product_name: string; manufacturer?: string | null; manufacturer_sku?: string | null; record_type: string; title_conflict_requires_review: boolean }
interface RawOffering { offering_id: string; product_id: string; supplier_id: string; contract_id: string; cooperative: string; product_name: string; vendor_sku?: string | null; source_url: string; fixed_price: number | null; discount_percent: number | null; pricing_status: string; unit_of_measure?: string | null; source_metadata?: Record<string, unknown> }
interface RawDocument { document_id: string; cooperative: string; url: string; label: string; contract_id: string }

const suppliers = new Map<string, RawSupplier>();
const supplierFor = (name: string) => {
  const id = `sup_or_${hash(name.toLowerCase())}`;
  if (!suppliers.has(id)) suppliers.set(id, { supplier_id: id, name, name_variants: [name], cooperatives: [COOP] });
  return id;
};
const UNIT: Record<string, string> = { EA: "each", HOUR: "hour", HR: "hour", CASE: "case", GALLON: "gallon", GAL: "gallon", LOT: "lot", MO: "month", MONTH: "month", DAY: "day", LB: "pound", TON: "ton", YR: "year", YEAR: "year", FT: "foot", BX: "box", PK: "pack", DZ: "dozen", PR: "pair" };
const unitOf = (u: string | null) => {
  if (!u) return null;
  const [code, name] = u.split(/\s+-\s+/);
  return UNIT[code.trim().toUpperCase()] ?? (name ?? code).trim().toLowerCase();
};
const isPlaceholder = (price: number, desc: string) => price <= 0.01 || (price === 1 && /refer|price sheet|attach|see |per the|schedule|catalog/i.test(desc));
const tidyName = (s: string) => {
  const t = s.replace(/\s+/g, " ").replace(/[\s.;,:-]+$/, "").trim();
  return t.length > 160 ? `${t.slice(0, 160).replace(/\s+\S*$/, "")}…` : t;
};

const contracts: RawContract[] = [];
const products = new Map<string, RawProduct>();
const offerings: RawOffering[] = [];
const documents: RawDocument[] = [];
const stats = {
  listed: src.listed,
  pages_missing: src.missing_pages.length,
  intergovernmental: 0,
  orcpp_membership_agreements: 0,
  expired: 0,
  contracts: 0,
  open_to_locals: 0,
  state_only: 0,
  flag_missing: 0,
  with_nigp: 0,
  naspo_addenda: 0,
  mmcap: 0,
  oregon_forward: 0,
  open_ended: 0,
  with_prices: 0,
  priced_lines: 0,
  lines: 0,
  dropped: { no_price: 0, placeholder: 0, discount: 0, percent: 0, index_markup: 0, unverified: 0, no_name: 0 },
  documents: 0,
  attachments: 0,
  spent_to_date: 0,
  disciplines: {} as Record<string, number>,
};
const pricedContracts = new Set<string>();
for (const r of src.contracts) {
  if (/^ORS ?190/i.test(r.discipline ?? "")) {
    stats.intergovernmental++;
    if (/or ?cpp/i.test(r.description) || /^IGA with\b/i.test(r.description)) stats.orcpp_membership_agreements++;
    continue;
  }
  const end = usDate(r.end);
  if (end && end < retrieved) {
    stats.expired++;
    continue;
  }
  if (!end) stats.open_ended++;
  const id = `con_or_${r.number.replace(/[^A-Za-z0-9-]/g, "")}`;
  const sid = supplierFor(r.vendor);
  const nigp = [...new Set(r.items.map((i) => i.nigp).filter((x): x is string => Boolean(x)))].sort();
  const nigpLabels = [...new Set(r.items.map((i) => i.nigp_description).filter((x): x is string => Boolean(x)))];
  const from = lineage(r.description);
  const spent = money(r.spent);
  stats.contracts++;
  r.coop ? stats.open_to_locals++ : stats.state_only++;
  if (r.coop === null) stats.flag_missing++;
  if (nigp.length) stats.with_nigp++;
  if (from?.includes("NASPO")) stats.naspo_addenda++;
  if (from?.includes("MMCAP")) stats.mmcap++;
  if (from?.includes("Oregon Forward")) stats.oregon_forward++;
  stats.spent_to_date += spent ?? 0;
  const d = r.discipline ?? "Not stated";
  stats.disciplines[d] = (stats.disciplines[d] ?? 0) + 1;
  const url = pageUrl(r.number);
  contracts.push({
    contract_id: id,
    cooperative: COOP,
    contract_number: r.number,
    supplier_id: sid,
    supplier_name: r.vendor,
    title: tidyTitle(r.description),
    start_date: usDate(r.begin),
    end_date: end,
    category_labels: [...new Set([r.description, ...nigpLabels, ...(r.discipline ? [r.discipline] : [])])],
    regions_as_published: ["Oregon"],
    contract_url: url,
    lead_agency: "State of Oregon, Department of Administrative Services, Procurement Services",
    source_metadata: {
      state_contract: {
        state: "OR",
        // OrCPP members may use an agreement whose controls allow cooperative purchasing.
        locals: r.coop === true,
        solicitation: r.solicitation,
        type_code: r.type_code ?? (from ? from.replace(/^(an?|Oregon's) /, "") : null),
        group: r.discipline,
      },
      spent_to_date: spent,
      payment_terms: r.payment_terms,
      shipping_terms: r.shipping_terms,
      ...(from ? { lineage: from } : {}),
      nigp,
      line_items_paginated: false,
    },
  });
  // Prices printed on the page, under NJSTART's rules.
  for (const it of r.items) {
    stats.lines++;
    const raw = (it.unit_cost ?? "").replace(/,/g, "");
    const price = Number(raw);
    if (!raw || !Number.isFinite(price) || price <= 0) {
      stats.dropped.no_price++;
      continue;
    }
    if (/^PCNT|percent/i.test(it.uom ?? "")) {
      stats.dropped.percent++;
      continue;
    }
    if (Number(it.discount || 0) > 0) {
      stats.dropped.discount++;
      continue;
    }
    if (/^GAL/i.test(it.uom ?? "") && price < 2 && /diesel|gasoline|fuel|propane|kerosene|OPIS/i.test(it.description)) {
      stats.dropped.index_markup++;
      continue;
    }
    if (isPlaceholder(price, it.description)) {
      stats.dropped.placeholder++;
      continue;
    }
    if (!it.line.includes(` ${it.unit_cost} `)) {
      stats.dropped.unverified++;
      continue;
    }
    const name = tidyName(it.description);
    if (name.length < 3) {
      stats.dropped.no_name++;
      continue;
    }
    const brand = it.brand && it.brand.length <= 60 ? it.brand : null;
    const model = it.model && it.model.length <= 40 && !/:/.test(it.model) ? it.model : null;
    const pid = `prd_or_${hash(`${brand ?? ""}|${name}`.toLowerCase())}`;
    if (!products.has(pid)) products.set(pid, { product_id: pid, product_name: name, manufacturer: brand, manufacturer_sku: model, record_type: "awarded_line_item", title_conflict_requires_review: false });
    const start = usDate(r.begin);
    const term = start && end ? `${longDate(start)} to ${longDate(end)}` : start ? `from ${longDate(start)}` : "term not published";
    offerings.push({
      offering_id: `off_or_${hash(`${r.number}|${it.item}|${it.seq}`)}`,
      product_id: pid,
      supplier_id: sid,
      contract_id: id,
      cooperative: COOP,
      product_name: name,
      vendor_sku: model,
      source_url: url,
      fixed_price: price,
      discount_percent: null,
      pricing_status: "published_price",
      unit_of_measure: unitOf(it.uom),
      source_metadata: {
        document_vintage: `OregonBuys awarded price agreement price, agreement term ${term}; read from OregonBuys ${longDate(retrieved)}`,
        category_as_published: `${tidyTitle(r.description)}: OregonBuys item ${it.item}`,
        basis: "awarded_bid",
        nigp: it.nigp,
        line: it.line.slice(0, 600),
      },
    });
    pricedContracts.add(id);
    stats.priced_lines++;
  }
  // Documents: the page itself (held as text by npm run import:doctext), then its attachments.
  documents.push({ document_id: `doc_or_${hash(`${id}|summary`)}`, cooperative: COOP, url, label: "OregonBuys price agreement summary page", contract_id: id });
  const seen = new Set<string>();
  for (const a of r.attachments) {
    if (seen.has(a.file)) continue;
    seen.add(a.file);
    stats.attachments++;
    documents.push({ document_id: `doc_or_${hash(`${id}|${a.file}`)}`, cooperative: COOP, url: attachmentUrl(r.number, a.file), label: a.label || "Agreement document", contract_id: id });
  }
}
stats.with_prices = pricedContracts.size;
stats.documents = documents.length;

writeFileSync(join(OUT, "records.json.gz"), gzipSync(JSON.stringify({ retrieved, suppliers: [...suppliers.values()], contracts, products: [...products.values()], offerings, documents }), { level: 9 }));
const byType = members.members.reduce<Record<string, number>>((m, x) => ((m[x.type ?? "Not stated"] = (m[x.type ?? "Not stated"] ?? 0) + 1), m), {});
const summary = {
  source: LIST_URL,
  scope: "Active blankets of the Department of Administrative Services, Procurement Services (107090)",
  retrieved,
  ...stats,
  spent_to_date: Math.round(stats.spent_to_date),
  suppliers: suppliers.size,
  products: products.size,
  orcpp_members: members.members.length,
  orcpp_members_by_type: Object.fromEntries(Object.entries(byType).sort((a, b) => b[1] - a[1])),
  members_retrieved: members.retrieved,
  note: "Line items are the summary page's; most agreements print $0 placeholders and keep prices in attached price sheets, which are linked, not read.",
};
writeFileSync(join(OUT, "summary.json"), JSON.stringify(summary, null, 1) + "\n");
console.log(JSON.stringify(summary, null, 1));

// The NIGP codes OregonBuys prints on these agreements, with its descriptions; lib/nigp.ts adds the ones
// NJSTART's list lacks, so contract pages can name them.
{
  const codes = new Map<string, { description: string; lines: number; contracts: Set<string> }>();
  for (const r of src.contracts)
    for (const it of r.items) {
      if (!it.nigp || !it.nigp_description) continue;
      const x = codes.get(it.nigp) ?? { description: it.nigp_description, lines: 0, contracts: new Set<string>() };
      x.lines++;
      x.contracts.add(r.number);
      codes.set(it.nigp, x);
    }
  const sorted = [...codes].sort(([a], [b]) => a.localeCompare(b));
  const classes: Record<string, { items: string[]; contracts: number }> = {};
  for (const [code, x] of sorted) (classes[code.slice(0, 3)] ??= { items: [], contracts: 0 }).items.push(`${code} ${x.description}`);
  for (const k of Object.keys(classes)) classes[k].contracts = new Set(sorted.filter(([c]) => c.startsWith(k)).flatMap(([, x]) => [...x.contracts])).size;
  writeFileSync(
    join(OUT, "nigp.json"),
    JSON.stringify({ source: "NIGP codes and descriptions as printed on OregonBuys' public price agreement pages", retrieved, codes: Object.fromEntries(sorted.map(([c, x]) => [c, { description: x.description, lines: x.lines, contracts: x.contracts.size }])), classes }, null, 1) + "\n",
  );
  console.log(`NIGP: ${codes.size} codes in ${Object.keys(classes).length} classes.`);
}
if (!existsSync(join(OUT, "records.json.gz"))) process.exit(1);
