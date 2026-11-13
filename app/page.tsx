"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { BlueprintBackdrop, DimensionFrame } from "@/components/BlueprintBackdrop";
import { CATEGORY_TONE, CategoryIcon } from "@/components/CategoryIcon";
import { HeroPreview } from "@/components/HeroPreview";
import { TwoProducts } from "@/components/TwoProducts";
import { Arrow, Search } from "@/components/icons";
import { useStore } from "@/components/store";
import { ErrorNote, Loading, money } from "@/components/ui";
import type { Listing, Request } from "@/lib/types";
import { CATEGORIES } from "@/lib/types";

const EXAMPLES = ["Computer-aided dispatch", "Jury management software", "Resident engagement platform", "40 folding tables", "Permitting software", "Project manager hours"];
/** The worked example: one request, three contracts. */
const PREVIEW = ["lst_001", "lst_014", "lst_021"];

export default function Home() {
  const { db, act, role, setRole } = useStore();
  const router = useRouter();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (role !== "buyer") setRole("buyer");
  }, [role, setRole]);

  if (!db) return <Loading />;

  const byId = (id: string) => db.listings.find((l) => l.id === id);
  const preview = PREVIEW.map(byId)
    .filter((l): l is Listing => !!l)
    .map((listing) => ({ listing, supplier: db.suppliers.find((s) => s.id === listing.supplier_id)! }))
    .filter((r) => r.supplier);
  const suppliers = new Set(db.listings.map((l) => l.supplier_id)).size;
  const products = new Set(db.listings.map((l) => l.family ?? l.id)).size;
  const vehicles = [...new Set(db.contracts.map((c) => c.vehicle).filter((v): v is string => !!v && v !== "Reseller"))];
  const prices = preview.map((r) => r.listing.unit_price).filter((n) => Number.isFinite(n));
  const priceRange = prices.length > 1 ? `${money(Math.min(...prices), false)}–${money(Math.max(...prices), false)} each` : undefined;

  const submit = async (q: string) => {
    if (!q.trim()) {
      input.current?.focus();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { request, needsPreference } = await act<{ request: Request; needsPreference: boolean }>("createRequest", { text: q });
      router.push(`/request/${request.id}${needsPreference ? "?ask=1" : ""}`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="pb-8">
      {/* Hero: one question, one box, drawn as a blueprint. Full bleed, out of main's padding. */}
      <section className="relative -mt-8 mx-[calc(50%-50vw)] overflow-hidden bg-[#0F3D73] px-8 pb-48 pt-16 text-center sm:pt-24 md:px-5 md:pb-32">
        <BlueprintBackdrop contracts={db.contracts.length} suppliers={suppliers} products={products} vehicles={vehicles.length} priceRange={priceRange} />
        <div className="relative mx-auto max-w-3xl">
          <div className="text-ui-2xs font-bold text-[#A8CBF2]">Government buying, simplified</div>
          <h1 className="mx-auto mt-5 max-w-3xl font-heading text-[clamp(2rem,4.4vw,3.4rem)] font-bold leading-[1.12] text-white">What are you looking to buy?</h1>
          <p className="mx-auto mt-4 max-w-xl text-base leading-relaxed text-[#D3E3F6]">
            Search state and cooperative contracts in one place. Agora shows which ones your agency can use, what they cost, and how to buy.
          </p>
          <div className="mx-auto mt-14 max-w-3xl">
            <DimensionFrame label={`FIG. 2 · SEARCH ${db.contracts.length} CONTRACTS`}>
              <form
                className="flex flex-col gap-2 bg-white p-1.5 focus-within:outline focus-within:outline-4 focus-within:outline-focus sm:flex-row sm:items-center sm:pl-4"
                onSubmit={(e) => {
                  e.preventDefault();
                  submit(text);
                }}
              >
                <div className="flex min-w-0 flex-1 items-center gap-2 pl-2.5 sm:pl-0">
                  <Search className="h-5 w-5 shrink-0 text-steel" />
                  <input
                    ref={input}
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    placeholder="Describe what you need, like “permitting software for a mid-size city”"
                    className="min-w-0 flex-1 !border-0 !px-1 !py-3.5 !text-body-sm !shadow-none !outline-none !ring-0"
                    aria-label="What are you looking to buy?"
                  />
                </div>
                <button
                  type="submit"
                  disabled={busy}
                  className="inline-flex shrink-0 items-center justify-center gap-1.5 self-stretch bg-[#13294B] px-5 py-3.5 text-ui-xs font-bold text-white transition hover:bg-primary-darker active:bg-black disabled:opacity-70 sm:px-7 sm:py-0"
                >
                  {busy ? "Searching…" : "Find solutions"} <Arrow className="hidden h-4 w-4 sm:block" />
                </button>
              </form>
            </DimensionFrame>
          </div>
          <div className="mx-auto mt-8 flex max-w-3xl flex-wrap justify-center gap-2.5">
            {EXAMPLES.map((e) => (
              <button
                key={e}
                onClick={() => submit(e)}
                disabled={busy}
                className="rounded-full border border-white/40 bg-white/5 px-3.5 py-1.5 text-ui-2xs text-white transition hover:border-white/80 hover:bg-white/15 disabled:opacity-60"
              >
                {e}
              </button>
            ))}
          </div>
          <p className="mt-5 text-[13px] text-[#BFD5EE]">No setup, forms, or contract number required.</p>
          <div className="mx-auto mt-3 max-w-xl">
            <ErrorNote message={error} />
          </div>
        </div>
      </section>

      {/* The drawing's legend: what Agora searches. */}
      <section className="mx-[calc(50%-50vw)] mb-12 border-b border-line bg-white px-5 py-6">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-center gap-x-7 gap-y-2">
          <span className="text-sm font-semibold text-ink">Searching {db.contracts.length} contracts from</span>
          {vehicles.map((v) => (
            <Link key={v} href="/vehicles" className="text-sm tracking-tight text-slate hover:text-navy">
              {v}
            </Link>
          ))}
        </div>
      </section>

      {/* How it works, shown rather than told. */}
      <section className="grid grid-cols-1 items-center gap-10 rounded-3xl border border-line bg-white p-6 sm:p-10 md:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
        <div>
          <div className="text-[11px] font-extrabold uppercase text-maroon/80">One request, every contract</div>
          <h2 className="mt-3 text-[1.9rem] font-extrabold leading-tight text-navy">Stop checking five portals for the same folding table.</h2>
          <p className="mt-3 text-[15px] leading-relaxed text-slate">
            Agora reads {db.contracts.length} contracts from {suppliers} suppliers, {products.toLocaleString()} products in all, and lines them up side by side. Tell it your agency
            and it hides the ones you can't use; leave it blank and it shows who each contract is open to.
          </p>
          <dl className="mt-6 grid grid-cols-3 gap-4 border-t border-line pt-5">
            {[
              [db.contracts.length, "contracts"],
              [suppliers, "suppliers"],
              [products.toLocaleString(), "products"],
            ].map(([n, label]) => (
              <div key={label}>
                <dt className="text-2xl font-extrabold tracking-tight text-navy">{n}</dt>
                <dd className="text-xs text-slate">{label}</dd>
              </div>
            ))}
          </dl>
        </div>
        {preview.length > 0 && <HeroPreview rows={preview} contractCount={db.contracts.length} onRun={() => submit("40 folding tables for the rec center")} />}
      </section>

      <section className="mt-14">
        <div className="flex items-end justify-between">
          <h2 className="text-xl font-extrabold tracking-tight text-navy">Browse by category</h2>
          <Link href="/browse" className="text-sm font-semibold text-maroon hover:underline">
            See everything
          </Link>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {CATEGORIES.filter((c) => db.listings.some((l) => l.category === c)).map((c) => {
            const n = new Set(db.listings.filter((l) => l.category === c).map((l) => l.family ?? l.id)).size;
            return (
              <Link
                key={c}
                href={`/browse?cat=${encodeURIComponent(c)}`}
                className="group flex flex-col justify-between gap-6 rounded-2xl p-4 transition-transform hover:-translate-y-0.5"
                style={{ background: CATEGORY_TONE[c].bg }}
              >
                <span className="w-fit rounded-xl bg-white/70 p-1">
                  <CategoryIcon category={c} size="md" />
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold text-navy">{c}</span>
                  <span className="block text-xs" style={{ color: CATEGORY_TONE[c].fg }}>
                    {n.toLocaleString()} products
                  </span>
                </span>
              </Link>
            );
          })}
        </div>
      </section>

      {/* What we sell on top of the free marketplace: one product per side. */}
      <section className="mt-14 overflow-hidden rounded-3xl bg-base-darkest p-8 text-white sm:p-10">
        <div className="max-w-2xl">
          <div className="text-[11px] font-extrabold uppercase text-white/60">Built on Agora</div>
          <h2 className="mt-3 text-[1.8rem] font-extrabold leading-tight">A marketplace for your city. A storefront for your company.</h2>
          <p className="mt-3 text-[15px] leading-relaxed text-white/75">
            Searching Agora is free. A city can run its own marketplace on it, with its contracts and rules; a supplier can run a storefront in it, with its catalog and
            reviews. Riverbend's marketplace is live as an example.
          </p>
        </div>
        <div className="mt-6">
          <TwoProducts dark />
        </div>
        <Link href="/marketplaces/riverbend" className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-white/80 hover:text-white">
          Open Riverbend's city marketplace <Arrow className="h-4 w-4" />
        </Link>
      </section>

    </div>
  );
}
