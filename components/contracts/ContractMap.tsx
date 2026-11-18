"use client";

// How one contract fits together, drawn as a tree: the program, the award it was let
// under (or the master agreement it adopts), this supplier's contract, then its key
// sections and its documents by role. The outline is read lazily, since it may need
// the document store.

import Link from "next/link";
import { useEffect, useState } from "react";
import { contractHref, shortDate } from "@/components/ContractBits";
import type { ContractDetail } from "@/lib/contracts";
import type { Outline, OutlineSection, Topic } from "@/lib/doc-outline";
import { letBy, Nest, NodeTag, Twig } from "./Nest";

// Mirrors TOPIC_LABEL in lib/doc-outline.ts, which is server-only.
const TOPIC: Record<Topic, string> = {
  ordering: "How to order",
  eligibility: "Who may use it",
  pricing: "Pricing",
  payment: "Invoices and payment",
  term: "Term and renewal",
  scope: "What it covers",
  delivery: "Delivery",
  warranty: "Warranty",
  insurance: "Insurance",
  termination: "Termination",
};

const BASIS: Record<NonNullable<ContractDetail["family"]["master"]>["basis"], string> = {
  named: "The addendum names this master agreement.",
  matched: "Matched by supplier and title. Confirm the master's number in the addendum before relying on it.",
  program_only: "The addendum names the program but not which master agreement; it isn't in Agora's catalog by number.",
  text: "As the contract record names it.",
};

export function ContractMap({ c, onAsk }: { c: ContractDetail; onAsk?: (question: string) => void }) {
  const [outline, setOutline] = useState<Outline | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    setOutline(undefined);
    fetch(`/api/catalog/contracts?id=${encodeURIComponent(c.id)}&outline=1`)
      .then((r) => r.json())
      .then((j) => live && setOutline(j.outline ?? null))
      .catch(() => live && setOutline(null));
    return () => {
      live = false;
    };
  }, [c.id]);

  const f = c.family;
  const here = <Here c={c} outline={outline} onAsk={onAsk} />;
  let middle: React.ReactNode;
  if (f.master) {
    middle = (
      <Twig path>
        <Node tag="Master agreement">
          {f.master.id ? (
            <Link href={contractHref(f.master.id)} className="font-semibold text-primary">
              {f.master.program} {f.master.number}
            </Link>
          ) : (
            <span className="font-semibold text-ink">
              {f.master.program}
              {f.master.number ? ` ${f.master.number}` : ""}
            </span>
          )}
        </Node>
        <div className="mb-2 max-w-[68ch] text-ui-2xs text-base-darker">
          {[f.master.title, f.master.supplier].filter(Boolean).join(" · ")}
          {f.master.title || f.master.supplier ? ". " : ""}
          {BASIS[f.master.basis]}
        </div>
        <Nest>
          <Twig path>
            <Node tag="State addendum" here>
              <span className="font-semibold text-ink">This contract</span>
            </Node>
            {here}
          </Twig>
        </Nest>
      </Twig>
    );
  } else if (f.award) {
    const others = f.award.size - 1;
    middle = (
      <Twig path>
        <Node tag={f.award.label.startsWith("Contracts ") ? "Award" : f.award.label.split(" ")[0]}>
          <Link href={`/contracts?award=${encodeURIComponent(f.award.key)}`} className="font-semibold text-primary">
            {f.award.label.replace(/^(Award|Solicitation|Contract) /, "")}
          </Link>
          <span className="min-w-0 truncate text-ui-xs text-ink" title={f.award.title}>
            {f.award.title}
          </span>
        </Node>
        <div className="mb-2 text-ui-2xs text-base-darker">
          {others.toLocaleString()} other supplier
          {others === 1 ? " holds" : "s hold"} a contract on the same award
          {f.award.lead ? `, ${letBy(f.award.lead)}` : ""}. The terms are shared; the supplier, its prices and its documents differ.
        </div>
        <Nest>
          <Twig path>
            <Node tag="This contract" here>
              <span className="font-semibold text-ink">{c.supplier}</span>
              <span className="font-mono text-ui-2xs text-base-darker">{c.number}</span>
            </Node>
            {here}
          </Twig>
          <Twig>
            <Node tag={`${others.toLocaleString()} other${others === 1 ? "" : "s"}`}>
              <span className="min-w-0 text-ui-xs text-base-darker">
                {f.award.others.map((o, i) => (
                  <span key={o.id}>
                    {i > 0 && ", "}
                    <Link href={contractHref(o.id)} className="text-ink underline decoration-base-light underline-offset-2 hover:text-primary">
                      {o.supplier || o.number}
                    </Link>
                  </span>
                ))}
                {others > f.award.others.length && (
                  <>
                    {" "}
                    and {(others - f.award.others.length).toLocaleString()} more.{" "}
                    <Link href={`/contracts?award=${encodeURIComponent(f.award.key)}`} className="font-semibold text-primary">
                      See all →
                    </Link>
                  </>
                )}
              </span>
            </Node>
          </Twig>
        </Nest>
      </Twig>
    );
  } else {
    middle = (
      <Twig path>
        <Node tag="This contract" here>
          <span className="font-semibold text-ink">{c.supplier}</span>
          <span className="font-mono text-ui-2xs text-base-darker">{c.number}</span>
        </Node>
        {here}
      </Twig>
    );
  }

  return (
    <section aria-labelledby="fits-together">
      <h2 id="fits-together" className="font-heading text-heading-md font-bold text-ink">
        How it fits together
      </h2>
      <p className="mt-1 max-w-[68ch] text-body-sm text-base-darker">
        Read top down: the program, {f.master ? "the master agreement this contract adopts" : f.award ? "the award the contract was let under" : "the contract"}, then{" "}
        {f.master || f.award ? "this supplier's contract and " : ""}the sections and documents that make it up.
      </p>
      <div className="mt-4 rounded-md border border-base-lighter bg-white px-4 py-3">
        <Nest root label="How this contract fits together">
          <Twig>
            <Node tag="Program">
              {c.program_href ? (
                <Link href={c.program_href} className="font-semibold text-ink underline decoration-base-light underline-offset-2 hover:text-primary">
                  {c.program}
                </Link>
              ) : (
                <span className="font-semibold text-ink">{c.program}</span>
              )}
              <span className="text-ui-2xs text-base-darker">{c.kind_label}</span>
            </Node>
            <Nest>{middle}</Nest>
          </Twig>
        </Nest>
      </div>
    </section>
  );
}

