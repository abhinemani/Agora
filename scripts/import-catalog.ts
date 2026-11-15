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

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync, gzipSync } from "node:zlib";
import { coopIdForVehicle, normalizeDomain } from "../lib/coops";
import { seed } from "../lib/seed";
import { STATES } from "../lib/vehicles";
import { STASH_REASONS, stashReason, type StashReason } from "./product-stash";
import { productKindKey, type KindRole } from "./product-kind";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "seed/catalog/source");
const RETRIEVED = "2026-11-13";

const jsonl = <T,>(name: string): T[] =>
  gunzipSync(readFileSync(join(SRC, `${name}.jsonl.gz`)))
    .toString("utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as T);

/** AI-reviewed decisions (scripts/cleanup), checked against their items by collect.ts. Low confidence isn't applied. */
function reviewed<T extends { confidence: string }>(name: string): Record<string, T> {
  const path = join(ROOT, "seed/cleanup/decisions", `${name}.json`);
  if (!existsSync(path)) return {};
  const all = JSON.parse(readFileSync(path, "utf8")) as Record<string, T>;
  return Object.fromEntries(Object.entries(all).filter(([, d]) => d.confidence !== "low"));
}
const supplierMerges = reviewed<{ merge: string[][]; confidence: string }>("supplier-merge");
const categoryPicks = reviewed<{ pick: string; confidence: string }>("category");
const canonRows = reviewed<{ name: string | null; sku: string | null; list: number | null; discount: number | null; price: number | null; unit: string | null; issue: string | null; confidence: string; page: number; line: string }>("canon-rows");
const productNames = reviewed<{ pick: string | null; confidence: string }>("product-name");
const nigpPicks = reviewed<{ classes: string[]; confidence: string }>("nigp");
const productKinds = reviewed<{ kind: string; role: KindRole; aliases: string[]; confidence: string }>("product-kind");
// Low-confidence answers aren't applied, with one exception: a doubtful "not a whole item" can still keep a product out
// of the catalog (scripts/product-stash.ts). Doubt removes a product; it never adds one.
// The packaged-service review (task package-check): every verdict, with whether it was confident.
const packageVerdicts: Record<string, { verdict: string; sure: boolean }> = (() => {
  const path = join(ROOT, "seed/cleanup/decisions/package-check.json");
  if (!existsSync(path)) return {};
  const all = JSON.parse(readFileSync(path, "utf8")) as Record<string, { verdict: string; confidence: string }>;
  return Object.fromEntries(Object.entries(all).map(([k, d]) => [k, { verdict: d.verdict, sure: d.confidence !== "low" }]));
})();
const doubtfulRoles: Record<string, KindRole> = (() => {
  const path = join(ROOT, "seed/cleanup/decisions/product-kind.json");
  if (!existsSync(path)) return {};
  const all = JSON.parse(readFileSync(path, "utf8")) as Record<string, { role: KindRole; confidence: string }>;
  return Object.fromEntries(Object.entries(all).filter(([, d]) => d.confidence === "low").map(([k, d]) => [k, d.role]));
})();

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

// GSA's schedule contracts are stashed, not served: they brought 12,473 contracts and no products, more noise than help
// in search. Their rows stay in the source files and GSA's own files are in seed/stash/gsa/; AGORA_INCLUDE_GSA=1 brings
// them back (then rebuild with npm run import:catalog-coops).
const INCLUDE_GSA = process.env.AGORA_INCLUDE_GSA === "1";
const GSA_DIR = join(ROOT, "seed/stash/gsa");
/** How many GSA contracts the stash keeps out, for /data. */
const gsaStashed = INCLUDE_GSA ? 0 : jsonl<RawContract>("contracts").filter((c) => c.cooperative === "GSA MAS").length;
const notGsa = <T extends { cooperative?: string; cooperatives?: string[] }>(rows: T[]): T[] =>
  INCLUDE_GSA ? rows : rows.filter((r) => r.cooperative !== "GSA MAS" && !(r.cooperatives && r.cooperatives.length === 1 && r.cooperatives[0] === "GSA MAS"));
const rawSuppliers = notGsa(jsonl<RawSupplier>("suppliers"));
const rawContracts = notGsa(jsonl<RawContract>("contracts"));
const rawOfferings = notGsa(jsonl<RawOffering>("offerings"));
const rawDocuments = notGsa(jsonl<RawDocument>("documents"));
// Products belong to offerings: keep those something still offers.
const offered = new Set(rawOfferings.map((o) => o.product_id));
const rawProducts = jsonl<RawProduct>("products").filter((p) => INCLUDE_GSA || offered.has(p.product_id));

// NJSTART, New Jersey's state contracts (npm run import:njstart), in the same raw shapes.
// They join the catalog as a state program, not a co-op: lib/catalog.ts gives them their
// own lane and opens them to New Jersey buyers.
const NJSTART_FILE = join(SRC, "njstart/records.json.gz");
const njstart = existsSync(NJSTART_FILE)
  ? (JSON.parse(gunzipSync(readFileSync(NJSTART_FILE)).toString("utf8")) as { retrieved: string; suppliers: RawSupplier[]; contracts: RawContract[]; products: RawProduct[]; offerings: RawOffering[]; documents: RawDocument[] })
  : null;
// Hawaii's State Procurement Office price & vendor lists (npm run import:hawaii), the same way.
const HAWAII_FILE = join(SRC, "hawaii/records.json.gz");
const hawaii = existsSync(HAWAII_FILE)
  ? (JSON.parse(gunzipSync(readFileSync(HAWAII_FILE)).toString("utf8")) as { retrieved: string; suppliers: RawSupplier[]; contracts: RawContract[]; products: RawProduct[]; offerings: RawOffering[]; documents: RawDocument[] })
  : null;
// Arkansas's Office of State Procurement directory (npm run import:arkansas), the same way.
const ARKANSAS_FILE = join(SRC, "arkansas/records.json.gz");
const arkansas = existsSync(ARKANSAS_FILE)
  ? (JSON.parse(gunzipSync(readFileSync(ARKANSAS_FILE)).toString("utf8")) as { retrieved: string; suppliers: RawSupplier[]; contracts: RawContract[]; products: RawProduct[]; offerings: RawOffering[]; documents: RawDocument[] })
  : null;
// New York OGS centralized contracts (npm run import:ny), the same way.
const NY_FILE = join(SRC, "ny/records.json.gz");
const newYork = existsSync(NY_FILE)
  ? (JSON.parse(gunzipSync(readFileSync(NY_FILE)).toString("utf8")) as { retrieved: string; suppliers: RawSupplier[]; contracts: RawContract[]; products: RawProduct[]; offerings: RawOffering[]; documents: RawDocument[] })
  : null;
const nySummary = existsSync(join(SRC, "ny/summary.json")) ? JSON.parse(readFileSync(join(SRC, "ny/summary.json"), "utf8")) : null;
// Empire Procure Connect, New York counties' cooperative (npm run import:epc), the same way.
const EPC_FILE = join(SRC, "epc/records.json.gz");
const epc = existsSync(EPC_FILE)
  ? (JSON.parse(gunzipSync(readFileSync(EPC_FILE)).toString("utf8")) as { retrieved: string; suppliers: RawSupplier[]; contracts: RawContract[]; products: RawProduct[]; offerings: RawOffering[]; documents: RawDocument[] })
  : null;
const epcSummary = existsSync(join(SRC, "epc/summary.json")) ? JSON.parse(readFileSync(join(SRC, "epc/summary.json"), "utf8")) : null;
// Oregon's statewide price agreements on OregonBuys (npm run import:oregon), the same way.
const OREGON_FILE = join(SRC, "oregon/records.json.gz");
const oregon = existsSync(OREGON_FILE)
  ? (JSON.parse(gunzipSync(readFileSync(OREGON_FILE)).toString("utf8")) as { retrieved: string; suppliers: RawSupplier[]; contracts: RawContract[]; products: RawProduct[]; offerings: RawOffering[]; documents: RawDocument[] })
  : null;
const orSummary = existsSync(join(SRC, "oregon/summary.json")) ? JSON.parse(readFileSync(join(SRC, "oregon/summary.json"), "utf8")) : null;
/** The state programs folded in, by program name. */
const STATE_SOURCES = [njstart && { program: "NJSTART", ...njstart }, hawaii && { program: "Hawaii SPO", ...hawaii }, arkansas && { program: "Arkansas OSP", ...arkansas }, newYork && { program: "NYS OGS", ...newYork }, epc && { program: "Empire Procure Connect", ...epc }, oregon && { program: "OregonBuys", ...oregon }].filter(<T,>(x: T | null): x is T => Boolean(x));
const STATE_PROGRAMS = new Set(["NJSTART", "Hawaii SPO", "Arkansas OSP", "NYS OGS", "NY Preferred Source", "Empire Procure Connect", "OregonBuys"]);
const arSummary = existsSync(join(SRC, "arkansas/summary.json")) ? JSON.parse(readFileSync(join(SRC, "arkansas/summary.json"), "utf8")) : null;
for (const src of STATE_SOURCES) {
  rawSuppliers.push(...src.suppliers);
  rawContracts.push(...src.contracts);
  rawProducts.push(...src.products);
  rawOfferings.push(...src.offerings);
  rawDocuments.push(...src.documents);
}
const stateCount = (k: "suppliers" | "contracts" | "products" | "offerings" | "documents") => STATE_SOURCES.reduce((n, s) => n + s[k].length, 0);
const hiSummary = existsSync(join(SRC, "hawaii/summary.json")) ? JSON.parse(readFileSync(join(SRC, "hawaii/summary.json"), "utf8")) : null;
const njSummary = existsSync(join(SRC, "njstart/summary.json")) ? JSON.parse(readFileSync(join(SRC, "njstart/summary.json"), "utf8")) : null;

// ------------------------------------------------------------------ GSA's own data (npm run fetch:gsa)

/** Every MAS Special Item Number: title, description, and whether state and local governments may use it. */
const gsaSins = INCLUDE_GSA ? (JSON.parse(readFileSync(join(GSA_DIR, "gsa-sins.json"), "utf8")) as { sins: Record<string, { title: string; description: string; cooperative: boolean }> }).sins : {};
interface GsaContract {
  sins: Set<string>;
  subs: Set<string>;
  website: string;
  uei: string;
  option_end: string;
  ultimate_end: string;
}
const gsaByContract = new Map<string, GsaContract>();
{
  const text = INCLUDE_GSA ? gunzipSync(readFileSync(join(GSA_DIR, "gsa-mas-contracts.csv.gz"))).toString("utf8") : "";
  const lines = text.split("\n").filter(Boolean);
  const parse = (line: string) => {
    const out: string[] = [];
    let cur = "";
    let q = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (q) {
        if (ch === '"' && line[i + 1] === '"') (cur += '"'), i++;
        else if (ch === '"') q = false;
        else cur += ch;
      } else if (ch === '"') q = true;
      else if (ch === ",") out.push(cur), (cur = "");
      else cur += ch;
    }
    out.push(cur);
    return out;
  };
  const head = lines.length ? parse(lines[0]) : [];
  const ix = (n: string) => head.indexOf(n);
  for (const line of lines.slice(1)) {
    const r = parse(line);
    const num = r[ix("contract")];
    const g = gsaByContract.get(num) ?? { sins: new Set<string>(), subs: new Set<string>(), website: "", uei: "", option_end: "", ultimate_end: "" };
    if (r[ix("sin")]) g.sins.add(r[ix("sin")]);
    if (r[ix("sub_category")]) g.subs.add(`${r[ix("large_category")]} / ${r[ix("sub_category")]}`);
    g.website ||= r[ix("website")];
    g.uei ||= r[ix("uei")];
    g.option_end ||= r[ix("option_end")];
    g.ultimate_end ||= r[ix("ultimate_end")];
    gsaByContract.set(num, g);
  }
}
// GSA lists each company's website and SAM UEI, a federal ID: add them to the suppliers they belong to.
const gsaSupplier = new Map<string, GsaContract>(); // raw supplier id → GSA data
for (const c of rawContracts) {
  const g = c.cooperative === "GSA MAS" && c.contract_number ? gsaByContract.get(c.contract_number) : undefined;
  if (g) gsaSupplier.set(c.supplier_id, g);
}
for (const s of rawSuppliers) {
  const g = gsaSupplier.get(s.supplier_id);
  if (g?.website) s.websites = [...new Set([...(s.websites ?? []), g.website])];
}

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
  NJSTART: "state_nj",
  "Hawaii SPO": "state_hi",
  "Arkansas OSP": "state_ar",
  "NYS OGS": "state_ny",
  "NY Preferred Source": "state_ny_ps",
  "Empire Procure Connect": "trx_epc",
  OregonBuys: "state_or",
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
// Records sharing a SAM UEI are the same legal company, whatever they're called.
let mergedByUei = 0;
const byUei = new Map<string, string[]>();
for (const [id, g] of gsaSupplier) if (g.uei) (byUei.get(g.uei) ?? byUei.set(g.uei, []).get(g.uei)!).push(id);
for (const ids of byUei.values()) for (const id of ids.slice(1)) if (find(id) !== find(ids[0])) (union(ids[0], id), mergedByUei++);
// Look-alike names a reviewer judged to be one company. Catalog ids are "cat_" + the record's raw id.
let mergedByReview = 0;
const rawIds = new Set(rawSuppliers.map((s) => s.supplier_id));
for (const d of Object.values(supplierMerges))
  for (const set of d.merge) {
    const ids = set.map((x) => `sup_${x.replace(/^cat_/, "")}`).filter((x) => rawIds.has(x));
    for (const id of ids.slice(1)) if (find(id) !== find(ids[0])) (union(ids[0], id), mergedByReview++);
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

/** Words that stay in capitals when an ALL CAPS company name is title-cased. */
const ACRONYMS = new Set(
  "LLC LLP LP PC PLLC PA USA US UK IBM IT AI AV HVAC GIS IOT CDW HP GE ATT NA ADA EMS EMT RV ATV LED UV PPE OEM ERP CRM SAAS GPS CAD CNC MRI CT DNA PR HR TV DVD USB IP VOIP SAP AWS NTT CGI SAIC DLT KPMG BDO RSM PWC EY ESRI JLL AECOM MBA CPA NAPA NASA ICF ABM DNV TRC EA".split(" "),
);
const SMALL = new Set(["of", "and", "the", "for", "in", "at", "on", "to", "a", "an", "or", "by", "de", "la"]);
/** "ALLIED MODULAR BUILDING SYSTEMS, INC." → "Allied Modular Building Systems, Inc."; keeps LLC, IBM, HVAC. */
function titleCaseCompany(name: string): string {
  if (/[a-z]/.test(name)) return name;
  return name
    .toLowerCase()
    .split(/(\s+|-|\/|&|\(|\))/)
    .map((w, i) => {
      const bare = w.replace(/[.,']/g, "").toUpperCase();
      if (ACRONYMS.has(bare)) return w.toUpperCase();
      // Short letter runs with no vowel are initials ("JRS", "CDW"); numbers and codes stay as they are.
      if (/^[a-z]{2,4}$/.test(bare.toLowerCase()) && !/[aeiouy]/.test(bare.toLowerCase())) return w.toUpperCase();
      if (/\d/.test(w)) return w.toUpperCase();
      if (i > 0 && SMALL.has(w)) return w;
      return w.replace(/^([a-z])/, (c) => c.toUpperCase()).replace(/^(mc)([a-z])/, (_, a: string, b: string) => "Mc" + b.toUpperCase());
    })
    .join("");
}
let titleCased = 0;

/** A readable name: mixed case over ALL CAPS, the brand over the legal entity's suffixes, the most-used spelling. */
function displayName(rs: RawSupplier[]): string {
  const votes = new Map<string, number>();
  for (const s of rs) for (const n of new Set([s.name, ...s.name_variants])) votes.set(n, (votes.get(n) ?? 0) + (contractsBySupplier.get(s.supplier_id) ?? 0) + 1);
  const best = [...votes.entries()].sort((a, b) => Number(/[a-z]/.test(b[0])) - Number(/[a-z]/.test(a[0])) || b[1] - a[1] || a[0].length - b[0].length)[0][0];
  if (/[a-z]/.test(best)) return best;
  titleCased++;
  return titleCaseCompany(best);
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
  /** GSA SINs state and local governments may buy through cooperative purchasing, with their titles. */
  coop_sins?: { code: string; title: string }[];
  /** One of Agora's categories, from a reviewed classification of the contract's title (or its first SIN). */
  category?: string;
  /** A state contract (NJSTART): whether the state opens it to its local governments, and its solicitation. */
  state_contract?: { state: string; locals: boolean; solicitation: string | null; type_code: string | null; group: string | null; spent: number | null; more_items: boolean; participants?: string[]; islands?: string[]; use?: string; preferred?: "approved" | "agency" | "not_approved"; owner?: string };
  /** NIGP commodity classes (3 digits) and, where the source prints them, item codes ("490-90").
   * "published": from the contract's own records (NJSTART). "reviewed": chosen by the AI review
   * (scripts/cleanup) from the classes NJSTART's records name. */
  nigp?: { classes: string[]; codes: string[]; source: "published" | "reviewed" };
}
/** GSA codes that describe nothing on their own: order-level materials, ancillary supplies. */
const GSA_FILLER = new Set(["OLM", "ANCILLARY"]);
let gsaDescribed = 0;
const contracts: Contract[] = rawContracts.map((c) => {
  const meta = c.source_metadata ?? {};
  const g = c.cooperative === "GSA MAS" && c.contract_number ? gsaByContract.get(c.contract_number) : undefined;
  if (g || c.cooperative === "GSA MAS") {
    // GSA titles every contract "Multiple Award Schedule": describe it by its SINs instead.
    const codes = [...new Set([...(g?.sins ?? []), ...(c.SINs ?? [])])];
    const named = codes.filter((x) => gsaSins[x] && !GSA_FILLER.has(x)).map((x) => ({ code: x, title: gsaSins[x].title }));
    const shown = named.slice(0, 3).map((x) => x.title);
    if (named.length) gsaDescribed++;
    return {
      id: c.contract_id,
      supplier: supplierOf.get(c.supplier_id)!,
      coop: c.cooperative,
      coop_id: COOP_ID[c.cooperative] ?? "",
      number: c.contract_number ?? "",
      title: shown.length ? `${shown.join("; ")}${named.length > 3 ? ` (and ${named.length - 3} more)` : ""}` : "Multiple Award Schedule",
      // GSA's own description of each SIN, first sentence, so "laptops" finds "Purchasing of New Electronic Equipment".
      categories: [
        ...new Set([
          ...(g?.subs ?? []),
          ...named.slice(3).map((x) => x.title),
          ...named.map((x) => gsaSins[x.code].description.split(/(?<=\.)\s/)[0].slice(0, 240)).filter(Boolean),
          ...(c.category_labels ?? []).filter((x) => !/^[0-9A-Z]{3,12}$/.test(x)),
        ]),
      ],
      start: null,
      end: g?.option_end || null,
      states: "any",
      lead: null,
      url: c.contract_url,
      directory: null,
      sins: codes,
      renewal: g?.ultimate_end || null,
      coop_sins: named.filter((x) => gsaSins[x.code].cooperative),
    };
  }
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
    ...stateContractOf(meta),
  };
});
/** NJSTART's fields: who may use it, and the commodity group and NIGP class's category when they settle one. */
function stateContractOf(meta: Record<string, unknown>): Partial<Contract> {
  const sc = meta.state_contract as { state: string; locals: boolean; solicitation: string | null; type_code: string | null; group: string | null } | undefined;
  if (!sc) return {};
  return {
    state_contract: {
      state: sc.state,
      locals: sc.locals,
      solicitation: sc.solicitation,
      type_code: sc.type_code,
      group: sc.group,
      spent: typeof meta.spent_to_date === "number" ? meta.spent_to_date : null,
      more_items: meta.line_items_paginated === true,
      // Hawaii names its participating jurisdictions: a local must be one of them.
      ...(Array.isArray(meta.jurisdictions) ? { participants: meta.jurisdictions as string[] } : {}),
      ...(typeof meta.use_of_contracts === "string" ? { use: meta.use_of_contracts } : {}),
      // New York's preferred sources: whether the list approves this offering, for one agency, or not at all.
      ...(typeof meta.preferred === "string" ? { preferred: meta.preferred as "approved" | "agency" | "not_approved" } : {}),
      ...(typeof meta.owner === "string" ? { owner: meta.owner } : {}),
      ...(Array.isArray(meta.islands) && (meta.islands as string[]).length ? { islands: meta.islands as string[] } : {}),
    },
    ...(typeof meta.category === "string" ? { category: meta.category } : {}),
  };
}
// NIGP commodity codes. NJSTART prints them on its line items; every other contract takes the
// classes the review chose for its title (GSA contracts: for their SINs, in SIN order).
const nigpStats = { published: 0, reviewed: 0, none: 0 };
{
  // Published codes from any state source that prints them (NJSTART, Empire Procure Connect, OregonBuys).
  const njCodes = new Map(STATE_SOURCES.flatMap((s) => s.contracts).map((c) => [c.contract_id, ((c.source_metadata ?? {}).nigp as string[] | undefined) ?? []]));
  for (const c of contracts) {
    if (c.state_contract) {
      const codes = njCodes.get(c.id) ?? [];
      if (codes.length) {
        c.nigp = { classes: [...new Set(codes.map((x) => x.slice(0, 3)))], codes, source: "published" };
        nigpStats.published++;
      } else nigpStats.none++;
      continue;
    }
    const picks = c.coop === "GSA MAS" ? [...new Set(c.sins.flatMap((x) => nigpPicks[`sin:${x}`]?.classes ?? []))] : (nigpPicks[`title:${c.title.trim().toLowerCase()}`]?.classes ?? []);
    if (picks.length) {
      c.nigp = { classes: picks.slice(0, 6), codes: [], source: "reviewed" };
      nigpStats.reviewed++;
    } else nigpStats.none++;
  }
}

// Categories: each distinct title was classified once; GSA contracts take their first described SIN's.
let categorized = 0;
for (const c of contracts) {
  const pick = c.coop === "GSA MAS" ? (c.sins.map((x) => categoryPicks[`sin:${x}`]?.pick).find((x) => x && x !== "Other") ?? categoryPicks[`sin:${c.sins[0]}`]?.pick) : categoryPicks[`title:${c.title.trim().toLowerCase()}`]?.pick;
  if (pick && !c.state_contract) (c.category = pick), categorized++;
}
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
  /** The NIGP item code the source prints on this line (NJSTART). */
  nigp?: string;
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
    ...(typeof meta.nigp === "string" ? { nigp: meta.nigp } : {}),
  };
});
const usedProducts = new Set(offerings.map((o) => o.product));
// A product named only by its part number ("AV2225PMIR-S") reads as its maker plus that number.
const PART_ONLY = /^[A-Z0-9][A-Z0-9\-_./]{3,}$/;
let partLabelled = 0;
let renamedByReview = 0;
const products = rawProducts
  .filter((p) => usedProducts.has(p.product_id))
  .map((p) => {
    const settled = productNames[p.product_id]?.pick;
    if (settled) {
      renamedByReview++;
      return { id: p.product_id, name: settled, maker: p.manufacturer ?? null, mpn: p.manufacturer_sku ?? null, review: false };
    }
    const bare = p.product_name.trim();
    const label = PART_ONLY.test(bare) && !/[a-z]/.test(bare) && p.manufacturer ? `${p.manufacturer.replace(/,? (Inc|LLC|Corp|Co)\.?$/i, "")} ${bare}` : bare;
    if (label !== bare) partLabelled++;
    return { id: p.product_id, name: label, maker: p.manufacturer ?? null, mpn: p.manufacturer_sku ?? null, review: p.title_conflict_requires_review };
  });

