// Co-op routing. Agora doesn't sell through a co-op's contracts: it sends the
// buyer to the exact contract page through a tracked redirect, so the co-op
// sees the traffic Sovra drives. A co-op that has agreed can switch on buying
// inside Agora (Coop.buy_in_agora). Pure functions, safe on client and server.

import type { Contract, Coop, Db, Listing } from "./types";

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
    buy_in_agora: false,
    note: "Contracts scraped from public pages; no member list shared yet.",
  },
  {
    id: "coop_sourcewell",
    name: "Sourcewell",
    website: "https://www.sourcewell-mn.gov",
    member_list_status: "none",
    buy_in_agora: false,
    note: "Research lead; no member list shared yet.",
  },
  {
    id: "coop_wspc",
    name: "Western States Purchasing Cooperative",
    website: "",
    member_list_status: "full",
    buy_in_agora: true,
    note: "Demo co-op that shares its member list and has agreed to in-Agora buying.",
  },
];
