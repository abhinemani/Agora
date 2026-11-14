// "Your personal shopper": the buying plan for a request. Everything here is
// rule-based and pure, so the browser can redraw the plan as the buyer changes
// the order, and the server can hand the same facts to the model. The model
// only words the plan (lib/shopper-ai.ts); it never decides eligibility,
// prices or routes.

import type { CoopHit, ResultOption, Results } from "./assistant";
import type { Listing, Request } from "./types";
import { verificationSummary } from "./verification";
import { stateLabel, TRX_PROGRAM } from "./trx";

export interface ShopperSelection {
  /** The catalog item being bought, or null for "something else, by quote". */
  listing_id: string | null;
  quantity: number;
  add_ons: { listing_id: string; quantity: number }[];
}

/** A numbered source. The same number is shown on the result it points at. */
export interface PlanRef {
  n: number;
  /** "listing:<id>" for a priced product, "contract:<id>" for a co-op contract. */
  key: string;
  label: string;
}

export interface PlanLine {
  listing_id: string;
  title: string;
  sku: string;
  quantity: number;
  unit_price: number;
  unit: string;
  amount: number;
}

export type PlanPayment = "pcard" | "po" | "needs_contract" | "coop_site" | "quote";

export interface PlanRoute {
  kind: "priced" | "member" | "join" | "coops";
  recommended: boolean;
  title: string;
  body: string;
  refs: number[];
  /** Co-op contracts behind a member or join route. */
  hits: CoopHit[];
}

export interface Plan {
  lines: PlanLine[];
  total: number | null;
  limit: number;
  /** "your" when the limit is this agency's own, "a typical" when it's a stand-in. */
  limit_phrase: string;
  payment: PlanPayment;
  /** Dollars under (pcard) or over (po) the limit. */
  gap: number;
  /** Most units of this order that stay under the limit, when it's over. */
  max_units: number;
  supplier: string | null;
  headline: string;
  summary: string;
  routes: PlanRoute[];
  unknowns: string[];
  refs: PlanRef[];
  file: { items: string; route: string; why: string; needed: string };
}

