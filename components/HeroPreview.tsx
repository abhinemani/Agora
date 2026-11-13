"use client";

import { useEffect, useState } from "react";
import type { Listing, Supplier } from "@/lib/types";
import { CategoryIcon } from "./CategoryIcon";
import { Annotation, BestFit, Mark, TickFrame } from "./blueprint";
import { SourcePill, money } from "./ui";

const KIND: Record<string, string> = {
  own_contract: "agency contract",
  state_contract: "state contract",
  coop_contract: "co-op contract open nationwide",
  reseller: "reseller agreement",
  gsa: "GSA schedule",
  no_approval: "small purchase",
};

/** The one moving thing on the home page: a real request resolving across
 * contracts, row by row, ending on the best fit. Static under reduced motion. */
export function HeroPreview({
  rows,
  contractCount,
  onRun,
}: {
  rows: { listing: Listing; supplier: Supplier }[];
  contractCount: number;
  onRun: () => void;
}) {
  const [step, setStep] = useState(0);
  const [run, setRun] = useState(0);

  useEffect(() => {
    if (typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setStep(rows.length + 1);
      return;
    }
    setStep(0);
    const timers = Array.from({ length: rows.length + 1 }, (_, i) => setTimeout(() => setStep(i + 1), 700 + i * 550));
    return () => timers.forEach(clearTimeout);
  }, [rows.length, run]);

  const done = step > rows.length;
  const best = rows.reduce((a, b) => (b.listing.unit_price < a.listing.unit_price ? b : a), rows[0]);

  return (
    <TickFrame>
    <div className="relative border border-base-lighter bg-white p-5">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-navy">“40 folding tables for the rec center”</div>
          <div className="mt-0.5 h-5 text-xs text-slate" aria-live="polite">
            {done ? `${rows.length} contracts can supply it` : `Checking ${contractCount} contracts…`}
          </div>
        </div>
        <Mark className="h-6 w-6" working={!done} />
      </div>

      <ul className="mt-3 space-y-2">
        {rows.map(({ listing, supplier }, i) => {
          const shown = step > i;
          const isBest = done && listing.id === best.listing.id;
          return (
            <li
              key={listing.id}
              className={`flex items-center gap-3 border p-2.5 transition-all duration-500 motion-reduce:transition-none ${shown ? "translate-y-0 opacity-100" : "translate-y-2 opacity-0"} ${
                isBest ? "border-primary-light bg-primary-lighter/40" : "border-base-lighter bg-white"
              }`}
            >
              <CategoryIcon category={listing.category} size="sm" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm text-navy">{supplier.name}</div>
                <span className="flex flex-wrap items-center gap-1.5">
                  <SourcePill source={listing.source} contractId={listing.contract_id} />
                  {isBest && <BestFit />}
                </span>
              </div>
              <div className="text-right">
                <div className="text-sm font-semibold tabular-nums text-navy">{money(listing.unit_price, false)}</div>
                <div className="text-[11px] text-slate">each</div>
              </div>
            </li>
          );
        })}
      </ul>

      <div className={`mt-3 transition-opacity duration-500 ${done ? "opacity-100" : "opacity-0"}`}>
        <Annotation className="text-primary-dark">
          Best fit · lowest price · {best?.supplier.name} · {KIND[best?.listing.source ?? "coop_contract"]}
        </Annotation>
      </div>

      <div className="mt-4 flex items-center gap-2">
        <button onClick={onRun} className="flex-1 bg-primary py-2.5 text-ui-xs font-bold text-white hover:bg-primary-dark active:bg-primary-darker">
          Run this search
        </button>
        <button onClick={() => setRun(run + 1)} className="border border-base-light px-3 py-2 text-sm text-base-dark hover:border-base-dark hover:text-ink">
          Replay
        </button>
      </div>
    </div>
    </TickFrame>
  );
}