// Canon price-file rows the capture couldn't parse, read by a reviewer: kept only with a name and
// a single price, every number of which collect.ts found in the source line.
let canonAdded = 0;
{
  const canonOffer = offerings.find((o) => o.coop === "Sourcewell" && o.status === "published_price");
  if (canonOffer)
    for (const [id, r] of Object.entries(canonRows)) {
      if (!r.name || !r.price || r.issue) continue; // a $0.00 price is a rounded fraction of a cent
      const pid = `prd_canon_${id}`;
      products.push({ id: pid, name: r.name, maker: "Canon", mpn: r.sku, review: false });
      offerings.push({
        ...canonOffer,
        id: `off_canon_${id}`,
        product: pid,
        sku: r.sku,
        price: r.price,
        list: r.list,
        discount: r.discount,
        unit: r.unit,
        category: `Canon price file, page ${r.page}`,
      });
      canonAdded++;
    }
}

// Item prices read from co-op price files (scripts/import-price-files.ts): award reports and
// cost sheets. Each row joins the catalog contract with its co-op and number whose supplier
// is the same company, matched on the words of the name ("5 Star Chevrolet" is "Five Star
// Chevrolet"); a row whose company can't be told apart from another stays out.
const priceFileStats = { rows: 0, attached: 0, unmatched: [] as string[] };
{
  const file = join(ROOT, "seed/catalog/price-rows.json");
  const priceRows: { coop: string; number: string; supplier: string; product: string; maker: string | null; price: number; list?: number; sku?: string; unit: string; basis: string; vintage: string; file: string; source_url: string; page: number }[] = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : [];
  const NUM: Record<string, string> = { "1": "one", "2": "two", "3": "three", "4": "four", "5": "five", "6": "six", "7": "seven" };
  const STOP = new Set(["llc", "inc", "ltd", "lp", "co", "corp", "company", "companies", "dba", "the", "of", "and", "ii", "iii", "family", "enterprises", "group", "motors", "motor"]);
  // Car makes say which franchise a dealer is: Silsbee Ford and Silsbee Toyota are two companies.
  const MAKES = new Set(["ford", "lincoln", "chevrolet", "chevy", "gmc", "buick", "cadillac", "toyota", "nissan", "honda", "dodge", "chrysler", "jeep", "ram", "cdjr", "dcj", "kia", "hyundai", "subaru"]);
  const words = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9 ]+/g, " ")
      .split(/\s+/)
      .map((w) => NUM[w] ?? w)
      .map((w) => (w === "cjdr" ? "cdjr" : w === "mack" ? "mac" : w.length > 3 ? w.replace(/s$/, "") : w))
      .filter((w) => w.length > 1 && !STOP.has(w));
  const nameById = new Map(suppliers.map((s) => [s.id, [s.name, ...s.aliases]]));
  /** How alike two company names are: shared distinctive words over all of them; 0 when their car makes differ. */
  const alike = (x: string, y: string) => {
    const a = words(x), b = words(y);
    const ma = a.filter((w) => MAKES.has(w)), mb = b.filter((w) => MAKES.has(w));
    if (ma.length && mb.length && !ma.some((w) => mb.includes(w))) return 0;
    const na = new Set(a.filter((w) => !MAKES.has(w))), nb = new Set(b.filter((w) => !MAKES.has(w)));
    const shared = [...na].filter((w) => nb.has(w)).length;
    return shared / (new Set([...na, ...nb]).size || 1);
  };
  const score = (name: string, names: string[]) => Math.max(...names.map((n) => alike(name, n)));
  const productIds = new Map<string, string>();
  priceFileStats.rows = priceRows.length;
  for (const r of priceRows) {
    const pool = contracts.filter((c) => c.coop === r.coop && c.number === r.number);
    const ranked = pool.map((c) => ({ c, s: score(r.supplier, nameById.get(c.supplier) ?? []) })).sort((a, b) => b.s - a.s);
    const best = ranked[0];
    const tie = ranked.find((x) => x.c.supplier !== best?.c.supplier && x.s === best?.s);
    if (!best || best.s < 0.6 || tie) {
      priceFileStats.unmatched.push(`${r.coop} ${r.number}: ${r.supplier}`);
      continue;
    }
    const pkey = r.product.toLowerCase();
    let pid = productIds.get(pkey);
    if (!pid) {
      pid = `prd_pf_${createHash("sha1").update(pkey).digest("hex").slice(0, 16)}`;
      productIds.set(pkey, pid);
      products.push({ id: pid, name: r.product, maker: r.maker, mpn: r.sku ?? null, review: false });
    }
    offerings.push({
      id: `off_pf_${createHash("sha1").update(`${r.file}|${r.page}|${r.supplier}|${r.product}`).digest("hex").slice(0, 16)}`,
      product: pid,
      supplier: best.c.supplier,
      contract: best.c.id,
      coop: r.coop,
      sku: r.sku ?? null,
      price: r.basis === "list_price" ? null : r.price,
      list: r.basis === "list_price" ? r.price : (r.list ?? null),
      discount: r.list ? Math.round((1 - r.price / r.list) * 1000) / 10 : null,
      unit: r.unit,
      status: "published_price",
      vintage: r.vintage,
      url: r.source_url,
      category: `${best.c.title}: ${r.basis === "awarded_bid" ? "awarded bid" : r.basis === "list_price" ? "list price" : r.basis === "net_price" ? "contract net price" : "base price"}, page ${r.page} of the price file`,
    });
    priceFileStats.attached++;
  }
  priceFileStats.unmatched = [...new Set(priceFileStats.unmatched)];
}

