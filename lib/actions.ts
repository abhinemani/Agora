// Every state change in the demo goes through here, so revenue events fire in
// exactly one place per action.

import { buildResults, estimateTotal, finishCoopSection, findSimilarSolicitation, mentionsPreference, parseRequest, ruleFor } from "./assistant";
import { catalogContract, catalogCoopHits, catalogOffering, catalogProducts, catalogRetrieved, catalogSupplierById, materializeSupplier } from "./catalog";
import { stateRuleFor } from "./state-rules";
import { currentScope, getDb, nextId, resetDb } from "./db";
import { dedupe, extractFile, findSupplier, parseContract, type InputFile } from "./parser";
import {
  onAppStarted,
  onContractOnboarded,
  onOrderPlaced,
  onReviewResponse,
  onSolicitationPublished,
  onSponsoredImpression,
  onMarketplaceAdded,
  fire,
  RATES,
} from "./revenue_rules";
import { CATEGORIES } from "./types";
import type { SupplierPlan } from "./types";
import type { Buyer, Cart, Category, Contract, Coop, CoopMember, Order, OrderStatus, ContractDocument, ContractHeader, Db, EdgeTier, ExtractedItem, Listing, Request, Role, Solicitation } from "./types";
import { BUYER_PRESETS, checkEligibility, STATES } from "./vehicles";
import { FREE_RFP_LIMIT, settingsFor } from "./agency";
import { parseRegister } from "./register";
import { cartAgency, cartGroups, draftCart, glCode, needsApproval, nextStep, PURCHASER, REQUESTER } from "./orders";
import { coopOf, detectCoops, isContractLevelUrl, isMember, linksOut, memberMatches, normalizeDomain } from "./coops";
import { parseMemberList } from "./members";
import { findGovernment } from "./directory";
import { buildPlan, defaultSelection, shopperAddOns, shopperCandidates, type ShopperSelection } from "./shopper";
import { answerQuestion, shopperFacts, writeBrief, type ShopperTurn } from "./shopper-ai";
import { paperworkKinds, paperworkTemplate, type PaperworkKind } from "./paperwork";
import { polish } from "./paperwork-ai";
import { askDocument, contractBrief, readableContracts } from "./docs";
import { diveItems, diveSearch, diveVerdict, offlineDiveFilters, type DiveFilter } from "./dive";
import { readDiveMessage, writeVerdict } from "./dive-ai";

const EVIDENCE_RANK = { list: 0, roster: 1, agency: 2, purchase: 3 } as const;
const rankEvidence = (e: keyof typeof EVIDENCE_RANK | undefined) => EVIDENCE_RANK[e ?? "list"];
import { canSponsor, claimMatchesWebsite, isClaimed, isOffContract, listingFeeCurrent, PLANS } from "./suppliers";

const now = () => new Date().toISOString();

function fail(message: string): never {
  throw new ActionError(message);
}
export class ActionError extends Error {}

// ---------------------------------------------------------------- buyer

