// The ten revenue options and when each fires. Everything a demo might want to
// tune lives here. Amounts are placeholders, not pricing proposals.

import type { Db, Payer, RevenueEvent, Source } from "./types";

export const REVENUE_OPTIONS: Record<
  number,
  { name: string; payer: Payer; rule: string }
> = {
  1: { name: "Storefront subscription", payer: "local_government", rule: "$2,000/mo base, credited 25% of options 3 + 9" },
  2: { name: "Supplier onboarding and listing", payer: "supplier", rule: "$1,500 one-time + $600/yr per contract" },
  3: { name: "Transaction fee", payer: "supplier", rule: "1.0% of contract orders" },
  4: { name: "Scale to other storefronts", payer: "supplier", rule: "$400/yr per added storefront" },
  5: { name: "Sponsored placement", payer: "supplier", rule: "$2.00 per results page impression" },
  6: { name: "Supplier profile and insights", payer: "supplier", rule: "$350/mo while on Position; review responses" },
  7: { name: "Spend intelligence", payer: "local_government", rule: "$500/mo while dashboard is enabled" },
  8: { name: "Managed sourcing", payer: "local_government", rule: "$1,200 per published solicitation" },
  9: { name: "Embedded payments", payer: "card_network", rule: "1.25% of P-card orders" },
  10: { name: "App exchange", payer: "partner", rule: "15% of a $2,000 first-year contract" },
};

export const RATES = {
  subscriptionMonthly: 2000,
  subscriptionCreditShare: 0.25,
  onboardingOneTime: 1500,
  onboardingAnnual: 600,
  transactionFee: 0.01,
  extraStorefrontAnnual: 400,
  sponsoredImpression: 2,
  profileMonthly: 350,
  reviewResponse: 0, // bundled into the Position subscription; shown as a $0 event
  spendIntelMonthly: 500,
  managedSourcing: 1200,
  embeddedPayments: 0.0125,
  appNotionalContract: 2000,
  appReferralShare: 0.15,
};

/** Sources that carry a transaction fee. Co-op and reseller listings pay listing
 * fees only (spec open question 12.1, default). */
export const TRANSACTION_FEE_SOURCES: Source[] = ["own_contract", "state_contract", "gsa"];

function round(n: number) {
  return Math.round(n * 100) / 100;
}

export function fire(
  db: Db,
  option: number,
  amount: number,
  trigger: string,
  related_id: string | null = null,
): RevenueEvent {
  const def = REVENUE_OPTIONS[option];
  db.counters.revenue = (db.counters.revenue ?? 0) + 1;
  const evt: RevenueEvent = {
    id: `rev_${String(db.counters.revenue).padStart(4, "0")}`,
    option,
    option_name: def.name,
    payer: def.payer,
    amount: round(amount),
    trigger,
    related_id,
    created_at: new Date().toISOString(),
  };
  db.revenue.unshift(evt);
  return evt;
}

/** Monthly lines recorded at reset (options 1, 6, 7). */
export function fireMonthlyLines(db: Db) {
  fire(db, 1, RATES.subscriptionMonthly, "Monthly storefront subscription · City of Riverbend", db.agency.id);
  if (db.session.spend_dashboard_enabled) {
    fire(db, 7, RATES.spendIntelMonthly, "Monthly spend intelligence · City of Riverbend", db.agency.id);
  }
  for (const s of db.suppliers.filter((s) => s.edge_tier === "position")) {
    fire(db, 6, RATES.profileMonthly, `Monthly Edge Position profile · ${s.name}`, s.id);
  }
}

/** Credit toward option 1 whenever option 3 or 9 fires. Recorded as a negative
 * amount on option 1 so the ledger nets it out. */
function creditSubscription(db: Db, basis: number, trigger: string, related_id: string) {
  const credit = basis * RATES.subscriptionCreditShare;
  if (credit <= 0) return;
  const evt = fire(db, 1, -credit, `Subscription credit (25% of ${trigger})`, related_id);
  evt.option_name = "Storefront subscription credit";
}

