// NJSTART: New Jersey's state contracts, the TRX program Sovra supports. Locals in New
// Jersey buy on these through the state's Cooperative Purchasing Program, and Agora
// prefers them to co-op contracts for New Jersey buyers (lib/trx.ts).
//
//   npm run import:njstart                 rebuild the records from the committed source
//   npm run import:njstart -- <folder>     first read a fresh NJSTART download (the unzipped
//                                          "NJSTART_Active_Contracts_<date>" export) into the
//                                          committed source, then rebuild
//
// Reads (committed, seed/catalog/source/njstart/):
//   contracts.csv.gz     the active-contract export: number, title, vendor, dates, spend
//   details.json.gz      fields read from each contract's public summary page: whether it
//                        is open to cooperative purchasing, its T-number, terms. Purchaser
//                        names and contact emails on those pages are never copied.
//   line-items.csv.gz    the item blocks on each contract's first summary page
//   attachments.csv.gz   each contract's documents, with download links
//
// Writes seed/catalog/source/njstart/records.json.gz in the co-op catalog's raw shapes
// (suppliers, contracts, products, offerings, documents) and summary.json. Then run
// `npm run import:catalog-coops`, which folds them into the catalog.
//
// Prices: a line's unit cost is kept only when it appears in the line's own source text,
// is more than a dollar placeholder, carries no discount percentage (discounts are
// tabled; see HANDOFF.md) and isn't a percentage. Each kept price is an awarded state
// contract price, labelled with the contract's term.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync, gzipSync } from "node:zlib";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "seed/catalog/source/njstart");
const COOP = "NJSTART";

// ------------------------------------------------------------------ CSV

/** RFC 4180: quoted fields may hold commas, quotes and newlines. */
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
const gz = (name: string) => gunzipSync(readFileSync(join(OUT, name))).toString("utf8");

// ------------------------------------------------------------------ 1. a fresh download, if given

interface Detail {
  number: string;
  /** "NJ Cooperative Purchasing": the state opens the contract to its local governments. */
  nj_coop: boolean;
  /** "Cooperative Purchasing Allowed" in the contract controls. */
  coop_allowed: boolean;
  t_number: string | null;
  type_code: string | null;
  group: string | null;
  payment_terms: string | null;
  shipping_terms: string | null;
  green: boolean;
  set_aside: string | null;
  days_aro: number | null;
  retrieved: string;
}

/** The value after a label on the summary page, up to the next known label. */
function field(text: string, label: string, next: string[]): string | null {
  const at = text.indexOf(`${label}:`);
  if (at < 0) return null;
  const rest = text.slice(at + label.length + 1);
  let end = rest.length;
  for (const n of next) {
    const i = rest.indexOf(`${n}:`);
    if (i >= 0 && i < end) end = i;
  }
  const v = rest.slice(0, end).replace(/\s+/g, " ").trim();
  return v || null;
}

