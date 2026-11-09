"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { CategoryIcon } from "@/components/CategoryIcon";
import { Check, Lock, Search } from "@/components/icons";
import { useStore } from "@/components/store";
import { ErrorNote, Loading, SourcePill, Stars, SupplierBadges, money, supplierColor } from "@/components/ui";
import type { Listing } from "@/lib/types";
import { checkEligibility, defaultVariant } from "@/lib/vehicles";

const PAGE = 12;

/** A supplier's storefront: its catalog, the contracts it sells through, and its reviews. */
export default function SupplierStorefront() {
  const { id } = useParams<{ id: string }>();
  const { db } = useStore();
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<string | null>(null);
  const [shown, setShown] = useState(PAGE);
  if (!db) return <Loading />;
  const s = db.suppliers.find((x) => x.id === id);
  if (!s) return <ErrorNote message="No storefront for that supplier." />;

  const buyer = db.session.buyer;
  const contracts = db.contracts.filter((c) => c.supplier_id === s.id);
  const reviews = db.reviews.filter((r) => r.supplier_id === s.id);
  const full = s.edge_tier === "position";

  // One card per product: tiers of the same product collapse to the tier that fits the buyer.
  const families = new Map<string, Listing[]>();
  for (const l of db.listings.filter((x) => x.supplier_id === s.id)) {
    const k = `${l.contract_id}|${l.family ?? l.id}`;
    families.set(k, [...(families.get(k) ?? []), l]);
  }
  const products = [...families.values()].map((ls) => ({ l: defaultVariant(ls, buyer), tiers: ls.length }));
  const categories = [...new Set(products.map((p) => p.l.category))];
  const needle = q.trim().toLowerCase();
  const filtered = products.filter(
    (p) => (!cat || p.l.category === cat) && (!needle || `${p.l.title} ${p.l.detail ?? ""} ${p.l.keywords ?? ""}`.toLowerCase().includes(needle)),
  );
  const nameOf = (l: Listing) => (l.variant && families.get(`${l.contract_id}|${l.family ?? l.id}`)!.length > 1 ? l.title.replace(/\s*\([^)]*\)\s*$/, "") : l.title);

  return (
    <div className="space-y-10 pb-8">
      <div>
        <Link href="/storefronts" className="text-sm text-slate hover:text-navy">
          ← Storefronts
        </Link>
        <div className="mt-4 overflow-hidden rounded-3xl border border-line bg-white">
          <div className="h-20" style={{ background: `linear-gradient(120deg, ${supplierColor(s.id)}, ${supplierColor(s.id)}99)` }} />
          <div className="flex flex-wrap items-end justify-between gap-6 px-6 pb-6 sm:px-8">
            <div className="-mt-8 min-w-0">
              <span className="grid h-16 w-16 place-items-center rounded-2xl border-4 border-white text-2xl font-extrabold text-white" style={{ background: supplierColor(s.id) }}>
                {s.name[0]}
              </span>
              <div className="mt-3 text-[11px] font-extrabold uppercase tracking-[0.18em] text-maroon/80">Storefront</div>
              <h1 className="mt-1 text-[2rem] font-extrabold leading-tight tracking-[-0.03em] text-navy">{s.name}</h1>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-slate">
                <span>
                  {s.city}, {s.state}
                </span>
                <SupplierBadges supplier={s} />
                <Stars rating={s.rating} count={s.review_count} />
              </div>
            </div>
            <dl className="grid grid-cols-3 gap-6 text-center">
              {[
                [products.length.toLocaleString(), "products"],
                [contracts.length, "contracts"],
                [new Set(reviews.map((r) => r.agency_name)).size, "agencies reviewed"],
              ].map(([n, label]) => (
                <div key={label}>
                  <dt className="text-2xl font-extrabold tracking-tight text-navy">{n}</dt>
                  <dd className="text-xs text-slate">{label}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
        {!full && (
          <p className="mt-2 text-xs text-slate">
            Basic storefront. Suppliers on the Edge Position plan get a featured storefront with insights and review responses.
          </p>
        )}
      </div>

      <section>
        <h2 className="text-xl font-extrabold tracking-tight text-navy">Ways to buy from {s.name}</h2>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {contracts.map((c) => {
            const access = checkEligibility(c, buyer);
            return (
              <div key={c.id} className="rounded-2xl border border-line bg-white p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold text-navy">{c.vehicle ?? c.owner}</span>
                  <span className="font-mono text-xs text-slate">{c.contract_number}</span>
                  <SourcePill source={c.source} />
                </div>
                <div className="mt-1 text-sm text-navy">{c.title}</div>
                <div className="mt-1 text-xs text-slate">{c.eligibility ? `Open to ${c.eligibility.note}` : "Open to the agency that holds it"}</div>
                {buyer && (
                  <div className={`mt-2 inline-flex items-center gap-1 text-xs font-semibold ${access.eligible ? "text-emerald-800" : "text-maroon"}`}>
                    {access.eligible ? <Check className="h-3.5 w-3.5" /> : <Lock className="h-3.5 w-3.5" />}
                    {access.eligible ? `Open to ${buyer.name}` : `Not open to ${buyer.name}`}
                  </div>
                )}
              </div>
            );
          })}
          {!contracts.length && <p className="text-sm text-slate">No contracts on file; small purchases only.</p>}
        </div>
      </section>

      <section>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h2 className="text-xl font-extrabold tracking-tight text-navy">Catalog</h2>
          <label className="flex w-full max-w-xs items-center gap-2 rounded-xl border border-line bg-white px-3 focus-within:border-maroon/50">
            <Search className="h-4 w-4 shrink-0 text-steel" />
            <input
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setShown(PAGE);
              }}
              placeholder={`Search ${s.name}`}
              aria-label={`Search ${s.name}'s catalog`}
              className="min-w-0 flex-1 !border-0 !px-0 !py-2 text-sm !shadow-none !outline-none !ring-0"
            />
          </label>
        </div>
        {categories.length > 1 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {[null, ...categories].map((c) => (
              <button
                key={c ?? "all"}
                onClick={() => {
                  setCat(c);
                  setShown(PAGE);
                }}
                className={`rounded-full border px-3 py-1.5 text-xs ${cat === c ? "border-maroon bg-maroon-50 text-maroon" : "border-line bg-white text-[#4c607e] hover:border-maroon"}`}
              >
                {c ?? "All"}
              </button>
            ))}
          </div>
        )}
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.slice(0, shown).map(({ l, tiers }) => (
            <Link key={l.id} href={`/product/${l.id}`} className="flex flex-col rounded-2xl border border-line bg-white p-4 transition hover:border-[#bbcae8]">
              <div className="flex items-start justify-between gap-3">
                <CategoryIcon category={l.category} size="sm" />
                <SourcePill source={l.source} />
              </div>
              <div className="mt-3 line-clamp-2 text-[15px] font-bold leading-snug text-navy">{nameOf(l)}</div>
              {l.detail && <p className="mt-1 line-clamp-2 text-xs text-slate">{l.detail}</p>}
              <div className="mt-auto flex items-end justify-between pt-3">
                <span className="text-[11px] text-slate">{tiers > 1 ? `${tiers} pricing tiers` : ""}</span>
                <span className="text-sm font-extrabold tabular-nums text-navy">
                  {tiers > 1 ? "from " : ""}
                  {money(Math.min(...families.get(`${l.contract_id}|${l.family ?? l.id}`)!.map((x) => x.unit_price)))}
                  <span className="text-[11px] font-medium text-slate"> / {l.unit}</span>
                </span>
              </div>
            </Link>
          ))}
        </div>
        {!filtered.length && <p className="mt-4 text-sm text-slate">Nothing in {s.name}'s catalog matches that.</p>}
        {filtered.length > shown && (
          <button onClick={() => setShown(shown + PAGE * 2)} className="mt-4 w-full rounded-xl border border-dashed border-navy/20 py-3 text-sm font-semibold text-navy hover:bg-white">
            Show more ({filtered.length - shown} left)
          </button>
        )}
      </section>

      {reviews.length > 0 && (
        <section>
          <h2 className="text-xl font-extrabold tracking-tight text-navy">What agencies say</h2>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            {reviews.map((r) => (
              <div key={r.id} className="rounded-2xl border border-line bg-white p-4">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold text-navy">{r.agency_name}</span>
                  <Stars rating={r.rating} />
                </div>
                <p className="mt-2 text-sm text-slate">{r.text}</p>
                {r.response && (
                  <p className="mt-2 border-l-2 border-line pl-3 text-xs text-slate">
                    <span className="font-semibold text-navy">{s.name} replied:</span> {r.response}
                  </p>
                )}
              </div>
            ))}
          </div>
        </section>
      )}
      <p className="text-xs text-slate">
        Storefronts are supplier pages. Looking for a city's own version of Agora?{" "}
        <Link href="/marketplaces" className="font-semibold text-maroon hover:underline">
          See city marketplaces
        </Link>
        .
      </p>
    </div>
  );
}
