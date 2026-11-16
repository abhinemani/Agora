"use client";

// How the model's output is faring. Every number comes from the log of model
// calls (lib/ai-log.ts): what each check kept or threw away, and what people
// marked right or wrong.

import { useEffect, useState } from "react";
import { useStore } from "@/components/store";
import { ErrorNote, PageTitle } from "@/components/ui";
import type { Quality, TaskQuality } from "@/lib/ai-log";

const label = "font-mono text-[11px] uppercase tracking-[0.14em]";
const n = (x: number) => x.toLocaleString("en-US");
const pct = (a: number, b: number) => (b ? `${Math.round((100 * a) / b)}%` : "–");
const when = (iso: string) => new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

const OUTCOME: Record<string, { text: string; tone: string }> = {
  kept: { text: "Kept", tone: "text-success-dark" },
  partial: { text: "Kept in part", tone: "text-warning-darker" },
  discarded: { text: "Discarded", tone: "text-error-dark" },
  failed: { text: "Call failed", tone: "text-base-dark" },
};

function Row({ t }: { t: TaskQuality }) {
  const rated = t.up + t.down;
  return (
    <tr className="border-t border-base-lighter align-top">
      <td className="px-3 py-3">
        <div className="font-bold text-ink">{t.label}</div>
        <div className={`${label} mt-0.5 text-base-dark`}>Prompt {t.prompt}</div>
        {t.reasons.map((r) => (
          <div key={r.reason} className="mt-1 text-ui-2xs text-base-darker">
            {n(r.n)} × {r.reason}
          </div>
        ))}
        {t.earlier && (
          <div className="mt-1 text-ui-2xs text-base-dark">
            Earlier prompts: {n(t.earlier.calls)} call{t.earlier.calls === 1 ? "" : "s"}, {pct(t.earlier.kept, t.earlier.calls)} kept whole, {n(t.earlier.down)} marked wrong.
          </div>
        )}
      </td>
      <td className="px-3 py-3 text-right tabular-nums">{n(t.calls)}</td>
      <td className="px-3 py-3 text-right font-bold tabular-nums">{pct(t.kept, t.calls)}</td>
      <td className="px-3 py-3 text-right tabular-nums">{n(t.partial)}</td>
      <td className="px-3 py-3 text-right tabular-nums">{n(t.discarded)}</td>
      <td className="px-3 py-3 text-right tabular-nums">{n(t.failed)}</td>
      <td className="px-3 py-3 text-right tabular-nums">{n(t.declined)}</td>
      <td className="px-3 py-3 text-right tabular-nums">{rated ? `${n(t.up)} / ${n(t.down)}` : "–"}</td>
    </tr>
  );
}

type Tok = TaskQuality["tokens"];
const addTok = (a: Tok, b: Tok | undefined): Tok => (b ? { input: a.input + b.input, output: a.output + b.output, cache_write: a.cache_write + b.cache_write, cache_read: a.cache_read + b.cache_read } : a);
const inputAll = (t: Tok) => t.input + t.cache_write + t.cache_read;