function readDownload(dir: string) {
  const need = ["NJSTART_Active_Contracts.csv", "NJSTART_Contracts.json", "NJSTART_Contract_Line_Items.csv", "NJSTART_Contract_Attachments.csv"];
  for (const f of need) if (!existsSync(join(dir, f))) throw new Error(`${f} isn't in ${dir}`);
  const pages = JSON.parse(readFileSync(join(dir, "NJSTART_Contracts.json"), "utf8")) as { contract: Record<string, string>; details: { contract_number: string; detail_text: string } }[];
  const LABELS = ["Location", "Type Code", "Alternate ID", "Entered Date", "Days ARO", "Retainage %", "Discount %", "Release Type", "Payment Terms", "Shipping Method", "Shipping Terms", "Freight Terms", "PO Acknowledgements", "Contract Vendor Distributor List", "T Number", "NJ Cooperative Purchasing", "Green Contract", "Emergency Contract", "Set Aside Category", "NJ Vendor Certification Category", "Performance Bond Required", "PO_Contact_Email", "Agency Attachments", "Print Format", "Contact Instructions", "Actual Cost", "Vendor Attachments", "Primary Vendor Information & PO Terms Vendor"];
  const details: Detail[] = pages.map((p) => {
    // Header fields only: the item blocks below repeat words like "Brand:".
    const t = p.details.detail_text;
    const head = t.slice(0, t.includes("Item Information") ? t.indexOf("Item Information") : t.length);
    const f = (label: string) => field(head, label, LABELS.filter((l) => l !== label));
    const aro = Number(f("Days ARO"));
    return {
      number: p.details.contract_number,
      nj_coop: /NJ Cooperative Purchasing:\s*Yes/.test(head),
      coop_allowed: /Cooperative Purchasing Allowed:\s*Yes/.test(head),
      t_number: f("T Number"),
      type_code: f("Type Code"),
      group: f("Location"),
      payment_terms: f("Payment Terms"),
      shipping_terms: f("Shipping Terms"),
      green: /Green Contract:\s*Yes/.test(head),
      set_aside: (f("Set Aside Category") ?? "None") === "None" ? null : f("Set Aside Category"),
      days_aro: Number.isFinite(aro) && aro > 0 ? aro : null,
      retrieved: p.contract["Retrieved Date"] || "",
    };
  });
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "details.json.gz"), gzipSync(JSON.stringify(details), { level: 9 }));
  writeFileSync(join(OUT, "contracts.csv.gz"), gzipSync(readFileSync(join(dir, "NJSTART_Active_Contracts.csv")), { level: 9 }));
  writeFileSync(join(OUT, "line-items.csv.gz"), gzipSync(readFileSync(join(dir, "NJSTART_Contract_Line_Items.csv")), { level: 9 }));
  writeFileSync(join(OUT, "attachments.csv.gz"), gzipSync(readFileSync(join(dir, "NJSTART_Contract_Attachments.csv")), { level: 9 }));
  console.log(`Read ${details.length} contracts from ${dir} into seed/catalog/source/njstart/.`);
}

if (process.argv[2]) readDownload(process.argv[2]);

// ------------------------------------------------------------------ 2. build the records

const contractsCsv = parseCsv(gz("contracts.csv.gz"));
const details = new Map((JSON.parse(gz("details.json.gz")) as Detail[]).map((d) => [d.number, d]));
const items = parseCsv(gz("line-items.csv.gz"));
const attachments = parseCsv(gz("attachments.csv.gz"));
const retrieved = contractsCsv[0]?.["Retrieved Date"] || "2026-11-14";

const hash = (s: string, n = 16) => createHash("sha1").update(s).digest("hex").slice(0, n);
const usDate = (s: string) => {
  const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return m ? `${m[3]}-${m[1]}-${m[2]}` : null;
};
const longDate = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
const money = (s: string) => {
  const n = Number(s.replace(/[$,]/g, ""));
  return Number.isFinite(n) ? n : null;
};

const SMALL = new Set(["of", "and", "the", "for", "in", "at", "on", "to", "a", "an", "or", "by", "with"]);
const KEEP_CAPS = /^(NJ|NJDOT|NJTA|DOT|DPP|IT|GIS|MMIS|HVAC|LED|EMS|UPS|PPE|ADA|USA|US|II|III|IV|CNG|LNG|GPS|CAD|RFID|EDDL|SBE|MBE|WBE|OEM|ATV|UTV|K-12|PC|PCS|AV|DNA|LIMS|ERP|CRM|SAAS|VOIP|DMV|MVC|NJIT|CPA|EAP|PBM|TPA|HMO|PPO|SUV|SUVS|4X4|4WD|AWD|2WD|EV|EVS)$/i;
/** "SOLAR SYSTEM INSTALLATION NJ DOT" → "Solar System Installation NJ DOT". Mixed-case text is left alone. */
function tidyCaps(s: string): string {
  const letters = s.replace(/[^A-Za-z]/g, "");
  if (!letters || letters !== letters.toUpperCase()) return s;
  return s
    .toLowerCase()
    .split(/(\s+|-|\/|\(|\))/)
    .map((w, i) => (KEEP_CAPS.test(w) ? w.toUpperCase() : i > 0 && SMALL.has(w) ? w : w.replace(/^([a-z])/, (c) => c.toUpperCase())))
    .join("");
}

