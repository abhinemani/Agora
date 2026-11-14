"use client";

import { useEffect, useState } from "react";

const remembered = new Map<string, boolean>();

/** One folded source on the results page: a title, a count and a line on what it is, opened on demand.
 * A link to `#id` anywhere on the page opens it. */
export function Fold({ id, title, count, note, defaultOpen = false, children }: { id: string; title: string; count?: number | string; note?: React.ReactNode; defaultOpen?: boolean; children: React.ReactNode }) {
  // The page redraws its results after some actions (confirming a membership, changing the item);
  // a section the person opened stays open through that.
  const key = () => `${window.location.pathname}#${id}`;
  const [open, setOpenState] = useState(defaultOpen);
  const setOpen = (on: boolean) => {
    remembered.set(key(), on);
    setOpenState(on);
  };
  useEffect(() => {
    const was = remembered.get(key());
    if (was !== undefined) setOpenState(was);
    const check = () => {
      if (window.location.hash === `#${id}`) setOpen(true);
    };
    check();
    window.addEventListener("hashchange", check);
    return () => window.removeEventListener("hashchange", check);
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <section id={id} className="scroll-mt-24 border-b border-base-lighter last:border-b-0">
      <h3>
        <button type="button" aria-expanded={open} aria-controls={`${id}-body`} onClick={() => setOpen(!open)} className="flex min-h-[44px] w-full items-center gap-4 px-5 py-3.5 text-left hover:bg-base-lightest">
          <span className="w-12 shrink-0 font-heading text-heading-lg font-bold tabular-nums text-ink">{count ?? ""}</span>
          <span className="min-w-0 flex-1">
            <span className="block text-body-sm font-bold text-ink">{title}</span>
            {note && <span className="block text-ui-2xs font-normal text-base-dark">{note}</span>}
          </span>
          <span className="shrink-0 whitespace-nowrap text-ui-xs font-bold text-primary">{open ? "Hide" : "Show"}</span>
        </button>
      </h3>
      {open && (
        <div id={`${id}-body`} className="border-t border-base-lighter px-5 py-5">
          {children}
        </div>
      )}
    </section>
  );
}

/** The folded sources, as one bordered list under a heading. */
export function FoldGroup({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <h2 className="font-heading text-heading-lg font-bold text-ink">{title}</h2>
        {note && <p className="text-ui-xs text-base-dark">{note}</p>}
      </div>
      <div className="border border-base-light bg-white">{children}</div>
    </div>
  );
}