function Node({ tag, here, children }: { tag: string; here?: boolean; children: React.ReactNode }) {
  return (
    <div className={`flex min-h-[2rem] min-w-0 flex-wrap items-center gap-x-2.5 gap-y-0.5 ${here ? "text-primary" : ""}`}>
      <NodeTag here={here}>{tag}</NodeTag>
      {children}
    </div>
  );
}

/** This contract's own parts: its key sections, its documents by role, and what adopts it. */
function Here({ c, outline, onAsk }: { c: ContractDetail; outline: Outline | null | undefined; onAsk?: (q: string) => void }) {
  const f = c.family;
  const term = [c.term.start ? `from ${shortDate(c.term.start)}` : null, c.term.end ? `through ${shortDate(c.term.end)}` : null].filter(Boolean).join(" ");
  const empty = !outline && !c.document_groups.length && !f.addenda.length && !f.states;
  return (
    <>
      {term && <div className="mb-1 text-ui-2xs text-base-darker">{term[0].toUpperCase() + term.slice(1)}.</div>}
      {empty ? (
        outline === undefined ? null : (
          <p className="pb-2 text-ui-2xs text-base-dark">No documents on file for this contract.</p>
        )
      ) : (
        <Nest className="pb-1">
          {outline && (
            <Twig>
              <KeySections outline={outline} canAsk={c.readable.length > 0 && Boolean(onAsk)} onAsk={onAsk} />
            </Twig>
          )}
          {c.document_groups.map((g) => (
            <Twig key={g.role}>
              <DocGroupNode g={g} />
            </Twig>
          ))}
          {f.addenda.length > 0 && (
            <Twig>
              <Node tag="Adopted by">
                <span className="text-ui-xs text-ink">
                  {f.addenda.length} state addend
                  {f.addenda.length === 1 ? "um" : "a"} in Agora
                </span>
              </Node>
              <ul className="mb-2 space-y-0.5 text-ui-2xs">
                {f.addenda.map((a) => (
                  <li key={a.id}>
                    <Link href={contractHref(a.id)} className="font-semibold text-primary">
                      {a.program} <span className="font-mono font-normal">{a.number}</span>
                    </Link>
                    <span className="text-base-darker"> · {a.title}</span>
                  </li>
                ))}
              </ul>
            </Twig>
          )}
          {f.states && (
            <Twig>
              <Node tag="Participating addenda">
                <span className="text-ui-xs text-ink">
                  Signed by {f.states.length} state
                  {f.states.length === 1 ? "" : "s"}
                </span>
              </Node>
              <ul className="mb-2 flex flex-wrap gap-1">
                {f.states.map((s) => (
                  <li key={s} className="rounded-sm bg-base-lighter px-1.5 py-0.5 font-mono text-ui-3xs text-base-darker">
                    {s}
                  </li>
                ))}
              </ul>
            </Twig>
          )}
        </Nest>
      )}
    </>
  );
}