// Item prices read from the state programs' price sheets on the server (lib/price-sheets.ts), brought into the
// repository by npm run import:doc-prices. Each row names its catalog contract, and its price was checked there against
// the line it is printed on; it is checked again here. Amendments often reprint a contract's whole schedule: when a
// contract's sheets print different prices for one item, the latest amendment's price stands (by the amendment,
// revision and date in the sheets' names), and when the names can't say which is latest the item stays out. A row whose
// contract has the same price on file for an item of the same name (NJSTART's line items) is the same offering.
const docPriceStats = { rows: 0, attached: 0, list_prices: 0, duplicates: 0, superseded: 0, unclear: 0, rejected: 0, no_contract: 0, read_in_parts: 0, mixed_sheets: 0, mixed_rows: 0 };
{
  const file = join(SRC, "doc-prices/rows.json.gz");
  const doc: { retrieved: string; rows: { url: string; contract_id: string; program: string; label: string; n: number; item: string; sku: string | null; unit: string | null; price: number; basis: string; note: string | null; line: string; read_on: string; headed?: boolean; whole?: boolean }[] } | null = existsSync(file)
    ? JSON.parse(gunzipSync(readFileSync(file)).toString("utf8"))
    : null;
  const contractById = new Map(contracts.map((c) => [c.id, c]));
  const productName = new Map(products.map((p) => [p.id, p.name.toLowerCase()]));
  const onFile = new Map<string, { price: number; name: string }[]>();
  for (const o of offerings) if (o.price != null) (onFile.get(o.contract) ?? onFile.set(o.contract, []).get(o.contract)!).push({ price: o.price, name: productName.get(o.product) ?? "" });
  const words = (t: string) => (t.toLowerCase().match(/[a-z][a-z0-9]{2,}/g) ?? []);
  // A list price is kept as a list price (shown "List $X · before the contract discount"), never as the price.
  const BASIS: Record<string, string> = { contract_price: "contract price", net_price: "contract net price", ceiling: "not-to-exceed rate", list_price: "list price" };
  const when = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
  /** How late a sheet is, from its name: amendment, then revision, then a date (2.27.26 or 2026-02-27). */
  const lateness = (label: string): number[] => {
    const amd = Number(label.match(/\bam(?:en)?d(?:ment)?\.?\s*(?:no\.?\s*)?(\d+)/i)?.[1] ?? 0);
    const rev = Number(label.match(/\brev(?:ision)?\.?\s*(\d+)/i)?.[1] ?? 0);
    const d = label.match(/\b(\d{1,2})[./-](\d{1,2})[./-](\d{2}|\d{4})\b/);
    const date = d ? Number(`${d[3].length === 2 ? `20${d[3]}` : d[3]}${d[1].padStart(2, "0")}${d[2].padStart(2, "0")}`) : 0;
    return [amd, rev, date];
  };
  const later = (a: number[], b: number[]) => {
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i];
    return 0;
  };
  type DocRow = NonNullable<typeof doc>["rows"][number];
  // A long sheet read in parts without its headings sent along (before November 15's fix) may have mistaken a column:
  // a list price read as a contract price, a weight read as a price. Only rows from sheets read whole, or read with
  // the headings, come in. And a sheet whose rows mix list prices with contract prices disagrees with itself about its
  // columns, so none of it comes in.
  const basisBySheet = new Map<string, Set<string>>();
  for (const r of doc?.rows ?? []) (basisBySheet.get(r.url) ?? basisBySheet.set(r.url, new Set()).get(r.url)!).add(r.basis === "list_price" ? "list" : "paid");
  const mixed = new Set([...basisBySheet].filter(([, b]) => b.size > 1).map(([u]) => u));
  docPriceStats.mixed_sheets = mixed.size;
  const valid: DocRow[] = [];
  for (const r of doc?.rows ?? []) {
    docPriceStats.rows++;
    if (!r.headed && !r.whole) {
      docPriceStats.read_in_parts++;
      continue;
    }
    if (mixed.has(r.url)) {
      docPriceStats.mixed_rows++;
      continue;
    }
    if (!contractById.has(r.contract_id)) {
      docPriceStats.no_contract++;
      continue;
    }
    // The same checks as on the server: a price a buyer pays, printed on its line, with the item named there.
    const figures = (r.line.match(/\d[\d,]*(?:\.\d+)?/g) ?? []).map((n) => Number(n.replace(/,/g, "")));
    const lineText = r.line.toLowerCase();
    const percent = /^\s*(pcnt|pct|percent|%)/i.test(r.unit ?? "") || /\b(markup|mark-up|percentage)\b/i.test(r.line);
    if (!BASIS[r.basis] || percent || !(r.price > 0) || !figures.some((f) => Math.abs(f - r.price) < 0.005) || !words(r.item).some((w) => lineText.includes(w))) {
      docPriceStats.rejected++;
      continue;
    }
    valid.push(r);
  }
  // Only a contract's latest sheet stands: amendments reprint the schedule, and an older sheet's line can wrap or read
  // differently from the newer one's, so no item-by-item match can be trusted to catch every superseded price. Sheets
  // the names can't rank (unnumbered attachments) stand together, unless they print different prices on the same line.
  const byContract = new Map<string, DocRow[]>();
  for (const r of valid) (byContract.get(r.contract_id) ?? byContract.set(r.contract_id, []).get(r.contract_id)!).push(r);
  const standing: DocRow[] = [];
  const lineKey = (r: DocRow) => (r.line.toLowerCase().match(/[a-z]{2,}/g) ?? []).join(" ");
  for (const rows of byContract.values()) {
    const latest = rows.reduce((m, r) => (later(lateness(r.label), m) > 0 ? lateness(r.label) : m), lateness(rows[0].label));
    const top = rows.filter((r) => later(lateness(r.label), latest) === 0);
    docPriceStats.superseded += rows.length - top.length;
    const lines = new Map<string, DocRow[]>();
    for (const r of top) (lines.get(lineKey(r)) ?? lines.set(lineKey(r), []).get(lineKey(r))!).push(r);
    for (const same of lines.values()) {
      const sheets = new Set(same.map((r) => r.url));
      if (sheets.size > 1 && new Set(same.map((r) => r.price)).size > 1) {
        docPriceStats.unclear += same.length;
        continue;
      }
      // The same line on several tied sheets (copies of one file): one sheet's rows.
      const first = same[0].url;
      standing.push(...same.filter((r) => r.url === first));
      docPriceStats.duplicates += same.filter((r) => r.url !== first).length;
    }
  }
  const productIds = new Map<string, string>();
  for (const r of standing) {
    const c = contractById.get(r.contract_id)!;
    // Most of the words of both names shared: the same item, not a neighbouring zone or size at the same price.
    const mine = new Set(words(`${r.item} ${r.note ?? ""}`));
    const alike = (name: string) => {
      const theirs = new Set(words(name));
      const both = [...mine].filter((w) => theirs.has(w)).length;
      return both / (new Set([...mine, ...theirs]).size || 1) >= 0.6;
    };
    const isList = r.basis === "list_price";
    if (!isList && (onFile.get(c.id) ?? []).some((x) => Math.abs(x.price - r.price) < 0.005 && alike(x.name))) {
      docPriceStats.duplicates++;
      continue;
    }
    const name = `${r.item}${r.note ? ` (${r.note})` : ""}`.slice(0, 200);
    const pkey = `${c.id}|${name.toLowerCase()}|${r.sku ?? ""}`;
    let pid = productIds.get(pkey);
    if (!pid) {
      pid = `prd_dp_${createHash("sha1").update(pkey).digest("hex").slice(0, 16)}`;
      productIds.set(pkey, pid);
      products.push({ id: pid, name, maker: null, mpn: r.sku, review: false });
    }
    offerings.push({
      id: `off_dp_${createHash("sha1").update(`${r.url}|${r.n}`).digest("hex").slice(0, 16)}`,
      product: pid,
      supplier: c.supplier,
      contract: c.id,
      coop: c.coop,
      sku: r.sku,
      price: isList ? null : r.price,
      list: isList ? r.price : null,
      discount: null,
      unit: r.unit,
      status: "published_price",
      vintage: `${BASIS[r.basis][0].toUpperCase()}${BASIS[r.basis].slice(1)} on "${r.label}", read ${when(r.read_on)}`,
      url: r.url,
      category: `${c.title}: ${BASIS[r.basis]}, from the price sheet "${r.label}": ${r.line.slice(0, 160)}`,
    });
    docPriceStats.attached++;
    if (isList) docPriceStats.list_prices++;
  }
}