export async function createRequest(text: string) {
  const db = getDb();
  const raw = text.trim();
  if (!raw) fail("Tell me what you need.");
  const { parsed, mode } = await parseRequest(raw, db);
  const request: Request = {
    id: nextId(db, "request", "req"),
    raw_text: raw,
    parsed: { ...parsed, est_total: estimateTotal(db, parsed.item, parsed.quantity) },
    parse_mode: mode,
    preference_answer: null,
    created_at: now(),
    outcome: null,
    owner: currentScope()?.user?.id ?? (currentScope()?.visitor ? `v:${currentScope()!.visitor}` : undefined),
  };

  // Preference policies are on file only for the home agency.
  const prefs = db.agency.preferences;
  const isHome = !db.session.buyer || db.session.buyer.name === db.agency.name;
  const hasPolicy = isHome && (prefs.local || prefs.mbe || prefs.sustainable);
  const remembered = db.session.preference_answer;
  let needsPreference = false;
  if (mentionsPreference(raw)) request.preference_answer = /\b(no|not|don't)\b.*\b(local|mbe)\b/i.test(raw) ? "no" : "yes";
  else if (remembered === "yes" || remembered === "no") request.preference_answer = remembered;
  else needsPreference = hasPolicy;

  db.requests.unshift(request);
  return { request, needsPreference, needsBuyer: !db.session.buyer };
}

export function setBuyer(buyer: Buyer) {
  const db = getDb();
  if (!buyer?.name?.trim()) fail("Name the agency that's buying.");
  if (!STATES.some(([c]) => c === buyer.state)) fail("Pick the agency's state.");
  const pop = buyer.population == null || String(buyer.population) === "" ? null : Math.max(0, Math.round(Number(buyer.population)));
  const domain = normalizeDomain(buyer.domain) || undefined;
  const set: Buyer = { name: buyer.name.trim(), state: buyer.state, entity_type: buyer.entity_type, population: Number.isFinite(pop as number) ? pop : null, domain };
  // The co-op directory: published rosters, agencies' own pages and documented purchases.
  const gov = findGovernment({ ...set, directory_id: buyer.directory_id });
  if (gov) {
    set.directory_id = gov.id;
    if (!set.domain && gov.domain) set.domain = gov.domain;
  }
  db.session.buyer = set;
  for (const c of gov?.coops ?? []) {
    if (!db.coops.some((x) => x.id === c.coop_id)) continue;
    const existing = db.memberships.find((m) => m.agency === set.name && m.coop_id === c.coop_id);
    if (!existing) db.memberships.push({ agency: set.name, coop_id: c.coop_id, source: "detected", evidence: c.evidence, member_id: c.member_id, source_url: c.source_url, confirmed: false });
    else if (existing.source === "detected" && rankEvidence(c.evidence) > rankEvidence(existing.evidence)) Object.assign(existing, { evidence: c.evidence, member_id: c.member_id ?? existing.member_id, source_url: c.source_url ?? existing.source_url });
  }
  // Member lists uploaded to Agora (and the demo lists), matched on website, then name and state.
  for (const coop of detectCoops(db, set))
    if (!isMember(db, set.name, coop.id)) db.memberships.push({ agency: set.name, coop_id: coop.id, source: "detected", evidence: "list", confirmed: false });
  return db.session.buyer;
}

/** Order numbers carry the buying agency's initials ("City of Riverbend" → RB,
 * "Harmon Lake Township" → HL); AG when no agency is set. */
function orderPrefix(name?: string) {
  if (!name) return "AG";
  if (name === "City of Riverbend") return "RB";
  const words = name.split(/\s+/).filter((w) => !/^(of|the|city|town|township|county|borough|village|state|department)$/i.test(w));
  return (words.map((w) => w[0]).join("").slice(0, 2) || name.slice(0, 2)).toUpperCase();
}

export function clearBuyer() {
  getDb().session.buyer = null;
  return null;
}

/** A co-op route priced off list: record the request for a supplier quote. */
export function requestQuote(args: { listingId: string; contractId: string; quantity: number; note?: string }) {
  const db = getDb();
  const listing = db.listings.find((l) => l.id === args.listingId) ?? fail("Listing not found");
  const contract = db.contracts.find((c) => c.id === args.contractId) ?? fail("Contract not found");
  const buyer = db.session.buyer ?? fail("Set your agency first (top right, Your agency) so the supplier knows who's asking.");
  const check = checkEligibility(contract, buyer);
  if (!check.eligible) fail(`${contract.vehicle ?? contract.owner} ${contract.contract_number} isn't open to ${buyer.name}: ${check.reason}.`);
  if (linksOut(db, contract)) fail(`Quotes on ${contract.vehicle ?? contract.owner} ${contract.contract_number} go through ${coopOf(db, contract)?.name}'s contract page.`);
  const quote = {
    id: nextId(db, "quote", "QR", 4).replace("_", "-"),
    listing_id: listing.id,
    contract_id: contract.id,
    buyer,
    quantity: Math.max(1, Math.floor(args.quantity || 1)),
    note: args.note?.trim() ?? "",
    created_at: now(),
  };
  db.quotes.unshift(quote);
  return quote;
}

export function setPreference(requestId: string, answer: "yes" | "no" | "always_ask") {
  const db = getDb();
  const r = db.requests.find((r) => r.id === requestId) ?? fail("Request not found");
  r.preference_answer = answer;
  db.session.preference_answer = answer;
  return r;
}

const impressionsBilled = new Set<string>();

export function getResults(requestId: string) {
  const db = getDb();
  const request = db.requests.find((r) => r.id === requestId) ?? fail("Request not found");
  const results = buildResults(db, request);
  // The co-op catalog: every co-op's public contract directory, beyond the contracts Agora seeds.
  const cat = catalogCoopHits(db, request.parsed.item, db.session.buyer, { category: request.parsed.category });
  if (cat.hits.length || cat.gsa.length) {
    const section = finishCoopSection(db, [...results.coops.hits, ...cat.hits], db.session.buyer?.name ?? null);
    results.coops = { ...section, catalog: { retrieved: catalogRetrieved(), more_member: cat.more_member, more_other: cat.more_other, gsa: cat.gsa, gsa_total: cat.gsa_total } };
  }
  results.coops = { ...results.coops, state_rule: stateRuleFor(db.session.buyer, `${request.raw_text} ${request.parsed.item}`) };
  const products = catalogProducts(db, request.parsed.item, db.session.buyer);
  if (products.hits.length) results.catalog_products = { ...products, retrieved: catalogRetrieved() };

  // Option 5: one impression per sponsoring supplier per results page. Keyed on
  // the request so re-renders and refreshes don't bill twice.
  const sponsors = new Set(results.groups.flatMap((g) => g.options.filter((o) => o.sponsored).map((o) => o.supplier)));
  for (const s of sponsors) {
    const key = `${request.id}:${s.id}`;
    if (impressionsBilled.has(key)) continue;
    impressionsBilled.add(key);
    onSponsoredImpression(db, s.name, request.id);
  }

  // Co-op contracts shown, for the traffic Sovra reports to each co-op. Once per request.
  results.coops.hits.forEach((h, rank) => {
    const key = `coopimp:${request.id}:${h.contract_id}`;
    if (impressionsBilled.has(key)) return;
    impressionsBilled.add(key);
    db.impressions.push({ request_id: request.id, contract_id: h.contract_id, coop_id: h.coop_id, agency: db.session.buyer?.name ?? null, rank: rank + 1, fit: h.fit, member: h.member, created_at: now() });
  });

  // Count each supplier's appearances in buyer results for their storefront stats.
  for (const sup of new Set(results.groups.flatMap((g) => g.options.map((o) => o.supplier.id)))) {
    const key = `appear:${request.id}:${sup}`;
    if (impressionsBilled.has(key)) continue;
    impressionsBilled.add(key);
    db.counters[`appear_${sup}`] = (db.counters[`appear_${sup}`] ?? 0) + 1;
  }

  // Requests nothing covers become unmet demand that suppliers can see.
  if (results.no_match && !db.unmet.some((u) => u.id === `um_${request.id}`)) {
    db.unmet.unshift({
      id: `um_${request.id}`,
      agency_name: db.agency.name,
      search_text: request.raw_text,
      category: (request.parsed.category ?? "Other") as Category,
      date: now().slice(0, 10),
    });
  }
  return results;
}

// ---------------------------------------------------------------- personal shopper

/** The requester confirms what they're buying: a catalog item (or "by quote"), how many, and any add-ons. */
export function confirmItems(args: { requestId: string; listingId: string | null; quantity: number; addOns?: { listingId: string; quantity: number }[] }) {
  const db = getDb();
  const request = db.requests.find((r) => r.id === args.requestId) ?? fail("Request not found");
  const quantity = Math.floor(Number(args.quantity));
  if (!Number.isFinite(quantity) || quantity < 1 || quantity > 100_000) fail("Enter how many you need.");
  const results = getResults(request.id);
  // Only items the rules already offered this buyer can be confirmed.
  const chosen = args.listingId ? (shopperCandidates(results).find((o) => o.listing.id === args.listingId) ?? fail("That item isn't one of the options open to you.")) : undefined;
  const allowed = new Set(shopperAddOns(db.listings, results, chosen).map((l) => l.id));
  const add_ons = (args.addOns ?? [])
    .filter((a) => allowed.has(a.listingId))
    .map((a) => ({ listing_id: a.listingId, quantity: Math.max(1, Math.floor(Number(a.quantity) || 1)) }));
  request.parsed = { ...request.parsed, quantity, est_total: estimateTotal(db, request.parsed.item, quantity) };
  request.shopper = { listing_id: chosen?.listing.id ?? null, add_ons, confirmed_at: now() };
  return request;
}

/** Reopen the confirm step. */
export function editItems(requestId: string) {
  const db = getDb();
  const request = db.requests.find((r) => r.id === requestId) ?? fail("Request not found");
  delete request.shopper;
  return request;
}

function shopperContext(requestId: string) {
  const db = getDb();
  const request = db.requests.find((r) => r.id === requestId) ?? fail("Request not found");
  const results = getResults(request.id);
  const selection: ShopperSelection = defaultSelection(results, request);
  const plan = buildPlan({ results, listings: db.listings, limit: db.agency.quick_buy_threshold, agencyName: db.agency.name, selection });
  return { db, results, plan };
}

/** The plan in the shopper's words. Null means "keep the rule-based wording": no key, a failure, or an answer that didn't check out. */
export async function shopperBrief(requestId: string) {
  const { db, results, plan } = shopperContext(requestId);
  return writeBrief(db, results, plan);
}

/** A question about this purchase. Read-only: it never changes anything. */
export async function askShopper(args: { requestId: string; question: string; history?: ShopperTurn[] }) {
  const question = String(args.question ?? "").trim().slice(0, 500);
  if (!question) fail("Type a question first.");
  const { db, results, plan } = shopperContext(args.requestId);
  const history = (Array.isArray(args.history) ? args.history : []).slice(-4).map((t) => ({ question: String(t.question).slice(0, 500), answer: (Array.isArray(t.answer) ? t.answer : []).map((a) => String(a).slice(0, 1500)) }));
  return answerQuestion(db, results, plan, question, history);
}

/** A document drafted from the purchase file. The template is complete on its own; the model only tidies its wording. */
export async function draftPaperwork(args: { requestId: string; kind: PaperworkKind }) {
  const { db, results, plan } = shopperContext(args.requestId);
  if (!paperworkKinds(plan).includes(args.kind)) fail("That document doesn't apply to this purchase.");
  return polish(paperworkTemplate(results, plan, args.kind), shopperFacts(db, results, plan), plan.refs.map((r) => r.n));
}

// ---------------------------------------------------------------- ask a contract

/** Contracts whose source documents Agora can read. */
export function contractsToAsk() {
  return readableContracts(getDb());
}

/** A question answered from one contract's documents, with the passages it rests on. Read-only. */
export async function askContract(args: { contractId: string; question: string }) {
  const question = String(args.question ?? "").trim().slice(0, 400);
  if (!question) fail("Type a question first.");
  return askDocument(getDb(), String(args.contractId ?? ""), question);
}

/** A contract's documents read into the same six fields every contract page shows. Read-only. */
export async function briefContract(args: { contractId: string }) {
  try {
    return await contractBrief(getDb(), String(args.contractId ?? ""));
  } catch (e) {
    fail((e as Error).message);
  }
}

// ---------------------------------------------------------------- product dive

const FILTER_KINDS = new Set(["price", "word", "not_word", "maker", "usable", "priced"]);
function cleanFilters(input: unknown): DiveFilter[] {
  const out: DiveFilter[] = [];
  for (const f of Array.isArray(input) ? input.slice(0, 20) : []) {
    if (!f || !FILTER_KINDS.has(f.kind)) continue;
    if (f.kind === "price") {
      const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : undefined);
      if (num(f.min) !== undefined || num(f.max) !== undefined) out.push({ kind: "price", min: num(f.min), max: num(f.max) });
    } else if (f.kind === "usable" || f.kind === "priced") out.push({ kind: f.kind });
    else if (typeof f.value === "string" && f.value.trim()) out.push({ kind: f.kind, value: f.value.trim().slice(0, 80) });
  }
  // One filter of each one-off kind; the newest wins.
  const lastOf = (kind: string) => out.map((x) => x.kind).lastIndexOf(kind as DiveFilter["kind"]);
  return out.filter((f, i) => !["price", "maker", "usable", "priced"].includes(f.kind) || lastOf(f.kind) === i);
}

