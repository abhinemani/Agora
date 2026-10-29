"use client";

import Link from "next/link";
import { useEffect } from "react";
import { useStore } from "@/components/store";
import { Badge, Button, Card, IconCircle, LinkButton, Loading, PageTitle, SourcePill, money } from "@/components/ui";

export default function ProcurementHome() {
  const { db, act, role, setRole } = useStore();
  useEffect(() => {
    if (role !== "procurement") setRole("procurement");
  }, [role, setRole]);
  if (!db) return <Loading />;

  const pending = db.orders.filter((o) => o.status === "pending_approval");
  const recent = db.orders.filter((o) => o.status !== "pending_approval").slice(0, 5);
  const open = db.solicitations.filter((s) => s.status === "open");
  const awardedUnlisted = db.solicitations.filter((s) => s.status === "awarded" && !s.awarded_listing_id);

  return (
    <div className="space-y-6">
      <PageTitle eyebrow="Purchasing" title="Good morning, Marcus">
        Approvals waiting on you, contracts to bring into the storefront, and where Riverbend's money is going.
      </PageTitle>

      <div className="grid gap-4 md:grid-cols-3">
        <Card className="flex gap-4 p-5 md:col-span-2">
          <IconCircle>⇪</IconCircle>
          <div className="flex-1">
            <div className="font-semibold text-navy">Add a contract to the storefront</div>
            <p className="mt-1 text-sm text-slate">
              Upload a contract and its price list. Items, prices and terms are extracted into listings in minutes, so departments can buy from it today.
            </p>
            <LinkButton href="/contracts/upload?as=procurement" className="mt-3">
              Upload a contract
            </LinkButton>
          </div>
        </Card>
        <Card className="p-5">
          <div className="text-xs font-semibold uppercase tracking-wider text-slate">Storefront today</div>
          <div className="mt-2 text-3xl font-bold text-navy">{db.listings.filter((l) => l.storefront_ids.includes("sf_riverbend")).length}</div>
          <div className="text-sm text-slate">listings from {db.contracts.filter((c) => c.storefront_ids.includes("sf_riverbend")).length} contracts</div>
          <Link href="/procurement/spend" className="mt-3 inline-block text-sm font-semibold text-maroon hover:underline">
            Spend intelligence →
          </Link>
        </Card>
      </div>

      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wider text-slate">Pending approvals ({pending.length})</h2>
        <Card className="divide-y divide-navy/5">
          {pending.map((o) => {
            const l = db.listings.find((x) => x.id === o.listing_id)!;
            const s = db.suppliers.find((x) => x.id === l.supplier_id)!;
            const req = db.requests.find((r) => r.id === o.request_id);
            return (
              <div key={o.id} className="flex flex-wrap items-center justify-between gap-4 p-5">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-navy">{o.id}</span>
                    <SourcePill source={l.source} />
                  </div>
                  <div className="mt-1 text-sm text-navy">
                    {o.quantity} × {l.title} from {s.name}
                  </div>
                  <div className="text-xs text-slate">
                    {o.department} · Dana Whitfield{req ? ` · “${req.raw_text}”` : ""}
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <span className="text-lg font-bold text-navy">{money(o.total)}</span>
                  <Button onClick={() => act("approveOrder", { orderId: o.id })}>Approve PO</Button>
                </div>
              </div>
            );
          })}
          {!pending.length && <div className="p-5 text-sm text-slate">Nothing waiting. Purchases under $10K on contract don't need you.</div>}
        </Card>
      </section>

      <div className="grid gap-6 md:grid-cols-2">
        <section>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wider text-slate">Solicitations</h2>
          <Card className="divide-y divide-navy/5">
            {awardedUnlisted.map((s) => (
              <Link key={s.id} href="/solicitations" className="flex items-center justify-between gap-3 p-4 hover:bg-tint/50">
                <span className="text-sm text-navy">{s.title}</span>
                <Badge tone="green">Awarded · ready to list</Badge>
              </Link>
            ))}
            {open.map((s) => (
              <Link key={s.id} href="/solicitations" className="flex items-center justify-between gap-3 p-4 hover:bg-tint/50">
                <span className="text-sm text-navy">{s.title}</span>
                <Badge tone="amber">Open</Badge>
              </Link>
            ))}
          </Card>
        </section>
        <section>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wider text-slate">Recent orders</h2>
          <Card className="divide-y divide-navy/5">
            {recent.map((o) => {
              const l = db.listings.find((x) => x.id === o.listing_id)!;
              return (
                <div key={o.id} className="flex items-center justify-between gap-3 p-4 text-sm">
                  <span className="text-navy">
                    {o.id} · {l.title}
                  </span>
                  <span className="font-semibold">{money(o.total)}</span>
                </div>
              );
            })}
            {!recent.length && <div className="p-4 text-sm text-slate">No orders yet this session.</div>}
          </Card>
        </section>
      </div>
    </div>
  );
}
