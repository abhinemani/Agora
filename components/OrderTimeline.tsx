"use client";

import { useState } from "react";
import { nextStep, ORDER_STATUS, STEPS } from "@/lib/orders";
import { useStore } from "./store";
import { Button, Card, ErrorNote } from "./ui";

/** The order's path from request to reconciled: each step done, current or ahead, with what happened. */
export function OrderTimeline({ orderId }: { orderId: string }) {
  const { db, act } = useStore();
  const [error, setError] = useState<string | null>(null);
  const o = db?.orders.find((x) => x.id === orderId);
  if (!db || !o) return null;
  const steps = STEPS[o.payment];
  const at = steps.indexOf(o.status);
  const next = nextStep(o);
  const happened = new Map((o.events ?? []).map((e) => [e.status, e]));
  const run = async (action: string) => {
    setError(null);
    try {
      await act(action, { orderId: o.id });
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-navy">Where it stands</div>
          <div className="text-xs text-slate">
            {o.payment === "pcard" ? "P-card orders end when the charge is matched to the receipt." : "PO orders end after the invoice, PO and receipt match and payment is approved."}
          </div>
        </div>
        {o.status === "pending_approval" ? (
          <Button onClick={() => run("approveOrder")}>Approve PO</Button>
        ) : next ? (
          <Button variant="secondary" onClick={() => run("advanceOrder")}>
            {next.action}
          </Button>
        ) : (
          <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-bold text-emerald-800">Closed and reconciled</span>
        )}
      </div>
      <ol className="mt-5">
        {steps.map((s, i) => {
          const done = i <= at;
          const current = i === at;
          const e = happened.get(s);
          return (
            <li key={s} className="relative flex gap-3 pb-4 last:pb-0">
              {i < steps.length - 1 && <span className={`absolute left-[9px] top-5 h-full w-0.5 ${i < at ? "bg-navy" : "bg-line"}`} aria-hidden />}
              <span
                className={`relative z-10 mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full text-[10px] font-bold ${done ? (s === "reconciled" ? "bg-emerald-600 text-white" : "bg-navy text-white") : "border-2 border-line bg-white"} ${current ? "ring-4 ring-navy/10" : ""}`}
              >
                {done ? "✓" : ""}
              </span>
              <div className="min-w-0">
                <div className={`text-sm ${done ? "font-semibold text-navy" : "text-slate"}`}>{ORDER_STATUS[s].label}</div>
                {e && (
                  <div className="text-xs text-slate">
                    {e.note}
                    <span className="ml-1 text-steel">
                      {new Date(e.at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                    </span>
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ol>
      {(o.gl_code || o.invoice) && (
        <dl className="mt-4 grid gap-3 border-t border-line pt-4 text-xs sm:grid-cols-3">
          {o.gl_code && (
            <div>
              <dt className="text-slate">Coded to</dt>
              <dd className="font-semibold text-navy">{o.gl_code}</dd>
            </div>
          )}
          {o.requester && (
            <div>
              <dt className="text-slate">Requested by</dt>
              <dd className="font-semibold text-navy">{o.requester}</dd>
            </div>
          )}
          {o.invoice && (
            <div>
              <dt className="text-slate">Invoice</dt>
              <dd className="font-semibold text-navy">{o.invoice.number}, matched</dd>
            </div>
          )}
        </dl>
      )}
      <ErrorNote message={error} />
    </Card>
  );
}
