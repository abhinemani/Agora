// The "ask, don't browse" layer: parse a plain-language request, match it to
// listings from every source, rank them, and apply the agency's buying rules.

import * as z from "zod/v4";
import { kept, structured } from "./llm";
import { CATEGORIES } from "./types";
import type { Buyer, Category, Contract, Db, Listing, ParsedRequest, PeerPurchase, Request, Solicitation, Source, Supplier } from "./types";
import type { CatalogProductHit } from "./catalog";
import { checkEligibility, defaultVariant, familyOf, SOURCEWELL_TYLER_NOTES } from "./vehicles";
import { settingsFor } from "./agency";
import { canSponsor, listingVisible, sponsoredFor } from "./suppliers";
import { coopOf, isContractLevelUrl, linksOut, membershipsFor, onCoopContract } from "./coops";

export const SOURCE_ORDER: Source[] = ["own_contract", "state_contract", "coop_contract", "reseller", "gsa", "no_approval"];

export const SOURCE_LABEL: Record<Source, string> = {
  own_contract: "Agency contract",
  state_contract: "State contract",
  coop_contract: "Co-op contract",
  reseller: "Reseller",
  gsa: "GSA schedule",
  no_approval: "No approval needed",
};

// ---------------------------------------------------------------- tokenizing

const STOP = new Set(
  "a an the of for and or with to in on at by from some new need needs we our my i us please get buy order want ft in x unit units each dozen box boxes case cases pack packs pk set sets ea about around approx roughly online software".split(" "),
);

function singular(w: string) {
  if (w.length > 4 && w.endsWith("ies")) return w.slice(0, -3) + "y";
  if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss")) return w.slice(0, -1);
  return w;
}

/** Light stemming so "management" meets "manager" and "permitting" meets
 * "permit". Applied to both sides of every comparison. */
/** Words whose suffix is part of the meaning: "customer" is not "custom". */
const NO_STEM = new Set(["customer", "customers", "center", "centers", "water", "paper", "computer", "computers", "printer", "printers", "monitor", "monitors"]);

function stem(w: string) {
  if (w.length <= 4 || NO_STEM.has(w)) return w;
  let s = w.replace(/(ments|ment|ings|ing|ions|ion|ers|er|ed)$/, "");
  if (s.length < 3) s = w;
  s = s.replace(/e$/, "");
  if (/([bdgklmnprt])\1$/.test(s)) s = s.slice(0, -1);
  return s;
}

export function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/[\s-]+/)
    .filter((w) => w && !STOP.has(w) && !/^\d+$/.test(w))
    .map((w) => stem(singular(w)));
}

export type Weights = Map<string, number>;

function score(itemTokens: string[], title: string, weights?: Weights) {
  const t = new Set(tokens(title));
  return itemTokens.filter((w) => t.has(w)).reduce((n, w) => n + (weights ? (weights.get(w) ?? 0) : 1), 0);
}

/** Rarer words count for more (inverse document frequency), so "permitting"
 * decides a match and "software" barely does. Cached per listing set. */
let idfCache: { rows: unknown[]; size: number; weights: Weights } | null = null;
function idf<T>(rows: T[], textOf: (r: T) => string): Weights {
  if (idfCache && idfCache.rows === rows && idfCache.size === rows.length) return idfCache.weights;
  const df = new Map<string, number>();
  for (const r of rows) for (const w of new Set(tokens(textOf(r)))) df.set(w, (df.get(w) ?? 0) + 1);
  const n = rows.length;
  const weights: Weights = new Map([...df].map(([w, d]) => [w, Math.log((n + 1) / (d + 1)) + 0.1]));
  idfCache = { rows, size: rows.length, weights };
  return weights;
}

/** Share of a listing's name the request covers, ignoring tier qualifiers in
 * parentheses, so the core product ("Enterprise Jury Manager") outranks its
 * add-ons and fine print. Rounded so near-ties fall through to price. */
function coverage(itemTokens: string[], title: string) {
  const t = tokens(title.replace(/\([^)]*\)/g, " "));
  if (!t.length) return 0;
  const hit = t.filter((w) => itemTokens.includes(w)).length;
  return Math.round((hit / t.length) * 20) / 20;
}

function bestMatches<T>(itemTokens: string[], rows: T[], titleOf: (r: T) => string, weights?: Weights) {
  let scored = rows.map((r) => ({ r, s: score(itemTokens, titleOf(r), weights), n: score(itemTokens, titleOf(r)) }));
  if (weights) {
    // Breadth first: products matching more of the request's words beat one rare
    // word ("open data platform" over "turnkey portal" for "open data portal").
    const most = Math.max(0, ...scored.map((x) => x.n));
    if (most >= 2) scored = scored.filter((x) => x.n >= most);
  }
  const best = Math.max(0, ...scored.map((x) => x.s));
  if (best === 0) return { rows: [] as T[], best };
  const floor = weights ? best * 0.67 : Math.max(1, Math.ceil(best * 0.67));
  if (weights) {
    // A match must cover a fair share of what was asked: one common word
    // ("tracking") out of "snowplow GPS route tracking" is not a match. Words
    // the catalog never uses count as the rarest.
    const rarest = Math.max(1, ...weights.values());
    const asked = itemTokens.reduce((n, w) => n + (weights.get(w) ?? rarest), 0);
    if (asked > 0 && best / asked < 0.35) return { rows: [] as T[], best: 0 };
  }
  return { rows: scored.filter((x) => x.s >= floor).map((x) => x.r), best };
}

