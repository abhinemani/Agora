"use client";

import Link from "next/link";
import { useState } from "react";
import { isContractLevelUrl } from "@/lib/coops";
import { EDGE_TIER, FIVE_WAYS, REVENUE_OPTIONS } from "@/lib/revenue_rules";
import type { Payer } from "@/lib/types";
import { useStore } from "./store";
import { Button, Checkbox, money } from "./ui";

const PAYER_LABEL: Record<Payer, string> = {
  local_government: "Local government",
  supplier: "Supplier",
  card_network: "Card network",
  partner: "Partner",
};

export function Ledger() {
  const { db, ledgerOpen, setLedgerOpen, act, showEarn, setShowEarn, llm } = useStore();
  const [resetting, setResetting] = useState(false);
  const [view, setView] = useState<"events" | "totals" | "coops">("events");
  if (!ledgerOpen || !db) return null;

  const events = db.revenue;
  const total = events.reduce((n, e) => n + e.amount, 0);
  const byOption = Object.entries(REVENUE_OPTIONS).map(([k, def]) => {
    const opt = Number(k);
    const evts = events.filter((e) => e.option === opt);
    return { opt, def, count: evts.length, amount: evts.reduce((n, e) => n + e.amount, 0) };
  });
  const byPayer = (Object.keys(PAYER_LABEL) as Payer[]).map((p) => ({ p, amount: events.filter((e) => e.payer === p).reduce((n, e) => n + e.amount, 0) }));
  const fired = byOption.filter((o) => o.count > 0).length;
  const credits = -events.filter((e) => e.option === 1 && e.amount < 0).reduce((n, e) => n + e.amount, 0);
  const sumOf = (opts: number[]) => events.filter((e) => opts.includes(e.option)).reduce((n, e) => n + e.amount, 0);

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button aria-label="Close ledger" className="absolute inset-0 bg-ink/[.32]" onClick={() => setLedgerOpen(false)} />
      <aside className="relative flex h-full w-full max-w-xl flex-col bg-white shadow-5">
        <div className="border-b border-line px-5 py-4">
          <div className="flex items-start justify-between">
            <div>
              <div className="text-sm text-slate">Sovra revenue, demo</div>
              <div className="mt-1 text-3xl font-semibold tabular-nums text-navy">{money(total)}</div>
              <div className="mt-1 text-xs text-slate">
                {events.length} events · {fired} of 10 revenue options fired · <span className="italic">Placeholder pricing</span>
              </div>
            </div>
            <button onClick={() => setLedgerOpen(false)} className="rounded px-2 py-1 text-slate hover:bg-tint hover:text-navy" aria-label="Close">
              ✕
            </button>
          </div>
          <div className="mt-4 flex gap-1 text-xs">
            {(["events", "totals", "coops"] as const).map((v) => (
              <button key={v} onClick={() => setView(v)} className={`rounded px-3 py-1 font-semibold ${view === v ? "bg-tint text-navy" : "text-slate hover:text-navy"}`}>
                {v === "events" ? "Events" : v === "totals" ? "Totals" : "Co-op traffic"}
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {view === "coops" ? (
            <CoopTraffic />
          ) : view === "events" ? (
            <ul className="divide-y divide-navy/5">
              {events.map((e) => (
                <li key={e.id} className="flex gap-3 px-5 py-3">
                  <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-maroon text-xs font-bold text-white">{e.option}</span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-sm font-semibold text-navy">{e.option_name}</span>
                      <span className={`text-sm font-semibold tabular-nums ${e.amount < 0 ? "text-emerald-700" : "text-navy"}`}>{money(e.amount)}</span>
                    </div>
                    <div className="text-xs text-slate">{e.trigger}</div>
                    <div className="mt-0.5 text-[11px] text-steel">
                      {PAYER_LABEL[e.payer]} pays · {new Date(e.created_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" })}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <div className="space-y-6 px-5 py-4">
              <section>
                <h3 className="mb-2 text-xs font-semibold text-slate">Revenue per city marketplace adds up five ways</h3>
                <div className="divide-y divide-navy/5 rounded-lg bg-tint px-3">
                  {FIVE_WAYS.map((w, i) => (
                    <div key={w.label} className="flex items-center gap-3 py-2 text-sm">
                      <span className="w-3 text-rose">{i ? "+" : ""}</span>
                      <span className="flex-1">
                        <span className="text-navy">{w.label}</span>
                        <span className="block text-[11px] text-slate">options {w.options.join(", ")}</span>
                      </span>
                      <span className="font-semibold tabular-nums">{money(sumOf(w.options))}</span>
                    </div>
                  ))}
                </div>
                <p className="mt-2 text-xs text-slate">
                  Riverbend's net subscription this month: <span className="font-semibold text-navy">{money(2000 - credits)}</span> ($2,000 less {money(credits)} in credits).
                </p>
              </section>
              <section>
                <h3 className="mb-2 text-xs font-semibold text-slate">By option</h3>
                <table className="w-full text-sm">
                  <tbody>
                    {byOption.map((o) => (
                      <tr key={o.opt} className={`border-b border-navy/5 ${o.count ? "" : "text-steel"}`}>
                        <td className="w-8 py-2 font-semibold">{o.opt}</td>
                        <td className="py-2">
                          <div className="font-semibold">
                            {o.def.name}
                            {EDGE_TIER[o.opt] && <span className="ml-1.5 rounded bg-navy-50 px-1 py-px text-[10px] font-semibold text-navy">Edge {EDGE_TIER[o.opt]}</span>}
                          </div>
                          <div className="text-[11px] text-slate">{o.def.rule}</div>
                        </td>
                        <td className="py-2 text-right text-xs">{o.count}×</td>
                        <td className="py-2 text-right font-semibold tabular-nums">{money(o.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
              <section>
                <h3 className="mb-2 text-xs font-semibold text-slate">By payer</h3>
                <div className="space-y-2">
                  {byPayer.map(({ p, amount }) => (
                    <div key={p}>
                      <div className="flex justify-between text-sm">
                        <span>{PAYER_LABEL[p]}</span>
                        <span className="font-semibold tabular-nums">{money(amount)}</span>
                      </div>
                      <div className="mt-1 h-1.5 rounded bg-tint">
                        <div className="h-1.5 rounded bg-primary" style={{ width: `${total > 0 ? Math.max(0, (amount / total) * 100) : 0}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
              </section>
              <Link href="/model" onClick={() => setLedgerOpen(false)} className="block rounded-lg border border-maroon/30 bg-maroon-50 p-3 text-sm font-semibold text-maroon hover:bg-maroon-50/70">
                See the value chain and flywheel, live →
              </Link>
              <p className="text-xs text-slate">
                Co-op and reseller orders carry listing fees only, no transaction fee (open question 12.1, default). Subscription credits are shown as negative option 1 lines.
              </p>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-navy/10 px-5 py-3">
          <div className="space-y-1 text-xs text-slate">
            <label className="flex cursor-pointer items-center gap-2">
              <input type="checkbox" className="!p-0" checked={showEarn} onChange={(e) => setShowEarn(e.target.checked)} />
              Show revenue badges across Agora
            </label>
            <div>
              Placeholder pricing. {llm ? "Requests and contracts are read by Claude." : "Offline parsing: no API key is set."}
            </div>
          </div>
          <Button
            variant="secondary"
            disabled={resetting}
            onClick={async () => {
              setResetting(true);
              await act("reset");
              setResetting(false);
              setLedgerOpen(false);
              window.location.href = "/";
            }}
          >
            {resetting ? "Resetting…" : "Reset demo"}
          </Button>
        </div>
      </aside>
    </div>
  );
}

const LIST_STATUS = { none: "No member list", partial: "Partial member list", full: "Member list shared" } as const;

/** Sovra ops: outbound clicks per co-op, and whether each co-op's members may buy in Agora. */
function CoopTraffic() {
  const { db, act } = useStore();
  const [busy, setBusy] = useState<string | null>(null);
  if (!db) return null;
  const contractById = new Map(db.contracts.map((c) => [c.id, c]));
  return (
    <div className="space-y-6 px-5 py-4">
      <p className="text-xs text-slate">
        <span className="font-semibold text-navy">{db.requests.length} search{db.requests.length === 1 ? "" : "es"}</span> this session. Co-op results send buyers to the co-op's own contract page through a tracked link, so each co-op can see the traffic Sovra sends it. Buying inside Agora stays off until a co-op agrees.
      </p>
      <section className="space-y-3">
        {db.coops.map((coop) => {
          const contracts = db.contracts.filter((c) => c.coop_id === coop.id);
          const clicks = db.clicks.filter((k) => k.coop_id === coop.id);
          const shown = db.impressions.filter((i) => i.coop_id === coop.id).length;
          const referred = db.referrals.filter((r) => r.coop_id === coop.id).length;
          const missing = contracts.filter((c) => !isContractLevelUrl(c.source_url)).length;
          return (
            <div key={coop.id} className="rounded-lg border border-line p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-navy">{coop.name}</div>
                  <div className="text-[11px] text-slate">
                    {contracts.length} contract{contracts.length === 1 ? "" : "s"} · {LIST_STATUS[coop.member_list_status]}
                    {coop.member_list_source === "demo" && " (demo)"} · {db.memberships.filter((m) => m.coop_id === coop.id).length} agencies matched
                    {missing > 0 && <span className="text-amber-700"> · {missing} without a contract-level link</span>}
                  </div>
                  <div className="mt-1 text-[11px] text-steel">{coop.note}</div>
                </div>
                <div className="flex gap-4 text-right">
                  {(
                    [
                      [shown, "shown"],
                      [clicks.length, "clicks"],
                      [referred, "join asks"],
                    ] as const
                  ).map(([n, label]) => (
                    <div key={label}>
                      <div className="text-xl font-semibold tabular-nums text-navy">{n}</div>
                      <div className="text-[10px] text-slate">{label}</div>
                    </div>
                  ))}
                </div>
              </div>
              <div className="mt-3">
                <Checkbox
                  checked={coop.buy_in_agora}
                  disabled={busy === coop.id}
                  onChange={async (on) => {
                    setBusy(coop.id);
                    await act("setCoopBuyInAgora", { coopId: coop.id, on });
                    setBusy(null);
                  }}
                  label="Members may buy inside Agora (the co-op has agreed)"
                />
              </div>
            </div>
          );
        })}
      </section>
      <Link href="/coops" className="block text-xs font-semibold text-maroon hover:underline">
        Upload or update co-op member lists
      </Link>
      <section>
        <h3 className="mb-2 text-xs font-semibold text-slate">Recent clicks</h3>
        {db.clicks.length ? (
          <ul className="divide-y divide-navy/5 text-xs">
            {db.clicks.slice(0, 20).map((k) => {
              const c = contractById.get(k.contract_id);
              return (
                <li key={k.id} className="flex justify-between gap-3 py-2">
                  <span className="min-w-0 text-navy">
                    {c?.vehicle} {c?.contract_number}
                    <span className="block text-[11px] text-slate">{k.buyer_name ?? "No agency set"}</span>
                  </span>
                  <span className="shrink-0 text-slate">{new Date(k.created_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</span>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-xs text-slate">No clicks yet. Search for something on a co-op contract and choose Buy on the co-op.</p>
        )}
      </section>
    </div>
  );
}