/** One turn of the product dive. `need` starts a dive from the buyer's own words; `message` narrows an open one. Read-only. */
export async function dive(args: { need?: string; query?: string; filters?: unknown; message?: string }) {
  const db = getDb();
  let query = String(args.query ?? "").trim();
  let filters = cleanFilters(args.filters);
  let said = "";
  if (!query) {
    const need = String(args.need ?? "").trim().slice(0, 300);
    if (!need) fail("Tell me what you're looking for.");
    // The same reader as search: the thing being bought, without the quantity or the purpose.
    query = (await parseRequest(need, db)).parsed.item || need;
    const first = diveSearch(db, query, []);
    filters = cleanFilters(offlineDiveFilters(need, first).filter((f) => f.kind === "price"));
  }
  const message = String(args.message ?? "").trim().slice(0, 300);
  if (message) {
    const before = diveSearch(db, query, filters);
    const read = (await readDiveMessage(message, before)) ?? { filters: offlineDiveFilters(message, before), reply: "" };
    said = read.reply || (read.filters.length ? "" : "Nothing on the shortlist can be narrowed by that. Try one of the questions, or a word from a product's name.");
    filters = cleanFilters([...filters, ...read.filters]);
  }
  return { state: diveSearch(db, query, filters), said };
}

/** Two or three finalists side by side, with the rule-based read and, when available, the shopper's wording of it. */
export async function diveCompare(args: { query: string; ids: string[] }) {
  const db = getDb();
  const ids = (Array.isArray(args.ids) ? args.ids : []).map(String).slice(0, 3);
  const items = diveItems(db, String(args.query ?? ""), ids);
  if (items.length < 2) fail("Pick two or three products to compare.");
  const verdict = diveVerdict(items);
  return { items, verdict, written: await writeVerdict(String(args.query ?? ""), items, verdict) };
}

export function placeOrder(args: { listingId: string; quantity: number; requestId?: string | null; department: string }) {
  const db = getDb();
  const listing = db.listings.find((l) => l.id === args.listingId) ?? fail("Listing not found");
  const qty = Math.max(1, Math.floor(args.quantity));
  const unit = unitPrice(db, listing, qty);
  const rule = ruleFor(db, { ...listing, unit_price: unit }, qty);
  return createOrder(db, { listing, quantity: qty, requestId: args.requestId ?? null, department: args.department, payment: rule.payment, preApproved: false });
}

function unitPrice(db: Db, listing: Listing, qty: number) {
  const tier = [...(db.extracted.find((e) => e.id === listing.extracted_item_id)?.tier_pricing ?? [])]
    .sort((a, b) => b.min_qty - a.min_qty)
    .find((t) => qty >= t.min_qty);
  return tier?.unit_price ?? listing.unit_price;
}

/** Every order, from checkout or a cart, goes through here: same checks, same revenue events. */
function createOrder(
  db: Db,
  args: { listing: Listing; quantity: number; requestId: string | null; department: string; payment: "pcard" | "po"; preApproved: boolean; cartId?: string; requester?: string; note?: string },
) {
  const { listing } = args;
  const contractFor = db.contracts.find((c) => c.id === listing.contract_id);
  const access = checkEligibility(contractFor, db.session.buyer);
  if (!access.eligible) fail(`This contract isn't open to ${db.session.buyer?.name}: ${access.reason}.`);
  if (linksOut(db, contractFor)) fail(`${contractFor?.vehicle} ${contractFor?.contract_number} is bought on ${coopOf(db, contractFor)?.name}'s own contract page, not in Agora.`);
  const qty = args.quantity;
  const total = Math.round(unitPrice(db, listing, qty) * qty * 100) / 100;
  if (listing.source === "no_approval" && total >= db.agency.quick_buy_threshold) fail("Off-contract purchases must stay under the quick-buy limit.");

  const n = (db.counters.order = (db.counters.order ?? 0) + 1);
  const status: OrderStatus = args.payment === "po" ? (args.preApproved ? "approved" : "pending_approval") : "placed";
  const order: Order = {
    id: `${orderPrefix(db.session.buyer?.name)}-${args.payment === "po" ? "PO" : "PC"}-${n}`,
    request_id: args.requestId,
    listing_id: listing.id,
    quantity: qty,
    total,
    payment: args.payment,
    status,
    department: args.department,
    created_at: now(),
    requester: args.requester ?? REQUESTER,
    cart_id: args.cartId ?? null,
    gl_code: glCode(db, args.department),
    events: [
      { status: args.payment === "po" ? "pending_approval" : "placed", at: now(), note: args.payment === "po" ? "PO created and sent for approval" : "Ordered on the P-card; charged when it ships" },
      ...(status === "approved" ? [{ status: "approved" as const, at: now(), note: args.note ?? `PO approved by ${PURCHASER}, Purchasing` }] : []),
    ],
  };
  db.orders.unshift(order);
  const req = db.requests.find((r) => r.id === args.requestId);
  if (req) req.outcome = "ordered";

  const supplier = db.suppliers.find((s) => s.id === listing.supplier_id)!;
  const events = onOrderPlaced(db, {
    orderId: order.id,
    total,
    source: listing.source,
    payment: order.payment,
    supplierName: supplier.name,
    contractId: listing.contract_id,
  });
  return { order, events };
}

export function approveOrder(orderId: string) {
  const db = getDb();
  const o = db.orders.find((o) => o.id === orderId) ?? fail("Order not found");
  if (o.status !== "pending_approval") fail(`${o.id} isn't waiting on approval.`);
  o.status = "approved";
  (o.events ??= []).push({ status: "approved", at: now(), note: `PO approved by ${PURCHASER}, Purchasing` });
  return o;
}

/** Move an order to its next step: shipped, received, invoice matched, reconciled. */
export function advanceOrder(orderId: string) {
  const db = getDb();
  const o = db.orders.find((o) => o.id === orderId) ?? fail("Order not found");
  const next = nextStep(o) ?? fail(o.status === "pending_approval" ? `${o.id} needs approval first.` : `${o.id} is already reconciled.`);
  const listing = db.listings.find((l) => l.id === o.listing_id);
  const supplier = db.suppliers.find((s) => s.id === listing?.supplier_id);
  const seq = o.id.replace(/\D/g, "");
  let note = "";
  if (next.status === "shipped") note = `${supplier?.name ?? "Supplier"} shipped it; tracking 1Z${seq.padStart(6, "0")}4410`;
  if (next.status === "delivered") note = `Received by ${o.department}`;
  if (next.status === "invoiced") {
    o.invoice = { number: `INV-${seq}`, amount: o.total };
    note = `Invoice INV-${seq} for ${o.total.toLocaleString("en-US", { style: "currency", currency: "USD" })} matches the PO and the receipt`;
  }
  if (next.status === "reconciled")
    note = o.payment === "pcard" ? `Card charge matched to the receipt and coded to ${o.gl_code ?? glCode(db, o.department)}` : `Payment approved and the PO closed, coded to ${o.gl_code ?? glCode(db, o.department)}`;
  o.status = next.status;
  (o.events ??= []).push({ status: next.status, at: now(), note });
  return o;
}

