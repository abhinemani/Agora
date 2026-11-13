"use client";

import { useState } from "react";
import { nextStep, ORDER_STATUS, STEPS } from "@/lib/orders";
import { useStore } from "./store";
import { Button, Card, ErrorNote } from "./ui";

/** Where an order stands, as a USWDS step indicator (usa-step-indicator), followed by
 * what happened at each step as a USWDS process list (usa-process-list). */
export function OrderTimeline({ orderId }: { orderId: string }) {
  const { db, act } = useStore();
  const [error, setError] = useState<string | null>(null);
  const o = db?.orders.find((x) => x.id === orderId);
  if (!db || !o) return null;
  const steps = STEPS[o.payment];
  const at = steps.indexOf(o.status);
  const next = nextStep(o);
  const done = o.status === "reconciled";
  const events = o.events ?? [];
  const run = async (action: string) => {
    setError(null);
    try {
      await act(action, { orderId: o.id });
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <Card className="p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="font-heading text-heading-md font-bold text-ink">Where it stands</h2>
          <p className="mt-1 text-ui-xs text-base-dark">
            {o.payment === "pcard" ? "P-card orders end when the charge is matched to the receipt." : "PO orders end after the invoice, PO and receipt match and payment is approved."}
          </p>
        </div>
        {o.status === "pending_approval" ? (
          <Button onClick={() => run("approveOrder")}>Approve PO</Button>
        ) : next ? (
          <Button variant="secondary" onClick={() => run("advanceOrder")}>
            {next.action}
          </Button>
        ) : null}
      </div>

      {/* Step indicator: segments with counters; complete, current, then not yet. */}
      <div className="mt-6" aria-label="Progress">
        <ol className="flex gap-1">
          {steps.map((s, i) => (
            <li key={s} className="min-w-0 flex-1" aria-current={i === at ? "step" : undefined}>
              <span className={`block h-2 ${done ? "bg-success-darker" : i < at ? "bg-primary-dark" : i === at ? "bg-primary" : "bg-base-lighter"}`} aria-hidden />
              <span className={`mt-2 hidden truncate text-ui-3xs sm:block ${i === at ? "font-bold text-ink" : i < at ? "text-base-darker" : "text-base-dark"}`}>
                {ORDER_STATUS[s].label}
              </span>
            </li>
          ))}
        </ol>
        <div className="mt-3 flex items-center gap-2">
          <span className="grid h-8 w-8 place-items-center rounded-full bg-primary text-ui-xs font-bold text-white">{at + 1}</span>
          <span className="font-heading text-heading-sm font-bold text-ink">
            {ORDER_STATUS[o.status].label}
            <span className="ml-2 font-body text-ui-xs font-normal text-base-dark">
              step {at + 1} of {steps.length}
            </span>
          </span>
        </div>
      </div>

      {/* Process list: what happened, oldest first. */}
      <ol className="mt-6 border-t border-base-lighter pt-6">
        {events.map((e, i) => (
          <li key={`${e.status}-${i}`} className="relative pb-6 pl-12 last:pb-0">
            {i < events.length - 1 && <span className="absolute bottom-0 left-[15px] top-8 w-1 bg-base-lighter" aria-hidden />}
            <span className="absolute left-0 top-0 grid h-8 w-8 place-items-center rounded-full bg-white text-ui-xs font-bold text-ink shadow-[inset_0_0_0_4px_theme(colors.ink)]">{i + 1}</span>
            <div className="font-heading text-heading-sm font-bold leading-8 text-ink">{ORDER_STATUS[e.status].label}</div>
            <div className="text-ui-xs text-base-darker">{e.note}</div>
            <div className="text-ui-3xs text-base-dark">{new Date(e.at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</div>
          </li>
        ))}
      </ol>

      {(o.gl_code || o.invoice || o.requester) && (
        <dl className="mt-6 grid gap-3 border-t border-base-lighter pt-4 text-ui-xs sm:grid-cols-3">
          {o.gl_code && (
            <div>
              <dt className="text-base-dark">Coded to</dt>
              <dd className="font-bold text-ink">{o.gl_code}</dd>
            </div>
          )}
          {o.requester && (
            <div>
              <dt className="text-base-dark">Requested by</dt>
              <dd className="font-bold text-ink">{o.requester}</dd>
            </div>
          )}
          {o.invoice && (
            <div>
              <dt className="text-base-dark">Invoice</dt>
              <dd className="font-bold text-ink">{o.invoice.number}, matched</dd>
            </div>
          )}
        </dl>
      )}
      <ErrorNote message={error} />
    </Card>
  );
}
