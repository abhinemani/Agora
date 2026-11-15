// The product dive: a buyer describes a need, answers a few questions, and
// watches a shortlist narrow. Everything here is rule-based. Products, prices
// and who may buy them come from the catalog and the listings; the questions
// are built from the words and prices actually in the matching products, so
// every answer is a real filter. The model only helps read free text and word
// the comparison (lib/dive-ai.ts). Server-only: it reads the co-op catalog.

import { buildResults, coverage, kindMatch, namePhrase, requestTokens, tokens } from "./assistant";
import { catalogProducts } from "./catalog";
import { SPEC_KEYS, SPEC_QUESTION, specText, type SpecKey, type Specs } from "./specs";
import type { Db, Request } from "./types";

export type DiveFilter =
  | { kind: "price"; min?: number; max?: number }
  | { kind: "word"; value: string }
  | { kind: "not_word"; value: string }
  | { kind: "maker"; value: string }
  | { kind: "usable" }
  | { kind: "priced" }
  | { kind: "spec"; key: SpecKey; value: string };

export interface DiveItem {
  /** "c:<catalog product id>" or "l:<listing id>". */
  id: string;
  name: string;
  maker: string | null;
  sku: string | null;
  /** A price the buyer would pay: an awarded bid, a contract net price or a published price. */
  price: number | null;
  /** A list price before the contract discount. Never shown as the contract price. */
  list: number | null;
  /** What kind of number the price is, in plain words. */
  price_note: string;
  vintage: string | null;
  unit: string | null;
  supplier: string;
  program: string;
  contract_number: string | null;
  contract_id: string | null;
  offering_id: string | null;
  listing_id: string | null;
  /** The buyer can use this contract today (open to them, and they're on the co-op where that matters). */
  usable: boolean;
  access: string;
  fit: number;
  /** Share of the product's name the request covers, in steps of 0.05: "Folding table" names a folding table more
   * squarely than a long description that mentions one. Breaks ties between equal fits. */
  cover: number;
  /** How squarely the product is the thing asked for, 0 to 1: a swing is, a swing hanger isn't. */
  kind_match: number;
  /** A part or an accessory of something else, by the AI review: ranked below whole items. */
  part: boolean;
  /** What the product is, from the AI review (scripts/product-kind.ts), when coded. */
  kind: string | null;
  /** Its specs, read by the AI review from its own words (scripts/product-specs.ts). */
  specs?: Specs;
  /** How the model judged the product against the request (lib/dive-ai.ts), with its reason, when it judged it. */
  fit_verdict?: FitVerdict;
  fit_reason?: string;
  /** Sold only under a state program's contract (NJSTART, Hawaii SPO, …): open to that state's buyers. */
  state: boolean;
  routes: number;
}

export interface DiveQuestion {
  id: string;
  text: string;
  why: string;
  options: { label: string; count: number; filter: DiveFilter }[];
}

export type FitVerdict = "fits" | "partly" | "no";

/** What the model read the request as (lib/dive-ai.ts): the catalog's kinds it means and other words for it. */
export interface DiveReading {
  read_as: string | null;
  kinds: string[];
  terms: string[];
  log_id?: string;
}

/** How a search is widened and ranked beyond the request's own words. */
export interface DiveSearchOptions {
  /** Kinds the request was read as: their products are on the shortlist even when no word of the request is in their names. */
  kinds?: string[];
  /** Other words the catalog may use for the request ("defibrillator" for "AED"). */
  terms?: string[];
  /** How many products to return: 12 for the page; more when the model will judge them first. */
  limit?: number;
}

export interface DiveState {
  /** The request as the model read it, when it did. */
  reading?: DiveReading | null;
  /** The log id of the fit judgment shown on the cards, for feedback. */
  fit_log?: string | null;
  /** Products the model judged not to be what was asked for, kept off the shortlist but listed with their reasons. */
  set_aside?: DiveItem[];
  query: string;
  filters: DiveFilter[];
  /** Products that matched the need before any narrowing. */
  pool: number;
  matched: number;
  items: DiveItem[];
  questions: DiveQuestion[];
  price_range: { min: number; max: number } | null;
  /** The typical range of prices a buyer would pay (no list prices): the middle 80% of priced matches once there are
   * more than five, so one stray match (a forklift named "swing mast" among swing sets) doesn't set the estimate. */
  pay_range: { min: number; max: number } | null;
  /** Contracts that sell a match but carry no price for it: the buyer asks the supplier for a quote under the contract. Usable ones first. */
  by_quote: { contract_id: string; program: string; contract_number: string | null; supplier: string; usable: boolean }[];
  buyer: string | null;
  /** Candidate filters the free-text reader may pick from. */
  vocabulary: { words: string[]; makers: string[] };
}

