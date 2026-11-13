// Every state change in the demo goes through here, so revenue events fire in
// exactly one place per action.

import { buildResults, estimateTotal, findSimilarSolicitation, mentionsPreference, parseRequest, ruleFor } from "./assistant";
import { getDb, nextId, resetDb } from "./db";
import { dedupe, extractFile, findSupplier, parseContract, type InputFile } from "./parser";
import {
  onAppStarted,
  onContractOnboarded,
  onOrderPlaced,
  onReviewResponse,
  onSolicitationPublished,
  onSponsoredImpression,
  onMarketplaceAdded,
} from "./revenue_rules";
import type { Buyer, Category, Contract, ContractDocument, ContractHeader, Db, EdgeTier, ExtractedItem, Listing, Request, Role, Solicitation } from "./types";
import { checkEligibility, STATES } from "./vehicles";
import { coopOf, detectCoops, isContractLevelUrl, isMember, linksOut, normalizeDomain } from "./coops";

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
  db.session.buyer = { name: buyer.name.trim(), state: buyer.state, entity_type: buyer.entity_type, population: Number.isFinite(pop as number) ? pop : null, domain };
  // Reverse lookup on the agency's website: co-ops whose member lists include it.
  for (const coop of detectCoops(db, db.session.buyer))
    if (!isMember(db, db.session.buyer.name, coop.id)) db.memberships.push({ agency: db.session.buyer.name, coop_id: coop.id, source: "detected", confirmed: false });
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

export function placeOrder(args: { listingId: string; quantity: number; requestId?: string | null; department: string }) {
  const db = getDb();
  const listing = db.listings.find((l) => l.id === args.listingId) ?? fail("Listing not found");
  const contractFor = db.contracts.find((c) => c.id === listing.contract_id);
  const access = checkEligibility(contractFor, db.session.buyer);
  if (!access.eligible) fail(`This contract isn't open to ${db.session.buyer?.name}: ${access.reason}.`);
  if (linksOut(db, contractFor)) fail(`${contractFor?.vehicle} ${contractFor?.contract_number} is bought on ${coopOf(db, contractFor)?.name}'s own contract page, not in Agora.`);
  const qty = Math.max(1, Math.floor(args.quantity));
  const tier = [...(db.extracted.find((e) => e.id === listing.extracted_item_id)?.tier_pricing ?? [])]
    .sort((a, b) => b.min_qty - a.min_qty)
    .find((t) => qty >= t.min_qty);
  const unit = tier?.unit_price ?? listing.unit_price;
  const total = Math.round(unit * qty * 100) / 100;
  const rule = ruleFor(db, { ...listing, unit_price: unit }, qty);
  if (listing.source === "no_approval" && total >= db.agency.quick_buy_threshold)
    fail("Off-contract purchases must stay under the quick-buy limit.");

  const n = (db.counters.order = (db.counters.order ?? 0) + 1);
  const order = {
    id: `${orderPrefix(db.session.buyer?.name)}-${rule.payment === "po" ? "PO" : "PC"}-${n}`,
    request_id: args.requestId ?? null,
    listing_id: listing.id,
    quantity: qty,
    total,
    payment: rule.payment,
    status: rule.payment === "po" ? ("pending_approval" as const) : ("placed" as const),
    department: args.department,
    created_at: now(),
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
  o.status = "approved";
  return o;
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

export async function parseUpload(files: InputFile[], role: Role) {
  const db = getDb();
  const started = Date.now();
  const extracted = await Promise.all(files.map(extractFile));
  const out = await parseContract(extracted);

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
  const contract = db.contracts.find((c) => c.id === args.contractId) ?? fail("Contract not found");
  const coop = coopOf(db, contract) ?? fail("That isn't a co-op contract.");
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
  };
  db.referrals.unshift(referral);
  return referral;
}

/** Log an outbound click and return where to send the buyer, or null if the contract has no link. */
export function logClick(args: { contractId: string; listingId?: string | null; requestId?: string | null }) {
  const db = getDb();
  const contract = db.contracts.find((c) => c.id === args.contractId);
  if (!contract?.source_url) return null;
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
