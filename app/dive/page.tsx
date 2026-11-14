"use client";

import { Feedback } from "@/components/Feedback";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { BestFit, Mark, TickFrame } from "@/components/blueprint";
import { ShopperTabs } from "@/components/ShopperTabs";
import { post, useStore } from "@/components/store";
import { ErrorNote } from "@/components/ui";
import { goHref } from "@/lib/coops";
import type { DiveFilter, DiveItem, DiveState, DiveVerdict } from "@/lib/dive";
import type { ShopperText } from "@/lib/shopper-ai";

const label = "font-mono text-[11px] uppercase tracking-[0.14em]";
const usd = (n: number) => `$${n.toLocaleString("en-US", { maximumFractionDigits: n < 100 ? 2 : 0 })}`;
const chip = (f: DiveFilter) =>
  f.kind === "price" ? (f.min === undefined ? `Up to ${usd(f.max!)}` : f.max === undefined ? `${usd(f.min)} and up` : `${usd(f.min)} to ${usd(f.max)}`) : f.kind === "word" ? f.value : f.kind === "not_word" ? `Not ${f.value}` : f.kind === "maker" ? f.value : f.kind === "usable" ? "Can buy today" : "Has a price";

const STARTERS = ["A swing set for a neighborhood park", "Task chairs for the clerk's office", "A police SUV", "Folding tables for the rec center"];

interface Turn {
  who: "you" | "shopper";
  text: string;
}
interface Compare {
  items: DiveItem[];
  verdict: DiveVerdict;
  written: ShopperText | null;
}

function Rich({ text }: { text: string }) {
  return <>{text.split(/\*\*(.+?)\*\*/g).map((part, i) => (i % 2 ? <strong key={i}>{part}</strong> : part))}</>;
}