const STOP = new Set(
  "the and for with from that this model each per inch inches part parts package item items unit base standard series type size color black white grey gray new including includes included only use all any with without".split(" "),
);
/** Words in a product name, lowercased. Digits-only tokens and very short ones are noise for narrowing. */
export function diveWords(text: string): string[] {
  return [...new Set((text.toLowerCase().match(/[a-z][a-z0-9-]{2,}/g) ?? []).filter((w) => !STOP.has(w)))];
}

const usd = (n: number) => `$${n.toLocaleString("en-US", { maximumFractionDigits: n < 100 ? 2 : 0 })}`;
const niceCeil = (n: number) => {
  const mag = 10 ** Math.max(0, Math.floor(Math.log10(n)) - 1);
  return Math.ceil(n / (mag * 5)) * mag * 5;
};
const priceOf = (i: DiveItem) => i.price ?? i.list;

/** Attributes where naming one rules out the others: a request for an electric vehicle isn't met by a gasoline one. */
const EXCLUSIVE: RegExp[][] = [[/\b(electric|battery|ev|bev)\b/, /\b(gasoline|gas|petrol|unleaded)\b/, /\bdiesel\b/, /\bhybrid\b/, /\b(propane|lpg)\b/, /\b(cng|natural gas)\b/]];

/** True when the product names a different member of a group the request named, and not the one asked for. */
export function conflictsWith(query: string, name: string): boolean {
  // A ruled-out attribute isn't one asked for: "pickup (non-diesel)" or "not electric" asks for neither.
  const q = query.toLowerCase().replace(/\b(?:no|not|non|without|except|excluding)[\s-]+(?:an?\s+)?[a-z]+/g, " ");
  const n = name.toLowerCase();
  return EXCLUSIVE.some((group) => {
    const asked = group.filter((re) => re.test(q));
    return asked.length > 0 && !asked.some((re) => re.test(n)) && group.some((re) => re.test(n));
  });
}

function gather(db: Db, query: string, opts: DiveSearchOptions = {}): DiveItem[] {
  return gatherAll(db, query, opts).filter((i) => !conflictsWith(query, i.name));
}

