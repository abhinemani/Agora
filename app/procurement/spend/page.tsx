"use client";

import { useStore } from "@/components/store";
import { Badge, Button, Card, Loading, PageTitle, compact, money } from "@/components/ui";
import { NO_CONTRACT_CATEGORIES, OFF_CONTRACT_TOTAL, PEER_PRICES, PRICE_CHECKS, SPEND_BY_SOURCE } from "@/lib/spend";

export default function Spend() {
  const { db, act } = useStore();
  if (!db) return <Loading />;

  const live = (key: string) => db.orders.filter((o) => db.listings.find((l) => l.id === o.listing_id)?.source === key).reduce((n, o) => n + o.total, 0);
  const rows = SPEND_BY_SOURCE.map((r) => ({ ...r, amount: r.amount + live(r.key) }));
  const max = Math.max(...rows.map((r) => r.amount));
  const total = rows.reduce((n, r) => n + r.amount, 0);
  const pending = db.orders.filter((o) => o.status === "pending_approval");

  return (
    <div className="space-y-6">
      <PageTitle eyebrow="Spend intelligence" title="Where Riverbend's money goes">
        Fiscal year to date, including orders placed in this demo. {compact(total)} total.
      </PageTitle>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="p-5 lg:col-span-2">
          <h2 className="text-sm font-semibold text-navy">Spend by source</h2>
          <div className="mt-4 space-y-3">
            {rows.map((r) => (
              <div key={r.key} className="grid grid-cols-[10rem_1fr_5rem] items-center gap-3 text-sm">
                <span className="text-slate">{r.label}</span>
                <div className="h-3 rounded bg-tint">
                  <div className="h-3 rounded bg-navy" style={{ width: `${(r.amount / max) * 100}%` }} />
                </div>
                <span className="text-right font-semibold tabular-nums text-navy">{compact(r.amount)}</span>
              </div>
            ))}
          </div>
        </Card>
        <Card className="p-5">
          <h2 className="text-sm font-semibold text-navy">Off-contract spend</h2>
          <div className="mt-2 text-3xl font-bold text-maroon">{compact(OFF_CONTRACT_TOTAL)}</div>
          <div className="text-xs text-slate">Top five categories with no contract</div>
          <ul className="mt-3 space-y-2">
            {NO_CONTRACT_CATEGORIES.map((c) => (
              <li key={c.category} className="text-sm">
                <div className="flex justify-between">
                  <span className="font-semibold text-navy">{c.category}</span>
                  <span className="tabular-nums">{compact(c.amount)}</span>
                </div>
                <div className="text-xs text-slate">{c.note}</div>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="p-5">
          <h2 className="text-sm font-semibold text-navy">Price paid vs. contract price</h2>
          <table className="mt-3 w-full text-sm">
            <thead className="text-left text-xs text-slate">
              <tr>
                <th className="pb-2 font-semibold">Item</th>
                <th className="pb-2 text-right font-semibold">Contract</th>
                <th className="pb-2 text-right font-semibold">Paid</th>
                <th className="pb-2" />
              </tr>
            </thead>
            <tbody>
              {PRICE_CHECKS.map((p) => {
                const over = p.paid > p.contract;
                return (
                  <tr key={p.item} className={`border-t border-navy/5 ${over ? "bg-maroon-50/50" : ""}`}>
                    <td className="py-2">
                      <div className="text-navy">{p.item}</div>
                      <div className="text-xs text-slate">
                        {p.supplier} · {p.invoices} invoices
                      </div>
                    </td>
                    <td className="py-2 text-right tabular-nums">{money(p.contract)}</td>
                    <td className={`py-2 text-right tabular-nums ${over ? "font-semibold text-maroon" : ""}`}>{money(p.paid)}</td>
                    <td className="py-2 pl-2 text-right">{over ? <Badge tone="maroon">Overcharge +{money(p.paid - p.contract)}/unit</Badge> : <Badge tone="green">OK</Badge>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
        <Card className="p-5">
          <h2 className="text-sm font-semibold text-navy">What peers pay</h2>
          <div className="mt-3 space-y-4">
            {PEER_PRICES.map((p) => (
              <div key={p.item}>
                <div className="flex justify-between text-sm">
                  <span className="font-semibold text-navy">{p.item}</span>
                  <span className="tabular-nums">Riverbend {money(p.ours)}</span>
                </div>
                <div className="mt-1 flex flex-wrap gap-2">
                  {p.peers.map((x) => (
                    <span key={x.agency} className={`rounded px-2 py-0.5 text-xs ${x.price < p.ours ? "bg-amber-50 text-amber-800" : "bg-tint text-slate"}`}>
                      {x.agency} {money(x.price)}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <Card className="p-5">
        <h2 className="text-sm font-semibold text-navy">Pending approvals ({pending.length})</h2>
        <div className="mt-3 divide-y divide-navy/5">
          {pending.map((o) => {
            const l = db.listings.find((x) => x.id === o.listing_id)!;
            return (
              <div key={o.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                <span>
                  {o.id} · {o.quantity} × {l.title}
                </span>
                <span className="flex items-center gap-3">
                  <span className="font-semibold">{money(o.total)}</span>
                  <Button variant="secondary" onClick={() => act("approveOrder", { orderId: o.id })}>
                    Approve
                  </Button>
                </span>
              </div>
            );
          })}
          {!pending.length && <div className="py-2 text-sm text-slate">No POs waiting.</div>}
        </div>
      </Card>
    </div>
  );
}
