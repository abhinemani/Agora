// TRX: the state transaction program Sovra supports. Only state contracts in
// these states carry it; state contracts elsewhere are ordinary state contracts.
//
// TRX contracts are the route Agora prefers. A buyer in a TRX state sees its state's
// contracts ahead of co-op contracts: they are open to local governments through the
// state's cooperative purchasing program, with the lowest fee of any shared contract.
// New Jersey's are loaded from NJSTART (scripts/import-njstart.ts); the other TRX states'
// state contracts aren't loaded yet.

import type { Buyer, Contract } from "./types";

export const TRX_STATES = ["NJ", "OR", "AR", "HI", "NY"] as const;

/** How far below the best co-op fit (0–100) a TRX state contract may be and still lead the results. */
export const TRX_MARGIN = 15;

/** Each TRX state's purchasing program, as buyers know it. */
export const TRX_PROGRAM: Record<string, { name: string; coop_program: string; portal: string }> = {
  NJ: { name: "NJSTART", coop_program: "New Jersey Cooperative Purchasing Program", portal: "https://www.njstart.gov" },
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
}
export const isTrxState = (state: string | null | undefined) => Boolean(state && (TRX_STATES as readonly string[]).includes(state));

/** Who may buy on a state contract: the state's own agencies always; its local governments when the state opens it to them. */
export function stateContractAccess(sc: StateContractFields, buyer: Buyer | null): { member: boolean; eligible: boolean; reason: string } {
  const program = TRX_PROGRAM[sc.state]?.coop_program ?? "the state's cooperative purchasing program";
  const open = sc.locals ? `Open to ${stateLabel(sc.state)} local governments through the ${program}` : `For ${stateLabel(sc.state)} state agencies only; not open to cooperative purchasing`;
  if (!buyer) return { member: false, eligible: true, reason: open };
  if (buyer.state !== sc.state) return { member: false, eligible: false, reason: `a ${stateLabel(sc.state)} state contract, for ${stateLabel(sc.state)} public entities` };
  if (buyer.entity_type === "state_agency") return { member: true, eligible: true, reason: `Open to ${stateLabel(sc.state)} state agencies` };
  if (!sc.locals) return { member: false, eligible: false, reason: `for ${stateLabel(sc.state)} state agencies only; the state hasn't opened it to cooperative purchasing` };
  return { member: true, eligible: true, reason: open };
}

const LABEL: Record<string, string> = { NJ: "New Jersey", OR: "Oregon", AR: "Arkansas", HI: "Hawaii", NY: "New York" };
const stateLabel = (s: string) => LABEL[s] ?? s;
