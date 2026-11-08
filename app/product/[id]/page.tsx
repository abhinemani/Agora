"use client";

import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { BuyerPicker } from "@/components/BuyerPicker";
import { Alert, Check, File, Lock } from "@/components/icons";
import { useStore } from "@/components/store";
import { Badge, Button, Card, ErrorNote, Eyebrow, LinkButton, Loading, SourcePill, money } from "@/components/ui";
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

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <Link href={requestId ? `/request/${requestId}` : "/browse"} className="text-xs font-semibold text-slate hover:text-navy">
        ← {requestId ? "Back to results" : "Back to browse"}
      </Link>

      <Card className="p-6">
        <Eyebrow>{supplier.name}</Eyebrow>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-navy">{title}</h1>
        {l.keywords && <div className="mt-1 text-xs text-slate">{l.keywords}</div>}
        {l.detail && <p className="mt-3 text-sm leading-relaxed text-slate">{l.detail}</p>}

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
