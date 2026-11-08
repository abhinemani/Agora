"use client";

import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { BuyerPicker } from "@/components/BuyerPicker";
import { CategoryIcon } from "@/components/CategoryIcon";
import { Alert, Check, File, Lock } from "@/components/icons";
import { useStore } from "@/components/store";
import { Badge, Button, Card, ErrorNote, LinkButton, Loading, SourcePill, Stars, SupplierBadges, money } from "@/components/ui";
import type { Contract, QuoteRequest } from "@/lib/types";
import { familyOf, routesFor, stateName, type Route } from "@/lib/vehicles";

const USAGE_UNITS = /^(hr|hour|interaction|transaction|text|postcard|summons|minute|call|signature|device\/day|parcel|user|user\/yr|mo)$/i;

const VERIFICATION: Record<NonNullable<Contract["verification"]>, { label: string; tone: "green" | "amber" | "neutral" }> = {
  source_document: { label: "From the source price document", tone: "green" },
  research_lead: { label: "Research lead: verify before use", tone: "amber" },
  demo: { label: "Demo data", tone: "neutral" },
};

export default function ProductPage() {
  return (
    <Suspense fallback={<Loading />}>
      <Product />
    </Suspense>
  );
}

function Product() {
  const { id } = useParams<{ id: string }>();
  const params = useSearchParams();
  const requestId = params.get("request");
  const { db } = useStore();
  const [chosen, setChosen] = useState(id);
  const [qty, setQty] = useState(Number(params.get("qty") ?? 1) || 1);
  const [changing, setChanging] = useState(false);
  if (!db) return <Loading />;

  const start = db.listings.find((l) => l.id === id);
  if (!start) return <ErrorNote message="That product isn't in the storefront." />;
  const variants = familyOf(db, start);
  const l = variants.find((v) => v.id === chosen) ?? start;
  const supplier = db.suppliers.find((s) => s.id === l.supplier_id)!;
  const buyer = db.session.buyer;
  const routes = routesFor(db, l, buyer);
  const tiered = variants.length > 1;
  const title = tiered ? l.title.replace(/\s*\([^)]*\)\s*$/, "") : l.title;
  const usage = USAGE_UNITS.test(l.unit);
  const contract = db.contracts.find((c) => c.id === l.contract_id);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <Link href={requestId ? `/request/${requestId}` : "/browse"} className="text-xs font-semibold text-slate hover:text-navy">
        ← {requestId ? "Back to results" : "Back to browse"}
      </Link>

      <Card className="p-6">
        <div className="flex gap-5">
          <CategoryIcon category={l.category} size="lg" />
          <div className="min-w-0 flex-1">
            <h1 className="text-2xl font-semibold tracking-tight text-navy">{title}</h1>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
              <span className="text-navy">{supplier.name}</span>
              <SupplierBadges supplier={supplier} />
              <Stars rating={supplier.rating} count={supplier.review_count || undefined} />
            </div>
            {l.keywords && <div className="mt-1 text-xs text-slate">{l.keywords}</div>}
          </div>
        </div>
        {l.detail && <p className="mt-4 text-[15px] leading-relaxed text-slate">{l.detail}</p>}
        <dl className="mt-5 grid gap-x-6 gap-y-3 border-t border-line pt-5 text-sm sm:grid-cols-4">
          <div>
            <dt className="text-xs text-slate">Category</dt>
            <dd className="text-navy">{l.category}</dd>
          </div>
          <div>
            <dt className="text-xs text-slate">Supplier location</dt>
            <dd className="text-navy">{supplier.city ? `${supplier.city}, ${supplier.state}` : "Not on file"}</dd>
          </div>
          <div>
            <dt className="text-xs text-slate">{l.category === "Software and services" || l.category === "Professional services" ? "Typical start" : "Typical delivery"}</dt>
            <dd className="text-navy">{l.lead_time_days} days</dd>
          </div>
          <div>
            <dt className="text-xs text-slate">Terms</dt>
            <dd className="text-navy">{contract ? contract.payment_terms : "Card at purchase"}</dd>
          </div>
        </dl>

        <div className="mt-5 grid gap-4 sm:grid-cols-[1fr_10rem]">
          <label className="block text-xs font-semibold text-slate">
            {tiered ? `Pricing tier (${variants.length})` : "Item"}
            {tiered ? (
              <select value={l.id} onChange={(e) => setChosen(e.target.value)} className="mt-1 w-full">
                {variants.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.variant ?? v.sku} · {money(v.unit_price)} / {v.unit}
                  </option>
                ))}
              </select>
            ) : (
              <div className="mt-1 rounded-md border border-navy/10 bg-tint px-3 py-2 text-sm text-navy">{l.variant ?? l.title}</div>
            )}
          </label>
          <label className="block text-xs font-semibold text-slate">
            {usage ? `Estimated ${l.unit === "hr" ? "hours" : `${l.unit}s`}` : "Quantity"}
            <input type="number" min={1} value={qty} onChange={(e) => setQty(Math.max(1, Number(e.target.value) || 1))} className="mt-1 w-full text-right" />
          </label>
        </div>

        <div className="mt-4 flex flex-wrap items-end justify-between gap-4 rounded-lg bg-tint p-4">
          <div>
            <div className="text-xs text-slate">Published price</div>
            <div className="text-2xl font-semibold text-navy">
              {money(l.unit_price)} <span className="text-sm font-normal text-slate">/ {l.unit}</span>
            </div>
            <div className="mt-1 font-mono text-[11px] text-slate">SKU {l.sku}</div>
          </div>
          <div className="text-right">
            <div className="text-xs text-slate">
              {qty.toLocaleString()} × {money(l.unit_price)}
            </div>
            <div className="text-lg font-semibold text-navy">{money(l.unit_price * qty)}</div>
            {usage && <div className="max-w-xs text-[11px] text-slate">Usage-based: the total depends on the hours or volume you estimate.</div>}
          </div>
        </div>
      </Card>

      <section>
        <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 className="text-2xl font-semibold tracking-tight text-navy">Ways to buy</h2>
            <p className="text-sm text-slate">
              {buyer ? (
                <>
                  For <span className="font-semibold text-navy">{buyer.name}</span>, {stateName(buyer.state)}.{" "}
                </>
              ) : (
                "Tell us who's buying to see which routes are open. "
              )}
              Supplier fees on a contract are not the price your agency pays.
            </p>
          </div>
          {buyer && (
            <button onClick={() => setChanging(!changing)} className="text-sm font-semibold text-maroon hover:underline">
              {changing ? "Cancel" : "Change buyer"}
            </button>
          )}
        </div>
        {(!buyer || changing) && (
          <div className="mb-4">
            <BuyerPicker onDone={() => setChanging(false)} />
          </div>
        )}
        <div className="space-y-3">
          {!contract && (
            <Card className="flex flex-wrap items-center justify-between gap-4 p-5">
              <div>
                <div className="text-base font-semibold text-navy">Small purchase</div>
                <div className="mt-1 text-sm text-slate">No contract needed while the total stays under your quick-buy limit. Pay by P-card.</div>
              </div>
              <LinkButton href={`/checkout?listing=${l.id}&qty=${qty}${requestId ? `&request=${requestId}` : ""}`}>Buy at {money(l.unit_price * qty)}</LinkButton>
            </Card>
          )}
          {routes.map((r) => (
            <RouteCard key={r.contract.id} r={r} productId={l.id} qty={qty} requestId={requestId} />
          ))}
        </div>
      </section>
    </div>
  );
}

