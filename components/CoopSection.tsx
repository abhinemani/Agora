"use client";

import Link from "next/link";
import { useState } from "react";
import type { CoopHit, CoopSection as Section } from "@/lib/assistant";
import { goHref } from "@/lib/coops";
import { stateLabel, TRX_PROGRAM } from "@/lib/trx";
import { contractHref } from "./ContractBits";
import { CoopLink } from "./CoopLink";
import { CoopMemberships } from "./CoopMemberships";
import { StateRuleNote } from "./StateRuleNote";
import { useStore } from "./store";
import { Badge, ErrorNote, Alert } from "./ui";
import { RefTag } from "./blueprint";

/** 0–100 fit, colored by strength. */
export function FitPill({ fit }: { fit: number }) {
  const tone = fit >= 80 ? "bg-emerald-50 text-emerald-800" : fit >= 50 ? "bg-amber-50 text-amber-800" : "bg-tint text-slate";
  return (
    <span className={`inline-flex shrink-0 items-center whitespace-nowrap rounded-full px-2 py-px text-[11px] font-bold tabular-nums ${tone}`} title="How much of your request this covers, 0 to 100">
      Fit {fit}
    </span>
  );
}

type SectionProps = { section: Section; requestId: string; refs?: Record<string, number> };

const stateHits = (section: Section) => section.hits.filter((h) => h.program === "state");
const coopHits = (section: Section) => section.hits.filter((h) => !h.program);

/** What each part of the co-op section holds, for the headings and counts on the results page. */
export function coopCounts(section: Section) {
  const state = stateHits(section);
  return {
    state: section.catalog?.state_total ?? state.length,
    stateNames: [...new Set(state.map((h) => stateLabel(h.state ?? "")))],
    coops: coopHits(section).length + (section.catalog?.more_member ?? 0) + (section.catalog?.more_other ?? 0),
    gsa: section.catalog?.gsa_total ?? 0,
  };
}

/** TRX state contracts for the request. For a buyer in that state they are the preferred route and sit above
 * every co-op; with no agency set they are one folded source among the others. */
export function StateContracts({ section, requestId, refs }: SectionProps) {
  const state = stateHits(section);
  if (!state.length) return null;
  return <StateLane hits={state} total={section.catalog?.state_total ?? state.length} retrieved={section.catalog?.state_retrieved} requestId={requestId} refs={refs} />;
}

/** Co-op contracts for the request: the co-ops the agency belongs to, then the ones it could join. */
/** `refs` maps a contract id to the reference number the recommended route cites it by. */
export function CoopContracts({ section, requestId, onMembershipChange, refs, query }: SectionProps & { onMembershipChange: () => void; query?: string }) {
  const { db } = useStore();
  const buyer = db?.session.buyer ?? null;
  const hits = coopHits(section);
  const state = stateHits(section);
  const members = hits.filter((h) => h.member);
  const others = hits.filter((h) => !h.member);

  return (
    <div>
      <p className="text-xs text-slate">
        {buyer ? "Split by the co-ops your agency belongs to. " : "Select an agency to see which of these co-ops it belongs to. "}
        Ordering happens on the co-op's own contract page.
      </p>
      {buyer && (
        <div className="mt-3 rounded-lg bg-tint px-3 py-2">
          <CoopMemberships onChange={onMembershipChange} />
        </div>
      )}
      {section.state_rule && <StateRuleNote rule={section.state_rule} />}

      {section.better && (
        <Alert type="warning" heading="A co-op you're not on fits this better" className="mt-4">
          {section.better.hit.coop} {section.better.hit.contract_number} scores {section.better.hit.fit}
          {section.better.than ? `, against ${section.better.than.fit} for the best contract on your co-ops (${section.better.than.coop} ${section.better.than.contract_number})` : ", and none of your co-ops has a contract for this"}
          . Fit compares scope, not price, until price files are loaded.
        </Alert>
      )}

      {buyer ? (
        <div className="mt-4 grid gap-5 lg:grid-cols-2">
          <HitList title="Co-ops you're on" empty={section.memberships_known ? "None of your co-ops has a contract for this." : "No memberships on file yet. Add the co-ops you belong to above."} hits={members} requestId={requestId} refs={refs} more={section.catalog?.more_member} />
          <HitList title="Co-ops you could join" empty="Every co-op with a contract for this is one you're on." hits={others} requestId={requestId} refs={refs} more={section.catalog?.more_other} />
        </div>
      ) : (
        <div className="mt-4">
          <HitList title={`${hits.length} co-op contract${hits.length === 1 ? "" : "s"}`} empty="No co-op contract covers this." hits={hits} requestId={requestId} refs={refs} more={(section.catalog?.more_member ?? 0) + (section.catalog?.more_other ?? 0)} />
        </div>
      )}

      {section.catalog && (
        <p className="mt-4 text-[11px] text-slate">
          Includes contracts from 13 co-ops' public directories{state.length ? ` and ${[...new Set(state.map((h) => h.coop))].join(" and ")}` : ""}, retrieved {new Date(`${section.catalog.retrieved}T12:00:00Z`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}.{" "}
          <a href="/data#catalog" className="underline">
            About the co-op catalog
          </a>
          {query && (
            <>
              {" · "}
              <Link href={`/contracts?q=${encodeURIComponent(query)}`} className="font-semibold underline">
                Search every contract for “{query}”
              </Link>
            </>
          )}
        </p>
      )}
    </div>
  );
}

