"use client";

import { useEffect, useRef, useState } from "react";
import { Mark, TickFrame } from "@/components/blueprint";
import { Feedback } from "@/components/Feedback";
import { ShopperTabs } from "@/components/ShopperTabs";
import { post, useStore } from "@/components/store";
import { ErrorNote } from "@/components/ui";
import type { ContractAnswer, ReadableContract } from "@/lib/docs";

const label = "font-mono text-[11px] uppercase tracking-[0.14em]";
const SUGGESTED = ["Does this cover installation?", "Who is eligible to order under it?", "When does it end, and can it be renewed?", "What are the payment terms?"];
// A price file lists items and prices and says nothing about terms, so it gets questions it can answer.
const SUGGESTED_PRICES = ["What does this price file cover?", "What date are these prices from?", "Are these net, list or awarded prices?"];
/** Only price files to read: no master agreement, so no terms, eligibility or renewal language. */
const pricesOnly = (c: ReadableContract) => c.documents.length > 0 && c.documents.every((d) => /^price (file|catalog|list)/i.test(d.label));

interface Turn {
  question: string;
  result: ContractAnswer | null;
  error: string | null;
}

export default function AskContract() {
  const { llm } = useStore();
  const [contracts, setContracts] = useState<ReadableContract[] | null>(null);
  const [find, setFind] = useState("");
  const [chosen, setChosen] = useState<ReadableContract | null>(null);
  const [text, setText] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // An answer that arrives after the buyer has switched contracts belongs to the old one and is dropped.
  const asking = useRef<string | null>(null);

  useEffect(() => {
    post<ReadableContract[]>("/api/act", { action: "contractsToAsk" })
      .then((list) => {
        // Contracts with an agreement to read come first: they can answer the most questions.
        list = [...list].sort((x, y) => Number(pricesOnly(x)) - Number(pricesOnly(y)));
        setContracts(list);
        const want = new URLSearchParams(window.location.search).get("contract");
        const hit = list.find((c) => c.id === want);
        if (hit) setChosen(hit);
      })
      .catch((e) => setError((e as Error).message));
  }, []);

  const ask = async (question: string) => {
    const q = question.trim();
    if (!q || !chosen || busy) return;
    const id = chosen.id;
    asking.current = id;
    setText("");
    setBusy(true);
    let result: ContractAnswer | null = null;
    let err: string | null = null;
    try {
      result = await post<ContractAnswer>("/api/act", { action: "askContract", contractId: chosen.id, question: q });
    } catch (e) {
      err = (e as Error).message;
    }
    if (asking.current !== id) return;
    setTurns((ts) => [...ts, { question: q, result, error: err }]);
    setBusy(false);
  };

  const shown = (contracts ?? []).filter((c) => !find.trim() || `${c.name} ${c.supplier} ${c.title}`.toLowerCase().includes(find.trim().toLowerCase()));

  return (
    <div className="space-y-6">
      <ShopperTabs
        active="ask"
        title="Ask a contract"
        working={busy}
        lead="Pick a contract and ask what its documents say. Your shopper reads the master agreement or price file itself and quotes the words its answer rests on, with the page."
      />
      <ErrorNote message={error} />

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)]">
        <section aria-label="Contracts" className="border border-base-light bg-white">
          <div className="border-b border-base-lighter p-5">
            <label htmlFor="find-contract" className="block text-body-md font-bold text-ink">
              Which contract?
            </label>
            <input id="find-contract" type="search" value={find} onChange={(e) => setFind(e.target.value)} placeholder="Search by supplier, co-op or number" className="mt-2 w-full text-sm" />
            <p className="mt-2 text-ui-3xs leading-relaxed text-base-dark">
              {contracts ? `${contracts.length} contracts have a document Agora can read: price files it holds, and master agreements published as files.` : "Loading the contracts Agora can read."}
            </p>
          </div>
          <ul className="max-h-[520px] overflow-y-auto">
            {shown.map((c) => {
              const on = chosen?.id === c.id;
              return (
                <li key={c.id}>
                  <button
                    type="button"
                    aria-pressed={on}
                    onClick={() => {
                      asking.current = null;
                      setChosen(c);
                      setTurns([]);
                      setBusy(false);
                    }}
                    className={`flex min-h-[44px] w-full flex-col gap-0.5 border-b border-base-lighter px-5 py-2.5 text-left ${on ? "bg-primary-lighter/50" : "bg-white hover:bg-primary-lighter/30"}`}
                  >
                    <span className="text-sm font-bold text-ink">{c.name}</span>
                    <span className="text-ui-2xs text-base-darker">
                      {c.supplier} · {c.title}
                    </span>
                    <span className="text-ui-3xs text-base-dark">{c.documents.map((d) => `${d.label}${d.held ? " (held by Agora)" : ""}`).join(" · ")}</span>
                  </button>
                </li>
              );
            })}
            {contracts && !shown.length && <li className="px-5 py-4 text-sm text-base-darker">No readable contract matches that.</li>}
          </ul>
        </section>

        <section aria-label="Questions and answers" className="min-w-0 space-y-4">
          {!chosen && <div className="border border-dashed border-base-light bg-white px-5 py-8 text-sm text-base-darker">Choose a contract to ask about.</div>}
          {chosen && (
            <div className="border border-primary-darker bg-white">
              <div className="border-b border-base-lighter px-5 py-4">
                <div className={`${label} text-primary`}>Asking</div>
                <div className="font-heading text-lg font-bold text-ink">{chosen.name}</div>
                <div className="text-ui-2xs text-base-darker">
                  {chosen.supplier} · {chosen.documents.map((d) => d.label).join(" · ")}
                </div>
              </div>

              {turns.length > 0 && (
                <div className="relative space-y-5 px-5 pt-5" aria-live="polite">
                  <span aria-hidden className="absolute bottom-2 left-[24px] top-7 border-l border-dashed border-primary-light" />
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
                        <div className="min-w-0 flex-1 space-y-2.5">
                          <div className={`${label} text-primary`}>Your shopper</div>
                          {t.error && <p className="text-sm text-ink">{t.error}</p>}
                          {t.result?.answer?.paragraphs.map((p, j) => (
                            <p key={j} className="max-w-[68ch] text-sm leading-relaxed text-ink">
                              {p}
                            </p>
                          ))}
                          {t.result?.note && <p className="max-w-[68ch] text-sm leading-relaxed text-ink">{t.result.note}</p>}
                          {t.result?.unread.map((u) => (
                            <p key={u} className="text-ui-2xs text-base-dark">
                              {u}
                            </p>
                          ))}
                          {(t.result?.answer?.quotes.length ? t.result.answer.quotes : (t.result?.passages ?? [])).map((q, j) => (
                            <figure key={j} className="border border-primary-light/70 bg-primary-lighter/30 px-3.5 py-2.5">
                              <blockquote className="whitespace-pre-wrap text-sm leading-relaxed text-ink">{q.text.length > 700 ? `${q.text.slice(0, 700)}…` : q.text}</blockquote>
                              <figcaption className={`${label} mt-1.5 text-base-dark`}>
                                {q.document} · page {q.page}
                              </figcaption>
                            </figure>
                          ))}
                          <Feedback id={t.result?.log_id} />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {busy && (
                <div className="flex items-center gap-2 px-5 pt-5 text-sm text-base-dark">
                  <Mark className="h-5 w-5" working /> Reading the document. The first question on a contract takes longest.
                </div>
              )}

              <div className="mt-4 px-5">
                {(pricesOnly(chosen) ? SUGGESTED_PRICES : SUGGESTED).filter((s) => !turns.some((t) => t.question === s)).map((s) => (
                  <button key={s} type="button" disabled={busy} onClick={() => ask(s)} className="flex min-h-[44px] w-full items-center justify-between gap-3 border-t border-base-lighter text-left text-sm font-semibold text-primary hover:text-primary-dark disabled:opacity-60">
                    <span>{s}</span>
                    <span aria-hidden>→</span>
                  </button>
                ))}
              </div>
              <div className="border-t border-base-lighter px-6 pb-4 pt-5">
                <TickFrame>
                  <form
                    className="flex border border-primary-darker bg-white"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void ask(text);
                    }}
                  >
                    <label htmlFor="ask-contract" className="sr-only">
                      Ask about this contract
                    </label>
                    <input id="ask-contract" type="text" value={text} maxLength={400} onChange={(e) => setText(e.target.value)} placeholder="Ask what the contract says" className="h-11 min-w-0 flex-1 !rounded-none !border-0 bg-transparent px-3.5 text-sm text-ink !shadow-none outline-none" />
                    <button type="submit" disabled={busy || !text.trim()} className="h-11 bg-[#162E51] px-4 text-sm font-bold text-white disabled:opacity-60">
                      Ask →
                    </button>
                  </form>
                </TickFrame>
                <p className="mt-3 text-ui-3xs leading-relaxed text-base-dark">
                  {llm
                    ? "Answers come only from this contract's documents, and each quote is checked against the page it cites. This is a reading of the document, not legal advice."
                    : "The AI connection is off, so your shopper shows the passages that bear on your question instead of an answer."}
                </p>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
