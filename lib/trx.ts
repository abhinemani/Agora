// TRX: the state transaction program Sovra supports. Only state contracts in
// these states carry it; state contracts elsewhere are ordinary state contracts.
//
// TRX contracts are the route Agora prefers. A buyer in a TRX state sees its state's
// contracts ahead of co-op contracts: they are open to local governments through the
// state's cooperative purchasing program, with the lowest fee of any shared contract.
// Loaded so far: New Jersey from NJSTART (scripts/import-njstart.ts), Hawaii from the State
// Procurement Office's price & vendor lists (scripts/import-hawaii.ts) and Arkansas from the
// Office of State Procurement's directory (scripts/import-arkansas.ts) and New York from the
// Office of General Services' centralized contracts (scripts/import-ny.ts). Oregon isn't loaded yet.

import type { Buyer, Contract } from "./types";

export const TRX_STATES = ["NJ", "OR", "AR", "HI", "NY"] as const;

/** How far below the best co-op fit (0–100) a TRX state contract may be and still lead the results. */
export const TRX_MARGIN = 15;

/** Programs that aren't a state's own office but are TRX programs in that state, by program name. */
export const TRX_PROGRAM_BY_NAME: Record<string, TrxProgram> = {
  "Empire Procure Connect": {
    name: "Empire Procure Connect",
    coop_program: "Empire Procure Connect, the county cooperative run with the Empire State Cooperative Procurement Alliance",
    portal: "https://empireprocureconnect.info/empire-procure-connect-home",
    data_anchor: "empire-procure-connect",
    steps: (c) => [
      `A county let this contract on Empire Procure Connect${c.solicitation ? ` (${c.solicitation})` : ""} and opened it to other governments. New York's General Municipal Law § 103(16) lets a political subdivision buy on another's contract when it was let in a way consistent with New York law. Read the executed contract and its available regions before the first order.`,
      "Register on Empire Procure Connect, which approves each government before it buys, then order from the supplier under the contract number on your own purchase order. Check New York's preferred sources first for items they're approved to supply.",
    ],
  },
};

/** How a New York buyer uses a preferred source (Corcraft, NYSID, NIBNY), which comes before an OGS contract. */
export const NY_PREFERRED_STEPS = (c: { supplier: string; approval: "approved" | "agency" | "not_approved" }) =>
  c.approval === "not_approved"
    ? [`The OGS list names this offering but doesn't approve it as a preferred-source item. You may buy it from ${c.supplier} as an ordinary purchase, under your usual rules.`]
    : [
        c.approval === "agency"
          ? "The OGS list approves this offering as a preferred source for one state agency; for everyone else it's optional."
          : `New York's preferred sources come first: under State Finance Law § 162, public buyers take items the OGS list approves from ${c.supplier} before any contract, when the item meets the need in form, function and utility.`,
        `Order from ${c.supplier} through its catalog, or ask it for a price. The list publishes no prices.`,
      ];