/** Where the tokens go, by task, across every prompt the log holds. */
function TokenSection({ tasks }: { tasks: TaskQuality[] }) {
  const rows = tasks.map((t) => ({ t, tok: addTok(t.tokens, t.earlier?.tokens) })).filter((r) => inputAll(r.tok) + r.tok.output > 0);
  if (!rows.length) return null;
  rows.sort((a, b) => inputAll(b.tok) + b.tok.output - (inputAll(a.tok) + a.tok.output));
  return (
    <section className="space-y-3">
      <h2 className="font-heading text-heading-md font-bold text-ink">Tokens used</h2>
      <p className="max-w-[72ex] text-body-sm text-base-darker">
        What each task sent and received, as the API counted it, for the calls that recorded it. Input read from the cache is billed at a small fraction of the normal rate, so a rising cached share means a cheaper task. Writing to the cache costs a little
        more than plain input, and pays off once the same text is read again.
      </p>
      <div className="overflow-x-auto border border-base-light bg-white">
        <table className="w-full min-w-[640px] text-left text-ui-xs">
          <thead className={`${label} bg-base-lightest text-base-dark`}>
            <tr>
              {["Task", "Input", "Read from cache", "Written to cache", "Output"].map((h, i) => (
                <th key={h} className={`px-3 py-2 font-normal ${i ? "text-right" : ""}`}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(({ t, tok }) => (
              <tr key={t.task} className="border-t border-base-lighter">
                <td className="px-3 py-3 font-bold text-ink">{t.label}</td>
                <td className="px-3 py-3 text-right tabular-nums">{n(inputAll(tok))}</td>
                <td className="px-3 py-3 text-right tabular-nums">
                  {n(tok.cache_read)} <span className="text-base-dark">({pct(tok.cache_read, inputAll(tok))})</span>
                </td>
                <td className="px-3 py-3 text-right tabular-nums">{n(tok.cache_write)}</td>
                <td className="px-3 py-3 text-right tabular-nums">{n(tok.output)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export default function QualityPage() {
  const { user } = useStore();
  const [q, setQ] = useState<(Quality & { llm: boolean }) | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/quality", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => setQ(j.result))
      .catch((e) => setError((e as Error).message));
  }, [user?.id]);

  const sum = (k: "calls" | "kept" | "partial" | "discarded" | "failed" | "up" | "down") => (q?.tasks ?? []).reduce((s, t) => s + t[k], 0);

  return (
    <div className="space-y-8">
      <PageTitle eyebrow="How Loci checks itself" title="AI quality">
        <p className="max-w-[72ex] text-body-sm text-base-darker">
          The model writes buying plans, reads quotes and answers from contracts. Before anything it writes is shown, a check compares it with the data: a figure that isn't on file, or a quote that isn't in the document word for word, and the output is
          thrown away and the rule-based version shown instead. This page counts how often that happens, and what people marked right or wrong.
        </p>
      </PageTitle>
      <ErrorNote message={error} />

      {q && q.total === 0 && (
        <div className="border border-dashed border-base-light bg-white px-5 py-8 text-sm text-base-darker">
          {q.llm ? "No model calls have been logged yet. Run a search, ask a contract a question or check a quote, and they'll be counted here." : "The AI connection is off on this server, so there is nothing to measure: every page is showing its rule-based version."}
        </div>
      )}

      {q && q.total > 0 && (
        <>
          <dl className="grid grid-cols-2 border border-base-light bg-white sm:grid-cols-4">
            {(
              [
                ["Model calls", n(sum("calls"))],
                ["Kept whole", pct(sum("kept"), sum("calls"))],
                ["Discarded by a check", n(sum("discarded"))],
                ["Marked right / wrong", `${n(sum("up"))} / ${n(sum("down"))}`],
              ] as const
            ).map(([k, v], i) => (
              <div key={k} className={`p-4 ${i ? "border-l border-base-light" : ""}`}>
                <dt className={`${label} text-base-dark`}>{k}</dt>
                <dd className="mt-1 text-xl font-bold tabular-nums text-ink">{v}</dd>
              </div>
            ))}
          </dl>

          <section className="space-y-3">
            <h2 className="font-heading text-heading-md font-bold text-ink">By task, under the prompt in use now</h2>
            <p className="max-w-[72ex] text-body-sm text-base-darker">
              Each task's prompt has a fingerprint that changes whenever the prompt or the model does. The counts below are for the current one, so a change shows up as a fresh row to compare with the line for earlier prompts. "Said it didn't know" counts
              answers that were kept but told the person the data doesn't hold the answer.
            </p>
            <div className="overflow-x-auto border border-base-light bg-white">
              <table className="w-full min-w-[760px] text-left text-ui-xs">
                <thead className={`${label} bg-base-lightest text-base-dark`}>
                  <tr>
                    {["Task", "Calls", "Kept whole", "In part", "Discarded", "Failed", "Said it didn't know", "Right / wrong"].map((h, i) => (
                      <th key={h} className={`px-3 py-2 font-normal ${i ? "text-right" : ""}`}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {q.tasks.map((t) => (
                    <Row key={t.task} t={t} />
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-ui-3xs leading-relaxed text-base-dark">
              Counts cover the most recent {n(q.holds)} calls{q.since ? `, the oldest from ${when(q.since)}` : ""}. {q.saved ? "The log is saved to the database." : "This server has no database, so the log starts over when it restarts."} Calls made
              while the AI connection is off aren't counted.
            </p>
          </section>

          <TokenSection tasks={q.tasks} />

          <section className="space-y-3">
            <h2 className="font-heading text-heading-md font-bold text-ink">Worth a look</h2>
            <p className="max-w-[72ex] text-body-sm text-base-darker">The most recent output that was discarded, kept only in part, failed, or marked wrong, with what was asked and what the model wrote.</p>
            {q.recent === null ? (
              <p className="border border-base-light bg-white px-4 py-3 text-ui-xs text-base-darker">Sign in to see these. They include what people typed.</p>
            ) : q.recent.length === 0 ? (
              <p className="border border-base-light bg-white px-4 py-3 text-ui-xs text-base-darker">Nothing yet: every call so far was kept whole and none was marked wrong.</p>
            ) : (
              <ul className="space-y-3">
                {q.recent.map((r) => (
                  <li key={r.id} className="border border-base-light bg-white px-4 py-3">
                    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                      <span className={`${label} ${OUTCOME[r.outcome].tone}`}>{OUTCOME[r.outcome].text}</span>
                      <span className="text-ui-xs font-bold text-ink">{r.label}</span>
                      <span className="text-ui-2xs text-base-dark">
                        {when(r.at)} · prompt {r.prompt}
                        {r.of !== undefined ? ` · ${r.kept} of ${r.of} pieces passed` : ""}
                        {r.down ? ` · marked wrong${r.down > 1 ? ` ${r.down} times` : ""}` : ""}
                      </span>
                    </div>
                    {r.reason && <p className="mt-1.5 text-ui-xs text-ink">{r.reason}</p>}
                    {r.notes.map((x) => (
                      <p key={x.at} className="mt-1.5 border-l-4 border-warning pl-2.5 text-ui-xs text-ink">
                        A reader said: {x.text}
                      </p>
                    ))}
                    {r.input && (
                      <p className="mt-1.5 text-ui-2xs text-base-darker">
                        <span className="font-bold">Asked:</span> {r.input}
                      </p>
                    )}
                    {r.output && (
                      <details className="mt-1.5 text-ui-2xs text-base-darker">
                        <summary className="cursor-pointer font-bold text-primary">What the model wrote</summary>
                        <p className="mt-1 whitespace-pre-wrap">{r.output}</p>
                      </details>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}

      <section className="max-w-[72ex] space-y-2 border-t border-base-lighter pt-6 text-body-sm text-base-darker">
        <h2 className="font-heading text-heading-md font-bold text-ink">Before a prompt changes</h2>
        <p>
          A fixed test set runs against every prompt with <code className="font-mono text-ui-xs">npm run eval</code>. It has two halves. The first feeds each check output that is known to be wrong, such as an invented price or a misquoted clause, and
          confirms the check throws it away. The second sends fixed questions to the model and grades the answers. A prompt change ships only if nothing that passed before fails now.
        </p>
      </section>
    </div>
  );
}