export default function Dive() {
  const router = useRouter();
  const { db, act, llm } = useStore();
  const [state, setState] = useState<DiveState | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [text, setText] = useState("");
  const [skipped, setSkipped] = useState<string[]>([]);
  const [picks, setPicks] = useState<string[]>([]);
  const [compare, setCompare] = useState<Compare | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const say = (who: Turn["who"], t: string) => setTurns((ts) => [...ts, { who, text: t }]);
  const summary = (s: DiveState) =>
    s.matched === 0
      ? s.pool
        ? "Nothing on the shortlist fits all of that. Remove an answer to widen it."
        : `I couldn't find “${s.query}” in the catalog or on any contract. Try the product's plain name.`
      : `${s.matched === s.pool ? `I found ${s.pool}` : `${s.matched} of ${s.pool}`} product${s.matched === 1 ? "" : "s"} for “${s.query}”${s.price_range ? `, from ${usd(s.price_range.min)} to ${usd(s.price_range.max)}` : ""}.`;

  const turn = async (body: Record<string, unknown>, mine?: string) => {
    setBusy(true);
    setError(null);
    setCompare(null);
    if (mine) say("you", mine);
    try {
      const res = await post<{ state: DiveState; said: string }>("/api/act", { action: "dive", ...body });
      setState(res.state);
      setPicks((p) => p.filter((id) => res.state.items.some((i) => i.id === id)));
      say("shopper", [res.said, summary(res.state)].filter(Boolean).join(" "));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const start = (need: string) => {
    if (!need.trim() || busy) return;
    setText("");
    setTurns([]);
    setSkipped([]);
    setPicks([]);
    void turn({ need }, need.trim());
  };
  const narrow = (filters: DiveFilter[], mine: string) => state && turn({ query: state.query, filters }, mine);
  const send = () => {
    if (!state) return start(text);
    if (!text.trim() || busy) return;
    const m = text.trim();
    setText("");
    void turn({ query: state.query, filters: state.filters, message: m }, m);
  };

  const runCompare = async () => {
    if (!state) return;
    setBusy(true);
    setError(null);
    try {
      setCompare(await post<Compare>("/api/act", { action: "diveCompare", query: state.query, ids: picks }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const plan = async (item: DiveItem) => {
    setBusy(true);
    try {
      const res = await act<{ request: { id: string } }>("createRequest", { text: item.name });
      router.push(`/request/${res.request.id}`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  const question = state?.questions.find((q) => !skipped.includes(q.id));
  const bestId = [...(state?.items ?? [])].filter((i) => i.usable && i.price != null).sort((x, y) => x.price! - y.price!)[0]?.id;

  return (
    <div className="space-y-6">
      <ShopperTabs
        active="dive"
        title="Find the right product"
        working={busy}
        lead="Say what you need in your own words. Your shopper asks a few questions, and each answer narrows a shortlist of real products on real contracts, with the price and who can buy it."
      />

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)]">
        <section aria-label="Conversation" className="border border-base-light bg-white">
          {turns.length > 0 && (
            <div className="relative space-y-5 px-5 pt-5" aria-live="polite">
              <span aria-hidden className="absolute bottom-2 left-[24px] top-7 border-l border-dashed border-primary-light" />
              {turns.map((t, i) => (
                <div key={i} className="flex items-start gap-3.5">
                  <span aria-hidden className={`relative mt-1 h-[9px] w-[9px] shrink-0 shadow-[0_0_0_5px_rgb(var(--us-white))] ${t.who === "you" ? "border-[1.5px] border-primary-light bg-white" : "bg-[#162E51]"}`} />
                  <div className="min-w-0 flex-1">
                    <div className={`${label} ${t.who === "you" ? "text-base-dark" : "text-primary"}`}>{t.who === "you" ? "You" : "Your shopper"}</div>
                    <p className={`mt-1 text-sm leading-relaxed text-ink ${t.who === "you" ? "font-semibold" : ""}`}>{t.text}</p>
                  </div>
                </div>
              ))}
              {busy && (
                <div className="flex items-center gap-2 pl-6 text-sm text-base-dark">
                  <Mark className="h-5 w-5" working /> Checking the catalog
                </div>
              )}
            </div>
          )}

          {question && !busy && (
            <div className="mt-5 border-t border-base-lighter px-5 py-4">
              <div className="text-body-md font-bold text-ink">{question.text}</div>
              <p className="mt-0.5 text-ui-2xs text-base-dark">{question.why}</p>
              <div className="mt-3 flex flex-col">
                {question.options.map((o) => (
                  <button
                    key={o.label}
                    type="button"
                    onClick={() => narrow([...state!.filters, o.filter], o.label)}
                    className="-mt-px flex min-h-[44px] items-center justify-between gap-3 border border-base-light bg-white px-3.5 text-left text-sm font-semibold text-ink hover:border-primary-darker hover:bg-primary-lighter/40"
                  >
                    <span>{o.label}</span>
                    <span className="text-ui-2xs font-normal tabular-nums text-base-dark">{o.count}</span>
                  </button>
                ))}
              </div>
              <button type="button" onClick={() => setSkipped((s) => [...s, question.id])} className="mt-2 min-h-[44px] text-ui-xs font-bold text-primary hover:text-primary-dark">
                Skip this question →
              </button>
            </div>
          )}

          {!state && (
            <div className="px-5 pt-5">
              <div className="text-body-md font-bold text-ink">What are you looking for?</div>
              <div className="mt-3 flex flex-col">
                {STARTERS.map((s) => (
                  <button key={s} type="button" disabled={busy} onClick={() => start(s)} className="flex min-h-[44px] items-center justify-between gap-3 border-t border-base-lighter text-left text-sm font-semibold text-primary hover:text-primary-dark">
                    <span>{s}</span>
                    <span aria-hidden>→</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="mt-4 border-t border-base-lighter px-6 pb-4 pt-5">
            <TickFrame>
              <form
                className="flex border border-primary-darker bg-white"
                onSubmit={(e) => {
                  e.preventDefault();
                  send();
                }}
              >
                <label htmlFor="dive-say" className="sr-only">
                  {state ? "Tell your shopper more" : "Describe what you need"}
                </label>
                <input
                  id="dive-say"
                  type="text"
                  value={text}
                  maxLength={300}
                  onChange={(e) => setText(e.target.value)}
                  placeholder={state ? "Tell me more: a budget, a make, a feature" : "Describe what you need"}
                  className="h-11 min-w-0 flex-1 !rounded-none !border-0 bg-transparent px-3.5 text-sm text-ink !shadow-none outline-none"
                />
                <button type="submit" disabled={busy || !text.trim()} className="h-11 bg-[#162E51] px-4 text-sm font-bold text-white disabled:opacity-60">
                  {state ? "Narrow →" : "Start →"}
                </button>
              </form>
            </TickFrame>
            {state && (
              <button type="button" onClick={() => (setState(null), setTurns([]), setCompare(null), setPicks([]))} className="mt-2 min-h-[44px] text-ui-xs font-bold text-primary hover:text-primary-dark">
                Start a new search
              </button>
            )}
            <p className="mt-1 text-ui-3xs leading-relaxed text-base-dark">
              Products, prices and who can buy them come from Agora's catalog and contract records. {llm ? "Your shopper reads what you type and words the comparison." : "The AI connection is off, so typed messages are read by simple rules: a budget, or a word from a product's name."}
            </p>
          </div>
        </section>

        <section aria-label="Shortlist" className="min-w-0 space-y-4">
          <ErrorNote message={error} />
          {!state && (
            <div className="border border-dashed border-base-light bg-white px-5 py-8 text-sm text-base-darker">
              The shortlist appears here and narrows as you answer. {db?.session.buyer ? `It marks what ${db.session.buyer.name} can buy today.` : "Set your agency from the account menu and it will mark what you can buy today."}
            </div>
          )}
          {state && (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <span className={`${label} text-base-dark`}>
                  {state.matched} of {state.pool} match
                </span>
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
                const on = picks.includes(i.id);
                return (
                  <div key={i.id} className={`flex flex-wrap items-start gap-x-4 gap-y-2 border px-4 py-3.5 ${on ? "border-primary-darker bg-primary-lighter/40" : "border-base-lighter bg-white"}`}>
                    <label className="flex min-w-0 flex-[1_1_320px] cursor-pointer items-start gap-3">
                      <input
                        type="checkbox"
                        checked={on}
                        disabled={!on && picks.length >= 3}
                        onChange={() => (setCompare(null), setPicks((p) => (on ? p.filter((x) => x !== i.id) : [...p, i.id])))}
                        className="mt-0.5 h-5 w-5 accent-[#162E51]"
                        aria-label={`Compare ${i.name}`}
                      />
                      <span className="flex min-w-0 flex-col gap-1.5">
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="text-body-md font-bold text-ink">{i.name}</span>
                          {i.id === bestId && state.matched > 1 && <span className="bg-primary-lighter px-1.5 py-0.5 text-ui-3xs font-bold text-primary-darker">Lowest price you can buy today</span>}
                        </span>
                        <span className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-ui-2xs text-base-darker">
                          {i.sku && <span className="border border-base-light bg-white px-1.5 py-px font-mono text-[11px] tracking-[0.1em]">{i.sku}</span>}
                          <span>{i.supplier}</span>
                          <span>
                            {i.program} {i.contract_number}
                          </span>
                          {i.routes > 1 && <span>{i.routes} contracts sell it</span>}
                        </span>
                        <span className={`text-ui-2xs ${i.usable ? "text-success-darker" : "text-base-dark"}`}>{i.access}</span>
                      </span>
                    </label>
                    <div className="text-right text-ui-2xs text-base-dark">
                      <div className="text-lg font-bold tabular-nums text-ink">
                        {i.price != null ? usd(i.price) : i.list != null ? `List ${usd(i.list)}` : "No price"}
                        {(i.price ?? i.list) != null && i.unit && <span className="text-ui-3xs font-normal text-base-dark"> / {i.unit}</span>}
                      </div>
                      {i.price_note}
                      <div className="mt-1.5 flex flex-wrap justify-end gap-x-4">
                        {i.contract_id && i.offering_id && (
                          <a href={goHref(i.contract_id, { offering: i.offering_id })} target="_blank" rel="noreferrer" className="inline-flex min-h-[44px] items-center text-ui-xs font-bold text-primary hover:text-primary-dark">
                            View on {i.program} ↗
                          </a>
                        )}
                        <button type="button" disabled={busy} onClick={() => plan(i)} className="inline-flex min-h-[44px] items-center text-ui-xs font-bold text-primary hover:text-primary-dark">
                          Plan this purchase →
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
              {state.matched > state.items.length && <p className="text-ui-2xs text-base-dark">Showing the top {state.items.length}. Answer another question to narrow the other {state.matched - state.items.length}.</p>}

              {state.items.length > 0 && (
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-base-lighter pt-4">
                  <button type="button" disabled={busy || picks.length < 2} onClick={runCompare} className="inline-flex min-h-[44px] items-center rounded-md bg-primary px-4 text-ui-xs font-bold text-white hover:bg-primary-dark disabled:opacity-60">
                    Compare {picks.length >= 2 ? picks.length : ""} side by side
                  </button>
                  <span className="text-ui-2xs text-base-dark">{picks.length < 2 ? "Tick two or three products to compare them." : "Up to three at a time."}</span>
                </div>
              )}

              {compare && (
                <div className="border border-primary-darker bg-white">
                  <div className="space-y-2.5 px-5 pt-5">
                    <div className={`${label} text-primary`}>Your shopper · side by side</div>
                    <h2 className="font-heading text-xl font-bold leading-snug text-ink">{compare.written?.headline ?? compare.verdict.headline}</h2>
                    {compare.written
                      ? compare.written.paragraphs.map((p, i) => (
                          <p key={i} className="max-w-[68ch] text-sm leading-relaxed text-ink">
                            <Rich text={p} />
                          </p>
                        ))
                      : compare.verdict.points.map((p, i) => (
                          <p key={i} className="max-w-[68ch] text-sm leading-relaxed text-ink">
                            <Rich text={p} />
                          </p>
                        ))}
                    <Feedback key={compare.written?.log_id} id={compare.written?.log_id} />
                  </div>
                  <div className="mt-4 overflow-x-auto px-5 pb-5">
                    <table className="w-full min-w-[520px] border-collapse text-left text-sm">
                      <thead>
                        <tr>
                          <th className="w-28 border-b border-primary-darker py-2 pr-3" />
                          {compare.items.map((i) => (
                            <th key={i.id} className="border-b border-primary-darker py-2 pr-3 align-bottom font-bold text-ink">
                              {i.id === compare.verdict.pick && <BestFit className="mb-1" />}
                              <div>{i.name}</div>
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {(
                          [
                            ["Price", (i: DiveItem) => (i.price != null ? usd(i.price) : i.list != null ? `List ${usd(i.list)}` : "Not loaded")],
                            ["What it is", (i: DiveItem) => i.price_note],
                            ["Price source", (i: DiveItem) => i.vintage ?? "Listing in Agora"],
                            ["Supplier", (i: DiveItem) => i.supplier],
                            ["Contract", (i: DiveItem) => `${i.program} ${i.contract_number ?? ""}`],
                            ["Can you buy it", (i: DiveItem) => i.access],
                          ] as [string, (i: DiveItem) => string][]
                        ).map(([k, f]) => (
                          <tr key={k}>
                            <th className={`border-b border-base-lighter py-2 pr-3 align-top font-normal ${label} text-base-dark`}>{k}</th>
                            {compare.items.map((i) => (
                              <td key={i.id} className="border-b border-base-lighter py-2 pr-3 align-top text-ink">
                                {f(i)}
                              </td>
                            ))}
                          </tr>
                        ))}
                        <tr>
                          <th />
                          {compare.items.map((i) => (
                            <td key={i.id} className="py-2 pr-3">
                              <button type="button" disabled={busy} onClick={() => plan(i)} className="inline-flex min-h-[44px] items-center text-ui-xs font-bold text-primary hover:text-primary-dark">
                                Plan this purchase →
                              </button>
                            </td>
                          ))}
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </>
          )}
        </section>
      </div>
    </div>
  );
}
