"use client";

import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { BuyerPicker } from "@/components/BuyerPicker";
import { useStore } from "@/components/store";
import { Lock, People, Plus, Sparkle } from "@/components/icons";
import { Badge, Button, Card, ErrorNote, Eyebrow, IconCircle, LinkButton, Loading, RevenueTags, SourcePill, Stars, SupplierBadges, money } from "@/components/ui";
import type { Results, ResultOption, Unavailable } from "@/lib/assistant";
import { PURCHASE_KINDS, TRANSACTION_FEE_SOURCES } from "@/lib/revenue_rules";

function KindBanner({ kind }: { kind: (typeof PURCHASE_KINDS)[keyof typeof PURCHASE_KINDS] }) {
  return (
    <div className={`flex flex-wrap items-center gap-4 rounded-xl px-5 py-3 ${kind.n === 3 ? "border border-dashed border-rose bg-white" : "bg-white shadow-card"}`}>
      <span className={`text-3xl font-light ${kind.n === 3 ? "text-rose" : "text-maroon"}`}>{kind.n}</span>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold text-navy">{kind.title}</div>
        <div className="text-xs text-slate">
          <span className="font-semibold">Earns:</span> {kind.earns}.
        </div>
      </div>
      <RevenueTags options={kind.options} size="md" />
    </div>
  );
}

function earnsFor(o: ResultOption) {
  const tags: number[] = [];
  if (o.listing.source !== "no_approval") tags.push(2);
  if (TRANSACTION_FEE_SOURCES.includes(o.listing.source)) tags.push(3);
  if (o.sponsored) tags.push(5);
  if (o.rule.payment === "pcard") tags.push(9);
  return tags;
}

/** Options shown per source before "Show all"; large catalogs can match dozens. */
const GROUP_LIMIT = 6;

