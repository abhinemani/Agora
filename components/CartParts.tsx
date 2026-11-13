"use client";

import Link from "next/link";
import { useState } from "react";
import { cartGroups, cartTotal, ORDER_STATUS, PURCHASER, type CartGroup } from "@/lib/orders";
import type { Cart } from "@/lib/types";
import { useStore } from "./store";
import { Badge, Button, Card, ErrorNote, SourcePill, SupplierBadges, money } from "./ui";

/** One supplier's share of a cart, with how it will be paid. */
export function SupplierGroup({ g, editable }: { g: CartGroup; editable?: boolean }) {
  const { act } = useStore();
  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line bg-page/60 px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <Link href={`/storefronts/${g.supplier.id}`} className="font-semibold text-navy hover:text-maroon hover:underline">
            {g.supplier.name}
          </Link>
          <SupplierBadges supplier={g.supplier} />
        </div>
        <div className="flex items-center gap-3 text-sm">
          <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${g.payment === "po" ? "bg-amber-50 text-amber-800" : "bg-emerald-50 text-emerald-800"}`}>
            {g.payment === "po" ? "PO, needs approval" : "P-card"}
          </span>
          <span className="font-bold tabular-nums text-navy">{money(g.total)}</span>
        </div>
      </div>
      <ul className="divide-y divide-navy/5">
        {g.lines.map((l) => (
          <li key={l.listing.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
            <div className="min-w-0 flex-1">
              <Link href={`/product/${l.listing.id}`} className="text-sm font-semibold text-navy hover:text-maroon hover:underline">
                {l.listing.title}
              </Link>
              <div className="mt-0.5">
                <SourcePill source={l.listing.source} contractId={l.listing.contract_id} />
              </div>
            </div>
            {editable ? (
              <label className="flex items-center gap-1.5 text-xs text-slate">
                Qty
                <input
                  type="number"
                  min={0}
                  defaultValue={l.quantity}
                  onBlur={(e) => Number(e.target.value) !== l.quantity && act("updateCartLine", { listingId: l.listing.id, quantity: Number(e.target.value) })}
                  className="w-20 !py-1 text-right"
                />
              </label>
            ) : (
              <span className="text-xs text-slate">Qty {l.quantity}</span>
            )}
            <span className="w-24 text-right text-xs tabular-nums text-slate">{money(l.unit)} ea</span>
            <span className="w-24 text-right text-sm font-semibold tabular-nums text-navy">{money(l.total)}</span>
            {editable && (
              <button onClick={() => act("updateCartLine", { listingId: l.listing.id, quantity: 0 })} className="text-xs text-slate hover:text-red-700" aria-label={`Remove ${l.listing.title}`}>
                Remove
              </button>
            )}
          </li>
        ))}
      </ul>
      {g.blocked && <div className="border-t border-line bg-red-50 px-4 py-2 text-xs text-red-800">{g.blocked}</div>}
    </Card>
  );
}

/** A cart that's left the draft stage: waiting, ordered or sent back. */
export function CartSummary({ cart, onRevised, approver }: { cart: Cart; onRevised?: () => void; approver?: boolean }) {
  const { db, act } = useStore();
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  if (!db) return null;
  const groups = cartGroups(db, cart);
  const orders = db.orders.filter((o) => cart.order_ids.includes(o.id));
  const run = async (action: string, body: Record<string, unknown>) => {
    setError(null);
    try {
      await act(action, body);
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    }
  };

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="font-semibold text-navy">Cart {cart.id.replace("cart_", "#")}</span>
            <Badge tone={cart.status === "approved" ? "green" : cart.status === "pending" ? "amber" : "maroon"}>
              {cart.status === "approved" ? "Ordered" : cart.status === "pending" ? `Waiting on ${PURCHASER}` : "Sent back"}
            </Badge>
          </div>
          <div className="mt-0.5 text-xs text-slate">
            {cart.lines.length} item{cart.lines.length === 1 ? "" : "s"} from {groups.length} supplier{groups.length === 1 ? "" : "s"}, built by {cart.created_by}
            {cart.handoff ? `, handed to ${cart.handoff.to} for ${cart.handoff.division}` : ""}
          </div>
        </div>
        <span className="text-xl font-extrabold tabular-nums text-navy">{money(cartTotal(groups))}</span>
      </div>

      {cart.status === "rejected" && (
        <div className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-900">
          <span className="font-semibold">{cart.decided_by} sent it back:</span> {cart.reject_reason}
        </div>
      )}

      {cart.status === "approved" ? (
        <ul className="mt-3 divide-y divide-navy/5 text-sm">
          {orders.map((o) => {
            const l = db.listings.find((x) => x.id === o.listing_id);
            return (
              <li key={o.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <Link href={`/orders/${o.id}`} className="font-semibold text-navy hover:text-maroon hover:underline">
                  {o.id}
                </Link>
                <span className="min-w-0 flex-1 truncate text-slate">
                  {o.quantity} × {l?.title}
                </span>
                <Badge tone={ORDER_STATUS[o.status].tone === "neutral" ? "neutral" : ORDER_STATUS[o.status].tone}>{ORDER_STATUS[o.status].label}</Badge>
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="mt-3 space-y-3">
          {groups.map((g) => (
            <SupplierGroup key={g.supplier.id} g={g} />
          ))}
        </div>
      )}

      <ErrorNote message={error} />
      {cart.status === "rejected" && (
        <Button className="mt-3" onClick={async () => (await run("reviseCart", { cartId: cart.id })) && onRevised?.()}>
          Revise and resubmit
        </Button>
      )}
      {cart.status === "pending" && approver && (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button variant="maroon" onClick={() => run("approveCart", { cartId: cart.id })}>
            Approve and order
          </Button>
          {rejecting ? (
            <form
              className="flex flex-1 flex-wrap items-center gap-2"
              onSubmit={async (e) => {
                e.preventDefault();
                if (await run("rejectCart", { cartId: cart.id, reason })) setRejecting(false);
              }}
            >
              <input autoFocus value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why it's going back, e.g. use the state contract for chairs" className="min-w-[16rem] flex-1" />
              <Button type="submit" variant="secondary">
                Send back
              </Button>
            </form>
          ) : (
            <Button variant="secondary" onClick={() => setRejecting(true)}>
              Send back
            </Button>
          )}
        </div>
      )}
    </Card>
  );
}
