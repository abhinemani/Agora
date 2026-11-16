"use client";

// The homepage's guided search. A request opens here instead of jumping to a results page: Loci asks who is
// buying and how many, then narrows a shortlist of real products with the product dive's questions. Each card
// shows how an order of that size would be bought, and a way out (a quote under a contract, informal quotes or a
// solicitation) stays in view. Picking a product opens its route in place; the results page is one click away.

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { BuyerPicker } from "./BuyerPicker";
import { Mark } from "./blueprint";
import { Arrow } from "./icons";
import { post, useStore } from "./store";
import { ErrorNote } from "./ui";
import { Feedback } from "./Feedback";
import { FitLine, SetAside, SpecLine } from "./FitLine";
import { specText } from "@/lib/specs";
import { goHref } from "@/lib/coops";
import type { DiveFilter, DiveItem, DiveQuestion, DiveState } from "@/lib/dive";
import { offRamp, routeFor, ROUTE_LABEL, toSearch, type FrontDoorUrl, type OffRampPath, type Route } from "@/lib/front-door";
import type { Request } from "@/lib/types";

const label = "font-mono text-[11px] uppercase tracking-[0.14em]";
const linkBtn = "inline-flex min-h-[44px] items-center text-ui-xs font-bold text-primary hover:text-primary-dark disabled:opacity-60";
const primaryBtn = "inline-flex min-h-[44px] items-center rounded-md bg-primary px-4 text-ui-xs font-bold leading-none text-white no-underline hover:bg-primary-dark disabled:opacity-60";
const outlineBtn =
  "inline-flex min-h-[44px] items-center rounded-md bg-white px-4 text-ui-xs font-bold leading-none text-primary no-underline shadow-[inset_0_0_0_2px_theme(colors.primary.DEFAULT)] hover:text-primary-dark disabled:opacity-60";
const usd = (n: number) => `$${n.toLocaleString("en-US", { maximumFractionDigits: n < 100 ? 2 : 0 })}`;
const chip = (f: DiveFilter) =>
  f.kind === "price" ? (f.min === undefined ? `Up to ${usd(f.max!)}` : f.max === undefined ? `${usd(f.min)} and up` : `${usd(f.min)} to ${usd(f.max)}`) : f.kind === "word" ? f.value : f.kind === "not_word" ? `Not ${f.value}` : f.kind === "maker" ? f.value : f.kind === "usable" ? "Can buy today" : f.kind === "spec" ? specText(f.key, f.value) : "Has a price";
const QUANTITIES = [1, 10, 25, 50, 100];

interface Context {
  limit: number;
  limit_is_theirs: boolean;
  rule: { state: string; quotes: string; formal_bid: string; source: string; researched: string } | null;
}
interface DiveResponse {
  state: DiveState;
  said: string;
  quantity: { value: number; stated: boolean } | null;
  context: Context;
  /** The model hasn't judged every product on the shortlist yet: ask again with judge: true for the rest. */
  fit_pending?: boolean;
}
interface Turn {
  who: "you" | "loci";
  text: string;
}

const ROUTE_TONE: Record<Route, string> = {
  pcard: "border-success-dark text-success-darker",
  po: "border-warning-dark bg-warning-lighter text-warning-darker",
  quote: "border-primary-darker text-primary-darker",
};
function RoutePill({ route }: { route: Route }) {
  return <span className={`border px-1.5 py-1 font-mono text-[10.5px] font-bold uppercase leading-none tracking-[0.1em] ${ROUTE_TONE[route]}`}>{ROUTE_LABEL[route]}</span>;
}

const STAGES = ["Describe", "Narrow", "Route", "Plan"] as const;
function Stages({ at }: { at: 1 | 2 }) {
  return (
    <ol aria-label="Steps" className="flex font-mono text-[10.5px] font-bold uppercase leading-none tracking-[0.12em]">
      {STAGES.map((s, i) => (
        <li
          key={s}
          aria-current={i === at ? "step" : undefined}
          className={`-ml-px border px-2.5 py-2 first:ml-0 ${i === at ? "border-white bg-white text-[#0F3D73]" : i < at ? "border-[rgba(255,255,255,0.35)] text-white" : "border-[rgba(255,255,255,0.35)] text-[#BFD5EE]"}`}
        >
          {i < at ? "✓ " : ""}
          {s}
        </li>
      ))}
    </ol>
  );
}

