"use client";

import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { useStore } from "@/components/store";
import { Badge, Button, Card, ErrorNote, IconCircle, LinkButton, Loading, SourcePill, Stars, SupplierBadges, money } from "@/components/ui";
import type { Results, ResultOption } from "@/lib/assistant";

export default function RequestResults() {
  const { id } = useParams<{ id: string }>();
  const ask = useSearchParams().get("ask") === "1";
  const { db, act } = useStore();
  const [results, setResults] = useState<Results | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [answered, setAnswered] = useState(false);
  const [why, setWhy] = useState(false);

  const request = db?.requests.find((r) => r.id === id);
  const needsAnswer = ask && !answered && request && (request.preference_answer === null || request.preference_answer === "always_ask");

  const load = useCallback(async () => {
    try {
      setResults(await act<Results>("getResults", { requestId: id }));
    } catch (e) {
      setError((e as Error).message);
    }
  }, [act, id]);

  useEffect(() => {
    if (db && request && !needsAnswer && !results && !error) load();
  }, [db, request, needsAnswer, results, error, load]);

  if (!db) return <Loading />;
  if (!request) return <ErrorNote message="That request isn't in this demo session. It may have been cleared by a reset." />;

  const p = request.parsed;

  return (
    <div className="space-y-6">
      <div>
        <Link href="/" className="text-xs font-semibold text-slate hover:text-navy">
          ← New request
        </Link>
        <h1 className="mt-2 text-xl font-bold text-navy">“{request.raw_text}”</h1>
        <div className="mt-3 flex flex-wrap gap-2 text-xs">
          <Parsed label="Item" value={p.item} />
          <Parsed label="Quantity" value={String(p.quantity)} />
          <Parsed label="Needed" value={p.deadline ?? "No deadline"} />
          <Parsed label="Department" value={p.department} />
          {p.category && <Parsed label="Category" value={p.category} />}
          <Parsed label="Estimated total" value={p.est_total ? money(p.est_total, false) : "Unknown"} />
          <span className="self-center rounded border border-steel/50 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-slate">
            {request.parse_mode === "llm" ? "Parsed by Claude" : "Offline parsing"}
          </span>
        </div>
      </div>

      {needsAnswer && (
        <Card className="flex flex-wrap items-center gap-4 border-l-4 border-l-maroon p-5">
          <IconCircle>?</IconCircle>
          <div className="min-w-0 flex-1">
            <div className="font-semibold text-navy">Riverbend has a local-vendor preference. Should I favor local and MBE-certified suppliers?</div>
            <div className="text-xs text-slate">I'll remember your answer for the rest of this session.</div>
          </div>
          <div className="flex gap-2">
            {(
              [
                ["yes", "Yes"],
                ["no", "No"],
                ["always_ask", "Always ask"],
              ] as const
            ).map(([a, label]) => (
              <Button
                key={a}
                variant={a === "yes" ? "primary" : "secondary"}
                onClick={async () => {
                  await act("setPreference", { requestId: id, answer: a });
                  setAnswered(true);
                }}
              >
                {label}
              </Button>
            ))}
          </div>
        </Card>
      )}

      <ErrorNote message={error} />
      {!needsAnswer && !results && !error && <Loading label="Checking every source Riverbend can buy from" />}

      {results && !results.no_match && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-sm text-slate">
              {results.groups.reduce((n, g) => n + g.options.length, 0)} options from {results.groups.length} source{results.groups.length > 1 ? "s" : ""}
              {request.preference_answer === "yes" && " · favoring local and MBE suppliers"}
            </div>
            <button onClick={() => setWhy(!why)} className="text-sm font-semibold text-maroon hover:underline">
              {why ? "Hide" : "Why this order?"}
            </button>
          </div>
          {why && (
            <Card className="bg-navy-50/60 p-4">
              <ul className="list-disc space-y-1 pl-5 text-sm text-navy">
                {results.explanation.map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
            </Card>
          )}

          <div className="grid gap-6 lg:grid-cols-3">
            <div className="space-y-6 lg:col-span-2">
              {results.groups.map((g) => (
                <section key={g.source}>
                  <div className="mb-2 flex items-center gap-2">
                    <SourcePill source={g.source} />
                    {g.source === "no_approval" && <span className="text-xs text-slate">Small purchase, no contract required.</span>}
                  </div>
                  <div className="space-y-3">
                    {g.options.map((o) => (
                      <OptionCard key={o.listing.id} o={o} qty={p.quantity} requestId={id} />
                    ))}
                  </div>
                </section>
              ))}
            </div>
            <aside className="space-y-4">
              {results.peer && <PeerCard peer={results.peer} qty={p.quantity} />}
              <Card className="p-4 text-xs text-slate">
                <div className="mb-1 font-semibold text-navy">Not what you need?</div>
                If nothing here fits, Marcus in Purchasing can start a solicitation.{" "}
                <Link href={`/solicitations/new?request=${id}`} className="font-semibold text-maroon hover:underline">
                  Start one anyway
                </Link>
              </Card>
            </aside>
          </div>
        </>
      )}

      {results && results.no_match && (
        <div className="grid gap-6 lg:grid-cols-3">
          <Card className="p-6 lg:col-span-2">
            <div className="flex gap-4">
              <IconCircle>+</IconCircle>
              <div>
                <h2 className="text-lg font-bold text-navy">No contract covers this yet. You may be the first agency to buy it.</h2>
                <p className="mt-2 text-sm text-slate">
                  This is rare: most requests resolve to something already on contract or under the quick-buy limit. Riverbend can run a solicitation, and when it's
                  awarded the contract lands in this storefront, ready for the next department and for neighboring agencies.
                </p>
                {results.similar_solicitation && (
                  <p className="mt-3 text-sm text-navy">
                    I'll start from your closest past solicitation: <span className="font-semibold">{results.similar_solicitation.title}</span>.
                  </p>
                )}
                <div className="mt-4 flex gap-2">
                  <LinkButton href={`/solicitations/new?request=${id}`} variant="maroon">
                    Start a solicitation
                  </LinkButton>
                  <LinkButton href="/" variant="secondary">
                    Try different words
                  </LinkButton>
                </div>
              </div>
            </div>
          </Card>
          {results.peer && <PeerCard peer={results.peer} qty={p.quantity} />}
        </div>
      )}
    </div>
  );
}