/** Words catalogs use interchangeably; a contract naming either covers the other. */
export const SAME_AS: Record<string, string[]> = { laptop: ["notebook"], notebook: ["laptop"], pc: ["computer"], computer: ["pc"] };

/** Fit score, 0 to 100: how much of the request a contract or product covers.
 * Words named in its title count fully; words found only in its wider scope
 * count 70%, since a broad contract ("technology products") covers a need less
 * squarely than one built for it ("desktops, laptops, tablets"). Rarer words
 * weigh more. Sponsorship never enters this score. */
export function fitScore(itemTokens: string[], title: string, scope: string, weights: Weights): number {
  return fitScoreSets(itemTokens, new Set(tokens(title)), new Set(tokens(scope)), weights);
}

/** The same score from words already tokenized, for indexes that tokenize once (lib/catalog.ts). */
const rarestCache = new WeakMap<Weights, number>();
/** The weight of the rarest word: what a word the catalog never uses counts for. Cached, since catalogs are large. */
function rarestOf(weights: Weights): number {
  let r = rarestCache.get(weights);
  if (r === undefined) {
    r = 1;
    for (const v of weights.values()) if (v > r) r = v;
    rarestCache.set(weights, r);
  }
  return r;
}

export function fitScoreSets(itemTokens: string[], inTitle: Set<string>, inScope: Set<string>, weights: Weights): number {
  if (!itemTokens.length) return 0;
  const has = (set: Set<string>, w: string) => set.has(w) || (SAME_AS[w] ?? []).some((x) => set.has(x));
  const rarest = rarestOf(weights);
  let asked = 0;
  let got = 0;
  for (const w of new Set(itemTokens)) {
    const weight = weights.get(w) ?? rarest;
    asked += weight;
    if (has(inTitle, w)) got += weight;
    else if (has(inScope, w)) got += weight * 0.7;
  }
  return asked ? Math.round((100 * got) / asked) : 0;
}

// ---------------------------------------------------------------- parsing

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

const DEPARTMENT_HINTS: [RegExp, string][] = [
  [/rec center|recreation|park|pool|ice rink|rink|arena|playground|senior center|community center/i, "Parks and Recreation"],
  [/front desk|city hall|clerk|council|reception|admin|court|jury|budget|finance/i, "City Hall Administration"],
  [/police|officer|patrol|station/i, "Police"],
  [/library|branch/i, "Library"],
  [/road|street|crew|public works|yard|fleet|water|sewer/i, "Public Works"],
];

const CATEGORY_HINTS: [RegExp, Category][] = [
  [/\b(table|chair|desk|cabinet|furniture|seating|bench)/i, "Furniture"],
  [/\b(pencil|pen|paper|stapler|notes|toner|ink|binder|folder|whiteboard|coffee|cup)/i, "Office supplies"],
  [/\b(clean|soap|trash|liner|mop|towel|janitorial|custodial|disinfect)/i, "Janitorial"],
  [/\b(laptop|monitor|computer|tablet|printer|switch|dock|keyboard)/i, "IT hardware"],
  [/\b(software|license|saas|subscription)/i, "Software and services"],
  [/\b(led|light|lighting|retrofit|hvac|roof|plumbing|electrical|refrigerat|fixture)/i, "Facilities and MRO"],
  [/\b(vehicle|truck|tire|brake|fleet|plow)/i, "Fleet and parts"],
  [/\b(asphalt|concrete|gravel|pipe|culvert|surfacing)/i, "Public works materials"],
  [/\b(vest|hard hat|glove|uniform|safety|first aid|jacket)/i, "Safety and uniforms"],
  [/\b(consult|engineering|design services|audit|inspection)/i, "Professional services"],
];

const WORD_NUMBERS: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, ten: 10, twelve: 12, dozen: 12, twenty: 20 };

/** The noun phrase before any purpose / delivery clause: "40 folding tables". */
function itemPhrase(text: string) {
  const head = text.split(/,|\bfor\b|\bdelivered\b|\bby\b|\bbefore\b|\bneeded\b|\bto be\b|\bso\b/i)[0];
  return head
    .replace(/^\s*(i|we)\s+(need|want|would like)\s+/i, "")
    .replace(/^\s*(please\s+)?(get|buy|order)\s+/i, "")
    .replace(/^\s*[\d,]+\s*/, "")
    .replace(/^\s*(a|an|some|one|two|three|four|five|six|ten|twelve|twenty)\s+/i, "")
    .replace(/^\s*(dozen|box|boxes|case|cases|pack|packs)\s+of\s+/i, "")
    .trim();
}

