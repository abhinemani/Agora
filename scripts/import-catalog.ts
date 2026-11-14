// Builds Agora's co-op contract catalog from the cooperative catalog capture of
// November 13, 2026 (seed/catalog/source/*.jsonl.gz: 13 co-ops' public contract
// directories, supplier lists, product tables and price documents).
//
//   npm run import:catalog
//
// Writes, all server-only (lib/catalog.ts):
//   seed/catalog/catalog.json.gz   suppliers (merged into one record per company),
//                                  contracts, products, offerings and documents
//   seed/catalog/insights.json     the numbers behind the catalog section of /data
//   seed/catalog/reconcile.json    where the catalog confirms or corrects Agora's
//                                  seeded co-op contracts; seed() applies the fixes
//
// Nothing here makes a contract buyable in Agora: catalog contracts link out to the
// co-op, prices are shown with their source and vintage, and eligibility is not assumed.

process.env.AGORA_SKIP_CATALOG_CORRECTIONS = "1";

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync, gzipSync } from "node:zlib";
import { coopIdForVehicle, normalizeDomain } from "../lib/coops";
import { seed } from "../lib/seed";
import { STATES } from "../lib/vehicles";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "seed/catalog/source");
const RETRIEVED = "2026-11-13";

const jsonl = <T,>(name: string): T[] =>
  gunzipSync(readFileSync(join(SRC, `${name}.jsonl.gz`)))
    .toString("utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as T);

interface RawSupplier {
  supplier_id: string;
  name: string;
  name_variants: string[];
  cooperatives: string[];
  websites?: string[];
}
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
  SINs?: string[];
  source_metadata?: Record<string, unknown>;
}
interface RawProduct {
  product_id: string;
  product_name: string;
  manufacturer?: string | null;
  manufacturer_sku?: string | null;
  record_type: string;
  title_conflict_requires_review: boolean;
}
interface RawOffering {
  offering_id: string;
  product_id: string;
  supplier_id: string;
  contract_id: string;
  cooperative: string;
  product_name: string;
  vendor_sku?: string | null;
  source_url: string;
  fixed_price: number | null;
  discount_percent: number | null;
  pricing_status: string;
  unit_of_measure?: string | null;
  source_metadata?: Record<string, unknown>;
}
interface RawDocument {
  document_id: string;
  cooperative: string;
  url: string;
  label: string;
  contract_id: string;
}

const rawSuppliers = jsonl<RawSupplier>("suppliers");
const rawContracts = jsonl<RawContract>("contracts");
const rawProducts = jsonl<RawProduct>("products");
const rawOfferings = jsonl<RawOffering>("offerings");
const rawDocuments = jsonl<RawDocument>("documents");

// ------------------------------------------------------------------ co-ops

/** The catalog's program names, as Agora's co-op ids. GSA isn't a co-op: it gets its own lane. */
const COOP_ID: Record<string, string> = {
  Sourcewell: "coop_sourcewell",
  TIPS: "coop_tips",
  "OMNIA Partners": "coop_omnia",
  BuyBoard: "coop_buyboard",
  HGACBuy: "coop_hgacbuy",
  "E&I": "coop_eandi",
  "Equalis Group": "coop_equalis",
  "1GPA": "coop_1gpa",
  "Choice Partners": "coop_choice",
  NPPGov: "coop_nppgov",
  PEPPM: "coop_peppm",
  "NASPO ValuePoint": "coop_naspo",
  "GSA MAS": "gsa_mas",
};

// ------------------------------------------------------------------ suppliers: one record per company

/** "Tyler Technologies, Inc." and "Tyler Technologies" → "tylertechnologies"; "CDW-G" and "CDWG" → "cdwg". */
const LEGAL = /\b(incorporated|inc|llc|l l c|corp|corporation|co|company|ltd|limited|lp|llp|plc|pllc|pc|the|dba|d b a)\b/g;
function supplierKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[.,]/g, " ")
    .replace(LEGAL, " ")
    .replace(/[^a-z0-9]/g, "");
}
/** The brand in "PlayCore Wisconsin, Inc. dba GameTime". */
const dbaOf = (name: string) => name.match(/\bd\/?b\/?a\b\.?\s+(.+)$/i)?.[1]?.trim() ?? null;

