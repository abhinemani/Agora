"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { BlueprintBackdrop, DimensionFrame } from "@/components/BlueprintBackdrop";
import { BuyerPicker } from "@/components/BuyerPicker";
import { Annotation } from "@/components/blueprint";
import { CategoryIcon } from "@/components/CategoryIcon";
import { FrontDoor } from "@/components/FrontDoor";
import { HeroPreview } from "@/components/HeroPreview";
import { TwoProducts } from "@/components/TwoProducts";
import { Arrow, Search } from "@/components/icons";
import { useStore } from "@/components/store";
import { ErrorNote, Loading, money } from "@/components/ui";
import type { Listing, Request } from "@/lib/types";
import { CATEGORIES } from "@/lib/types";
import { EXAMPLES, fromSearch, requestKind, toSearch, type FrontDoorUrl } from "@/lib/front-door";

const KIND_TAG = { product: "Product", contract: "Contract" } as const;
const STEPS = ["Who's buying", "How many", "Which one", "How to buy it"];
/** The worked example: one request, three contracts. */
const PREVIEW = ["lst_001", "lst_014", "lst_021"];

export default function Home() {
  const { db, act, role, setRole } = useStore();
  const router = useRouter();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [totals, setTotals] = useState<{ contracts: number; suppliers: number; products: number; programs: number; categories: { name: string; products: number }[] } | null>(null);
  useEffect(() => {
    let live = true;
    fetch("/api/catalog/summary")
      .then((r) => r.json())
      .then((j) => live && setTotals(j))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);
  const input = useRef<HTMLInputElement>(null);
  // The guided search, when the address holds a request (/?q=…). Back and forward move between it and the hero.
  const [door, setDoor] = useState<{ url: FrontDoorUrl; key: number } | null>(null);
  useEffect(() => {
    const sync = () => setDoor((d) => {
      const url = fromSearch(window.location.search);
      return url ? { url, key: (d?.key ?? 0) + 1 } : null;
    });
    sync();
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, []);
  const openDoor = (need: string) => {
    window.history.pushState(null, "", `/${toSearch({ need })}`);
    setDoor((d) => ({ url: { need }, key: (d?.key ?? 0) + 1 }));
    window.scrollTo(0, 0);
  };

  useEffect(() => {
    if (role !== "buyer") setRole("buyer");
  }, [role, setRole]);

  if (!db) return <Loading />;

  const byId = (id: string) => db.listings.find((l) => l.id === id);
  const preview = PREVIEW.map(byId)
    .filter((l): l is Listing => !!l)
    .map((listing) => ({ listing, supplier: db.suppliers.find((s) => s.id === listing.supplier_id)! }))
    .filter((r) => r.supplier);
  // Riverbend's own marketplace, plus the co-op and state catalog on the server (/api/catalog/summary).
  const localSuppliers = new Set(db.listings.map((l) => l.supplier_id)).size;
  const localProducts = new Set(db.listings.map((l) => l.family ?? l.id)).size;
  const vehicles = [...new Set(db.contracts.map((c) => c.vehicle).filter((v): v is string => !!v && v !== "Reseller"))];
  const contractCount = db.contracts.length + (totals?.contracts ?? 0);
  const suppliers = localSuppliers + (totals?.suppliers ?? 0);
  const products = localProducts + (totals?.products ?? 0);
  const programs = vehicles.length + (totals?.programs ?? 0);
  const n = (x: number) => (totals ? x.toLocaleString() : "…");
  const prices = preview.map((r) => r.listing.unit_price).filter((n) => Number.isFinite(n));
  const priceRange = prices.length > 1 ? `${money(Math.min(...prices), false)}–${money(Math.max(...prices), false)} each` : undefined;

  const submit = async (q: string) => {
    if (!q.trim()) {
      input.current?.focus();
      return;
    }
    // Products are narrowed here first; software, services and construction go to the results page and its contracts.
    if (requestKind(q) === "product") return openDoor(q.trim());
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

  if (door)
    return (
      <FrontDoor
        key={door.key}
        initial={door.url}
        onNewSearch={(need) => {
          if (need) {
            if (requestKind(need) === "product") return openDoor(need);
            window.history.pushState(null, "", "/");
            setDoor(null);
            return void submit(need);
          }
          window.history.pushState(null, "", "/");
          setDoor(null);
          setText("");
        }}
      />
    );

  return (
    <div className="pb-8">
      {/* Hero: one question, one box, drawn as a blueprint. Full bleed, out of main's padding. */}
      <section className="relative -mt-8 mx-[calc(50%-50vw)] overflow-hidden bg-[#0F3D73] px-8 pb-48 pt-16 text-center sm:pt-24 md:px-5 md:pb-32">
        <BlueprintBackdrop contracts={contractCount} suppliers={suppliers} products={products} vehicles={programs} priceRange={priceRange} />
        <div className="relative mx-auto max-w-3xl">
          <div className="text-ui-2xs font-bold text-[#A8CBF2]">Government buying, simplified</div>
          <h1 className="mx-auto mt-5 max-w-3xl font-heading text-[clamp(2rem,4.4vw,3.4rem)] font-bold leading-[1.12] text-[#fff]">What are you looking to buy?</h1>
          <p className="mx-auto mt-4 max-w-xl text-base leading-relaxed text-[#D3E3F6]">
            Describe it in your own words. Agora asks a few questions, then shows what your agency can buy on state and cooperative contracts, and how to buy it.
          </p>
          <div className="mx-auto mt-14 max-w-3xl">
            <DimensionFrame working={busy} label={busy ? `FIG. 2 · CHECKING ${n(contractCount)} CONTRACTS` : `FIG. 2 · SEARCH ${n(contractCount)} CONTRACTS`}>
              <form
                className="flex flex-col gap-2 bg-[#fff] p-1.5 focus-within:outline focus-within:outline-4 focus-within:outline-focus sm:flex-row sm:items-center sm:pl-4"
                onSubmit={(e) => {
                  e.preventDefault();
                  submit(text);
                }}
              >
                <div className="flex min-w-0 flex-1 items-center gap-2 pl-2.5 sm:pl-0">
                  <Search className="h-5 w-5 shrink-0 text-[#6B7686]" />
                  <input
                    ref={input}
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    placeholder="Describe what you need, like “permitting software for a mid-size city”"
                    className="min-w-0 flex-1 !border-0 !bg-[#fff] !px-1 !py-3.5 !text-body-sm !text-[#1B1B1B] !shadow-none !outline-none !ring-0 placeholder:!text-[#71767A]"
                    aria-label="What are you looking to buy?"
                  />
                </div>
                <button
                  type="submit"
                  disabled={busy}
                  className="inline-flex shrink-0 items-center justify-center gap-1.5 self-stretch bg-[#13294B] px-5 py-3.5 text-ui-xs font-bold text-[#fff] transition hover:bg-[#0B1E38] active:bg-black disabled:opacity-70 sm:px-7 sm:py-0"
                >
                  {busy ? "Searching…" : "Start"} <Arrow className="hidden h-4 w-4 sm:block" />
                </button>
              </form>
            </DimensionFrame>
          </div>
          {/* What happens after Start, in the same words as the steps on the next screen. */}
          <ol aria-label="What happens next" className="mx-auto mt-5 flex max-w-3xl flex-wrap justify-center gap-x-5 gap-y-2 text-[13px] text-[#D3E3F6]">
            {STEPS.map((s, i) => (
              <li key={s} className="flex items-center gap-2">
                <span className="border border-[rgba(255,255,255,0.5)] px-1.5 py-1 font-mono text-[10.5px] font-bold leading-none text-[#fff]">{i + 1}</span>
                {s}
              </li>
            ))}
          </ol>
          <div className="mx-auto mt-7 flex max-w-3xl flex-wrap justify-center gap-2.5">
            {EXAMPLES.map((e) => (
              <button
                key={e}
                onClick={() => submit(e)}
                disabled={busy}
                className="inline-flex items-center gap-2 rounded-full border border-[rgba(255,255,255,0.4)] bg-[rgba(255,255,255,0.05)] px-3.5 py-1.5 text-ui-2xs text-[#fff] transition hover:border-[rgba(255,255,255,0.8)] hover:bg-[rgba(255,255,255,0.15)] disabled:opacity-60"
              >
                {e}
                <span className="font-mono text-[9.5px] uppercase tracking-[0.1em] text-[#A8CBF2]">{KIND_TAG[requestKind(e)]}</span>
              </button>
            ))}
          </div>
          {/* Who's buying: optional, kept in this browser, and it decides which contracts show as usable. */}
          <div className="mx-auto mt-7 flex max-w-3xl flex-wrap items-center justify-center gap-x-3 gap-y-2 text-[13px] text-[#D3E3F6]">
            {db.session.buyer ? (
              <span>
                Showing what <strong className="font-bold text-[#fff]">{db.session.buyer.name}, {db.session.buyer.state}</strong> can buy.
              </span>
            ) : (
              <span>Searching every contract. Select your agency to see only what you can buy.</span>
            )}
            <button
              type="button"
              onClick={() => setPicking(!picking)}
              aria-expanded={picking}
              className="inline-flex min-h-[44px] items-center border border-[rgba(255,255,255,0.6)] px-3.5 text-ui-2xs font-bold text-[#fff] hover:bg-[rgba(255,255,255,0.15)]"
            >
              {picking ? "Close" : db.session.buyer ? "Change agency" : "Select your agency"}
            </button>
          </div>
          {picking && (
            <div className="mx-auto mt-4 max-w-3xl text-left">
              <BuyerPicker compact onDone={() => setPicking(false)} onClose={() => setPicking(false)} />
            </div>
          )}
          <p className="mt-4 text-[13px] text-[#BFD5EE]">No sign-in or contract number required. Your agency is remembered in this browser.</p>
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
      <section className="grid grid-cols-1 items-center gap-10 border border-base-lighter bg-white p-6 sm:p-10 md:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
        <div>
          <Annotation fig={3}>One request, every contract</Annotation>
          <h2 className="mt-3 text-[1.9rem] font-bold leading-tight text-ink">Stop checking five portals for the same folding table.</h2>
          <p className="mt-3 text-[15px] leading-relaxed text-slate">
            Agora reads {n(contractCount)} contracts from {n(suppliers)} suppliers, {n(products)} products in all, and lines them up side by side. Tell it your agency
            and it hides the ones you can't use; leave it blank and it shows who each contract is open to.
          </p>
          <dl className="mt-6 grid grid-cols-3 border border-base-lighter">
            {[
              [n(contractCount), "contracts"],
              [n(suppliers), "suppliers"],
              [n(products), "products"],
            ].map(([n, label], i) => (
              <div key={label} className={`flex flex-col-reverse px-4 py-3 ${i ? "border-l border-base-lighter" : ""}`}>
                <dt className="font-mono text-[11px] uppercase tracking-[0.14em] text-base-dark">{label}</dt>
                <dd className="text-2xl font-bold tabular-nums tracking-tight text-ink">{n}</dd>
              </div>
            ))}
          </dl>
        </div>
        {preview.length > 0 && <HeroPreview rows={preview} contractCount={contractCount} onRun={() => submit("40 folding tables for the rec center")} />}
      </section>

      <section className="mt-14">
        <div className="flex items-end justify-between gap-4">
          <div>
            <Annotation fig={4}>Categories</Annotation>
            <h2 className="mt-2 text-xl font-bold tracking-tight text-ink">Browse by category</h2>
          </div>
          <Link href="/browse" className="text-sm font-semibold text-primary hover:underline">
            See everything
          </Link>
        </div>
        <div className="mt-4 grid grid-cols-2 border-l border-t border-base-lighter sm:grid-cols-3 lg:grid-cols-6">
          {CATEGORIES.map((c) => ({ c, count: new Set(db.listings.filter((l) => l.category === c).map((l) => l.family ?? l.id)).size + (totals?.categories.find((x) => x.name === c)?.products ?? 0) })).filter((x) => x.count > 0).map(({ c, count }) => {
            return (
              <Link
                key={c}
                href={`/browse?cat=${encodeURIComponent(c)}`}
                className="group flex flex-col justify-between gap-6 border-b border-r border-base-lighter bg-white p-4 no-underline transition-colors hover:bg-primary-lighter/40"
              >
                <CategoryIcon category={c} size="md" />
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold text-ink group-hover:text-primary">{c}</span>
                  <span className="mt-0.5 block font-mono text-[11px] uppercase tracking-[0.12em] text-base-dark">
                    {count.toLocaleString()} products
                  </span>
                </span>
              </Link>
            );
          })}
        </div>
      </section>

      {/* What we sell on top of the free marketplace: one product per side. */}
      <section className="relative mt-14 overflow-hidden bg-[#0F3D73] bg-[linear-gradient(rgba(255,255,255,0.05)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.05)_1px,transparent_1px)] bg-[length:16px_16px] p-8 text-[#fff] sm:p-10">
        <div className="max-w-2xl">
          <Annotation fig={5} className="text-[#A8CBF2]">
            Built on Agora
          </Annotation>
          <h2 className="mt-3 text-[1.8rem] font-bold leading-tight">A marketplace for your city. A storefront for your company.</h2>
          <p className="mt-3 text-[15px] leading-relaxed text-[#D3E3F6]">
            Searching Agora is free. A city can run its own marketplace on it, with its contracts and rules; a supplier can run a storefront in it, with its catalog and
            reviews. Riverbend's marketplace is live as an example.
          </p>
        </div>
        <div className="mt-6">
          <TwoProducts dark />
        </div>
        <Link href="/marketplaces/riverbend" className="mt-5 inline-flex items-center gap-1 text-sm font-semibold text-[#fff] hover:underline">
          Open Riverbend's city marketplace <Arrow className="h-4 w-4" />
        </Link>
      </section>

    </div>
  );
}
