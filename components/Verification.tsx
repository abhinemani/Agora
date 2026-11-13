"use client";

import { useEffect, useRef, useState } from "react";
import type { Supplier, VerificationCheck } from "@/lib/types";
import { checksFor, verificationSummary } from "@/lib/verification";

const MARK: Record<VerificationCheck["status"], { glyph: string; cls: string; label: string }> = {
  pass: { glyph: "✓", cls: "bg-success text-success-on", label: "Passed" },
  expiring: { glyph: "!", cls: "bg-warning text-warning-on", label: "Expiring soon" },
  fail: { glyph: "✕", cls: "bg-error text-on-error", label: "Failed" },
  not_checked: { glyph: "", cls: "border-2 border-outline", label: "Not checked" },
};

/** Every check behind the Verified badge, with its source and when it was run. */
export function VerificationList({ supplier }: { supplier: Supplier }) {
  const checks = checksFor(supplier);
  return (
    <ul className="divide-y divide-outline-variant">
      {checks.map((c, i) => {
        const m = MARK[c.status];
        return (
          <li key={`${c.id}-${i}`} className="flex gap-3 py-2.5">
            <span aria-label={m.label} className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full text-[11px] font-bold ${m.cls}`}>
              {m.glyph}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                <span className="text-title-s text-on-surface">{c.label}</span>
                <span className="text-[11px] text-slate">{c.checked_at ? `Checked ${c.checked_at}` : "Never checked"}</span>
              </div>
              <div className={`text-xs ${c.status === "fail" ? "text-error" : c.status === "expiring" ? "text-warning" : "text-on-surface-variant"}`}>{c.detail}</div>
              <div className="text-body-s text-outline">{c.source}</div>
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
        className={`state-layer inline-flex h-6 items-center gap-1 rounded-md px-2 text-label-m ${clean ? "bg-success-container text-success-on-container" : "bg-warning-container text-warning-on-container"}`}
        title="See what was checked"
      >
        {clean ? "✓ Verified" : `${v.problems} check${v.problems === 1 ? "" : "s"} to review`}
      </button>
      {open && (
        <div className="fixed inset-0 z-50 grid place-items-center p-4" role="dialog" aria-modal="true" aria-label={`${supplier.name} verification`}>
          <button aria-label="Close" className="absolute inset-0 cursor-default bg-scrim/[.32]" onClick={() => setOpen(false)} />
          <div className="relative w-full max-w-md rounded-3xl bg-surface-container-high p-6 shadow-elevation-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-headline-s text-on-surface">{supplier.name}</div>
                <div className="mt-1 text-body-m text-on-surface-variant">
                  {v.passed} of {v.checks.length} checks passed{v.problems ? `, ${v.problems} to review` : ""}
                </div>
              </div>
              <button ref={close} onClick={() => setOpen(false)} className="state-layer h-10 rounded-full px-3 text-label-l text-primary">
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