/** A company website, or nothing when the "website" is a platform or a co-op's own page. */
const NOT_A_COMPANY = /(^|\.)(gsa\.gov|gsaadvantage\.gov|tips-usa\.com|peppm\.org|sourcewell(-mn)?\.(gov|org)|omniapartners\.com|naspovaluepoint\.org|buyboard\.com|hgacbuy\.org|equalisgroup\.org|1gpa\.org|choicepartners\.org|nppgov\.com|eandi\.org|facebook\.com|linkedin\.com|google\.com|gmail\.com|yahoo\.com|outlook\.com|wixsite\.com|squarespace\.com|godaddysites\.com)$/;
const site = (w: string) => {
  const d = normalizeDomain(w).replace(/:\d+$/, "");
  return d.includes(".") && !NOT_A_COMPANY.test(d) ? d : "";
};

// Union-find over the raw supplier records.
const parent = new Map<string, string>();
const find = (x: string): string => {
  let r = x;
  while (parent.get(r) !== r) r = parent.get(r)!;
  let c = x;
  while (parent.get(c) !== r) {
    const n = parent.get(c)!;
    parent.set(c, r);
    c = n;
  }
  return r;
};
const union = (a: string, b: string) => {
  const ra = find(a);
  const rb = find(b);
  if (ra !== rb) parent.set(ra < rb ? rb : ra, ra < rb ? ra : rb);
};
for (const s of rawSuppliers) parent.set(s.supplier_id, s.supplier_id);

const byKey = new Map<string, string[]>();
const byDomain = new Map<string, string[]>();
for (const s of rawSuppliers) {
  for (const n of new Set([s.name, ...s.name_variants])) {
    const k = supplierKey(n);
    if (k.length >= 3) (byKey.get(k) ?? byKey.set(k, []).get(k)!).push(s.supplier_id);
  }
  for (const w of s.websites ?? []) {
    const d = site(w);
    if (d) (byDomain.get(d) ?? byDomain.set(d, []).get(d)!).push(s.supplier_id);
  }
}
let mergedByName = 0;
let mergedByWebsite = 0;
for (const ids of byKey.values()) for (const id of ids.slice(1)) if (find(id) !== find(ids[0])) (union(ids[0], id), mergedByName++);
// A website shared by a handful of records is one company; one shared by dozens is a reseller network or a portal.
for (const ids of byDomain.values()) {
  const distinct = [...new Set(ids)];
  if (distinct.length > 6) continue;
  for (const id of distinct.slice(1)) if (find(id) !== find(distinct[0])) (union(distinct[0], id), mergedByWebsite++);
}

interface Supplier {
  id: string;
  name: string;
  aliases: string[];
  websites: string[];
  coops: string[];
  contracts: number;
  products: number;
}
const groups = new Map<string, RawSupplier[]>();
for (const s of rawSuppliers) (groups.get(find(s.supplier_id)) ?? groups.set(find(s.supplier_id), []).get(find(s.supplier_id))!).push(s);
const contractsBySupplier = new Map<string, number>();
for (const c of rawContracts) contractsBySupplier.set(c.supplier_id, (contractsBySupplier.get(c.supplier_id) ?? 0) + 1);
const offeringsBySupplier = new Map<string, number>();
for (const o of rawOfferings) offeringsBySupplier.set(o.supplier_id, (offeringsBySupplier.get(o.supplier_id) ?? 0) + 1);

/** A readable name: mixed case over ALL CAPS, the brand over the legal entity's suffixes, the most-used spelling. */
function displayName(rs: RawSupplier[]): string {
  const votes = new Map<string, number>();
  for (const s of rs) for (const n of new Set([s.name, ...s.name_variants])) votes.set(n, (votes.get(n) ?? 0) + (contractsBySupplier.get(s.supplier_id) ?? 0) + 1);
  return [...votes.entries()].sort((a, b) => Number(/[a-z]/.test(b[0])) - Number(/[a-z]/.test(a[0])) || b[1] - a[1] || a[0].length - b[0].length)[0][0];
}

