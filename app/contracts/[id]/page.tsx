"use client";

import { Feedback } from "@/components/Feedback";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { BuyerPicker } from "@/components/BuyerPicker";
import { AccessTag, shortDate } from "@/components/ContractBits";
import { Mark } from "@/components/blueprint";
import { StateRuleNote } from "@/components/StateRuleNote";
import { post, useStore } from "@/components/store";
import { Alert, Badge, ErrorNote, Loading, money } from "@/components/ui";
import type { AccessStatus, ContractDetail, ContractItem } from "@/lib/contracts";
import type { BriefField, ContractAnswer, ContractBrief, Passage } from "@/lib/docs";
import { stateName } from "@/lib/vehicles";

const label = "font-mono text-[11px] uppercase tracking-[0.14em]";

const ACCESS_LINE: Record<AccessStatus, (c: ContractDetail) => { type: "success" | "warning" | "error" | "info"; heading: string }> = {
  open: (c) => ({ type: "success", heading: c.buyer ? `${c.buyer} can use this contract` : "Open to state and local governments" }),
  check: (c) => ({ type: "warning", heading: `${c.buyer} can use this once its state has a participating addendum` }),
  join: (c) => ({ type: "warning", heading: `${c.buyer} would need to join ${c.program} to use this` }),
  closed: (c) => ({ type: "error", heading: c.buyer ? `Not open to ${c.buyer}` : "Not open to state and local governments" }),
  unknown: () => ({ type: "info", heading: "Set your agency to see whether you can use this" }),
};

