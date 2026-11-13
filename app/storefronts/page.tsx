"use client";

import Link from "next/link";
import { TwoProducts } from "@/components/TwoProducts";
import { useStore } from "@/components/store";
import { Loading, Stars, SupplierBadges, supplierColor } from "@/components/ui";

/** Storefronts are supplier pages: each vendor's catalog, contracts and reviews. */
export default function Storefronts() {
  const { db } = useStore();
  if (!db) return <Loading />;

  const rows = db.suppliers
    .map((s) => {
      const listings = db.listings.filter((l) => l.supplier_id === s.id);
      const products = new Set(listings.map((l) => l.family ?? l.id)).size;
      const contracts = db.contracts.filter((c) => c.supplier_id === s.id);
      const vehicles = [...new Set(contracts.map((c) => c.vehicle ?? c.owner))];
      return { s, products, contracts: contracts.length, vehicles, color: supplierColor(s.id) };
    })
    .sort((a, b) => Number(b.s.edge_tier === "position") - Number(a.s.edge_tier === "position") || b.products - a.products);

  return (
    <div className="space-y-12 pb-8">
      <div className="max-w-2xl pt-6">
        <div className="text-[11px] font-extrabold uppercase text-maroon/80">Storefronts</div>
        <h1 className="mt-3 text-[clamp(2rem,4vw,2.8rem)] font-extrabold leading-[1.1] text-navy">Every supplier, and everything they sell.</h1>
        <p className="mt-3 text-base leading-relaxed text-slate">
          A storefront is a supplier's own page in Agora: its catalog, the contracts you can buy it through, its certifications, and what other agencies say about it.
        </p>
      </div>

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {rows.map(({ s, products, contracts, vehicles, color }) => (
          <Link
            key={s.id}
            href={`/storefronts/${s.id}`}
            className="flex min-h-[230px] flex-col rounded-2xl border border-line bg-white p-5 transition hover:border-base-dark hover:shadow-2"
          >
            <div className="flex items-start justify-between gap-3">
              <span className="grid h-11 w-11 place-items-center rounded-xl text-lg font-extrabold text-white" style={{ background: color }}>
                {s.name[0]}
              </span>
              {s.edge_tier === "position" && <span className="rounded-md bg-success-lighter px-2 py-1 text-[10px] font-bold text-success-darker">Featured storefront</span>}
            </div>
            <div className="mt-4 text-lg font-bold tracking-tight text-navy">{s.name}</div>
            <div className="text-xs text-slate">{s.city ? `${s.city}, ${s.state}` : (s.website ?? "")}</div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <SupplierBadges supplier={s} />
              <Stars rating={s.rating} count={s.review_count} />
            </div>
            <div className="mt-auto border-t border-base-lighter pt-3 text-xs text-slate">
              <span className="font-semibold text-navy">{products.toLocaleString()}</span> product{products === 1 ? "" : "s"} ·{" "}
              <span className="font-semibold text-navy">{contracts}</span> contract{contracts === 1 ? "" : "s"}
              {vehicles.length ? ` · ${vehicles.slice(0, 3).join(", ")}` : ""}
            </div>
          </Link>
        ))}
      </section>

      <TwoProducts />
    </div>
  );
}