const supplierOf = new Map<string, string>(); // raw supplier id → catalog supplier id
const suppliers: Supplier[] = [];
for (const [root, rs] of groups) {
  const id = `cat_${root.replace(/^sup_/, "")}`;
  for (const s of rs) supplierOf.set(s.supplier_id, id);
  const name = displayName(rs);
  const names = new Set(rs.flatMap((s) => [s.name, ...s.name_variants]));
  for (const n of [...names]) {
    const brand = dbaOf(n);
    if (brand) names.add(brand);
  }
  suppliers.push({
    id,
    name,
    aliases: [...names].filter((n) => n !== name).slice(0, 8),
    websites: [...new Set(rs.flatMap((s) => (s.websites ?? []).map(site)).filter(Boolean))].slice(0, 4),
    coops: [...new Set(rs.flatMap((s) => s.cooperatives))].sort(),
    contracts: rs.reduce((n, s) => n + (contractsBySupplier.get(s.supplier_id) ?? 0), 0),
    products: rs.reduce((n, s) => n + (offeringsBySupplier.get(s.supplier_id) ?? 0), 0),
  });
}

// ------------------------------------------------------------------ contracts

const STATE_BY_NAME = new Map(STATES.map(([c, n]) => [n.toLowerCase(), c]));
const STATE_CODES = new Set(STATES.map(([c]) => c));
/** Published regions as state codes, or "any" for nationwide. Empty when the co-op doesn't say. */
function statesOf(regions: string[] | undefined): string[] | "any" {
  const out = new Set<string>();
  for (const r of regions ?? []) {
    if (/all states|nationwide|national|united states/i.test(r)) return "any";
    for (const part of r.split(/\s*,\s*/)) {
      const p = part.trim();
      const code = STATE_CODES.has(p.toUpperCase()) ? p.toUpperCase() : STATE_BY_NAME.get(p.toLowerCase());
      if (code) out.add(code);
    }
  }
  // A co-op that lists every state one by one (Equalis) means nationwide.
  if (out.size >= 50) return "any";
  return [...out].sort();
}

// A link that every contract shares is a directory page, not the contract.
const urlUses = new Map<string, number>();
for (const c of rawContracts) urlUses.set(c.contract_url, (urlUses.get(c.contract_url) ?? 0) + 1);

interface Contract {
  id: string;
  supplier: string;
  coop: string;
  coop_id: string;
  number: string;
  title: string;
  categories: string[];
  start: string | null;
  end: string | null;
  states: string[] | "any";
  lead: string | null;
  url: string | null;
  directory: string | null;
  sins: string[];
  renewal: string | null;
}
const contracts: Contract[] = rawContracts.map((c) => {
  const meta = c.source_metadata ?? {};
  return {
    id: c.contract_id,
    supplier: supplierOf.get(c.supplier_id)!,
    coop: c.cooperative,
    coop_id: COOP_ID[c.cooperative] ?? "",
    number: c.contract_number ?? "",
    title: c.title.trim(),
    categories: [...new Set([...(c.category_labels ?? []), typeof meta.portfolio_name === "string" ? meta.portfolio_name : ""].filter(Boolean))],
    start: c.start_date?.slice(0, 10) ?? null,
    end: c.end_date?.slice(0, 10) ?? null,
    states: statesOf(c.regions_as_published),
    lead: c.lead_agency ?? null,
    url: (urlUses.get(c.contract_url) ?? 0) <= 3 ? c.contract_url : null,
    directory: (urlUses.get(c.contract_url) ?? 0) > 3 ? c.contract_url : null,
    sins: c.SINs ?? [],
    renewal: typeof meta.renewal_limit === "string" ? meta.renewal_limit.slice(0, 10) : null,
  };
});
const contractById = new Map(contracts.map((c) => [c.id, c]));

