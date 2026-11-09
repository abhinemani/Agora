"use client";

import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { BuyerPicker } from "@/components/BuyerPicker";
import { CategoryIcon } from "@/components/CategoryIcon";
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

/** Cards shown before "Show all"; large catalogs can match dozens. */
const GRID_LIMIT = 9;

export default function RequestResults() {
  const { id } = useParams<{ id: string }>();
  const ask = useSearchParams().get("ask") === "1";
  const { db, act, showEarn } = useStore();
  const [results, setResults] = useState<Results | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [answered, setAnswered] = useState(false);
  const [why, setWhy] = useState(false);
  const [changing, setChanging] = useState(false);

  const request = db?.requests.find((r) => r.id === id);
  const buyer = db?.session.buyer ?? null;
  // Agora searches every contract by default; the agency is optional.
  const needsBuyer = false;
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

  const all = results ? results.groups.flatMap((g) => g.options) : [];
  const shown = showAll ? all : all.slice(0, GRID_LIMIT);
  const sources = results ? results.groups.length : 0;

  return (
    <div className="space-y-6">
      <div>
        <Link href="/" className="text-sm text-slate hover:text-navy">
          ← New search
        </Link>
        <div className="mt-4 flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-[1.8rem] font-extrabold leading-tight tracking-[-0.03em] text-navy">Results for “{request.raw_text}”</h1>
            <p className="mt-1.5 text-sm text-slate" title={request.parse_mode === "llm" ? "Read by Claude" : "Read with offline rules"}>
              {results && !results.no_match ? `${all.length} option${all.length === 1 ? "" : "s"} across ${sources} kind${sources === 1 ? "" : "s"} of contract. ` : ""}
              {p.quantity > 1 ? `${p.quantity} needed` : "One needed"}
              {p.deadline ? `, ${p.deadline}` : ""}
              {p.est_total ? `, about ${money(p.est_total, false)}` : ""}.
              {request.preference_answer === "yes" && " Favoring local and MBE suppliers."}
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {results && !results.no_match && (
              <button onClick={() => setWhy(!why)} className="rounded-[9px] border border-[#dbe4f0] bg-white px-3.5 py-2.5 text-xs font-bold text-[#385783] hover:border-[#8fa8e8]">
                {why ? "Hide ranking" : "How these are ranked"}
              </button>
            )}
            <button onClick={() => setChanging(!changing)} className="rounded-[9px] border border-[#dbe4f0] bg-white px-3.5 py-2.5 text-xs font-bold text-[#385783] hover:border-[#8fa8e8]">
              {changing ? "Cancel" : buyer ? `For ${buyer.name}` : "Set your agency"}
            </button>
          </div>
        </div>
        <p className="mt-2 text-xs text-slate">
          {buyer
            ? `Showing only contracts open to ${buyer.name}, ${buyer.state}.`
            : "Showing every contract in Agora. Set your agency to hide the ones you can't use."}
        </p>
      </div>

      {changing && <BuyerPicker onDone={() => setChanging(false)} onClose={() => setChanging(false)} />}

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
      {!needsBuyer && !needsAnswer && !results && !error && <Loading label={buyer ? `Checking every contract ${buyer.name} can use` : "Checking every contract in Agora"} />}

      {results && !results.no_match && (
        <>
          {showEarn && <KindBanner kind={results.groups.every((g) => g.source === "no_approval") ? PURCHASE_KINDS.no_approval : PURCHASE_KINDS.contract} />}
          {why && (
            <Card className="bg-navy-50/60 p-4">
              <ul className="list-disc space-y-1 pl-5 text-sm text-navy">
                {results.explanation.map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
            </Card>
          )}

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {shown.map((o) => (
              <OptionCard key={o.listing.id} o={o} qty={p.quantity} requestId={id} />
            ))}
          </div>
          {all.length > shown.length && (
            <button onClick={() => setShowAll(true)} className="w-full rounded-xl border border-dashed border-navy/20 py-3 text-sm font-semibold text-navy hover:bg-white">
              Show all {all.length} options
            </button>
          )}

          <div className="grid gap-4 md:grid-cols-3">
            {results.peer && <PeerCard peer={results.peer} qty={p.quantity} />}
            <UnavailableCard items={results.unavailable} buyerName={results.buyer?.name ?? "this agency"} />
            <div className="flex flex-col justify-between rounded-2xl border border-line bg-white p-5">
              <div>
                <div className="text-base font-bold tracking-tight text-navy">Don't see what you need?</div>
                <p className="mt-1 text-sm text-slate">Turn this request into a solicitation. Agora drafts it from what you asked for and the closest past award.</p>
              </div>
              <Link href={`/solicitations/new?request=${id}`} className="mt-4 text-sm font-bold text-maroon hover:underline">
                Build a solicitation →
              </Link>
            </div>
          </div>
        </>
      )}

      {results && results.no_match && showEarn && <KindBanner kind={PURCHASE_KINDS.new_need} />}
      {results && results.no_match && (
        <div className="grid gap-6 lg:grid-cols-3">
          <Card className="p-6 lg:col-span-2">
            <div className="flex gap-4">
              <IconCircle size="lg">
                <Plus />
              </IconCircle>
              <div>
                <h2 className="text-2xl font-extrabold tracking-tight text-navy">
                  {results.unavailable.length
                    ? `No contract open to ${results.buyer?.name ?? "you"} covers this yet.`
                    : "No contract covers this yet. You may be the first agency to buy it."}
                </h2>
                <p className="mt-2 text-sm text-slate">
                  This is rare: most requests resolve to something already on contract or under a quick-buy limit. {results.buyer?.name ?? "Your agency"} can run a
                  solicitation, and once it's awarded the contract joins Agora, ready for the next agency that needs the same thing.
                </p>
                {results.similar_solicitation && (
                  <p className="mt-3 text-sm text-navy">
                    I'll start from the closest past solicitation: <span className="font-semibold">{results.similar_solicitation.title}</span>.
                  </p>
                )}
                <div className="mt-4 flex gap-2">
                  <LinkButton href={`/solicitations/new?request=${id}`} variant="maroon">
                    Build a solicitation
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
        ? { text: `Under a $${Math.round(limit / 1000)}K quick-buy limit · P-card OK${via}`, payment: "pcard" as const }
        : { text: `Needs PO · over $${Math.round(limit / 1000)}K${via}`, payment: "po" as const };
  const title = tiered ? l.title.replace(/\s*\([^)]*\)\s*$/, "") : l.title;
  const href = `/product/${l.id}?qty=${qty}&request=${requestId}`;
  return (
    <div className="flex min-h-[290px] flex-col rounded-2xl border border-line bg-white p-[18px] shadow-[0_3px_15px_rgba(19,45,82,0.02)] transition hover:border-[#bbcae8]">
      <div className="flex items-start justify-between gap-3">
        <CategoryIcon category={l.category} />
        <div className="flex flex-col items-end gap-1">
          <SourcePill source={l.source} />
          {o.sponsored && <span className="text-[10px] text-slate">Sponsored</span>}
        </div>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-1.5 text-[11px] text-slate">
        <span>{o.supplier.name}</span>
        <SupplierBadges supplier={o.supplier} />
      </div>
      <Link href={href} className="mt-0.5 text-[17px] font-bold leading-snug tracking-[-0.01em] text-navy hover:text-maroon">
        {title}
      </Link>
      <p className="mt-1.5 line-clamp-3 text-xs leading-relaxed text-slate">
        {qr
          ? `${qr.reference} isn't open to your agency. Buy through ${qr.vehicle} ${qr.contract_number}: the supplier quotes a discount off list.${qr.research_note ? ` ${qr.research_note}.` : ""}`
          : l.detail || [o.vehicle, o.contract_number].filter(Boolean).join(" ") || o.delivery}
      </p>
      {tiered && (
        <label className="mb-1 flex flex-wrap items-center gap-2 text-[11px] text-slate">
          {o.variants.length} tiers
          <select value={chosen} onChange={(e) => setChosen(e.target.value)} className="min-w-0 max-w-full flex-1 !py-1 text-xs">
            {o.variants.map((v) => (
              <option key={v.id} value={v.id}>
                {v.variant ?? v.sku} · {money(v.unit_price)} / {v.unit}
              </option>
            ))}
          </select>
        </label>
      )}
      <div className="mb-3 mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px]">
        {!qr && <span className={rule.payment === "po" ? "text-amber-700" : "text-emerald-700"}>{rule.text}</span>}
        <Stars rating={o.supplier.rating} count={o.supplier.review_count} />
        {!qr && <RevenueTags options={earnsFor({ ...o, rule })} />}
      </div>
      <div className="mt-auto flex items-end justify-between gap-2 border-t border-[#edf0f5] pt-3">
        <div className="min-w-0">
          <div className={`text-[15px] font-extrabold tabular-nums ${qr ? "text-slate" : "text-navy"}`}>
            {money(l.unit_price)}
            <span className="text-[11px] font-medium text-slate"> / {l.unit}</span>
          </div>
          <div className="text-[10px] text-slate">{qr ? `Reference price on ${qr.reference}` : qty > 1 ? `${qty} for ${money(total)}` : o.delivery}</div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <Link href={href} className="rounded-[9px] border border-[#dbe4f0] bg-white px-3 py-2 text-xs font-bold text-[#385783] hover:border-[#8fa8e8]">
            View →
          </Link>
          {qr ? (
            quoted ? (
              <span className="text-[11px] font-semibold text-emerald-800">Quote {quoted} sent</span>
            ) : (
              <button
                className="rounded-[9px] bg-maroon px-3 py-2 text-xs font-bold text-white hover:bg-maroon-600"
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
              </button>
            )
          ) : (
            <Link href={`/checkout?listing=${l.id}&qty=${qty}&request=${requestId}`} className="rounded-[9px] bg-maroon px-3 py-2 text-xs font-bold text-white hover:bg-maroon-600">
              Buy
            </Link>
          )}
        </div>
      </div>
      {quoteError && (
        <div className="mt-2">
          <ErrorNote message={quoteError} />
        </div>
      )}
    </div>
  );
}

/** Matches on contracts this buyer can't use: said plainly, never hidden. */
function UnavailableCard({ items, buyerName }: { items: Unavailable[]; buyerName: string }) {
  if (!items.length) return null;
  return (
    <Card className="rounded-2xl p-5">
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
      <p className="mt-3 text-[11px] text-slate">Change your agency above to see how the options change.</p>
    </Card>
  );
}

function PeerCard({ peer, qty }: { peer: NonNullable<Results["peer"]>; qty: number }) {
  return (
    <Card accent="steel" className="rounded-2xl p-5">
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