// ------------------------------------------------------------------ what each product is
// The AI review's answer for each product name (scripts/product-kind.ts): its kind, its role and other names buyers
// use for it. Only high- and medium-confidence answers are applied; search falls back to the name for the rest.
let kindsApplied = 0;
for (const p of products as (typeof products[number] & { kind?: string; role?: KindRole; aliases?: string[] })[]) {
  const k = productKinds[productKindKey(p.name)];
  if (!k) continue;
  p.kind = k.kind;
  p.role = k.role;
  if (k.aliases.length) p.aliases = k.aliases;
  kindsApplied++;
}

// ------------------------------------------------------------------ the product stash
// Products that can't show what Loci is for are stashed, not served (scripts/product-stash.ts has the rule and the
// reasons): no price, a rate line, a component part. An offering goes by its own reason; a product goes when none of
// its offerings is left. Their rows stay in the source files, and AGORA_INCLUDE_STASHED=1 brings them back.
const INCLUDE_STASHED = process.env.AGORA_INCLUDE_STASHED === "1";
const productStash = {
  before: { products: products.length, offerings: offerings.length, priced_offerings: offerings.filter((o) => o.price != null).length },
  products: 0,
  offerings: 0,
  by_reason: Object.fromEntries(Object.keys(STASH_REASONS).map((k) => [k, { products: 0, offerings: 0 }])) as Record<StashReason, { products: number; offerings: number }>,
  by_program: {} as Record<string, { kept: number; stashed: number }>,
};
if (!INCLUDE_STASHED) {
  const productOf = new Map(products.map((p) => [p.id, p]));
  const titleOf = new Map(contracts.map((c) => [c.id, c.title]));
  const keptOfferings: Offering[] = [];
  const keptProducts = new Set<string>();
  const firstReason = new Map<string, StashReason>();
  for (const o of offerings) {
    const p = productOf.get(o.product);
    const why = p ? stashReason(o, { ...(p as typeof p & { role?: KindRole }), doubtful_role: doubtfulRoles[productKindKey(p.name)], package: packageVerdicts[productKindKey(p.name)] }, titleOf.get(o.contract) ?? "") : null;
    if (!why) {
      keptOfferings.push(o);
      keptProducts.add(o.product);
      continue;
    }
    productStash.offerings++;
    productStash.by_reason[why].offerings++;
    if (!firstReason.has(o.product)) firstReason.set(o.product, why);
  }
  const programOf = new Map<string, string>();
  for (const o of offerings) if (!programOf.has(o.product)) programOf.set(o.product, o.coop);
  for (const p of products) {
    const tally = (productStash.by_program[programOf.get(p.id) ?? "?"] ??= { kept: 0, stashed: 0 });
    if (keptProducts.has(p.id)) tally.kept++;
    else {
      tally.stashed++;
      productStash.products++;
      productStash.by_reason[firstReason.get(p.id)!].products++;
    }
  }
  const keptRows = products.filter((p) => keptProducts.has(p.id));
  offerings.length = 0;
  for (const o of keptOfferings) offerings.push(o);
  products.length = 0;
  for (const p of keptRows) products.push(p);
  // A storefront counts the products it can show.
  const shown = new Map<string, number>();
  for (const o of offerings) shown.set(o.supplier, (shown.get(o.supplier) ?? 0) + 1);
  for (const s of suppliers) s.products = shown.get(s.id) ?? 0;
}
mkdirSync(join(ROOT, "seed/stash/products"), { recursive: true });
writeFileSync(
  join(ROOT, "seed/stash/products/summary.json"),
  JSON.stringify({ retrieved: RETRIEVED, served: { products: products.length, offerings: offerings.length }, ...productStash, reasons: STASH_REASONS }, null, 1) + "\n",
);