function gatherAll(db: Db, query: string, opts: DiveSearchOptions = {}): DiveItem[] {
  const buyer = db.session.buyer;
  const items: DiveItem[] = [];
  const asked = requestTokens(query);

  // Loci's own listings, through the same matching and eligibility rules as search results.
  const request: Request = { id: "dive", raw_text: query, parsed: { item: query, quantity: 1, category: null, deadline: null, department: "", est_total: 0 }, parse_mode: "offline", preference_answer: null, created_at: "", outcome: null };
  for (const o of buildResults(db, request).groups.flatMap((g) => g.options)) {
    if (o.quote_route) continue;
    const l = o.listing;
    items.push({
      id: `l:${l.id}`,
      name: l.title,
      maker: null,
      sku: l.sku,
      price: l.unit_price,
      list: null,
      price_note: l.contract_id ? "Published contract price" : "Published price, no contract",
      vintage: null,
      unit: l.unit,
      supplier: o.supplier.name,
      program: o.vehicle ?? "No contract needed",
      contract_number: o.contract_number,
      contract_id: l.contract_id,
      offering_id: null,
      listing_id: l.id,
      usable: o.member !== false,
      access: o.member === false ? "On a co-op you'd need to join" : "Open to you",
      fit: o.fit,
      cover: coverage(asked, l.title),
      kind_match: kindMatch(asked, [tokens(namePhrase(l.title))]),
      kind: null,
      part: false,
      state: false,
      routes: 1,
    });
  }

  // The co-op catalog: every product with every contract that sells it. The best route stands for the product.
  // The request's own words, with the kinds it was read as; then each other word for it, merged by product.
  const hits = new Map<string, ReturnType<typeof catalogProducts>["hits"][number]>();
  for (const [n, q] of [query, ...(opts.terms ?? [])].entries())
    for (const h of catalogProducts(db, q, buyer, n ? 200 : 600, n ? {} : { kinds: opts.kinds }).hits) {
      const have = hits.get(h.product_id);
      hits.set(h.product_id, have ? { ...have, fit: Math.max(have.fit, h.fit), kind_match: Math.max(have.kind_match, h.kind_match) } : h);
    }
  for (const h of hits.values()) {
    const usable = (r: (typeof h.routes)[number]) => r.eligible && (!buyer || r.member || r.coop_id === "gsa_mas");
    const r = [...h.routes].sort((a, b) => Number(usable(b)) - Number(usable(a)) || Number(b.price != null) - Number(a.price != null) || (a.price ?? Infinity) - (b.price ?? Infinity))[0];
    const basis = /award/i.test(r.vintage ?? "") ? "Awarded bid, base model" : /net price/i.test(r.vintage ?? "") ? "Contract net price" : /base vehicle|cost sheet/i.test(r.vintage ?? "") ? "Base price, before options and delivery" : "Published price";
    items.push({
      id: `c:${h.product_id}`,
      name: h.name,
      maker: h.maker,
      sku: h.mpn,
      price: r.price,
      list: r.price == null ? r.list : null,
      price_note:
        r.price != null ? basis : r.list != null ? "List price, before the contract discount" : r.status === "member_login" ? "Price behind the co-op's member login" : r.status === "published_discount" ? "Discount off list; no price published" : "Price by quote",
      vintage: r.vintage,
      unit: r.unit,
      supplier: r.supplier,
      program: r.coop,
      contract_number: r.contract_number,
      contract_id: r.contract_id,
      offering_id: r.offering_id,
      listing_id: null,
      usable: usable(r),
      access: !r.eligible ? `Not open to you: ${r.reason}` : !buyer ? r.reason : r.member || r.coop_id === "gsa_mas" ? "On a co-op you're on" : "On a co-op you'd need to join",
      fit: h.fit,
      cover: coverage(asked, h.name),
      kind_match: h.kind_match,
      kind: h.kind,
      ...(h.specs ? { specs: h.specs } : {}),
      part: h.role === "part" || h.role === "accessory",
      state: r.trx,
      routes: h.routes.length,
    });
  }
  return items;
}

function passes(i: DiveItem, f: DiveFilter): boolean {
  const words = () => diveWords(`${i.name} ${i.maker ?? ""}`);
  switch (f.kind) {
    case "price": {
      const p = priceOf(i);
      return p != null && (f.min === undefined || p >= f.min) && (f.max === undefined || p <= f.max);
    }
    case "word":
      return words().includes(f.value);
    case "not_word":
      return !words().includes(f.value);
    case "maker":
      return (i.maker ?? i.supplier).toLowerCase() === f.value.toLowerCase();
    case "usable":
      return i.usable;
    case "priced":
      return i.price != null;
    case "spec":
      return i.specs?.[f.key]?.value === f.value;
  }
}

export const filterLabel = (f: DiveFilter) =>
  f.kind === "price" ? (f.min === undefined ? `Up to ${usd(f.max!)}` : f.max === undefined ? `${usd(f.min)} and up` : `${usd(f.min)} to ${usd(f.max)}`) : f.kind === "word" ? f.value : f.kind === "not_word" ? `Not ${f.value}` : f.kind === "maker" ? f.value : f.kind === "usable" ? "Can buy today" : f.kind === "spec" ? specText(f.key, f.value) : "Has a price";

const cap = (w: string) => w.charAt(0).toUpperCase() + w.slice(1);

