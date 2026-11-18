"use client";

import { Feedback } from "@/components/Feedback";
import { useRef, useState } from "react";
import { ShopperTabs } from "@/components/ShopperTabs";
import { useStore } from "@/components/store";
import { ErrorNote } from "@/components/ui";
import type { CheckedLine, QuoteReport } from "@/lib/quote-check";

const label = "font-mono text-[11px] uppercase tracking-[0.14em]";
const usd = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const STATUS: Record<CheckedLine["status"], { text: string; tone: string }> = {
  over: { text: "Above the price on file", tone: "bg-warning-lighter text-ink" },
  over_list: { text: "Above list price", tone: "bg-warning-lighter text-ink" },
  match: { text: "Matches", tone: "bg-success-lighter text-success-darker" },
  under: { text: "Below the price on file", tone: "bg-success-lighter text-success-darker" },
  under_list: { text: "At or below list", tone: "bg-primary-lighter text-primary-darker" },
  not_found: { text: "Can't check", tone: "bg-base-lightest text-base-darker" },
};

function Rich({ text }: { text: string }) {
  return <>{text.split(/\*\*(.+?)\*\*/g).map((part, i) => (i % 2 ? <strong key={i}>{part}</strong> : part))}</>;
}

export default function QuoteCheck() {
  const { llm } = useStore();
  const [text, setText] = useState("");
  const [report, setReport] = useState<QuoteReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);

  const run = async (init: RequestInit) => {
    setBusy(true);
    setError(null);
    setReport(null);
    try {
      const res = await fetch("/api/quote-check", { method: "POST", ...init });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Something went wrong");
      setReport(json.result.report);
      setText(json.result.text);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const json = (body: unknown) => run({ headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

  return (
    <div className="space-y-6">
      <ShopperTabs
        active="quote"
        title="Check a quote"
        working={busy}
        lead="Paste a vendor's quote or upload it. Your shopper compares each line with the price Agora holds for the same part number, and shows the line of the price file it's checking against."
      />

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)]">
        <section aria-label="The quote" className="space-y-3 border border-base-light bg-white p-5">
          <label htmlFor="quote-text" className="block text-body-md font-bold text-ink">
            The quote
          </label>
          <textarea
            id="quote-text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={14}
            placeholder={"Paste the quote's lines here, for example:\n018-0529  Cozy Corner Roof  4  $277.14"}
            className="w-full font-mono text-[12px] leading-relaxed"
          />
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <button type="button" disabled={busy || !text.trim()} onClick={() => json({ text })} className="inline-flex min-h-[44px] items-center rounded-md bg-primary px-4 text-ui-xs font-bold text-white hover:bg-primary-dark disabled:opacity-60">
              Check this quote
            </button>
            <button type="button" disabled={busy} onClick={() => file.current?.click()} className="inline-flex min-h-[44px] items-center rounded-md bg-white px-4 text-ui-xs font-bold text-primary shadow-[inset_0_0_0_2px_theme(colors.primary.DEFAULT)] disabled:opacity-60">
              Upload a file
            </button>
            <input
              ref={file}
              type="file"
              accept=".pdf,.docx,.xlsx,.xls,.csv,.txt"
              className="sr-only"
              aria-label="Upload a quote"
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (!f) return;
                const form = new FormData();
                form.set("file", f);
                void run({ body: form });
              }}
            />
          </div>
          <button type="button" disabled={busy} onClick={() => json({ sample: true })} className="min-h-[44px] text-left text-ui-xs font-bold text-primary hover:text-primary-dark">
            Try a sample quote for playground parts →
          </button>
          <p className="text-ui-3xs leading-relaxed text-base-dark">
            Agora matches by part number against the price files it holds: Burke's 2027 OMNIA list, BuyBoard's vehicle awards, SitOnIt's list and Agora's own listings. {llm ? "Claude reads the quote's lines; a line is kept only if its part number and price are printed in the quote." : "The AI connection is off, so lines are read by simple rules: a part number Agora knows, then a price."}
          </p>
        </section>

        <section aria-label="Result" className="min-w-0 space-y-4">
          <ErrorNote message={error} />
          {!report && !error && <div className="border border-dashed border-base-light bg-white px-5 py-8 text-sm text-base-darker">{busy ? "Reading the quote and checking each line." : "The line-by-line check appears here."}</div>}
          {report && (
            <>
              <div className="border border-primary-darker bg-white px-5 py-5">
                <div className={`${label} text-primary`}>Your shopper · what I found</div>
                <h2 className="mt-1.5 font-heading text-xl font-bold leading-snug text-ink">{report.headline}</h2>
                {report.summary && (
                  <p className="mt-2 max-w-[68ch] text-sm leading-relaxed text-ink">
                    <Rich text={report.summary} />
                  </p>
                )}
                <dl className="mt-4 flex flex-wrap gap-x-8 gap-y-3">
                  {(
                    [
                      ["Lines read", String(report.lines.length)],
                      ["Checked", String(report.checked)],
                      ["Above the price on file", String(report.over)],
                      ["Quoted total", usd(report.quoted_total)],
                    ] as const
                  ).map(([k, v]) => (
                    <div key={k}>
                      <dt className={`${label} text-base-dark`}>{k}</dt>
                      <dd className="text-lg font-bold tabular-nums text-ink">{v}</dd>
                    </div>
                  ))}
                </dl>
                <Feedback key={report.log_id} id={report.log_id} className="mt-4" />
              </div>

              {report.lines.map((l, i) => (
                <div key={i} className={`border bg-white px-4 py-3.5 ${l.status === "over" || l.status === "over_list" ? "border-warning" : "border-base-lighter"}`}>
                  <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
                    <div className="min-w-0 flex-[1_1_280px]">
                      <div className="flex flex-wrap items-center gap-2">
                        {l.part_number && <span className="border border-base-light bg-white px-1.5 py-px font-mono text-[11px] tracking-[0.1em] text-base-darker">{l.part_number}</span>}
                        <span className={`px-1.5 py-0.5 text-ui-3xs font-bold ${STATUS[l.status].tone}`}>{STATUS[l.status].text}</span>
                      </div>
                      <div className="mt-1 text-sm font-semibold text-ink">{l.product ?? l.description}</div>
                      <p className="mt-0.5 text-ui-2xs text-base-darker">{l.note}</p>
                    </div>
                    <dl className="flex gap-x-6 text-right">
                      <div>
                        <dt className={`${label} text-base-dark`}>Quoted</dt>
                        <dd className="text-body-md font-bold tabular-nums text-ink">{usd(l.unit_price)}</dd>
                        <dd className="text-ui-3xs text-base-dark">× {l.quantity}</dd>
                      </div>
                      <div>
                        <dt className={`${label} text-base-dark`}>On file</dt>
                        <dd className="text-body-md font-bold tabular-nums text-ink">{l.reference === null ? "None" : usd(l.reference)}</dd>
                        {l.line_diff !== null && l.line_diff !== 0 && (
                          <dd className="text-ui-3xs text-base-dark">
                            {l.line_diff > 0 ? "+" : "−"}
                            {usd(Math.abs(l.line_diff))} on the line
                          </dd>
                        )}
                      </div>
                    </dl>
                  </div>
                  {l.source && (
                    <div className="mt-2.5 border-t border-dashed border-primary-light/60 pt-2 text-ui-2xs text-base-darker">
                      <span className={`${label} mr-2 text-base-dark`}>Source</span>
                      {l.reference_kind} · {l.source.contract} · {l.source.vintage}
                      {l.source.page ? ` · page ${l.source.page}` : ""}
                      {l.source.line && <div className="mt-1 overflow-x-auto whitespace-pre font-mono text-[11px] text-ink">{l.source.line}</div>}
                    </div>
                  )}
                </div>
              ))}
              {report.dropped.length > 0 && (
                <div className="border border-base-lighter bg-white px-4 py-3 text-ui-2xs text-base-darker">
                  <div className={`${label} text-base-dark`}>Lines left out</div>
                  <ul className="mt-1 space-y-1">
                    {report.dropped.map((d) => (
                      <li key={d}>{d}</li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </section>
      </div>
    </div>
  );
}