const round2 = (n: number) => Math.round(n * 100) / 100;
export const usd = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2 })}`;
const possessive = (name: string) => (/s$/i.test(name) ? `${name}'` : `${name}'s`);
const COUNT = ["No", "One", "Two", "Three"];
const list = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);

/** Catalog items with a published price that this buyer can act on now: no quote, no co-op to join first. */
export function shopperCandidates(results: Results): ResultOption[] {
  return results.groups
    .flatMap((g) => g.options)
    .filter((o) => !o.quote_route && o.member !== false)
    .slice(0, 3);
}

const NOT_A_COOP = "gsa_mas";
const memberHits = (r: Results) => (r.buyer ? r.coops.hits.filter((h) => h.member && h.eligible).slice(0, 2) : []);
const joinHits = (r: Results) => (r.buyer ? r.coops.hits.filter((h) => !h.member && h.coop_id !== NOT_A_COOP).slice(0, 2) : []);
const anyHits = (r: Results) => (r.buyer ? [] : r.coops.hits.filter((h) => h.coop_id !== NOT_A_COOP).slice(0, 3));

/** Whether the shopper has anything to plan with for this request. */
export function shopperApplies(results: Results) {
  return shopperCandidates(results).length > 0 || memberHits(results).length > 0 || joinHits(results).length > 0 || anyHits(results).length > 0;
}

/** Reference numbers for the results the plan can cite. They don't depend on the buyer's selection. */
export function shopperRefs(results: Results): PlanRef[] {
  const refs: PlanRef[] = [];
  const add = (key: string, label: string) => refs.push({ n: refs.length + 1, key, label });
  for (const o of shopperCandidates(results)) add(`listing:${o.listing.id}`, o.contract_number ? `${o.supplier.name} · ${o.vehicle ?? ""} ${o.contract_number}`.replace(/\s+/g, " ") : `${o.supplier.name} price list`);
  for (const h of [...memberHits(results), ...joinHits(results), ...anyHits(results)]) add(`contract:${h.contract_id}`, `${h.coop} ${h.contract_number} · ${h.supplier}`);
  return refs;
}

/** Other products on the same contract, offered alongside the chosen item. */
export function shopperAddOns(listings: Listing[], results: Results, chosen: ResultOption | undefined): Listing[] {
  if (!chosen || chosen.link_out || !chosen.listing.contract_id) return [];
  const taken = new Set(shopperCandidates(results).flatMap((o) => [o.listing.id, ...o.variants.map((v) => v.id)]));
  const seen = new Set<string>();
  return listings
    .filter((l) => l.contract_id === chosen.listing.contract_id && l.supplier_id === chosen.listing.supplier_id && l.category === chosen.listing.category && !taken.has(l.id))
    .filter((l) => {
      const key = l.family ?? l.id;
      if (seen.has(key) || (chosen.listing.family && key === chosen.listing.family)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 3);
}

export function defaultSelection(results: Results, request: Request): ShopperSelection {
  if (request.shopper) return { listing_id: request.shopper.listing_id, quantity: request.parsed.quantity, add_ons: request.shopper.add_ons };
  return { listing_id: shopperCandidates(results)[0]?.listing.id ?? null, quantity: request.parsed.quantity, add_ons: [] };
}

/** The plan for one order. `agencyName` is the agency whose quick-buy limit Agora holds. */
export function buildPlan(args: { results: Results; listings: Listing[]; limit: number; agencyName: string; selection: ShopperSelection }): Plan {
  const { results, listings, limit, selection } = args;
  const refs = shopperRefs(results);
  const refOf = (key: string) => refs.find((r) => r.key === key)?.n;
  const refNums = (keys: string[]) => keys.map(refOf).filter((n): n is number => n !== undefined);
  const buyer = results.buyer;
  const who = buyer?.name ?? "your agency";
  const limit_phrase = buyer && buyer.name === args.agencyName ? `${buyer.name}'s ${usd(limit)} quick-buy limit` : `a typical ${usd(limit)} quick-buy limit`;
  const qty = Math.max(1, Math.floor(selection.quantity || 1));

  const chosen = shopperCandidates(results).find((o) => o.listing.id === selection.listing_id);
  const lines: PlanLine[] = [];
  if (chosen) {
    const l = chosen.listing;
    lines.push({ listing_id: l.id, title: l.title, sku: l.sku, quantity: qty, unit_price: l.unit_price, unit: l.unit, amount: round2(l.unit_price * qty) });
    const allowed = new Set(shopperAddOns(listings, results, chosen).map((l) => l.id));
    for (const a of selection.add_ons) {
      const al = listings.find((x) => x.id === a.listing_id);
      if (!al || !allowed.has(al.id)) continue;
      const q = Math.max(1, Math.floor(a.quantity || 1));
      lines.push({ listing_id: al.id, title: al.title, sku: al.sku, quantity: q, unit_price: al.unit_price, unit: al.unit, amount: round2(al.unit_price * q) });
    }
  }
  const total = chosen ? round2(lines.reduce((s, l) => s + l.amount, 0)) : null;
  const perSet = chosen ? lines.reduce((s, l) => s + l.amount, 0) / qty : 0;

  // Same test as ruleFor() in lib/assistant.ts: under the limit is a P-card, at or over it is a PO.
  let payment: PlanPayment = "quote";
  if (chosen && total !== null) {
    if (chosen.link_out) payment = "coop_site";
    else if (total < limit) payment = "pcard";
    else payment = chosen.listing.source === "no_approval" ? "needs_contract" : "po";
  }
  const gap = total === null ? 0 : round2(Math.abs(limit - total));
  const max_units = chosen && perSet > 0 ? Math.max(0, Math.ceil(limit / perSet) - 1) : 0;
  const supplier = chosen?.supplier.name ?? null;

  const members = memberHits(results);
  const joins = joinHits(results);
  const open = anyHits(results);
  const coopNames = (hs: CoopHit[]) => list([...new Set(hs.map((h) => h.coop))]);
  const hitNames = (hs: CoopHit[]) => list(hs.map((h) => `${h.supplier} (${h.coop} ${h.contract_number})`));
  const noPrices = (hs: CoopHit[]) => hs.every((h) => h.products === 0);

  // ---- the written plan (also the fallback when the model isn't available)
  let headline: string;
  let summary: string;
  const orderIs = lines.length > 1 ? "everything on your order" : "this";
  if (payment === "pcard") {
    headline = "You can buy this today on a P-card.";
    summary = `${supplier} lists ${orderIs} at a published price: **${usd(total!)} in all**. That is ${usd(gap)} under ${limit_phrase}, so no purchase order is needed.`;
  } else if (payment === "po") {
    headline = "This order needs a purchase order.";
    summary =
      `${supplier} lists ${orderIs} at a published price: **${usd(total!)} in all**. That is ${gap === 0 ? "right at" : `${usd(gap)} over`} ${limit_phrase}, so it needs a PO and approval.` +
      (max_units > 0 ? ` Up to ${max_units} would fit on a P-card, but splitting one need into several orders to stay under a limit is usually not allowed. Ask purchasing before you do.` : "");
  } else if (payment === "needs_contract") {
    headline = "This is too large to buy off contract.";
    summary = `${possessive(supplier!)} price isn't on a contract, and **${usd(total!)}** is over ${limit_phrase}. An order this size needs a contract or a solicitation.`;
  } else if (payment === "coop_site") {
    headline = `Published price, ordered on ${chosen!.link_out!.coop}'s site.`;
    summary = `${supplier} lists this at a published price: **${usd(total!)} in all**. The contract belongs to ${chosen!.link_out!.coop}, so the order is placed on its contract page, not in Agora.`;
  } else if (members.length) {
    headline = "This one starts with a quote.";
    const kindWord = members.every((h) => h.program === "state") ? "state contract" : members.some((h) => h.program === "state") ? "contract" : "co-op contract";
    summary = `No catalog item with a published price is on this order. **${COUNT[members.length] ?? members.length} ${kindWord}${members.length === 1 ? "" : "s"} open to ${who} today** cover${members.length === 1 ? "s" : ""} it: ${hitNames(members)}. Name the make, model and quantity in the quote request.`;
  } else if (joins.length) {
    headline = `No contract open to ${who} covers this yet.`;
    summary = `The closest fit is ${hitNames(joins.slice(0, 1))}, on a co-op ${who} isn't on. **Getting onto it is a question for purchasing.**`;
  } else {
    headline = "This one starts with a quote.";
    summary = `No catalog item with a published price is on this order. ${open.length ? `Co-op contracts that cover it: ${hitNames(open)}. Set your agency to see which of them you can use.` : ""}`;
  }

  // ---- routes
  const routes: PlanRoute[] = [];
  if (chosen) {
    const title =
      payment === "pcard" ? "Buy today on a P-card" : payment === "po" ? `Buy from ${supplier} with a PO` : payment === "coop_site" ? `Order on ${chosen.link_out!.coop}'s site` : "Needs a contract first";
    const what = list(lines.map((l) => `${l.quantity} × ${l.title}`));
    const then =
      payment === "pcard"
        ? "Under the quick-buy limit, so it can go in the cart now."
        : payment === "po"
          ? "Over the quick-buy limit, so the cart will route it for approval."
          : payment === "coop_site"
            ? "Agora links to the contract page and records the visit."
            : "Too large for an off-contract purchase.";
    routes.push({ kind: "priced", recommended: payment !== "needs_contract", title, body: `${what}. ${usd(total!)} in all. ${then}`, refs: refNums([`listing:${chosen.listing.id}`]), hits: [] });
  }
  // TRX state contracts lead the member hits for their state's buyers (lib/trx.ts); say what they are.
  const memberIntro = (hs: CoopHit[]) => {
    const state = hs.filter((h) => h.program === "state");
    const coop = hs.filter((h) => !h.program);
    const are = (n: number) => (n === 1 ? "is" : "are");
    const stateLine = state.length
      ? `${hitNames(state)} ${are(state.length)} ${stateLabel(state[0].state ?? "")} state contract${state.length === 1 ? "" : "s"}, open to ${who} through the ${TRX_PROGRAM[state[0].state ?? ""]?.coop_program ?? "state's cooperative purchasing program"} with no bid of its own.`
      : "";
    const coopLine = coop.length ? `${who} is on ${coopNames(coop)}. ${hitNames(coop)} ${are(coop.length)} open to you.` : "";
    return [stateLine, coopLine].filter(Boolean).join(" ");
  };
  if (members.length)
    routes.push({
      kind: "member",
      recommended: !routes.some((r) => r.recommended),
      title: `Get a quote through ${coopNames(members)}`,
      body: `${memberIntro(members)} ${noPrices(members) ? "Agora holds no prices for " + (members.length === 1 ? "it" : "them") + ", so the price comes by quote." : "Some of their products are priced in the results below."}`,
      refs: refNums(members.map((h) => `contract:${h.contract_id}`)),
      hits: members,
    });
  if (joins.length) {
    const better = results.coops.better && joins.some((h) => h.contract_id === results.coops.better!.hit.contract_id);
    routes.push({
      kind: "join",
      recommended: !routes.some((r) => r.recommended),
      title: `Ask purchasing about ${coopNames(joins)}`,
      body: `${hitNames(joins)} ${joins.length === 1 ? "covers" : "cover"} this${better ? " and fit the request better than anything on your co-ops" : ""}, but ${who} isn't on ${joins.length === 1 ? "that co-op" : "those co-ops"} yet. Who can use ${joins.length === 1 ? "it" : "them"}: ${joins[0].reason.replace(/\.$/, "")}.`,
      refs: refNums(joins.map((h) => `contract:${h.contract_id}`)),
      hits: joins,
    });
  }
  if (open.length)
    routes.push({
      kind: "coops",
      recommended: !routes.some((r) => r.recommended),
      title: "Co-op contracts that cover this",
      body: `${hitNames(open)}. Set your agency and Agora will show which of these you're already on.`,
      refs: refNums(open.map((h) => `contract:${h.contract_id}`)),
      hits: open,
    });

  // ---- what isn't known
  const unknowns: string[] = [];
  const quoted = [...members, ...joins, ...open].filter((h) => h.products === 0);
  if (quoted.length)
    unknowns.push(
      chosen
        ? `Whether a quote would beat ${possessive(supplier!)} price. No price file is loaded for ${coopNames(quoted)}, so those contracts are compared by scope only.`
        : `What this will cost. No price file is loaded for ${coopNames(quoted)}.`,
    );
  if (chosen) {
    const v = verificationSummary(chosen.supplier);
    if (v.unchecked) unknowns.push(`Whether ${supplier} passes verification. Its checks haven't been run yet.`);
    else if (v.problems) unknowns.push(`${supplier} has ${v.problems} verification check${v.problems === 1 ? "" : "s"} that need${v.problems === 1 ? "s" : ""} attention. See its storefront.`);
  }
  const leads = [...members, ...joins].filter((h) => h.verification === "research_lead");
  if (leads.length) unknowns.push(`Whether ${list(leads.map((h) => `${h.coop} ${h.contract_number}`))} ${leads.length === 1 ? "is" : "are"} current. ${leads.length === 1 ? "It is a research lead" : "They are research leads"}: confirm the term with purchasing before ordering.`);

  // ---- the purchase file
  const items = chosen ? list(lines.map((l) => `${l.quantity} × ${l.title} (${l.sku})`)) : `${qty} × ${results.request.parsed.item}, make and model to be quoted`;
  const file = {
    items,
    route:
      payment === "pcard"
        ? `${supplier}, on a P-card`
        : payment === "po"
          ? `${supplier}, by purchase order`
          : payment === "coop_site"
            ? `${supplier}, ordered on ${chosen!.link_out!.coop}'s contract page`
            : payment === "needs_contract"
              ? "None yet: needs a contract or a solicitation"
              : members.length
                ? `Quote under ${hitNames(members)}`
                : joins.length
                  ? `Ask purchasing about ${coopNames(joins)}`
                  : "Quote under a co-op contract",
    why:
      chosen && total !== null
        ? `Published price of ${usd(total)}, ${total < limit ? "under" : "at or over"} ${limit_phrase}.`
        : members.length
          ? `No catalog item with a published price was chosen. ${members.length === 1 ? "This contract is" : "These contracts are"} open to ${who}.`
          : "No contract open to the agency has a published price for this.",
    needed: payment === "pcard" ? "Nothing. Ready to buy." : payment === "po" ? "A PO and approval" : payment === "coop_site" ? "The order, placed on the co-op's site" : payment === "needs_contract" ? "A contract or a solicitation" : members.length ? "Quotes from the suppliers" : "Purchasing's answer",
  };

  return { lines, total, limit, limit_phrase, payment, gap, max_units, supplier, headline, summary, routes, unknowns, refs, file };
}

