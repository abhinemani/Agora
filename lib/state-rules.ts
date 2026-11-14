// What each state's law says about a local buyer using a national cooperative contract, from
// the 50-state research of November 13, 2026 (scripts/import-state-rules.ts). Server only: the
// file holds every state's report section, and results carry just the buyer's state.
// Research findings with their source flags, not legal advice.

import data from "./state-rules.json";
import type { Buyer } from "./types";

export interface StateRule {
  state: string;
  tier: number;
  tier_label: string;
  local: string;
  schools: string;
  state_list: string;
  agreement: string;
  lead_test: string;
  excluded: string;
  no_competition: string;
  quotes: string;
  formal_bid: string;
  threshold_source: string;
  detail: string;
}

/** The rule as one buyer sees it: the authority line for its kind of government, and whether the request looks like construction. */
export interface BuyerStateRule extends Omit<StateRule, "detail"> {
  code: string;
  /** Which column applies: school districts have their own authority in many states. */
  applies: "schools" | "local";
  authority: string;
  construction: boolean;
  researched: string;
}

const RULES = data.rules as Record<string, StateRule>;
export const STATE_RULES_RESEARCHED = data.researched;

export const stateRule = (code: string): StateRule | null => RULES[code?.toUpperCase()] ?? null;
export const allStateRules = () => Object.entries(RULES).map(([code, r]) => ({ code, ...r }));

const CONSTRUCTION = /\b(construct\w*|renovat\w*|remodel\w*|build-?out|roof(ing)?|paving|demolition|public works?|general contract\w*|hvac install\w*)\b/i;

export function stateRuleFor(buyer: Buyer | null, request: string): BuyerStateRule | null {
  if (!buyer) return null;
  const r = stateRule(buyer.state);
  if (!r) return null;
  const { detail: _detail, ...rest } = r;
  const applies = buyer.entity_type === "school_district" ? "schools" : "local";
  return {
    ...rest,
    code: buyer.state.toUpperCase(),
    applies,
    authority: applies === "schools" ? r.schools : r.local,
    construction: CONSTRUCTION.test(request),
    researched: data.researched,
  };
}
