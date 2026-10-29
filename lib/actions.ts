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
  onStorefrontAdded,
} from "./revenue_rules";
import type { Category, Contract, ContractDocument, ContractHeader, Db, EdgeTier, ExtractedItem, Listing, Request, Role, Solicitation } from "./types";

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

  const prefs = db.agency.preferences;
  const hasPolicy = prefs.local || prefs.mbe || prefs.sustainable;
  const remembered = db.session.preference_answer;
  let needsPreference = false;
  if (mentionsPreference(raw)) request.preference_answer = /\b(no|not|don't)\b.*\b(local|mbe)\b/i.test(raw) ? "no" : "yes";
  else if (remembered === "yes" || remembered === "no") request.preference_answer = remembered;
  else needsPreference = hasPolicy;

  db.requests.unshift(request);
  return { request, needsPreference };
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
    id: `RB-${rule.payment === "po" ? "PO" : "PC"}-${n}`,
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

/** An awarded solicitation becomes a contract and a listing in the storefront. */
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
    storefront_ids: ["sf_riverbend"],
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
    storefront_ids: ["sf_riverbend"],
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
  storefrontIds: string[];
  role: Role;
}) {
  const db = getDb();
  const h = args.header;
  if (!h.supplier_name.trim()) fail("The contract needs a supplier name.");
  const storefrontIds = args.storefrontIds.length ? args.storefrontIds : ["sf_riverbend"];

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
      storefront_ids: storefrontIds,
      source_document_id: args.documentIds[0] ?? null,
      onboarding_billed: true,
    };
    db.contracts.push(contract);
  } else {
    contract.storefront_ids = [...new Set([...contract.storefront_ids, ...storefrontIds])];
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
          storefront_ids: [...new Set([...existing.storefront_ids, ...storefrontIds])],
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
          storefront_ids: storefrontIds,
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
    onContractOnboarded(db, contract.id, `${supplier.name} published ${contract.contract_number} to ${db.storefronts.find((s) => s.id === storefrontIds[0])?.agency_name}`);
    for (const sf of storefrontIds.slice(1)) {
      onStorefrontAdded(db, supplier.name, db.storefronts.find((s) => s.id === sf)?.agency_name ?? sf, contract.id);
    }
  }

  return {
    contract,
    listed,
    replaced,
    attention: attention.length,
    storefronts: storefrontIds.map((id) => db.storefronts.find((s) => s.id === id)?.agency_name ?? id),
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
    storefront_ids: contract.storefront_ids,
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

export function addStorefront(storefrontId: string) {
  const db = getDb();
  const s = actingSupplier(db);
  const sf = db.storefronts.find((x) => x.id === storefrontId) ?? fail("Storefront not found");
  const eligible = db.contracts.filter((c) => c.supplier_id === s.id && c.piggybackable);
  if (!eligible.length) fail("None of your contracts allow piggybacking.");
  for (const c of eligible) if (!c.storefront_ids.includes(sf.id)) c.storefront_ids.push(sf.id);
  for (const l of db.listings.filter((l) => eligible.some((c) => c.id === l.contract_id)))
    if (!l.storefront_ids.includes(sf.id)) l.storefront_ids.push(sf.id);
  return onStorefrontAdded(db, s.name, sf.agency_name, sf.id);
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

export function reset() {
  impressionsBilled.clear();
  return resetDb();
}