/** Federal schedule contracts. GSA isn't a co-op, so they are listed apart. */
export function GsaContracts({ section, requestId, refs }: SectionProps) {
  if (!section.catalog?.gsa.length) return null;
  return (
    <div>
      <p className="mb-3 max-w-2xl text-xs text-slate">
        GSA isn't a co-op. State and local governments may buy only the SINs GSA opens to cooperative purchasing; each card says which of its SINs those are, and contracts
        with none are marked not open.
      </p>
      <ul className="grid gap-2 lg:grid-cols-2">
        {section.catalog.gsa.map((h) => (
          <Hit key={h.contract_id} h={h} requestId={requestId} refN={refs?.[h.contract_id]} />
        ))}
      </ul>
      {section.catalog.gsa_total > section.catalog.gsa.length && (
        <p className="mt-2 text-[11px] text-slate">
          {section.catalog.gsa_total - section.catalog.gsa.length} more matching schedule contracts, lower in fit. Narrow the request to see them.
        </p>
      )}
    </div>
  );
}

/** TRX state contracts for this request: the route Agora prefers, so they sit above every co-op. One block per state. */
function StateLane({ hits, total, retrieved, requestId, refs }: { hits: CoopHit[]; total: number; retrieved?: Record<string, string>; requestId: string; refs?: Record<string, number> }) {
  const states = [...new Set(hits.map((h) => h.state ?? ""))];
  return (
    <>
      {states.map((st, i) => (
        <StateBlock key={st} first={i === 0} state={st} hits={hits.filter((h) => (h.state ?? "") === st)} more={states.length === 1 ? total - hits.length : 0} retrieved={retrieved} requestId={requestId} refs={refs} />
      ))}
    </>
  );
}

function StateBlock({ first, state, hits, more, retrieved, requestId, refs }: { first: boolean; state: string; hits: CoopHit[]; more: number; retrieved?: Record<string, string>; requestId: string; refs?: Record<string, number> }) {
  const { db } = useStore();
  const buyer = db?.session.buyer ?? null;
  const p = TRX_PROGRAM[state];
  const program = hits[0]?.coop ?? p?.name ?? "the state";
  const where = stateLabel(state);
  const date = retrieved?.[program];
  return (
    <section id={first ? "state-contracts" : undefined} className="scroll-mt-24 border-y-2 border-emerald-200 bg-emerald-50/40 py-6">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-lg font-bold tracking-tight text-navy">{where} state contracts for this</h2>
        <span title="A state contract on the TRX program, which Sovra supports">
          <Badge tone="green">TRX</Badge>
        </span>
      </div>
      <p className="mt-1 max-w-3xl text-sm text-slate">
        {buyer
          ? `${buyer.name} can buy on these ${program} contracts through the ${p?.coop_program ?? "state's cooperative purchasing program"}. They come first because they're already competitively bid by the state and carry the lowest fee of any shared contract.`
          : `${program} contracts are open to ${where} local governments through the ${p?.coop_program ?? "state's cooperative purchasing program"}. Select an agency to see whether it can use them.`}{" "}
        Ordering happens under the contract number, as {program} sets out.
      </p>
      <ul className="mt-4 grid gap-2 lg:grid-cols-2">
        {hits.map((h) => (
          <Hit key={h.contract_id} h={h} requestId={requestId} refN={refs?.[h.contract_id]} />
        ))}
      </ul>
      {more > 0 && (
        <p className="mt-2 text-[11px] text-slate">
          {more} more matching {program} contract{more === 1 ? "" : "s"}, lower in fit.{" "}
          <Link href={`/contracts?coop=${encodeURIComponent(program)}`} className="font-semibold underline">
            Browse them in the contract explorer
          </Link>
        </p>
      )}
      <p className="mt-3 text-[11px] text-slate">
        From {program}&apos;s published contracts{date ? `, retrieved ${new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}` : ""}. Prices are the state&apos;s awarded line items.{" "}
        <a href={`/data#${p?.data_anchor ?? "njstart"}`} className="underline">
          About {program} in Agora
        </a>
      </p>
    </section>
  );
}

