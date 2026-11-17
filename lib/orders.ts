// Order lifecycle and cart rules, shared by the server and the screens.
// P-card orders: placed → shipped → delivered → reconciled (charge matched to the receipt).
// PO orders: pending approval → approved → shipped → delivered → invoiced → reconciled
// (three-way match of PO, receipt and invoice, then paid and closed).

import { linksOut } from "./coops";
import type { Cart, CartLine, CatalogLine, Db, Listing, Order, OrderStatus, Supplier } from "./types";
import { checkEligibility } from "./vehicles";

export const ORDER_STATUS: Record<OrderStatus, { label: string; tone: "green" | "amber" | "navy" | "neutral" }> = {
  pending_approval: { label: "Waiting on approval", tone: "amber" },
  approved: { label: "PO approved", tone: "navy" },
  placed: { label: "Placed", tone: "navy" },
  shipped: { label: "Shipped", tone: "navy" },
  delivered: { label: "Received", tone: "navy" },
  invoiced: { label: "Invoice matched", tone: "navy" },
  reconciled: { label: "Reconciled", tone: "green" },
};

export const STEPS: Record<Order["payment"], OrderStatus[]> = {
  pcard: ["placed", "shipped", "delivered", "reconciled"],
  po: ["pending_approval", "approved", "shipped", "delivered", "invoiced", "reconciled"],
};

/** The next step an order can move to, and the button that moves it. Approval has its own flow. */
export function nextStep(o: Order): { status: OrderStatus; action: string } | null {
  if (o.status === "pending_approval") return null;
  const steps = STEPS[o.payment];
  const next = steps[steps.indexOf(o.status) + 1];
  if (!next) return null;
  const action: Record<OrderStatus, string> = {
    pending_approval: "",
    approved: "",
    placed: "",
    shipped: "Mark shipped",
    delivered: "Confirm received",
    invoiced: "Match invoice",
    reconciled: o.payment === "pcard" ? "Reconcile charge" : "Approve payment",
  };
  return { status: next, action: action[next] };
}

/** Cost-center code for a department, as finance would see it. Demo values. */
export function glCode(db: Pick<Db, "agency">, department: string): string {
  const i = Math.max(0, db.agency.departments.findIndex((d) => d.name === department));
  return `100-${410 + i * 10}-6100`;
}

/** The cart and order key for a catalog product. */
export const catalogLineId = (offeringId: string) => `cat:${offeringId}`;

/** A catalog product shaped as a listing, so carts, orders and spend read it like any other line. Never stored in `db.listings`. */
export function catalogAsListing(id: string, c: CatalogLine): Listing {
  return {
    id,
    contract_id: c.contract_id,
    supplier_id: c.supplier_id,
    source: c.source,
    sku: c.sku ?? "",
    title: c.title,
    category: "Other",
    unit_price: c.unit_price,
    unit: c.unit,
    lead_time_days: 0,
    extracted_item_id: null,
    marketplace_ids: [],
  };
}

/** What a cart line or order is for: the Agora listing, or the catalog product it carries. */
export function lineListing(db: Pick<Db, "listings">, line: Pick<CartLine, "listing_id" | "catalog">): Listing | undefined {
  return line.catalog ? catalogAsListing(line.listing_id, line.catalog) : db.listings.find((l) => l.id === line.listing_id);
}

/** Who supplies a cart line or order: the Agora supplier, or the catalog product's supplier. */
export function lineSupplier(db: Pick<Db, "listings" | "suppliers">, line: Pick<CartLine, "listing_id" | "catalog">): Supplier | undefined {
  if (line.catalog) return catalogSupplier(db, line.catalog);
  const l = db.listings.find((x) => x.id === line.listing_id);
  return db.suppliers.find((s) => s.id === l?.supplier_id);
}

/** Where a line's product is described: an Agora listing's product page, or a catalog product's contract. */
export const lineHref = (line: Pick<CartLine, "listing_id" | "catalog">) => (line.catalog ? `/contracts/${line.catalog.contract_id}` : `/product/${line.listing_id}`);

/** The supplier behind a catalog line, when it has no storefront record in Agora. */
function catalogSupplier(db: Pick<Db, "suppliers">, c: CatalogLine): Supplier {
  return (
    db.suppliers.find((s) => s.id === c.supplier_id) ?? {
      id: c.supplier_id,
      name: c.supplier,
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
    }
  );
}

