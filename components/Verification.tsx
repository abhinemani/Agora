"use client";

import { useEffect, useRef, useState } from "react";
import type { Supplier, VerificationCheck } from "@/lib/types";
import { checksFor, verificationSummary } from "@/lib/verification";

const MARK: Record<VerificationCheck["status"], { glyph: string; cls: string; label: string }> = {
  pass: { glyph: "✓", cls: "bg-emerald-600 text-white", label: "Passed" },
  expiring: { glyph: "!", cls: "bg-amber-500 text-white", label: "Expiring soon" },
  fail: { glyph: "✕", cls: "bg-red-600 text-white", label: "Failed" },
  not_checked: { glyph: "", cls: "border border-line bg-white", label: "Not checked" },
};

/** Every check behind the Verified badge, with its source and when it was run. */
export function VerificationList({ supplier }: { supplier: Supplier }) {
  const checks = checksFor(supplier);
  return (
    <ul className="divide-y divide-navy/5">
      {checks.map((c, i) => {
        const m = MARK[c.status];
        return (
          <li key={`${c.id}-${i}`} className="flex gap-3 py-2.5">
            <span aria-label={m.label} className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full text-[11px] font-bold ${m.cls}`}>
              {m.glyph}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                <span className="text-sm font-semibold text-navy">{c.label}</span>
                <span className="text-[11px] text-slate">{c.checked_at ? `Checked ${c.checked_at}` : "Never checked"}</span>
              </div>
              <div className={`text-xs ${c.status === "fail" ? "text-red-700" : c.status === "expiring" ? "text-amber-800" : "text-slate"}`}>{c.detail}</div>
              <div className="text-[11px] text-steel">{c.source}</div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/** The badge itself: opens the list of checks. Shows nothing for a supplier nobody has checked. */
export function VerifyBadge({ supplier }: { supplier: Supplier }) {
  const [open, setOpen] = useState(false);
  const close = useRef<HTMLButtonElement>(null);
  const v = verificationSummary(supplier);
  useEffect(() => {
    if (!open) return;
    close.current?.focus();
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  }, [open]);
  if (v.unchecked) return null;
  const clean = v.problems === 0;
  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen(true);
        }}
        className={`inline-flex items-center gap-1 rounded border px-1.5 py-px text-[11px] font-semibold ${clean ? "border-emerald-200 bg-emerald-50 text-emerald-800 hover:border-emerald-400" : "border-amber-200 bg-amber-50 text-amber-800 hover:border-amber-400"}`}
        title="See what was checked"
      >
        {clean ? "✓ Verified" : `${v.problems} check${v.problems === 1 ? "" : "s"} to review`}
      </button>
      {open && (
        <div className="fixed inset-0 z-50 grid place-items-center p-4" role="dialog" aria-modal="true" aria-label={`${supplier.name} verification`}>
          <button aria-label="Close" className="absolute inset-0 cursor-default bg-navy/40" onClick={() => setOpen(false)} />
          <div className="relative w-full max-w-md rounded-xl bg-white p-5 shadow-2xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-base font-bold text-navy">{supplier.name}</div>
                <div className="text-xs text-slate">
                  {v.passed} of {v.checks.length} checks passed{v.problems ? `, ${v.problems} to review` : ""}
                </div>
              </div>
              <button ref={close} onClick={() => setOpen(false)} className="rounded px-2 py-1 text-slate hover:bg-tint hover:text-navy">
                Close
              </button>
            </div>
            <div className="mt-3">
              <VerificationList supplier={supplier} />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