function RouteCard({ r, productId, qty, requestId }: { r: Route; productId: string; qty: number; requestId: string | null }) {
  const { act } = useStore();
  const [quote, setQuote] = useState<QuoteRequest | null>(null);
  const [error, setError] = useState<string | null>(null);
  const c = r.contract;
  const v = VERIFICATION[c.verification ?? "demo"];
  const open = r.eligibility.eligible;

  return (
    <Card className={`p-5 ${open ? "" : "bg-tint/60"}`}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-base font-semibold text-navy">{c.vehicle ?? c.owner}</span>
            <span className="font-mono text-xs text-slate">{c.contract_number}</span>
            <SourcePill source={c.source} />
          </div>
          <div className="mt-0.5 text-xs text-slate">{c.owner}</div>
          <div className={`mt-2 flex items-start gap-1.5 text-sm ${!open ? "text-maroon" : c.verification === "research_lead" ? "text-amber-800" : "text-emerald-800"}`}>
            {open ? <Check className="mt-0.5 h-4 w-4 shrink-0" /> : <Lock className="mt-0.5 h-4 w-4 shrink-0" />}
            <span>
              {!open
                ? `Not open to you: ${r.eligibility.reason}`
                : c.verification === "research_lead"
                  ? `Likely open to you (verify): ${r.eligibility.reason}`
                  : `Open to you: ${r.eligibility.reason}`}
            </span>
          </div>
          <div className="mt-2 text-sm text-navy">{r.price_note}</div>
          {r.research_note && (
            <div className="mt-2 flex items-start gap-1.5 rounded-md bg-amber-50 px-2.5 py-1.5 text-xs text-amber-900">
              <Alert className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {r.research_note}
            </div>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-3 text-xs">
            <Badge tone={v.tone}>{v.label}</Badge>
            {c.source_url && (
              <a href={c.source_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-semibold text-maroon hover:underline">
                <File className="h-3.5 w-3.5" /> Source
              </a>
            )}
          </div>
        </div>
        <div className="flex min-w-[10rem] flex-col items-end gap-2">
          {r.action === "buy" && r.listing && (
            open ? (
              <LinkButton href={`/checkout?listing=${r.listing.id}&qty=${qty}${requestId ? `&request=${requestId}` : ""}`}>Buy at {money(r.listing.unit_price * qty)}</LinkButton>
            ) : (
              <Button disabled>Not available</Button>
            )
          )}
          {r.action === "quote" &&
            (quote ? (
              <span className="max-w-[12rem] text-right text-xs font-semibold text-emerald-800">
                Quote request {quote.id} sent. The supplier replies through {c.vehicle}.
              </span>
            ) : (
              <Button
                variant="secondary"
                disabled={!open}
                onClick={async () => {
                  setError(null);
                  try {
                    setQuote(await act<QuoteRequest>("requestQuote", { listingId: productId, contractId: c.id, quantity: qty }));
                  } catch (e) {
                    setError((e as Error).message);
                  }
                }}
              >
                Request a quote
              </Button>
            ))}
          {r.action === "check" && <span className="max-w-[12rem] text-right text-xs text-slate">Check whether your state has adopted it</span>}
          <ErrorNote message={error} />
        </div>
      </div>
    </Card>
  );
}
