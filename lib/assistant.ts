// The "ask, don't browse" layer: parse a plain-language request, match it to
// listings from every source, rank them, and apply the agency's buying rules.

import * as z from "zod/v4";
import { structured } from "./llm";
import { CATEGORIES } from "./types";
import type { Buyer, Category, Db, Listing, ParsedRequest, PeerPurchase, Request, Solicitation, Source, Supplier } from "./types";
import { checkEligibility, defaultVariant, familyOf, SOURCEWELL_TYLER_NOTES } from "./vehicles";

export const SOURCE_ORDER: Source[] = ["own_contract", "state_contract", "coop_contract", "reseller", "gsa", "no_approval"];

export const SOURCE_LABEL: Record<Source, string> = {
  own_contract: "Riverbend contract",
  state_contract: "State contract",
  coop_contract: "Co-op contract",
  reseller: "Reseller",
  gsa: "GSA schedule",
  no_approval: "No approval needed",
};

// ---------------------------------------------------------------- tokenizing

const STOP = new Set(
  "a an the of for and or with to in on at by from some new need needs we our my i us please get buy order want ft in x unit units each dozen box boxes case cases pack packs pk set sets ea about around approx roughly online".split(" "),
);

function singular(w: string) {
  if (w.length > 4 && w.endsWith("ies")) return w.slice(0, -3) + "y";
  if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss")) return w.slice(0, -1);
  return w;
}

/** Light stemming so "management" meets "manager" and "permitting" meets
 * "permit". Applied to both sides of every comparison. */
function stem(w: string) {
  if (w.length <= 4) return w;
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

type Weights = Map<string, number>;

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
  const scored = rows.map((r) => ({ r, s: score(itemTokens, titleOf(r), weights) }));
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
  const category = CATEGORY_HINTS.find(([re]) => re.test(item))?.[1] ?? null;
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
    ? { text: `Under your ${k} quick-buy limit · P-card OK${via}`, payment: "pcard" }
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
}

function fmtDate(d: Date) {
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

const listingText = (l: Listing) => `${l.title} ${l.keywords ?? ""}`;

export function estimateTotal(db: Db, item: string, quantity: number) {
  const itemTokens = tokens(item);
  const weights = idf(db.listings, listingText);
  const { rows } = bestMatches(itemTokens, db.listings.filter((l) => l.storefront_ids.includes("sf_riverbend")), listingText, weights);
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

export function buildResults(db: Db, request: Request): Results {
  const { parsed } = request;
  const itemTokens = tokens(parsed.item);
  const favor = request.preference_answer === "yes";
  const limit = db.agency.quick_buy_threshold;

  const storefront = db.listings.filter((l) => l.storefront_ids.includes("sf_riverbend"));
  const weights = idf(db.listings, listingText);
  const { rows: found } = bestMatches(itemTokens, storefront, listingText, weights);
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
  const unavailable: Unavailable[] = [...blockedByContract].map(([cid, ls]) => {
    const c = db.contracts.find((x) => x.id === cid)!;
    const families = [...new Map(ls.map((l) => [l.family ?? l.id, l.title])).values()];
    return { master_agreement: c.master_agreement ?? null, vehicle: c.vehicle ?? c.owner, contract_number: c.contract_number, owner: c.owner, reason: checkEligibility(c, buyer).reason, products: families.length, examples: families.slice(0, 2) };
  });

  const due = deadlineDate(parsed.deadline);
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
        sponsored: supplier.sponsored && supplier.edge_tier !== "discover" && l.source !== "no_approval",
        pref_fit,
        variants: [l],
        vehicle: contractOf(l)?.vehicle ?? null,
        group: l.source,
        quote_route: null,
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
    const ta = Math.round(score(itemTokens, a.listing.title, weights) * 10);
    const tb = Math.round(score(itemTokens, b.listing.title, weights) * 10);
    if (ta !== tb) return tb - ta;
    const ra = Math.round(score(itemTokens, listingText(a.listing), weights) * 10);
    const rb = Math.round(score(itemTokens, listingText(b.listing), weights) * 10);
    if (ra !== rb) return rb - ra;
    const ca = coverage(itemTokens, a.listing.title);
    const cb = coverage(itemTokens, b.listing.title);
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
        ? `At about $${Math.round(est).toLocaleString()}, this is over your $${(limit / 1000).toFixed(0)}K quick-buy limit, so it needs a PO and an approval. Off-contract small-purchase options are hidden.`
        : `At about $${Math.round(est).toLocaleString()}, this is under your $${(limit / 1000).toFixed(0)}K quick-buy limit, so a P-card works on any source.`,
    );
    if (peer) explanation.push(`${peer.agency_name} bought something comparable recently, so it's shown as a peer pick.`);
  }

  return { request, groups, peer, no_match, similar_solicitation, explanation, buyer, unavailable };
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
