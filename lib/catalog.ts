// The co-op catalog: 31,930 supplier contracts, 22,778 suppliers, 34,619 products
// and 12,602 price documents from 13 co-ops' public directories, captured November
// 13, 2026 and built into seed/catalog/catalog.json.gz by scripts/import-catalog.ts.
// It also holds NJSTART, New Jersey's state contracts (scripts/import-njstart.ts):
// 1,437 contracts and 5,810 awarded prices, as the state program "NJSTART" with a
// state_contract field. They are the TRX route Agora prefers for New Jersey buyers.
// Server only. Search, the co-op section, product routes, storefronts and the
// price-list queue ask it for the few records they need.
//
// Nothing here is buyable in Agora. Catalog contracts link out to the co-op, prices
// carry their source and vintage, and eligibility is never assumed: a co-op contract
// is "Join to use" until the agency is on the co-op, and GSA's cooperative-purchasing
// flag doesn't settle which schedules a city may use.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { fitScoreSets, requestTokens, SAME_AS, tokens, type CoopHit, type Weights } from "./assistant";
import { isMember, normalizeDomain } from "./coops";
import { isTrxState, stateContractAccess, TRX_MARGIN } from "./trx";
import type { Buyer, Db, Supplier as AgoraSupplier } from "./types";
import { stateName } from "./vehicles";

export interface CatalogSupplier {
  id: string;
  name: string;
  aliases: string[];
  websites: string[];
  coops: string[];
  contracts: number;
  products: number;
}
export interface CatalogContract {
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
  /** GSA SINs open to state and local governments through cooperative purchasing (GSA's SIN list). */
  coop_sins?: { code: string; title: string }[];
  /** One of Agora's categories, from a reviewed classification of the title. */
  category?: string;
  /** A state contract (NJSTART), not a co-op's: who may use it and the solicitation it came from. */
  state_contract?: {
    state: string;
    locals: boolean;
    solicitation: string | null;
    type_code: string | null;
    group: string | null;
    spent: number | null;
    more_items: boolean;
    /** The governments a Hawaii price list names as participating jurisdictions. */
    participants?: string[];
    /** The islands a Hawaii contractor serves, when the list says. */
    islands?: string[];
  };
  /** NIGP commodity classes and item codes: "published" from the contract's own records (NJSTART),
   * "reviewed" when the AI review chose the classes (lib/nigp.ts). */
  nigp?: { classes: string[]; codes: string[]; source: "published" | "reviewed" };
}
/** A state program in a TRX state: the route Agora prefers for that state's buyers (lib/trx.ts). */
export const isTrxContract = (c: Pick<CatalogContract, "state_contract"> | null | undefined) => Boolean(c?.state_contract && isTrxState(c.state_contract.state));
export interface CatalogProduct {
  id: string;
  name: string;
  maker: string | null;
  mpn: string | null;
  review: boolean;
}
export interface CatalogOffering {
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
  /** The NIGP item code printed on this line (NJSTART). */
  nigp?: string;
}
export interface CatalogDocument {
  id: string;
  contract: string;
  coop: string;
  url: string;
  label: string;
  kind: string;
}

interface Index {
  retrieved: string;
  state_retrieved?: Record<string, string>;
  suppliers: CatalogSupplier[];
  contracts: CatalogContract[];
  products: CatalogProduct[];
  offerings: CatalogOffering[];
  documents: CatalogDocument[];
  supplierById: Map<string, CatalogSupplier>;
  contractById: Map<string, CatalogContract>;
  productById: Map<string, CatalogProduct>;
  offeringById: Map<string, CatalogOffering>;
  offeringsByProduct: Map<string, CatalogOffering[]>;
  offeringsByContract: Map<string, CatalogOffering[]>;
  contractsBySupplier: Map<string, CatalogContract[]>;
  documentsByContract: Map<string, CatalogDocument[]>;
  supplierByKey: Map<string, CatalogSupplier>;
  supplierByDomain: Map<string, CatalogSupplier>;
  // Contract search: words in each title and in its wider scope, and which contracts use each word.
  cTitle: Set<string>[];
  cScope: Set<string>[];
  cIndex: Map<string, number[]>;
  cWeights: Weights;
  pTitle: Set<string>[];
  pScope: Set<string>[];
  pIndex: Map<string, number[]>;
  pWeights: Weights;
}