function Parsed({ label, value }: { label: string; value: string }) {
  return (
    <span className="rounded-md border border-navy/10 bg-white px-2.5 py-1">
      <span className="text-slate">{label}: </span>
      <span className="font-semibold text-navy">{value}</span>
    </span>
  );
}

function OptionCard({ o, qty, requestId }: { o: ResultOption; qty: number; requestId: string }) {
  const l = o.listing;
  return (
    <Card className={`p-4 ${o.sponsored ? "ring-1 ring-rose/40" : ""}`}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-navy">{l.title}</span>
            {o.sponsored && <span className="rounded border border-rose/60 px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide text-rose">Sponsored</span>}
          </div>
          {l.detail && <div className="text-xs text-slate">{l.detail}</div>}
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
            <span className="text-navy">{o.supplier.name}</span>
            <SupplierBadges supplier={o.supplier} />
            <Stars rating={o.supplier.rating} count={o.supplier.review_count} />
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate">
            <SourcePill source={l.source} />
            {o.contract_number && <span>{o.contract_number}</span>}
            <span className={o.meets_deadline === false ? "text-maroon" : ""}>{o.delivery}</span>
          </div>
          <div className={`mt-2 inline-flex items-center gap-1.5 rounded px-2 py-1 text-xs font-semibold ${o.rule.payment === "po" ? "bg-amber-50 text-amber-800" : "bg-emerald-50 text-emerald-800"}`}>
            {o.rule.text}
          </div>
        </div>
        <div className="text-right">
          <div className="text-lg font-bold text-navy">
            {money(l.unit_price)}
            <span className="text-xs font-normal text-slate"> / {l.unit}</span>
          </div>
          <div className="text-xs text-slate">
            {qty} × = <span className="font-semibold text-navy">{money(o.total)}</span>
          </div>
          <LinkButton href={`/checkout?listing=${l.id}&qty=${qty}&request=${requestId}`} className="mt-3">
            Buy
          </LinkButton>
        </div>
      </div>
    </Card>
  );
}

function PeerCard({ peer, qty }: { peer: NonNullable<Results["peer"]>; qty: number }) {
  return (
    <Card className="border-t-4 border-t-steel p-4">
      <div className="text-xs font-semibold uppercase tracking-wider text-slate">Peer pick</div>
      <div className="mt-1 text-sm font-semibold text-navy">
        {peer.agency_name} bought this {new Date(peer.date).toLocaleDateString("en-US", { month: "long", year: "numeric" })}
      </div>
      <div className="mt-2 text-sm text-navy">{peer.listing_title}</div>
      <div className="mt-1 text-xs text-slate">
        {peer.supplier_name} · {peer.distance_miles} mi away{peer.note ? ` · ${peer.note}` : ""}
      </div>
      <div className="mt-2 flex items-center justify-between">
        <span className="text-lg font-bold text-navy">{money(peer.unit_price)}</span>
        <Stars rating={peer.rating} />
      </div>
      <div className="text-xs text-slate">About {money(peer.unit_price * qty, false)} for {qty}</div>
      <div className="mt-3">
        {peer.piggybackable ? (
          <Badge tone="green">Their contract allows piggybacking</Badge>
        ) : (
          <Badge tone="amber">Their contract does not allow piggybacking</Badge>
        )}
      </div>
    </Card>
  );
}