/** Each loaded TRX state's purchasing program, as buyers know it, and how a local buys on it. */
export interface TrxProgram {
  /** The program name on cards and buttons. */
  name: string;
  /** What opens a state contract to local governments. */
  coop_program: string;
  portal: string;
  /** Where /data explains it. */
  data_anchor: string;
  /** The steps on a contract page, for a local that may use the contract. */
  steps: (c: { supplier: string; number: string; solicitation: string | null }) => string[];
}
export const TRX_PROGRAM: Record<string, TrxProgram> = {
  NJ: {
    name: "NJSTART",
    coop_program: "New Jersey Cooperative Purchasing Program",
    portal: "https://www.njstart.gov",
    data_anchor: "njstart",
    steps: (c) => [
      "If your agency hasn't already, register once with the New Jersey Cooperative Purchasing Program. Purchasing will know; there's no per-contract membership.",
      `Buy from ${c.supplier || "the supplier"} under NJSTART ${c.number}${c.solicitation ? ` (awarded under ${c.solicitation})` : ""}. The state already bid it, so a local unit doesn't advertise for bids of its own (New Jersey's Local Public Contracts Law allows purchases on state contracts).`,
    ],
  },
  AR: {
    name: "Arkansas OSP",
    coop_program: "state's participating addenda",
    portal: "https://sas.arkansas.gov/procurement/state-contracts/",
    data_anchor: "arkansas",
    steps: (c) => [
      "Arkansas state contracts and the state's participating addenda let political subdivisions (cities, counties, school districts) buy as participating entities, on the contract's own terms. Check the contract's documents for any limit before the first order.",
      `Order from ${c.supplier || "the vendor"} citing ${c.number}${c.solicitation ? ` (${c.solicitation})` : ""} on your own purchase order. Your agency is billed for, and responsible for, its own orders.`,
    ],
  },
  NY: {
    name: "NYS OGS",
    coop_program: "Office of General Services' centralized contracts",
    portal: "https://ogs.ny.gov/procurement/ogs-centralized-contracts-list",
    data_anchor: "new-york",
    steps: (c) => [
      "New York's General Municipal Law § 104 lets a political subdivision buy from OGS centralized contracts without a bid of its own, where the award's \"Use of Contracts\" includes political subdivisions or non-state agencies. Check New York's preferred sources (Corcraft, NYSID, NIBNY) first for items they're approved to supply.",
      `Follow the award's "How to Use" document and order from ${c.supplier || "the contractor"} under contract ${c.number}${c.solicitation ? ` (${c.solicitation})` : ""} on your own purchase order.`,
    ],
  },
  HI: {
    name: "Hawaii SPO",
    coop_program: "State Procurement Office's price & vendor list contracts",
    portal: "https://spo.hawaii.gov",
    data_anchor: "hawaii",
    steps: (c) => [
      "Your jurisdiction is on this contract's list of participating jurisdictions, which it joined by signing the SPO's cooperative agreement. No further solicitation is needed to order under it.",
      `Order from ${c.supplier || "the contractor"} under SPO contract ${c.number}${c.solicitation ? ` (${c.solicitation})` : ""}, by purchasing card or purchase order, as the price list's agency instructions set out.`,
    ],
  },
};

export function isTrx(contract: Contract | undefined | null): boolean {
  const states = contract?.eligibility?.states;
  if (!contract || contract.source !== "state_contract" || !Array.isArray(states) || !states.length) return false;
  return states.every((s) => (TRX_STATES as readonly string[]).includes(s));
}

/** A state contract in the co-op catalog, as lib/catalog.ts holds it. */
export interface StateContractFields {
  state: string;
  /** The state opens it to its local governments through its cooperative purchasing program. */
  locals: boolean;
  /** The governments a contract names as participants (Hawaii); when given, a local must be one of them. */
  participants?: string[];
  /** Who may use it, in the award's own words (New York's "Use of Contracts"). */
  use?: string | null;
  /** A New York preferred source rather than a contract (State Finance Law § 162). */
  preferred?: "approved" | "agency" | "not_approved";
  /** The government that let it (an Empire Procure Connect county). It may always use its own contract;
   * others only when it's open to cooperative purchasing, and a state agency only then too. */
  owner?: string;
}
export const isTrxState = (state: string | null | undefined) => Boolean(state && (TRX_STATES as readonly string[]).includes(state));

/** Hawaii's county governments, by the names price lists use for them and their councils and water boards. */
const HI_COUNTIES: [string, RegExp][] = [
  ["Honolulu", /honolulu|board of water supply/i],
  ["Hawaii County", /county of hawai.?i|hawai.?i county/i],
  ["Maui", /maui/i],
  ["Kauai", /kaua.?i/i],
];
const words = (s: string) => new Set(s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((w) => w.length > 3 && !["county", "state", "hawaii", "department", "city"].includes(w)));
/** Is this buyer one of the listed participants? Counties match by name; other bodies (UH, DOE, OHA) by their distinctive words. */
function listed(participants: string[], buyer: Buyer): boolean {
  const county = HI_COUNTIES.find(([, re]) => re.test(buyer.name));
  if (county) return participants.some((p) => county[1].test(p));
  const mine = words(buyer.name);
  return mine.size > 0 && participants.some((p) => [...words(p)].filter((w) => mine.has(w)).length >= Math.min(2, mine.size));
}

