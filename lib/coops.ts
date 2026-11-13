// Co-op routing. Agora doesn't sell through a co-op's contracts: it sends the
// buyer to the exact contract page through a tracked redirect, so the co-op
// sees the traffic Sovra drives. A co-op that has agreed can switch on buying
// inside Agora (Coop.buy_in_agora). Pure functions, safe on client and server.

import type { Buyer, Contract, Coop, CoopMembership, Db, Listing } from "./types";

export function coopOf(db: Pick<Db, "coops">, contract: Contract | undefined | null): Coop | null {
  if (!contract || contract.source !== "coop_contract" || !contract.coop_id) return null;
  return db.coops.find((c) => c.id === contract.coop_id) ?? null;
}

/** True when buyers should leave Agora for the co-op's own contract page. */
export function linksOut(db: Pick<Db, "coops">, contract: Contract | undefined | null): boolean {
  const coop = coopOf(db, contract);
  return Boolean(coop && !coop.buy_in_agora);
}

export const listingLinksOut = (db: Pick<Db, "coops" | "contracts">, l: Listing) =>
  linksOut(db, db.contracts.find((c) => c.id === l.contract_id));

/** A link to a specific contract, not a co-op's homepage. Homepage-only links are data defects. */
export function isContractLevelUrl(url: string | undefined | null): boolean {
  if (!url) return false;
  try {
    return new URL(url).pathname.replace(/\/+$/, "") !== "";
  } catch {
    return false;
  }
}

/** The tracked redirect to a contract's page. */
export function goHref(contractId: string, from: { listing?: string | null; request?: string | null } = {}): string {
  const q = new URLSearchParams();
  if (from.listing) q.set("listing", from.listing);
  if (from.request) q.set("request", from.request);
  const qs = q.toString();
  return `/go/${encodeURIComponent(contractId)}${qs ? `?${qs}` : ""}`;
}

// ---------------------------------------------------------------- memberships

/** "https://www.Town.gov/about" → "town.gov". */
export function normalizeDomain(d: string | undefined | null): string {
  if (!d) return "";
  return d.trim().toLowerCase().replace(/^[a-z]+:\/\//, "").replace(/^www\./, "").replace(/[/?#].*$/, "");
}

/** Reverse lookup: which co-ops list this agency's domain as a member. */
export function detectCoops(db: Pick<Db, "coops">, buyer: Buyer): Coop[] {
  const domain = normalizeDomain(buyer.domain);
  if (!domain) return [];
  return db.coops.filter((c) => (c.members ?? []).some((m) => normalizeDomain(m.domain) === domain));
}

export const membershipsFor = (db: Pick<Db, "memberships">, agency: string | null | undefined): CoopMembership[] =>
  agency ? db.memberships.filter((m) => m.agency === agency) : [];

export function isMember(db: Pick<Db, "memberships">, agency: string | null | undefined, coopId: string): boolean {
  return membershipsFor(db, agency).some((m) => m.coop_id === coopId);
}

/** Whether the agency is on this co-op contract: through a membership, or, for a
 * state-addendum co-op, because the contract lists the agency's state. */
export function onCoopContract(db: Pick<Db, "coops" | "memberships">, buyer: Buyer | null, contract: Contract): boolean {
  const coop = coopOf(db, contract);
  if (!coop || !buyer) return false;
  if (isMember(db, buyer.name, coop.id)) return true;
  const states = contract.eligibility?.states;
  return coop.access === "state_addendum" && Array.isArray(states) && states.includes(buyer.state);
}

/** Which co-op a seeded contract belongs to, read from its purchasing program. */
export function coopIdForVehicle(vehicle: string | undefined): string | undefined {
  if (!vehicle) return undefined;
  if (/naspo/i.test(vehicle)) return "coop_naspo";
  if (/sourcewell/i.test(vehicle)) return "coop_sourcewell";
  if (/wspc/i.test(vehicle)) return "coop_wspc";
  return undefined;
}

export const SEED_COOPS: Coop[] = [
  {
    id: "coop_naspo",
    name: "NASPO ValuePoint",
    website: "https://www.naspovaluepoint.org",
    member_list_status: "none",
    access: "state_addendum",
    buy_in_agora: false,
    note: "Agencies use it through their state's participating addendum. Contracts scraped from public pages; no member list shared yet.",
  },
  {
    id: "coop_sourcewell",
    name: "Sourcewell",
    website: "https://www.sourcewell-mn.gov",
    member_list_status: "partial",
    member_list_source: "demo",
    members: [
      { name: "Town of Crested Butte", domain: "townofcrestedbutte.colorado.gov" },
      { name: "City of Cedar Bend", domain: "cedarbend-ia.example" },
      { name: "City of Riverbend", domain: "riverbend-or.example" },
    ],
    buy_in_agora: false,
    note: "Demo member list for illustration, not from Sourcewell. Contracts are research leads.",
  },
  {
    id: "coop_wspc",
    name: "Western States Purchasing Cooperative",
    website: "",
    member_list_status: "full",
    member_list_source: "demo",
    members: [
      { name: "City of Riverbend", domain: "riverbend-or.example" },
      { name: "Harper County", domain: "harpercounty-or.example" },
    ],
    buy_in_agora: true,
    note: "Demo co-op that shares its member list and has agreed to in-Agora buying.",
  },
];
