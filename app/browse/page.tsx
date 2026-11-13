"use client";

import Link from "next/link";
import { goHref, listingLinksOut } from "@/lib/coops";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { CategoryIcon } from "@/components/CategoryIcon";
import { Search } from "@/components/icons";
import { useStore } from "@/components/store";
import { Card, Loading, PageTitle, SourcePill, money } from "@/components/ui";
import { CATEGORIES } from "@/lib/types";
import type { Category } from "@/lib/types";

const PAGE = 50;

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
  const [filter, setFilter] = useState("");
  const [limit, setLimit] = useState(PAGE);
  if (!db) return <Loading />;
  const listings = db.listings.filter((l) => l.marketplace_ids.includes("mkt_riverbend"));
  const counts = Object.fromEntries(CATEGORIES.map((c) => [c, listings.filter((l) => l.category === c).length]));
  const words = filter.toLowerCase().split(/\s+/).filter(Boolean);
  const inCat = listings.filter((l) => l.category === cat).sort((a, b) => a.title.localeCompare(b.title));
  const matching = words.length
    ? inCat.filter((l) => {
        const text = `${l.title} ${l.sku} ${l.keywords ?? ""}`.toLowerCase();
        return words.every((w) => text.includes(w));
      })
    : inCat;
  const shown = matching.slice(0, limit);

  return (
    <div>
      <PageTitle eyebrow="Browse by category" title="Everything in Agora">
        Asking is usually faster, but here's the full shelf, labeled by source.
      </PageTitle>
      <div className="grid gap-6 md:grid-cols-4">
        <nav className="space-y-1">
          {CATEGORIES.filter((c) => counts[c]).map((c) => (
            <button
              key={c}
              onClick={() => {
                setCat(c);
                setLimit(PAGE);
              }}
              className={`flex w-full justify-between rounded-md px-3 py-2 text-left text-sm ${cat === c ? "bg-primary-lighter text-primary-darker" : "text-navy hover:bg-white"}`}
            >
              {c} <span className={cat === c ? "text-steel" : "text-slate"}>{counts[c].toLocaleString()}</span>
            </button>
          ))}
        </nav>
        <div className="space-y-3 md:col-span-3">
          <div className="flex items-center gap-2 rounded-lg border border-navy/15 bg-white px-3 shadow-card">
            <Search className="h-4 w-4 text-slate" />
            <input
              value={filter}
              onChange={(e) => {
                setFilter(e.target.value);
                setLimit(PAGE);
              }}
              placeholder={`Filter ${counts[cat]?.toLocaleString() ?? 0} items in ${cat.toLowerCase()} by name, SKU or product line`}
              className="flex-1 !border-0 !px-1 !shadow-none !ring-0"
              aria-label="Filter this category"
            />
            {words.length > 0 && <span className="whitespace-nowrap text-xs text-slate">{matching.length.toLocaleString()} found</span>}
          </div>
          <Card className="divide-y divide-navy/5">
            {shown.map((l) => {
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
            {!shown.length && <div className="p-4 text-sm text-slate">Nothing in {cat.toLowerCase()} matches that filter.</div>}
          </Card>
          {matching.length > limit && (
            <button onClick={() => setLimit(limit + PAGE)} className="w-full rounded-lg border border-dashed border-navy/20 py-2 text-sm font-semibold text-navy hover:bg-white">
              Show {Math.min(PAGE, matching.length - limit)} more of {(matching.length - limit).toLocaleString()} remaining
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
