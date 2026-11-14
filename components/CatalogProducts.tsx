"use client";

import Link from "next/link";
import { useState } from "react";
import type { Results } from "@/lib/assistant";
import type { CatalogProductHit, CatalogRoute } from "@/lib/catalog";
import { goHref } from "@/lib/coops";
import { FitPill } from "./CoopSection";
import { useStore } from "./store";
import { Badge, money } from "./ui";

/** How a catalog route is priced, in plain words. A discount is not a price; blank is unknown, not zero. */
function priceLine(r: CatalogRoute): { text: string; tone: string } {
  if (r.price != null)
    return {
      text: `${money(r.price)}${r.unit && r.unit !== "each" ? ` / ${r.unit}` : ""}${r.list ? ` (list ${money(r.list)}${r.discount != null ? `, ${Math.round(r.discount)}% off` : ""})` : ""}`,
      tone: "text-ink font-bold",
    };
  if (r.list != null) return { text: `List ${money(r.list)}${r.unit && r.unit !== "each" ? ` / ${r.unit}` : ""} · before the contract discount`, tone: "text-ink font-bold" };
  if (r.discount != null) return { text: `${r.discount}% off list · list price not published`, tone: "text-ink" };
  if (r.status === "member_login") return { text: "Price behind the co-op's member login", tone: "text-slate" };
  return { text: "Quote from the supplier", tone: "text-slate" };
}

/** Products from co-op catalogs that match the request, each with every contract that sells it.
 * Ordering happens on the co-op's site; prices are as published, with their vintage. */
export function CatalogProducts({ data, requestId }: { data: Results["catalog_products"]; requestId: string }) {
  const [all, setAll] = useState(false);
  if (!data?.hits.length) return null;
  const shown = all ? data.hits : data.hits.slice(0, 4);
  return (
    <section id="catalog-products" className="scroll-mt-24">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold tracking-tight text-navy">{data.hits.some((h) => h.routes.some((r) => r.trx)) ? "Products on state and co-op contracts" : "Products on co-op contracts"}</h2>
          <p className="mt-0.5 max-w-2xl text-xs text-slate">
            From co-ops' public product tables and price files{data.hits.some((h) => h.routes.some((r) => r.trx)) ? ", and state contracts' awarded line items" : ""}. Each lists every contract that sells it. Prices are as published, not a quote: confirm the current price,
            options and freight with the supplier.
          </p>
        </div>
        <span className="text-xs text-slate">{data.total} matching</span>
      </div>
      <ul className="mt-3 grid gap-3 lg:grid-cols-2">
        {shown.map((h) => (
          <ProductCard key={h.product_id} h={h} requestId={requestId} />
        ))}
      </ul>
      {data.hits.length > shown.length && (
        <button onClick={() => setAll(true)} className="mt-2 text-xs font-semibold text-maroon hover:underline">
          Show {data.hits.length - shown.length} more
        </button>
      )}
    </section>
  );
}

function ProductCard({ h, requestId }: { h: CatalogProductHit; requestId: string }) {
  const { db } = useStore();
  const buyer = db?.session.buyer ?? null;
  const [open, setOpen] = useState(false);
  const routes = open ? h.routes : h.routes.slice(0, 3);
  const vintage = h.routes.find((r) => r.vintage)?.vintage;
  return (
    <li className="rounded-xl border border-line bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-navy">{h.name}</div>
          <div className="mt-0.5 text-[11px] text-slate">
            {[h.maker, h.mpn && h.mpn !== h.name ? `MPN ${h.mpn}` : null].filter(Boolean).join(" · ")}
            {h.routes.length > 1 && ` · on ${h.routes.length} contracts`}
          </div>
          {h.review && (
            <div className="mt-1">
              <Badge tone="amber">Name varies by source: check the SKU</Badge>
            </div>
          )}
        </div>
        <FitPill fit={h.fit} />
      </div>
      <ul className="mt-3 divide-y divide-base-lighter border-t border-base-lighter">
        {routes.map((r) => {
          const p = priceLine(r);
          return (
            <li key={r.offering_id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <div className="min-w-0 text-[11px]">
                <div>
                  <span className="font-semibold text-navy">{r.coop}</span>{" "}
                  <Link href={`/contracts/${r.contract_id}`} className="font-mono text-slate underline decoration-base-light underline-offset-2 hover:text-maroon" title="Contract details">
                    {r.contract_number}
                  </Link>{" "}
                  {r.trx && (
                    <span title="A state contract on the TRX program, which Sovra supports. Agora lists it first for that state's buyers.">
                      <Badge tone="green">TRX</Badge>
                    </span>
                  )}{" "}
                  {buyer && r.coop_id !== "gsa_mas" && !r.member && !r.trx && <Badge tone="maroon">Join to use</Badge>}
                </div>
                <div className="text-slate">
                  <Link href={`/storefronts/${r.supplier_id}`} className="hover:text-maroon hover:underline">
                    {r.supplier}
                  </Link>
                  {!r.eligible && <span className="text-maroon"> · not open to you: {r.reason}</span>}
                </div>
                <div className={`mt-0.5 ${p.tone}`}>{p.text}</div>
              </div>
              <a
                href={goHref(r.contract_id, { request: requestId, offering: r.offering_id })}
                target="_blank"
                rel="noreferrer"
                className="text-xs font-semibold text-primary hover:underline"
                title={`Opens this item on ${r.coop}'s site`}
              >
                View on {r.coop.split(" ")[0]} ↗
              </a>
            </li>
          );
        })}
      </ul>
      {h.routes.length > routes.length && (
        <button onClick={() => setOpen(true)} className="mt-1 text-[11px] font-semibold text-maroon hover:underline">
          All {h.routes.length} contracts
        </button>
      )}
      {vintage && <p className="mt-2 text-[11px] text-slate">{/^(NJSTART|Hawaii SPO)/.test(vintage) ? `${vintage}.` : `Prices from the ${vintage} price file.`}</p>}
    </li>
  );
}