// ------------------------------------------------------------------ products and offerings

interface Offering {
  id: string;
  product: string;
  supplier: string;
  contract: string;
  coop: string;
  sku: string | null;
  price: number | null;
  list: number | null;
  discount: number | null;
  status: "published_price" | "published_discount" | "member_login" | "quote";
  vintage: string | null;
  unit: string | null;
  url: string;
  category: string | null;
}
const offerings: Offering[] = rawOfferings.map((o) => {
  const meta = o.source_metadata ?? {};
  const s = o.pricing_status;
  return {
    id: o.offering_id,
    product: o.product_id,
    supplier: supplierOf.get(o.supplier_id)!,
    contract: o.contract_id,
    coop: o.cooperative,
    sku: o.vendor_sku ?? null,
    price: o.fixed_price,
    list: typeof meta.MSRP === "number" ? meta.MSRP : null,
    discount: o.discount_percent,
    status: o.fixed_price != null ? "published_price" : o.discount_percent != null ? "published_discount" : /member_login/.test(s) ? "member_login" : "quote",
    vintage: typeof meta.document_vintage === "string" ? meta.document_vintage : null,
    unit: o.unit_of_measure ?? null,
    url: o.source_url,
    category: typeof meta.category_as_published === "string" ? meta.category_as_published : null,
  };
});
const usedProducts = new Set(offerings.map((o) => o.product));
const products = rawProducts
  .filter((p) => usedProducts.has(p.product_id))
  .map((p) => ({ id: p.product_id, name: p.product_name, maker: p.manufacturer ?? null, mpn: p.manufacturer_sku ?? null, review: p.title_conflict_requires_review }));

// ------------------------------------------------------------------ documents: the price-list reader's queue