/** The purchase file as plain text, for download. */
export function purchaseFileText(results: Results, plan: Plan, confirmedAt: string | null) {
  const r = results.request;
  const out = [
    "PURCHASE FILE",
    `Prepared in Agora on ${new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}`,
    "",
    `Agency: ${results.buyer ? `${results.buyer.name}, ${results.buyer.state}` : "Not set"}`,
    `Request: "${r.raw_text}"`,
    `Items${confirmedAt ? " (confirmed by the requester)" : " (not confirmed yet)"}: ${plan.file.items}`,
    ...plan.lines.map((l) => `  ${l.quantity} × ${l.title} (${l.sku}) at ${usd(l.unit_price)} / ${l.unit} = ${usd(l.amount)}`),
    ...(plan.total !== null ? [`Total: ${usd(plan.total)}`] : []),
    "",
    `Route: ${plan.file.route}`,
    `Why: ${plan.file.why}`,
    `Still needed: ${plan.file.needed}`,
    "",
    "Options considered:",
    ...plan.routes.map((x) => `  ${x.recommended ? "[chosen] " : ""}${x.title}. ${x.body}${x.refs.length ? ` (Ref ${x.refs.join(", ")})` : ""}`),
    "",
    "Not known:",
    ...(plan.unknowns.length ? plan.unknowns.map((u) => `  ${u}`) : ["  Nothing flagged."]),
    "",
    "Sources:",
    ...plan.refs.map((x) => `  Ref ${x.n}: ${x.label}`),
    "",
    "Eligibility and prices come from Agora's contract records. This file is a record of the search, not legal advice.",
  ];
  return out.join("\n");
}