const g = globalThis as unknown as { __agoraCatalog?: Index };

/** "Tyler Technologies, Inc." → "tylertechnologies", the importer's company key. */
export function supplierKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[.,]/g, " ")
    .replace(/\b(incorporated|inc|llc|l l c|corp|corporation|co|company|ltd|limited|lp|llp|plc|pllc|pc|the|dba|d b a)\b/g, " ")
    .replace(/[^a-z0-9]/g, "");
}

function weightsFor(docs: Set<string>[]): Weights {
  const df = new Map<string, number>();
  for (const d of docs) for (const w of d) df.set(w, (df.get(w) ?? 0) + 1);
  const n = docs.length;
  return new Map([...df].map(([w, d]) => [w, Math.log((n + 1) / (d + 1)) + 0.1]));
}
function invert(sets: Set<string>[][]): Map<string, number[]> {
  const m = new Map<string, number[]>();
  sets.forEach((parts, i) => {
    for (const w of new Set(parts.flatMap((p) => [...p]))) (m.get(w) ?? m.set(w, []).get(w)!).push(i);
  });
  return m;
}

function load(): Index {
  if (g.__agoraCatalog) return g.__agoraCatalog;
  const raw = JSON.parse(gunzipSync(readFileSync(join(process.cwd(), "seed/catalog/catalog.json.gz"))).toString("utf8")) as Pick<
    Index,
    "retrieved" | "state_retrieved" | "suppliers" | "contracts" | "products" | "offerings" | "documents"
  >;
  const supplierById = new Map(raw.suppliers.map((s) => [s.id, s]));
  const offeringsByProduct = new Map<string, CatalogOffering[]>();
  for (const o of raw.offerings) (offeringsByProduct.get(o.product) ?? offeringsByProduct.set(o.product, []).get(o.product)!).push(o);
  const offeringsByContract = new Map<string, CatalogOffering[]>();
  for (const o of raw.offerings) (offeringsByContract.get(o.contract) ?? offeringsByContract.set(o.contract, []).get(o.contract)!).push(o);
  const contractsBySupplier = new Map<string, CatalogContract[]>();
  for (const c of raw.contracts) (contractsBySupplier.get(c.supplier) ?? contractsBySupplier.set(c.supplier, []).get(c.supplier)!).push(c);
  const documentsByContract = new Map<string, CatalogDocument[]>();
  for (const d of raw.documents) (documentsByContract.get(d.contract) ?? documentsByContract.set(d.contract, []).get(d.contract)!).push(d);
  const supplierByKey = new Map<string, CatalogSupplier>();
  const supplierByDomain = new Map<string, CatalogSupplier>();
  // Bigger suppliers win a shared key or domain.
  for (const s of [...raw.suppliers].sort((a, b) => b.contracts - a.contracts)) {
    for (const n of [s.name, ...s.aliases]) {
      const k = supplierKey(n);
      if (k.length >= 3 && !supplierByKey.has(k)) supplierByKey.set(k, s);
    }
    for (const w of s.websites) if (!supplierByDomain.has(w)) supplierByDomain.set(w, s);
  }
  const contractById = new Map(raw.contracts.map((c) => [c.id, c]));

  const cTitle = raw.contracts.map((c) => new Set(tokens(c.title)));
  const cScope = raw.contracts.map((c) => new Set(tokens(`${c.categories.join(" ")} ${supplierById.get(c.supplier)?.name ?? ""}`)));
  const cWeights = weightsFor(raw.contracts.map((_, i) => new Set([...cTitle[i], ...cScope[i]])));
  const productById = new Map(raw.products.map((p) => [p.id, p]));
  const pTitle = raw.products.map((p) => new Set(tokens(p.name)));
  const pScope = raw.products.map((p) => {
    const offers = offeringsByProduct.get(p.id) ?? [];
    const cats = [...new Set(offers.map((o) => o.category ?? contractById.get(o.contract)?.title ?? ""))].join(" ");
    return new Set(tokens(`${p.maker ?? ""} ${cats}`));
  });
  const pWeights = weightsFor(raw.products.map((_, i) => new Set([...pTitle[i], ...pScope[i]])));

  g.__agoraCatalog = {
    ...raw,
    supplierById,
    contractById,
    productById,
    offeringById: new Map(raw.offerings.map((o) => [o.id, o])),
    offeringsByProduct,
    offeringsByContract,
    contractsBySupplier,
    documentsByContract,
    supplierByKey,
    supplierByDomain,
    cTitle,
    cScope,
    cIndex: invert(raw.contracts.map((_, i) => [cTitle[i], cScope[i]])),
    cWeights,
    pTitle,
    pScope,
    pIndex: invert(raw.products.map((_, i) => [pTitle[i], pScope[i]])),
    pWeights,
  };
  return g.__agoraCatalog;
}