function questionsFor(items: DiveItem[], filters: DiveFilter[], query: string, hasBuyer: boolean): { questions: DiveQuestion[]; words: string[]; makers: string[] } {
  const n = items.length;
  const used = (kind: DiveFilter["kind"]) => filters.some((f) => f.kind === kind);
  const questions: DiveQuestion[] = [];
  const count = (f: DiveFilter) => items.filter((i) => passes(i, f)).length;
  const useful = (c: number) => c > 0 && c < n;

  // Words that split the shortlist: in some products but not most of them.
  const asked = new Set([...diveWords(query), ...filters.flatMap((f) => (f.kind === "word" || f.kind === "not_word" ? [f.value] : []))]);
  const df = new Map<string, number>();
  for (const i of items) for (const w of diveWords(i.name)) if (!asked.has(w)) df.set(w, (df.get(w) ?? 0) + 1);
  const makerWords = new Set(items.flatMap((i) => diveWords(i.maker ?? "")));
  const splitters = [...df.entries()]
    .filter(([w, c]) => c >= Math.max(2, n * 0.08) && c <= n * 0.75 && !makerWords.has(w))
    .sort((a, b) => Math.abs(a[1] - n / 3) - Math.abs(b[1] - n / 3));
  const words = splitters.slice(0, 40).map(([w]) => w);

  const makerCounts = new Map<string, number>();
  for (const i of items) if (i.maker) makerCounts.set(i.maker, (makerCounts.get(i.maker) ?? 0) + 1);
  const makers = [...makerCounts.entries()].sort((a, b) => b[1] - a[1]).map(([m]) => m);

  if (n > 3) {
    const prices = items.map(priceOf).filter((p): p is number => p != null).sort((a, b) => a - b);
    if (!used("price") && prices.length >= 4 && prices[prices.length - 1] > prices[0] * 1.5) {
      const [lo, hi] = [0.33, 0.67].map((q) => niceCeil(prices[Math.floor((prices.length - 1) * q)]));
      const bands: DiveFilter[] = lo < hi ? [{ kind: "price", max: lo }, { kind: "price", min: lo, max: hi }, { kind: "price", min: hi }] : [{ kind: "price", max: lo }, { kind: "price", min: lo }];
      const options = bands.map((filter) => ({ label: filterLabel(filter), filter, count: count(filter) })).filter((o) => useful(o.count));
      if (options.length >= 2) questions.push({ id: "budget", text: "What's the most you'd spend on each?", why: `Prices here run from ${usd(prices[0])} to ${usd(prices[prices.length - 1])}.`, options });
    }
    // Specs the shortlist differs on, read by the AI review: a cab, an age range, a back height. At most two, the
    // ones that split the shortlist most evenly, asked before the words in names.
    const specQs: { q: DiveQuestion; balance: number }[] = [];
    for (const key of Object.keys(SPEC_KEYS) as SpecKey[]) {
      if (filters.some((f) => f.kind === "spec" && f.key === key)) continue;
      const counts = new Map<string, number>();
      for (const i of items) {
        const v = i.specs?.[key]?.value;
        if (v) counts.set(v, (counts.get(v) ?? 0) + 1);
      }
      const values = [...counts.entries()].filter(([, c]) => useful(c)).sort((a, b) => b[1] - a[1]).slice(0, 5);
      const covered = values.reduce((t, [, c]) => t + c, 0);
      if (values.length < 2 || covered < Math.max(3, n * 0.3)) continue;
      specQs.push({
        q: {
          id: `spec:${key}`,
          text: SPEC_QUESTION[key],
          why: `${covered} of these ${n} say, from the products' own descriptions.`,
          options: values.map(([value, count]) => ({ label: specText(key, value), count, filter: { kind: "spec", key, value } as DiveFilter })),
        },
        balance: Math.abs(values[0][1] - covered / values.length) / covered,
      });
    }
    questions.push(...specQs.sort((a, b) => a.balance - b.balance).slice(0, 2).map((x) => x.q));
    if (splitters.length >= 2) {
      const options = splitters.slice(0, 5).map(([w, c]) => ({ label: cap(w), count: c, filter: { kind: "word", value: w } as DiveFilter }));
      questions.push({ id: `words:${options.map((o) => o.label).join(",")}`, text: "Which of these describes what you need?", why: "These words separate the products on the shortlist.", options });
    }
    if (!used("maker") && makers.length >= 2) {
      const options = makers.slice(0, 5).map((m) => ({ label: m, count: makerCounts.get(m)!, filter: { kind: "maker", value: m } as DiveFilter })).filter((o) => useful(o.count) && o.count >= 2);
      if (options.length >= 2) questions.push({ id: "maker", text: "Do you have a make in mind?", why: `${makers.length} makers have products that match.`, options });
    }
    if (!used("usable") && hasBuyer) {
      const c = count({ kind: "usable" });
      if (useful(c)) questions.push({ id: "usable", text: "Only show what you can buy today?", why: "Some of these are on co-ops your agency isn't on, or contracts it can't use.", options: [{ label: "Yes, only those", count: c, filter: { kind: "usable" } }] });
    }
    if (!used("priced")) {
      const c = count({ kind: "priced" });
      if (useful(c)) questions.push({ id: "priced", text: "Only show products with a price you'd actually pay?", why: "The rest show a list price, sit behind a member login or need a quote.", options: [{ label: "Yes, priced only", count: c, filter: { kind: "priced" } }] });
    }
  }
  return { questions, words, makers };
}