// ---------------------------------------------------------------- carts

function activeCart(db: Db) {
  let cart = draftCart(db);
  if (!cart) {
    cart = { id: nextId(db, "cart", "cart", 3), agency: cartAgency(db), status: "draft", lines: [], created_by: REQUESTER, holder: REQUESTER, order_ids: [], created_at: now(), updated_at: now() };
    db.carts.unshift(cart);
  }
  return cart;
}

function cartById(db: Db, id: string) {
  return db.carts.find((c) => c.id === id) ?? fail("Cart not found");
}

export function addToCart(args: { listingId: string; quantity: number; requestId?: string | null }) {
  const db = getDb();
  const listing = db.listings.find((l) => l.id === args.listingId) ?? fail("Listing not found");
  const contract = db.contracts.find((c) => c.id === listing.contract_id);
  const access = checkEligibility(contract, db.session.buyer);
  if (!access.eligible) fail(`${listing.title} isn't open to ${db.session.buyer?.name}: ${access.reason}.`);
  if (linksOut(db, contract)) fail(`${listing.title} is bought on ${coopOf(db, contract)?.name}'s own site, so it can't go in the cart.`);
  const cart = activeCart(db);
  const qty = Math.max(1, Math.floor(args.quantity || 1));
  const line = cart.lines.find((l) => l.listing_id === listing.id);
  if (line) line.quantity += qty;
  else cart.lines.push({ listing_id: listing.id, quantity: qty, request_id: args.requestId ?? null });
  cart.updated_at = now();
  return cart;
}

export function updateCartLine(args: { listingId: string; quantity: number }) {
  const db = getDb();
  const cart = draftCart(db) ?? fail("There's no open cart.");
  const qty = Math.floor(args.quantity);
  cart.lines = qty > 0 ? cart.lines.map((l) => (l.listing_id === args.listingId ? { ...l, quantity: qty } : l)) : cart.lines.filter((l) => l.listing_id !== args.listingId);
  cart.updated_at = now();
  return cart;
}

/** Hand the cart to someone who can buy: the person who needs the items is often not the card holder. */
export function handoffCart(args: { to: string; division: string; shipTo: string; notes?: string }) {
  const db = getDb();
  const cart = draftCart(db) ?? fail("There's no open cart.");
  if (!cart.lines.length) fail("Add something to the cart first.");
  const to = args.to?.trim() || fail("Say who you're handing the cart to.");
  if (!args.division?.trim()) fail("Pick the division the purchase is for.");
  if (!args.shipTo?.trim()) fail("Add where it should be delivered.");
  cart.handoff = { from: cart.holder, to, division: args.division.trim(), ship_to: args.shipTo.trim(), notes: args.notes?.trim() ?? "", at: now() };
  cart.holder = to;
  cart.updated_at = now();
  return cart;
}

/** Check out: a cart where any supplier's share needs a PO goes to Purchasing first; otherwise it orders now. */
export function submitCart() {
  const db = getDb();
  const cart = draftCart(db) ?? fail("There's no open cart.");
  const groups = cartGroups(db, cart);
  if (!groups.length) fail("Add something to the cart first.");
  const blocked = groups.find((g) => g.blocked);
  if (blocked) fail(blocked.blocked!);
  cart.submitted_at = now();
  cart.updated_at = now();
  if (needsApproval(groups)) {
    cart.status = "pending";
    return cart;
  }
  return placeCart(db, cart, false);
}

function placeCart(db: Db, cart: Cart, approved: boolean) {
  const department = cart.handoff?.division ?? db.agency.departments[0].name;
  for (const g of cartGroups(db, cart))
    for (const line of g.lines) {
      const { order } = createOrder(db, {
        listing: line.listing,
        quantity: line.quantity,
        requestId: line.request_id ?? null,
        department,
        payment: g.payment,
        preApproved: approved,
        cartId: cart.id,
        requester: cart.created_by,
        note: `PO approved by ${PURCHASER} with cart ${cart.id}`,
      });
      cart.order_ids.push(order.id);
    }
  cart.status = "approved";
  return cart;
}

export function approveCart(cartId: string) {
  const db = getDb();
  const cart = cartById(db, cartId);
  if (cart.status !== "pending") fail(`Cart ${cart.id} isn't waiting on approval.`);
  cart.decided_by = PURCHASER;
  cart.decided_at = now();
  return placeCart(db, cart, true);
}

export function rejectCart(args: { cartId: string; reason: string }) {
  const db = getDb();
  const cart = cartById(db, args.cartId);
  if (cart.status !== "pending") fail(`Cart ${cart.id} isn't waiting on approval.`);
  const reason = args.reason?.trim() || fail("Say why, so the requester can fix it.");
  Object.assign(cart, { status: "rejected", reject_reason: reason, decided_by: PURCHASER, decided_at: now(), updated_at: now() });
  return cart;
}

/** A rejected cart goes back to draft for changes (merged into any cart already open). */
export function reviseCart(cartId: string) {
  const db = getDb();
  const cart = cartById(db, cartId);
  if (cart.status !== "rejected") fail("Only a rejected cart can be revised.");
  const open = draftCart(db);
  if (open && open.id !== cart.id) {
    for (const l of cart.lines) {
      const have = open.lines.find((x) => x.listing_id === l.listing_id);
      if (have) have.quantity += l.quantity;
      else open.lines.push(l);
    }
    db.carts = db.carts.filter((c) => c.id !== cart.id);
    return open;
  }
  Object.assign(cart, { status: "draft", updated_at: now() });
  return cart;
}

// ---------------------------------------------------------------- solicitations

export function draftSolicitation(requestId: string) {
  const db = getDb();
  const r = db.requests.find((r) => r.id === requestId) ?? fail("Request not found");
  const base = findSimilarSolicitation(db, r);
  const item = r.parsed.item.replace(/^\w/, (c) => c.toUpperCase());
  const where = r.raw_text.match(/\bfor (the )?(.+?)(,|$| delivered| by| before)/i)?.[2];
  const draft: Solicitation = {
    id: "",
    title: where ? `${item}, ${where}` : item,
    scope:
      `${r.raw_text.replace(/\.$/, "")}. ` +
      (base ? `Scope modeled on "${base.title}": ${base.scope}` : "Contractor to furnish all labor, materials and equipment."),
    quantity: r.parsed.quantity > 1 ? `${r.parsed.quantity}` : "1 project",
    est_budget: base?.est_budget ? Math.round(base.est_budget * 0.6 / 1000) * 1000 : 50_000,
    criteria: base?.criteria ?? ["Price (40%)", "Qualifications (30%)", "Schedule (30%)"],
    piggybackable: true,
    status: "draft",
    category: (r.parsed.category ?? base?.category ?? "Other") as Category,
    awarded_supplier_id: null,
    awarded_listing_id: null,
    request_id: r.id,
    based_on_id: base?.id ?? null,
  };
  return { draft, basedOn: base };
}

/** Proactive buying: an expiring contract becomes a request that goes straight
 * to an early solicitation draft, before anyone has to notice the lapse. */