function offlineParse(text: string, db: Db): Omit<ParsedRequest, "est_total"> {
  const qtyNum = text.match(/\b(\d[\d,]*)\b(?!\s*(st|nd|rd|th)\b)/);
  const qtyWord = text.toLowerCase().match(/\b(a|an|one|two|three|four|five|six|ten|twelve|twenty|dozen)\b/);
  // Whichever comes first wins: "two 24 inch monitors" is 2, "40 folding tables" is 40.
  const wordFirst = qtyWord && (!qtyNum || (qtyWord.index ?? 0) < (qtyNum.index ?? 0));
  const quantity = wordFirst ? WORD_NUMBERS[qtyWord![1]] : qtyNum ? parseInt(qtyNum[1].replace(/,/g, ""), 10) : 1;

  const dl = text.match(/\b(before|by|until|no later than)\s+([a-z]+(?:\s+\d{1,2})?)/i);
  const deadline = dl && MONTHS.includes(dl[2].split(/\s+/)[0].toLowerCase()) ? `${dl[1]} ${dl[2]}` : null;

  const department = DEPARTMENT_HINTS.find(([re]) => re.test(text))?.[1] ?? db.agency.departments[0].name;
  const item = itemPhrase(text) || text;
  const category = CATEGORY_HINTS.find(([re]) => re.test(expand(item)))?.[1] ?? null;
  return { item, quantity: Math.max(1, quantity), deadline, department, category };
}

const ParsedSchema = z.object({
  item: z.string().describe("The thing being bought, as a short noun phrase without quantity, e.g. 'folding table'"),
  quantity: z.number().int().describe("How many units. 1 if unstated."),
  deadline: z.string().nullable().describe("Delivery constraint in the buyer's words, e.g. 'before March', or null"),
  department: z.string().describe("Which agency department this is for"),
  category: z.enum(CATEGORIES).nullable(),
});

export async function parseRequest(text: string, db: Db): Promise<{ parsed: Omit<ParsedRequest, "est_total">; mode: "llm" | "offline" }> {
  const depts = db.agency.departments.map((d) => d.name);
  const llm = await structured({
    task: "request_parse",
    about: text,
    system:
      `You parse purchase requests from staff at ${db.agency.name}, a local government. ` +
      `Departments: ${depts.join(", ")}. Pick the department the request implies; default to ${depts[0]}. ` +
      `Categories: ${CATEGORIES.join(", ")}.`,
    user: text,
    schema: ParsedSchema,
    maxTokens: 2000,
    timeoutMs: 20_000,
  });
  if (llm) {
    // Nothing to check against: the reading is taken as given, and the confirm step lets the buyer correct it.
    kept(llm, JSON.stringify(llm));
    return {
      mode: "llm",
      parsed: {
        ...llm,
        quantity: Math.max(1, llm.quantity),
        department: depts.includes(llm.department) ? llm.department : depts[0],
      },
    };
  }
  return { mode: "offline", parsed: offlineParse(text, db) };
}

export function mentionsPreference(text: string) {
  return /\b(local|mbe|minority|women[- ]owned|wbe|small business|sustainab|green|recycled)\b/i.test(text);
}

// ---------------------------------------------------------------- matching

export interface RuleLine {
  text: string;
  payment: "pcard" | "po";
}

export function ruleFor(db: Db, listing: Listing, quantity: number): RuleLine {
  const total = listing.unit_price * quantity;
  const limit = db.agency.quick_buy_threshold;
  const k = `$${Math.round(limit / 1000)}K`;
  if (listing.source === "no_approval") {
    return total < limit
      ? { text: "Small purchase, no contract required · P-card OK", payment: "pcard" }
      : { text: `Over ${k}: needs a contract or a solicitation`, payment: "po" };
  }
  const contract = db.contracts.find((c) => c.id === listing.contract_id);
  const via =
    listing.source === "coop_contract" || listing.source === "gsa" || listing.source === "reseller"
      ? ` · Piggyback via ${contract?.contract_number ?? "contract"}`
      : "";
  return total < limit
    ? { text: `Under ${db.session.buyer ? "your" : "a typical"} ${k} quick-buy limit · P-card OK${via}`, payment: "pcard" }
    : { text: `Needs PO · over ${k}${via}`, payment: "po" };
}

function deadlineDate(deadline: string | null): Date | null {
  if (!deadline) return null;
  const m = MONTHS.findIndex((mo) => deadline.toLowerCase().includes(mo));
  if (m < 0) return null;
  const now = new Date();
  let year = now.getFullYear();
  if (m <= now.getMonth()) year += 1;
  return new Date(year, m, 1);
}

export interface ResultOption {
  listing: Listing;
  supplier: Supplier;
  contract_number: string | null;
  total: number;
  rule: RuleLine;
  delivery: string;
  meets_deadline: boolean | null;
  sponsored: boolean;
  pref_fit: number;
  /** Other tiers of the same product the buyer may choose between. */
  variants: Listing[];
  /** Purchasing program, e.g. "NJSTART". */
  vehicle: string | null;
  /** Source group the card is shown under (a quote route's, when it has one). */
  group: Source;
  /** Set when the listing's own contract is closed to this buyer but the same
   * supplier's co-op award is open: buy there by quote, price shown for reference. */
  quote_route: { contract_id: string; vehicle: string; contract_number: string; reference: string; research_note: string | null } | null;
  /** Set when this route is bought on the co-op's own contract page, through the tracked redirect. */
  link_out: LinkOut | null;
  /** 0 to 100: how much of the request this product covers. */
  fit: number;
  /** For co-op routes: whether the agency belongs to that co-op. Null for other sources. */
  member: boolean | null;
}