/** The co-op publishes no page per contract: send the buyer to its directory with the number to look up. */
function DirectoryLink({ h, quiet }: { h: CoopHit; quiet?: boolean }) {
  return (
    <a
      href={h.directory_url ?? undefined}
      target="_blank"
      rel="noreferrer"
      title={`${h.coop} doesn't publish a page per contract. Search its directory for ${h.contract_number}.`}
      className={quiet ? "text-xs font-semibold text-primary hover:underline" : "inline-flex items-center rounded-md border-2 border-primary px-4 py-2 text-ui-xs font-bold leading-none text-primary no-underline hover:bg-primary-lighter"}
    >
      Find {h.contract_number} on {h.coop} ↗
    </a>
  );
}

function HitList({ title, empty, hits, requestId, more = 0, refs }: { title: string; empty: string; hits: CoopHit[]; requestId: string; more?: number; refs?: Record<string, number> }) {
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
          <Hit key={h.contract_id} h={h} requestId={requestId} refN={refs?.[h.contract_id]} />
        ))}
      </ul>
      {hits.length > shown.length && (
        <button onClick={() => setAll(true)} className="mt-2 text-xs font-semibold text-maroon hover:underline">
          Show all {hits.length}
        </button>
      )}
      {more > 0 && (all || hits.length <= 4) && (
        <p className="mt-2 text-[11px] text-slate">
          {more} more matching contract{more === 1 ? "" : "s"} in the co-op catalog, lower in fit. Narrow the request to see them.
        </p>
      )}
    </div>
  );
}

function Hit({ h, requestId, refN }: { h: CoopHit; requestId: string; refN?: number }) {
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
            {refN !== undefined && <RefTag n={refN} />}
            <span className="text-sm font-semibold text-navy">{h.coop}</span>
            <span className="font-mono text-[11px] text-slate">{h.contract_number}</span>
            {buyer && !h.member && h.coop_id !== "gsa_mas" && !h.program && <Badge tone="maroon">Join to use</Badge>}
            {h.trx && (
              <span title="A state contract on the TRX program, which Sovra supports">
                <Badge tone="green">TRX</Badge>
              </span>
            )}
            {h.program === "state" ? (
              <span title={`A ${h.coop} state contract${h.solicitation ? `, awarded under ${h.solicitation}` : ""}. Read from the state's public contract list.`}>
                <Badge tone="neutral">State contract{h.solicitation ? ` · ${h.solicitation}` : ""}</Badge>
              </span>
            ) : h.source === "catalog" ? (
              <span title={`From ${h.coop}'s public contract directory. Terms and eligibility aren't independently verified.`}>
                <Badge tone="neutral">Co-op directory</Badge>
              </span>
            ) : (
              h.verification === "research_lead" && <Badge tone="amber">Research lead</Badge>
            )}
          </div>
          <div className="mt-0.5 text-xs text-navy">
            <Link href={`/storefronts/${h.supplier_id}`} className="hover:text-maroon hover:underline">
              {h.supplier}
            </Link>
            <span className="text-slate"> · </span>
            <Link href={contractHref(h.contract_id)} className="text-slate underline decoration-base-light underline-offset-2 hover:text-maroon" title="Terms, documents and how to buy under this contract">
              {h.title}
            </Link>
          </div>
          <div className={`mt-1 text-[11px] ${h.eligible ? "text-slate" : "text-maroon"}`}>
            {h.eligible ? h.reason : `Not open to you: ${h.reason}`}
            {h.products > 0 && ` · ${h.products} matching product${h.products === 1 ? "" : "s"} in Agora`}
            {h.end && ` · through ${new Date(`${h.end}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`}
          </div>
          {h.note && <div className="mt-1 text-[11px] text-amber-800">{h.note}</div>}
        </div>
        <FitPill fit={h.fit} />
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-end gap-3">
        <Link href={contractHref(h.contract_id)} className="mr-auto text-xs font-semibold text-primary hover:underline">
          Contract details
        </Link>
        {h.member || !buyer || h.coop_id === "gsa_mas" ? (
          h.link_out && !h.link_out.has_link && h.directory_url ? (
            <DirectoryLink h={h} />
          ) : h.link_out ? (
            <CoopLink contractId={h.contract_id} coop={h.coop} hasLink={h.link_out.has_link} requestId={requestId} disabled={!h.eligible} />
          ) : (
            <span className="text-[11px] text-slate">Buy in Agora from the results above</span>
          )
        ) : (
          <>
            {h.link_out?.has_link ? (
              <a href={goHref(h.contract_id, { request: requestId })} target="_blank" rel="noreferrer" className="text-xs font-semibold text-primary hover:underline">
                View contract ↗
              </a>
            ) : (
              h.directory_url && <DirectoryLink h={h} quiet />
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
                className="inline-flex items-center rounded-md bg-primary px-4 py-2.5 text-ui-xs font-bold leading-none text-white no-underline hover:bg-primary-dark active:bg-primary-darker disabled:bg-disabled-lighter disabled:text-disabled-dark"
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
