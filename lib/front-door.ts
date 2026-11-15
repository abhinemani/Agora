// The homepage's guided search ("the front door"): rules shared by the page and its tests.
// Client-safe: no server modules. The shortlist itself comes from the product dive (lib/dive.ts)
// through /api/act; this file decides what kind of request it is, how an order of a given size is
// bought, and which way out to recommend when nothing on the shortlist fits.

import type { DiveFilter, DiveState } from "./dive";

/** Requests for software, services and construction are bought under contracts and priced by quote: the product
 * shortlist doesn't fit them, so they go straight to the results page and its contract sections. */
const CONTRACT_SHAPED =
  /\b(software|saas|platform|system|systems|portal|app|application|services?|consult\w*|consultants?|hours|staffing|staff augmentation|engineering|architect\w*|design services|construction|construct|renovat\w*|retrofit|install\w*|maintenance|repair|repairs|janitorial|landscaping|audit|study|assessment|training|management|hosting|subscription|licen[cs]es?|implementation|program management|project manager|dispatch|computer-aided|cad|erp|crm|gis|permitting|licensing|records management|case management|payroll|e-?procurement|cybersecurity|cloud|gps|avl|telematics|tracking|fleet management)\b/i;

/** The homepage's examples: products open the guided search, contract-shaped requests go to the results page. Each one
 * returns priced or fitting results for any buyer, with or without an agency: the products are on co-op contracts open
 * nationwide (BuyBoard's police vehicles, Canon's toner on Sourcewell, Burke's benches on OMNIA), and the contracts are
 * on co-ops every state can use. The eval case "front-door.guard.examples" runs each one as several states. */
export const EXAMPLES = ["A police SUV", "Toner for the copier", "Park benches", "Permitting software", "Computer-aided dispatch", "Fleet GPS tracking"];

export type RequestKind = "product" | "contract";
export function requestKind(text: string): RequestKind {
  return CONTRACT_SHAPED.test(text) ? "contract" : "product";
}

export type Route = "pcard" | "po" | "quote";
/** How an order is paid for, by its total against the quick-buy limit (the same rule as the buying plan in lib/shopper.ts). */
export function routeFor(total: number | null, limit: number): Route {
  if (total == null) return "quote";
  return total < limit ? "pcard" : "po";
}
export const ROUTE_LABEL: Record<Route, string> = { pcard: "P-card", po: "Purchase order", quote: "Price by quote" };

export type OffRampPath = "contract_quote" | "informal_quotes" | "solicitation";

export interface OffRamp {
  /** The estimated total for the order: quantity times the lowest and highest price a buyer would pay. Null when nothing is priced. */
  total: { min: number; max: number } | null;
  recommended: OffRampPath;
  /** One sentence on why that path, from the numbers. */
  because: string;
  /** Whether the panel should open above the shortlist: nothing fits, one thing does, or nothing is priced. */
  loud: boolean;
}

const usd = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

/** Which way out to recommend. A quote under a contract the buyer can already use is the least work; without one,
 * a small order is quoted informally and a large one is solicited. */
export function offRamp(state: Pick<DiveState, "matched" | "pay_range" | "by_quote" | "items">, quantity: number, limit: number): OffRamp {
  const q = Math.max(1, quantity);
  const total = state.pay_range ? { min: state.pay_range.min * q, max: state.pay_range.max * q } : null;
  const usableQuote = state.by_quote.filter((c) => c.usable);
  const priced = state.items.some((i) => i.price != null);
  const loud = state.matched <= 1 || !priced;
  if (usableQuote.length)
    return {
      total,
      recommended: "contract_quote",
      because: `${usableQuote.length === 1 ? "One contract" : `${usableQuote.length} contracts`} open to this agency ${usableQuote.length === 1 ? "sells" : "sell"} a match without a price on file. A quote under a contract needs no new solicitation.`,
      loud,
    };
  const lowest = total && total.max > total.min ? "The lowest total" : "The total";
  if (!total || total.min < limit)
    return {
      total,
      recommended: "informal_quotes",
      because: total ? `${lowest}, ${usd(total.min)}, is under the ${usd(limit)} quick-buy limit, so quotes from a few suppliers are usually enough.` : "Nothing here has a price, so quotes from a few suppliers set one.",
      loud,
    };
  return {
    total,
    recommended: "solicitation",
    because: `${total.max > total.min ? "Even the lowest total" : "The total"}, ${usd(total.min)}, is over the ${usd(limit)} quick-buy limit, and no contract open to this agency prices it by quote.`,
    loud,
  };
}

// ---------------------------------------------------------------- the address

/** What the address keeps, so the back button, a refresh and a shared link return to the same shortlist. */
export interface FrontDoorUrl {
  need: string;
  query?: string;
  filters?: DiveFilter[];
  quantity?: number;
}

const b64 = (s: string) => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64 = (s: string) => decodeURIComponent(escape(atob(s.replace(/-/g, "+").replace(/_/g, "/"))));

export function toSearch(u: FrontDoorUrl): string {
  const p = new URLSearchParams();
  p.set("q", u.need);
  if (u.query && u.query !== u.need) p.set("item", u.query);
  if (u.quantity && u.quantity > 1) p.set("n", String(u.quantity));
  if (u.filters?.length) p.set("f", b64(JSON.stringify(u.filters)));
  return `?${p.toString()}`;
}

export function fromSearch(search: string): FrontDoorUrl | null {
  const p = new URLSearchParams(search);
  const need = p.get("q")?.trim();
  if (!need) return null;
  let filters: DiveFilter[] | undefined;
  try {
    const f = p.get("f");
    const parsed = f ? JSON.parse(unb64(f)) : undefined;
    if (Array.isArray(parsed)) filters = parsed.slice(0, 20);
  } catch {
    filters = undefined;
  }
  const n = Number(p.get("n"));
  return { need: need.slice(0, 300), query: p.get("item")?.slice(0, 200) || undefined, filters, quantity: Number.isFinite(n) && n >= 1 ? Math.floor(n) : undefined };
}
