// Co-op routing. Agora doesn't sell through a co-op's contracts: it sends the
// buyer to the exact contract page through a tracked redirect, so the co-op
// sees the traffic Sovra drives. A co-op that has agreed can switch on buying
// inside Agora (Coop.buy_in_agora). Pure functions, safe on client and server.

import type { Buyer, Contract, Coop, CoopMember, CoopMembership, Db, Listing } from "./types";

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

const STATE_SUFFIX =
  /,\s*(al|ak|az|ar|ca|co|ct|de|dc|fl|ga|hi|id|il|in|ia|ks|ky|la|me|md|ma|mi|mn|ms|mo|mt|ne|nv|nh|nj|nm|ny|nc|nd|oh|ok|or|pa|ri|sc|sd|tn|tx|ut|vt|va|wa|wv|wi|wy|pr|gu|vi)\.?$/;

/** One government's name reduced to a matching key, so the same government listed
 * different ways by different co-ops lines up: "Town of Crested Butte" and "Crested
 * Butte" → "crested butte"; "Plano ISD" and "Plano Independent School District" →
 * "plano isd"; "Lawrence, City of (MARC-KCRPC)" → "lawrence". Words that tell two
 * governments in one place apart (county, township, isd, district) are standardized,
 * never dropped, so City of Plano and Plano ISD stay two governments. */
export function entityKey(n: string | undefined | null): string {
  let s = (n ?? "").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
  s = s.replace(/\([^)]*\)/g, " ").replace(/&/g, " and ").replace(/[\u2010-\u2015]/g, "-").trim();
  // "City of Lawrence, KS" → "City of Lawrence"
  s = s.replace(STATE_SUFFIX, "");
  // "Lawrence, City of" → "City of Lawrence"
  s = s.replace(/^(.*?),\s*(city|town|village|borough|township|county|parish) of\s*$/, "$2 of $1");
  // "Township of Franklin" → "franklin township"; "County of Marin" → "marin county"
  s = s.replace(/^(?:the\s+)?(township|county|parish) of\s+(.+)$/, "$2 $1");
  s = s.replace(/^(?:the\s+)?(?:city|town|village|borough|municipality|incorporated village|city and county) of\s+/, "");
  s = s.replace(/^the\s+/, "");
  const swaps: [RegExp, string][] = [
    [/\bconsolidated independent school district\b/g, "cisd"],
    [/\bindependent school district\b/g, "isd"],
    [/\bunified school district\b/g, "usd"],
    [/\bcommon school district\b/g, "csd"],
    [/\bcentral school district\b/g, "csd"],
    [/\bschool dist\b/g, "school district"],
    [/\bmunicipal utility district\b/g, "mud"],
    [/\bspecial utility district\b/g, "sud"],
    [/\bemergency services district\b/g, "esd"],
    [/\bfire protection district\b/g, "fpd"],
    [/\bsaint\b/g, "st"],
    [/\bmount\b/g, "mt"],
    [/\bfort\b/g, "ft"],
    [/\btwp\b/g, "township"],
    [/\bcnty\b|\bco\b(?=\s*$)/g, "county"],
    [/\bdept\b/g, "department"],
    [/\bno\.?\s*(?=\d)/g, ""],
    [/#\s*/g, ""],
  ];
  for (const [re, to] of swaps) s = s.replace(re, to);
  s = s.replace(/[^a-z0-9 ]/g, " ").replace(/\b(inc|llc|the)\b/g, " ");
  return s.replace(/\s+/g, " ").trim();
}

/** Does this member-list entry name this agency? By website first, then by name within the same state. */
export function memberMatches(m: CoopMember, buyer: Buyer): boolean {
  const domain = normalizeDomain(buyer.domain);
  if (domain && normalizeDomain(m.domain) === domain) return true;
  const name = entityKey(buyer.name);
  return Boolean(name && m.state && m.state.toUpperCase() === buyer.state && entityKey(m.name) === name);
}

