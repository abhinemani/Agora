// Supplier revenue rules, shared by the server and the screens: who has claimed
// a storefront, what each plan includes, where a supplier's placements show it
// as Sponsored, and whether an off-contract supplier's listing fee is current.

import { normalizeDomain } from "./coops";
import type { Buyer, Category, Db, Listing, Supplier, SupplierPlan } from "./types";

export const PLANS: Record<SupplierPlan, { name: string; price: number; includes: string[] }> = {
  basic: { name: "Basic storefront", price: 0, includes: ["Your contracts and products, as Agora found them", "Agency reviews"] },
  profile: { name: "Profile", price: 500, includes: ["Everything in Basic", "Your own tagline and description", "Targeted sponsored placements"] },
  profile_catalog: { name: "Profile with catalog", price: 1500, includes: ["Everything in Profile", "Publish your own catalog or price list", "Featured product lines on your storefront"] },
};

/** "Verified" claim: the claimant's email domain matches the company's website. */
export function claimMatchesWebsite(email: string, website: string | undefined): boolean {
  const domain = normalizeDomain(email.split("@").pop());
  const site = normalizeDomain(website);
  return Boolean(domain && site && (domain === site || domain.endsWith(`.${site}`)));
}

export const isClaimed = (s: Supplier) => s.claim?.status === "verified";

/** Placements need a verified claim and either a paid plan or an Edge tier above Discover. */
export const canSponsor = (s: Supplier) => isClaimed(s) && ((s.plan ?? "basic") !== "basic" || s.edge_tier !== "discover");

/** Is this supplier Sponsored for this category, for this buyer? By a matching placement, or the older all-category flag. */
export function sponsoredFor(db: Pick<Db, "placements">, s: Supplier, category: Category, buyer: Buyer | null): boolean {
  if (s.sponsored) return true;
  return db.placements.some((p) => p.supplier_id === s.id && p.category === category && (p.state === "any" || (buyer ? p.state === buyer.state : false)));
}

const today = () => new Date().toISOString().slice(0, 10);

/** Off-contract listings show only while the supplier's listing fee is current. */
export function listingFeeCurrent(s: Supplier | undefined): boolean {
  return Boolean(s?.listing_fee_through && s.listing_fee_through >= today());
}

export function listingVisible(db: Pick<Db, "suppliers">, l: Listing): boolean {
  if (l.source !== "no_approval") return true;
  return listingFeeCurrent(db.suppliers.find((s) => s.id === l.supplier_id));
}

/** A supplier with no contract at all: small purchases only, so a listing fee applies. */
export const isOffContract = (db: Pick<Db, "contracts" | "listings">, s: Supplier) =>
  !db.contracts.some((c) => c.supplier_id === s.id) && db.listings.some((l) => l.supplier_id === s.id);
