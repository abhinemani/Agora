// Contract vehicles: who may use each contract, and every way to buy a product.
// Safe to import from client components (no server-only dependencies).

import type { Buyer, Contract, Db, EntityType, Listing } from "./types";

export const ENTITY_LABEL: Record<EntityType, string> = {
  municipality: "City, town or township",
  county: "County",
  school_district: "School district",
  special_district: "Special district or authority",
  state_agency: "State agency",
};

export const STATES: [string, string][] = [
  ["AL", "Alabama"], ["AK", "Alaska"], ["AZ", "Arizona"], ["AR", "Arkansas"], ["CA", "California"], ["CO", "Colorado"],
  ["CT", "Connecticut"], ["DE", "Delaware"], ["DC", "District of Columbia"], ["FL", "Florida"], ["GA", "Georgia"], ["HI", "Hawaii"],
  ["ID", "Idaho"], ["IL", "Illinois"], ["IN", "Indiana"], ["IA", "Iowa"], ["KS", "Kansas"], ["KY", "Kentucky"], ["LA", "Louisiana"],
  ["ME", "Maine"], ["MD", "Maryland"], ["MA", "Massachusetts"], ["MI", "Michigan"], ["MN", "Minnesota"], ["MS", "Mississippi"],
  ["MO", "Missouri"], ["MT", "Montana"], ["NE", "Nebraska"], ["NV", "Nevada"], ["NH", "New Hampshire"], ["NJ", "New Jersey"],
  ["NM", "New Mexico"], ["NY", "New York"], ["NC", "North Carolina"], ["ND", "North Dakota"], ["OH", "Ohio"], ["OK", "Oklahoma"],
  ["OR", "Oregon"], ["PA", "Pennsylvania"], ["RI", "Rhode Island"], ["SC", "South Carolina"], ["SD", "South Dakota"],
  ["TN", "Tennessee"], ["TX", "Texas"], ["UT", "Utah"], ["VT", "Vermont"], ["VA", "Virginia"], ["WA", "Washington"],
  ["WV", "West Virginia"], ["WI", "Wisconsin"], ["WY", "Wyoming"],
];
export const stateName = (code: string) => STATES.find(([c]) => c === code)?.[1] ?? code;

/** One-click buyers for the intake step. Harmon Lake is fictional. */
export const BUYER_PRESETS: { buyer: Buyer; blurb: string }[] = [
  { buyer: { name: "City of Riverbend", state: "OR", entity_type: "municipality", population: 85_000 }, blurb: "The demo storefront: Oregon contracts plus national co-ops" },
  { buyer: { name: "Harmon Lake Township", state: "NJ", entity_type: "municipality", population: 42_000 }, blurb: "A New Jersey municipality: NJSTART contracts open up" },
  { buyer: { name: "New Jersey state department", state: "NJ", entity_type: "state_agency", population: null }, blurb: "Buying directly under New Jersey state contracts" },
];

export interface EligibilityCheck {
  eligible: boolean;
  reason: string;
}

/** Can this buyer use this contract? Listings without a contract (small
 * purchases) are open to anyone under their own quick-buy limit. */
export function checkEligibility(contract: Contract | undefined, buyer: Buyer | null): EligibilityCheck {
  if (!contract) return { eligible: true, reason: "Small purchase, no contract required" };
  const e = contract.eligibility;
  if (!e || !buyer) return { eligible: true, reason: e?.note ?? "" };
  if (e.agencies && !e.agencies.includes(buyer.name)) return { eligible: false, reason: `${contract.owner}'s own contract; not open to other agencies` };
  if (e.states !== "any" && !e.states.includes(buyer.state)) return { eligible: false, reason: `Open to ${e.note}` };
  if (e.entity_types && !e.entity_types.includes(buyer.entity_type)) return { eligible: false, reason: `Open to ${e.note}` };
  return { eligible: true, reason: e.requires ? `${e.note} · ${e.requires}` : e.note };
}

export const eligibleListing = (db: Db, l: Listing, buyer: Buyer | null) =>
  checkEligibility(db.contracts.find((c) => c.id === l.contract_id), buyer).eligible;