export const catalogRetrieved = () => load().retrieved;
/** When each state program's contracts were read, by program name ("NJSTART", "Hawaii SPO"). */
export const catalogStateRetrieved = (): Record<string, string> => load().state_retrieved ?? {};
/** The whole index, for the contract explorer and contract pages (lib/contracts.ts). Server only. */
export type CatalogIndex = Index;
export const catalogIndex = (): CatalogIndex => load();
export const catalogDocumentsFor = (contractId: string) => load().documentsByContract.get(contractId) ?? [];
export const catalogContract = (id: string | null | undefined) => (id ? (load().contractById.get(id) ?? null) : null);
export const catalogOffering = (id: string | null | undefined) => (id ? (load().offeringById.get(id) ?? null) : null);
export const catalogSupplierById = (id: string | null | undefined) => (id ? (load().supplierById.get(id) ?? null) : null);

const today = () => new Date().toISOString().slice(0, 10);
const expired = (c: CatalogContract) => Boolean(c.end && c.end < today());

/** Contracts that share a word with the request (or a word catalogs use for it). */
function candidates(index: Map<string, number[]>, words: string[]): Set<number> {
  const out = new Set<number>();
  for (const w of words) for (const x of [w, ...(SAME_AS[w] ?? [])]) for (const i of index.get(x) ?? []) out.add(i);
  return out;
}

// ------------------------------------------------------------------ access: may this agency use it?

/** Is the agency on this contract's co-op, and is the contract open to it? */
export function catalogAccess(db: Db, buyer: Buyer | null, c: CatalogContract): { member: boolean; eligible: boolean; reason: string } {
  const coopName = db.coops.find((x) => x.id === c.coop_id)?.name ?? c.coop;
  const where = c.states === "any" ? "" : c.states.length <= 6 ? c.states.map(stateName).join(", ") : `${c.states.length} states`;
  if (c.state_contract) return stateContractAccess(c.state_contract, buyer);
  if (c.coop_id === "gsa_mas") {
    // GSA's SIN list says which SINs state and local governments may buy through cooperative purchasing.
    const open = c.coop_sins ?? [];
    return {
      member: false,
      eligible: open.length > 0,
      reason: open.length
        ? `Open to state and local governments through GSA cooperative purchasing for ${open
            .slice(0, 2)
            .map((x) => `${x.title} (${x.code})`)
            .join(" and ")}${open.length > 2 ? ` and ${open.length - 2} more` : ""}; order only those SINs`
        : "none of this contract's SINs is open to state and local governments through GSA cooperative purchasing",
    };
  }
  if (c.coop_id === "coop_naspo") {
    const states = c.states === "any" ? null : c.states;
    const open = !buyer || !states || !states.length || states.includes(buyer.state);
    return {
      member: Boolean(buyer && states?.includes(buyer.state)),
      eligible: open,
      reason: states?.length ? `public entities in states with a participating addendum (${where})` : "public entities in states that sign a participating addendum",
    };
  }
  const member = Boolean(buyer && (isMember(db, buyer.name, c.coop_id) || (c.coop_id === "coop_buyboard" && isMember(db, buyer.name, "coop_buyboard_national"))));
  const servesState = !buyer || c.states === "any" || !c.states.length || c.states.includes(buyer.state);
  return {
    member,
    eligible: servesState,
    reason: servesState ? `${coopName} members${where ? ` in ${where}` : ""}; eligibility not independently verified` : `${coopName} lists this contract for ${where} only`,
  };
}

// ------------------------------------------------------------------ the co-op section