export function startRenewal(contractId: string) {
  const db = getDb();
  const c = db.contracts.find((c) => c.id === contractId) ?? fail("Contract not found");
  const category = (db.listings.find((l) => l.contract_id === c.id)?.category ?? "Other") as Category;
  const request: Request = {
    id: nextId(db, "request", "req"),
    raw_text: `Renew ${c.title.toLowerCase()} contract ${c.contract_number} before it expires`,
    parsed: { item: c.title.toLowerCase(), quantity: 1, deadline: `by ${c.end}`, department: "City Hall Administration", category, est_total: 0 },
    parse_mode: "offline",
    preference_answer: db.session.preference_answer,
    created_at: now(),
    outcome: null,
  };
  db.requests.unshift(request);
  return request;
}

export function publishSolicitation(draft: Solicitation) {
  const db = getDb();
  if (!draft.title?.trim()) fail("Give the solicitation a title.");
  // Free intake covers FREE_RFP_LIMIT published RFPs a year; search is never limited.
  const settings = saveSettings(db, db.session.buyer?.name ?? db.agency.name);
  if (settings.plan === "free" && settings.rfp_used >= FREE_RFP_LIMIT)
    fail(`PLAN_LIMIT: ${settings.agency} has used all ${FREE_RFP_LIMIT} free RFPs for ${settings.rfp_year}. Upgrade, or send this one to your own RFP tool.`);
  if (settings.plan === "free") settings.rfp_used += 1;
  const sol: Solicitation = { ...draft, id: nextId(db, "solicitation", "sol"), status: "open", published_at: now() };
  db.solicitations.unshift(sol);
  const r = db.requests.find((r) => r.id === draft.request_id);
  if (r) r.outcome = "solicitation";
  onSolicitationPublished(db, sol.title, sol.id);
  return sol;
}

/** An awarded solicitation becomes a contract and a listing in the city's marketplace. */
export function listAward(solicitationId: string) {
  const db = getDb();
  const sol = db.solicitations.find((s) => s.id === solicitationId) ?? fail("Solicitation not found");
  if (sol.status !== "awarded" || !sol.awarded_supplier_id) fail("Only awarded solicitations can be listed.");
  if (sol.awarded_listing_id) fail("Already listed.");
  const contract: Contract = {
    id: nextId(db, "contract", "ctr_new"),
    supplier_id: sol.awarded_supplier_id,
    source: "own_contract",
    owner: db.agency.name,
    title: sol.title,
    contract_number: `RB-2026-${sol.id.slice(-3)}A`,
    start: now().slice(0, 10),
    end: `${new Date().getFullYear() + 3}-${now().slice(5, 10)}`,
    piggybackable: sol.piggybackable,
    piggyback_clause_text: sol.piggybackable ? "Other public agencies may purchase under the terms of this award with the Contractor's consent." : "",
    payment_terms: "Net 30",
    delivery_terms: "FOB destination, installed",
    marketplace_ids: ["mkt_riverbend"],
    source_document_id: null,
    onboarding_billed: true,
  };
  db.contracts.push(contract);
  const listing: Listing = {
    id: nextId(db, "listing", "lst"),
    contract_id: contract.id,
    supplier_id: sol.awarded_supplier_id,
    source: "own_contract",
    sku: `AWD-${sol.id.toUpperCase()}`,
    title: sol.title,
    category: sol.category,
    unit_price: sol.awarded_price ?? 0,
    unit: sol.awarded_unit ?? "ea",
    lead_time_days: 30,
    extracted_item_id: null,
    marketplace_ids: ["mkt_riverbend"],
    detail: "Awarded through Riverbend solicitation; available to other agencies",
  };
  db.listings.push(listing);
  sol.awarded_listing_id = listing.id;
  onContractOnboarded(db, contract.id, `Award listed: ${sol.title}`);
  return { contract, listing };
}

// ---------------------------------------------------------------- contract upload

/** Read uploaded contract files. A hint (from the co-op catalog, for a queued price list) fills
 * header fields the reader couldn't find, such as the supplier a GSA catalog page belongs to. */
export async function parseUpload(files: InputFile[], role: Role, hint?: Partial<ContractHeader>) {
  const db = getDb();
  const started = Date.now();
  const extracted = await Promise.all(files.map(extractFile));
  const parsed = await parseContract(extracted);
  const header = { ...parsed.header };
  for (const [k, v] of Object.entries(hint ?? {}) as [keyof ContractHeader, never][])
    if (v && (!header[k] || (k === "title" && header.title === "Untitled contract"))) header[k] = v;
  const out = { ...parsed, header };

  const docs: ContractDocument[] = extracted.map((f) => ({
    id: nextId(db, "doc", "doc"),
    filename: f.filename,
    mime_type: f.mime,
    file_hash: f.hash,
    uploaded_by_role: role,
    uploaded_at: now(),
    page_count: f.page_count,
    parse_status: "parsed",
    parse_summary: { items_found: 0, items_accepted: 0, items_unresolved: 0 },
  }));
  const docFor = (file: string) => docs.find((d) => d.filename === file) ?? docs[0];

  const items: ExtractedItem[] = out.items.map((d, i) => ({
    ...d,
    flags: [...d.flags],
    id: nextId(db, "item", "xi", 4),
    document_id: docFor(d.source_file).id,
    row_index: i,
    listing_id: null,
  }));
  dedupe(db, items, out.header.supplier_name);

  for (const doc of docs) {
    const mine = items.filter((i) => i.document_id === doc.id);
    doc.parse_summary = {
      items_found: mine.length,
      items_accepted: 0,
      items_unresolved: mine.filter((i) => i.status === "unresolved").length,
    };
  }
  db.documents.push(...docs);
  db.extracted.push(...items);

  const supplier = findSupplier(db, out.header.supplier_name);
  return {
    documents: docs,
    files: extracted.map((f) => ({ filename: f.filename, kind: f.kind, page_count: f.page_count, pages: f.pages })),
    header: out.header,
    items,
    mode: out.mode,
    supplier: supplier ?? null,
    duration_ms: Date.now() - started,
  };
}

