// The co-op catalog: supplier contracts, suppliers, products and price documents from 13 co-ops' public directories,
// captured November 13, 2026, and the state programs' records, built into seed/catalog/catalog.json.gz by
// scripts/import-catalog.ts. Current counts are in seed/catalog/insights.json (and on /data); most captured products
// are stashed, not served (scripts/product-stash.ts).
// It also holds NJSTART, New Jersey's state contracts (scripts/import-njstart.ts):
// 1,437 contracts and 5,810 awarded prices, as the state program "NJSTART" with a
// state_contract field. They are the TRX route Loci prefers for New Jersey buyers.
// Server only. Search, the co-op section, product routes, storefronts and the
// price-list queue ask it for the few records they need.
//
// Nothing here is buyable in Loci. Catalog contracts link out to the co-op, prices
// carry their source and vintage, and eligibility is never assumed: a co-op contract
// is "Join to use" until the agency is on the co-op, and GSA's cooperative-purchasing
// flag doesn't settle which schedules a city may use.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { fitScoreSets, kindMatch, namePhrase, requestTokens, SAME_AS, tokens, type CoopHit, type Weights } from "./assistant";
import { isMember, normalizeDomain } from "./coops";
import type { DocumentHit } from "./doc-store";
import { orcppMember } from "./orcpp";
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
  /** One of Loci's categories, from a reviewed classification of the title. */
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
    /** Who may use it, in the award's words (New York's "Use of Contracts"). */
    use?: string;
    /** A New York preferred source (State Finance Law § 162): approved, approved for one agency, or listed as not approved. */
    preferred?: "approved" | "agency" | "not_approved";
    /** The county that let it (Empire Procure Connect): it may always use it; others only when open. */
    owner?: string;
  };
  /** NIGP commodity classes and item codes: "published" from the contract's own records (NJSTART),
   * "reviewed" when the AI review chose the classes (lib/nigp.ts). */
  nigp?: { classes: string[]; codes: string[]; source: "published" | "reviewed" };
}
/** A state program in a TRX state: the route Loci prefers for that state's buyers (lib/trx.ts). */
export const isTrxContract = (c: Pick<CatalogContract, "state_contract"> | null | undefined) => Boolean(c?.state_contract && isTrxState(c.state_contract.state));
export interface CatalogProduct {
  id: string;
  name: string;
  maker: string | null;
  mpn: string | null;
  review: boolean;
  /** What the product is, from the AI review (scripts/product-kind.ts): "pickup truck", "swing hanger". */
  kind?: string;
  /** Whether it is a whole item, a part, an accessory or a consumable. */
  role?: "item" | "part" | "accessory" | "consumable" | "rate" | "service";
  /** Other names buyers use for it: "can liner" for a trash bag. */
  aliases?: string[];
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
  /** A contract's position in `contracts`, for the search indexes. */
  contractIndex: Map<string, number>;
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
  /** Each product's ways of saying what it is, tokenized: its kind and aliases, or the phrase its name opens with. */
  pKinds: string[][][];
  /** Products by the review's kind, lowercased: "pickup truck" → the products that are one. */
  pByKind: Map<string, number[]>;
  /** Every kind with its products' count, the words of the kind and its aliases, and one product's name. */
  kindList: { kind: string; count: number; words: Set<string>; example: string }[];
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
  // A product's wider scope: its maker, the price-sheet section it is printed under, and the title of every contract
  // that sells it. "Copiers, printers, MFDs" is how Canon's toner meets a request for "toner for the copier".
  const pScope = raw.products.map((p) => {
    const offers = offeringsByProduct.get(p.id) ?? [];
    const cats = [...new Set(offers.flatMap((o) => [o.category ?? "", contractById.get(o.contract)?.title ?? ""]))].join(" ");
    // The review's kind and the other names buyers use count as scope: a "park bench" request meets an outdoor bench.
    return new Set(tokens(`${p.maker ?? ""} ${cats} ${p.kind ?? ""} ${(p.aliases ?? []).join(" ")}`));
  });
  const pKinds = raw.products.map((p) => (p.kind ? [p.kind, ...(p.aliases ?? [])] : [namePhrase(p.name)]).map((x) => tokens(x)));
  const pByKind = new Map<string, number[]>();
  const kinds = new Map<string, { kind: string; count: number; words: Set<string>; example: string }>();
  raw.products.forEach((p, i) => {
    if (!p.kind) return;
    const k = p.kind.toLowerCase();
    (pByKind.get(k) ?? pByKind.set(k, []).get(k)!).push(i);
    const e = kinds.get(k) ?? kinds.set(k, { kind: k, count: 0, words: new Set<string>(), example: p.name }).get(k)!;
    e.count++;
    for (const w of tokens(`${p.kind} ${(p.aliases ?? []).join(" ")}`)) e.words.add(w);
  });
  const kindList = [...kinds.values()];
  const pWeights = weightsFor(raw.products.map((_, i) => new Set([...pTitle[i], ...pScope[i]])));