const documents = rawDocuments.map((d) => {
  const ext = (d.url.toLowerCase().match(/\.(pdf|xlsx|xls|csv|docx|htm|html)(?:[?#]|$)/) ?? [])[1] ?? "unknown";
  return { id: d.document_id, contract: d.contract_id, coop: d.cooperative, url: d.url, label: d.label, kind: ext === "html" ? "htm" : ext };
});

const catalog = { version: 1, retrieved: RETRIEVED, suppliers, contracts, products, offerings, documents };
mkdirSync(join(ROOT, "seed/catalog"), { recursive: true });
writeFileSync(join(ROOT, "seed/catalog/catalog.json.gz"), gzipSync(JSON.stringify(catalog), { level: 9 }));

// ------------------------------------------------------------------ reconcile with Agora's seed

interface Correction {
  contract_id: string;
  label: string;
  field: "end" | "start" | "contract_number" | "states" | "source_url";
  agora: string;
  catalog: string;
  action: "apply" | "flag";
  note: string;
  catalog_contract: string;
}
const db = seed();
const corrections: Correction[] = [];
const confirmations: { contract_id: string; label: string; catalog_contract: string }[] = [];
const numKey = (n: string) => n.toUpperCase().replace(/[^A-Z0-9]/g, "");
const nameKey = (n: string) => supplierKey(n).slice(0, 6);
/** "Dell Technologies" and "Dell Marketing, LP"; "CDW Government" and "CDW-G". */
const firstWord = (n: string) => n.toLowerCase().match(/[a-z]{3,}/)?.[0] ?? "";
const catalogByCoopNumber = new Map<string, Contract[]>();
for (const c of contracts) {
  const k = `${c.coop_id}|${numKey(c.number)}`;
  (catalogByCoopNumber.get(k) ?? catalogByCoopNumber.set(k, []).get(k)!).push(c);
}
const supplierName = new Map(suppliers.map((s) => [s.id, [s.name, ...s.aliases]]));

for (const a of db.contracts) {
  const coopId = a.coop_id ?? coopIdForVehicle(a.vehicle);
  if (!coopId || a.source !== "coop_contract") continue;
  const vendor = db.suppliers.find((s) => s.id === a.supplier_id)?.name ?? "";
  const label = `${a.vehicle ?? a.owner} ${a.contract_number} (${vendor})`;
  const sameVendor = (c: Contract) => (supplierName.get(c.supplier) ?? []).some((n) => nameKey(n) === nameKey(vendor) || firstWord(n) === firstWord(vendor));
  let match = (catalogByCoopNumber.get(`${coopId}|${numKey(a.contract_number)}`) ?? []).find(sameVendor);
  // Same co-op, same supplier, same portfolio, different number: the number in Agora is the one to check.
  if (!match) {
    const portfolio = a.title.split(":")[0].toLowerCase().slice(0, 18);
    match = contracts.find((c) => c.coop_id === coopId && sameVendor(c) && c.title.toLowerCase().startsWith(portfolio));
    if (match)
      corrections.push({
        contract_id: a.id,
        label,
        field: "contract_number",
        agora: a.contract_number,
        catalog: match.number,
        action: "apply",
        note: `${match.coop}'s own supplier index lists ${vendor}${vendor.endsWith("s") ? "'" : "'s"} ${match.title.split(",")[0]} award as ${match.number}.`,
        catalog_contract: match.id,
      });
  }
  if (!match) continue;
  confirmations.push({ contract_id: a.id, label, catalog_contract: match.id });
  if (match.end && match.end !== a.end)
    corrections.push({ contract_id: a.id, label, field: "end", agora: a.end || "(none)", catalog: match.end, action: a.end ? "flag" : "apply", note: a.end ? "Dates disagree; Agora's date is kept until checked." : "End date from the co-op's contract list.", catalog_contract: match.id });
  if (match.start && !a.start)
    corrections.push({ contract_id: a.id, label, field: "start", agora: "(none)", catalog: match.start, action: "apply", note: "Start date from the co-op's contract list.", catalog_contract: match.id });
  const agoraStates = a.eligibility?.states;
  if (match.states !== "any" && match.states.length && coopId === "coop_naspo") {
    if (agoraStates === "any")
      corrections.push({ contract_id: a.id, label, field: "states", agora: "any state", catalog: match.states.join(", "), action: "apply", note: "NASPO ValuePoint lists the states with a participating addendum.", catalog_contract: match.id });
    else if (Array.isArray(agoraStates)) {
      const only = match.states.filter((s) => !agoraStates.includes(s));
      const missing = agoraStates.filter((s) => !(match!.states as string[]).includes(s));
      if (only.length || missing.length)
        corrections.push({
          contract_id: a.id,
          label,
          field: "states",
          agora: agoraStates.join(", "),
          catalog: match.states.join(", "),
          action: "flag",
          note: `${only.length ? `Catalog adds ${only.join(", ")}. ` : ""}${missing.length ? `Catalog omits ${missing.join(", ")}. ` : ""}Agora keeps the list it read from NASPO directly.`,
          catalog_contract: match.id,
        });
    }
  }
  // A shared vendor-list PDF isn't the contract, and neither is a document carrying the old number; the co-op's supplier page is.
  const sharedUrl = db.contracts.filter((x) => x.source_url && x.source_url === a.source_url).length > 1;
  const renumbered = corrections.some((c) => c.contract_id === a.id && c.field === "contract_number");
  if (match.url && (sharedUrl || !a.source_url || renumbered))
    corrections.push({ contract_id: a.id, label, field: "source_url", agora: a.source_url ?? "(none)", catalog: match.url, action: "apply", note: "The co-op's page for this contract, in place of a link shared by several contracts.", catalog_contract: match.id });
}
writeFileSync(join(ROOT, "seed/catalog/reconcile.json"), JSON.stringify({ retrieved: RETRIEVED, confirmations, corrections }, null, 1) + "\n");

// ------------------------------------------------------------------ insights

const today = RETRIEVED;
const perCoop = Object.keys(COOP_ID).map((co) => {
  const cs = contracts.filter((c) => c.coop === co);
  return {
    coop: co,
    coop_id: COOP_ID[co],
    contracts: cs.length,
    suppliers: new Set(cs.map((c) => c.supplier)).size,
    with_link: cs.filter((c) => c.url).length,
    with_end: cs.filter((c) => c.end).length,
    expired: cs.filter((c) => c.end && c.end < today).length,
    with_states: cs.filter((c) => c.states === "any" || c.states.length).length,
    offerings: offerings.filter((o) => o.coop === co).length,
  };
});
const multiCoop = suppliers.filter((s) => s.coops.filter((c) => c !== "GSA MAS").length >= 2);
const insights = {
  retrieved: RETRIEVED,
  source_counts: { suppliers: rawSuppliers.length, contracts: rawContracts.length, products: rawProducts.length, offerings: rawOfferings.length, documents: rawDocuments.length },
  suppliers: {
    records: rawSuppliers.length,
    companies: suppliers.length,
    merged_by_name: mergedByName,
    merged_by_website: mergedByWebsite,
    with_website: suppliers.filter((s) => s.websites.length).length,
    on_two_or_more_coops: multiCoop.length,
    most_coops: [...multiCoop].sort((a, b) => b.coops.length - a.coops.length || b.contracts - a.contracts).slice(0, 12).map((s) => ({ id: s.id, name: s.name, coops: s.coops, contracts: s.contracts })),
    merge_examples: suppliers.filter((s) => s.aliases.length >= 2 && s.coops.length >= 3).slice(0, 8).map((s) => ({ name: s.name, aliases: s.aliases.slice(0, 3) })),
  },
  per_coop: perCoop,
  products: {
    products: products.length,
    offerings: offerings.length,
    by_status: offerings.reduce<Record<string, number>>((m, o) => ((m[o.status] = (m[o.status] ?? 0) + 1), m), {}),
    priced_suppliers: [...new Set(offerings.filter((o) => o.status === "published_price").map((o) => o.supplier))].map((id) => suppliers.find((s) => s.id === id)?.name),
    multi_route: Object.values(offerings.reduce<Record<string, Set<string>>>((m, o) => ((m[o.product] ??= new Set()).add(o.contract), m), {})).filter((s) => s.size > 1).length,
  },
  documents: {
    total: documents.length,
    by_kind: documents.reduce<Record<string, number>>((m, d) => ((m[d.kind] = (m[d.kind] ?? 0) + 1), m), {}),
    by_coop: documents.reduce<Record<string, number>>((m, d) => ((m[d.coop] = (m[d.coop] ?? 0) + 1), m), {}),
  },
  reconcile: {
    confirmed: confirmations.length,
    applied: corrections.filter((c) => c.action === "apply").length,
    flagged: corrections.filter((c) => c.action === "flag").length,
  },
};
writeFileSync(join(ROOT, "seed/catalog/insights.json"), JSON.stringify(insights, null, 1) + "\n");

console.log(`Suppliers: ${rawSuppliers.length.toLocaleString()} records → ${suppliers.length.toLocaleString()} companies (${mergedByName} merged by name, ${mergedByWebsite} by website); ${multiCoop.length.toLocaleString()} on 2+ co-ops.`);
console.log(`Contracts: ${contracts.length.toLocaleString()}; ${contracts.filter((c) => c.url).length.toLocaleString()} with their own link; ${contracts.filter((c) => c.end && c.end < today).length} expired.`);
console.log(`Products: ${products.length.toLocaleString()} in ${offerings.length.toLocaleString()} offerings ${JSON.stringify(insights.products.by_status)}; ${insights.products.multi_route} on 2+ contracts.`);
console.log(`Documents: ${documents.length.toLocaleString()} ${JSON.stringify(insights.documents.by_kind)}.`);
console.log(`Reconcile: ${confirmations.length} seeded contracts found; ${insights.reconcile.applied} fixes to apply, ${insights.reconcile.flagged} flagged.`);
for (const c of corrections) console.log(`  ${c.action.padEnd(5)} ${c.label} ${c.field}: ${c.agora} → ${c.catalog}`);