/** The sections a buyer reads first, by topic, then the whole outline on request. */
function KeySections({ outline, canAsk, onAsk }: { outline: Outline; canAsk: boolean; onAsk?: (q: string) => void }) {
  const [all, setAll] = useState(false);
  const seen = new Set<Topic>();
  const key: OutlineSection[] = [];
  for (const s of outline.sections) if (s.topic && !seen.has(s.topic) && key.length < 8) (seen.add(s.topic), key.push(s));
  const ask = (s: OutlineSection) => onAsk?.(`What does ${s.num ? `section ${s.num}, ` : ""}“${s.title}”, say?`);
  return (
    <>
      <Node tag="Key sections">
        <span className="min-w-0 truncate text-ui-xs text-ink" title={outline.document}>
          of the {outline.document.replace(/^Award \d+: /, "").toLowerCase()} ({outline.pages} pages)
        </span>
      </Node>
      {key.length > 0 && (
        <ul className="mb-1.5 divide-y divide-base-lighter rounded-sm border border-base-lighter">
          {key.map((s, i) => (
            <li key={i} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 px-2.5 py-1.5 text-ui-2xs">
              <span className="w-28 shrink-0 font-bold text-ink">{TOPIC[s.topic!]}</span>
              <span className="min-w-0 flex-1 text-ink">
                {s.num && <span className="mr-1.5 font-mono text-base-darker">{s.num}</span>}
                {s.title}
              </span>
              {s.page != null && <span className="shrink-0 tabular-nums text-base-dark">p. {s.page}</span>}
              {canAsk && (
                <button onClick={() => ask(s)} className="shrink-0 font-semibold text-primary hover:underline">
                  Ask about it
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      <button onClick={() => setAll(!all)} aria-expanded={all} className="mb-2 text-ui-2xs font-semibold text-primary hover:underline">
        {all ? "Hide the outline" : `The whole outline (${outline.sections.length} sections${outline.from === "headings" ? ", from its headings" : ""})`}
      </button>
      {all && (
        <ol className="mb-2 max-h-80 overflow-y-auto rounded-sm border border-base-lighter bg-base-lightest/40 px-3 py-2 text-ui-2xs">
          {outline.sections.map((s, i) => (
            <li key={i} className={`flex gap-2 py-0.5 ${s.level === 2 ? "pl-5 text-base-darker" : "font-semibold text-ink"}`}>
              <span className="w-10 shrink-0 font-mono">{s.num}</span>
              <span className="min-w-0 flex-1">{s.title}</span>
              {s.page != null && <span className="shrink-0 tabular-nums text-base-dark">{s.page}</span>}
            </li>
          ))}
        </ol>
      )}
    </>
  );
}

function DocGroupNode({ g }: { g: ContractDetail["document_groups"][number] }) {
  const [open, setOpen] = useState(g.role === "agreement" || g.role === "addendum");
  const [all, setAll] = useState(false);
  const shown = all ? g.docs : g.docs.slice(0, 6);
  return (
    <>
      <div className="flex min-h-[2rem] items-center">
        <button onClick={() => setOpen(!open)} aria-expanded={open} className="flex min-w-0 items-center gap-2.5 text-left">
          <NodeTag>{g.label}</NodeTag>
          <span className="text-ui-2xs text-base-darker">
            {g.docs.length} document{g.docs.length === 1 ? "" : "s"}
          </span>
          <span aria-hidden className={`text-ui-3xs text-base-dark transition-transform ${open ? "rotate-90" : ""}`}>
            ▸
          </span>
        </button>
      </div>
      {open && (
        <div className="mb-2">
          {g.note && <p className="mb-1 text-ui-3xs text-base-dark">{g.note}</p>}
          <ol className={`space-y-0.5 text-ui-2xs ${g.role === "amendment" ? "border-l-2 border-primary-lighter pl-3" : ""}`}>
            {shown.map((d, i) => (
              <li key={`${d.url}|${i}`} className="flex min-w-0 items-baseline gap-2">
                <a href={d.url} target="_blank" rel="noreferrer" className="min-w-0 truncate font-semibold text-primary" title={d.label}>
                  {d.label} ↗
                </a>
                <span className="shrink-0 text-base-dark">{d.host}</span>
              </li>
            ))}
          </ol>
          {g.docs.length > shown.length && (
            <button onClick={() => setAll(true)} className="mt-1 text-ui-2xs font-semibold text-primary hover:underline">
              All {g.docs.length}
            </button>
          )}
        </div>
      )}
    </>
  );
}