export interface CatalogCoopResult {
  hits: CoopHit[];
  more_member: number;
  more_other: number;
  gsa: CoopHit[];
  gsa_total: number;
  /** State contracts in a TRX state (NJSTART) the buyer may use, best first; they also lead `hits`. */
  state: CoopHit[];
  state_total: number;
}

/** Catalog contracts covering a request, as co-op hits: the best few on the agency's co-ops,
 * the best few it could join, and GSA separately. Contracts Agora already seeds are skipped. */
export function catalogCoopHits(db: Db, item: string, buyer: Buyer | null, opts: { perSide?: number; gsa?: number; state?: number; minFit?: number; category?: string | null } = {}): CatalogCoopResult {
  const idx = load();
  const itemTokens = requestTokens(item);
  const empty = { hits: [], more_member: 0, more_other: 0, gsa: [], gsa_total: 0, state: [], state_total: 0 };
  if (!itemTokens.length) return empty;
  const seeded = new Set(db.contracts.map((c) => c.catalog_id).filter(Boolean));
  // Access depends only on the co-op and the states, so work it out once per combination.
  const accessCache = new Map<string, ReturnType<typeof catalogAccess>>();
  const access = (c: CatalogContract) => {
    const k = `${c.coop_id}|${c.states === "any" ? "*" : c.states.join(",")}|${(c.coop_sins ?? []).map((x) => x.code).join(",")}|${c.state_contract?.locals ?? ""}`;
    let a = accessCache.get(k);
    if (!a) accessCache.set(k, (a = catalogAccess(db, buyer, c)));
    return a;
  };
  const minFit = opts.minFit ?? 60;
  const scored: { c: CatalogContract; fit: number; access: ReturnType<typeof catalogAccess> }[] = [];
  for (const i of candidates(idx.cIndex, itemTokens)) {
    const c = idx.contracts[i];
    if (expired(c) || seeded.has(c.id)) continue;
    const fit = fitScoreSets(itemTokens, idx.cTitle[i], idx.cScope[i], idx.cWeights);
    if (fit < minFit) continue;
    // A request with a clear category ("24 inch monitors" is IT hardware) drops partial matches from other categories.
    if (opts.category && c.category && c.category !== opts.category && fit < 85) continue;
    const a = access(c);
    // Another state's contracts are noise for this buyer, as are a state's own-agency contracts for its locals.
    if (c.state_contract && buyer && !a.eligible) continue;
    scored.push({ c, fit, access: a });
  }
  // One card per supplier per co-op: TIPS lists some suppliers on a dozen overlapping awards.
  const best = new Map<string, (typeof scored)[number]>();
  // Item prices on file break ties: a buyer can check a quote against them.
  const pricedOn = (c: CatalogContract) => (idx.offeringsByContract.get(c.id) ?? []).filter((o) => o.price != null).length;
  /** Priced items on the contract whose names share a word with the request: "N matching products in Agora". */
  const asked = new Set(itemTokens.flatMap((w) => [w, ...(SAME_AS[w] ?? [])]));
  const matchingPriced = (c: CatalogContract) =>
    (idx.offeringsByContract.get(c.id) ?? []).filter((o) => o.price != null && tokens(idx.productById.get(o.product)?.name ?? "").some((w) => asked.has(w))).length;
  const rank = (x: (typeof scored)[number]) =>
    x.fit * 10 + (x.c.url ? 3 : 0) + (x.c.end ? 1 : 0) + (x.access.eligible ? 5 : 0) + (opts.category && x.c.category === opts.category ? 8 : 0) + (pricedOn(x.c) ? 4 : 0);
  for (const x of scored) {
    const k = `${x.c.coop}|${x.c.supplier}`;
    const have = best.get(k);
    if (!have || rank(x) > rank(have)) best.set(k, x);
  }
  const all = [...best.values()].sort((a, b) => rank(b) - rank(a));
  const gsa = all.filter((x) => x.c.coop_id === "gsa_mas");
  // TRX state contracts get their own lane, ahead of every co-op, for the buyers they're open to (with no
  // agency set, the ones open to local governments). The preference settles close calls: a state contract
  // leads when it fits within TRX_MARGIN of the best co-op contract, and a much closer co-op fit still wins.
  const bestCoop = Math.max(0, ...all.filter((x) => !x.c.state_contract && x.c.coop_id !== "gsa_mas" && x.access.eligible).map((x) => x.fit));
  const state = all.filter((x) => isTrxContract(x.c) && (buyer ? x.access.eligible : x.c.state_contract!.locals) && x.fit >= bestCoop - TRX_MARGIN);
  const coops = all.filter((x) => x.c.coop_id !== "gsa_mas" && x.c.coop_id && !x.c.state_contract);
  const member = coops.filter((x) => x.access.member);
  const other = coops.filter((x) => !x.access.member);
  const per = opts.perSide ?? 8;
  const toHit = (x: (typeof scored)[number]): CoopHit => ({
    contract_id: x.c.id,
    coop_id: x.c.coop_id,
    coop: db.coops.find((co) => co.id === x.c.coop_id)?.name ?? x.c.coop,
    contract_number: x.c.number,
    title: x.c.title,
    supplier: idx.supplierById.get(x.c.supplier)?.name ?? "",
    supplier_id: x.c.supplier,
    fit: x.fit,
    member: x.access.member,
    eligible: x.access.eligible,
    reason: x.access.reason,
    note: x.c.end ? null : "End date not published in the co-op's directory.",
    verification: "research_lead",
    link_out: { contract_id: x.c.id, coop: x.c.coop, has_link: Boolean(x.c.url) },
    products: matchingPriced(x.c),
    source: "catalog",
    end: x.c.end,
    directory_url: x.c.directory,
    ...(x.c.state_contract ? { program: "state" as const, trx: isTrxContract(x.c), solicitation: x.c.state_contract.solicitation, state: x.c.state_contract.state } : {}),
  });
  const statePer = opts.state ?? 6;
  return {
    hits: [...state.slice(0, statePer), ...member.slice(0, per), ...other.slice(0, per)].map(toHit),
    more_member: Math.max(0, member.length - per),
    more_other: Math.max(0, other.length - per),
    gsa: gsa.slice(0, opts.gsa ?? 4).map(toHit),
    gsa_total: gsa.length,
    state: state.slice(0, statePer).map(toHit),
    state_total: state.length,
  };
}