export function FrontDoor({ initial, onNewSearch }: { initial: FrontDoorUrl; onNewSearch: (need: string | null) => void }) {
  const router = useRouter();
  const { db, act, llm } = useStore();
  const buyer = db?.session.buyer ?? null;
  const [need, setNeed] = useState(initial.need);
  const [draft, setDraft] = useState(initial.need);
  const [state, setState] = useState<DiveState | null>(null);
  const [ctx, setCtx] = useState<Context | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [qty, setQty] = useState<number | null>(initial.quantity ?? null);
  const [qtyStated, setQtyStated] = useState(Boolean(initial.quantity));
  const [qtyDraft, setQtyDraft] = useState("");
  const [skipped, setSkipped] = useState<string[]>([]);
  const [agencySkipped, setAgencySkipped] = useState(false);
  const [picked, setPicked] = useState<DiveItem | null>(null);
  const [rampOpen, setRampOpen] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);
  // The model's fit judgment arrives after the shortlist; this holds which shortlist it was asked about.
  const [judging, setJudging] = useState(false);
  const latest = useRef<string | null>(null);

  const say = (who: Turn["who"], t: string) => setTurns((ts) => [...ts, { who, text: t }]);

  // The address keeps the shortlist, so refresh, back and a shared link come back to it. Replaced, not pushed:
  // the back button leaves the guided search rather than undoing one answer at a time.
  const remember = useCallback(
    (s: DiveState, n: number | null) => {
      window.history.replaceState(window.history.state, "", `/${toSearch({ need, query: s.query, filters: s.filters, quantity: n ?? undefined })}`);
    },
    [need],
  );

  const summary = (s: DiveState) =>
    s.matched === 0
      ? "Nothing on the shortlist fits all of that. Remove an answer to widen it."
      : `${s.matched === s.pool ? `${s.pool}` : `${s.matched} of ${s.pool}`} product${s.pool === 1 ? "" : "s"} on contract for “${s.query}”${s.price_range && s.matched > 1 ? `, from ${usd(s.price_range.min)} to ${usd(s.price_range.max)} each` : ""}.`;

  /** Opens the results page for this request: the old homepage path, kept one click away. */
  const openRequest = async (opts: { hash?: string; to?: (id: string) => string; listingId?: string | null; offeringId?: string | null } = {}) => {
    setLeaving(true);
    setError(null);
    try {
      // The quantity chosen here goes into the request's own words when the buyer didn't type one.
      const words = qty && qty > 1 && !qtyStated ? `${qty} ${need}` : need;
      const { request, needsPreference } = await act<{ request: Request; needsPreference: boolean }>("createRequest", { text: words });
      if (opts.listingId) {
        // Loci's own listings can be confirmed, so the results page opens on the buying plan. If the results don't
        // offer this listing for the request, the page opens on the confirm step instead.
        await act("confirmPick", { requestId: request.id, listingId: opts.listingId, quantity: qty ?? request.parsed.quantity }).catch(() => undefined);
      } else if (opts.offeringId) {
        // A co-op or state contract product goes into the purchase file as picked, so the page opens on its route.
        await act("pickOffering", { requestId: request.id, offeringId: opts.offeringId, quantity: qty ?? request.parsed.quantity }).catch(() => undefined);
      }
      router.push(opts.to ? opts.to(request.id) : `/request/${request.id}${needsPreference ? "?ask=1" : ""}${opts.hash ? `#${opts.hash}` : ""}`);
    } catch (e) {
      setError((e as Error).message);
      setLeaving(false);
    }
  };

  const turn = async (body: Record<string, unknown>, mine?: string) => {
    setBusy(true);
    setError(null);
    // A judgment still in flight is about the shortlist before this turn: it must not overwrite what this turn shows.
    latest.current = null;
    setJudging(false);
    if (mine) say("you", mine);
    try {
      const res = await post<DiveResponse>("/api/act", { action: "dive", ...body });
      // A request with no product anywhere in the catalog goes to the results page, which covers contracts and solicitations.
      if (body.need && res.state.pool === 0) return void (await openRequest());
      setState(res.state);
      setCtx(res.context);
      let n = qty;
      if (res.quantity?.stated) {
        n = res.quantity.value;
        setQty(n);
        setQtyStated(true);
      }
      remember(res.state, n);
      say("loci", [res.said, summary(res.state)].filter(Boolean).join(" "));
      // The shortlist shows at once; the model's fit judgment follows and reorders it, unless the buyer has moved on.
      if (res.fit_pending) {
        const asked = JSON.stringify([res.state.query, res.state.filters]);
        latest.current = asked;
        setJudging(true);
        void post<DiveResponse>("/api/act", { action: "dive", query: res.state.query, filters: res.state.filters, judge: true })
          .then((j) => {
            if (latest.current === asked) setState(j.state);
          })
          .catch(() => undefined)
          .finally(() => latest.current === asked && setJudging(false));
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    say("you", initial.need);
    void (initial.query ? turn({ query: initial.query, filters: initial.filters ?? [], judge: false }) : turn({ need: initial.need, judge: false }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Choosing a product moves to the route step; the buyer usually clicked far down the shortlist, so bring the step into view.
  useEffect(() => {
    if (!picked) return;
    const smooth = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    requestAnimationFrame(() => document.getElementById("route-stage")?.scrollIntoView({ behavior: smooth ? "smooth" : "auto", block: "start" }));
  }, [picked]);

  const narrow = (filters: DiveFilter[], mine: string) => state && turn({ query: state.query, filters, judge: false }, mine);
  const send = () => {
    if (!state || !text.trim() || busy) return;
    const m = text.trim();
    setText("");
    void turn({ query: state.query, filters: state.filters, message: m, judge: false }, m);
  };
  const setQuantity = (n: number) => {
    setQty(n);
    say("you", `${n.toLocaleString()} ${n === 1 ? "unit" : "units"}`);
    if (state) remember(state, n);
  };

  // The current question: who is buying, then how many, then the product dive's own questions.
  type Ask = { kind: "agency" } | { kind: "quantity" } | { kind: "dive"; q: DiveQuestion };
  const diveQ = state?.questions.find((q) => !skipped.includes(q.id));
  const ask: Ask | null = !state || picked ? null : !buyer && !agencySkipped ? { kind: "agency" } : qty == null ? { kind: "quantity" } : diveQ ? { kind: "dive", q: diveQ } : null;

  const n = qty ?? 1;
  const limit = ctx?.limit ?? db?.agency.quick_buy_threshold ?? 10_000;
  const ramp = state ? offRamp(state, n, limit) : null;
  const topFit = Math.max(0, ...(state?.items ?? []).map((i) => i.fit));
  const bestId = [...(state?.items ?? [])].filter((i) => i.usable && i.price != null && i.fit >= topFit - 10).sort((x, y) => x.price! - y.price!)[0]?.id;
  const rampLoud = Boolean(ramp?.loud);

  const question = (where: "panel" | "sheet") => {
    if (!ask || busy) return null;
    const sheet = where === "sheet";
    const title = ask.kind === "agency" ? "Who's buying?" : ask.kind === "quantity" ? "How many do you need?" : ask.q.text;
    const why =
      ask.kind === "agency"
        ? "The agency decides which contracts are open to it: its state's law and the co-ops it belongs to."
        : ask.kind === "quantity"
          ? `The total decides how it's bought: a P-card under ${usd(limit)}, a purchase order at or over it.`
          : ask.q.why;
    const optBtn = sheet
      ? "flex min-h-[44px] shrink-0 items-center gap-2 border border-base-light bg-white px-3 text-left text-sm font-semibold text-ink hover:border-primary-darker"
      : "-mt-px flex min-h-[44px] items-center justify-between gap-3 border border-base-light bg-white px-3.5 text-left text-sm font-semibold text-ink hover:border-primary-darker hover:bg-primary-lighter/40";
    return (
      <div className={sheet ? "" : "border-t border-base-lighter px-5 py-4"}>
        <div className="text-body-md font-bold text-ink">{title}</div>
        <p className="mt-0.5 text-ui-2xs text-base-dark">{why}</p>
        {ask.kind === "agency" ? (
          <div className="mt-3">
            <p className="text-ui-2xs text-base-darker">{sheet ? "Choose the agency above the shortlist, or skip." : "Choose the agency beside this panel, above the shortlist."}</p>
          </div>
        ) : (
          <div className={sheet ? "-mx-1 mt-2 flex gap-1.5 overflow-x-auto px-1 pb-1" : "mt-3 flex flex-col"}>
            {ask.kind === "quantity"
              ? QUANTITIES.map((q) => (
                  <button key={q} type="button" onClick={() => setQuantity(q)} className={optBtn}>
                    <span>{q.toLocaleString()}</span>
                    {state?.pay_range && <span className="text-ui-2xs font-normal tabular-nums text-base-dark">{q === 1 ? `${usd(state.pay_range.min)} and up` : `from ${usd(state.pay_range.min * q)}`}</span>}
                  </button>
                ))
              : ask.q.options.map((o) => (
                  <button key={o.label} type="button" onClick={() => narrow([...state!.filters, o.filter], o.label)} className={optBtn}>
                    <span>{o.label}</span>
                    <span className="text-ui-2xs font-normal tabular-nums text-base-dark">{o.count}</span>
                  </button>
                ))}
          </div>
        )}
        {ask.kind === "quantity" && !sheet && (
          <form
            className="mt-2 flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              const v = Math.floor(Number(qtyDraft));
              if (v >= 1 && v <= 100_000) setQuantity(v);
            }}
          >
            <label htmlFor="fd-qty" className="sr-only">
              Another quantity
            </label>
            <input id="fd-qty" type="number" min={1} max={100000} value={qtyDraft} onChange={(e) => setQtyDraft(e.target.value)} placeholder="Another number" className="h-11 w-36 !rounded-none border border-base-light px-3 text-sm" />
            <button type="submit" className={outlineBtn}>
              Use it
            </button>
          </form>
        )}
        <div className="mt-1 flex flex-wrap gap-x-5">
          <button
            type="button"
            onClick={() => (ask.kind === "agency" ? setAgencySkipped(true) : ask.kind === "quantity" ? setQuantity(1) : setSkipped((s) => [...s, ask.q.id]))}
            className={linkBtn}
          >
            {ask.kind === "agency" ? "Skip: show every contract" : ask.kind === "quantity" ? "Just one" : "Skip this question"} →
          </button>
          {sheet && (
            <a href="#none-fit" onClick={() => setRampOpen(true)} className={linkBtn}>
              None of these fit ↓
            </a>
          )}
        </div>
      </div>
    );
  };

  const working = busy || leaving;
  const ref = (path: OffRampPath) => ramp?.recommended === path;

  return (
    <div className={`pb-8 ${ask && ask.kind !== "agency" ? "max-lg:pb-56" : ""}`}>
      {/* The hero, folded into the request: the words stay editable, and the steps say where the buyer is. */}
      <section className="relative -mt-8 mx-[calc(50%-50vw)] bg-[#0F3D73] px-5 py-5 [background-image:linear-gradient(rgba(255,255,255,0.06)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.06)_1px,transparent_1px)] [background-size:16px_16px]">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-5 gap-y-3">
          <form
            className="flex min-w-0 flex-[1_1_420px] bg-white focus-within:outline focus-within:outline-4 focus-within:outline-focus"
            onSubmit={(e) => {
              e.preventDefault();
              if (draft.trim() && draft.trim() !== need) onNewSearch(draft.trim());
            }}
          >
            <label htmlFor="fd-need" className="sr-only">
              What are you looking to buy?
            </label>
            <input
              id="fd-need"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              className="min-w-0 flex-1 !border-0 !bg-white px-4 py-3 text-body-sm font-semibold !text-[#1B1B1B] !shadow-none !outline-none"
            />
            <button type="submit" disabled={working || draft.trim() === need} className="shrink-0 bg-[#13294B] px-4 text-ui-xs font-bold text-white disabled:opacity-60">
              Search again
            </button>
          </form>
          <Stages at={picked ? 2 : 1} />
          <button type="button" disabled={working} onClick={() => openRequest()} className="inline-flex min-h-[44px] items-center gap-1 text-ui-xs font-bold text-white hover:underline disabled:opacity-60">
            See full results <Arrow className="h-4 w-4" />
          </button>
        </div>
      </section>

      <div className="mt-6">
        <ErrorNote message={error} />
      </div>

      <div className="mt-2 grid items-start gap-6 lg:grid-cols-[minmax(0,360px)_minmax(0,1fr)]">
        {/* The conversation: what was asked and answered, and the current question. On a phone the question moves to a sheet. */}
        <section aria-label="Conversation" className="border border-base-light bg-white max-lg:order-2">
          <div className="relative space-y-4 px-5 pt-5" aria-live="polite">
            <span aria-hidden className="absolute bottom-2 left-[24px] top-7 border-l border-dashed border-primary-light" />
            {turns.map((t, i) => (
              <div key={i} className="flex items-start gap-3.5">
                <span aria-hidden className={`relative mt-1 h-[9px] w-[9px] shrink-0 shadow-[0_0_0_5px_rgb(var(--us-white))] ${t.who === "you" ? "border-[1.5px] border-primary-light bg-white" : "bg-[#162E51]"}`} />
                <div className="min-w-0 flex-1">
                  <div className={`${label} ${t.who === "you" ? "text-base-dark" : "text-primary"}`}>{t.who === "you" ? (i === 0 ? "Request" : "Answer") : "Loci"}</div>
                  <p className={`mt-1 text-sm leading-relaxed text-ink ${t.who === "you" ? "font-semibold" : ""}`}>{t.text}</p>
                </div>
              </div>
            ))}
            {working && (
              <div className="flex items-center gap-2 pb-2 pl-6 text-sm text-base-dark">
                <Mark className="h-5 w-5" working /> {leaving ? "Opening the request" : "Checking the catalog"}
              </div>
            )}
          </div>

          <div className="hidden lg:block">{question("panel")}</div>

          {state && !picked && (
            <div className="mt-2 border-t border-base-lighter px-5 pb-4 pt-4">
              <form
                className="flex border border-primary-darker bg-white"
                onSubmit={(e) => {
                  e.preventDefault();
                  send();
                }}
              >
                <label htmlFor="fd-say" className="sr-only">
                  Narrow the shortlist
                </label>
                <input
                  id="fd-say"
                  type="text"
                  value={text}
                  maxLength={300}
                  onChange={(e) => setText(e.target.value)}
                  placeholder="Add a budget, a make, a size"
                  className="h-11 min-w-0 flex-1 !rounded-none !border-0 bg-transparent px-3.5 text-sm text-ink !shadow-none outline-none"
                />
                <button type="submit" disabled={busy || !text.trim()} className="h-11 bg-[#162E51] px-4 text-sm font-bold text-white disabled:opacity-60">
                  Narrow →
                </button>
              </form>
              <p className="mt-2 text-ui-3xs leading-relaxed text-base-dark">
                Products, prices and who can buy them come from Loci's catalog and contract records.{" "}
                {llm ? "Typed messages are read by the AI and checked against the shortlist." : "Typed messages are read by simple rules: a budget, or a word from a product's name."}
              </p>
            </div>
          )}
        </section>

        <section aria-label="Shortlist" className="min-w-0 space-y-3 max-lg:order-1">
          {!state && working && <div className="border border-dashed border-base-light bg-white px-5 py-8 text-sm text-base-darker">Reading the request and checking the catalog.</div>}

          {/* The agency picker needs the wide column: it lists the agencies as cards. */}
          {ask?.kind === "agency" && !busy && (
            <div className="border border-primary-darker bg-white p-4">
              <div className="text-body-md font-bold text-ink">Who's buying?</div>
              <div className="mt-3">
                <BuyerPicker compact onDone={(b) => b && state && void turn({ query: state.query, filters: state.filters, judge: false }, `Buying for ${b.name}, ${b.state}`)} />
              </div>
              <button type="button" onClick={() => setAgencySkipped(true)} className={`${linkBtn} lg:hidden`}>
                Skip: show every contract →
              </button>
            </div>
          )}

          {state && picked && <RouteStage item={picked} quantity={n} limit={limit} limitIsTheirs={Boolean(ctx?.limit_is_theirs)} busy={working} onBack={() => setPicked(null)} onPlan={openRequest} />}

          {state && !picked && (
            <>
              {rampLoud && ramp && <OffRampPanel id="none-fit" ramp={ramp} state={state} quantity={n} limit={limit} ctx={ctx} busy={working} onOpen={openRequest} isRec={ref} />}

              {state.reading?.read_as && (
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-l-4 border-primary bg-white px-3 py-2 text-ui-2xs text-base-darker">
                  <span>
                    <span className="font-bold text-ink">Read as:</span> {state.reading.read_as}
                  </span>
                  <Feedback id={state.reading.log_id} className="ml-auto" />
                </div>
              )}
              <div className="flex flex-wrap items-center gap-2">
                <span className={`${label} text-base-dark`}>
                  {state.matched} of {state.pool} match
                </span>
                {judging && <span className="text-ui-3xs text-base-dark">Checking how each one fits…</span>}
                {buyer && (
                  <span className="inline-flex min-h-[32px] items-center bg-primary-lighter px-2 text-ui-2xs font-bold text-primary-darker" title="Change the agency from the account menu">
                    {buyer.name}, {buyer.state}
                  </span>
                )}
                {qty != null && (
                  <button type="button" onClick={() => (setQty(null), setQtyStated(false))} className="inline-flex min-h-[32px] items-center gap-1.5 border border-dashed border-primary-light bg-white px-2 text-ui-2xs font-bold text-primary-darker" aria-label={`Change the quantity, ${qty}`}>
                    {qty.toLocaleString()} {qtyStated && turns.length < 3 ? "· from the request" : ""} <span aria-hidden>×</span>
                  </button>
                )}
                {state.filters.map((f, i) => (
                  <button
                    key={i}
                    type="button"
                    disabled={busy}
                    onClick={() => narrow(state.filters.filter((_, j) => j !== i), `Remove “${chip(f)}”`)}
                    className="inline-flex min-h-[32px] items-center gap-1.5 bg-primary-lighter px-2 text-ui-2xs font-bold text-primary-darker"
                    aria-label={`Remove ${chip(f)}`}
                  >
                    {chip(f)} <span aria-hidden>×</span>
                  </button>
                ))}
              </div>

              {state.items.map((i) => {
                const total = i.price != null ? i.price * n : null;
                const route = routeFor(total, limit);
                return (
                  <article key={i.id} className={`grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-2 border border-base-lighter px-4 py-3.5 ${i.fit_verdict === "no" ? "bg-base-lightest" : "bg-white"}`}>
                    <div className="flex min-w-0 flex-col gap-1.5">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="text-body-md font-bold text-ink">{i.name}</span>
                        {i.id === bestId && state.matched > 1 && <span className="bg-primary-lighter px-1.5 py-0.5 text-ui-3xs font-bold text-primary-darker">{buyer ? "Lowest price this agency can buy" : "Lowest price on the shortlist"}</span>}
                      </span>
                      <span className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-ui-2xs text-base-darker">
                        {i.sku && <span className="border border-base-light bg-white px-1.5 py-px font-mono text-[11px] tracking-[0.1em]">{i.sku}</span>}
                        <span>{i.supplier}</span>
                        <span>
                          {i.program} {i.contract_number}
                        </span>
                        {i.routes > 1 && <span>{i.routes} contracts sell it</span>}
                      </span>
                      <SpecLine specs={i.specs} />
                      <span className={`text-ui-2xs ${i.usable ? "text-success-darker" : "text-base-dark"}`}>{i.access}</span>
                      {i.fit_verdict && <FitLine verdict={i.fit_verdict} reason={i.fit_reason} />}
                    </div>
                    <div className="text-right text-ui-2xs text-base-dark">
                      <div className="text-lg font-bold tabular-nums text-ink">
                        {i.price != null ? usd(i.price) : i.list != null ? `List ${usd(i.list)}` : "No price"}
                        {(i.price ?? i.list) != null && i.unit && <span className="text-ui-3xs font-normal text-base-dark"> / {i.unit}</span>}
                      </div>
                      <div className="max-w-[16rem]">{i.price_note}</div>
                    </div>
                    <div className="col-span-2 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-dashed border-base-lighter pt-2 text-ui-2xs text-base-darker">
                      <RoutePill route={route} />
                      <span>
                        {total != null ? (
                          <>
                            {n > 1 && `${n.toLocaleString()} × ${usd(i.price!)} = `}
                            <strong className="tabular-nums text-ink">{usd(total)}</strong>
                            {route === "pcard" ? `, under the ${usd(limit)} quick-buy limit` : `, ${total === limit ? "at" : `${usd(total - limit)} over`} the ${usd(limit)} quick-buy limit`}
                          </>
                        ) : (
                          "The total comes from the supplier's quote."
                        )}
                      </span>
                      <button type="button" disabled={working} onClick={() => setPicked(i)} className={`${linkBtn} ml-auto`}>
                        Choose this one →
                      </button>
                    </div>
                  </article>
                );
              })}
              {state.matched > state.items.length && <p className="text-ui-2xs text-base-dark">Showing the top {state.items.length}. Answer another question to narrow the other {state.matched - state.items.length}.</p>}
              <SetAside items={state.set_aside ?? []} />
              {state.fit_log && (
                <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-ui-3xs text-base-dark">
                  <span>Fit is judged by AI from each product's name and kind. Prices and who can buy come from the contracts.</span>
                  <Feedback id={state.fit_log} />
                </p>
              )}

              {ramp && !rampLoud &&
                (rampOpen ? (
                  <OffRampPanel id="none-fit" ramp={ramp} state={state} quantity={n} limit={limit} ctx={ctx} busy={working} onOpen={openRequest} isRec={ref} />
                ) : (
                  <div id="none-fit" className="flex flex-wrap items-center justify-between gap-3 border border-dashed border-primary-darker bg-white px-4 py-3 text-sm text-ink">
                    <span>
                      <strong>Not seeing the right one?</strong>{" "}
                      {ramp.total
                        ? `At ${n.toLocaleString()} ${n === 1 ? "unit" : "units"} this is a ${usd(ramp.total.min)}${ramp.total.max > ramp.total.min ? ` to ${usd(ramp.total.max)}` : ""} purchase.`
                        : "Nothing here has a price on file."}{" "}
                      Loci can start a quote request or a solicitation.
                    </span>
                    <button type="button" onClick={() => setRampOpen(true)} className={linkBtn}>
                      See the options ↓
                    </button>
                  </div>
                ))}
            </>
          )}

          {state && (
            <button type="button" onClick={() => onNewSearch(null)} className={linkBtn}>
              ← Start a new search
            </button>
          )}
        </section>
      </div>

      {/* The question at the thumb, on a phone. */}
      {ask && ask.kind !== "agency" && !busy && (
        <div className="fixed inset-x-0 bottom-0 z-30 max-h-[45vh] overflow-y-auto border-t-2 border-[#162E51] bg-white px-4 pb-[max(12px,env(safe-area-inset-bottom))] pt-3 shadow-[0_-4px_16px_rgba(0,0,0,0.12)] lg:hidden">
          {question("sheet")}
        </div>
      )}
    </div>
  );
}

/** The way out when nothing on the shortlist fits: three paths, least work first, with the recommended one marked. */
function OffRampPanel({
  id,
  ramp,
  state,
  quantity,
  limit,
  ctx,
  busy,
  onOpen,
  isRec,
}: {
  id: string;
  ramp: NonNullable<ReturnType<typeof offRamp>>;
  state: DiveState;
  quantity: number;
  limit: number;
  ctx: Context | null;
  busy: boolean;
  onOpen: (o?: { hash?: string; to?: (id: string) => string }) => void;
  isRec: (p: OffRampPath) => boolean;
}) {
  // The meter's scale: the limit sits at a fifth of the way when totals are small, and the range is drawn to the same scale.
  const top = Math.max(limit * 5, ramp.total ? ramp.total.max * 1.1 : 0);
  const at = (v: number) => `${Math.min(100, (v / top) * 100).toFixed(1)}%`;
  const quote = state.by_quote.filter((c) => c.usable).slice(0, 3);
  const path = (p: OffRampPath) => `flex min-w-0 flex-col gap-2 px-4 py-3.5 ${isRec(p) ? "bg-primary-lighter/50 shadow-[inset_0_3px_0_#162E51]" : ""}`;
  return (
    <section id={id} aria-labelledby={`${id}-h`} className="scroll-mt-24 border border-primary-darker bg-white">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-base-lighter px-4 py-3">
        <h2 id={`${id}-h`} className="font-heading text-lg font-bold text-ink">
          {state.matched === 0 ? "Nothing fits? Three ways to buy it anyway" : "None of these fit? Three ways to buy it anyway"}
        </h2>
        <span className={`${label} text-base-dark`}>
          {quantity.toLocaleString()} × {state.query}
        </span>
      </div>
      {ramp.total && (
        <div className="px-4 pb-2 pt-3">
          <div className={`${label} text-base-dark`}>Estimated total, from the typical prices on the shortlist</div>
          <div className="relative mt-7 h-2.5 bg-base-lightest" role="img" aria-label={`Estimated total ${usd(ramp.total.min)} to ${usd(ramp.total.max)}; quick-buy limit ${usd(limit)}`}>
            <span className="absolute inset-y-0 left-0 bg-success-lighter" style={{ width: at(limit) }} />
            <span className="absolute -top-6 -translate-x-1/2 whitespace-nowrap font-mono text-[10px] text-base-dark" style={{ left: at(limit) }}>
              {usd(limit)} quick-buy
            </span>
            <span className="absolute -top-2 h-[18px] border-l border-base-dark" style={{ left: at(limit) }} />
            <span className="absolute -top-[3px] h-4 min-w-[3px] border-2 border-[#162E51] bg-[rgba(22,46,81,0.12)]" style={{ left: at(ramp.total.min), width: `calc(${at(ramp.total.max)} - ${at(ramp.total.min)})` }} />
          </div>
          <p className="mt-2 text-ui-2xs tabular-nums text-base-darker">
            {usd(ramp.total.min)}
            {ramp.total.max > ramp.total.min && ` to ${usd(ramp.total.max)}`} for {quantity.toLocaleString()}. {ramp.because}
          </p>
        </div>
      )}
      {!ramp.total && <p className="px-4 pt-3 text-ui-2xs text-base-darker">{ramp.because}</p>}
      <div className="mt-2 grid border-t border-base-lighter md:grid-cols-3 md:divide-x md:divide-base-lighter max-md:divide-y max-md:divide-base-lighter">
        <div className={path("contract_quote")}>
          {isRec("contract_quote") && <span className={`${label} text-primary`}>Recommended</span>}
          <h3 className="text-body-sm font-bold text-ink">Ask a contract supplier for a quote</h3>
          <p className="text-ui-2xs text-base-darker">
            {quote.length
              ? `${quote.length === 1 ? "This contract sells" : "These contracts sell"} a match with no price on file. A quote under a contract needs no new solicitation.`
              : "Contracts that cover this kind of purchase are on the results page, with what each one's documents say."}
          </p>
          {quote.length > 0 && (
            <ul className="space-y-1 text-ui-2xs">
              {quote.map((c) => (
                <li key={c.contract_id}>
                  <Link href={`/contracts/${c.contract_id}`} className="font-bold text-primary hover:text-primary-dark">
                    {c.program} {c.contract_number}
                  </Link>{" "}
                  <span className="text-base-dark">· {c.supplier}</span>
                </li>
              ))}
            </ul>
          )}
          <button type="button" disabled={busy} onClick={() => onOpen({ hash: "coops" })} className={`mt-auto self-start ${isRec("contract_quote") ? primaryBtn : outlineBtn}`}>
            See the contracts
          </button>
        </div>
        <div className={path("informal_quotes")}>
          {isRec("informal_quotes") && <span className={`${label} text-primary`}>Recommended</span>}
          <h3 className="text-body-sm font-bold text-ink">Get quotes from a few suppliers</h3>
          <p className="text-ui-2xs text-base-darker">For a make or size no contract carries. The purchase file records the request, and the plan drafts the paperwork.</p>
          {ctx?.rule && (
            <p className="text-ui-3xs text-base-dark">
              {ctx.rule.state} quotes: {ctx.rule.quotes}. Source: {ctx.rule.source}.
            </p>
          )}
          <button type="button" disabled={busy} onClick={() => onOpen({ hash: "purchase-file" })} className={`mt-auto self-start ${isRec("informal_quotes") ? primaryBtn : outlineBtn}`}>
            Start the purchase file
          </button>
        </div>
        <div className={path("solicitation")}>
          {isRec("solicitation") && <span className={`${label} text-primary`}>Recommended</span>}
          <h3 className="text-body-sm font-bold text-ink">Draft a solicitation</h3>
          <p className="text-ui-2xs text-base-darker">Starts from the closest past award in Loci. Once awarded, the contract joins Loci for the next agency that needs it.</p>
          {ctx?.rule && (
            <p className="text-ui-3xs text-base-dark">
              {ctx.rule.state} formal bids: {ctx.rule.formal_bid}. Source: {ctx.rule.source}.
            </p>
          )}
          <button type="button" disabled={busy} onClick={() => onOpen({ to: (rid) => `/solicitations/new?request=${rid}` })} className={`mt-auto self-start ${isRec("solicitation") ? primaryBtn : outlineBtn}`}>
            Start a draft
          </button>
        </div>
      </div>
      <p className="border-t border-base-lighter px-4 py-2.5 text-ui-3xs text-base-dark">
        {ctx?.limit_is_theirs ? "The quick-buy limit is this agency's own." : "The quick-buy limit shown is a typical one; the agency's own may differ."}{" "}
        {ctx?.rule ? `State rules are research findings from ${ctx.rule.researched}, not legal advice.` : "Select an agency to see its state's rules on quotes and formal bids."}
      </p>
    </section>
  );
}

/** One product chosen: the order's total, how it would be bought, and where to go next. */
function RouteStage({
  item,
  quantity,
  limit,
  limitIsTheirs,
  busy,
  onBack,
  onPlan,
}: {
  item: DiveItem;
  quantity: number;
  limit: number;
  limitIsTheirs: boolean;
  busy: boolean;
  onBack: () => void;
  onPlan: (o?: { hash?: string; listingId?: string | null; offeringId?: string | null }) => void;
}) {
  const { act } = useStore();
  const [cart, setCart] = useState<"idle" | "busy" | "added">("idle");
  const [cartError, setCartError] = useState<string | null>(null);
  const addToCart = async () => {
    setCart("busy");
    setCartError(null);
    try {
      await (item.listing_id ? act("addToCart", { listingId: item.listing_id, quantity }) : act("addCatalogToCart", { offeringId: item.offering_id, quantity }));
      setCart("added");
    } catch (e) {
      setCartError((e as Error).message);
      setCart("idle");
    }
  };
  const total = item.price != null ? item.price * quantity : null;
  const route = routeFor(total, limit);
  // A co-op or state contract product with a contract price this agency can use goes in the cart like any other.
  const cartable = item.price != null && (Boolean(item.listing_id) || Boolean(item.offering_id && (item.usable || item.state)));
  const cartButton =
    cart === "added" ? (
      <Link href="/cart" className={linkBtn}>
        Added to the cart. Open the cart →
      </Link>
    ) : (
      <button type="button" disabled={busy || cart === "busy"} onClick={addToCart} className={item.listing_id ? outlineBtn : primaryBtn}>
        Add {quantity.toLocaleString()} to the cart
      </button>
    );
  const limitWords = `${limitIsTheirs ? "the agency's" : "a typical"} ${usd(limit)} quick-buy limit`;
  const why =
    total == null
      ? item.list != null
        ? `Only a list price is on file (${usd(item.list)}, before the contract discount), so the total comes from a quote under the contract.`
        : "No price is on file, so the total comes from a quote under the contract."
      : route === "pcard"
        ? `${usd(total)} is under ${limitWords}, so a P-card covers it.`
        : `${usd(total)} is ${total === limit ? "at" : `${usd(total - limit)} over`} ${limitWords}, so it needs a purchase order and approval.`;
  return (
    <section id="route-stage" aria-label="Route" className="scroll-mt-24 border border-primary-darker bg-white">
      <div className="border-b border-base-lighter px-5 pb-3 pt-4">
        <div className={`${label} text-primary`}>Route</div>
        <h2 className="font-heading text-heading-lg font-bold text-ink">{item.name}</h2>
        <div className="mt-1 flex flex-wrap gap-x-2.5 text-ui-2xs text-base-darker">
          {item.sku && <span className="font-mono">{item.sku}</span>}
          <span>{item.supplier}</span>
          <span>
            {item.program} {item.contract_number}
          </span>
        </div>
      </div>
      <dl className="grid gap-px bg-base-lighter sm:grid-cols-3">
        <div className="bg-white px-5 py-3.5">
          <dt className={`${label} !text-[10.5px] text-base-dark`}>Order</dt>
          <dd className="text-body-md font-bold text-ink">
            {quantity.toLocaleString()} × {item.price != null ? usd(item.price) : "quote"}
          </dd>
          <dd className="text-ui-3xs text-base-dark">{item.price_note}</dd>
        </div>
        <div className="bg-white px-5 py-3.5">
          <dt className={`${label} !text-[10.5px] text-base-dark`}>Total</dt>
          <dd className="text-heading-lg font-bold tabular-nums text-ink">{total != null ? usd(total) : "By quote"}</dd>
          {item.vintage && <dd className="text-ui-3xs text-base-dark">{item.vintage}</dd>}
        </div>
        <div className="bg-white px-5 py-3.5">
          <dt className={`${label} !text-[10.5px] text-base-dark`}>How it's bought</dt>
          <dd className="mt-1">
            <RoutePill route={route} />
          </dd>
          <dd className={`mt-1 text-ui-3xs ${item.usable ? "text-success-darker" : "text-base-dark"}`}>{item.access}</dd>
        </div>
      </dl>
      <p className="px-5 pt-4 text-sm text-ink">{why}</p>
      <div className="flex flex-wrap items-center gap-3 px-5 pb-5 pt-4">
        {item.listing_id ? (
          <>
            <button type="button" disabled={busy} onClick={() => onPlan({ listingId: item.listing_id })} className={primaryBtn}>
              Plan this purchase →
            </button>
            {/* Loci's own listings can go straight in the cart; it splits by supplier and pays each share the right way. */}
            {cartable && cartButton}
          </>
        ) : (
          <>
            {cartable && cartButton}
            {!cartable && item.contract_id && item.offering_id && (
              <a href={goHref(item.contract_id, { offering: item.offering_id })} target="_blank" rel="noreferrer" className={primaryBtn}>
                Order on {item.program} ↗
              </a>
            )}
            <button type="button" disabled={busy} onClick={() => onPlan({ hash: "purchase-file", offeringId: item.offering_id })} className={item.contract_id && item.offering_id ? outlineBtn : primaryBtn}>
              Start the purchase file
            </button>
            {cartable && item.contract_id && item.offering_id && (
              <a href={goHref(item.contract_id, { offering: item.offering_id })} target="_blank" rel="noreferrer" className={linkBtn}>
                View on {item.program} ↗
              </a>
            )}
          </>
        )}
        {item.contract_id && (
          <Link href={`/contracts/${item.contract_id}`} className={linkBtn}>
            The contract →
          </Link>
        )}
        <button type="button" onClick={onBack} className={`${linkBtn} ml-auto`}>
          ← Back to the shortlist
        </button>
      </div>
      {cartError && (
        <div className="px-5 pb-4">
          <ErrorNote message={cartError} />
        </div>
      )}
      {!item.listing_id && <p className="border-t border-base-lighter px-5 py-2.5 text-ui-3xs text-base-dark">{cartable ? `The cart orders from ${item.supplier} under ${item.program} ${item.contract_number ?? ""}, citing the contract on the PO or card order. The purchase file keeps the request, the options and the route for the record.` : "This one is ordered on the program's own site or by quote. The purchase file keeps the request, the options and the route for the record."}</p>}
    </section>
  );
}