/** The shortlist for a need, narrowed by the buyer's answers. */
export function diveSearch(db: Db, query: string, filters: DiveFilter[], opts: DiveSearchOptions = {}): DiveState {
  const q = query.trim().slice(0, 200);
  const pool = q ? gather(db, q, opts) : [];
  const matched = pool.filter((i) => filters.every((f) => passes(i, f)));
  // What the buyer can use comes first; with no agency set, what any buyer could use comes before one state's
  // contracts, as on the results page. Then the product that is the thing asked for (a swing before a swing hanger),
  // and for an agency, its own state's contract before a co-op's, as on the results page. Then whole items before
  // parts, a real price, fit, the name that says it most squarely, and the lower price.
  const anyone = !db.session.buyer;
  const ownState = (i: DiveItem) => Number(!anyone && i.usable && i.state);
  const ranked = [...matched].sort(
    (a, b) =>
      Number(b.usable) - Number(a.usable) ||
      (anyone ? Number(a.state) - Number(b.state) : 0) ||
      b.kind_match - a.kind_match ||
      ownState(b) - ownState(a) ||
      Number(a.part) - Number(b.part) ||
      Number(b.price != null) - Number(a.price != null) || b.fit - a.fit || b.cover - a.cover || (priceOf(a) ?? Infinity) - (priceOf(b) ?? Infinity) || a.name.localeCompare(b.name),
  );
  const prices = matched.map(priceOf).filter((p): p is number => p != null);
  const pays = matched.map((i) => i.price).filter((p): p is number => p != null).sort((a, b) => a - b);
  const at = (q: number) => pays[Math.round((pays.length - 1) * q)];
  const quoted = new Map<string, DiveState["by_quote"][number]>();
  for (const i of [...matched].sort((a, b) => Number(b.usable) - Number(a.usable) || b.fit - a.fit))
    if (i.price == null && i.contract_id && !quoted.has(i.contract_id)) quoted.set(i.contract_id, { contract_id: i.contract_id, program: i.program, contract_number: i.contract_number, supplier: i.supplier, usable: i.usable });
  const { questions, words, makers } = questionsFor(matched, filters, q, Boolean(db.session.buyer));
  return {
    query: q,
    filters,
    pool: pool.length,
    matched: matched.length,
    items: ranked.slice(0, opts.limit ?? 12),
    questions,
    price_range: prices.length ? { min: Math.min(...prices), max: Math.max(...prices) } : null,
    pay_range: !pays.length ? null : pays.length > 5 ? { min: at(0.1), max: at(0.9) } : { min: pays[0], max: pays[pays.length - 1] },
    by_quote: [...quoted.values()].slice(0, 4),
    buyer: db.session.buyer?.name ?? null,
    vocabulary: { words, makers },
  };
}

/** The shortlist reordered by the model's fit verdicts, then cut to the 12 the page shows. What the buyer can use still
 * comes first (and, with no agency set, what any buyer can use); within that, products judged to fit come before
 * those that partly fit or weren't judged. Otherwise the rules' order stands. Products judged not to fit are set aside,
 * listed apart with their reasons, unless nothing else is left. */
export function applyFit(state: DiveState, fits: Map<string, { fit: FitVerdict; reason: string }>, anyone: boolean, show = 12): DiveState {
  const rank = (i: DiveItem) => (i.fit_verdict === "fits" ? 2 : i.fit_verdict === "no" ? 0 : 1);
  const items = state.items.map((i) => {
    const f = fits.get(i.id);
    return f ? { ...i, fit_verdict: f.fit, fit_reason: f.reason } : i;
  });
  const order = new Map(items.map((i, n) => [i.id, n]));
  items.sort(
    (a, b) => Number(b.usable) - Number(a.usable) || (anyone ? Number(a.state) - Number(b.state) : 0) || rank(b) - rank(a) || order.get(a.id)! - order.get(b.id)!,
  );
  const fitting = items.filter((i) => i.fit_verdict !== "no");
  if (!fitting.length) return { ...state, items: items.slice(0, show), set_aside: [] };
  return { ...state, items: fitting.slice(0, show), set_aside: items.filter((i) => i.fit_verdict === "no") };
}