// ------------------------------------------------------------------ products

export interface CatalogRoute {
  offering_id: string;
  coop: string;
  coop_id: string;
  supplier: string;
  supplier_id: string;
  contract_id: string;
  contract_number: string;
  price: number | null;
  list: number | null;
  discount: number | null;
  status: CatalogOffering["status"];
  vintage: string | null;
  unit: string | null;
  member: boolean;
  eligible: boolean;
  reason: string;
  /** On a TRX state contract (NJSTART): the route Agora prefers for that state's buyers. */
  trx: boolean;
}
export interface CatalogProductHit {
  product_id: string;
  name: string;
  maker: string | null;
  mpn: string | null;
  fit: number;
  /** The source names this SKU differently in different places; check before relying on it. */
  review: boolean;
  routes: CatalogRoute[];
  /** Share of the product's name the request covers, for ranking. */
  coverage: number;
}

/** Products in the catalog that match a request, each with every contract that sells it. */
export function catalogProducts(db: Db, item: string, buyer: Buyer | null, limit = 8): { hits: CatalogProductHit[]; total: number } {
  const idx = load();
  const itemTokens = requestTokens(item);
  if (!itemTokens.length) return { hits: [], total: 0 };
  const found: { i: number; fit: number }[] = [];
  for (const i of candidates(idx.pIndex, itemTokens)) {
    const fit = fitScoreSets(itemTokens, idx.pTitle[i], idx.pScope[i], idx.pWeights);
    if (fit >= 70) found.push({ i, fit });
  }
  // Among equal fits, the product the request names most squarely: "Dell Rugged Laptop" before a
  // trailer whose long description mentions laptops.
  const ask = new Set(itemTokens);
  const coverage = (i: number) => {
    const t = idx.pTitle[i];
    return t.size ? [...t].filter((w) => ask.has(w)).length / t.size : 0;
  };
  const cover = new Map(found.map((f) => [f.i, coverage(f.i)]));
  const toHit = ({ i, fit }: { i: number; fit: number }): CatalogProductHit => {
    const p = idx.products[i];
    const routes = (idx.offeringsByProduct.get(p.id) ?? [])
      .map((o) => {
        const c = idx.contractById.get(o.contract);
        if (!c || expired(c)) return null;
        const a = catalogAccess(db, buyer, c);
        // Another state's contract, or a state-agency-only one for a local, isn't a route for this buyer.
        // With no agency set, show what a local government could use, as the state lane does.
        if (c.state_contract && (buyer ? !a.eligible : !c.state_contract.locals)) return null;
        return {
          offering_id: o.id,
          coop: db.coops.find((x) => x.id === c.coop_id)?.name ?? c.coop,
          coop_id: c.coop_id,
          supplier: idx.supplierById.get(o.supplier)?.name ?? "",
          supplier_id: o.supplier,
          contract_id: c.id,
          contract_number: c.number,
          price: o.price,
          list: o.list,
          discount: o.discount,
          status: o.status,
          vintage: o.vintage,
          unit: o.unit,
          trx: isTrxContract(c),
          ...a,
        } satisfies CatalogRoute;
      })
      .filter((r): r is CatalogRoute => Boolean(r))
      // Routes the buyer can use first, a TRX state contract ahead of a co-op among them, then by price.
      .sort((a, b) => Number(b.member) - Number(a.member) || Number(b.eligible) - Number(a.eligible) || Number(b.trx && b.eligible) - Number(a.trx && a.eligible) || (a.price ?? Infinity) - (b.price ?? Infinity));
    return { product_id: p.id, name: p.name, maker: p.maker, mpn: p.mpn, fit, review: p.review, routes, coverage: cover.get(i) ?? 0 };
  };
  const priced = (h: CatalogProductHit) => (h.routes.some((r) => r.price != null) ? 2 : h.routes.some((r) => r.discount != null) ? 1 : 0);
  // The same product listed under several SKUs is one card with every route.
  const merged = new Map<string, CatalogProductHit>();
  for (const h of found.map(toHit)) {
    if (!h.routes.length) continue;
    const k = `${(h.maker ?? "").toLowerCase()}|${h.name.toLowerCase().replace(/\s+/g, " ").trim()}`;
    const have = merged.get(k);
    if (!have) merged.set(k, h);
    else {
      const ids = new Set(have.routes.map((r) => r.offering_id));
      have.routes.push(...h.routes.filter((r) => !ids.has(r.offering_id)));
      have.fit = Math.max(have.fit, h.fit);
    }
  }
  const hits = [...merged.values()]
    .sort((a, b) => b.fit - a.fit || b.coverage - a.coverage || priced(b) - priced(a) || b.routes.length - a.routes.length || a.name.localeCompare(b.name));
  return { hits: hits.slice(0, limit), total: hits.length };
}

