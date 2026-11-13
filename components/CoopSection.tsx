"use client";

import Link from "next/link";
import { useState } from "react";
import type { CoopHit, CoopSection as Section } from "@/lib/assistant";
import { goHref } from "@/lib/coops";
import { CoopLink } from "./CoopLink";
import { CoopMemberships } from "./CoopMemberships";
import { useStore } from "./store";
import { Badge, ErrorNote } from "./ui";

/** 0–100 fit, colored by strength. */
export function FitPill({ fit }: { fit: number }) {
  const tone = fit >= 80 ? "bg-emerald-50 text-emerald-800" : fit >= 50 ? "bg-amber-50 text-amber-800" : "bg-tint text-slate";
  return (
    <span className={`inline-flex shrink-0 items-center whitespace-nowrap rounded-full px-2 py-px text-[11px] font-bold tabular-nums ${tone}`} title="How much of your request this covers, 0 to 100">
      Fit {fit}
    </span>
  );
}

/** Co-op contracts for the request: the co-ops the agency belongs to, then the ones it could join. */
export function CoopSection({ section, requestId, onMembershipChange }: { section: Section; requestId: string; onMembershipChange: () => void }) {
  const { db } = useStore();
  const buyer = db?.session.buyer ?? null;
  if (!section.hits.length) return null;
  const members = section.hits.filter((h) => h.member);
  const others = section.hits.filter((h) => !h.member);

  return (
    <section id="coops" className="scroll-mt-24 rounded-xl bg-surface-container-low p-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold tracking-tight text-navy">Co-op contracts for this</h2>
          <p className="mt-0.5 text-xs text-slate">
            {buyer ? "Split by the co-ops your agency belongs to. " : "Set your agency to see which of these co-ops you already belong to. "}
            Ordering happens on the co-op's own contract page.
          </p>
        </div>
      </div>
      {buyer && (
        <div className="mt-3 rounded-lg bg-tint px-3 py-2">
          <CoopMemberships onChange={onMembershipChange} />
        </div>
      )}

      {section.better && (
        <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <span className="font-semibold">A co-op you're not on fits this better.</span> {section.better.hit.coop} {section.better.hit.contract_number} scores {section.better.hit.fit}
          {section.better.than ? `, against ${section.better.than.fit} for the best contract on your co-ops (${section.better.than.coop} ${section.better.than.contract_number})` : ", and none of your co-ops has a contract for this"}
          . Fit compares scope, not price, until price files are loaded.
        </div>
      )}

      {buyer ? (
        <div className="mt-4 grid gap-5 lg:grid-cols-2">
          <HitList title="Co-ops you're on" empty={section.memberships_known ? "None of your co-ops has a contract for this." : "No memberships on file yet. Add the co-ops you belong to above."} hits={members} requestId={requestId} />
          <HitList title="Co-ops you could join" empty="Every co-op with a contract for this is one you're on." hits={others} requestId={requestId} />
        </div>
      ) : (
        <div className="mt-4">
          <HitList title={`${section.hits.length} co-op contract${section.hits.length === 1 ? "" : "s"}`} empty="" hits={section.hits} requestId={requestId} />
        </div>
      )}
    </section>
  );
}

function HitList({ title, empty, hits, requestId }: { title: string; empty: string; hits: CoopHit[]; requestId: string }) {
  const [all, setAll] = useState(false);
  const shown = all ? hits : hits.slice(0, 4);
  return (
    <div>
      <h3 className="mb-2 text-xs font-semibold text-slate">
        {title} {hits.length > 0 && <span className="font-normal">({hits.length})</span>}
      </h3>
      {!hits.length && <p className="text-xs text-slate">{empty}</p>}
      <ul className="space-y-2">
        {shown.map((h) => (
          <Hit key={h.contract_id} h={h} requestId={requestId} />
        ))}
      </ul>
      {hits.length > shown.length && (
        <button onClick={() => setAll(true)} className="mt-2 text-xs font-semibold text-maroon hover:underline">
          Show all {hits.length}
        </button>
      )}
    </div>
  );
}

function Hit({ h, requestId }: { h: CoopHit; requestId: string }) {
  const { db, act } = useStore();
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const buyer = db?.session.buyer ?? null;
  const asked = sent || Boolean(db?.referrals.some((r) => r.contract_id === h.contract_id && r.agency === buyer?.name && r.request_id === requestId));

  return (
    <li className="rounded-xl border border-line p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-sm font-semibold text-navy">{h.coop}</span>
            <span className="font-mono text-[11px] text-slate">{h.contract_number}</span>
            {buyer && !h.member && <Badge tone="maroon">Join to use</Badge>}
            {h.verification === "research_lead" && <Badge tone="amber">Research lead</Badge>}
          </div>
          <div className="mt-0.5 text-xs text-navy">
            <Link href={`/storefronts/${h.supplier_id}`} className="hover:text-maroon hover:underline">
              {h.supplier}
            </Link>
            <span className="text-slate"> · {h.title}</span>
          </div>
          <div className={`mt-1 text-[11px] ${h.eligible ? "text-slate" : "text-maroon"}`}>
            {h.eligible ? h.reason : `Not open to you: ${h.reason}`}
            {h.products > 0 && ` · ${h.products} matching product${h.products === 1 ? "" : "s"} in Agora`}
          </div>
          {h.note && <div className="mt-1 text-[11px] text-amber-800">{h.note}</div>}
        </div>
        <FitPill fit={h.fit} />
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-end gap-2">
        {h.member || !buyer ? (
          h.link_out ? (
            <CoopLink contractId={h.contract_id} coop={h.coop} hasLink={h.link_out.has_link} requestId={requestId} disabled={!h.eligible} />
          ) : (
            <span className="text-[11px] text-slate">Buy in Agora from the results above</span>
          )
        ) : (
          <>
            {h.link_out?.has_link && (
              <a href={goHref(h.contract_id, { request: requestId })} target="_blank" rel="noreferrer" className="text-xs font-semibold text-primary hover:underline">
                View contract ↗
              </a>
            )}
            {asked ? (
              <span className="text-xs font-semibold text-emerald-800">Sent to purchasing</span>
            ) : (
              <button
                disabled={!h.eligible}
                onClick={async () => {
                  setError(null);
                  try {
                    await act("askToJoin", { contractId: h.contract_id, requestId, fit: h.fit });
                    setSent(true);
                  } catch (e) {
                    setError((e as Error).message);
                  }
                }}
                className="state-layer inline-flex h-9 items-center rounded-full bg-primary px-4 text-label-l text-on-primary disabled:bg-on-surface/[.12] disabled:text-on-surface/[.38]"
              >
                Ask purchasing to get us on this
              </button>
            )}
          </>
        )}
      </div>
      <ErrorNote message={error} />
    </li>
  );
}
