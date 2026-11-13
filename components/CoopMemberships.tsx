"use client";

import { useState } from "react";
import { membershipsFor } from "@/lib/coops";
import { useStore } from "./store";

/** The agency's co-op memberships: detected from member lists or added by hand, confirmed by purchasing. */
export function CoopMemberships({ onChange }: { onChange?: () => void }) {
  const { db, act } = useStore();
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const buyer = db?.session.buyer;
  if (!db || !buyer) return null;
  const mine = membershipsFor(db, buyer.name);
  const others = db.coops.filter((c) => !mine.some((m) => m.coop_id === c.id));

  const run = async (coopId: string, op: "confirm" | "add" | "remove") => {
    setBusy(true);
    await act("setMembership", { coopId, op });
    setBusy(false);
    setAdding(false);
    onChange?.();
  };

  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <span className="font-semibold text-navy">{buyer.name}'s co-ops:</span>
      {!mine.length && <span className="text-slate">none on file{buyer.domain ? ` (no member list we hold includes ${buyer.domain})` : ""}</span>}
      {mine.map((m) => {
        const coop = db.coops.find((c) => c.id === m.coop_id);
        return (
          <span key={m.coop_id} className="inline-flex items-center gap-1.5 rounded-full border border-line bg-white py-0.5 pl-2.5 pr-1">
            <span className="font-semibold text-navy">{coop?.name}</span>
            <span className="text-[10px] text-slate">{m.source === "detected" ? (m.confirmed ? "detected, confirmed" : "detected from member list") : "added"}</span>
            {!m.confirmed && (
              <button disabled={busy} onClick={() => run(m.coop_id, "confirm")} className="rounded-full bg-emerald-50 px-1.5 text-[10px] font-semibold text-emerald-800 hover:bg-emerald-100">
                Confirm
              </button>
            )}
            <button disabled={busy} onClick={() => run(m.coop_id, "remove")} aria-label={`Remove ${coop?.name}`} className="rounded-full px-1.5 text-slate hover:bg-tint hover:text-navy">
              ✕
            </button>
          </span>
        );
      })}
      {others.length > 0 &&
        (adding ? (
          <select autoFocus disabled={busy} defaultValue="" onChange={(e) => e.target.value && run(e.target.value, "add")} onBlur={() => setAdding(false)} className="!py-0.5 text-xs">
            <option value="" disabled>
              Add a co-op…
            </option>
            {others.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        ) : (
          <button onClick={() => setAdding(true)} className="font-semibold text-maroon hover:underline">
            + Add a co-op
          </button>
        ))}
    </div>
  );
}
