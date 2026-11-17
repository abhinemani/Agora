"use client";

import { useState } from "react";
import { membershipsFor } from "@/lib/coops";
import { useStore } from "./store";

/** What a detected membership rests on, weakest to strongest (see /data). */
const EVIDENCE = { list: "on a member list", roster: "on published roster", agency: "agency lists it", purchase: "bought through it" } as const;
const EVIDENCE_HINT = {
  list: "On a member list uploaded to Agora",
  roster: "Listed on the co-op's published member roster. Registration only; it doesn't show the agency buys through it.",
  agency: "The agency's own procurement page or purchasing guide names this co-op.",
  purchase: "A published approval or award shows the agency bought through this co-op.",
} as const;

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
      <a href="/data#evidence" className="text-[10px] text-slate underline">how we know</a>
      {!mine.length && (
        <span className="text-slate">
          none found on the rosters Agora holds{buyer.domain ? ` (${buyer.domain})` : ""}. That isn't proof it's not a member: TIPS, OMNIA and others don't publish full rosters.
        </span>
      )}
      {mine.map((m) => {
        const coop = db.coops.find((c) => c.id === m.coop_id);
        return (
          <span key={m.coop_id} className="inline-flex h-8 items-center gap-2 rounded-md border border-base-lighter bg-white pl-3 pr-1">
            <span className="font-semibold text-navy">{coop?.name}</span>
            <span className="text-[10px] text-slate" title={m.source === "detected" ? EVIDENCE_HINT[m.evidence ?? "list"] : undefined}>
              {m.source === "detected" ? `${EVIDENCE[m.evidence ?? "list"]}${m.member_id ? ` #${m.member_id}` : ""}${m.confirmed ? ", confirmed" : ""}` : "added"}
            </span>
            {m.source_url && (
              <a href={m.source_url} target="_blank" rel="noreferrer" className="text-[10px] font-semibold text-primary">
                source ↗
              </a>
            )}
            {!m.confirmed && (
              <button disabled={busy} onClick={() => run(m.coop_id, "confirm")} className="hover-tint h-6 rounded-md bg-success-lighter px-2 text-ui-2xs font-bold text-success-darker">
                Confirm
              </button>
            )}
            <button disabled={busy} onClick={() => run(m.coop_id, "remove")} aria-label={`Remove ${coop?.name}`} className="hover-tint grid h-6 w-6 place-items-center rounded-full text-base-dark">
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
