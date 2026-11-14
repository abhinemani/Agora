"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Results } from "@/lib/assistant";
import { buildPlan, defaultSelection, purchaseFileText, shopperAddOns, shopperCandidates, usd, type Plan, type PlanRoute, type ShopperSelection } from "@/lib/shopper";
import type { ShopperText } from "@/lib/shopper-ai";
import { Feedback } from "./Feedback";
import { PAPERWORK_LABEL, paperworkKinds, type Paperwork, type PaperworkKind } from "@/lib/paperwork";
import { Annotation, BestFit, Mark, RefTag, TickFrame } from "./blueprint";
import { useStore } from "./store";
import { ErrorNote } from "./ui";

const label = "font-mono text-[11px] uppercase tracking-[0.14em]";
const primaryBtn = "inline-flex min-h-[44px] items-center rounded-md bg-primary px-4 text-ui-xs font-bold leading-none text-white no-underline hover:bg-primary-dark disabled:opacity-60";
const outlineBtn = "inline-flex min-h-[44px] items-center rounded-md bg-white px-4 text-ui-xs font-bold leading-none text-primary no-underline shadow-[inset_0_0_0_2px_theme(colors.primary.DEFAULT)] hover:text-primary-dark disabled:opacity-60";
const textLink = "inline-flex min-h-[44px] items-center text-ui-xs font-bold text-primary hover:text-primary-dark";

/** "**bold**" in the shopper's text becomes <strong>. Nothing else is interpreted. */
function Rich({ text }: { text: string }) {
  return <>{text.split(/\*\*(.+?)\*\*/g).map((part, i) => (i % 2 ? <strong key={i}>{part}</strong> : part))}</>;
}

function Band({ step, title, working = false }: { step: string; title: string; working?: boolean }) {
  return (
    <div className="flex items-center gap-3 bg-[#0F3D73] px-5 py-4 [background-image:linear-gradient(rgba(255,255,255,0.06)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.06)_1px,transparent_1px)] [background-size:16px_16px]">
      <Mark className="h-8 w-8" onDark working={working} />
      <div className="min-w-0">
        <div className={`${label} text-[#BFD5EE]`}>{step}</div>
        <div className="font-heading text-lg font-bold text-white">{title}</div>
      </div>
    </div>
  );
}

function Sources({ plan, refs }: { plan: Plan; refs: number[] }) {
  const shown = plan.refs.filter((r) => refs.includes(r.n));
  if (!shown.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-base-lighter pt-3">
      <span className={`${label} text-base-dark`}>Sources</span>
      {shown.map((r) => (
        <span key={r.n} className="inline-flex items-center gap-1.5 text-ui-2xs text-base-darker">
          <RefTag n={r.n} />
          {r.label}
        </span>
      ))}
    </div>
  );
}

/** The personal shopper on the results page: confirm what you're buying, then see how to buy it.
 * The plan is computed by rules (lib/shopper.ts) and redraws as the order changes. With an API key,
 * the shopper also words the plan and answers questions; without one, the rule-based wording stands. */
