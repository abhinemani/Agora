"use client";

// The whole shelf by category: Riverbend's buyable items first, then every product on the co-op and state contracts in
// the catalog, a page at a time from the server (/api/catalog/browse), since the catalog is too large to send whole.

import Link from "next/link";
import { goHref, listingLinksOut } from "@/lib/coops";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { CategoryIcon } from "@/components/CategoryIcon";
import { Search } from "@/components/icons";
import { useStore } from "@/components/store";
import { Badge, Card, Loading, PageTitle, SourcePill, money } from "@/components/ui";
import type { BrowseCategory, BrowseItem } from "@/lib/catalog";
import type { Category } from "@/lib/types";

interface Shelf {
  categories: BrowseCategory[];
  category: string;
  total: number;
  items: BrowseItem[];
}

export default function BrowsePage() {
  return (
    <Suspense fallback={<Loading />}>
      <Browse />
    </Suspense>
  );
}

function Browse() {
  const { db } = useStore();
  const [cat, setCat] = useState<string>(useSearchParams().get("cat") ?? "Furniture");
  const [typed, setTyped] = useState("");
  const [filter, setFilter] = useState("");
  const [shelf, setShelf] = useState<Shelf | null>(null);
  const [items, setItems] = useState<BrowseItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The filter waits for a pause in typing before it asks the server.
  useEffect(() => {
    const t = setTimeout(() => setFilter(typed.trim()), 300);
    return () => clearTimeout(t);
  }, [typed]);

  const url = (offset: number) => `/api/catalog/browse?${new URLSearchParams({ category: cat, ...(filter ? { q: filter } : {}), ...(offset ? { offset: String(offset) } : {}) })}`;
  useEffect(() => {
    let live = true;
    setBusy(true);
    setError(null);
    fetch(url(0))
      .then((r) => r.json())
      .then((j: Shelf) => {
        if (!live) return;
        setShelf(j);
        setItems(j.items);
      })
      .catch(() => live && setError("Couldn't load this category. Try again."))
      .finally(() => live && setBusy(false));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cat, filter]);

  const more = () => {
    setBusy(true);
    fetch(url(items.length))
      .then((r) => r.json())
      .then((j: Shelf) => setItems((have) => [...have, ...j.items]))
      .catch(() => setError("Couldn't load more. Try again."))
      .finally(() => setBusy(false));
  };

  if (!db) return <Loading />;
  // Riverbend's own marketplace: items a buyer can put in the cart here.
  const listings = db.listings.filter((l) => l.marketplace_ids.includes("mkt_riverbend"));
  const words = filter.toLowerCase().split(/\s+/).filter(Boolean);
  const local = listings
    .filter((l) => l.category === cat)
    .filter((l) => !words.length || words.every((w) => `${l.title} ${l.sku} ${l.keywords ?? ""}`.toLowerCase().includes(w)))
    .sort((a, b) => a.title.localeCompare(b.title));
  const localCount = (c: string) => listings.filter((l) => l.category === c).length;
  const current = shelf?.categories.find((c) => c.name === cat);

  return (
    <div>
      <PageTitle eyebrow="Browse by category" title="Everything in Agora">
        Asking is usually faster, but here&apos;s the full shelf, labeled by source.
      </PageTitle>
      <div className="grid gap-6 md:grid-cols-4">
        <nav className="min-w-0 space-y-1" aria-label="Categories">
          {!shelf && <div className="px-3 py-2 text-sm text-slate">Loading categories…</div>}
          {(shelf?.categories ?? []).map((c) => {
            const n = c.products + localCount(c.name);
            return (
              <button
                key={c.name}
                onClick={() => setCat(c.name)}
                className={`flex w-full justify-between gap-2 rounded-md px-3 py-2 text-left text-sm ${cat === c.name ? "bg-primary-lighter text-primary-darker" : "text-navy hover:bg-white"}`}
              >
                {c.name} <span className={cat === c.name ? "text-steel" : "text-slate"}>{n.toLocaleString()}</span>
              </button>
            );
          })}
        </nav>
        <div className="min-w-0 space-y-4 md:col-span-3">
          <div className="flex items-center gap-2 rounded-lg border border-navy/15 bg-white px-3 shadow-card">
            <Search className="h-4 w-4 text-slate" />
            <input
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder={`Filter ${cat.toLowerCase()} by name, maker, part number or supplier`}
              className="flex-1 !border-0 !px-1 !shadow-none !ring-0"
              aria-label="Filter this category"
            />
            {words.length > 0 && shelf && <span className="whitespace-nowrap text-xs text-slate">{(shelf.total + local.length).toLocaleString()} found</span>}
          </div>

          {local.length > 0 && (
            <section className="space-y-2">
              <h2 className="text-sm font-bold text-ink">Buy in Agora: Riverbend&apos;s marketplace</h2>
              <Card className="divide-y divide-navy/5">
                {local.map((l) => {
                  const s = db.suppliers.find((x) => x.id === l.supplier_id)!;
                  return (
                    <div key={l.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
                      <CategoryIcon category={l.category as Category} size="sm" />
                      <div className="min-w-0 flex-1">
                        <Link href={`/product/${l.id}`} className="text-sm font-semibold text-navy hover:text-maroon hover:underline">
                          {l.title}
                        </Link>
                        {l.path && <div className="truncate text-xs text-slate">{l.path}</div>}
                        <div className="mt-1 flex items-center gap-2 text-xs text-slate">
                          <SourcePill source={l.source} contractId={l.contract_id} /> {s.name}
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-sm font-semibold text-navy">
                          {money(l.unit_price)} <span className="text-xs font-normal text-slate">/ {l.unit}</span>
                        </span>
                        {listingLinksOut(db, l) ? (
                          <a href={goHref(l.contract_id!, { listing: l.id })} target="_blank" rel="noreferrer" className="rounded-md border border-navy/20 px-2.5 py-1 text-xs font-semibold text-navy hover:bg-tint">
                            On {db.contracts.find((c) => c.id === l.contract_id)?.vehicle ?? "co-op"} ↗
                          </a>
                        ) : (
                          <Link href={`/checkout?listing=${l.id}&qty=1`} className="rounded-md border border-navy/20 px-2.5 py-1 text-xs font-semibold text-navy hover:bg-tint">
                            Buy
                          </Link>
                        )}
                      </div>
                    </div>
                  );
                })}
              </Card>
            </section>
          )}

          <section className="space-y-2">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-sm font-bold text-ink">On co-op and state contracts</h2>
              {current && (
                <Link href={`/contracts?category=${encodeURIComponent(cat)}`} className="text-xs font-semibold text-primary hover:underline">
                  See {cat.toLowerCase()} contracts in the explorer →
                </Link>
              )}
            </div>
            {current && !words.length && (
              <p className="text-xs text-slate">
                {current.products.toLocaleString()} products, {current.priced.toLocaleString()} with a price on file. Priced items come first; the rest are sold by quote under their contract.
              </p>
            )}
            {error && <p className="text-sm text-maroon">{error}</p>}
            <Card className="divide-y divide-navy/5">
              {items.map((x) => (
                <div key={x.product_id} className="flex flex-wrap items-center justify-between gap-3 p-4">
                  <div className="w-full min-w-0 [overflow-wrap:anywhere] sm:w-auto sm:flex-1">
                    <div className="text-sm font-semibold text-navy">{x.name}</div>
                    {(x.maker || x.mpn) && <div className="text-xs text-slate">{[x.maker, x.mpn].filter(Boolean).join(" · ")}</div>}
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate">
                      {x.trx ? <Badge tone="green">TRX</Badge> : <Badge tone="navy">{x.kind === "state" ? "State contract" : "Co-op"}</Badge>}
                      <span className="font-semibold text-ink">{x.program}</span>
                      <Link href={`/storefronts/${x.supplier_id}`} className="hover:text-maroon hover:underline">
                        {x.supplier}
                      </Link>
                      {x.contracts > 1 && <span>· on {x.contracts} contracts</span>}
                    </div>
                    {x.price != null && x.vintage && <div className="mt-1 text-[11px] text-slate">{x.vintage}</div>}
                  </div>
                  <div className="flex w-full items-center justify-between gap-3 sm:w-auto sm:justify-end">
                    <span className="text-sm font-semibold text-navy">
                      {x.price != null ? (
                        <>
                          {money(x.price)} {x.unit && <span className="text-xs font-normal text-slate">/ {x.unit}</span>}
                        </>
                      ) : (
                        <span className="text-xs font-normal text-slate">Price by quote</span>
                      )}
                    </span>
                    <Link href={`/contracts/${x.contract_id}`} className="rounded-md border border-navy/20 px-2.5 py-1 text-xs font-semibold text-navy hover:bg-tint" title="Terms, documents and how to buy under this contract">
                      Contract
                    </Link>
                  </div>
                </div>
              ))}
              {!busy && shelf && !items.length && <div className="p-4 text-sm text-slate">Nothing on contracts in {cat.toLowerCase()} matches that filter.</div>}
              {busy && !items.length && <div className="p-4 text-sm text-slate">Loading…</div>}
            </Card>
            {shelf && items.length < shelf.total && (
              <button onClick={more} disabled={busy} className="w-full rounded-lg border border-dashed border-navy/20 py-2 text-sm font-semibold text-navy hover:bg-white disabled:opacity-60">
                {busy ? "Loading…" : `Show ${Math.min(50, shelf.total - items.length)} more of ${(shelf.total - items.length).toLocaleString()} remaining`}
              </button>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