export default function ContractPage() {
  const { id } = useParams<{ id: string }>();
  const { db } = useStore();
  const [c, setC] = useState<ContractDetail | null | undefined>(undefined);
  const [changing, setChanging] = useState(false);
  const buyer = db?.session.buyer ?? null;
  const buyerKey = buyer ? `${buyer.name}|${buyer.state}|${buyer.entity_type}` : "";
  const memberships = db?.memberships.length ?? 0;

  useEffect(() => {
    let live = true;
    fetch(`/api/catalog/contracts?id=${encodeURIComponent(id)}`)
      .then((r) => r.json())
      .then((j) => live && setC(j.contract ?? null))
      .catch(() => live && setC(null));
    return () => {
      live = false;
    };
  }, [id, buyerKey, memberships]);

  if (c === undefined) return <Loading label="Opening the contract" />;
  if (!c) return <ErrorNote message="That contract isn't in Agora. It may have been removed from its program's directory." />;
  const a = ACCESS_LINE[c.access](c);

  return (
    <div className="space-y-8 pb-8">
      <div>
        <Link href="/contracts" className="text-sm text-base-darker hover:text-ink">
          ← All contracts
        </Link>
        <div className="mt-4 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-ui-xs text-base-darker">
          <span className={`${label} text-primary`}>{c.kind_label}</span>
          <span className="font-bold text-ink">{c.program}</span>
          {c.trx && (
            <span title="A state contract on the TRX program, which Sovra supports. Agora lists it ahead of co-op contracts for that state's buyers.">
              <Badge tone="green">TRX</Badge>
            </span>
          )}
          <span className="font-mono">{c.number}</span>
          {c.solicitation && <span>· awarded under {c.solicitation}</span>}
          {c.expired && <Badge tone="amber">Expired</Badge>}
        </div>
        <h1 className="mt-1.5 max-w-[40ch] font-heading text-heading-xl font-bold leading-tight text-ink">{c.title}</h1>
        <p className="mt-2 text-body-sm text-base-darker">
          Held by{" "}
          <Link href={`/storefronts/${c.supplier_id}`} className="font-semibold text-primary">
            {c.supplier || "an unnamed supplier"}
          </Link>
          {c.term.end ? ` · through ${shortDate(c.term.end)}` : " · end date not published"}
          {c.category ? ` · ${c.category}` : ""}
        </p>
      </div>

      <Alert
        type={a.type}
        heading={a.heading}
        action={
          <button onClick={() => setChanging(!changing)} className="text-ui-xs font-bold text-primary hover:underline">
            {changing ? "Cancel" : c.buyer ? "Change agency" : "Set your agency"}
          </button>
        }
      >
        <span className="text-ui-xs">
          {c.access === "closed" ? c.reason.charAt(0).toUpperCase() + c.reason.slice(1) : `Open to ${c.reason.replace(/^open to /i, "")}`}.{c.requires ? ` Requires: ${c.requires}.` : ""}
        </span>
      </Alert>
      {changing && <BuyerPicker onDone={() => setChanging(false)} onClose={() => setChanging(false)} />}

      <div className="grid items-start gap-10 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-10">
          <section aria-labelledby="how-to-buy">
            <h2 id="how-to-buy" className="font-heading text-heading-md font-bold text-ink">
              How to buy under it
            </h2>
            <ol className="mt-3 space-y-2.5">
              {c.steps.map((s, i) => (
                <li key={i} className="flex gap-3 text-body-sm text-ink">
                  <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-primary-lighter text-ui-2xs font-bold text-primary-darker">{i + 1}</span>
                  <span className="max-w-[68ch]">{s}</span>
                </li>
              ))}
            </ol>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              {c.link && (
                <a
                  href={c.link.href}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center rounded-md bg-primary px-4 py-2.5 text-ui-xs font-bold leading-none text-white no-underline hover:bg-primary-dark"
                >
                  {c.link.label} ↗
                </a>
              )}
              <Link href="/quote-check" className="text-ui-xs font-bold text-primary hover:underline">
                Check a quote against prices on file →
              </Link>
              {c.agora_copy && (
                <Link href={`/contracts/${c.agora_copy}`} className="text-ui-xs font-bold text-primary hover:underline">
                  This contract with prices loaded in Agora →
                </Link>
              )}
            </div>
          </section>

          <Covers c={c} />
          <Items c={c} />
          <Documents c={c} />
        </div>

        <aside className="space-y-6">
          <dl className="divide-y divide-base-lighter border-y border-base-lighter text-ui-xs">
            <Fact k="Program" v={c.program} />
            <Fact k="Contract" v={<span className="font-mono">{c.number}</span>} />
            <Fact
              k="Supplier"
              v={
                <Link href={`/storefronts/${c.supplier_id}`} className="text-primary">
                  {c.supplier}
                </Link>
              }
            />
            {c.lead && <Fact k={c.kind === "coop" ? "Lead agency" : "Awarded by"} v={c.lead} />}
            <Fact k="Starts" v={c.term.start ? shortDate(c.term.start) : "Not published"} />
            <Fact k="Ends" v={c.term.end ? shortDate(c.term.end) : "Not published"} />
            {c.term.renewal && <Fact k="Renewable to" v={shortDate(c.term.renewal)} />}
            <Fact
              k="Where"
              v={c.states === "any" || !c.states.length ? (c.kind === "coop" || c.kind === "federal" ? "No state limit listed" : "Any state") : c.states.length <= 8 ? c.states.map(stateName).join(", ") : `${c.states.length} states: ${c.states.join(", ")}`}
            />
          </dl>
          {c.state_rule && (
            <div>
              <h2 className="text-ui-2xs font-bold uppercase tracking-label text-base-dark">Your state's rules on co-op contracts</h2>
              <StateRuleNote rule={c.state_rule} />
            </div>
          )}
          {c.related.length > 0 && (
            <div>
              <h2 className="text-ui-2xs font-bold uppercase tracking-label text-base-dark">Other contracts {c.supplier} holds</h2>
              <ul className="mt-2 space-y-2">
                {c.related.map((r) => (
                  <li key={r.id} className="text-ui-xs">
                    <Link href={`/contracts/${r.id}`} className="font-semibold text-primary">
                      {r.program} <span className="font-mono font-normal">{r.number}</span>
                    </Link>
                    <div className="line-clamp-2 text-base-darker">{r.title}</div>
                  </li>
                ))}
              </ul>
              <Link href={`/storefronts/${c.supplier_id}`} className="mt-2 inline-block text-ui-2xs font-semibold text-primary hover:underline">
                Everything {c.supplier} holds →
              </Link>
            </div>
          )}
          <p className="text-ui-3xs leading-relaxed text-base-dark">{c.provenance}</p>
        </aside>
      </div>
    </div>
  );
}

