// TRX: the state transaction program Sovra supports. Only state contracts in
// these states carry it; state contracts elsewhere are ordinary state contracts.

import type { Contract } from "./types";

export const TRX_STATES = ["NJ", "OR", "AR", "HI", "NY"] as const;

export function isTrx(contract: Contract | undefined | null): boolean {
  const states = contract?.eligibility?.states;
  if (!contract || contract.source !== "state_contract" || !Array.isArray(states) || !states.length) return false;
  return states.every((s) => (TRX_STATES as readonly string[]).includes(s));
}