/** A contract from the agency's own register that covers the request. */
export interface OwnHit {
  contract_id: string;
  title: string;
  vendor: string;
  supplier_id: string;
  contract_number: string;
  end: string;
  ceiling: number | null;
  url: string | null;
  fit: number;
}

/** A co-op contract that covers the request, shown in the co-op section of results. */
export interface CoopHit {
  contract_id: string;
  coop_id: string;
  coop: string;
  contract_number: string;
  title: string;
  supplier: string;
  supplier_id: string;
  fit: number;
  /** The agency belongs to this co-op (detected or confirmed). */
  member: boolean;
  eligible: boolean;
  reason: string;
  /** A note to read alongside, e.g. a research-lead discount or an unconfirmed term. */
  note: string | null;
  verification: Contract["verification"];
  link_out: LinkOut | null;
  /** Products Agora holds for this contract that match the request. */
  products: number;
  /** "catalog": from the co-op catalog (lib/catalog.ts), a co-op's own contract directory. */
  source?: "catalog";
  end?: string | null;
  /** The co-op's directory page, when it publishes no page per contract. */
  directory_url?: string | null;
  /** "state": a state contract (NJSTART), not a co-op's. */
  program?: "state";
  /** A state contract in a TRX state, the route Agora prefers for that state's buyers (lib/trx.ts). */
  trx?: boolean;
  /** The state solicitation it was awarded under (e.g. T2187), shared by every supplier on the award. */
  solicitation?: string | null;
  /** The state whose contract it is (state contracts only). */
  state?: string;
}

export interface CoopSection {
  hits: CoopHit[];
  /** The agency has told Agora (or Agora detected) at least one membership. */
  memberships_known: boolean;
  /** A co-op the agency isn't on fits better than every co-op it is on. */
  better: { hit: CoopHit; than: CoopHit | null } | null;
  /** The co-op catalog's share of the section: what's shown, what else matched, and the GSA lane. */
  catalog?: { retrieved: string; more_member: number; more_other: number; gsa: CoopHit[]; gsa_total: number; state: CoopHit[]; state_total: number; state_retrieved?: Record<string, string> };
  /** What the buyer's state law says about using co-op contracts (lib/state-rules.ts). */
  state_rule?: import("./state-rules").BuyerStateRule | null;
}

export interface LinkOut {
  contract_id: string;
  coop: string;
  /** False when no contract-level link is on file (a data defect). */
  has_link: boolean;
}

function linkOutFor(db: Db, c: Contract | undefined): LinkOut | null {
  if (!c || !linksOut(db, c)) return null;
  return { contract_id: c.id, coop: coopOf(db, c)?.name ?? c.vehicle ?? c.owner, has_link: isContractLevelUrl(c.source_url) };
}

export interface Unavailable {
  /** Master agreement the contract was adopted from, which other states may also have adopted. */
  master_agreement: string | null;
  vehicle: string;
  contract_number: string;
  owner: string;
  reason: string;
  products: number;
  examples: string[];
}

export interface ResultGroup {
  source: Source;
  label: string;
  options: ResultOption[];
}

export interface Results {
  request: Request;
  groups: ResultGroup[];
  peer: (PeerPurchase & { supplier_name: string }) | null;
  no_match: boolean;
  similar_solicitation: Solicitation | null;
  explanation: string[];
  buyer: Buyer | null;
  /** Matches on contracts this buyer can't use, grouped by contract. */
  unavailable: Unavailable[];
  /** Contracts that cover the request but carry no loaded prices: buy by quote. */
  contract_leads: ContractLead[];
  /** Co-op contracts that cover the request, split by the agency's memberships. */
  coops: CoopSection;
  /** Contracts in the agency's own register that cover the request: shown first. */
  own_contracts: OwnHit[];
  /** Matching contracts past their end date, hidden unless the buyer asks. */
  expired: Unavailable[];
  /** Products in the co-op catalog that match, each with every contract that sells it (lib/catalog.ts). */
  catalog_products?: { hits: CatalogProductHit[]; total: number; retrieved: string };
}

export interface ContractLead {
  contract_id: string;
  supplier_id: string;
  supplier: string;
  vehicle: string;
  contract_number: string;
  title: string;
  eligible: boolean;
  reason: string;
  link_out: LinkOut | null;
}

const contractText = (db: Db, c: Contract) => `${c.title} ${c.scope ?? ""} ${c.vehicle ?? ""} ${db.suppliers.find((s) => s.id === c.supplier_id)?.name ?? ""}`;

const isExpired = (c: Contract) => Boolean(c.end && c.end < new Date().toISOString().slice(0, 10));

