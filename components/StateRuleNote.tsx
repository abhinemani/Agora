"use client";

import Link from "next/link";
import type { BuyerStateRule } from "@/lib/state-rules";
import { Flagged, tierTone } from "./StateRuleBits";

const blank = (s: string) => !s || s === "—" || /^none( found)?$/i.test(s);

/** What the buyer's state law says about using a cooperative contract, beside the co-op contracts. */
export function StateRuleNote({ rule }: { rule: BuyerStateRule }) {
  const who = rule.applies === "schools" ? "School districts" : "Local governments";
  return (
    <div className="mt-3 rounded-lg border border-base-lighter px-3 py-2.5 text-xs text-ink" data-testid="state-rule">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-bold text-navy">State law: {rule.state}</span>
        <span className={`rounded-full px-2 py-px text-[11px] font-bold ${tierTone(rule.tier)}`} title="How plainly state law opens the door to co-op contracts, 1 to 5. The analyst's grading, not a legal classification.">
          {rule.tier_label.split(":")[0]} · {rule.tier}/5
        </span>
      </div>
      <dl className="mt-1.5 grid gap-x-3 gap-y-1 sm:grid-cols-[9rem_1fr]">
        <dt className="text-slate">{who}</dt>
        <dd><Flagged text={rule.authority} /></dd>
        {!blank(rule.agreement) && (
          <>
            <dt className="text-slate">Before you buy</dt>
            <dd><Flagged text={rule.agreement} /></dd>
          </>
        )}
        {!blank(rule.lead_test) && (
          <>
            <dt className="text-slate">The contract must be</dt>
            <dd><Flagged text={rule.lead_test} /></dd>
          </>
        )}
        {!blank(rule.state_list) && (
          <>
            <dt className="text-slate">State approval</dt>
            <dd><Flagged text={rule.state_list} /></dd>
          </>
        )}
        {!blank(rule.excluded) && (
          <>
            <dt className={rule.construction ? "font-bold text-error-dark" : "text-slate"}>Not allowed for</dt>
            <dd className={rule.construction ? "rounded bg-error-lighter px-1 font-semibold text-error-dark" : ""}>
              {rule.construction && "This request looks like construction. "}
              <Flagged text={rule.excluded} />
            </dd>
          </>
        )}
        <dt className="text-slate">Bid thresholds</dt>
        <dd>
          <Flagged text={`Formal bid: ${rule.formal_bid}`} />
          {!blank(rule.quotes) && !/^local/i.test(rule.quotes) && (
            <>
              {" · "}
              <Flagged text={`Quotes: ${rule.quotes}`} />
            </>
          )}
        </dd>
      </dl>
      <p className="mt-1.5 text-[11px] text-slate">
        From Agora's 50-state research of {new Date(rule.researched + "T12:00:00").toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}. Not legal advice; confirm flagged items against the code.{" "}
        <Link href={`/data#state-${rule.code}`} className="font-semibold text-navy underline">
          Sources for {rule.state}
        </Link>
      </p>
    </div>
  );
}
