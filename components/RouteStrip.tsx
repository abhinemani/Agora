"use client";

import type { Results } from "@/lib/assistant";
import m3 from "@/lib/m3-theme.json";
import { SOURCE_HEX } from "./ui";

interface Segment {
  key: string;
  label: string;
  count: number;
  color: string;
  href: string;
  /** Contracts the agency would have to join first: drawn open rather than solid. */
  open?: boolean;
}

/** "Where you can buy this": every route for the request, in the order to try them.
 * Contract segments count products; co-op segments count contracts, as the co-op section does. */
export function RouteStrip({ results }: { results: Results }) {
  const options = results.groups.flatMap((g) => g.options);
  const n = (src: string) => options.filter((o) => o.group === src).length;
  const known = Boolean(results.buyer);
  const coopOn = results.coops.hits.filter((h) => h.member && h.eligible).length;
  const coopJoin = results.coops.hits.filter((h) => !h.member).length;
  const segments: Segment[] = [
    { key: "own", label: known ? "Your contracts" : "Agency contracts", count: results.own_contracts.length + n("own_contract"), color: SOURCE_HEX.own_contract, href: results.own_contracts.length ? "#own-contracts" : "#options" },
    { key: "state", label: "State", count: n("state_contract"), color: SOURCE_HEX.state_contract, href: "#options" },
    ...(known
      ? [
          { key: "coop", label: "Your co-ops", count: coopOn, color: SOURCE_HEX.coop_contract, href: "#coops" },
          { key: "join", label: "Co-ops to join", count: coopJoin, color: SOURCE_HEX.coop_contract, href: "#coops", open: true },
        ]
      : [{ key: "coop", label: "Co-ops", count: results.coops.hits.length, color: SOURCE_HEX.coop_contract, href: "#coops" }]),
    { key: "other", label: "Other ways", count: n("reseller") + n("gsa") + n("no_approval") + results.contract_leads.length, color: SOURCE_HEX.reseller, href: "#options" },
  ];
  const first = segments.find((s) => s.count > 0 && !s.open);

  return (
    <nav aria-label="Where you can buy this" className="rounded-xl bg-surface-container-low px-4 py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-title-m text-on-surface">Where you can buy this</h2>
        <p className="text-xs text-slate">{first ? `Start with ${first.label.toLowerCase()}.` : "Nothing on contract yet."} Try routes left to right.</p>
      </div>
      <ol className="mt-3 grid grid-cols-2 gap-2 sm:flex sm:gap-0">
        {segments.map((s, i) => (
          <li key={s.key} className="flex min-w-0 flex-1 items-stretch">
            <a
              href={s.href}
              className={`state-layer flex min-w-0 flex-1 flex-col rounded-lg px-3 py-2 ${s.count ? "" : "opacity-50"}`}
              aria-label={`${s.label}: ${s.count}`}
            >
              <span
                className="h-1.5 rounded-full"
                style={s.open ? { border: `1.5px dashed ${s.color}`, background: "transparent", height: 6 } : { background: s.count ? s.color : m3.roles["outline-variant"] }}
                aria-hidden
              />
              <span className="mt-2 text-headline-m tabular-nums text-on-surface">{s.count}</span>
              <span className="truncate text-label-l" style={{ color: s.count ? s.color : undefined }}>
                {s.label}
              </span>
            </a>
            {i < segments.length - 1 && (
              <span className="hidden items-center px-0.5 text-steel sm:flex" aria-hidden>
                ›
              </span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}