/** The agency's own register contracts that cover the request, and the expired ones among them. */
function ownContracts(db: Db, itemTokens: string[], buyer: Buyer | null) {
  if (!buyer) return { hits: [] as OwnHit[], expired: [] as Unavailable[] };
  const weights = idf(db.contracts, (c) => contractText(db, c));
  const hits: OwnHit[] = [];
  const expired: Unavailable[] = [];
  for (const c of db.contracts.filter((c) => c.register_of === buyer.name)) {
    const fit = fitScore(itemTokens, c.title, c.scope ?? "", weights);
    if (fit < 50) continue;
    const vendor = db.suppliers.find((s) => s.id === c.supplier_id)?.name ?? "";
    if (isExpired(c)) {
      expired.push({ master_agreement: null, vehicle: buyer.name, contract_number: c.contract_number, owner: vendor, reason: checkEligibility(c, buyer).reason, products: 0, examples: [c.title] });
      continue;
    }
    hits.push({ contract_id: c.id, title: c.title, vendor, supplier_id: c.supplier_id, contract_number: c.contract_number, end: c.end, ceiling: c.ceiling ?? null, url: c.source_url ?? null, fit });
  }
  return { hits: hits.sort((a, b) => b.fit - a.fit), expired };
}

/** Co-op contracts covering the request: by their own scope, or by the products Agora holds for them. */
function coopSection(db: Db, itemTokens: string[], buyer: Buyer | null, matched: Listing[]): CoopSection {
  const agency = buyer?.name ?? null;
  const cWeights = idf(db.contracts, (c) => contractText(db, c));
  const lWeights = idf(db.listings, listingText);
  const hits: CoopHit[] = [];
  for (const c of db.contracts) {
    const coop = coopOf(db, c);
    if (!coop) continue;
    if (c.end && c.end < new Date().toISOString().slice(0, 10)) continue;
    const supplier = db.suppliers.find((s) => s.id === c.supplier_id);
    const own = fitScore(itemTokens, c.title, `${c.scope ?? ""} ${supplier?.name ?? ""}`, cWeights);
    // A contract's products count toward its fit; a whole-catalog award covers the supplier's products.
    const products = matched.filter((l) => l.contract_id === c.id || (c.covers_supplier_catalog && l.supplier_id === c.supplier_id));
    const viaProducts = Math.max(0, ...products.map((l) => fitScore(itemTokens, l.title, l.keywords ?? "", lWeights)));
    const fit = Math.max(own, viaProducts);
    if (fit < 35) continue;
    const e = checkEligibility(c, buyer);
    hits.push({
      contract_id: c.id,
      coop_id: coop.id,
      coop: coop.name,
      contract_number: c.contract_number,
      title: c.title,
      supplier: supplier?.name ?? "",
      supplier_id: c.supplier_id,
      fit,
      member: onCoopContract(db, buyer, c),
      eligible: e.eligible,
      reason: e.reason,
      note: c.relation_note ?? null,
      verification: c.verification,
      link_out: linkOutFor(db, c),
      products: new Set(products.map((l) => l.family ?? l.id)).size,
    });
  }
  return finishCoopSection(db, hits, agency);
}

/** Order co-op hits (the agency's co-ops first, then open ones, then by fit) and flag a better fit elsewhere. */
export function finishCoopSection(db: Db, hits: CoopHit[], agency: string | null): CoopSection {
  // A TRX state contract the buyer can use comes before any co-op contract (lib/trx.ts).
  const trx = (h: CoopHit) => Number(Boolean(h.trx && h.eligible));
  hits.sort((a, b) => trx(b) - trx(a) || Number(b.member) - Number(a.member) || Number(b.eligible) - Number(a.eligible) || b.fit - a.fit || a.coop.localeCompare(b.coop));
  const memberships_known = membershipsFor(db, agency).length > 0 || hits.some((h) => h.member);
  const bestMember = hits.filter((h) => h.member && h.eligible).sort((a, b) => b.fit - a.fit)[0] ?? null;
  const bestOther = hits.filter((h) => !h.member && h.eligible && !h.program).sort((a, b) => b.fit - a.fit)[0] ?? null;
  // Flag only a real gap: a clearly better fit on a co-op the agency hasn't joined.
  const better = memberships_known && bestOther && (!bestMember || bestOther.fit >= bestMember.fit + 10) ? { hit: bestOther, than: bestMember } : null;
  return { hits, memberships_known, better };
}

/** Contracts with no line items loaded whose scope matches the request. */
function contractLeads(db: Db, itemTokens: string[], buyer: Buyer | null): ContractLead[] {
  const priced = new Set(db.listings.map((l) => l.contract_id));
  // Co-op contracts have their own section; these are the other quote-only contracts.
  const bare = db.contracts.filter((c) => !priced.has(c.id) && c.pricing_basis !== "discount_from_list" && !coopOf(db, c) && !c.register_of && !isExpired(c));
  if (!bare.length) return [];
  const weights = idf(db.contracts, (c) => contractText(db, c));
  const { rows } = bestMatches(itemTokens, bare, (c) => contractText(db, c), weights);
  return rows
    .map((c) => {
      const e = checkEligibility(c, buyer);
      return {
        contract_id: c.id,
        supplier_id: c.supplier_id,
        supplier: db.suppliers.find((s) => s.id === c.supplier_id)?.name ?? "",
        vehicle: c.vehicle ?? c.owner,
        contract_number: c.contract_number,
        title: c.title,
        eligible: e.eligible,
        reason: e.reason,
        link_out: linkOutFor(db, c),
      };
    })
    .sort((a, b) => Number(b.eligible) - Number(a.eligible));
}