/** Who may buy on a state contract: the state's own agencies always; its local governments when the state opens it to them. */
export function stateContractAccess(sc: StateContractFields, buyer: Buyer | null): { member: boolean; eligible: boolean; reason: string } {
  const where = stateLabel(sc.state);
  const program = TRX_PROGRAM[sc.state]?.coop_program ?? "the state's cooperative purchasing program";
  const counties = sc.participants ? HI_COUNTIES.filter(([, re]) => sc.participants!.some((p) => re.test(p))).map(([n]) => n) : [];
  const open = sc.preferred
    ? sc.preferred === "approved"
      ? `Open to ${where} public buyers, who take it before any contract under State Finance Law § 162`
      : sc.preferred === "agency"
        ? "Approved as a preferred source for one state agency; optional for everyone else"
        : "Listed but not approved as a preferred source; an ordinary purchase"
    : sc.participants
    ? counties.length
      ? `Open to the jurisdictions it lists, including ${list(counties.map((c) => (c === "Honolulu" ? "Honolulu" : c === "Hawaii County" ? "Hawaii County" : `${c} County`)))}`
      : `For ${where} state agencies only; no county is a participating jurisdiction`
    : sc.use
      ? sc.locals
        ? `Open to ${where} political subdivisions; the award's use of contracts: "${sc.use}"`
        : `For "${sc.use}" only, per the award`
      : sc.locals
        ? `Open to ${where} local governments through the ${program}`
        : `For ${where} state agencies only; not open to cooperative purchasing`;
  if (sc.owner) {
    const where2 = stateLabel(sc.state);
    const mine = buyer && buyer.state === sc.state && listed([sc.owner], buyer);
    if (mine) return { member: true, eligible: true, reason: `${sc.owner}'s own contract` };
    if (!sc.locals) return { member: false, eligible: !buyer, reason: `${sc.owner}'s own contract; not open to cooperative purchasing` };
    const scope = sc.use && !/^statewide\b/i.test(sc.use) ? `; available to: "${sc.use}"` : "";
    if (!buyer) return { member: false, eligible: true, reason: `Let by ${sc.owner} and open to other ${where2} governments through Empire Procure Connect${scope}` };
    if (buyer.state !== sc.state) return { member: false, eligible: false, reason: `a ${where2} county contract, for ${where2} public entities` };
    return { member: true, eligible: true, reason: `Let by ${sc.owner} and open to other ${where2} governments through Empire Procure Connect${scope}` };
  }
  if (!buyer) return { member: false, eligible: true, reason: open };
  if (buyer.state !== sc.state) return { member: false, eligible: false, reason: `a ${where} state contract, for ${where} public entities` };
  if (buyer.entity_type === "state_agency") return { member: true, eligible: true, reason: `Open to ${where} state agencies` };
  if (sc.participants) {
    if (listed(sc.participants, buyer)) return { member: true, eligible: true, reason: `the jurisdictions on its list, including ${buyer.name}` };
    return { member: false, eligible: false, reason: counties.length ? `${buyer.name} isn't among its participating jurisdictions (${list(counties)} ${counties.length === 1 ? "is" : "are"})` : `for ${where} state agencies only; no county participates` };
  }
  if (!sc.locals) return { member: false, eligible: false, reason: sc.use ? `for "${sc.use}" only, per the award` : `for ${where} state agencies only; the state hasn't opened it to cooperative purchasing` };
  return { member: true, eligible: true, reason: open };
}

const list = (xs: string[]) => (xs.length <= 2 ? xs.join(" and ") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);
const LABEL: Record<string, string> = { NJ: "New Jersey", OR: "Oregon", AR: "Arkansas", HI: "Hawaii", NY: "New York" };
export const stateLabel = (s: string) => LABEL[s] ?? s;
