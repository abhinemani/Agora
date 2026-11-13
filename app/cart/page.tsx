"use client";

import { useState } from "react";
import { useStore } from "@/components/store";
import { CartSummary, SupplierGroup } from "@/components/CartParts";
import { Button, Card, ErrorNote, LinkButton, Loading, PageTitle, money } from "@/components/ui";
import { cartAgency, cartGroups, cartTotal, needsApproval, PURCHASER, REQUESTER } from "@/lib/orders";
import type { Cart } from "@/lib/types";

type Tab = "draft" | "pending" | "approved" | "rejected";
const TABS: { id: Tab; label: string }[] = [
  { id: "draft", label: "Cart" },
  { id: "pending", label: "Waiting on approval" },
  { id: "approved", label: "Ordered" },
  { id: "rejected", label: "Sent back" },
];

export default function CartPage() {
  const { db } = useStore();
  const [tab, setTab] = useState<Tab>("draft");
  if (!db) return <Loading />;
  const agency = cartAgency(db);
  const carts = db.carts.filter((c) => c.agency === agency);
  const count = (t: Tab) => carts.filter((c) => c.status === t).length;
  const draft = carts.find((c) => c.status === "draft");

  return (
    <div className="space-y-6">
      <PageTitle title={`${agency}'s carts`}>
        Collect everything for a purchase in one cart. Agora splits it by supplier and pays each share the right way: P-card under the{" "}
        {money(db.agency.quick_buy_threshold, false)} quick-buy limit, a PO at or over it.
      </PageTitle>

      <div className="flex flex-wrap gap-1 border-b border-line" role="tablist">
        {TABS.map((t) => {
          const n = t.id === "draft" ? (draft?.lines.length ?? 0) : count(t.id);
          return (
            <button
              key={t.id}
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => setTab(t.id)}
              className={`-mb-px flex items-center gap-2 border-b-2 px-3 py-2 text-sm font-semibold ${tab === t.id ? "border-navy text-navy" : "border-transparent text-slate hover:text-navy"}`}
            >
              {t.label}
              {n > 0 && <span className={`rounded-full px-1.5 text-[11px] tabular-nums ${tab === t.id ? "bg-navy text-white" : "bg-tint text-navy"}`}>{n}</span>}
            </button>
          );
        })}
      </div>

      {tab === "draft" && (draft && draft.lines.length ? <DraftCart cart={draft} /> : <EmptyCart />)}
      {tab !== "draft" && (
        <div className="space-y-3">
          {carts.filter((c) => c.status === tab).map((c) => (
            <CartSummary key={c.id} cart={c} onRevised={() => setTab("draft")} />
          ))}
          {!count(tab) && <p className="text-sm text-slate">{tab === "pending" ? "No carts are waiting on Purchasing." : tab === "approved" ? "Nothing ordered from a cart yet." : "No carts have been sent back."}</p>}
        </div>
      )}
    </div>
  );
}

function EmptyCart() {
  return (
    <Card className="p-8 text-center">
      <div className="text-lg font-semibold text-navy">Your cart is empty</div>
      <p className="mx-auto mt-1 max-w-md text-sm text-slate">Search for what you need and choose Add to cart on any result. Items from different suppliers can share one cart.</p>
      <LinkButton href="/" className="mt-4">
        Search Agora
      </LinkButton>
    </Card>
  );
}