/** "T2187 - Parts and Repairs for Lawn and Grounds Equipment" → its T-number and the title. */
function splitTitle(desc: string): { t: string | null; title: string } {
  const d = desc.replace(/\s+/g, " ").trim();
  const m = d.match(/^([TM]\d{3,5}[A-Z]?)\s*[-–:]?\s*(.+)$/);
  return m ? { t: m[1], title: tidyCaps(m[2].trim()) } : { t: null, title: tidyCaps(d) };
}

/** The commodity group: "FLEET - Commodities Fleet" → "Commodities Fleet". */
/** "490-90" and "49090" → "490-90"; a bare class "490" stays "490". */
const normNigp = (c: string | null | undefined) => {
  const m = (c ?? "").trim().match(/^(\d{3})-?(\d{2})?$/);
  return m ? (m[2] ? `${m[1]}-${m[2]}` : m[1]) : null;
};
const groupName = (g: string | null) => (g ? g.replace(/^[A-Z0-9]+\s*-\s*/, "").trim() : null);
const groupCode = (g: string | null) => (g ? (g.match(/^([A-Z0-9]+)\s*-/)?.[1] ?? null) : null);

// Agora's categories, only where the commodity group or NIGP class settles it. Anything
// else stays uncategorized, which search treats as "any category" rather than guessing.
function categoryFor(group: string | null, nigp: string[]): string | undefined {
  const code = groupCode(group);
  if (code === "FLEET") return "Fleet and parts";
  if (code === "PROS1" || code === "PROSV") return "Professional services";
  const classes = nigp.map((n) => n.slice(0, 3));
  const top = classes.sort((a, b) => classes.filter((x) => x === b).length - classes.filter((x) => x === a).length)[0];
  if (!top) return undefined;
  if (["420", "425"].includes(top)) return "Furniture";
  if (["485"].includes(top)) return "Janitorial";
  if (["615", "620"].includes(top)) return "Office supplies";
  if (["200", "201"].includes(top)) return "Safety and uniforms";
  if (["204", "205", "206"].includes(top)) return "IT hardware";
  if (["208", "209", "920"].includes(top)) return "Software and services";
  if (["918"].includes(top)) return "Professional services";
  if (["060", "065", "070", "071", "075", "928"].includes(top)) return "Fleet and parts";
  return undefined;
}

// ---- suppliers: one per vendor name (the catalog importer merges them with the other co-ops')

interface RawSupplier { supplier_id: string; name: string; name_variants: string[]; cooperatives: string[]; websites?: string[] }
const suppliers = new Map<string, RawSupplier>();
const supplierFor = (name: string) => {
  const clean = name.replace(/\s+/g, " ").trim();
  const id = `sup_nj_${hash(clean.toLowerCase())}`;
  if (!suppliers.has(id)) suppliers.set(id, { supplier_id: id, name: clean, name_variants: [clean], cooperatives: [COOP] });
  return id;
};

// ---- line items, grouped by contract

const itemsByContract = new Map<string, Record<string, string>[]>();
for (const r of items) (itemsByContract.get(r.contract_number) ?? itemsByContract.set(r.contract_number, []).get(r.contract_number)!).push(r);

// ---- contracts