export interface CartGroup {
  supplier: Supplier;
  lines: { listing: Listing; quantity: number; unit: number; total: number; request_id?: string | null; catalog?: CatalogLine }[];
  total: number;
  payment: "pcard" | "po";
  /** Why a line can't be bought from the cart, if any. */
  blocked: string | null;
}

/** A cart split by supplier. Each supplier's share is paid one way: P-card under the
 * quick-buy limit, a PO at or over it. */
export function cartGroups(db: Db, cart: Pick<Cart, "lines">): CartGroup[] {
  const limit = db.agency.quick_buy_threshold;
  const bySupplier = new Map<string, CartGroup>();
  for (const line of cart.lines) {
    if (line.catalog) {
      // A catalog product: its contract price, read from the catalog when it was added. Eligibility was checked then,
      // and is checked again on the server at checkout (lib/actions.ts).
      const c = line.catalog;
      const supplier = catalogSupplier(db, c);
      const total = Math.round(c.unit_price * line.quantity * 100) / 100;
      const g = bySupplier.get(supplier.id) ?? { supplier, lines: [], total: 0, payment: "pcard" as const, blocked: null };
      g.lines.push({ listing: catalogAsListing(line.listing_id, c), quantity: line.quantity, unit: c.unit_price, total, request_id: line.request_id, catalog: c });
      g.total = Math.round((g.total + total) * 100) / 100;
      bySupplier.set(supplier.id, g);
      continue;
    }
    const listing = db.listings.find((l) => l.id === line.listing_id);
    if (!listing) continue;
    const supplier = db.suppliers.find((s) => s.id === listing.supplier_id);
    if (!supplier) continue;
    const tier = [...(db.extracted.find((e) => e.id === listing.extracted_item_id)?.tier_pricing ?? [])]
      .sort((a, b) => b.min_qty - a.min_qty)
      .find((t) => line.quantity >= t.min_qty);
    const unit = tier?.unit_price ?? listing.unit_price;
    const total = Math.round(unit * line.quantity * 100) / 100;
    const g = bySupplier.get(supplier.id) ?? { supplier, lines: [], total: 0, payment: "pcard" as const, blocked: null };
    g.lines.push({ listing, quantity: line.quantity, unit, total, request_id: line.request_id });
    g.total = Math.round((g.total + total) * 100) / 100;
    const contract = db.contracts.find((c) => c.id === listing.contract_id);
    const access = checkEligibility(contract, db.session.buyer);
    if (!access.eligible) g.blocked = `${listing.title}: not open to ${db.session.buyer?.name ?? "this agency"} (${access.reason})`;
    if (linksOut(db, contract)) g.blocked = `${listing.title} is bought on the co-op's own site`;
    bySupplier.set(supplier.id, g);
  }
  for (const g of bySupplier.values()) {
    g.payment = g.total >= limit ? "po" : "pcard";
    if (!g.blocked && g.lines.some((l) => l.listing.source === "no_approval") && g.payment === "po")
      g.blocked = "Off-contract purchases from one supplier must stay under the quick-buy limit";
  }
  return [...bySupplier.values()];
}

export const cartTotal = (groups: CartGroup[]) => Math.round(groups.reduce((n, g) => n + g.total, 0) * 100) / 100;
export const needsApproval = (groups: CartGroup[]) => groups.some((g) => g.payment === "po");

/** The agency whose cart this session is filling. */
export const cartAgency = (db: Pick<Db, "session" | "agency">) => db.session.buyer?.name ?? db.agency.name;

/** Whose draft a cart is. Carts made before drafts had owners belong to the account that started them. */
export const cartOwner = (c: Pick<Cart, "owner" | "user_id">) => c.owner ?? c.user_id;

/**
 * The open cart: one per person (or, before signing in, per browser), whichever agency they're buying for. On the server,
 * pass the owner (lib/actions.ts `me()`); the browser receives only its own draft (app/api/state/route.ts), so it can leave it out.
 */
export const draftCart = (db: Pick<Db, "carts">, owner?: string): Cart | undefined =>
  db.carts.find((c) => c.status === "draft" && (owner === undefined || cartOwner(c) === owner));

/** Demo people: the requester who builds carts and the purchasing lead who approves them. */
export const REQUESTER = "Dana Whitfield";
export const PURCHASER = "Marcus Reyes";
