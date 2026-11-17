// Agency setup: plan and free-tier limits, ad-free flag, and how complete an
// agency's configuration is. Pure reads, safe on client and server.

import { membershipsFor } from "./coops";
import type { AgencySettings, Buyer, Contract, Db } from "./types";

/** Free intake covers this many published RFPs a year (Martin: a ~3-RFP-a-year town never hits it). */
export const FREE_RFP_LIMIT = 5;

export const thisYear = () => new Date().getFullYear();

/** An agency's settings, or the defaults: free plan, ads on. Riverbend subscribes to a city marketplace, so it's paid. */
export function settingsFor(db: Pick<Db, "agency_settings" | "agency">, agency: string | null | undefined): AgencySettings {
  const name = agency ?? db.agency.name;
  const found = db.agency_settings.find((s) => s.agency === name);
  const base = found ?? { agency: name, plan: name === db.agency.name ? "paid" : "free", rfp_year: thisYear(), rfp_used: 0, ad_free: false };
  // The counter resets each year.
  return base.rfp_year === thisYear() ? { ...base } : { ...base, rfp_year: thisYear(), rfp_used: 0 };
}

export function rfpsLeft(s: AgencySettings): number | null {
  return s.plan === "paid" ? null : Math.max(0, FREE_RFP_LIMIT - s.rfp_used);
}

/** Contracts an agency added to Agora from its own contract register. */
export const registerContracts = (db: Pick<Db, "contracts">, agency: string | null | undefined): Contract[] =>
  agency ? db.contracts.filter((c) => c.register_of === agency) : [];

/** Configuration completeness, for the setup page and for routing setup questions to the admin. */
export function setupStatus(db: Db, buyer: Buyer | null) {
  const agency = buyer?.name ?? null;
  const memberships = membershipsFor(db, agency);
  const ownContracts = agency ? db.contracts.filter((c) => c.register_of === agency || c.eligibility?.agencies?.includes(agency)).length : 0;
  const steps = {
    state: Boolean(buyer?.state),
    contracts: ownContracts > 0,
    coops: memberships.some((m) => m.confirmed),
  };
  return {
    steps,
    own_contracts: ownContracts,
    confirmed_coops: memberships.filter((m) => m.confirmed).length,
    detected_coops: memberships.filter((m) => !m.confirmed).length,
    complete: steps.state && steps.contracts && steps.coops,
  };
}
