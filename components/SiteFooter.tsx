"use client";

import { Mark } from "./blueprint";
import { useStore } from "./store";

/** The site footer as a drawing's title block: the mark, the catalog's real counts, and
 * where the prices come from. Every number is computed from the data, never typed in. */
export function SiteFooter() {
  const { db } = useStore();
  const cells: [string, string][] = db
    ? [
        ["Contracts", db.contracts.length.toLocaleString()],
        ["Suppliers", new Set(db.listings.map((l) => l.supplier_id)).size.toLocaleString()],
        ["Products", new Set(db.listings.map((l) => l.family ?? l.id)).size.toLocaleString()],
        ["Vehicles", new Set(db.contracts.map((c) => c.vehicle).filter((v) => !!v && v !== "Reseller")).size.toLocaleString()],
      ]
    : [];
  return (
    <footer className="mt-10 border-t border-base-lighter bg-base-lightest px-4 py-8">
      <div className="mx-auto max-w-6xl">
        <div className="grid grid-cols-2 border border-base-light bg-white sm:grid-cols-[minmax(0,1.6fr)_repeat(4,minmax(0,1fr))]">
          <div className="col-span-2 flex items-center gap-3 border-b border-base-light p-4 sm:col-span-1 sm:border-b-0">
            <Mark className="h-8 w-8" />
            <div className="min-w-0">
              <div className="text-ui-sm font-bold leading-tight text-ink">Agora</div>
              <div className="font-mono text-[11px] uppercase tracking-[0.14em] text-base-dark">Sheet A-01 · Cooperative purchasing concept</div>
            </div>
          </div>
          {cells.map(([label, n], i) => (
            <div key={label} className={`p-4 ${i % 2 ? "border-l border-base-light" : ""} ${i < 2 ? "border-b border-base-light sm:border-b-0" : ""} ${i % 2 === 0 ? "sm:border-l sm:border-base-light" : ""}`}>
              <div className="font-mono text-[11px] uppercase tracking-[0.14em] text-base-dark">{label}</div>
              <div className="mt-1 text-xl font-bold tabular-nums text-ink">{n}</div>
            </div>
          ))}
        </div>
        <p className="mt-4 text-ui-3xs leading-relaxed text-base-dark">
          Tyler and Maximus prices from NASPO ValuePoint and NJSTART price files · NASPO awards from naspovaluepoint.org · Sourcewell prices require a vendor quote
        </p>
      </div>
    </footer>
  );
}
