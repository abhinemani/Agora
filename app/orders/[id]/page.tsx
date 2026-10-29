"use client";

import { useParams } from "next/navigation";
import { useStore } from "@/components/store";
import { Badge, Button, Card, ErrorNote, IconCircle, LinkButton, Loading, money, sourceLabel } from "@/components/ui";

export default function OrderConfirmation() {
  const { id } = useParams<{ id: string }>();
  const { db, setLedgerOpen } = useStore();
  if (!db) return <Loading />;
  const order = db.orders.find((o) => o.id === id);
  if (!order) return <ErrorNote message="That order isn't in this demo session." />;
  const listing = db.listings.find((l) => l.id === order.listing_id)!;
  const supplier = db.suppliers.find((s) => s.id === listing.supplier_id)!;
  const contract = db.contracts.find((c) => c.id === listing.contract_id);
  const events = db.revenue.filter((e) => e.related_id === order.id || (contract && e.related_id === contract.id && e.trigger.includes("first order")));

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <Card className="p-6">
        <div className="flex gap-4">
          <IconCircle>✓</IconCircle>
          <div>
            <div className="text-xs font-semibold uppercase tracking-wider text-maroon">{order.status === "placed" ? "Order placed" : order.status === "approved" ? "PO approved" : "Sent for approval"}</div>
            <h1 className="mt-1 text-2xl font-bold text-navy">Order {order.id}</h1>
            <p className="mt-1 text-sm text-slate">
              {order.quantity} × {listing.title} from {supplier.name}, {money(order.total)}.
            </p>
          </div>
        </div>
        <div className="mt-5 grid gap-3 text-sm sm:grid-cols-2">
          <div className="rounded-md bg-tint p-3">
            <div className="text-xs text-slate">Payment path</div>
            <div className="font-semibold text-navy">
              {order.payment === "pcard" ? "P-card, charged on shipment" : order.status === "approved" ? "PO approved by Purchasing" : "PO waiting on Marcus Reyes, Purchasing"}
            </div>
          </div>
          <div className="rounded-md bg-tint p-3">
            <div className="text-xs text-slate">Deliver to</div>
            <div className="font-semibold text-navy">{order.department}</div>
          </div>
        </div>
        <p className="mt-4 text-xs text-slate">
          This order was placed off {sourceLabel(listing.source).toLowerCase()}
          {contract ? ` ${contract.contract_number} (${contract.owner})` : ""}.
        </p>
      </Card>

      <Card className="p-5">
        <div className="flex items-center justify-between">
          <div className="text-sm font-semibold text-navy">What this order earned Sovra</div>
          <Button variant="ghost" onClick={() => setLedgerOpen(true)}>
            Open ledger →
          </Button>
        </div>
        <ul className="mt-3 space-y-2">
          {events.map((e) => (
            <li key={e.id} className="flex items-center justify-between gap-3 text-sm">
              <span className="flex items-center gap-2">
                <Badge tone="maroon">Option {e.option}</Badge>
                <span className="text-slate">{e.option_name}</span>
              </span>
              <span className={`font-semibold tabular-nums ${e.amount < 0 ? "text-emerald-700" : "text-navy"}`}>{money(e.amount)}</span>
            </li>
          ))}
          {!events.length && <li className="text-sm text-slate">No fees on this order (off-contract and not on a P-card).</li>}
        </ul>
      </Card>

      <div className="flex gap-2">
        <LinkButton href="/">New request</LinkButton>
        <LinkButton href="/requests" variant="secondary">
          My requests
        </LinkButton>
      </div>
    </div>
  );
}