interface RawContract {
  contract_id: string;
  cooperative: string;
  contract_number: string | null;
  supplier_id: string;
  supplier_name: string;
  title: string;
  start_date: string | null;
  end_date: string | null;
  category_labels?: string[];
  regions_as_published?: string[];
  contract_url: string;
  lead_agency?: string | null;
  source_metadata?: Record<string, unknown>;
}
const contractId = (number: string) => `con_nj_${number.replace(/[^A-Za-z0-9-]/g, "")}`;
const contracts: RawContract[] = [];
const stats = { internal: 0, contracts: 0, open_to_locals: 0, state_only: 0, with_prices: 0, priced_lines: 0, lines: items.length, dropped: { no_price: 0, no_name: 0, not_orderable: 0, index_markup: 0, placeholder: 0, discount: 0, percent: 0, unverified: 0 }, documents: 0, spent_to_date: 0, groups: {} as Record<string, number> };
for (const r of contractsCsv) {
  const number = r["Contract #"].trim();
  // The state as its own vendor is an internal transfer, not a contract anyone can buy on.
  if (/^state of new jersey$/i.test(r["Vendor"].trim())) {
    stats.internal++;
    continue;
  }
  const d = details.get(number);
  const { t, title } = splitTitle(r["Description"]);
  const lines = itemsByContract.get(number) ?? [];
  const nigp = lines.map((l) => l.nigp_code).filter(Boolean);
  const nigpLabels = [...new Set(lines.map((l) => l.nigp_description.trim()).filter(Boolean))];
  const group = d?.group ?? null;
  const locals = Boolean(d?.nj_coop && d?.coop_allowed);
  const spent = money(r["Dollars Spent to Date"]);
  stats.contracts++;
  locals ? stats.open_to_locals++ : stats.state_only++;
  stats.spent_to_date += spent ?? 0;
  const g = groupName(group) ?? "Other";
  stats.groups[g] = (stats.groups[g] ?? 0) + 1;
  contracts.push({
    contract_id: contractId(number),
    cooperative: COOP,
    contract_number: number,
    supplier_id: supplierFor(r["Vendor"]),
    supplier_name: r["Vendor"].trim(),
    title,
    start_date: usDate(r["Begin Date"]),
    end_date: usDate(r["End Date"]),
    category_labels: [...new Set([groupName(group), ...nigpLabels].filter((x): x is string => Boolean(x)))],
    regions_as_published: ["New Jersey"],
    contract_url: r["Contract URL"],
    lead_agency: r["Organization"] === "Division of Purchase and Property" ? "State of New Jersey, Division of Purchase and Property" : `State of New Jersey, ${r["Organization"]}`,
    source_metadata: {
      state_contract: {
        state: "NJ",
        locals,
        solicitation: t ?? d?.t_number ?? null,
        bid_solicitation: r["Bid Solicitation #"] || null,
        type_code: r["Type Code"] || d?.type_code || null,
        group: groupName(group),
      },
      category: categoryFor(group, nigp),
      payment_terms: d?.payment_terms ?? null,
      shipping_terms: d?.shipping_terms ?? null,
      days_aro: d?.days_aro ?? null,
      green: d?.green ?? false,
      set_aside: d?.set_aside ?? null,
      spent_to_date: spent,
      line_items_paginated: r["Line Items May Be Paginated"] === "Yes",
      // NIGP commodity codes as NJSTART publishes them on the contract's line items ("490-90").
      nigp: [...new Set(nigp.map(normNigp).filter((x): x is string => Boolean(x)))].sort(),
    },
  });
}

// ---- products and offerings: the priced line items