// ------------------------------------------------------------------ suppliers and storefronts

export interface CatalogStorefront {
  supplier: CatalogSupplier;
  contracts: (CatalogContract & { coop_name: string; documents: number; member: boolean; eligible: boolean; reason: string })[];
  products: { total: number; priced: number; sample: { product_id: string; name: string; maker: string | null; price: number | null; discount: number | null; coop: string }[] };
  retrieved: string;
}

export function catalogStorefront(db: Db, id: string): CatalogStorefront | null {
  const idx = load();
  const s = idx.supplierById.get(id);
  if (!s) return null;
  const contracts = (idx.contractsBySupplier.get(id) ?? [])
    .filter((c) => !expired(c))
    .map((c) => ({
      ...c,
      coop_name: db.coops.find((x) => x.id === c.coop_id)?.name ?? c.coop,
      documents: idx.documentsByContract.get(c.id)?.length ?? 0,
      ...catalogAccess(db, db.session.buyer, c),
    }))
    .sort((a, b) => Number(b.member) - Number(a.member) || a.coop_name.localeCompare(b.coop_name) || a.title.localeCompare(b.title));
  const offers = idx.offerings.filter((o) => o.supplier === id);
  const seen = new Set<string>();
  const sample = [];
  for (const o of [...offers].sort((a, b) => Number(b.price != null) - Number(a.price != null))) {
    if (seen.has(o.product)) continue;
    seen.add(o.product);
    const p = idx.productById.get(o.product);
    if (p) sample.push({ product_id: p.id, name: p.name, maker: p.maker, price: o.price, discount: o.discount, coop: o.coop });
    if (sample.length >= 12) break;
  }
  return { supplier: s, contracts, products: { total: new Set(offers.map((o) => o.product)).size, priced: offers.filter((o) => o.price != null).length, sample }, retrieved: idx.retrieved };
}