function Fact({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[7rem_1fr] gap-3 py-2">
      <dt className="text-base-dark">{k}</dt>
      <dd className="min-w-0 break-words text-ink">{v}</dd>
    </div>
  );
}

function Covers({ c }: { c: ContractDetail }) {
  const [all, setAll] = useState(false);
  if (!c.covers.length && !c.sins.length && !c.nigp) return null;
  const covers = all ? c.covers : c.covers.slice(0, 6);
  return (
    <section aria-labelledby="covers">
      <h2 id="covers" className="font-heading text-heading-md font-bold text-ink">
        What it covers
      </h2>
      {c.covers.length > 0 && (
        <ul className="mt-3 max-w-[75ch] list-disc space-y-1 pl-5 text-body-sm text-ink">
          {covers.map((x) => (
            <li key={x}>{x}</li>
          ))}
        </ul>
      )}
      {c.covers.length > covers.length && (
        <button onClick={() => setAll(true)} className="mt-1.5 text-ui-2xs font-semibold text-primary hover:underline">
          All {c.covers.length} scope lines
        </button>
      )}
      {c.sins.length > 0 && (
        <div className="mt-4">
          <h3 className="text-ui-xs font-bold text-ink">Special item numbers</h3>
          <p className="mt-0.5 max-w-[75ch] text-ui-2xs text-base-darker">State and local governments may order only the SINs GSA opens to cooperative purchasing.</p>
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {c.sins.map((s) => (
              <li key={s.code} className={`rounded-sm px-2 py-1 text-ui-3xs ${s.open ? "bg-success-lighter text-success-darker" : "bg-base-lighter text-base-darker"}`} title={s.open ? "Open to state and local governments" : "Federal buyers only"}>
                <span className="font-mono font-bold">{s.code}</span>
                {s.title ? ` ${s.title}` : ""}
                {s.open ? " · open to you" : " · federal only"}
              </li>
            ))}
          </ul>
        </div>
      )}
      {c.nigp && (
        <div className="mt-4">
          <h3 className="text-ui-xs font-bold text-ink">Commodity codes (NIGP)</h3>
          <p className="mt-0.5 max-w-[75ch] text-ui-2xs text-base-darker">
            {c.nigp.source === "published"
              ? `As ${c.program} prints them on the contract's line items.`
              : "Classes chosen by Agora's AI review from the NIGP classes in New Jersey's public records; the program doesn't publish codes. Check before relying on them."}
          </p>
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {(c.nigp.codes.length ? c.nigp.codes : c.nigp.classes).map((x) => (
              <li key={x.code}>
                <Link href={`/contracts?q=${encodeURIComponent(x.code)}`} className="inline-block rounded-sm bg-base-lighter px-2 py-1 text-ui-3xs text-base-darker no-underline hover:bg-primary-lighter" title="Every contract with this code">
                  <span className="font-mono font-bold">{x.code}</span>
                  {x.label ? ` ${x.label}` : ""}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function priceCell(i: ContractItem) {
  if (i.price != null) return <span className="font-semibold tabular-nums text-ink">{money(i.price)}</span>;
  if (i.list != null) return <span className="tabular-nums text-base-darker">List {money(i.list)}</span>;
  return <span className="text-base-dark">No price</span>;
}

function Items({ c }: { c: ContractDetail }) {
  const [find, setFind] = useState("");
  const [found, setFound] = useState<{ items: ContractItem[]; total: number } | null>(null);
  useEffect(() => {
    const q = find.trim();
    if (!q) {
      setFound(null);
      return;
    }
    let live = true;
    const t = setTimeout(() => {
      fetch(`/api/catalog/contracts?id=${encodeURIComponent(c.id)}&items=${encodeURIComponent(q)}`)
        .then((r) => r.json())
        .then((j) => live && j.contract && setFound({ items: j.contract.items, total: j.contract.items_total }))
        .catch(() => {});
    }, 200);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [find, c.id]);
  // A sample until the buyer searches: the contract is the record here, not a catalog to scroll.
  const items = found?.items ?? c.items.slice(0, 10);
  const total = found?.total ?? c.items_total;
  return (
    <section aria-labelledby="pricing">
      <h2 id="pricing" className="font-heading text-heading-md font-bold text-ink">
        Prices and items
      </h2>
      <p className="mt-2 text-body-sm font-semibold text-ink">{c.pricing.headline}</p>
      <p className="mt-1 max-w-[75ch] text-body-sm text-base-darker">{c.pricing.detail}</p>
      {c.pricing.items > 0 && (
        <div className="mt-4">
          {c.pricing.items > 10 && (
            <>
              <label htmlFor="find-item" className="sr-only">
                Search this contract's items
              </label>
              <input id="find-item" type="search" value={find} onChange={(e) => setFind(e.target.value)} placeholder={`Search ${c.pricing.items.toLocaleString()} items on this contract`} className="mb-2 w-full max-w-md text-sm" />
            </>
          )}
          <ul className="divide-y divide-base-lighter border-y border-base-lighter bg-white">
            {items.map((i) => (
              <li key={i.id} className="grid gap-x-4 gap-y-0.5 px-3 py-2.5 sm:grid-cols-[minmax(0,1fr)_auto]">
                <div className="min-w-0">
                  {i.external ? (
                    <a href={i.href} target="_blank" rel="noreferrer" className="text-body-sm text-ink hover:underline" title={`Opens this item on the site of ${c.program}`}>
                      {i.name} <span aria-hidden>↗</span>
                    </a>
                  ) : (
                    <Link href={i.href} className="text-body-sm text-ink hover:underline">
                      {i.name}
                    </Link>
                  )}
                  <div className="text-ui-3xs text-base-dark">{[i.maker, i.sku && i.sku !== i.name ? i.sku : null, i.note].filter(Boolean).join(" · ")}</div>
                </div>
                <div className="text-body-sm sm:text-right">
                  {priceCell(i)}
                  {(i.price != null || i.list != null) && i.unit && i.unit !== "each" && <span className="text-ui-3xs text-base-dark"> / {i.unit}</span>}
                </div>
              </li>
            ))}
          </ul>
          {!items.length && <p className="mt-2 text-ui-xs text-base-darker">No item on this contract matches that.</p>}
          {total > items.length && (
            <p className="mt-2 text-ui-2xs text-base-dark">
              Showing {items.length} of {total.toLocaleString()}. Search to narrow them.
            </p>
          )}
        </div>
      )}
    </section>
  );
}

function Quote({ p }: { p: Passage }) {
  return (
    <figure className="mt-2 border border-primary-light/70 bg-primary-lighter/30 px-3.5 py-2.5">
      <blockquote className="whitespace-pre-wrap text-ui-xs leading-relaxed text-ink">{p.text}</blockquote>
      <figcaption className={`${label} mt-1.5 text-base-dark`}>
        {p.document} · page {p.page}
      </figcaption>
    </figure>
  );
}

function Field({ f }: { f: BriefField }) {
  return (
    <div className="py-3.5">
      <dt className="text-ui-xs font-bold text-ink">{f.label}</dt>
      <dd className="mt-1">
        {f.summary && <p className="max-w-[68ch] text-body-sm leading-relaxed text-ink">{f.summary}</p>}
        {f.quote && <Quote p={f.quote} />}
        {!f.summary && f.passage && (
          <>
            <p className="text-ui-2xs text-base-dark">The passage that bears on this most:</p>
            <Quote p={f.passage} />
          </>
        )}
        {!f.summary && !f.passage && <p className="text-ui-xs text-base-darker">The documents Agora read don't say.</p>}
      </dd>
    </div>
  );
}

const SUGGESTED = ["Does this cover installation?", "Is there a minimum order?", "What are the payment terms?"];

function Documents({ c }: { c: ContractDetail }) {
  const { llm } = useStore();
  const [brief, setBrief] = useState<ContractBrief | null>(null);
  const [busy, setBusy] = useState<"brief" | "ask" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [turns, setTurns] = useState<{ question: string; result: ContractAnswer | null; error: string | null }[]>([]);
  const canRead = c.readable.length > 0;

  const read = async () => {
    setBusy("brief");
    setError(null);
    try {
      setBrief(await post<ContractBrief>("/api/act", { action: "briefContract", contractId: c.id }));
    } catch (e) {
      setError((e as Error).message);
    }
    setBusy(null);
  };
  const ask = async (question: string) => {
    const q = question.trim();
    if (!q || busy) return;
    setText("");
    setBusy("ask");
    let result: ContractAnswer | null = null;
    let err: string | null = null;
    try {
      result = await post<ContractAnswer>("/api/act", { action: "askContract", contractId: c.id, question: q });
    } catch (e) {
      err = (e as Error).message;
    }
    setTurns((t) => [...t, { question: q, result, error: err }]);
    setBusy(null);
  };

  return (
    <section aria-labelledby="documents">
      <h2 id="documents" className="font-heading text-heading-md font-bold text-ink">
        What the documents say
      </h2>
      {!canRead && (
        <p className="mt-2 max-w-[75ch] text-body-sm text-base-darker">
          {c.documents.length
            ? "Agora links to this contract's documents but can't read them yet, so there's no summary. Open them on the publisher's site."
            : `Agora has no document for this contract: the ${c.program} directory lists it without one, or its site doesn't allow automated reading. ${c.link ? "The contract's own page has the documents." : ""}`}
        </p>
      )}
      {c.documents.length > 0 && (
        <ul className="mt-3 space-y-1 text-ui-xs">
          {c.documents.map((d) => (
            <li key={d.url}>
              <a href={d.url} target="_blank" rel="noreferrer" className="font-semibold text-primary">
                {d.label} ↗
              </a>
              <span className="text-base-dark"> · {d.host}</span>
            </li>
          ))}
        </ul>
      )}

      {canRead && (
        <div className="mt-4 border border-primary-darker bg-white">
          <div className="flex flex-wrap items-center gap-3 border-b border-base-lighter px-5 py-4">
            <Mark className="h-7 w-7" working={busy !== null} />
            <div className="min-w-0 flex-1">
              <div className={`${label} text-primary`}>Contract brief</div>
              <p className="text-ui-xs text-base-darker">
                Agora can read {c.readable.map((d) => `${d.label}${d.held ? " (held by Agora)" : ""}`).join(" and ")}. The brief asks the same six questions of every contract, and each answer quotes the page it rests on.
              </p>
            </div>
            {!brief && (
              <button onClick={read} disabled={busy !== null} className="inline-flex items-center rounded-md bg-primary px-4 py-2.5 text-ui-xs font-bold leading-none text-white hover:bg-primary-dark disabled:opacity-60">
                {busy === "brief" ? "Reading…" : "Read this contract"}
              </button>
            )}
          </div>
          {busy === "brief" && <p className="px-5 py-4 text-ui-xs text-base-dark">Fetching and reading the document. A long contract takes up to a minute.</p>}
          {error && (
            <div className="px-5 py-4">
              <ErrorNote message={error} />
            </div>
          )}
          {brief && (
            <div className="px-5 py-2" data-testid="contract-brief">
              {brief.unread.map((u) => (
                <p key={u} className="pt-2 text-ui-2xs text-base-dark">
                  {u}
                </p>
              ))}
              {brief.note && <p className="pt-3 text-ui-xs text-base-darker">{brief.note}</p>}
              <dl className="divide-y divide-base-lighter">
                {brief.fields.map((f) => (
                  <Field key={f.id} f={f} />
                ))}
              </dl>
              {brief.read.length > 0 && (
                <p className="border-t border-base-lighter py-3 text-ui-3xs leading-relaxed text-base-dark">
                  Read: {brief.read.map((r) => `${r.label} (${r.pages} page${r.pages === 1 ? "" : "s"})`).join("; ")}. A reading of the document, not legal advice. Contact details are left out.
                </p>
              )}
              <Feedback id={brief.log_id} className="pb-3" />
            </div>
          )}

          <div className="border-t border-base-lighter px-5 py-4">
            <div className={`${label} text-primary`}>Ask this contract</div>
            {turns.map((t, i) => (
              <div key={i} className="mt-3">
                <p className="text-body-sm font-semibold text-ink">{t.question}</p>
                {t.error && <p className="mt-1 text-body-sm text-ink">{t.error}</p>}
                {t.result?.answer?.paragraphs.map((p, j) => (
                  <p key={j} className="mt-1 max-w-[68ch] text-body-sm leading-relaxed text-ink">
                    {p}
                  </p>
                ))}
                {t.result?.note && <p className="mt-1 max-w-[68ch] text-body-sm text-base-darker">{t.result.note}</p>}
                {(t.result?.answer?.quotes.length ? t.result.answer.quotes : (t.result?.passages ?? [])).slice(0, 3).map((q, j) => (
                  <Quote key={j} p={{ ...q, text: q.text.length > 600 ? `${q.text.slice(0, 600)}…` : q.text }} />
                ))}
                <Feedback id={t.result?.log_id} className="mt-2" />
              </div>
            ))}
            {busy === "ask" && <p className="mt-3 text-ui-xs text-base-dark">Reading the document for that.</p>}
            <div className="mt-3 flex flex-wrap gap-2">
              {SUGGESTED.filter((s) => !turns.some((t) => t.question === s)).map((s) => (
                <button key={s} disabled={busy !== null} onClick={() => ask(s)} className="rounded-md bg-white px-3 py-2 text-ui-2xs font-bold text-primary shadow-[inset_0_0_0_1px_theme(colors.base.light)] hover:shadow-[inset_0_0_0_2px_theme(colors.primary.DEFAULT)] disabled:opacity-60">
                  {s}
                </button>
              ))}
            </div>
            <form
              className="mt-3 flex border border-primary-darker bg-white"
              onSubmit={(e) => {
                e.preventDefault();
                void ask(text);
              }}
            >
              <label htmlFor="ask-this-contract" className="sr-only">
                Ask about this contract
              </label>
              <input id="ask-this-contract" type="text" value={text} maxLength={400} onChange={(e) => setText(e.target.value)} placeholder="Ask what the contract says" className="h-11 min-w-0 flex-1 !rounded-none !border-0 bg-transparent px-3.5 text-sm text-ink !shadow-none outline-none" />
              <button type="submit" disabled={busy !== null || !text.trim()} className="h-11 bg-[#162E51] px-4 text-sm font-bold text-white disabled:opacity-60">
                Ask →
              </button>
            </form>
            <p className="mt-2 text-ui-3xs leading-relaxed text-base-dark">
              {llm ? "Answers come only from this contract's documents, and each quote is checked against the page it cites." : "The AI connection is off, so questions return the passages that bear on them instead of an answer."}
            </p>
          </div>
        </div>
      )}
    </section>
  );
}
