"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { CATEGORY_TONE, CategoryIcon } from "@/components/CategoryIcon";
import { HeroPreview } from "@/components/HeroPreview";
import { Arrow, Search } from "@/components/icons";
import { useStore } from "@/components/store";
import { ErrorNote, Loading } from "@/components/ui";
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

  const submit = async (q: string) => {
    if (!q.trim()) return;
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
      {/* Hero: one question, one box. */}
      <section className="px-1 pb-14 pt-12 text-center sm:pt-20">
        <div className="text-[11px] font-extrabold uppercase tracking-[0.18em] text-maroon/80">Government buying, simplified</div>
        <h1 className="mx-auto mt-4 max-w-3xl text-[clamp(2.1rem,5vw,3.6rem)] font-extrabold leading-[1.07] tracking-[-0.04em] text-navy">What are you looking to buy?</h1>
        <p className="mx-auto mt-4 max-w-xl text-base leading-relaxed text-slate">
          Search state and cooperative contracts in one place. Agora shows which ones your agency can use, what they cost, and how to buy.
        </p>
        <form
          className="mx-auto mt-8 flex max-w-3xl items-center gap-2 rounded-2xl border border-[#d4ddeb] bg-white p-2 pl-4 shadow-[0_16px_50px_rgba(44,71,122,0.08)] focus-within:border-maroon/50"
          onSubmit={(e) => {
            e.preventDefault();
            submit(text);
          }}
        >
          <Search className="h-5 w-5 shrink-0 text-steel" />
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Describe what you need, like “permitting software for a mid-size city”"
            className="min-w-0 flex-1 !border-0 !px-1 !py-3 !text-[15px] !shadow-none !outline-none !ring-0"
            aria-label="What are you looking to buy?"
          />
          <button
            type="submit"
            disabled={busy || !text.trim()}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-[10px] bg-maroon px-4 py-3.5 text-sm font-bold text-white transition hover:bg-maroon-600 disabled:opacity-50 sm:px-5"
          >
            Find solutions <Arrow className="hidden h-4 w-4 sm:block" />
          </button>
        </form>
        <div className="mx-auto mt-5 flex max-w-3xl flex-wrap justify-center gap-2">
          {EXAMPLES.map((e) => (
            <button
              key={e}
              onClick={() => submit(e)}
              disabled={busy}
              className="rounded-full border border-line bg-white px-3.5 py-2 text-xs text-[#4c607e] transition hover:border-maroon hover:text-maroon"
            >
              {e}
            </button>
          ))}
        </div>
        <p className="mt-4 text-[11px] text-slate">No setup, forms, or contract number required.</p>
        <div className="mx-auto mt-3 max-w-xl">
          <ErrorNote message={error} />
        </div>
      </section>

      {/* How it works, shown rather than told. */}
      <section className="grid items-center gap-10 rounded-3xl border border-line bg-white p-6 sm:p-10 md:grid-cols-[1fr_1.05fr]">
        <div>
          <div className="text-[11px] font-extrabold uppercase tracking-[0.18em] text-maroon/80">One request, every contract</div>
          <h2 className="mt-3 text-[1.9rem] font-extrabold leading-tight tracking-[-0.03em] text-navy">Stop checking five portals for the same folding table.</h2>
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

      {/* The product we sell on top: a city's own storefront. */}
      <section className="mt-14 grid gap-8 overflow-hidden rounded-3xl bg-navy p-8 text-white sm:p-10 md:grid-cols-[1.2fr_1fr] md:items-center">
        <div>
          <div className="text-[11px] font-extrabold uppercase tracking-[0.18em] text-white/60">City storefronts</div>
          <h2 className="mt-3 text-[1.8rem] font-extrabold leading-tight tracking-[-0.03em]">Your city's own corner of Agora.</h2>
          <p className="mt-3 max-w-lg text-[15px] leading-relaxed text-white/75">
            A storefront narrows the marketplace to the contracts your staff may use, adds your own awards and quick-buy limits, and puts renewals and reorders on one page.
          </p>
          <Link href="/storefronts" className="mt-6 inline-flex items-center gap-1.5 rounded-[10px] bg-white px-4 py-3 text-sm font-bold text-navy hover:bg-white/90">
            See storefronts <Arrow className="h-4 w-4" />
          </Link>
        </div>
        <Link href="/storefronts/riverbend" className="block rounded-2xl bg-white/10 p-5 ring-1 ring-white/15 transition hover:bg-white/15">
          <div className="text-xs text-white/60">Live example</div>
          <div className="mt-1 text-lg font-bold">City of Riverbend, OR</div>
          <div className="mt-1 text-sm text-white/70">Own contracts, a $10K quick-buy limit, renewal reminders, and one-click reorders.</div>
          <div className="mt-4 inline-flex items-center gap-1 text-sm font-semibold">
            Visit storefront <Arrow className="h-4 w-4" />
          </div>
        </Link>
      </section>

      <section className="mt-14 flex flex-wrap items-center gap-x-8 gap-y-3 border-t border-line pt-8">
        <span className="text-sm text-slate">Contracts in Agora</span>
        {vehicles.map((v) => (
          <Link key={v} href="/vehicles" className="text-sm font-semibold tracking-tight text-slate/80 hover:text-navy">
            {v}
          </Link>
        ))}
      </section>
    </div>
  );
}