function DraftCart({ cart }: { cart: Cart }) {
  const { db, act } = useStore();
  const [handing, setHanding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!db) return null;
  const groups = cartGroups(db, cart);
  const total = cartTotal(groups);
  const approval = needsApproval(groups);
  const blocked = groups.find((g) => g.blocked);

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
      <div className="space-y-4">
        {groups.map((g) => (
          <SupplierGroup key={g.supplier.id} g={g} editable />
        ))}
      </div>

      <aside className="space-y-4 lg:sticky lg:top-24 lg:self-start">
        <Card className="p-5">
          <div className="flex items-baseline justify-between">
            <span className="text-sm text-slate">Total</span>
            <span className="text-2xl font-extrabold tabular-nums text-navy">{money(total)}</span>
          </div>
          <dl className="mt-3 space-y-1.5 text-xs">
            {groups.map((g) => (
              <div key={g.supplier.id} className="flex justify-between gap-3">
                <dt className="truncate text-slate">{g.supplier.name}</dt>
                <dd className="shrink-0 tabular-nums text-navy">
                  {money(g.total)} <span className={g.payment === "po" ? "text-amber-700" : "text-emerald-700"}>{g.payment === "po" ? "PO" : "P-card"}</span>
                </dd>
              </div>
            ))}
          </dl>
          <div className="mt-4 rounded-md bg-tint px-3 py-2 text-xs text-navy">
            {cart.handoff ? (
              <>
                With <span className="font-semibold">{cart.holder}</span>, handed over by {cart.handoff.from}. For {cart.handoff.division}, deliver to {cart.handoff.ship_to}.
                {cart.handoff.notes && <span className="mt-1 block text-slate">“{cart.handoff.notes}”</span>}
              </>
            ) : (
              <>
                With <span className="font-semibold">{cart.holder}</span>, who built it.
              </>
            )}
          </div>
          <p className="mt-3 text-xs text-slate">
            {approval
              ? `${groups.filter((g) => g.payment === "po").map((g) => g.supplier.name).join(" and ")} ${groups.filter((g) => g.payment === "po").length === 1 ? "comes" : "come"} to ${money(db.agency.quick_buy_threshold, false)} or more, so this cart goes to ${PURCHASER} in Purchasing before anything is ordered.`
              : "Every supplier's share is under the quick-buy limit, so this orders right away on the P-card."}
          </p>
          <ErrorNote message={blocked?.blocked ?? error} />
          <Button
            className="mt-3 w-full"
            variant="maroon"
            disabled={busy || Boolean(blocked)}
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                await act("submitCart");
              } catch (e) {
                setError((e as Error).message);
              }
              setBusy(false);
            }}
          >
            {approval ? "Send for approval" : `Place ${groups.length > 1 ? `${groups.length} orders` : "order"}`}
          </Button>
          {!handing && (
            <button onClick={() => setHanding(true)} className="mt-2 w-full text-center text-xs font-semibold text-maroon hover:underline">
              {cart.handoff ? "Hand it to someone else" : "Hand this cart to someone who can buy"}
            </button>
          )}
        </Card>
        {handing && <HandoffForm cart={cart} onDone={() => setHanding(false)} />}
      </aside>
    </div>
  );
}

function HandoffForm({ cart, onDone }: { cart: Cart; onDone: () => void }) {
  const { db, act } = useStore();
  const depts = db?.agency.departments ?? [];
  const [form, setForm] = useState({ to: `${PURCHASER}, Purchasing`, division: depts[0]?.name ?? "", shipTo: depts[0]?.address ?? "", notes: "" });
  const [error, setError] = useState<string | null>(null);
  return (
    <Card className="p-5">
      <div className="text-sm font-semibold text-navy">Hand off this cart</div>
      <p className="mt-0.5 text-xs text-slate">They'll see it with your notes and can check it out. {cart.holder === REQUESTER ? "You can still see it here." : ""}</p>
      <form
        className="mt-3 space-y-3"
        onSubmit={async (e) => {
          e.preventDefault();
          setError(null);
          try {
            await act("handoffCart", form);
            onDone();
          } catch (err) {
            setError((err as Error).message);
          }
        }}
      >
        <label className="block text-xs font-semibold text-slate">
          Hand to
          <input value={form.to} onChange={(e) => setForm({ ...form, to: e.target.value })} className="mt-1 w-full" />
        </label>
        <label className="block text-xs font-semibold text-slate">
          Division
          <select
            value={form.division}
            onChange={(e) => setForm({ ...form, division: e.target.value, shipTo: depts.find((d) => d.name === e.target.value)?.address ?? form.shipTo })}
            className="mt-1 w-full"
          >
            {depts.map((d) => (
              <option key={d.id}>{d.name}</option>
            ))}
          </select>
        </label>
        <label className="block text-xs font-semibold text-slate">
          Deliver to
          <input value={form.shipTo} onChange={(e) => setForm({ ...form, shipTo: e.target.value })} className="mt-1 w-full" />
        </label>
        <label className="block text-xs font-semibold text-slate">
          Notes
          <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} placeholder="Anything the buyer should know" className="mt-1 w-full" />
        </label>
        <ErrorNote message={error} />
        <div className="flex gap-2">
          <Button type="submit">Hand off</Button>
          <Button type="button" variant="secondary" onClick={onDone}>
            Cancel
          </Button>
        </div>
      </form>
    </Card>
  );
}