export function publishContract(args: {
  documentIds: string[];
  header: ContractHeader;
  items: ExtractedItem[];
  marketplaceIds: string[];
  role: Role;
}) {
  const db = getDb();
  const h = args.header;
  if (!h.supplier_name.trim()) fail("The contract needs a supplier name.");
  const marketplaceIds = args.marketplaceIds.length ? args.marketplaceIds : ["mkt_riverbend"];

  let supplier = findSupplier(db, h.supplier_name);
  if (!supplier) {
    supplier = {
      id: nextId(db, "supplier", "sup_new"),
      name: h.supplier_name.trim(),
      city: "",
      state: "",
      is_local: false,
      certifications: [],
      verified: { insurance: false, bond: false },
      edge_tier: "discover",
      rating: 0,
      review_count: 0,
      sponsored: false,
      categories: [],
    };
    db.suppliers.push(supplier);
  }

  let contract = db.contracts.find((c) => c.contract_number && c.contract_number === h.contract_number);
  if (!contract) {
    contract = {
      id: nextId(db, "contract", "ctr_new"),
      supplier_id: supplier.id,
      source: h.source,
      owner: h.owner,
      title: h.title,
      contract_number: h.contract_number,
      start: h.start,
      end: h.end,
      piggybackable: h.piggyback_clause_present,
      piggyback_clause_text: h.piggyback_clause_text,
      payment_terms: h.payment_terms,
      delivery_terms: h.delivery_terms,
      marketplace_ids: marketplaceIds,
      source_document_id: args.documentIds[0] ?? null,
      onboarding_billed: true,
    };
    db.contracts.push(contract);
  } else {
    contract.marketplace_ids = [...new Set([...contract.marketplace_ids, ...marketplaceIds])];
  }

  let listed = 0;
  let replaced = 0;
  const attention: string[] = [];
  for (const incoming of args.items) {
    const item = db.extracted.find((e) => e.id === incoming.id);
    if (!item) continue;
    Object.assign(item, {
      sku: incoming.sku,
      description: incoming.description,
      unit: incoming.unit,
      unit_price: incoming.unit_price,
      category: incoming.category,
      status: incoming.status,
      replace_existing: incoming.replace_existing,
    });

    if (item.status === "accepted" && item.unit_price != null) {
      const existing = item.replace_existing && item.duplicate_of_listing_id ? db.listings.find((l) => l.id === item.duplicate_of_listing_id) : undefined;
      if (existing) {
        Object.assign(existing, {
          unit_price: item.unit_price,
          contract_id: contract.id,
          source: contract.source,
          extracted_item_id: item.id,
          marketplace_ids: [...new Set([...existing.marketplace_ids, ...marketplaceIds])],
        });
        item.listing_id = existing.id;
        replaced++;
      } else {
        const listing: Listing = {
          id: nextId(db, "listing", "lst"),
          contract_id: contract.id,
          supplier_id: supplier.id,
          source: contract.source,
          sku: item.sku ?? `${contract.contract_number}-${item.row_index + 1}`,
          title: item.description,
          category: item.category,
          unit_price: item.unit_price,
          unit: item.unit,
          lead_time_days: item.category === "Furniture" ? 14 : 3,
          extracted_item_id: item.id,
          marketplace_ids: marketplaceIds,
        };
        db.listings.push(listing);
        item.listing_id = listing.id;
      }
      listed++;
    } else if (item.status === "pending" || item.status === "unresolved") {
      attention.push(item.id);
      db.attention.push({
        id: nextId(db, "attention", "att"),
        supplier_id: supplier.id,
        contract_id: contract.id,
        document_id: item.document_id,
        extracted_item_id: item.id,
        description: item.description,
        reason: item.flags.find((f) => f.startsWith("Unresolved"))?.replace(/^Unresolved:\s*/, "") ?? "Not reviewed before publishing",
        source_excerpt: item.source_excerpt,
        created_at: now(),
        resolved: false,
      });
    }
  }

  for (const doc of db.documents.filter((d) => args.documentIds.includes(d.id))) {
    const mine = db.extracted.filter((e) => e.document_id === doc.id);
    doc.parse_summary.items_accepted = mine.filter((e) => e.status === "accepted").length;
  }

  if (listed > 0) {
    onContractOnboarded(db, contract.id, `${supplier.name} published ${contract.contract_number} to ${db.marketplaces.find((s) => s.id === marketplaceIds[0])?.agency_name}`);
    for (const sf of marketplaceIds.slice(1)) {
      onMarketplaceAdded(db, supplier.name, db.marketplaces.find((s) => s.id === sf)?.agency_name ?? sf, contract.id);
    }
  }

  return {
    contract,
    listed,
    replaced,
    attention: attention.length,
    marketplaces: marketplaceIds.map((id) => db.marketplaces.find((s) => s.id === id)?.agency_name ?? id),
  };
}

export function resolveAttention(id: string, price: number) {
  const db = getDb();
  const att = db.attention.find((a) => a.id === id) ?? fail("Item not found");
  if (!(price > 0)) fail("Enter a price from the contract.");
  const item = db.extracted.find((e) => e.id === att.extracted_item_id);
  const contract = db.contracts.find((c) => c.id === att.contract_id)!;
  const listing: Listing = {
    id: nextId(db, "listing", "lst"),
    contract_id: contract.id,
    supplier_id: att.supplier_id,
    source: contract.source,
    sku: item?.sku ?? `${contract.contract_number}-x`,
    title: att.description,
    category: item?.category ?? "Other",
    unit_price: price,
    unit: item?.unit ?? "ea",
    lead_time_days: 5,
    extracted_item_id: item?.id ?? null,
    marketplace_ids: contract.marketplace_ids,
  };
  db.listings.push(listing);
  if (item) Object.assign(item, { status: "accepted", unit_price: price, listing_id: listing.id });
  att.resolved = true;
  return listing;
}

// ---------------------------------------------------------------- supplier

function actingSupplier(db: Db) {
  return db.suppliers.find((s) => s.id === db.session.acting_supplier_id)!;
}

export function setTier(tier: EdgeTier) {
  const db = getDb();
  const s = actingSupplier(db);
  s.edge_tier = tier;
  if (tier === "discover") s.sponsored = false;
  return s;
}

export function setSponsored(on: boolean) {
  const db = getDb();
  const s = actingSupplier(db);
  if (on && s.edge_tier === "discover") fail("Sponsored placement needs Edge Win or Position.");
  s.sponsored = on;
  return s;
}

export function addMarketplace(marketplaceId: string) {
  const db = getDb();
  const s = actingSupplier(db);
  const sf = db.marketplaces.find((x) => x.id === marketplaceId) ?? fail("Marketplace not found");
  const eligible = db.contracts.filter((c) => c.supplier_id === s.id && c.piggybackable);
  if (!eligible.length) fail("None of your contracts allow piggybacking.");
  for (const c of eligible) if (!c.marketplace_ids.includes(sf.id)) c.marketplace_ids.push(sf.id);
  for (const l of db.listings.filter((l) => eligible.some((c) => c.id === l.contract_id)))
    if (!l.marketplace_ids.includes(sf.id)) l.marketplace_ids.push(sf.id);
  return onMarketplaceAdded(db, s.name, sf.agency_name, sf.id);
}

export function startApp(appId: string) {
  const db = getDb();
  const app = db.apps.find((a) => a.id === appId) ?? fail("App not found");
  app.started = true;
  return onAppStarted(db, app.name, app.partner, app.id);
}

export function respondToReview(reviewId: string, text: string) {
  const db = getDb();
  const r = db.reviews.find((r) => r.id === reviewId) ?? fail("Review not found");
  if (!text.trim()) fail("Write a response first.");
  r.response = text.trim();
  return onReviewResponse(db, actingSupplier(db).name, r.id);
}

// ---------------------------------------------------------------- contract register

/** Import an agency's contract register: valid rows become contracts only that agency sees;
 * rows that can't be mapped come back in the report. Re-importing updates rows by contract number. */
export function importRegister(table: unknown[][], filename: string) {
  const db = getDb();
  const buyer = db.session.buyer ?? fail("Set your agency first, so Agora knows whose contracts these are.");
  const parsed = parseRegister(table);
  let added = 0;
  let updated = 0;
  for (const r of parsed.rows) {
    let supplier = findSupplier(db, r.vendor);
    if (!supplier) {
      supplier = {
        id: nextId(db, "supplier", "sup_reg"),
        name: r.vendor,
        city: "",
        state: buyer.state,
        is_local: false,
        certifications: [],
        verified: { insurance: false, bond: false },
        edge_tier: "discover",
        rating: 0,
        review_count: 0,
        sponsored: false,
        categories: [],
      };
      db.suppliers.push(supplier);
    }
    const category = CATEGORIES.find((c) => c.toLowerCase() === r.category.toLowerCase());
    const fields = {
      supplier_id: supplier.id,
      title: r.title,
      start: r.start,
      end: r.end,
      ceiling: r.ceiling ?? undefined,
      source_url: r.url || undefined,
      scope: [r.category, category].filter(Boolean).join(" "),
    };
    const existing = db.contracts.find(
      (c) => c.register_of === buyer.name && (r.number ? c.contract_number === r.number : c.title === r.title && c.supplier_id === supplier!.id),
    );
    if (existing) {
      Object.assign(existing, fields);
      updated++;
      continue;
    }
    db.contracts.push({
      ...fields,
      id: nextId(db, "contract", "ctr_reg"),
      source: "own_contract",
      owner: buyer.name,
      contract_number: r.number || `Row ${r.row}`,
      piggybackable: false,
      piggyback_clause_text: "",
      payment_terms: "Per contract",
      delivery_terms: "Per contract",
      marketplace_ids: [],
      source_document_id: null,
      onboarding_billed: true,
      vehicle: buyer.name,
      verification: "agency_register",
      pricing_basis: "quote",
      register_of: buyer.name,
      eligibility: { states: [buyer.state], agencies: [buyer.name], note: `${buyer.name} only` },
    });
    added++;
  }
  return { filename, agency: buyer.name, header_row: parsed.header_row, columns: parsed.columns, added, updated, rows: parsed.rows, issues: parsed.issues };
}