export function Shopper({ results, requestId, onChanged }: { results: Results; requestId: string; onChanged: () => void }) {
  const { db, act, llm } = useStore();
  const request = db?.requests.find((r) => r.id === requestId);
  const [sel, setSel] = useState<ShopperSelection>(() => defaultSelection(results, request ?? results.request));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [brief, setBrief] = useState<ShopperText | null>(null);
  const [writing, setWriting] = useState(false);
  const briefFor = useRef<string | null>(null);

  const confirmedAt = request?.shopper?.confirmed_at ?? null;
  const candidates = useMemo(() => shopperCandidates(results), [results]);
  const chosen = candidates.find((o) => o.listing.id === sel.listing_id);
  const listings = db?.listings ?? [];
  const addOns = useMemo(() => shopperAddOns(listings, results, chosen), [listings, results, chosen]);
  const plan = useMemo(
    () => buildPlan({ results, listings, limit: db?.agency.quick_buy_threshold ?? 10_000, agencyName: db?.agency.name ?? "", selection: sel }),
    [results, listings, db?.agency.quick_buy_threshold, db?.agency.name, sel],
  );

  // Once the items are confirmed, ask the shopper to word the plan. The rule-based wording shows meanwhile, and stays if this fails.
  useEffect(() => {
    if (!confirmedAt || !llm || briefFor.current === confirmedAt) return;
    briefFor.current = confirmedAt;
    setBrief(null);
    setWriting(true);
    act<ShopperText | null>("shopperBrief", { requestId })
      .then((b) => briefFor.current === confirmedAt && setBrief(b))
      .catch(() => {})
      .finally(() => setWriting(false));
  }, [confirmedAt, llm, act, requestId]);

  if (!db || !request) return null;

  const coopRoutes = plan.routes.filter((r) => r.kind !== "priced");
  const quoteHits = coopRoutes.flatMap((r) => r.hits);
  const setQty = (n: number) => setSel((s) => ({ ...s, quantity: Math.max(1, Math.min(100_000, Math.floor(n) || 1)) }));
  const addOnQty = (id: string) => sel.add_ons.find((a) => a.listing_id === id)?.quantity;
  const toggleAddOn = (id: string) =>
    setSel((s) => ({ ...s, add_ons: s.add_ons.some((a) => a.listing_id === id) ? s.add_ons.filter((a) => a.listing_id !== id) : [...s.add_ons, { listing_id: id, quantity: s.quantity }] }));
  const pick = (listing_id: string | null) => setSel((s) => ({ ...s, listing_id, add_ons: [] }));

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const confirm = () =>
    run(async () => {
      await act("confirmItems", { requestId, listingId: sel.listing_id, quantity: sel.quantity, addOns: sel.add_ons.map((a) => ({ listingId: a.listing_id, quantity: a.quantity })) });
      onChanged();
    });

  const pct = plan.total === null ? 0 : Math.min(100, (plan.total / (plan.limit * 3)) * 100);
  const under = plan.total !== null && plan.total < plan.limit;
  const meterNote = plan.total === null ? "Total unknown until quoted" : plan.payment === "coop_site" ? "Ordered on the co-op's site" : under ? "Fits on a P-card" : plan.payment === "needs_contract" ? "Over the limit: needs a contract" : "Over the limit: needs a PO";

  return (
    <section aria-label="Your personal shopper" className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="min-w-0 space-y-4">
        {!confirmedAt ? (
          <>
            <div className="border border-primary-darker bg-white">
              <Band step="Your personal shopper · step 1 of 2" title="Confirm what you're buying" />

              <fieldset className="space-y-2.5 px-5 pt-5">
                <legend className="mb-2.5 text-body-md font-bold text-ink">{candidates.length > 1 ? "Which one?" : "Is this it?"}</legend>
                {candidates.map((o, i) => {
                  const on = sel.listing_id === o.listing.id;
                  const peer = results.peer && results.peer.listing_title === o.listing.title ? results.peer : null;
                  const refN = plan.refs.find((r) => r.key === `listing:${o.listing.id}`)?.n;
                  return (
                    <label key={o.listing.id} className={`flex cursor-pointer flex-wrap items-start gap-x-3.5 gap-y-2 border px-4 py-3.5 ${on ? "border-primary-darker bg-primary-lighter/40" : "border-base-lighter bg-white"}`}>
                      <input type="radio" name={`item-${requestId}`} checked={on} onChange={() => pick(o.listing.id)} className="mt-0.5 h-5 w-5 accent-[#162E51]" />
                      <span className="flex min-w-0 flex-[1_1_300px] flex-col gap-1.5">
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="text-body-md font-bold text-ink">{o.listing.title}</span>
                          {i === 0 && candidates.length > 1 && <BestFit />}
                        </span>
                        <span className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 text-ui-2xs text-base-darker">
                          <span className="border border-base-light bg-white px-1.5 py-px font-mono text-[11px] tracking-[0.1em]">SKU {o.listing.sku}</span>
                          <span>{o.supplier.name}</span>
                          <span>{[o.vehicle, o.contract_number].filter(Boolean).join(" ") || "No contract needed"}</span>
                          <span>{o.listing.lead_time_days}-day lead time</span>
                          {refN !== undefined && <RefTag n={refN} />}
                        </span>
                        {o.listing.detail && <span className="text-ui-2xs text-base-dark">{o.listing.detail}</span>}
                        {peer && (
                          <span className="text-ui-2xs text-base-dark">
                            Peer purchase on record: {peer.agency_name} paid {usd(peer.unit_price)} each in {new Date(peer.date).toLocaleDateString("en-US", { month: "long", year: "numeric" })}.
                          </span>
                        )}
                      </span>
                      <span className="text-right text-ui-2xs text-base-dark">
                        <span className="block text-lg font-bold tabular-nums text-ink">
                          {usd(o.listing.unit_price)} <span className="text-ui-3xs font-normal text-base-dark">/ {o.listing.unit}</span>
                        </span>
                        Published price
                      </span>
                    </label>
                  );
                })}
                {quoteHits.length > 0 && (
                  <label className={`flex cursor-pointer flex-wrap items-start gap-x-3.5 gap-y-2 border px-4 py-3.5 ${sel.listing_id === null ? "border-primary-darker bg-primary-lighter/40" : "border-base-lighter bg-white"}`}>
                    <input type="radio" name={`item-${requestId}`} checked={sel.listing_id === null} onChange={() => pick(null)} className="mt-0.5 h-5 w-5 accent-[#162E51]" />
                    <span className="flex min-w-0 flex-[1_1_300px] flex-col gap-1.5">
                      <span className="text-body-md font-bold text-ink">{candidates.length ? "Something else, or a specific make or model" : `${request.parsed.item}, by quote`}</span>
                      <span className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 text-ui-2xs text-base-darker">
                        <span>Through {[...new Set(quoteHits.map((h) => h.coop))].join(", ")}</span>
                        {coopRoutes.flatMap((r) => r.refs).map((n) => (
                          <RefTag key={n} n={n} />
                        ))}
                      </span>
                      <span className="text-ui-2xs text-base-dark">
                        {quoteHits.every((h) => h.products === 0) ? "No catalog items are loaded for these contracts, so there's nothing to pick from yet." : "Some of these contracts have priced products further down the page."}
                      </span>
                    </span>
                    <span className="text-right text-ui-2xs text-base-dark">
                      <span className="block text-body-md font-bold text-ink">Quote only</span>
                      No published price
                    </span>
                  </label>
                )}
              </fieldset>

              {addOns.length > 0 && (
                <fieldset className="px-5 pt-5">
                  <legend className="text-body-md font-bold text-ink">
                    Add to this order? <span className="text-ui-2xs font-normal text-base-dark">Also on this contract.</span>
                  </legend>
                  {addOns.map((l) => {
                    const q = addOnQty(l.id);
                    return (
                      <div key={l.id} className="flex min-h-[44px] flex-wrap items-center gap-x-3 gap-y-1 border-b border-dashed border-primary-light/60 py-1.5 last:border-b-0">
                        <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 text-sm text-ink">
                          <input type="checkbox" checked={q !== undefined} onChange={() => toggleAddOn(l.id)} className="h-5 w-5 accent-[#162E51]" />
                          <span className="min-w-0">
                            {l.title} <span className="font-mono text-[11px] tracking-[0.1em] text-base-dark">{l.sku}</span>
                          </span>
                        </label>
                        {q !== undefined && (
                          <label className="flex items-center gap-1.5 text-ui-2xs text-base-dark">
                            Qty
                            <input
                              type="number"
                              min={1}
                              value={q}
                              onChange={(e) => setSel((s) => ({ ...s, add_ons: s.add_ons.map((a) => (a.listing_id === l.id ? { ...a, quantity: Math.max(1, Math.floor(Number(e.target.value)) || 1) } : a)) }))}
                              className="w-20 !py-1 text-sm"
                            />
                          </label>
                        )}
                        <span className="text-sm font-semibold tabular-nums text-ink">
                          {usd(l.unit_price)} / {l.unit}
                        </span>
                      </div>
                    );
                  })}
                </fieldset>
              )}

              <div className="mt-5 flex flex-wrap items-start gap-x-8 gap-y-5 border-t border-primary-light/60 bg-primary-lighter/40 px-5 py-4">
                <div>
                  <label htmlFor={`qty-${requestId}`} className="block text-body-md font-bold text-ink">
                    How many?
                  </label>
                  <div className="mt-1.5 flex items-stretch">
                    <button type="button" aria-label="One fewer" onClick={() => setQty(sel.quantity - 1)} className="h-11 w-11 border border-base-light bg-white text-xl font-semibold text-ink">
                      −
                    </button>
                    <input
                      id={`qty-${requestId}`}
                      type="number"
                      min={1}
                      value={sel.quantity}
                      onChange={(e) => setQty(Number(e.target.value))}
                      className="-mx-px h-11 w-20 !rounded-none border border-[#162E51] !bg-[#162E51] text-center text-lg font-bold !text-white [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
                    />
                    <button type="button" aria-label="One more" onClick={() => setQty(sel.quantity + 1)} className="h-11 w-11 border border-base-light bg-white text-xl font-semibold text-ink">
                      +
                    </button>
                  </div>
                </div>
                <div className="min-w-0 flex-[1_1_320px] space-y-2.5">
                  <div>
                    {plan.lines.map((l) => (
                      <div key={l.listing_id} className="flex items-baseline gap-3 py-1 text-sm text-ink">
                        <span className="min-w-0 flex-1">
                          {l.quantity} × {l.title} <span className="font-mono text-[11px] tracking-[0.1em] text-base-dark">{l.sku}</span>
                        </span>
                        <span className="whitespace-nowrap font-semibold tabular-nums">{usd(l.amount)}</span>
                      </div>
                    ))}
                    {!plan.lines.length && (
                      <div className="py-1 text-sm text-ink">
                        {sel.quantity} × {request.parsed.item}, make and model to be quoted
                      </div>
                    )}
                    <div className="mt-1 flex items-baseline gap-3 border-t border-primary-darker pt-2 text-body-md font-bold text-ink">
                      <span className="flex-1">Total</span>
                      <span className="tabular-nums">{plan.total === null ? "Price by quote" : usd(plan.total)}</span>
                    </div>
                  </div>
                  <div>
                    <div className="relative h-3 border border-base-light bg-white" role="img" aria-label={`${plan.total === null ? "No total yet" : usd(plan.total)} against a ${usd(plan.limit)} quick-buy limit`}>
                      <div className={`h-full ${under ? "bg-primary-light" : "bg-[#162E51]"}`} style={{ width: `${pct}%` }} />
                      <span aria-hidden className="absolute -bottom-1 -top-1 left-1/3 border-l-2 border-primary-darker" />
                    </div>
                    <div className="mt-1.5 flex flex-wrap justify-between gap-x-3 gap-y-1 text-ui-2xs text-base-darker">
                      <span>Against {plan.limit_phrase}</span>
                      <span className="font-bold text-ink">{meterNote}</span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-x-5 gap-y-2.5 border-t border-base-lighter px-5 py-4">
                <button type="button" disabled={busy} onClick={confirm} className={primaryBtn}>
                  Confirm and see how to buy
                </button>
                <span className="min-w-0 flex-[1_1_260px] text-ui-2xs text-base-dark">Items, SKUs and prices come from the price lists in Agora. Your shopper matched your words to them and didn't write any of them.</span>
              </div>
            </div>

            <div className="flex items-center gap-3.5 border border-dashed border-base-light bg-white px-5 py-4">
              <span aria-hidden className="h-2.5 w-2.5 shrink-0 border-[1.5px] border-primary-light bg-white" />
              <div>
                <div className={`${label} text-base-dark`}>Step 2 of 2</div>
                <div className="text-sm text-base-darker">Your buying plan: which routes are open {results.buyer ? `to ${results.buyer.name}` : "to you"} for exactly these items, and what each one takes.</div>
              </div>
            </div>
          </>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2.5 border border-base-light bg-white px-5 py-3.5">
              <span aria-hidden className="h-2.5 w-2.5 shrink-0 bg-[#162E51]" />
              <div className="min-w-0 flex-[1_1_320px]">
                <div className={`${label} text-base-dark`}>Step 1 · confirmed</div>
                <div className="text-sm font-semibold text-ink">{plan.file.items}</div>
              </div>
              <span className="text-body-md font-bold tabular-nums text-ink">{plan.total === null ? "Price by quote" : usd(plan.total)}</span>
              <button type="button" disabled={busy} onClick={() => run(() => act("editItems", { requestId }))} className={outlineBtn}>
                Edit
              </button>
            </div>

            <div className="border border-primary-darker bg-white">
              <Band step="Your personal shopper · step 2 of 2" title="Your buying plan" working={writing} />
              <div className="space-y-2.5 px-5 pt-5">
                <h2 className="font-heading text-2xl font-bold leading-snug text-ink">{brief?.headline ?? plan.headline}</h2>
                {(brief?.paragraphs ?? [plan.summary]).map((p, i) => (
                  <p key={i} className="max-w-[68ch] text-body-md leading-relaxed text-ink">
                    <Rich text={p} />
                  </p>
                ))}
                {writing && <p className="text-ui-2xs text-base-dark">Your shopper is writing this up. The plan below is already final.</p>}
                <Feedback key={brief?.log_id} id={brief?.log_id} />
              </div>

              <div className="flex flex-wrap gap-3 px-5 py-5">
                {plan.routes.map((r, i) => (
                  <RouteCard key={r.kind} n={i + 1} route={r} plan={plan} requestId={requestId} />
                ))}
              </div>

              {plan.unknowns.length > 0 && (
                <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1.5 border-t border-base-lighter px-5 py-3.5">
                  <span className={`${label} text-base-dark`}>What I don't know</span>
                  <ul className="min-w-0 flex-[1_1_320px] space-y-1 text-sm text-ink">
                    {plan.unknowns.map((u) => (
                      <li key={u}>{u}</li>
                    ))}
                  </ul>
                </div>
              )}
              <div className="px-5 pb-4">
                <Sources plan={plan} refs={brief?.refs.length ? brief.refs : plan.routes.flatMap((r) => r.refs)} />
              </div>
            </div>
          </>
        )}
        <ErrorNote message={error} />
      </div>

      <aside className="space-y-4">
        <PurchaseFile results={results} plan={plan} confirmedAt={confirmedAt} />
        {confirmedAt && <PaperworkCard plan={plan} requestId={requestId} />}
        <AskBox plan={plan} requestId={requestId} enabled={llm} supplier={chosen?.supplier.name ?? null} />
      </aside>
    </section>
  );
}