/** A readable product name from a line's description, plus the brand and model it names. */
function productOf(desc: string): { name: string; brand: string | null; model: string | null } {
  let d = desc.replace(/\r/g, "");
  // The brand stops at a comma or the next label ("Galion Model: ..." is the brand Galion).
  const brandRaw = d.match(/Brand(?: Name)?:\s*([^\n;,]+?)(?=\s{2,}|\n|;|,|\.\s|\s+(?:Model|Make|Mfg|Manufacturer|Installer)\b|$)/i)?.[1]?.trim() || null;
  const brand = brandRaw?.replace(/\s+(?:Product Name|or|and)(?:\s+or)?$/i, "").trim() || null;
  const modelRaw = d.match(/Model(?: Number| #)?:\s*([^\n;]+?)(?:\s{2,}|\n|;|$)/i)?.[1]?.trim() || null;
  // A part number, not a sentence.
  const model = modelRaw && !/:/.test(modelRaw) && modelRaw.split(/\s+/).length <= 3 ? modelRaw : null;
  // The price-sheet scaffolding before the description itself.
  d = d
    .replace(/^.*?from the (?:Bid Solicitation )?State-Supplied Price Sheet\s*\n?\s*Description:\s*/is, "")
    .replace(/^(?:Bid Solicitation\s+)?(?:Price Line|PL|Price line|PRICE LINE)(?:\/Category)?\s*#?\s*[\d.]+[A-Z]?(?:\s+from the Bid Solicitation)?\s*[:.,-]?\s*/i, "")
    .replace(/^(?:Group|Category|Section)\s*[\d.]+[A-Z]?\s*[,-]\s*(?:Price Line\s*#?\s*\d+\s*[:,-]?\s*)?/i, "")
    .replace(/^Item\s*#?\s*\d+\s*[:.-]\s*/i, "")
    .replace(/^[TM]-?\d{3,5}\s+Section\s+\d+,\s*/i, "")
    .replace(/^Price Line\s*#?\s*\d*\s*[-:]\s*/i, "")
    .replace(/\s*-?\s*(?:Bid Solicitation\s+)?(?:Price\s+)?Line\s*#\s*\d+[.:]?\s*/gi, " - ")
    .replace(/,?\s*Price Line:\s*\d+[A-Z]?/gi, "")
    .replace(/^(?:Category\s*[\w.]+,\s*)?(?:Price Line\s*[\d.]+\s+)?from the (?:Bid Solicitation )?State-Supplied Price Sheet\s*[-:.]?\s*(?:Equivalent Brand )?(?:Description:)?\s*/i, "")
    .replace(/^\s*-\s*/, "");
  // The first paragraph, before brand, delivery and award notes.
  d = d.split(/\n\s*\n|\s(?:Brand(?: Name)?|Award Ranking|ARO|Model Number|Manufacturer|DSS #)\s*:|[.;]?\s+Delivery Days\b/i)[0];
  d = d.replace(/\s+/g, " ").replace(/[\s.;,:-]+$/, "").trim();
  if (d.length > 160) d = d.slice(0, 160).replace(/\s+\S*$/, "") + "…";
  return { name: tidyCaps(d), brand: brand && brand.length <= 60 ? tidyCaps(brand) : null, model: model && model.length <= 40 ? model : null };
}
const UNIT: Record<string, string> = { EA: "each", HOUR: "hour", HR: "hour", HRATE: "hour", CASE: "case", GAL: "gallon", LOT: "lot", TASK: "task", MO: "month", DAY: "day", LB: "pound", SQFT: "square foot", MILE: "mile", YR: "year", TON: "ton", CWT: "hundredweight", LFT: "linear foot", PAGE: "page", SQYD: "square yard", KWH: "kWh", NET: "net", WK: "week", BX: "box", PK: "pack", DZ: "dozen", PR: "pair", RL: "roll", FT: "foot", YD: "yard", CY: "cubic yard", EACH: "each" };
const unitOf = (u: string) => {
  const code = u.split(/\s*-\s*/)[0].trim();
  if (/^thousand$/i.test(code)) return "thousand";
  return UNIT[code.toUpperCase()] ?? ((u.split(/\s*-\s*/)[1] ?? code).toLowerCase() || null);
};
const isPlaceholder = (price: number, desc: string) => price <= 0.01 || (price === 1 && /refer|price sheet|attach|see |per the|schedule/i.test(desc));

interface RawProduct { product_id: string; product_name: string; manufacturer?: string | null; manufacturer_sku?: string | null; record_type: string; title_conflict_requires_review: boolean }
interface RawOffering { offering_id: string; product_id: string; supplier_id: string; contract_id: string; cooperative: string; product_name: string; vendor_sku?: string | null; source_url: string; fixed_price: number | null; discount_percent: number | null; pricing_status: string; unit_of_measure?: string | null; source_metadata?: Record<string, unknown> }
const products = new Map<string, RawProduct>();
const offerings: RawOffering[] = [];
const contractByNumber = new Map(contracts.map((c) => [c.contract_number!, c]));
const pricedContracts = new Set<string>();
const seenLine = new Set<string>();
for (const r of items) {
  const c = contractByNumber.get(r.contract_number);
  if (!c) continue;
  const key = `${r.contract_number}|${r.item_number}|${r.print_sequence}`;
  if (seenLine.has(key)) continue;
  seenLine.add(key);
  const raw = r.unit_cost.trim();
  const price = raw ? Number(raw) : NaN;
  if (!raw || !Number.isFinite(price) || price <= 0) {
    stats.dropped.no_price++;
    continue;
  }
  if (/not orderable/i.test(r.description)) {
    stats.dropped.not_orderable++;
    continue;
  }
  if (/^PCNT/i.test(r.uom)) {
    stats.dropped.percent++;
    continue;
  }
  if (Number(r.discount_percent || 0) > 0) {
    stats.dropped.discount++;
    continue;
  }
  // Bulk fuel is bid as a markup over a daily index (OPIS rack prices): $0.18 a gallon is the
  // markup, not the price of fuel, and the line doesn't say what the index is.
  if (/^GAL/i.test(r.uom) && price < 2 && /octane|diesel|gasoline|propane|heating oil|kerosene|fuel|OPIS/i.test(r.description)) {
    stats.dropped.index_markup++;
    continue;
  }
  if (isPlaceholder(price, r.description)) {
    stats.dropped.placeholder++;
    continue;
  }
  // Never a price the page didn't print: the unit cost must be in the line's own text.
  const line = r.source_item_text.replace(/\s+/g, " ").trim();
  if (!line.includes(` ${raw} `)) {
    stats.dropped.unverified++;
    continue;
  }
  const p = productOf(r.description);
  if (!p.name || p.name.length < 3) {
    stats.dropped.no_name++;
    continue;
  }
  const meta = c.source_metadata as { state_contract: { solicitation: string | null } };
  const pkey = `${p.brand ?? ""}|${p.name}`.toLowerCase();
  const pid = `prd_nj_${hash(pkey)}`;
  if (!products.has(pid)) products.set(pid, { product_id: pid, product_name: p.name, manufacturer: p.brand, manufacturer_sku: p.model, record_type: "awarded_line_item", title_conflict_requires_review: false });
  const term = c.start_date && c.end_date ? `${longDate(c.start_date)} to ${longDate(c.end_date)}` : "term not published";
  offerings.push({
    offering_id: `off_nj_${hash(key)}`,
    product_id: pid,
    supplier_id: c.supplier_id,
    contract_id: c.contract_id,
    cooperative: COOP,
    product_name: p.name,
    vendor_sku: p.model,
    source_url: c.contract_url,
    fixed_price: price,
    discount_percent: null,
    pricing_status: "published_price",
    unit_of_measure: unitOf(r.uom),
    source_metadata: {
      document_vintage: `NJSTART awarded contract price, contract term ${term}; read from NJSTART ${longDate(retrieved)}`,
      category_as_published: `${meta.state_contract.solicitation ? `${meta.state_contract.solicitation} ` : ""}${c.title}: awarded price, NJSTART item ${r.item_number}`,
      basis: "awarded_bid",
      nigp: normNigp(r.nigp_code),
      line: line.slice(0, 600),
    },
  });
  pricedContracts.add(c.contract_id);
  stats.priced_lines++;
}
stats.with_prices = pricedContracts.size;

// ---- documents: each contract's attachments on NJSTART

interface RawDocument { document_id: string; cooperative: string; url: string; label: string; contract_id: string }
const documents: RawDocument[] = [];
const seenDoc = new Set<string>();
for (const a of attachments) {
  const c = contractByNumber.get(a.contract_number);
  if (!c || !a.file_url) continue;
  const k = `${c.contract_id}|${a.file_id}`;
  if (seenDoc.has(k)) continue;
  seenDoc.add(k);
  documents.push({ document_id: `doc_nj_${hash(k)}`, cooperative: COOP, url: a.file_url, label: a.attachment_name.replace(/\s+/g, " ").trim() || "Contract document", contract_id: c.contract_id });
}
// Each contract's own summary page (header, terms, items), held as text (npm run import:doctext).
for (const c of contracts) documents.push({ document_id: `doc_nj_${hash(`${c.contract_id}|summary`)}`, cooperative: COOP, url: c.contract_url, label: "NJSTART contract summary page", contract_id: c.contract_id });
stats.documents = documents.length;

// ------------------------------------------------------------------ write

const records = { retrieved, suppliers: [...suppliers.values()], contracts, products: [...products.values()], offerings, documents };
writeFileSync(join(OUT, "records.json.gz"), gzipSync(JSON.stringify(records), { level: 9 }));
const summary = {
  source: "https://www.njstart.gov/bso/view/search/external/advancedSearchContractBlanket.xhtml?view=activeContracts",
  retrieved,
  ...stats,
  spent_to_date: Math.round(stats.spent_to_date),
  suppliers: suppliers.size,
  products: products.size,
  groups: Object.fromEntries(Object.entries(stats.groups).sort((a, b) => b[1] - a[1])),
  note: "Line items are the first summary page of each contract; contracts with more item pages are flagged line_items_paginated. Attachments are linked, not downloaded.",
};
writeFileSync(join(OUT, "summary.json"), JSON.stringify(summary, null, 1) + "\n");

// The NIGP codes NJSTART's public records use, with the description the state prints beside each.
// Agora has no licensed NIGP codebook: this is the list it can name, and the list review agents
// choose classes from when tagging the co-ops' contracts (scripts/cleanup).
{
  const codes = new Map<string, { description: string; lines: number; contracts: Set<string> }>();
  for (const r of items) {
    const code = normNigp(r.nigp_code);
    if (!code) continue;
    const x = codes.get(code) ?? { description: r.nigp_description.replace(/\s+/g, " ").trim(), lines: 0, contracts: new Set<string>() };
    x.lines++;
    x.contracts.add(r.contract_number);
    codes.set(code, x);
  }
  const classes: Record<string, { items: string[]; contracts: number }> = {};
  for (const [code, x] of [...codes].sort(([a], [b]) => a.localeCompare(b))) {
    const k = code.slice(0, 3);
    (classes[k] ??= { items: [], contracts: 0 }).items.push(`${code} ${x.description}`);
  }
  for (const k of Object.keys(classes)) classes[k].contracts = new Set([...codes].filter(([c]) => c.startsWith(k)).flatMap(([, x]) => [...x.contracts])).size;
  writeFileSync(
    join(OUT, "nigp.json"),
    JSON.stringify(
      {
        source: "NIGP codes and descriptions as printed on NJSTART's public contract pages",
        retrieved,
        codes: Object.fromEntries([...codes].sort(([a], [b]) => a.localeCompare(b)).map(([c, x]) => [c, { description: x.description, lines: x.lines, contracts: x.contracts.size }])),
        classes,
      },
      null,
      1,
    ) + "\n",
  );
  console.log(`NIGP: ${codes.size} codes in ${Object.keys(classes).length} classes.`);
}
console.log(JSON.stringify(summary, null, 1));