/** The tier in a family that fits the buyer's population, else the first. */
export function defaultVariant(variants: Listing[], buyer: Buyer | null): Listing {
  const pop = buyer?.population;
  if (pop) {
    const fit = variants.find((v) => v.band && pop >= v.band.min && (v.band.max === null || pop <= v.band.max));
    if (fit) return fit;
  }
  return variants[0];
}

export function familyOf(db: Db, l: Listing): Listing[] {
  if (!l.family) return [l];
  return db.listings.filter((x) => x.family === l.family && x.contract_id === l.contract_id);
}

/** Research leads on Sourcewell discounts, from the Agora research seed. They
 * are shown only as unverified notes, never as prices. */
export const SOURCEWELL_TYLER_NOTES: { match: RegExp; product: string; percent: number }[] = [
  { match: /\bmunis\b|enterprise erp/i, product: "Enterprise ERP (Munis)", percent: 10 },
  { match: /erp pro|incode/i, product: "ERP Pro (Incode)", percent: 10 },
  { match: /\b311\b|service request/i, product: "Enterprise Service Requests (Tyler 311)", percent: 10 },
  { match: /cashier/i, product: "Cashiering", percent: 10 },
  { match: /meeting manager/i, product: "Meeting Manager", percent: 10 },
  { match: /\bnotify\b/i, product: "Notify", percent: 10 },
  { match: /priority based budget/i, product: "Priority Based Budgeting", percent: 10 },
  { match: /permitting & licensing|ep&l/i, product: "Enterprise Permitting & Licensing", percent: 10 },
  { match: /my civic/i, product: "My Civic", percent: 10 },
  { match: /recreation dynamics|outdoor recreation/i, product: "Recreation Dynamics", percent: 10 },
  { match: /socrata|data & insights|open data|data platform/i, product: "Enterprise Data Platform (Socrata)", percent: 5 },
  { match: /cybersecurity/i, product: "Cybersecurity services", percent: 5 },
];

export interface Route {
  contract: Contract;
  /** The listing to buy on this route, when it has a published price. */
  listing: Listing | null;
  eligibility: EligibilityCheck;
  basis: NonNullable<Contract["pricing_basis"]>;
  /** Plain-language pricing line. */
  price_note: string;
  /** Unverified research shown alongside, never used as a price. */
  research_note: string | null;
  action: "buy" | "quote" | "check";
}

/** Every way to buy this listing's product: its own contract first, then other
 * vehicles that carry the supplier's whole catalog, then adoptable master agreements. */
export function routesFor(db: Db, listing: Listing, buyer: Buyer | null): Route[] {
  const routes: Route[] = [];
  const own = db.contracts.find((c) => c.id === listing.contract_id);
  if (own) {
    routes.push({
      contract: own,
      listing,
      eligibility: checkEligibility(own, buyer),
      basis: own.pricing_basis ?? "published_price",
      price_note: `Published contract price: $${listing.unit_price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} / ${listing.unit}`,
      research_note: null,
      action: "buy",
    });
  }
  for (const c of db.contracts.filter((c) => c.supplier_id === listing.supplier_id && c.covers_supplier_catalog && c.id !== own?.id)) {
    const text = `${listing.title} ${listing.keywords ?? ""}`;
    const note = c.vehicle === "Sourcewell" ? SOURCEWELL_TYLER_NOTES.find((n) => n.match.test(text)) : undefined;
    routes.push({
      contract: c,
      listing: null,
      eligibility: checkEligibility(c, buyer),
      basis: c.pricing_basis ?? "quote",
      price_note: c.pricing_basis === "discount_from_list" ? "Discount off the supplier's current list price; the supplier quotes the final price" : "Priced by quote",
      research_note: note
        ? `Research lead (unverified): Sourcewell's discount summary lists ${note.percent}% off list for ${note.product}. Confirm on the source document.`
        : null,
      action: "quote",
    });
  }
  if (own?.master_agreement) {
    routes.push({
      contract: { ...own, id: `${own.id}-master`, vehicle: own.master_agreement.split(" AR")[0], contract_number: own.master_agreement, owner: own.master_agreement, eligibility: { states: "any", note: "states that have adopted this master agreement" } },
      listing: null,
      eligibility: { eligible: true, reason: "Other states may have adopted this master agreement under their own participating addendum" },
      basis: "published_price",
      price_note: "Your state's participating addendum sets eligibility and may carry its own price schedule",
      research_note: null,
      action: "check",
    });
  }
  return routes;
}
