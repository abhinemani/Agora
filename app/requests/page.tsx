"use client";

import Link from "next/link";
import { useStore } from "@/components/store";
import { ORDER_STATUS } from "@/lib/orders";
import { Badge, Card, Loading, PageTitle, money } from "@/components/ui";

const STATUS = ORDER_STATUS;

export default function MyRequests() {
  const { db } = useStore();
  if (!db) return <Loading />;
  return (
    <div>
      <PageTitle eyebrow="Check a request" title="My requests and orders">
        Everything you've asked for this session, and where each one stands.
      </PageTitle>
      <div className="grid gap-6 md:grid-cols-2">
        <section>
          <h2 className="mb-2 text-sm font-semibold text-slate">Orders</h2>
          <Card className="divide-y divide-navy/5">
            {db.orders.map((o) => {
              const l = db.listings.find((x) => x.id === o.listing_id);
              return (
                <Link key={o.id} href={`/orders/${o.id}`} className="flex items-center justify-between gap-3 p-4 hover:bg-tint/50">
                  <div>
                    <div className="text-sm font-semibold text-navy">{o.id}</div>
                    <div className="text-xs text-slate">
                      {o.quantity} × {l?.title} · {money(o.total)}
                    </div>
                  </div>
                  <Badge tone={STATUS[o.status].tone}>{STATUS[o.status].label}</Badge>
                </Link>
              );
            })}
            {!db.orders.length && <div className="p-4 text-sm text-slate">No orders yet.</div>}
          </Card>
        </section>
        {db.quotes.length > 0 && (
          <section className="md:col-span-2">
            <h2 className="mb-2 text-sm font-semibold text-slate">Quote requests</h2>
            <Card className="divide-y divide-navy/5">
              {db.quotes.map((q) => {
                const l = db.listings.find((x) => x.id === q.listing_id);
                const c = db.contracts.find((x) => x.id === q.contract_id);
                return (
                  <Link key={q.id} href={`/product/${q.listing_id}?qty=${q.quantity}`} className="flex items-center justify-between gap-3 p-4 hover:bg-tint/50">
                    <div>
                      <div className="text-sm font-semibold text-navy">
                        {q.id} · {l?.title}
                      </div>
                      <div className="text-xs text-slate">
                        {q.buyer.name} via {c?.vehicle} {c?.contract_number} · qty {q.quantity}
                      </div>
                    </div>
                    <Badge tone="amber">Waiting on supplier</Badge>
                  </Link>
                );
              })}
            </Card>
          </section>
        )}
        <section>
          <h2 className="mb-2 text-sm font-semibold text-slate">Requests</h2>
          <Card className="divide-y divide-navy/5">
            {db.requests.map((r) => (
              <Link key={r.id} href={`/request/${r.id}`} className="flex items-center justify-between gap-3 p-4 hover:bg-tint/50">
                <div className="min-w-0 text-sm text-navy">{r.raw_text}</div>
                <Badge tone={r.outcome === "ordered" ? "green" : r.outcome === "solicitation" ? "navy" : "amber"}>
                  {r.outcome === "ordered" ? "Ordered" : r.outcome === "solicitation" ? "Solicitation" : "Open"}
                </Badge>
              </Link>
            ))}
            {!db.requests.length && <div className="p-4 text-sm text-slate">No requests yet. Search for something from the home page.</div>}
          </Card>
        </section>
      </div>
    </div>
  );
}