  g.__agoraCatalog = {
    ...raw,
    supplierById,
    contractById,
    contractIndex: new Map(raw.contracts.map((c, i) => [c.id, i])),
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
    pKinds,
    pByKind,
    kindList,
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
/** Every document linked to a TRX program's contracts (lib/doc-ingest.ts stores their text). */
export function catalogTrxDocuments(): { url: string; label: string; contract_id: string; program: string; state: string | null }[] {
  const idx = load();
  const out: { url: string; label: string; contract_id: string; program: string; state: string | null }[] = [];
  for (const c of idx.contracts) {
    if (!isTrxContract(c) || expired(c)) continue;
    for (const d of idx.documentsByContract.get(c.id) ?? []) out.push({ url: d.url, label: d.label, contract_id: c.id, program: c.coop, state: c.state_contract?.state ?? null });
  }
  return out;
}
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
  if (c.state_contract) return stateContractAccess(c.state_contract, buyer, c.state_contract.state === "OR" && buyer ? orcppMember(buyer) : undefined);
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
 * the best few it could join, and GSA separately. Contracts Loci already seeds are skipped. */
export function catalogCoopHits(db: Db, item: string, buyer: Buyer | null, opts: { perSide?: number; gsa?: number; state?: number; minFit?: number; category?: string | null; docHits?: Map<string, DocumentHit> } = {}): CatalogCoopResult {
  const idx = load();
  const itemTokens = requestTokens(item);
  const empty = { hits: [], more_member: 0, more_other: 0, gsa: [], gsa_total: 0, state: [], state_total: 0 };
  if (!itemTokens.length) return empty;
  const seeded = new Set(db.contracts.map((c) => c.catalog_id).filter(Boolean));
  // Access depends only on the co-op and the states, so work it out once per combination.
  const accessCache = new Map<string, ReturnType<typeof catalogAccess>>();
  const access = (c: CatalogContract) => {
    const k = `${c.coop_id}|${c.states === "any" ? "*" : c.states.join(",")}|${(c.coop_sins ?? []).map((x) => x.code).join(",")}|${c.state_contract ? JSON.stringify([c.state_contract.locals, c.state_contract.participants, c.state_contract.use, c.state_contract.preferred, c.state_contract.owner]) : ""}`;
    let a = accessCache.get(k);
    if (!a) accessCache.set(k, (a = catalogAccess(db, buyer, c)));
    return a;
  };
  const minFit = opts.minFit ?? 60;
  const scored: { c: CatalogContract; fit: number; access: ReturnType<typeof catalogAccess> }[] = [];
  // Contracts whose documents contain every word of the request (lib/doc-store.ts) are candidates too. A document
  // match alone fits in the 60s, by its rank among the matches, so a contract whose title says it still leads.
  const docHits = opts.docHits ?? new Map<string, DocumentHit>();
  const docOrder = new Map([...docHits.keys()].map((id, n) => [id, n]));
  const pool_ = candidates(idx.cIndex, itemTokens);
  for (const id of docHits.keys()) {
    const i = idx.contractIndex.get(id);
    if (i != null) pool_.add(i);
  }
  for (const i of pool_) {
    const c = idx.contracts[i];
    if (expired(c) || seeded.has(c.id)) continue;
    const titleFit = fitScoreSets(itemTokens, idx.cTitle[i], idx.cScope[i], idx.cWeights);
    const docRank = docOrder.get(c.id);
    const fit = docRank == null ? titleFit : Math.max(titleFit, Math.max(minFit, 72 - Math.floor(docRank / 4)));
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
  /** Priced items on the contract whose names share a word with the request: "N matching products in Loci". */
  const asked = new Set(itemTokens.flatMap((w) => [w, ...(SAME_AS[w] ?? [])]));
  const matchingPriced = (c: CatalogContract) =>
    (idx.offeringsByContract.get(c.id) ?? []).filter((o) => o.price != null && tokens(idx.productById.get(o.product)?.name ?? "").some((w) => asked.has(w))).length;
  const rank = (x: (typeof scored)[number]) =>
    x.fit * 10 + (x.c.url ? 3 : 0) + (x.c.end ? 1 : 0) + (x.access.eligible ? 5 : 0) + (opts.category && x.c.category === opts.category ? 8 : 0) + (pricedOn(x.c) ? 4 : 0) +
    // New York law puts an approved preferred source ahead of a contract; a listed-but-not-approved one goes last.
    (x.c.state_contract?.preferred === "approved" ? 60 : x.c.state_contract?.preferred === "not_approved" ? -60 : 0);
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
    note: x.c.end || x.c.state_contract?.preferred ? null : "End date not published in the co-op's directory.",
    verification: "research_lead",
    link_out: { contract_id: x.c.id, coop: x.c.coop, has_link: Boolean(x.c.url) },
    products: matchingPriced(x.c),
    source: "catalog",
    end: x.c.end,
    directory_url: x.c.directory,
    ...(x.c.state_contract ? { program: "state" as const, trx: isTrxContract(x.c), solicitation: x.c.state_contract.solicitation, state: x.c.state_contract.state, ...(x.c.state_contract.preferred ? { preferred: x.c.state_contract.preferred } : {}) } : {}),
    ...(docHits.has(x.c.id) ? { found_in: { label: docHits.get(x.c.id)!.label, page: docHits.get(x.c.id)!.page, snippet: docHits.get(x.c.id)!.snippet } } : {}),
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
  /** On a TRX state contract (NJSTART): the route Loci prefers for that state's buyers. */
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
  /** How squarely the product is the thing asked for, 0 to 1 (kindMatch in lib/assistant.ts). */
  kind_match: number;
  /** Its role from the AI review, when coded: a part or an accessory ranks below the whole item. */
  role: CatalogProduct["role"] | null;
  /** Its kind from the AI review, when coded. */
  kind: string | null;
}

/** Products in the catalog that match a request, each with every contract that sells it. */
export function catalogProducts(db: Db, item: string, buyer: Buyer | null, limit = 8, opts: { kinds?: string[] } = {}): { hits: CatalogProductHit[]; total: number } {
  const idx = load();
  const itemTokens = requestTokens(item);
  // Kinds the request was read as (lib/dive-ai.ts): their products are candidates even when no word of the request is
  // in their names, and they are what was asked for.
  const chosen = new Set((opts.kinds ?? []).map((k) => k.toLowerCase()).filter((k) => idx.pByKind.has(k)));
  if (!itemTokens.length && !chosen.size) return { hits: [], total: 0 };
  const found: { i: number; fit: number }[] = [];
  const seen = new Set<number>();
  for (const i of candidates(idx.pIndex, itemTokens)) {
    seen.add(i);
    const fit = fitScoreSets(itemTokens, idx.pTitle[i], idx.pScope[i], idx.pWeights);
    const isKind = chosen.has((idx.products[i].kind ?? "").toLowerCase());
    if (fit >= 70 || isKind) found.push({ i, fit: isKind ? Math.max(fit, 90) : fit });
  }
  for (const k of chosen) for (const i of idx.pByKind.get(k) ?? []) if (!seen.has(i)) found.push({ i, fit: 90 });
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
      .sort((a, b) => Number(b.member) - Number(a.member) || Number(b.eligible) - Number(a.eligible) || Number(Boolean(buyer) && b.trx && b.eligible) - Number(Boolean(buyer) && a.trx && a.eligible) || (a.price ?? Infinity) - (b.price ?? Infinity));
    return { product_id: p.id, name: p.name, maker: p.maker, mpn: p.mpn, fit, review: p.review, routes, coverage: cover.get(i) ?? 0, kind_match: chosen.has((p.kind ?? "").toLowerCase()) ? 1 : kindMatch(itemTokens, idx.pKinds[i]), role: p.role ?? null, kind: p.kind ?? null };
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
      have.kind_match = Math.max(have.kind_match, h.kind_match);
    }
  }
  // The product that is the thing asked for first (a swing before a swing hanger), then fit, then whole items before
  // parts and accessories, then the name that says it most squarely.
  const whole = (h: CatalogProductHit) => (h.role === "part" || h.role === "accessory" ? 0 : 1);
  const hits = [...merged.values()]
    .sort((a, b) => b.kind_match - a.kind_match || b.fit - a.fit || whole(b) - whole(a) || b.coverage - a.coverage || priced(b) - priced(a) || b.routes.length - a.routes.length || a.name.localeCompare(b.name));
  return { hits: hits.slice(0, limit), total: hits.length };
}

/** Kinds of product in the catalog that a request could mean, for the model to choose among (lib/dive-ai.ts): those
 * whose kind or aliases share a word with the request, rarer words first, then those of the products the request's own
 * words find. Each with how many products are that kind and one product's name. */
export function catalogKindCandidates(db: Db, text: string, limit = 60): { kind: string; count: number; example: string }[] {
  const idx = load();
  const ask = new Set(requestTokens(text).flatMap((w) => [w, ...(SAME_AS[w] ?? [])]));
  const score = new Map<string, number>();
  for (const k of idx.kindList) {
    let s = 0;
    for (const w of k.words) if (ask.has(w)) s += idx.pWeights.get(w) ?? 1;
    if (s > 0) score.set(k.kind, s);
  }
  for (const h of catalogProducts(db, text, null, 80).hits) if (h.kind) score.set(h.kind.toLowerCase(), Math.max(score.get(h.kind.toLowerCase()) ?? 0, 0.5));
  const byKind = new Map(idx.kindList.map((k) => [k.kind, k]));
  return [...score.entries()]
    .sort((a, b) => b[1] - a[1] || byKind.get(b[0])!.count - byKind.get(a[0])!.count)
    .slice(0, limit)
    .map(([k]) => ({ kind: k, count: byKind.get(k)!.count, example: byKind.get(k)!.example }));
}

/** Whether a kind is one the catalog's products have. */
export const catalogHasKind = (kind: string) => load().pByKind.has(kind.toLowerCase());

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

/** The catalog's record for one of Loci's own suppliers: by website, then by company name. */
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

/** Turn a catalog supplier into a Loci supplier record, so it can be claimed and managed like any other. */
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
  /** Loci can read this kind of document today. */
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

// ------------------------------------------------------------------ browsing by category

/** A catalog product on the browse page: its best price on file and the contract that carries it. */
export interface BrowseItem {
  product_id: string;
  name: string;
  maker: string | null;
  mpn: string | null;
  /** The lowest price a buyer would pay across its contracts, or null when none publishes one. */
  price: number | null;
  unit: string | null;
  /** What the price is and when it's from, as the source labels it. */
  vintage: string | null;
  program: string;
  /** A state program's contract (a TRX one when trx), or a co-op's. */
  kind: "state" | "coop";
  trx: boolean;
  contract_id: string;
  contract_number: string;
  supplier: string;
  supplier_id: string;
  /** How many current contracts carry it. */
  contracts: number;
}
export interface BrowseCategory {
  name: string;
  products: number;
  priced: number;
  contracts: number;
}

const BROWSE_ORDER = ["Office supplies", "Furniture", "Janitorial", "IT hardware", "Software and services", "Facilities and MRO", "Fleet and parts", "Public works materials", "Safety and uniforms", "Professional services", "Other"];
/** NIGP classes that settle a category on their own (the classes state programs print). */
const NIGP_CATEGORY: [RegExp, string][] = [
  [/^(420|425)$/, "Furniture"],
  [/^(485|486)$/, "Janitorial"],
  [/^(600|615|620|630|640|645|655)$/, "Office supplies"],
  [/^(204|205|206|207|280|725|840)$/, "IT hardware"],
  [/^(208|209|920|915|962)$/, "Software and services"],
  [/^(060|065|070|071|075|405|570|928|968)$/, "Fleet and parts"],
  [/^(150|395|525|575|650|659|670|745|750|760|765|910|913)$/, "Public works materials"],
  [/^(200|201|340|345|680)$/, "Safety and uniforms"],
  [/^(918|924|925|946|948|952|958|961|975|988|990)$/, "Professional services"],
  [/^(035|155|285|450|470|485|720|740|780|909|914|936)$/, "Facilities and MRO"],
];
/** Words on the line a source filed a price under ("OFFICE FURNITURE", "Restroom products"). */
const WORD_CATEGORY: [RegExp, string][] = [
  [/furniture|seating|chair|desk|\btables?\b|bookcase|filing cabinet|lockers?/i, "Furniture"],
  [/janitorial|cleaning|cleaner|restroom|trash|mop|broom|paper towel|tissue|soap|disinfect/i, "Janitorial"],
  [/office supplies|stationery|paper\b|envelope|toner|ink\b|pens?\b|pencil|binder|folder|label/i, "Office supplies"],
  [/computer|laptop|desktop|monitor|printer|server|network|tablet|telecom|phone/i, "IT hardware"],
  [/software|license|subscription|saas|cloud/i, "Software and services"],
  [/vehicle|truck|\bbus(es)?\b|tires?\b|fleet|automotive|auto parts|fuel|diesel|gasoline/i, "Fleet and parts"],
  [/salt|deicer|asphalt|aggregate|concrete|pipe|culvert|road|highway|sign(s|age)?\b|traffic|playground|park/i, "Public works materials"],
  [/safety|uniform|apparel|textile|glove|vest|boots?\b|helmet|protective|first aid/i, "Safety and uniforms"],
  [/consult|staffing|services?\b|engineering|audit|training|legal|appraisal|inspection/i, "Professional services"],
  [/hvac|plumbing|electrical|lighting|lamp|hardware|tools?\b|maintenance|repair|mro|lumber|paint/i, "Facilities and MRO"],
];
/** A product's category: its contract's, else the contract's NIGP class, else the words its price was filed under. */
function browseCategoryOf(c: CatalogContract, o?: CatalogOffering): string {
  if (c.category && c.category !== "Other" && BROWSE_ORDER.includes(c.category)) return c.category;
  for (const cls of c.nigp?.classes ?? []) for (const [re, cat] of NIGP_CATEGORY) if (re.test(cls)) return cat;
  const text = `${o?.category ?? ""} ${c.title}`;
  for (const [re, cat] of WORD_CATEGORY) if (re.test(text)) return cat;
  return "Other";
}

interface BrowseIndex {
  categories: BrowseCategory[];
  /** Each category's products, priced first, then by name. */
  byCategory: Map<string, BrowseItem[]>;
}
function browseIndex(): BrowseIndex {
  const g = globalThis as unknown as { __agoraBrowse?: BrowseIndex };
  if (g.__agoraBrowse) return g.__agoraBrowse;
  const idx = load();
  const byCategory = new Map<string, BrowseItem[]>(BROWSE_ORDER.map((c) => [c, []]));
  const contractsIn = new Map<string, number>(BROWSE_ORDER.map((c) => [c, 0]));
  // Counted the way the contract explorer filters them (its category field), so the browse page's link lands on the same number.
  for (const c of idx.contracts) if (!expired(c) && c.category && contractsIn.has(c.category)) contractsIn.set(c.category, contractsIn.get(c.category)! + 1);
  for (const p of idx.products) {
    const offers = (idx.offeringsByProduct.get(p.id) ?? []).filter((o) => {
      const c = idx.contractById.get(o.contract);
      return c && !expired(c);
    });
    if (!offers.length) continue;
    // The best route: the lowest payable price, else the first listing.
    const priced = offers.filter((o) => o.price != null).sort((a, b) => a.price! - b.price!);
    const best = priced[0] ?? offers[0];
    const c = idx.contractById.get(best.contract)!;
    const cat = browseCategoryOf(c, best);
    byCategory.get(cat)!.push({
      product_id: p.id,
      name: p.name,
      maker: p.maker,
      mpn: p.mpn,
      price: best.price,
      unit: best.unit,
      vintage: best.vintage,
      program: c.coop,
      kind: c.state_contract ? "state" : "coop",
      trx: isTrxContract(c),
      contract_id: c.id,
      contract_number: c.number,
      supplier: idx.supplierById.get(best.supplier)?.name ?? "",
      supplier_id: best.supplier,
      contracts: new Set(offers.map((o) => o.contract)).size,
    });
  }
  for (const list of byCategory.values()) list.sort((a, b) => Number(b.price != null) - Number(a.price != null) || a.name.localeCompare(b.name));
  const categories = BROWSE_ORDER.map((name) => ({ name, products: byCategory.get(name)!.length, priced: byCategory.get(name)!.filter((x) => x.price != null).length, contracts: contractsIn.get(name) ?? 0 }));
  return (g.__agoraBrowse = { categories, byCategory });
}

/** Every category with its product and contract counts. */
export const catalogBrowseCategories = (): BrowseCategory[] => browseIndex().categories;

/** One category's products, a page at a time, optionally filtered by words in the name, maker, part number or supplier. */
export function catalogBrowse(category: string, q: string, offset: number, limit: number): { total: number; items: BrowseItem[] } {
  const list = browseIndex().byCategory.get(category) ?? [];
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const matching = words.length ? list.filter((x) => words.every((w) => `${x.name} ${x.maker ?? ""} ${x.mpn ?? ""} ${x.supplier}`.toLowerCase().includes(w))) : list;
  return { total: matching.length, items: matching.slice(offset, offset + limit) };
}

/** The catalog's size for the home page: current contracts, the companies holding them, products, and programs. */
export function catalogTotals(): { contracts: number; suppliers: number; products: number; priced: number; programs: number } {
  const g = globalThis as unknown as { __agoraTotals?: ReturnType<typeof catalogTotals> };
  if (g.__agoraTotals) return g.__agoraTotals;
  const idx = load();
  const current = idx.contracts.filter((c) => !expired(c));
  const cats = browseIndex().categories;
  return (g.__agoraTotals = {
    contracts: current.length,
    suppliers: new Set(current.map((c) => c.supplier)).size,
    products: cats.reduce((n, c) => n + c.products, 0),
    priced: cats.reduce((n, c) => n + c.priced, 0),
    programs: new Set(current.map((c) => c.coop)).size,
  });
}