/** The catalog's record for one of Agora's own suppliers: by website, then by company name. */
export function catalogSupplierFor(s: Pick<AgoraSupplier, "name" | "website">): CatalogSupplier | null {
  const idx = load();
  // The company's own name first: a website can be shared with a subsidiary (Tyler Federal uses tylertech.com).
  const byName = idx.supplierByKey.get(supplierKey(s.name));
  if (byName) return byName;
  const d = normalizeDomain(s.website);
  return (d && idx.supplierByDomain.get(d)) || null;
}

/** Supplier search by name, biggest first. */
export function searchCatalogSuppliers(q: string, limit = 10): CatalogSupplier[] {
  const idx = load();
  const query = q.trim().toLowerCase();
  if (query.length < 2) return [];
  const words = query.split(/\s+/);
  return idx.suppliers
    .filter((s) => {
      const text = `${s.name} ${s.aliases.join(" ")}`.toLowerCase();
      return words.every((w) => text.includes(w));
    })
    .sort((a, b) => Number(b.name.toLowerCase().startsWith(query)) - Number(a.name.toLowerCase().startsWith(query)) || b.contracts - a.contracts || a.name.localeCompare(b.name))
    .slice(0, limit);
}

/** Turn a catalog supplier into an Agora supplier record, so it can be claimed and managed like any other. */
export function materializeSupplier(db: Db, id: string): AgoraSupplier | null {
  const existing = db.suppliers.find((s) => s.id === id);
  if (existing) return existing;
  const s = load().supplierById.get(id);
  if (!s) return null;
  const rec: AgoraSupplier = {
    id: s.id,
    name: s.name,
    city: "",
    state: "",
    is_local: false,
    certifications: [],
    verified: { insurance: false, bond: false },
    edge_tier: "discover",
    rating: 0,
    review_count: 0,
    sponsored: false,
    categories: ["Other"],
    website: s.websites[0],
  };
  db.suppliers.push(rec);
  return rec;
}

// ------------------------------------------------------------------ the price-list queue

export interface QueueItem extends CatalogDocument {
  supplier: string;
  supplier_id: string;
  contract_number: string;
  title: string;
  /** Agora can read this kind of document today. */
  readable: boolean;
}

const READABLE = new Set(["pdf", "xlsx", "xls", "csv", "docx", "htm"]);

/** Catalog and price-list links waiting to be read, filtered by co-op and kind. */
export function priceListQueue(opts: { coop?: string; kind?: string; q?: string; offset?: number; limit?: number } = {}) {
  const idx = load();
  const q = opts.q?.trim().toLowerCase() ?? "";
  const rows = idx.documents.filter((d) => {
    if (opts.coop && d.coop !== opts.coop) return false;
    if (opts.kind && d.kind !== opts.kind) return false;
    if (!q) return true;
    const c = idx.contractById.get(d.contract);
    const s = c ? idx.supplierById.get(c.supplier) : null;
    return `${s?.name ?? ""} ${d.label} ${c?.number ?? ""}`.toLowerCase().includes(q);
  });
  const offset = opts.offset ?? 0;
  const items: QueueItem[] = rows.slice(offset, offset + (opts.limit ?? 25)).map((d) => {
    const c = idx.contractById.get(d.contract);
    const s = c ? idx.supplierById.get(c.supplier) : null;
    return { ...d, supplier: s?.name ?? "", supplier_id: s?.id ?? "", contract_number: c?.number ?? "", title: c?.title ?? "", readable: READABLE.has(d.kind) };
  });
  const counts = idx.documents.reduce<Record<string, number>>((m, d) => ((m[`${d.coop}|${d.kind}`] = (m[`${d.coop}|${d.kind}`] ?? 0) + 1), m), {});
  return { total: rows.length, items, counts };
}

export const catalogDocument = (id: string) => load().documents.find((d) => d.id === id) ?? null;
