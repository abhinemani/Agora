"use client";

import { useEffect, useState } from "react";
import type { Listing, Supplier } from "@/lib/types";
import { CategoryIcon } from "./CategoryIcon";
import { Check } from "./icons";
import { SourcePill, money } from "./ui";

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
  const best = rows[0];

  return (
    <div className="relative rounded-2xl border border-line bg-white p-5 shadow-[0_24px_48px_-24px_rgba(20,33,61,0.35)]">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-navy">“40 folding tables for the rec center”</div>
          <div className="mt-0.5 h-5 text-xs text-slate" aria-live="polite">
            {done ? `${rows.length} contracts can supply it` : `Checking ${contractCount} contracts…`}
          </div>
        </div>
        {!done && <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-maroon" aria-hidden />}
      </div>

      <ul className="mt-3 space-y-2">
        {rows.map(({ listing, supplier }, i) => {
          const shown = step > i;
          const isBest = done && listing.id === best.listing.id;
          return (
            <li
              key={listing.id}
              className={`flex items-center gap-3 rounded-xl border p-2.5 transition-all duration-500 ${shown ? "translate-y-0 opacity-100" : "translate-y-2 opacity-0"} ${
                isBest ? "border-emerald-300 bg-emerald-50/60" : "border-line bg-white"
              }`}
            >
              <CategoryIcon category={listing.category} size="sm" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm text-navy">{supplier.name}</div>
                <SourcePill source={listing.source} />
              </div>
              <div className="text-right">
                <div className="text-sm font-semibold tabular-nums text-navy">{money(listing.unit_price, false)}</div>
                <div className="text-[11px] text-slate">each</div>
              </div>
            </li>
          );
        })}
      </ul>

      <div className={`mt-3 flex items-center gap-2 text-xs transition-opacity duration-500 ${done ? "opacity-100" : "opacity-0"}`}>
        <Check className="h-4 w-4 text-emerald-600" />
        <span className="text-emerald-800">Best fit: local, MBE-certified, on your own contract</span>
      </div>

      <div className="mt-4 flex items-center gap-2">
        <button onClick={onRun} className="flex-1 rounded-lg bg-navy py-2 text-sm font-semibold text-white hover:bg-navy-600">
          Run this search
        </button>
        <button onClick={() => setRun(run + 1)} className="rounded-lg border border-line px-3 py-2 text-sm text-slate hover:text-navy">
          Replay
        </button>
      </div>
    </div>
  );
}
