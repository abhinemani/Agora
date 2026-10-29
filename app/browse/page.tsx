"use client";

import Link from "next/link";
import { useState } from "react";
import { useStore } from "@/components/store";
import { Card, Loading, PageTitle, SourcePill, money } from "@/components/ui";
import { CATEGORIES } from "@/lib/types";

export default function Browse() {
  const { db } = useStore();
  const [cat, setCat] = useState<string>("Furniture");
  if (!db) return <Loading />;
  const listings = db.listings.filter((l) => l.storefront_ids.includes("sf_riverbend"));
  const counts = Object.fromEntries(CATEGORIES.map((c) => [c, listings.filter((l) => l.category === c).length]));
  const shown = listings.filter((l) => l.category === cat).sort((a, b) => a.title.localeCompare(b.title));

  return (
    <div>
      <PageTitle eyebrow="Browse by category" title="Everything in Riverbend's storefront">
        Asking is usually faster, but here's the full shelf, labeled by source.
      </PageTitle>
      <div className="grid gap-6 md:grid-cols-4">
        <nav className="space-y-1">
          {CATEGORIES.filter((c) => counts[c]).map((c) => (
            <button key={c} onClick={() => setCat(c)} className={`flex w-full justify-between rounded-md px-3 py-2 text-left text-sm ${cat === c ? "bg-navy text-white" : "text-navy hover:bg-white"}`}>
              {c} <span className={cat === c ? "text-steel" : "text-slate"}>{counts[c]}</span>
            </button>
          ))}
        </nav>
        <Card className="divide-y divide-navy/5 md:col-span-3">
          {shown.map((l) => {
            const s = db.suppliers.find((x) => x.id === l.supplier_id)!;
            return (
              <div key={l.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
                <div>
                  <div className="text-sm font-semibold text-navy">{l.title}</div>
                  <div className="mt-1 flex items-center gap-2 text-xs text-slate">
                    <SourcePill source={l.source} /> {s.name}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-sm font-semibold text-navy">
                    {money(l.unit_price)} <span className="text-xs font-normal text-slate">/ {l.unit}</span>
                  </span>
                  <Link href={`/checkout?listing=${l.id}&qty=1`} className="rounded-md border border-navy/20 px-2.5 py-1 text-xs font-semibold text-navy hover:bg-tint">
                    Buy
                  </Link>
                </div>
              </div>
            );
          })}
        </Card>
      </div>
    </div>
  );
}