// ------------------------------------------------------------------ documents: the price-list reader's queue

const documents = rawDocuments.map((d) => {
  const ext = (d.url.toLowerCase().match(/\.(pdf|xlsx|xls|csv|docx|htm|html)(?:[?#]|$)/) ?? [])[1] ?? "unknown";
  return { id: d.document_id, contract: d.contract_id, coop: d.cooperative, url: d.url, label: d.label, kind: ext === "html" ? "htm" : ext };
});

const catalog = { version: 1, retrieved: RETRIEVED, state_retrieved: Object.fromEntries(STATE_SOURCES.map((s) => [s.program, s.retrieved])), suppliers, contracts, products, offerings, documents };
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
const multiCoop = suppliers.filter((s) => s.coops.filter((c) => c !== "GSA MAS" && !STATE_PROGRAMS.has(c)).length >= 2);
const insights = {
  retrieved: RETRIEVED,
  // The 13 co-ops' capture alone; the state programs' counts are under njstart and hawaii.
  source_counts: {
    suppliers: rawSuppliers.length - stateCount("suppliers"),
    contracts: rawContracts.length - stateCount("contracts"),
    products: rawProducts.length - stateCount("products"),
    offerings: rawOfferings.length - stateCount("offerings"),
    documents: rawDocuments.length - stateCount("documents"),
  },
  cleanup: {
    gsa_contracts: contracts.filter((c) => c.coop === "GSA MAS").length,
    gsa_described: gsaDescribed,
    gsa_with_end: contracts.filter((c) => c.coop === "GSA MAS" && c.end).length,
    gsa_open_to_cities: contracts.filter((c) => c.coop === "GSA MAS" && c.coop_sins?.length).length,
    gsa_sins: Object.keys(gsaSins).length,
    gsa_cooperative_sins: Object.values(gsaSins).filter((x) => x.cooperative).length,
    gsa_stashed: gsaStashed,
    names_title_cased: titleCased,
    merged_by_uei: mergedByUei,
    parts_labelled: partLabelled,
    suppliers_merged_by_review: mergedByReview,
    contracts_categorized: categorized,
    products_renamed_by_review: renamedByReview,
    products_coded_by_review: kindsApplied,
    canon_rows_added: canonAdded,
    price_file_rows: priceFileStats.rows,
    price_file_offerings: priceFileStats.attached,
    price_file_unmatched: priceFileStats.unmatched,
    doc_price_rows: docPriceStats.rows,
    doc_price_offerings: docPriceStats.attached,
    doc_price_list_prices: docPriceStats.list_prices,
    doc_price_read_in_parts: docPriceStats.read_in_parts,
    doc_price_mixed_sheets: docPriceStats.mixed_sheets,
    doc_price_mixed_rows: docPriceStats.mixed_rows,
    doc_price_duplicates: docPriceStats.duplicates,
    doc_price_superseded: docPriceStats.superseded,
    doc_price_unclear: docPriceStats.unclear,
    doc_price_rejected: docPriceStats.rejected,
  },
  suppliers: {
    records: rawSuppliers.length,
    companies: suppliers.length,
    merged_by_name: mergedByName,
    merged_by_website: mergedByWebsite,
    merged_by_uei: mergedByUei,
    with_website: suppliers.filter((s) => s.websites.length).length,
    on_two_or_more_coops: multiCoop.length,
    most_coops: [...multiCoop].sort((a, b) => b.coops.length - a.coops.length || b.contracts - a.contracts).slice(0, 12).map((s) => ({ id: s.id, name: s.name, coops: s.coops, contracts: s.contracts })),
    merge_examples: suppliers.filter((s) => s.aliases.length >= 2 && s.coops.length >= 3).slice(0, 8).map((s) => ({ name: s.name, aliases: s.aliases.slice(0, 3) })),
  },
  per_coop: perCoop,
  nigp: {
    ...nigpStats,
    contracts: contracts.length,
    coop_contracts_coded: contracts.filter((c) => !c.state_contract && c.nigp).length,
    coop_contracts: contracts.filter((c) => !c.state_contract).length,
    state_uncoded: contracts.filter((c) => c.state_contract && !c.nigp).length,
    classes_used: new Set(contracts.flatMap((c) => c.nigp?.classes ?? [])).size,
    priced_offerings_coded: offerings.filter((o) => o.nigp).length,
    top_classes: Object.entries(contracts.reduce<Record<string, number>>((m, c) => { for (const k of c.nigp?.classes ?? []) m[k] = (m[k] ?? 0) + 1; return m; }, {})).sort((a, b) => b[1] - a[1]).slice(0, 12),
  },
  oregon: orSummary && {
    ...orSummary,
    suppliers_shared_with_coops: suppliers.filter((s) => s.coops.includes("OregonBuys") && s.coops.some((c) => c !== "OregonBuys")).length,
  },
  epc: epcSummary && {
    ...epcSummary,
    suppliers_shared_with_coops: suppliers.filter((s) => s.coops.includes("Empire Procure Connect") && s.coops.some((c) => c !== "Empire Procure Connect")).length,
  },
  new_york: nySummary && {
    ...nySummary,
    suppliers_shared_with_coops: suppliers.filter((s) => s.coops.includes("NYS OGS") && s.coops.some((c) => c !== "NYS OGS")).length,
  },
  arkansas: arSummary && {
    ...arSummary,
    suppliers_shared_with_coops: suppliers.filter((s) => s.coops.includes("Arkansas OSP") && s.coops.some((c) => c !== "Arkansas OSP")).length,
  },
  hawaii: hiSummary && {
    ...hiSummary,
    suppliers_shared_with_coops: suppliers.filter((s) => s.coops.includes("Hawaii SPO") && s.coops.some((c) => c !== "Hawaii SPO")).length,
    products_on_two_or_more_contracts: Object.values(offerings.filter((o) => o.coop === "Hawaii SPO").reduce<Record<string, Set<string>>>((m, o) => ((m[o.product] ??= new Set()).add(o.contract), m), {})).filter((x) => x.size > 1).length,
  },
  njstart: njSummary && {
    ...njSummary,
    ...(() => {
      const f = join(SRC, "njstart/nigp.json");
      if (!existsSync(f)) return {};
      const nb = JSON.parse(readFileSync(f, "utf8")) as { codes: Record<string, unknown>; classes: Record<string, unknown> };
      return { nigp_codes: Object.keys(nb.codes).length, nigp_classes: Object.keys(nb.classes).length };
    })(),
    suppliers_shared_with_coops: suppliers.filter((s) => s.coops.includes("NJSTART") && s.coops.some((c) => c !== "NJSTART")).length,
    offerings: offerings.filter((o) => o.coop === "NJSTART").length,
    products_on_two_or_more_contracts: Object.values(offerings.filter((o) => o.coop === "NJSTART").reduce<Record<string, Set<string>>>((m, o) => ((m[o.product] ??= new Set()).add(o.contract), m), {})).filter((x) => x.size > 1).length,
  },
  stash: { ...productStash, reasons: STASH_REASONS },
  products: {
    products: products.length,
    offerings: offerings.length,
    by_status: offerings.reduce<Record<string, number>>((m, o) => ((m[o.status] = (m[o.status] ?? 0) + 1), m), {}),
    by_status_coops: offerings.filter((o) => !STATE_PROGRAMS.has(o.coop)).reduce<Record<string, number>>((m, o) => ((m[o.status] = (m[o.status] ?? 0) + 1), m), {}),
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

console.log(`Cleanup: ${JSON.stringify(insights.cleanup)}`);
console.log(`Suppliers: ${rawSuppliers.length.toLocaleString()} records → ${suppliers.length.toLocaleString()} companies (${mergedByName} merged by name, ${mergedByWebsite} by website); ${multiCoop.length.toLocaleString()} on 2+ co-ops.`);
console.log(`Contracts: ${contracts.length.toLocaleString()}; ${contracts.filter((c) => c.url).length.toLocaleString()} with their own link; ${contracts.filter((c) => c.end && c.end < today).length} expired.`);
console.log(`Stash: ${productStash.products.toLocaleString()} products (${productStash.offerings.toLocaleString()} offerings) stashed ${JSON.stringify(Object.fromEntries(Object.entries(productStash.by_reason).map(([k, v]) => [k, v.products])))}.`);
console.log(`Products: ${products.length.toLocaleString()} in ${offerings.length.toLocaleString()} offerings ${JSON.stringify(insights.products.by_status)}; ${insights.products.multi_route} on 2+ contracts.`);
console.log(`Documents: ${documents.length.toLocaleString()} ${JSON.stringify(insights.documents.by_kind)}.`);
console.log(`Reconcile: ${confirmations.length} seeded contracts found; ${insights.reconcile.applied} fixes to apply, ${insights.reconcile.flagged} flagged.`);
for (const c of corrections) console.log(`  ${c.action.padEnd(5)} ${c.label} ${c.field}: ${c.agora} → ${c.catalog}`);