/** Reverse lookup: which co-ops list this agency as a member. */
export function detectCoops(db: Pick<Db, "coops">, buyer: Buyer): Coop[] {
  return db.coops.filter((c) => (c.members ?? []).some((m) => memberMatches(m, buyer)));
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
  if (contract.eligibility?.adopters?.some((a) => a.state === buyer.state && entityKey(a.name) === entityKey(buyer.name))) return true;
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

/** A co-op Agora knows from published rosters or agencies' own procurement pages. No relationship yet. */
const published = (id: string, name: string, website: string, note: string): Coop => ({
  id,
  name,
  website,
  member_list_status: "none",
  member_list_source: "published",
  access: "membership",
  buy_in_agora: false,
  note,
});

/** Co-ops in the November 2026 public co-op workbook (seed/coops/source). Roster counts are filled in by seed(). */
export const PUBLISHED_COOPS: Coop[] = [
  published("coop_hgacbuy", "HGACBuy", "https://www.hgacbuy.org", "Published member roster, retrieved November 13, 2026, including nonprofits (dropped from the directory)."),
  published("coop_buyboard", "BuyBoard (Texas)", "https://www.buyboard.com", "Published Texas member listings; public status is inferred from names, and churches and private schools are dropped."),
  published("coop_buyboard_national", "BuyBoard National", "https://www.buyboardnational.com", "Published national roster listings; public status inferred from names."),
  published("coop_mohave", "Mohave Educational Services Cooperative", "https://www.mesc.org", "Main published roster (Arizona)."),
  published("coop_eandi", "E&I Cooperative Services", "https://www.eandi.org", "Public institution directory; mostly colleges and schools, public status inferred from names."),
  published("coop_costars", "COSTARS", "https://www.dgs.pa.gov/COSTARS", "Pennsylvania DGS registered member directory."),
  published("coop_tips", "TIPS", "https://www.tips-usa.com", "No bulk roster: TIPS offers it to vendors only. Known from agencies' own procurement pages."),
  published("coop_omnia", "OMNIA Partners", "https://www.omniapartners.com/publicsector", "No published roster. Known from agencies' procurement pages and state adoption flyers."),
  published("coop_equalis", "Equalis Group", "https://equalisgroup.org", "No public membership list. Known from agencies' procurement pages."),
  published("coop_1gpa", "1GPA", "https://www.1gpa.org", "Member names on request only. Known from agencies' procurement pages."),
  published("coop_choice", "Choice Partners", "https://www.choicepartners.org", "No current roster. Known from agencies' procurement pages."),
  published("coop_pace", "PACE (ESC Region 20)", "", "No bulk roster. Known from agencies' procurement pages."),
  published("coop_pca", "Purchasing Cooperative of America", "https://www.pcamerica.org", "No bulk roster. Known from agencies' procurement pages."),
  published("coop_kpn", "Keystone Purchasing Network", "https://www.kpn.org", "No bulk roster. Known from agencies' procurement pages and published awards."),
  published("coop_nppgov", "NPPGov", "https://nppgov.com", "No bulk roster. Known from agencies' procurement pages and published purchases."),
  published("coop_peppm", "PEPPM", "https://www.peppm.org", "Eligibility list names entity classes, not members. Known from agencies' procurement pages."),
  published("coop_mmcap", "MMCAP Infuse", "https://mmcap.org", "Roster restricted to authenticated portals. Known from agencies' procurement pages."),
];

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
    member_list_status: "none",
    member_list_source: "published",
    // The real roster lives in the co-op directory; these two fictional demo cities are added by hand.
    members: [
      { name: "City of Cedar Bend", domain: "cedarbend-ia.example", state: "IA" },
      { name: "City of Riverbend", domain: "riverbend-or.example", state: "OR" },
    ],
    buy_in_agora: false,
    note: "Published roster of registered public agencies, retrieved November 13, 2026. Riverbend and Cedar Bend are added as demo members. Contracts are research leads.",
  },
  {
    id: "coop_wspc",
    name: "Western States Purchasing Cooperative",
    website: "",
    member_list_status: "full",
    member_list_source: "demo",
    members: [
      { name: "City of Riverbend", domain: "riverbend-or.example", state: "OR" },
      { name: "Harper County", domain: "harpercounty-or.example", state: "OR" },
    ],
    buy_in_agora: true,
    note: "Demo co-op that shares its member list and has agreed to in-Agora buying.",
  },
  ...PUBLISHED_COOPS,
];