/** Quote-only contracts that would have matched but have expired. */
function expiredLeads(db: Db, itemTokens: string[]): Unavailable[] {
  const priced = new Set(db.listings.map((l) => l.contract_id));
  const gone = db.contracts.filter((c) => isExpired(c) && !priced.has(c.id) && !c.register_of);
  if (!gone.length) return [];
  const weights = idf(db.contracts, (c) => contractText(db, c));
  const { rows } = bestMatches(itemTokens, gone, (c) => contractText(db, c), weights);
  return rows.map((c) => ({
    master_agreement: c.master_agreement ?? null,
    vehicle: c.vehicle ?? c.owner,
    contract_number: c.contract_number,
    owner: db.suppliers.find((s) => s.id === c.supplier_id)?.name ?? c.owner,
    reason: checkEligibility(c, null).reason,
    products: 0,
    examples: [c.title],
  }));
}

function fmtDate(d: Date) {
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

const listingText = (l: Listing) => `${l.title} ${l.keywords ?? ""}`;

export function estimateTotal(db: Db, item: string, quantity: number) {
  const itemTokens = tokens(expand(item));
  const weights = idf(db.listings, listingText);
  const { rows } = bestMatches(itemTokens, db.listings, listingText, weights);
  if (!rows.length) return 0;
  // Estimate from the closest matches only, so a catalog's cheap add-ons
  // ($0.05 text messages) don't drag the estimate for the core product.
  const byName = (l: Listing) => Math.round(score(itemTokens, l.title, weights) * 10);
  const topName = Math.max(...rows.map(byName));
  const named = rows.filter((l) => byName(l) === topName);
  const topCover = Math.max(...named.map((l) => coverage(itemTokens, l.title)));
  const core = named.filter((l) => coverage(itemTokens, l.title) >= topCover - 0.2);
  const prices = core.map((r) => r.unit_price).sort((a, b) => a - b);
  return Math.round(prices[Math.floor(prices.length / 2)] * quantity * 100) / 100;
}

/** Common phrases buyers use for products catalogs name by abbreviation. */
const SYNONYMS: [RegExp, string][] = [
  [/computer[- ]aided dispatch/gi, "CAD"],
];
const expand = (item: string) => SYNONYMS.reduce((t, [re, to]) => t.replace(re, to), item);
/** The words a request is matched on, synonyms spelled out ("CAD" → "computer aided dispatch"). */
export const requestTokens = (item: string) => tokens(expand(item));

export function buildResults(db: Db, request: Request): Results {
  const { parsed } = request;
  const itemTokens = tokens(expand(parsed.item));
  // Product names use plain words ("Computer-aided dispatch: police"), so names
  // are scored on the buyer's own words and the spelled-out synonyms too.
  const nameTokens = [...new Set([...itemTokens, ...tokens(parsed.item), ...tokens(parsed.item.replace(/\bCAD\b/gi, "computer aided dispatch"))])];
  const favor = request.preference_answer === "yes";
  const limit = db.agency.quick_buy_threshold;

  // Agora searches every listing; a city marketplace is a view onto the same catalog.
  // Off-contract listings appear only while the supplier's listing fee is current.
  const catalog = db.listings.filter((l) => listingVisible(db, l));
  const weights = idf(db.listings, listingText);
  const { rows: found } = bestMatches(itemTokens, catalog, listingText, weights);
  // When the request implies a category and some matches are in it, keep those:
  // "24 inch monitors" means hardware, not monitoring software.
  const inCategory = parsed.category ? found.filter((l) => l.category === parsed.category) : [];
  const relevant = inCategory.length ? inCategory : found;
  // Only routes this buyer may use; the rest are summarized, not hidden silently.
  const buyer = db.session.buyer;
  const contractOf = (l: Listing) => db.contracts.find((c) => c.id === l.contract_id);
  const matched = relevant.filter((l) => checkEligibility(contractOf(l), buyer).eligible);
  // A closed contract's product may still be buyable through the supplier's
  // open co-op award (priced off list, so by quote).
  const quoteRouteFor = (l: Listing) =>
    db.contracts.find((c) => c.supplier_id === l.supplier_id && c.covers_supplier_catalog && c.id !== l.contract_id && checkEligibility(c, buyer).eligible);
  const viaQuote = relevant.filter((l) => !checkEligibility(contractOf(l), buyer).eligible && quoteRouteFor(l));
  const blockedByContract = new Map<string, Listing[]>();
  for (const l of relevant)
    if (!checkEligibility(contractOf(l), buyer).eligible && !quoteRouteFor(l)) blockedByContract.set(l.contract_id!, [...(blockedByContract.get(l.contract_id!) ?? []), l]);
  const blocked: Unavailable[] = [...blockedByContract].map(([cid, ls]) => {
    const c = db.contracts.find((x) => x.id === cid)!;
    const families = [...new Map(ls.map((l) => [l.family ?? l.id, l.title])).values()];
    return { master_agreement: c.master_agreement ?? null, vehicle: c.vehicle ?? c.owner, contract_number: c.contract_number, owner: c.owner, reason: checkEligibility(c, buyer).reason, products: families.length, examples: families.slice(0, 2) };
  });

  // Expired contracts are hidden by default; the buyer can still ask to see them.
  const expiredNumbers = new Set(db.contracts.filter(isExpired).map((c) => `${c.vehicle ?? c.owner}|${c.contract_number}`));
  const unavailable = blocked.filter((u) => !expiredNumbers.has(`${u.vehicle}|${u.contract_number}`));
  const expiredBlocked = blocked.filter((u) => expiredNumbers.has(`${u.vehicle}|${u.contract_number}`));

  const due = deadlineDate(parsed.deadline);
  const optWeights = idf(db.listings, listingText);
  // A paid agency may turn sponsored placements off for its staff.
  const adFree = buyer ? settingsFor(db, buyer.name).ad_free : false;
  const optionFor = (l: Listing): ResultOption => {
      const supplier = db.suppliers.find((s) => s.id === l.supplier_id)!;
      const arrives = new Date(Date.now() + l.lead_time_days * 86_400_000);
      const meets = due ? arrives <= due : null;
      const pref_fit = (supplier.is_local ? 1 : 0) + (supplier.certifications.length ? 1 : 0);
      return {
        listing: l,
        supplier,
        contract_number: db.contracts.find((c) => c.id === l.contract_id)?.contract_number ?? null,
        total: Math.round(l.unit_price * parsed.quantity * 100) / 100,
        rule: ruleFor(db, l, parsed.quantity),
        delivery: `${l.category === "Software and services" || l.category === "Professional services" ? "Available by" : "Arrives by"} ${fmtDate(arrives)}${meets === null ? "" : meets ? ` · meets your ${parsed.deadline} deadline` : ` · misses your ${parsed.deadline} deadline`}`,
        meets_deadline: meets,
        // Sponsored by a placement matching this category and the buyer's state. Never changes fit.
        sponsored: !adFree && l.source !== "no_approval" && canSponsor(supplier) && sponsoredFor(db, supplier, l.category, buyer),
        pref_fit,
        variants: [l],
        vehicle: contractOf(l)?.vehicle ?? null,
        group: l.source,
        quote_route: null,
        link_out: linkOutFor(db, contractOf(l)),
        fit: fitScore(itemTokens, l.title, l.keywords ?? "", optWeights),
        member: coopOf(db, contractOf(l)) ? onCoopContract(db, buyer, contractOf(l)!) : null,
      };
    };
  const quoteOptionFor = (l: Listing): ResultOption => {
    const route = quoteRouteFor(l)!;
    const own = contractOf(l);
    const text = `${l.title} ${l.keywords ?? ""}`;
    const note = route.vehicle === "Sourcewell" ? SOURCEWELL_TYLER_NOTES.find((n) => n.match.test(text)) : undefined;
    return {
      ...optionFor(l),
      group: route.source,
      vehicle: route.vehicle ?? null,
      contract_number: route.contract_number,
      rule: { text: `Quote via ${route.vehicle} ${route.contract_number} · discount off list`, payment: "po" },
      link_out: linkOutFor(db, route),
      member: coopOf(db, route) ? onCoopContract(db, buyer, route) : null,
      quote_route: {
        contract_id: route.id,
        vehicle: route.vehicle ?? route.owner,
        contract_number: route.contract_number,
        reference: `${own?.vehicle ?? own?.owner} ${own?.contract_number}`,
        research_note: note ? `Research lead (unverified): ${note.percent}% off list for ${note.product}` : null,
      },
    };
  };
  const options: ResultOption[] = [
    ...matched.filter((l) => l.source !== "no_approval" || l.unit_price * parsed.quantity < limit).map(optionFor),
    ...viaQuote.map(quoteOptionFor),
  ];

  const rank = (a: ResultOption, b: ResultOption) => {
    // Sponsored listings get a half-point nudge, inside their own source group only.
    const pa = (favor ? a.pref_fit : 0) + (a.sponsored ? 0.5 : 0);
    const pb = (favor ? b.pref_fit : 0) + (b.sponsored ? 0.5 : 0);
    if (pa !== pb) return pb - pa;
    // Words in the product's own name count before words from its category path.
    const ta = Math.round(score(nameTokens, a.listing.title, weights) * 10);
    const tb = Math.round(score(nameTokens, b.listing.title, weights) * 10);
    if (ta !== tb) return tb - ta;
    const ra = Math.round(score(itemTokens, listingText(a.listing), weights) * 10);
    const rb = Math.round(score(itemTokens, listingText(b.listing), weights) * 10);
    if (ra !== rb) return rb - ra;
    const ca = coverage(nameTokens, a.listing.title);
    const cb = coverage(nameTokens, b.listing.title);
    if (ca !== cb) return cb - ca;
    if (a.listing.unit_price !== b.listing.unit_price) return a.listing.unit_price - b.listing.unit_price;
    const da = a.meets_deadline === false ? 1 : 0;
    const dbb = b.meets_deadline === false ? 1 : 0;
    if (da !== dbb) return da - dbb;
    return b.supplier.rating - a.supplier.rating;
  };

  // One card per product: the best-ranked tier stands for its family, then shows
  // the tier that fits the buyer's population, with the others selectable.
  const collapse = (ranked: ResultOption[]) => {
    const seen = new Set<string>();
    const out: ResultOption[] = [];
    for (const o of ranked) {
      const key = o.listing.family ?? o.listing.id;
      if (seen.has(key)) continue;
      seen.add(key);
      const variants = familyOf(db, o.listing);
      const pick = defaultVariant(variants, buyer);
      const base = pick.id === o.listing.id ? o : o.quote_route ? quoteOptionFor(pick) : optionFor(pick);
      out.push({ ...base, variants });
    }
    return out;
  };
  const groups: ResultGroup[] = SOURCE_ORDER.map((source) => ({
    source,
    label: SOURCE_LABEL[source],
    options: collapse(options.filter((o) => o.group === source).sort(rank)),
  })).filter((g) => g.options.length);

  // Seeded peers are Riverbend's Oregon neighbors; only show them to Oregon buyers.
  const nearPeers = !buyer || buyer.state === "OR" ? db.peers : [];
  const peerMatch = bestMatches(itemTokens, nearPeers, (p) => p.listing_title).rows.sort((a, b) => b.rating - a.rating)[0];
  const peer = peerMatch
    ? { ...peerMatch, supplier_name: db.suppliers.find((s) => s.id === peerMatch.supplier_id)?.name ?? "" }
    : null;

  const no_match = groups.length === 0;
  const similar_solicitation = no_match ? findSimilarSolicitation(db, request) : null;

  const explanation: string[] = [];
  if (!no_match) {
    explanation.push(
      `Options are grouped by where you can buy them, starting with your own agency's contracts, then state, co-op, reseller and GSA contracts.`,
    );
    if (buyer)
      explanation.push(
        `Only contracts open to ${buyer.name} (${buyer.state}) are shown.${unavailable.length ? ` ${unavailable.reduce((n, u) => n + u.products, 0)} more matching products sit on contracts it can't use.` : ""}`,
      );
    explanation.push(`The Best fit badge marks the top-ranked option you can buy right away, without a quote or joining a co-op first.`);
    explanation.push(
      `Each card's fit score (0 to 100) is how much of your request it covers. Words in a product's or contract's name count fully, words only in its wider scope count 70%, and rarer words weigh more. Sponsorship never changes a fit score.`,
    );
    if (viaQuote.length)
      explanation.push(
        `Some products are on a state contract ${buyer?.name ?? "you"} can't use, but the supplier's national co-op award is open to you. Those are listed for a quote, with the state price shown only as a reference.`,
      );
    if (groups.some((g) => g.options.some((o) => o.variants.length > 1)))
      explanation.push(
        buyer?.population
          ? `Products priced in tiers show as one card, preset to the tier for a population of ${buyer.population.toLocaleString()}.`
          : `Products priced in tiers show as one card; pick the tier that fits.`,
      );
    explanation.push(
      favor
        ? `You asked to favor local and MBE-certified suppliers, so they rank first within each group. Then the closest match to what you asked for, then cheaper unit price, then delivery against your deadline, then peer rating.`
        : `Within each group, the closest match to what you asked for comes first, then cheaper unit price, then delivery against your deadline, then peer rating.`,
    );
    if (options.some((o) => o.sponsored))
      explanation.push(`Listings marked Sponsored paid for a small boost, and only within their own contract group. They never jump ahead of a different source.`);
    const est = parsed.est_total;
    explanation.push(
      est >= limit
        ? `At about $${Math.round(est).toLocaleString()}, this is over ${db.session.buyer ? "your" : "a typical"} $${(limit / 1000).toFixed(0)}K quick-buy limit, so it needs a PO and an approval. Off-contract small-purchase options are hidden.`
        : `At about $${Math.round(est).toLocaleString()}, this is under ${db.session.buyer ? "your" : "a typical"} $${(limit / 1000).toFixed(0)}K quick-buy limit, so a P-card works on any source.`,
    );
    if (peer) explanation.push(`${peer.agency_name} bought something comparable recently, so it's shown as a peer pick.`);
  }

  const contract_leads = contractLeads(db, itemTokens, buyer);
  const coops = coopSection(db, itemTokens, buyer, relevant);
  const own = ownContracts(db, itemTokens, buyer);
  const expired = [...own.expired, ...expiredBlocked, ...expiredLeads(db, itemTokens)];
  return { request, groups, peer, no_match, similar_solicitation, explanation, buyer, unavailable, contract_leads, coops, own_contracts: own.hits, expired };
}

export function findSimilarSolicitation(db: Db, request: Request): Solicitation | null {
  const text = `${request.raw_text} ${request.parsed.item}`;
  const t = tokens(text);
  const cat = request.parsed.category;
  const scored = db.solicitations
    .filter((s) => s.status !== "draft")
    .map((s) => ({
      s,
      score: score(t, `${s.title} ${s.scope}`) * 2 + (cat && s.category === cat ? 1 : 0) + (/light|led|retrofit/i.test(text) && /light|fixture/i.test(s.title + s.scope) ? 3 : 0),
    }))
    .sort((a, b) => b.score - a.score);
  // No real match means no template; a lighting bid is no model for social listening.
  return scored[0]?.score > 0 ? scored[0].s : null;
}