// ---------------------------------------------------------------- agency setup

/** The agency's stored settings, created from defaults on first write. */
function saveSettings(db: Db, agency: string) {
  const current = settingsFor(db, agency);
  const i = db.agency_settings.findIndex((s) => s.agency === agency);
  if (i >= 0) db.agency_settings[i] = current;
  else db.agency_settings.push(current);
  return current;
}

const currentAgency = (db: Db) => db.session.buyer?.name ?? fail("Set your agency first.");

/** Demo billing: move the agency between the free and paid plans. */
export function setPlan(plan: "free" | "paid") {
  const db = getDb();
  if (plan !== "free" && plan !== "paid") fail("Pick the free or paid plan.");
  const s = saveSettings(db, currentAgency(db));
  s.plan = plan;
  if (plan === "free") s.ad_free = false;
  return s;
}

/** Paid plans may hide sponsored placements from their staff. */
export function setAdFree(on: boolean) {
  const db = getDb();
  const s = saveSettings(db, currentAgency(db));
  if (on && s.plan !== "paid") fail("Ad-free search comes with the paid plan.");
  s.ad_free = on;
  return s;
}

/** A requester routes setup questions to purchasing instead of being blocked by them. */
export function inviteAdmin(args: { email: string; requestId?: string | null }) {
  const db = getDb();
  const agency = currentAgency(db);
  const email = args.email?.trim() ?? "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail("Enter your purchasing admin's email address.");
  const invite = { id: nextId(db, "invite", "inv", 3), agency, email, request_id: args.requestId ?? null, created_at: now() };
  db.invites.unshift(invite);
  return invite;
}

const HANDOFF_TOOLS = ["sovra_rfp", "euna", "opengov", "bonfire"] as const;

/** Send a solicitation to Sovra's full RFP tool or the agency's own, instead of RFP Lite. Doesn't count against the free limit. */
export function handoffRfp(args: { requestId: string; tool: (typeof HANDOFF_TOOLS)[number] }) {
  const db = getDb();
  const request = db.requests.find((r) => r.id === args.requestId) ?? fail("Request not found");
  if (!HANDOFF_TOOLS.includes(args.tool)) fail("Pick where to send the solicitation.");
  const agency = db.session.buyer?.name ?? db.agency.name;
  const handoff = { id: nextId(db, "handoff", "rfp", 3), agency, request_id: request.id, tool: args.tool, title: request.parsed.item, created_at: now() };
  db.handoffs.unshift(handoff);
  request.outcome = "solicitation";
  return handoff;
}

// ---------------------------------------------------------------- supplier revenue

function supplierById(db: Db, id: string) {
  return db.suppliers.find((s) => s.id === id) ?? fail("Supplier not found");
}

/** Claim a storefront. A work email on the company's own domain verifies at once; anything else waits for Sovra review. */
/** Bring a co-op catalog supplier into Agora, so its storefront can be claimed and managed. */
export function adoptCatalogSupplier(id: string) {
  const db = getDb();
  return materializeSupplier(db, id) ?? fail("That supplier isn't in the co-op catalog.");
}

export function claimStorefront(args: { supplierId: string; name: string; email: string }) {
  const db = getDb();
  if (args.supplierId.startsWith("cat_")) materializeSupplier(db, args.supplierId);
  const s = supplierById(db, args.supplierId);
  if (isClaimed(s)) fail(`${s.name}'s storefront is already claimed.`);
  const name = args.name?.trim() || fail("Add your name.");
  const email = args.email?.trim() ?? "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail("Enter your work email.");
  s.claim = { name, email, at: now(), status: claimMatchesWebsite(email, s.website) ? "verified" : "pending" };
  if (s.claim.status === "verified") db.session.acting_supplier_id = s.id;
  return s.claim;
}

/** Sovra ops approves a claim that couldn't be verified by email domain. */
export function approveClaim(supplierId: string) {
  const db = getDb();
  const s = supplierById(db, supplierId);
  if (s.claim?.status !== "pending") fail("There's no claim waiting for review.");
  s.claim.status = "verified";
  db.session.acting_supplier_id = s.id;
  return s.claim;
}

/** Switch which supplier the supplier views act as (demo). Only claimed storefronts. */
export function actAsSupplier(supplierId: string) {
  const db = getDb();
  const s = supplierById(db, supplierId);
  if (!isClaimed(s)) fail(`Claim ${s.name}'s storefront first.`);
  db.session.acting_supplier_id = s.id;
  return s;
}

/** Choose a storefront plan. Paid plans bill option 6 for the year. */
export function setSupplierPlan(args: { supplierId: string; plan: SupplierPlan }) {
  const db = getDb();
  const s = supplierById(db, args.supplierId);
  if (!isClaimed(s)) fail("Claim the storefront before choosing a plan.");
  if (!PLANS[args.plan]) fail("Pick a plan.");
  const was = s.plan ?? "basic";
  s.plan = args.plan;
  // Upgrades bill the difference for the year; downgrades take effect at renewal (no refund in the demo).
  const due = Math.max(0, PLANS[args.plan].price - PLANS[was].price);
  const events = due > 0 ? [fire(db, 6, due, `${PLANS[args.plan].name} plan, one year · ${s.name}`, s.id)] : [];
  if (s.plan === "basic") db.placements = db.placements.filter((p) => p.supplier_id !== s.id || s.edge_tier !== "discover");
  return { supplier: s, events };
}

/** Edit the storefront's own copy (Profile plans and up). */
export function updateStorefront(args: { supplierId: string; tagline: string; about: string }) {
  const db = getDb();
  const s = supplierById(db, args.supplierId);
  if (!isClaimed(s) || (s.plan ?? "basic") === "basic") fail("Your own description comes with the Profile plan.");
  s.profile = { ...(s.profile ?? { tagline: "", about: "" }), tagline: args.tagline.trim(), about: args.about.trim() };
  return s.profile;
}

/** Add a targeted placement: Sponsored on searches in this category, in one state or anywhere. Billed per impression (option 5). */
export function addPlacement(args: { supplierId: string; category: Category; state: string }) {
  const db = getDb();
  const s = supplierById(db, args.supplierId);
  if (!canSponsor(s)) fail("Placements come with a paid plan (or Edge Win and up) on a claimed storefront.");
  if (!CATEGORIES.includes(args.category)) fail("Pick a category.");
  const state = args.state === "any" ? "any" : (STATES.find(([c]) => c === args.state)?.[0] ?? fail("Pick a state, or anywhere."));
  if (db.placements.some((p) => p.supplier_id === s.id && p.category === args.category && p.state === state)) fail("You already have that placement.");
  const placement = { id: nextId(db, "placement", "plc", 3), supplier_id: s.id, category: args.category, state, created_at: now() };
  db.placements.push(placement);
  return placement;
}

export function removePlacement(placementId: string) {
  const db = getDb();
  db.placements = db.placements.filter((p) => p.id !== placementId);
  return { ok: true };
}

/** An off-contract supplier pays its yearly listing fee (option 2) so its listings appear. */
export function payListingFee(supplierId: string) {
  const db = getDb();
  const s = supplierById(db, supplierId);
  if (!isOffContract(db, s)) fail(`${s.name} sells on contract, so no listing fee applies.`);
  const from = listingFeeCurrent(s) ? new Date(`${s.listing_fee_through}T12:00:00Z`) : new Date();
  s.listing_fee_through = new Date(from.getTime() + 365 * 86_400_000).toISOString().slice(0, 10);
  const evt = fire(db, 2, RATES.listingFeeAnnual, `Listing fee, one year, off contract · ${s.name}`, s.id);
  return { supplier: s, events: [evt] };
}

