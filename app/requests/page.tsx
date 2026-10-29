"use client";

import Link from "next/link";
import { useStore } from "@/components/store";
import { Badge, Card, Loading, PageTitle, money } from "@/components/ui";

const STATUS: Record<string, { label: string; tone: "green" | "amber" | "navy" }> = {
  placed: { label: "Placed", tone: "green" },
  pending_approval: { label: "Waiting on approval", tone: "amber" },
  approved: { label: "Approved", tone: "green" },
};

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
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wider text-slate">Orders</h2>
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
        <section>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wider text-slate">Requests</h2>
          <Card className="divide-y divide-navy/5">
            {db.requests.map((r) => (
              <Link key={r.id} href={`/request/${r.id}`} className="flex items-center justify-between gap-3 p-4 hover:bg-tint/50">
                <div className="min-w-0 text-sm text-navy">{r.raw_text}</div>
                <Badge tone={r.outcome === "ordered" ? "green" : r.outcome === "solicitation" ? "navy" : "amber"}>
                  {r.outcome === "ordered" ? "Ordered" : r.outcome === "solicitation" ? "Solicitation" : "Open"}
                </Badge>
              </Link>
            ))}
            {!db.requests.length && <div className="p-4 text-sm text-slate">No requests yet. Ask for something from the storefront.</div>}
          </Card>
        </section>
      </div>
    </div>
  );
}
