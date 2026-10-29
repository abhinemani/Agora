"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { useStore } from "@/components/store";
import { Button, Card, ErrorNote, Loading, SourcePill, SupplierBadges, money } from "@/components/ui";
import type { Order } from "@/lib/types";

export default function CheckoutPage() {
  return (
    <Suspense fallback={<Loading />}>
      <Checkout />
    </Suspense>
  );
}

function Checkout() {
  const params = useSearchParams();
  const router = useRouter();
  const { db, act } = useStore();
  const [qty, setQty] = useState(Number(params.get("qty") ?? 1));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!db) return <Loading />;

  const listing = db.listings.find((l) => l.id === params.get("listing"));
  if (!listing) return <ErrorNote message="That listing isn't in the storefront." />;
  const request = db.requests.find((r) => r.id === params.get("request"));
  const supplier = db.suppliers.find((s) => s.id === listing.supplier_id)!;
  const contract = db.contracts.find((c) => c.id === listing.contract_id);
  const deptName = request?.parsed.department ?? "Parks and Recreation";
  const dept = db.agency.departments.find((d) => d.name === deptName) ?? db.agency.departments[0];

  const tiers = db.extracted.find((e) => e.id === listing.extracted_item_id)?.tier_pricing ?? [];
  const tier = [...tiers].sort((a, b) => b.min_qty - a.min_qty).find((t) => qty >= t.min_qty);
  const unit = tier?.unit_price ?? listing.unit_price;
  const total = Math.round(unit * qty * 100) / 100;
  const limit = db.agency.quick_buy_threshold;
  const po = total >= limit;
  const blocked = listing.source === "no_approval" && po;

  const place = async () => {
    setBusy(true);
    setError(null);
    try {
      const { order } = await act<{ order: Order }>("placeOrder", { listingId: listing.id, quantity: qty, requestId: request?.id ?? null, department: dept.name });
      router.push(`/orders/${order.id}`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <Link href={request ? `/request/${request.id}` : "/"} className="text-xs font-semibold text-slate hover:text-navy">
          ← Back to options
        </Link>
        <h1 className="mt-2 text-2xl font-bold text-navy">Checkout</h1>
      </div>

      <Card className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="font-semibold text-navy">{listing.title}</div>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-slate">
              {supplier.name} <SupplierBadges supplier={supplier} />
            </div>
            <div className="mt-2 flex items-center gap-2 text-xs text-slate">
              <SourcePill source={listing.source} /> {contract?.contract_number} {listing.sku && `· SKU ${listing.sku}`}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs text-slate" htmlFor="qty">
              Qty
            </label>
            <input id="qty" type="number" min={1} value={qty} onChange={(e) => setQty(Math.max(1, Number(e.target.value) || 1))} className="w-24 text-right" />
          </div>
        </div>
        <table className="mt-5 w-full text-sm">
          <tbody>
            <tr className="border-t border-navy/5">
              <td className="py-2 text-slate">Unit price{tier && tiers.length > 1 ? ` (${tier.min_qty}+ tier)` : ""}</td>
              <td className="py-2 text-right">
                {money(unit)} / {listing.unit}
              </td>
            </tr>
            <tr className="border-t border-navy/5">
              <td className="py-2 text-slate">Quantity</td>
              <td className="py-2 text-right">{qty}</td>
            </tr>
            <tr className="border-t border-navy/5">
              <td className="py-2 text-slate">Delivery</td>
              <td className="py-2 text-right">{contract?.delivery_terms ?? "Included"}</td>
            </tr>
            <tr className="border-t border-navy/10 text-base font-bold text-navy">
              <td className="py-3">Total</td>
              <td className="py-3 text-right">{money(total)}</td>
            </tr>
          </tbody>
        </table>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Card className="p-5">
          <div className="text-xs font-semibold uppercase tracking-wider text-slate">Deliver to</div>
          <div className="mt-2 text-sm font-semibold text-navy">{dept.name}</div>
          <div className="text-sm text-slate">{dept.address}</div>
          <div className="mt-1 text-xs text-steel">Prefilled from your department</div>
        </Card>
        <Card className="p-5">
          <div className="text-xs font-semibold uppercase tracking-wider text-slate">Payment</div>
          {po ? (
            <>
              <div className="mt-2 text-sm font-semibold text-navy">Purchase order</div>
              <div className="text-sm text-slate">
                Over your {money(limit, false)} quick-buy limit, so this needs a PO approved by Marcus Reyes, Purchasing Manager.
              </div>
            </>
          ) : (
            <>
              <div className="mt-2 text-sm font-semibold text-navy">P-card ending 4417</div>
              <div className="text-sm text-slate">Under your {money(limit, false)} quick-buy limit. No approval needed.</div>
            </>
          )}
        </Card>
      </div>

      <ErrorNote message={blocked ? "This off-contract option only works under the quick-buy limit. Lower the quantity or choose a contract option." : error} />
      <div className="flex justify-end">
        <Button onClick={place} disabled={busy || blocked} variant={po ? "maroon" : "primary"} className="!px-6 !py-2.5">
          {busy ? "Placing…" : po ? "Send for approval" : `Place order · ${money(total)}`}
        </Button>
      </div>
    </div>
  );
}