export function onOrderPlaced(
  db: Db,
  args: { orderId: string; total: number; source: Source; payment: "pcard" | "po"; supplierName: string; contractId: string | null },
) {
  const fired: RevenueEvent[] = [];
  if (TRANSACTION_FEE_SOURCES.includes(args.source)) {
    const fee = args.total * RATES.transactionFee;
    const label = args.source === "state_contract" ? "TRX fee" : "Transaction fee";
    fired.push(fire(db, 3, fee, `${label} 1.0% on ${args.orderId} · ${args.supplierName}`, args.orderId));
    creditSubscription(db, fee, "transaction fee", args.orderId);
  }
  if (args.payment === "pcard") {
    const fee = args.total * RATES.embeddedPayments;
    fired.push(fire(db, 9, fee, `P-card interchange 1.25% on ${args.orderId}`, args.orderId));
    creditSubscription(db, fee, "embedded payments", args.orderId);
  }
  // Contracts that pre-date the storefront are onboarded on their first order.
  if (args.contractId) {
    const c = db.contracts.find((c) => c.id === args.contractId);
    if (c && !c.onboarding_billed) {
      c.onboarding_billed = true;
      fired.push(onContractOnboarded(db, c.id, `${c.title} activated on first order`));
    }
  }
  return fired;
}

export function onContractOnboarded(db: Db, contractId: string, trigger: string) {
  return fire(
    db,
    2,
    RATES.onboardingOneTime + RATES.onboardingAnnual,
    `${trigger} ($1,500 onboarding + $600/yr listing)`,
    contractId,
  );
}

export function onStorefrontAdded(db: Db, supplierName: string, storefrontName: string, relatedId: string) {
  return fire(db, 4, RATES.extraStorefrontAnnual, `${supplierName} added ${storefrontName} storefront`, relatedId);
}

export function onSponsoredImpression(db: Db, supplierName: string, requestId: string) {
  return fire(db, 5, RATES.sponsoredImpression, `Sponsored impression · ${supplierName}`, requestId);
}

export function onReviewResponse(db: Db, supplierName: string, reviewId: string) {
  return fire(db, 6, RATES.reviewResponse, `${supplierName} responded to a review (included in Position)`, reviewId);
}

export function onSolicitationPublished(db: Db, title: string, id: string) {
  return fire(db, 8, RATES.managedSourcing, `Solicitation published: ${title}`, id);
}

export function onAppStarted(db: Db, appName: string, partner: string, id: string) {
  return fire(
    db,
    10,
    RATES.appNotionalContract * RATES.appReferralShare,
    `Referral: ${appName} (${partner})`,
    id,
  );
}

// ---------------------------------------------------------------- model views
// How the deck groups the ten options. Used by the ledger and "How it earns".

/** Options that fit inside an Edge supplier tier (deck: "four fit inside Edge"). */
export const EDGE_TIER: Partial<Record<number, "Win" | "Position">> = { 2: "Position", 4: "Position", 5: "Win", 6: "Position" };

/** Revenue per storefront adds up five ways. */
export const FIVE_WAYS: { label: string; who: string; options: number[] }[] = [
  { label: "Subscription minus credits", who: "Local government", options: [1] },
  { label: "Suppliers listed × listing fee", who: "Suppliers", options: [2, 4, 6] },
  { label: "Spend through the storefront × take rate", who: "Suppliers, card networks", options: [3, 5, 9] },
  { label: "Partner apps sold × revenue share", who: "Suppliers via partners", options: [10] },
  { label: "Data and services", who: "Both sides", options: [7, 8] },
];

/** Three kinds of purchase, each earning differently. */
export const PURCHASE_KINDS = {
  contract: { n: 1, title: "Already on a contract", earns: "supplier listing fees, and the TRX fee on state contracts", options: [2, 3] },
  no_approval: { n: 2, title: "No approval needed", earns: "card and order fees, and sponsored placement", options: [9, 5] },
  new_need: { n: 3, title: "The rare new need", earns: "managed sourcing; the award becomes a listing others can use", options: [8, 2] },
} as const;