export default function RequestResults() {
  const { id } = useParams<{ id: string }>();
  const ask = useSearchParams().get("ask") === "1";
  const { db, act } = useStore();
  const [results, setResults] = useState<Results | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string[]>([]);
  const [answered, setAnswered] = useState(false);
  const [why, setWhy] = useState(false);
  const [changing, setChanging] = useState(false);

  const request = db?.requests.find((r) => r.id === id);
  const buyer = db?.session.buyer ?? null;
  const needsBuyer = Boolean(db) && !buyer;
  // Riverbend's preference policy is the only one on file, so only its buyers are asked.
  const isHome = buyer?.name === db?.agency.name;
  const needsAnswer = !needsBuyer && isHome && ask && !answered && request && (request.preference_answer === null || request.preference_answer === "always_ask");
  const buyerKey = buyer ? `${buyer.name}|${buyer.state}|${buyer.entity_type}|${buyer.population}` : "";

  // A different buyer can use different contracts: fetch fresh results.
  useEffect(() => {
    setResults(null);
    setError(null);
  }, [buyerKey]);

  const load = useCallback(async () => {
    try {
      setResults(await act<Results>("getResults", { requestId: id }));
    } catch (e) {
      setError((e as Error).message);
    }
  }, [act, id]);

  useEffect(() => {
    if (db && request && !needsBuyer && !needsAnswer && !results && !error) load();
  }, [db, request, needsBuyer, needsAnswer, results, error, load]);

  if (!db) return <Loading />;
  if (!request) return <ErrorNote message="That request isn't in this demo session. It may have been cleared by a reset." />;

  const p = request.parsed;

  return (
    <div className="space-y-6">
      <div>
        <Link href="/" className="text-xs font-semibold text-slate hover:text-navy">
          ← New request
        </Link>
        <div className="mt-5">
          <Eyebrow>Your request</Eyebrow>
        </div>
        <h1 className="mt-2 text-2xl font-light tracking-tight text-navy sm:text-3xl">“{request.raw_text}”</h1>
        <div className="mt-3 flex flex-wrap gap-2 text-xs">
          <Parsed label="Item" value={p.item} />
          <Parsed label="Quantity" value={String(p.quantity)} />
          <Parsed label="Needed" value={p.deadline ?? "No deadline"} />
          <Parsed label="Department" value={p.department} />
          {p.category && <Parsed label="Category" value={p.category} />}
          <Parsed label="Estimated total" value={p.est_total ? money(p.est_total, false) : "Unknown"} />
          {buyer && (
            <span className="rounded-md border border-maroon/30 bg-maroon-50 px-2.5 py-1">
              <span className="text-slate">For: </span>
              <span className="font-semibold text-navy">
                {buyer.name}, {buyer.state}
              </span>
              <button onClick={() => setChanging(!changing)} className="ml-2 font-semibold text-maroon hover:underline">
                {changing ? "Cancel" : "Change"}
              </button>
            </span>
          )}
          <span className="self-center rounded border border-steel/50 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-slate">
            {request.parse_mode === "llm" ? "Parsed by Claude" : "Offline parsing"}
          </span>
        </div>
      </div>

      {(needsBuyer || changing) && <BuyerPicker onDone={() => setChanging(false)} />}

      {needsAnswer && !changing && (
        <Card accent="maroon" className="flex flex-wrap items-center gap-4 p-5">
          <IconCircle>
            <Sparkle />
          </IconCircle>
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
      {!needsBuyer && !needsAnswer && !results && !error && <Loading label={`Checking every contract ${buyer?.name ?? "you"} can use`} />}

      {results && !results.no_match && (
        <>
          <KindBanner kind={results.groups.every((g) => g.source === "no_approval") ? PURCHASE_KINDS.no_approval : PURCHASE_KINDS.contract} />
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
                    {(expanded.includes(g.source) ? g.options : g.options.slice(0, GROUP_LIMIT)).map((o) => (
                      <OptionCard key={o.listing.id} o={o} qty={p.quantity} requestId={id} />
                    ))}
                  </div>
                  {g.options.length > GROUP_LIMIT && !expanded.includes(g.source) && (
                    <button onClick={() => setExpanded([...expanded, g.source])} className="mt-3 w-full rounded-lg border border-dashed border-navy/20 py-2 text-sm font-semibold text-navy hover:bg-white">
                      Show all {g.options.length} {g.label.toLowerCase()} options
                    </button>
                  )}
                </section>
              ))}
            </div>
            <aside className="space-y-4">
              {results.peer && <PeerCard peer={results.peer} qty={p.quantity} />}
              <UnavailableCard items={results.unavailable} buyerName={results.buyer?.name ?? "this agency"} />
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

      {results && results.no_match && <KindBanner kind={PURCHASE_KINDS.new_need} />}
      {results && results.no_match && (
        <div className="grid gap-6 lg:grid-cols-3">
          <Card className="p-6 lg:col-span-2">
            <div className="flex gap-4">
              <IconCircle size="lg">
                <Plus />
              </IconCircle>
              <div>
                <h2 className="text-2xl font-light tracking-tight text-navy">
                  {results.unavailable.length
                    ? `No contract open to ${results.buyer?.name ?? "you"} covers this yet.`
                    : "No contract covers this yet. You may be the first agency to buy it."}
                </h2>
                <p className="mt-2 text-sm text-slate">
                  This is rare: most requests resolve to something already on contract or under the quick-buy limit. {results.buyer?.name ?? "Your agency"} can run a
                  solicitation, and when it's awarded the contract lands in this storefront, ready for the next department and for neighboring agencies.
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
          <div className="space-y-4">
            {results.peer && <PeerCard peer={results.peer} qty={p.quantity} />}
            <UnavailableCard items={results.unavailable} buyerName={results.buyer?.name ?? "this agency"} />
          </div>
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
  const { db, act } = useStore();
  const [chosen, setChosen] = useState(o.listing.id);
  const [quoted, setQuoted] = useState<string | null>(null);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const qr = o.quote_route;
  const l = o.variants.find((v) => v.id === chosen) ?? o.listing;
  const tiered = o.variants.length > 1;
  const total = Math.round(l.unit_price * qty * 100) / 100;
  const limit = db?.agency.quick_buy_threshold ?? 10_000;
  const via = o.rule.text.includes(" · Piggyback") ? o.rule.text.slice(o.rule.text.indexOf(" · Piggyback")) : "";
  const rule =
    l.id === o.listing.id || qr
      ? o.rule
      : total < limit
        ? { text: `Under your $${Math.round(limit / 1000)}K quick-buy limit · P-card OK${via}`, payment: "pcard" as const }
        : { text: `Needs PO · over $${Math.round(limit / 1000)}K${via}`, payment: "po" as const };
  const title = tiered ? l.title.replace(/\s*\([^)]*\)\s*$/, "") : l.title;
  return (
    <Card className={`p-5 transition hover:shadow-md ${o.sponsored ? "ring-1 ring-rose/40" : ""}`}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-navy">{title}</span>
            {o.sponsored && <span className="rounded border border-rose/60 px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide text-rose">Sponsored</span>}
          </div>
          {l.detail && <div className="text-xs text-slate">{l.detail}</div>}
          {qr && (
            <div className="mt-2 rounded-md bg-amber-50 px-2.5 py-1.5 text-xs text-amber-900">
              {qr.reference} isn't open to your agency. Buy through {qr.vehicle} {qr.contract_number} instead: the supplier quotes a discount off its list price.
              {qr.research_note ? ` ${qr.research_note}.` : ""}
            </div>
          )}
          {tiered && (
            <label className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate">
              {o.variants.length} pricing tiers
              <select value={chosen} onChange={(e) => setChosen(e.target.value)} className="max-w-full !py-1 text-xs">
                {o.variants.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.variant ?? v.sku} · {money(v.unit_price)} / {v.unit}
                  </option>
                ))}
              </select>
            </label>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
            <span className="text-navy">{o.supplier.name}</span>
            <SupplierBadges supplier={o.supplier} />
            <Stars rating={o.supplier.rating} count={o.supplier.review_count} />
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate">
            <SourcePill source={o.group} />
            {o.contract_number && (
              <span>
                {o.vehicle && <span className="font-semibold text-navy">{o.vehicle} </span>}
                {o.contract_number}
              </span>
            )}
            <span className={o.meets_deadline === false ? "text-maroon" : ""}>{o.delivery}</span>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <span className={`inline-flex items-center gap-1.5 rounded px-2 py-1 text-xs font-semibold ${rule.payment === "po" ? "bg-amber-50 text-amber-800" : "bg-emerald-50 text-emerald-800"}`}>
              {rule.text}
            </span>
            {!qr && <RevenueTags options={earnsFor({ ...o, rule })} />}
            {l.contract_id && (
              <Link href={`/product/${l.id}?qty=${qty}&request=${requestId}`} className="text-xs font-semibold text-maroon hover:underline">
                Compare ways to buy →
              </Link>
            )}
          </div>
        </div>
        {qr ? (
          <div className="text-right">
            <div className="text-[11px] uppercase tracking-wide text-slate">Reference price</div>
            <div className="text-lg font-semibold text-slate">
              {money(l.unit_price)}
              <span className="text-xs font-normal"> / {l.unit}</span>
            </div>
            <div className="text-[11px] text-slate">on {qr.reference}</div>
            {quoted ? (
              <div className="mt-3 max-w-[11rem] text-xs font-semibold text-emerald-800">Quote request {quoted} sent through {qr.vehicle}.</div>
            ) : (
              <Button
                variant="secondary"
                className="mt-3"
                onClick={async () => {
                  setQuoteError(null);
                  try {
                    const q = await act<{ id: string }>("requestQuote", { listingId: l.id, contractId: qr.contract_id, quantity: qty });
                    setQuoted(q.id);
                  } catch (e) {
                    setQuoteError((e as Error).message);
                  }
                }}
              >
                Request a quote
              </Button>
            )}
            <ErrorNote message={quoteError} />
          </div>
        ) : (
          <div className="text-right">
            <div className="text-lg font-bold text-navy">
              {money(l.unit_price)}
              <span className="text-xs font-normal text-slate"> / {l.unit}</span>
            </div>
            <div className="text-xs text-slate">
              {qty} × = <span className="font-semibold text-navy">{money(total)}</span>
            </div>
            <LinkButton href={`/checkout?listing=${l.id}&qty=${qty}&request=${requestId}`} className="mt-3">
              Buy
            </LinkButton>
          </div>
        )}
      </div>
    </Card>
  );
}

/** Matches on contracts this buyer can't use: said plainly, never hidden. */
function UnavailableCard({ items, buyerName }: { items: Unavailable[]; buyerName: string }) {
  if (!items.length) return null;
  return (
    <Card className="p-4">
      <div className="flex items-center gap-2 text-sm font-semibold text-navy">
        <Lock className="h-4 w-4 text-slate" /> On contracts {buyerName} can't use
      </div>
      <ul className="mt-2 space-y-3">
        {items.map((u) => (
          <li key={u.contract_number} className="text-xs text-slate">
            <div>
              <span className="font-semibold text-navy">{u.vehicle}</span> {u.contract_number}: {u.products} matching product{u.products === 1 ? "" : "s"}
            </div>
            <div className="truncate">e.g. {u.examples.join(", ")}</div>
            <div className="text-maroon">{u.reason}</div>
            {u.master_agreement && (
              <div className="mt-1 text-navy">
                Adopted from {u.master_agreement}. Ask your purchasing office whether your state has signed a participating addendum to it.
              </div>
            )}
          </li>
        ))}
      </ul>
      <p className="mt-3 text-[11px] text-slate">Change the buyer above to see how the options change.</p>
    </Card>
  );
}

function PeerCard({ peer, qty }: { peer: NonNullable<Results["peer"]>; qty: number }) {
  return (
    <Card accent="steel" className="p-4">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1.5">
          <People className="h-3.5 w-3.5 text-slate" />
          <Eyebrow tone="slate">Peer pick</Eyebrow>
        </span>
        <RevenueTags options={[4, 7, 6]} />
      </div>
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
