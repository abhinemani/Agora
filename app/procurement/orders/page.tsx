"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useStore } from "@/components/store";
import { Badge, Button, Card, Loading, PageTitle, money } from "@/components/ui";
import { nextStep, ORDER_STATUS, STEPS } from "@/lib/orders";
import type { Order, OrderStatus } from "@/lib/types";

/** Every order in the agency on one table: who asked, who it's for, where it stands, what's next. */
export default function OrdersOversight() {
  const { db, act, role, setRole } = useStore();
  const [q, setQ] = useState("");
  const [dept, setDept] = useState("");
  const [status, setStatus] = useState<"" | "open" | OrderStatus>("");
  const [payment, setPayment] = useState<"" | Order["payment"]>("");
  useEffect(() => {
    if (role !== "procurement") setRole("procurement");
  }, [role, setRole]);

  const rows = useMemo(() => {
    if (!db) return [];
    return db.orders.map((o) => {
      const listing = db.listings.find((l) => l.id === o.listing_id);
      const supplier = db.suppliers.find((s) => s.id === listing?.supplier_id);
      return { o, listing, supplier };
    });
  }, [db]);
  if (!db) return <Loading />;

  const shown = rows.filter(({ o, listing, supplier }) => {
    if (dept && o.department !== dept) return false;
    if (payment && o.payment !== payment) return false;
    if (status === "open" && o.status === "reconciled") return false;
    if (status && status !== "open" && o.status !== status) return false;
    if (q && !`${o.id} ${o.requester ?? ""} ${listing?.title ?? ""} ${supplier?.name ?? ""}`.toLowerCase().includes(q.toLowerCase())) return false;
    return true;
  });
  const departments = [...new Set(db.orders.map((o) => o.department))].sort();
  const toReconcile = db.orders.filter((o) => o.payment === "pcard" && o.status === "delivered");
  const total = shown.reduce((n, r) => n + r.o.total, 0);

  const exportCsv = () => {
    const header = ["Order", "Date", "Requester", "Department", "GL code", "Supplier", "Item", "Qty", "Amount", "Payment", "Status", "Invoice"];
    const lines = shown.map(({ o, listing, supplier }) =>
      [o.id, o.created_at.slice(0, 10), o.requester ?? "", o.department, o.gl_code ?? "", supplier?.name ?? "", listing?.title ?? "", o.quantity, o.total.toFixed(2), o.payment === "pcard" ? "P-card" : "PO", ORDER_STATUS[o.status].label, o.invoice?.number ?? ""]
        .map((v) => `"${String(v).replace(/"/g, '""')}"`)
        .join(","),
    );
    const blob = new Blob([[header.join(","), ...lines].join("\n")], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `orders-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="space-y-6">
      <PageTitle title="Orders">Every order across the agency: who asked for it, who it's for, where it stands, and the step that's next.</PageTitle>

      {toReconcile.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-warning-container p-4 text-body-m text-warning-on-container">
          <span>
            <span className="font-semibold">{toReconcile.length} P-card charge{toReconcile.length === 1 ? "" : "s"}</span> received and waiting to be matched to a receipt.
          </span>
          <Button variant="secondary" onClick={() => setStatus("delivered")}>
            Show them
          </Button>
        </div>
      )}

      <div className="flex flex-wrap items-end gap-3">
        <label className="block text-xs font-semibold text-slate">
          Search
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Order, person, item or supplier" className="mt-1 block w-64" />
        </label>
        <label className="block text-xs font-semibold text-slate">
          Department
          <select value={dept} onChange={(e) => setDept(e.target.value)} className="mt-1 block">
            <option value="">All</option>
            {departments.map((d) => (
              <option key={d}>{d}</option>
            ))}
          </select>
        </label>
        <label className="block text-xs font-semibold text-slate">
          Status
          <select value={status} onChange={(e) => setStatus(e.target.value as typeof status)} className="mt-1 block">
            <option value="">All</option>
            <option value="open">Not yet reconciled</option>
            {(Object.keys(ORDER_STATUS) as OrderStatus[]).map((s) => (
              <option key={s} value={s}>
                {ORDER_STATUS[s].label}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-xs font-semibold text-slate">
          Paid by
          <select value={payment} onChange={(e) => setPayment(e.target.value as typeof payment)} className="mt-1 block">
            <option value="">Either</option>
            <option value="pcard">P-card</option>
            <option value="po">PO</option>
          </select>
        </label>
        <div className="ml-auto flex items-center gap-3">
          <span className="text-sm text-slate">
            {shown.length} order{shown.length === 1 ? "" : "s"}, <span className="font-semibold tabular-nums text-navy">{money(total)}</span>
          </span>
          <Button variant="secondary" onClick={exportCsv} disabled={!shown.length}>
            Export CSV
          </Button>
        </div>
      </div>

      <Card className="overflow-x-auto">
        <table className="w-full min-w-[56rem] text-left text-sm">
          <thead className="border-b border-line bg-page/60 text-xs text-slate">
            <tr>
              <th className="px-4 py-2.5 font-semibold">Order</th>
              <th className="px-4 py-2.5 font-semibold">Item</th>
              <th className="px-4 py-2.5 font-semibold">Requester</th>
              <th className="px-4 py-2.5 font-semibold">For</th>
              <th className="px-4 py-2.5 text-right font-semibold">Amount</th>
              <th className="px-4 py-2.5 font-semibold">Progress</th>
              <th className="px-4 py-2.5 font-semibold" />
            </tr>
          </thead>
          <tbody className="divide-y divide-navy/5">
            {shown.map(({ o, listing, supplier }) => {
              const next = nextStep(o);
              const steps = STEPS[o.payment];
              const at = steps.indexOf(o.status);
              return (
                <tr key={o.id} className="align-top">
                  <td className="px-4 py-3">
                    <Link href={`/orders/${o.id}`} className="font-semibold text-navy hover:text-maroon hover:underline">
                      {o.id}
                    </Link>
                    <div className="text-[11px] text-slate">{new Date(o.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</div>
                  </td>
                  <td className="max-w-[16rem] px-4 py-3">
                    <div className="truncate text-navy">
                      {o.quantity} × {listing?.title}
                    </div>
                    <div className="truncate text-[11px] text-slate">{supplier?.name}</div>
                  </td>
                  <td className="px-4 py-3 text-navy">{o.requester ?? "—"}</td>
                  <td className="px-4 py-3">
                    <div className="text-navy">{o.department}</div>
                    <div className="text-[11px] text-slate">{o.gl_code}</div>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="font-semibold tabular-nums text-navy">{money(o.total)}</div>
                    <div className="text-[11px] text-slate">{o.payment === "pcard" ? "P-card" : "PO"}</div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-0.5" aria-hidden>
                      {steps.map((s, i) => (
                        <span key={s} className={`h-1.5 w-5 rounded-full ${i <= at ? (o.status === "reconciled" ? "bg-emerald-600" : "bg-primary") : "bg-line"}`} />
                      ))}
                    </div>
                    <div className="mt-1 block">
                      <Badge tone={ORDER_STATUS[o.status].tone}>{ORDER_STATUS[o.status].label}</Badge>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right">
                    {o.status === "pending_approval" ? (
                      <Button onClick={() => act("approveOrder", { orderId: o.id })}>Approve PO</Button>
                    ) : next ? (
                      <Button variant="secondary" onClick={() => act("advanceOrder", { orderId: o.id })}>
                        {next.action}
                      </Button>
                    ) : (
                      <span className="text-xs text-emerald-700">Closed</span>
                    )}
                  </td>
                </tr>
              );
            })}
            {!shown.length && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-sm text-slate">
                  No orders match these filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