function RouteCard({ n, route, plan, requestId }: { n: number; route: PlanRoute; plan: Plan; requestId: string }) {
  const { db, act } = useStore();
  const [state, setState] = useState<"idle" | "busy" | "done">("idle");
  const [error, setError] = useState<string | null>(null);
  const buyer = db?.session.buyer?.name;
  const hit = route.hits[0];
  const asked = state === "done" || (route.kind === "join" && Boolean(db?.referrals.some((x) => x.contract_id === hit?.contract_id && x.agency === buyer && x.request_id === requestId)));
  const kindLabel = route.kind === "priced" ? "priced" : route.kind === "member" ? "on your co-op" : route.kind === "join" ? "not open to you yet" : "co-op contracts";
  const go = async (fn: () => Promise<unknown>) => {
    setState("busy");
    setError(null);
    try {
      await fn();
      setState("done");
    } catch (e) {
      setError((e as Error).message);
      setState("idle");
    }
  };
  const first = plan.lines[0];

  return (
    <div className={`flex min-w-0 flex-[1_1_240px] flex-col gap-2.5 border px-4 py-3.5 ${route.recommended ? "border-primary-light bg-primary-lighter/40" : "border-base-lighter bg-white"}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className={`${label} text-base-darker`}>
          Route {n} · {kindLabel}
        </span>
        {route.recommended && (route.kind === "priced" ? <BestFit /> : <span className="bg-primary-lighter px-1.5 py-0.5 text-ui-3xs font-bold text-primary-darker">Start here</span>)}
      </div>
      <div className="text-body-md font-bold text-ink">{route.title}</div>
      <p className="text-sm leading-relaxed text-base-darker">{route.body}</p>
      <div className="flex flex-wrap items-center gap-2">
        {route.refs.map((x) => (
          <RefTag key={x} n={x} />
        ))}
      </div>
      <div className="mt-auto flex flex-wrap items-center gap-x-4 gap-y-1 pt-1">
        {route.kind === "priced" && (plan.payment === "pcard" || plan.payment === "po") && (
          <>
            {state === "done" ? (
              <Link href="/cart" className={textLink}>
                In your cart. Open the cart →
              </Link>
            ) : (
              <button
                type="button"
                disabled={state === "busy"}
                className={primaryBtn}
                onClick={() =>
                  go(async () => {
                    for (const l of plan.lines) await act("addToCart", { listingId: l.listing_id, quantity: l.quantity, requestId });
                  })
                }
              >
                Add to cart · {usd(plan.total ?? 0)}
              </button>
            )}
            {plan.lines.length === 1 && state !== "done" && (
              <Link href={`/checkout?listing=${first.listing_id}&qty=${first.quantity}&request=${requestId}`} className={textLink}>
                Check out now →
              </Link>
            )}
          </>
        )}
        {route.kind === "priced" && plan.payment === "coop_site" && first && (
          <Link href={`/product/${first.listing_id}?qty=${first.quantity}&request=${requestId}`} className={textLink}>
            See the product and its contract page →
          </Link>
        )}
        {route.kind === "priced" && plan.payment === "needs_contract" && (
          <Link href={`/solicitations/new?request=${requestId}`} className={textLink}>
            Build a solicitation →
          </Link>
        )}
        {(route.kind === "member" || route.kind === "coops") && (
          <a href="#coops" className={textLink}>
            See {route.hits.length === 1 ? "this contract" : "these contracts"} ↓
          </a>
        )}
        {route.kind === "member" && (
          <Link href="/quote-check" className={textLink}>
            Got a quote? Check it →
          </Link>
        )}
        {route.kind === "join" &&
          (asked ? (
            <span className="inline-flex min-h-[44px] items-center text-ui-xs font-bold text-success-darker">Sent to purchasing</span>
          ) : (
            <button type="button" disabled={state === "busy" || !hit?.eligible} className={outlineBtn} onClick={() => go(() => act("askToJoin", { contractId: hit.contract_id, requestId, fit: hit.fit }))}>
              Ask purchasing to get us on this
            </button>
          ))}
      </div>
      <ErrorNote message={error} />
    </div>
  );
}

function PurchaseFile({ results, plan, confirmedAt }: { results: Results; plan: Plan; confirmedAt: string | null }) {
  const pending = !confirmedAt;
  const rows: [string, string, boolean?][] = [
    ["Request", `“${results.request.raw_text}”${results.buyer ? `, ${results.buyer.name}, ${results.buyer.state}` : ""}`],
    [`Items · ${pending ? "not confirmed yet" : "confirmed"}`, plan.file.items, true],
    ["Options considered", `${plan.refs.length} source${plan.refs.length === 1 ? "" : "s"}, Ref${plan.refs.length === 1 ? "" : "s"} ${plan.refs.length > 1 ? `1 to ${plan.refs.length}` : "1"}`],
    ["Route", pending ? "Pending. Confirm the items first." : plan.file.route],
    ["Why", pending ? "Pending" : plan.file.why],
    ["Still needed", pending ? "Your confirmation of the items" : plan.file.needed],
  ];
  const download = () => {
    const url = URL.createObjectURL(new Blob([purchaseFileText(results, plan, confirmedAt)], { type: "text/plain" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `purchase-file-${results.request.id}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <div className="border border-base-light bg-white">
      <div className="border-b border-base-lighter px-5 pb-3 pt-4">
        <div className="font-heading text-lg font-bold text-ink">The purchase file</div>
        <Annotation className="text-base-dark">Writes itself as you shop</Annotation>
      </div>
      <dl className="px-5 pb-2 pt-1">
        {rows.map(([k, v, strong]) => (
          <div key={k} className="border-b border-dashed border-primary-light/60 py-2.5 last:border-b-0">
            <dt className={`${label} text-base-dark`}>{k}</dt>
            <dd className={`mt-0.5 text-sm text-ink ${strong ? "font-semibold" : ""}`}>{v}</dd>
          </div>
        ))}
      </dl>
      <div className="border-t border-base-lighter px-5 py-3">
        <button type="button" onClick={download} disabled={pending} className={outlineBtn}>
          Download the file
        </button>
      </div>
    </div>
  );
}

interface Turn {
  question: string;
  answer: ShopperText | null;
  status: "pending" | "done" | "failed";
}

function AskBox({ plan, requestId, enabled, supplier }: { plan: Plan; requestId: string; enabled: boolean; supplier: string | null }) {
  const { act } = useStore();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [text, setText] = useState("");
  const waiting = turns.some((t) => t.status === "pending");

  const member = plan.routes.find((r) => r.kind === "member")?.hits[0];
  const join = plan.routes.find((r) => r.kind === "join")?.hits[0];
  const suggestions = [
    plan.payment === "po" ? "Why can't we split this into two orders?" : null,
    member && join ? `Should we get on ${join.coop} for this, or use ${member.coop}?` : join ? `What would it take to use ${join.coop}?` : null,
    member ? `What does a ${member.coop} quote involve?` : null,
    supplier ? `Has ${supplier} been verified?` : null,
  ]
    .filter((s): s is string => Boolean(s) && !turns.some((t) => t.question === s))
    .slice(0, 3);

  const ask = async (question: string) => {
    const q = question.trim();
    if (!q || waiting) return;
    setText("");
    const history = turns.filter((t) => t.answer).map((t) => ({ question: t.question, answer: t.answer!.paragraphs }));
    setTurns((ts) => [...ts, { question: q, answer: null, status: "pending" }]);
    let answer: ShopperText | null = null;
    try {
      answer = await act<ShopperText | null>("askShopper", { requestId, question: q, history });
    } catch {}
    setTurns((ts) => ts.map((t) => (t.question === q && t.status === "pending" ? { ...t, answer, status: answer ? "done" : "failed" } : t)));
  };

  return (
    <div className="border border-base-light bg-white">
      <div className="px-5 pt-4">
        <Annotation className="text-base-dark">Ask your shopper</Annotation>
      </div>

      {turns.length > 0 && (
        <div className="relative mt-3 space-y-5 px-5" aria-live="polite">
          <span aria-hidden className="absolute bottom-2 left-[24px] top-2 border-l border-dashed border-primary-light" />
          {turns.map((t, i) => (
            <div key={i} className="space-y-5">
              <div className="flex items-start gap-3.5">
                <span aria-hidden className="relative mt-1 h-[9px] w-[9px] shrink-0 border-[1.5px] border-primary-light bg-white shadow-[0_0_0_5px_rgb(var(--us-white))]" />
                <div className="min-w-0 flex-1">
                  <div className={`${label} text-base-dark`}>You</div>
                  <p className="mt-1 text-sm font-semibold text-ink">{t.question}</p>
                </div>
              </div>
              <div className="flex items-start gap-3.5">
                <span aria-hidden className="relative mt-1 h-[9px] w-[9px] shrink-0 bg-[#162E51] shadow-[0_0_0_5px_rgb(var(--us-white))]" />
                <div className="min-w-0 flex-1 space-y-2">
                  <div className={`${label} text-primary`}>Your shopper</div>
                  {t.status === "pending" && (
                    <div className="flex items-center gap-2 text-sm text-base-dark">
                      <Mark className="h-5 w-5" working /> Checking the contract data
                    </div>
                  )}
                  {t.status === "failed" && <p className="text-sm text-ink">I couldn't answer that from Agora's data just now. The plan and the sources on this page still stand.</p>}
                  {t.answer?.paragraphs.map((p, j) => (
                    <p key={j} className="text-sm leading-relaxed text-ink">
                      <Rich text={p} />
                    </p>
                  ))}
                  {t.answer && <Sources plan={plan} refs={t.answer.refs} />}
                  <Feedback id={t.answer?.log_id} />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {enabled ? (
        <>
          {suggestions.length > 0 && (
            <div className="mt-3 px-5">
              {suggestions.map((s) => (
                <button key={s} type="button" disabled={waiting} onClick={() => ask(s)} className="flex min-h-[44px] w-full items-center justify-between gap-3 border-t border-base-lighter text-left text-sm font-semibold text-primary hover:text-primary-dark disabled:opacity-60">
                  <span>{s}</span>
                  <span aria-hidden>→</span>
                </button>
              ))}
            </div>
          )}
          <div className="border-t border-base-lighter px-6 pb-3 pt-5">
            <TickFrame>
              <form
                className="flex border border-primary-darker bg-white"
                onSubmit={(e) => {
                  e.preventDefault();
                  void ask(text);
                }}
              >
                <label htmlFor={`ask-${requestId}`} className="sr-only">
                  Ask your shopper
                </label>
                <input id={`ask-${requestId}`} type="text" value={text} onChange={(e) => setText(e.target.value)} maxLength={500} placeholder="Ask about a supplier or a co-op" className="h-11 min-w-0 flex-1 !rounded-none !border-0 bg-transparent px-3.5 text-sm text-ink !shadow-none outline-none" />
                <button type="submit" disabled={waiting || !text.trim()} className="h-11 bg-[#162E51] px-4 text-sm font-bold text-white disabled:opacity-60">
                  Ask →
                </button>
              </form>
            </TickFrame>
          </div>
        </>
      ) : (
        <p className="mt-2 px-5 text-sm text-base-darker">Questions are answered by Claude and need the AI connection, which is off. The plan and the purchase file are rule-based and work without it.</p>
      )}
      <p className="px-5 pb-4 pt-1 text-ui-3xs leading-relaxed text-base-dark">Your shopper works only from Agora's contract data and shows its sources. It never guesses a price or decides on its own which contracts you can use.</p>
    </div>
  );
}

/** Documents drafted from the purchase file. The requester edits, then copies or downloads; nothing is sent from here. */
function PaperworkCard({ plan, requestId }: { plan: Plan; requestId: string }) {
  const { act } = useStore();
  const [doc, setDoc] = useState<Paperwork | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState<PaperworkKind | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const draft = async (kind: PaperworkKind) => {
    setBusy(kind);
    setError(null);
    try {
      const d = await act<Paperwork>("draftPaperwork", { requestId, kind });
      setDoc(d);
      setText(d.text);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  const download = () => {
    const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${(doc?.title ?? "draft").toLowerCase().replace(/[^a-z0-9]+/g, "-")}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="border border-base-light bg-white">
      <div className="border-b border-base-lighter px-5 pb-3 pt-4">
        <div className="font-heading text-lg font-bold text-ink">Paperwork</div>
        <Annotation className="text-base-dark">Drafted from the purchase file</Annotation>
      </div>
      <div className="px-5 pt-1">
        {paperworkKinds(plan).map((k) => (
          <button key={k} type="button" disabled={busy !== null} onClick={() => draft(k)} className="flex min-h-[44px] w-full items-center justify-between gap-3 border-b border-base-lighter text-left text-sm font-semibold text-primary last:border-b-0 hover:text-primary-dark disabled:opacity-60">
            <span>{busy === k ? "Drafting" : `Draft the ${PAPERWORK_LABEL[k].charAt(0).toLowerCase()}${PAPERWORK_LABEL[k].slice(1)}`}</span>
            <span aria-hidden>→</span>
          </button>
        ))}
      </div>
      <div className="px-5 pb-1">
        <ErrorNote message={error} />
      </div>
      {doc && (
        <div className="space-y-2.5 border-t border-base-lighter px-5 py-4">
          <label htmlFor={`paperwork-${requestId}`} className="block text-sm font-bold text-ink">
            {doc.title}
          </label>
          <textarea id={`paperwork-${requestId}`} value={text} onChange={(e) => setText(e.target.value)} rows={16} className="w-full font-mono text-[12px] leading-relaxed" />
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <button
              type="button"
              className={outlineBtn}
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(text);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1800);
                } catch {}
              }}
            >
              {copied ? "Copied" : "Copy"}
            </button>
            <button type="button" className={textLink} onClick={download}>
              Download →
            </button>
          </div>
          <p className="text-ui-3xs leading-relaxed text-base-dark">
            {doc.written_by === "llm" ? "Worded by your shopper from the purchase file; every figure and contract number was checked against it." : "Filled in from the purchase file."} Fill the [bracketed] blanks and read it before you send it. Agora doesn't send it for you.
          </p>
          <Feedback key={doc.log_id} id={doc.log_id} />
        </div>
      )}
    </div>
  );
}