/** How many products on the shortlist have each word in their names, and how many there are: what a must-have or a
 * ruled-out word can narrow by. */
export function diveWordCounts(db: Db, query: string, opts: DiveSearchOptions = {}): { words: Map<string, number>; pool: number } {
  const pool = query.trim() ? gather(db, query.trim().slice(0, 200), opts) : [];
  const words = new Map<string, number>();
  for (const i of pool) for (const w of diveWords(i.name)) words.set(w, (words.get(w) ?? 0) + 1);
  return { words, pool: pool.length };
}

/** Items by id, for the comparison. Looked up through the same search so eligibility is current. */
export function diveItems(db: Db, query: string, ids: string[], opts: DiveSearchOptions = {}): DiveItem[] {
  const pool = gather(db, query.trim().slice(0, 200), opts);
  return ids.map((id) => pool.find((i) => i.id === id)).filter((i): i is DiveItem => Boolean(i));
}

export interface DiveVerdict {
  pick: string | null;
  headline: string;
  points: string[];
}

/** The rule-based read of two or three finalists: what can be bought, what's cheapest, and what can't be compared. */
export function diveVerdict(items: DiveItem[]): DiveVerdict {
  const points: string[] = [];
  const usable = items.filter((i) => i.usable);
  const payable = usable.filter((i) => i.price != null).sort((a, b) => a.price! - b.price!);
  const pick = payable[0] ?? usable[0] ?? null;
  let headline: string;
  if (payable.length) {
    headline = payable.length > 1 ? `${payable[0].name} is the lowest price you can buy today.` : `${payable[0].name} is the one you can buy today at a known price.`;
    if (payable.length > 1) points.push(`**${usd(payable[0].price!)}** against ${payable.slice(1).map((i) => `${usd(i.price!)} for ${i.name}`).join(" and ")}.`);
  } else if (usable.length) {
    headline = `None of these has a price you'd pay loaded. ${usable[0].name} is open to you by quote.`;
  } else {
    headline = "None of these is on a contract you can use today.";
  }
  const notes = new Set(items.filter((i) => i.price != null || i.list != null).map((i) => i.price_note));
  if (notes.size > 1) points.push(`These aren't the same kind of price: ${[...notes].map((n) => n.toLowerCase()).join("; ")}. Compare them with that in mind.`);
  for (const i of items) {
    if (i.price == null && i.list != null) points.push(`${i.name} shows a list price of ${usd(i.list)}. The contract price is lower, but the discount isn't loaded.`);
    else if (i.price == null) points.push(`${i.name}: ${i.price_note.toLowerCase()}.`);
    if (!i.usable) points.push(`${i.name} is ${i.access.charAt(0).toLowerCase()}${i.access.slice(1)}.`);
  }
  const vintages = [...new Set(items.map((i) => i.vintage).filter(Boolean))];
  if (vintages.length) points.push(`Prices are from: ${vintages.join("; ")}. Check they're still current before ordering.`);
  return { pick: pick?.id ?? null, headline, points };
}

/** Free text read without the model: a dollar ceiling and any words the shortlist can be narrowed by. */
export function offlineDiveFilters(text: string, state: DiveState): DiveFilter[] {
  const out: DiveFilter[] = [];
  const money = text.match(/(?:under|below|less than|max(?:imum)?|up to|budget(?: of| is)?|no more than)\s*\$?\s*([\d,]+(?:\.\d+)?)\s*(k)?/i) ?? text.match(/\$\s*([\d,]+(?:\.\d+)?)\s*(k)?/i);
  if (money) {
    const v = Number(money[1].replace(/,/g, "")) * (money[2] ? 1000 : 1);
    if (v > 0) out.push({ kind: "price", max: v });
  }
  const said = diveWords(text);
  const negated = new Set((text.toLowerCase().match(/\b(?:no|not|without)\s+([a-z][a-z0-9-]{2,})/g) ?? []).map((m) => m.split(/\s+/)[1]));
  for (const w of said) if (state.vocabulary.words.includes(w)) out.push(negated.has(w) ? { kind: "not_word", value: w } : { kind: "word", value: w });
  const maker = state.vocabulary.makers.find((m) => text.toLowerCase().includes(m.toLowerCase()));
  if (maker) out.push({ kind: "maker", value: maker });
  if (/\b(today|right now|can buy|eligible)\b/i.test(text)) out.push({ kind: "usable" });
  return out;
}