// ---------------------------------------------------------------- co-ops

/** Sovra ops: whether a co-op's members may buy inside Agora (only once the co-op agrees). */
export function setCoopBuyInAgora(coopId: string, on: boolean) {
  const db = getDb();
  const coop = db.coops.find((c) => c.id === coopId) ?? fail("Co-op not found");
  coop.buy_in_agora = on;
  return coop;
}

/** The purchasing admin confirms, adds or removes one of the agency's co-op memberships. */
export function setMembership(args: { coopId: string; op: "confirm" | "add" | "remove" }) {
  const db = getDb();
  const agency = db.session.buyer?.name ?? fail("Set your agency first.");
  db.coops.find((c) => c.id === args.coopId) ?? fail("Co-op not found");
  if (!["confirm", "add", "remove"].includes(args.op)) fail("Say whether to confirm, add or remove the co-op.");
  const existing = db.memberships.find((m) => m.agency === agency && m.coop_id === args.coopId);
  if (args.op === "remove") db.memberships = db.memberships.filter((m) => m !== existing);
  else if (existing) existing.confirmed = true;
  else db.memberships.push({ agency, coop_id: args.coopId, source: "manual", confirmed: true });
  return db.memberships.filter((m) => m.agency === agency);
}

/** "Ask purchasing to get us on this contract": a note to the admin, logged as a referral for the co-op. */
export function askToJoin(args: { contractId: string; requestId?: string | null; fit?: number }) {
  const db = getDb();
  const agency = db.session.buyer?.name ?? fail("Set your agency first, so purchasing knows who's asking.");
  const seeded = db.contracts.find((c) => c.id === args.contractId);
  const cat = seeded ? null : catalogContract(args.contractId);
  const contract = seeded ?? (cat ? { id: cat.id, title: cat.title, contract_number: cat.number } : fail("Contract not found"));
  const coop = (seeded ? coopOf(db, seeded) : db.coops.find((c) => c.id === cat?.coop_id)) ?? fail("That isn't a co-op contract.");
  const request = db.requests.find((r) => r.id === args.requestId);
  const dupe = db.referrals.find((r) => r.agency === agency && r.contract_id === contract.id && r.request_id === (request?.id ?? null));
  if (dupe) return dupe;
  const referral = {
    id: nextId(db, "referral", "ref", 3),
    request_id: request?.id ?? null,
    contract_id: contract.id,
    coop_id: coop.id,
    agency,
    need: request?.raw_text ?? contract.title,
    fit: Math.round(args.fit ?? 0),
    created_at: now(),
    ...(cat ? { contract_number: cat.number, supplier: catalogSupplierById(cat.supplier)?.name, has_link: Boolean(cat.url) } : {}),
  };
  db.referrals.unshift(referral);
  return referral;
}

/** Sovra ops uploads a co-op's member list. "replace" swaps the list; "merge" adds to it.
 * Memberships are then re-detected for every agency Agora knows. */
export function importMembers(args: { coopId: string; table: unknown[][]; mode: "replace" | "merge"; filename: string }) {
  const db = getDb();
  const coop = db.coops.find((c) => c.id === args.coopId) ?? fail("Co-op not found");
  const parsed = parseMemberList(args.table);
  const key = (m: CoopMember) => m.domain || `${m.name.toLowerCase()}|${m.state ?? ""}`;
  const before = coop.members ?? [];
  if (args.mode === "replace") coop.members = parsed.members;
  else {
    const have = new Set(before.map(key));
    coop.members = [...before, ...parsed.members.filter((m) => !have.has(key(m)))];
  }
  coop.member_list_status = args.mode === "replace" ? "full" : coop.member_list_status === "full" ? "full" : "partial";
  coop.member_list_source = "co-op";
  coop.member_list_updated_at = now();

  // Re-detect: agencies newly on the list get a detected membership; detected (never
  // confirmed) memberships for agencies no longer on it are dropped.
  const agencies = new Map<string, Buyer>();
  for (const p of BUYER_PRESETS) agencies.set(p.buyer.name, p.buyer);
  if (db.session.buyer) agencies.set(db.session.buyer.name, db.session.buyer);
  const matched: string[] = [];
  for (const buyer of agencies.values()) {
    const onList = (coop.members ?? []).some((m) => memberMatches(m, buyer));
    const existing = db.memberships.find((m) => m.agency === buyer.name && m.coop_id === coop.id);
    if (onList) {
      matched.push(buyer.name);
      if (!existing) db.memberships.push({ agency: buyer.name, coop_id: coop.id, source: "detected", evidence: "list", confirmed: false });
    } else if (existing && existing.source === "detected" && !existing.confirmed && (existing.evidence ?? "list") === "list") {
      // Only a membership that rested on a member list goes when the list drops it; roster, agency and purchase evidence stand.
      db.memberships = db.memberships.filter((m) => m !== existing);
    }
  }
  return {
    coop: coop.name,
    filename: args.filename,
    mode: args.mode,
    header_row: parsed.header_row,
    columns: parsed.columns,
    imported: parsed.members.length,
    total: coop.members.length,
    name_only: parsed.name_only,
    issues: parsed.issues,
    matched,
  };
}

/** Sovra ops adds a co-op Agora doesn't track yet, so its member list can be uploaded. */
export function addCoop(args: { name: string; website?: string; access?: "membership" | "state_addendum" }) {
  const db = getDb();
  const name = args.name?.trim() ?? "";
  if (!name) fail("Name the co-op.");
  if (db.coops.some((c) => c.name.toLowerCase() === name.toLowerCase())) fail(`${name} is already in Agora.`);
  const coop: Coop = {
    id: `coop_${name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "")}`,
    name,
    website: args.website?.trim() ?? "",
    member_list_status: "none",
    access: args.access ?? "membership",
    buy_in_agora: false,
    note: "Added by Sovra ops; contracts not ingested yet.",
    members: [],
  };
  db.coops.push(coop);
  return coop;
}

/** Log an outbound click and return where to send the buyer, or null if the contract has no link. */
export function logClick(args: { contractId: string; listingId?: string | null; requestId?: string | null; offeringId?: string | null }) {
  const db = getDb();
  const contract = db.contracts.find((c) => c.id === args.contractId);
  if (!contract) {
    // A co-op catalog contract (or one of its products): logged the same way, sent to the co-op's page.
    const cat = catalogContract(args.contractId);
    const offering = catalogOffering(args.offeringId);
    const url = offering && offering.contract === cat?.id ? offering.url : cat?.url;
    if (!cat || !url) return null;
    db.clicks.unshift({
      id: nextId(db, "click", "clk", 4),
      contract_id: cat.id,
      coop_id: cat.coop_id || null,
      listing_id: args.offeringId ?? null,
      request_id: args.requestId ?? null,
      buyer_name: db.session.buyer?.name ?? null,
      url,
      created_at: now(),
    });
    return { url, contract_level: true };
  }
  if (!contract.source_url) return null;
  db.clicks.unshift({
    id: nextId(db, "click", "clk", 4),
    contract_id: contract.id,
    coop_id: coopOf(db, contract)?.id ?? null,
    listing_id: args.listingId ?? null,
    request_id: args.requestId ?? null,
    buyer_name: db.session.buyer?.name ?? null,
    url: contract.source_url,
    created_at: now(),
  });
  return { url: contract.source_url, contract_level: isContractLevelUrl(contract.source_url) };
}

export function reset() {
  impressionsBilled.clear();
  return resetDb();
}
