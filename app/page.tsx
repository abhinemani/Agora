"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { BuyerPicker } from "@/components/BuyerPicker";
import { CATEGORY_TONE, CategoryIcon } from "@/components/CategoryIcon";
import { HeroPreview } from "@/components/HeroPreview";
import { Calendar, Chair, Repeat } from "@/components/icons";
import { Search } from "@/components/icons";
import { useStore } from "@/components/store";
import { Button, ErrorNote, Loading, SourcePill, money } from "@/components/ui";
import type { Listing, Request } from "@/lib/types";
import { CATEGORIES } from "@/lib/types";
import { checkEligibility } from "@/lib/vehicles";

const EXAMPLES = ["40 folding tables for the Eastside rec center, delivered before March", "a box of pencils for the front desk", "jury management software"];
/** Products shown on the shelf, when the buyer may use their contracts. */
const SHELF = ["lst_006", "lst_031", "lst_026", "lst_009", "lst_002", "lst_028"];
/** The worked example in the hero: one search, three contracts. */
const PREVIEW = ["lst_001", "lst_014", "lst_021"];

export default function BuyerHome() {
  const { db, act, role, setRole } = useStore();
  const router = useRouter();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [changing, setChanging] = useState(false);

  useEffect(() => {
    if (role !== "buyer") setRole("buyer");
  }, [role, setRole]);

  if (!db) return <Loading />;

  const buyer = db.session.buyer;
  const open = (l: Listing) => l.storefront_ids.includes("sf_riverbend") && checkEligibility(db.contracts.find((c) => c.id === l.contract_id), buyer).eligible;
  const available = db.listings.filter(open);
  const contracts = new Set(available.map((l) => l.contract_id).filter(Boolean));
  const byId = (id: string) => db.listings.find((l) => l.id === id);
  const supplierOf = (l: Listing) => db.suppliers.find((s) => s.id === l.supplier_id)?.name ?? "";
  const shelf = SHELF.map(byId).filter((l): l is Listing => !!l && open(l)).slice(0, 4);
  const preview = PREVIEW.map(byId).filter((l): l is Listing => !!l);
  const suppliers = new Set(available.map((l) => l.supplier_id)).size;
  const peerAgencies = new Set(db.peers.map((p) => p.agency_name)).size;
  const mosaic = CATEGORIES.filter((c) => c !== "Other").slice(0, 9);
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

  const renew = async () => {
    setBusy(true);
    try {
      const r = await act<Request>("startRenewal", { contractId: "ctr_cleanline_own" });
      router.push(`/solicitations/new?request=${r.id}`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  const custodial = db.contracts.find((c) => c.id === "ctr_cleanline_own");
  const daysLeft = custodial ? Math.ceil((new Date(custodial.end).getTime() - Date.now()) / 86_400_000) : 45;
  const renewalStarted = db.requests.some((r) => r.raw_text.includes("RB-2023-042") && r.outcome === "solicitation");

  return (
    <div className="space-y-14 pb-8">
      {/* Hero: ruled like a purchase-order ledger, with a margin line. */}
      <section
        className="relative overflow-hidden rounded-2xl border border-line bg-white"
        style={{ backgroundImage: "repeating-linear-gradient(to bottom, transparent 0 39px, #F2F4F8 39px 40px)" }}
      >
        <span className="absolute inset-y-0 left-8 hidden w-px bg-maroon/25 md:block" aria-hidden />
        <div className="relative grid gap-10 px-6 py-10 md:grid-cols-[1.2fr_0.8fr] md:px-14 md:py-14">
          <div>
            <p className="text-sm text-slate">
              {available.length.toLocaleString()} items on {contracts.size} contracts, ready to buy
            </p>
            <h1 className="mt-3 text-[2.5rem] font-semibold leading-[1.1] tracking-tight text-navy">What do you need?</h1>
            <p className="mt-3 max-w-md text-[17px] leading-relaxed text-slate">
              Describe it the way you'd tell a colleague. We'll check every contract you can buy from and the rules that apply.
            </p>
            <form
              className="mt-7 flex items-center gap-2 rounded-xl border border-line bg-white p-1.5 pl-4 shadow-[0_8px_24px_-12px_rgba(20,33,61,0.25)] focus-within:border-navy/40"
              onSubmit={(e) => {
                e.preventDefault();
                submit(text);
              }}
            >
              <Search className="h-5 w-5 shrink-0 text-steel" />
              <input
                autoFocus
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="e.g. 40 folding tables for the rec center"
                className="min-w-0 flex-1 !border-0 !px-1 !py-2.5 !text-base !shadow-none !outline-none !ring-0"
                aria-label="What do you need?"
              />
              <Button type="submit" variant="maroon" disabled={busy || !text.trim()} className="!rounded-lg !px-5">
                {busy ? "Looking" : "Ask"}
              </Button>
            </form>
            <div className="mt-3 flex flex-wrap gap-2">
              {EXAMPLES.map((ex) => (
                <button
                  key={ex}
                  onClick={() => {
                    setText(ex);
                    submit(ex);
                  }}
                  className="rounded-full border border-line bg-white px-3 py-1 text-sm text-navy hover:border-navy/30"
                >
                  {ex.length > 34 ? `${ex.slice(0, 31)}…` : ex}
                </button>
              ))}
            </div>
            {buyer && (
              <p className="mt-5 text-sm text-slate">
                Buying for <span className="text-navy">{buyer.name}</span>, {buyer.state}.{" "}
                <button onClick={() => setChanging(!changing)} className="text-maroon hover:underline">
                  {changing ? "Close" : "Change"}
                </button>
              </p>
            )}
            <div className="mt-3">
              <ErrorNote message={error} />
            </div>
            <dl className="mt-8 grid grid-cols-2 gap-4 border-t border-line pt-6 sm:grid-cols-4">
              {(
                [
                  [available.length.toLocaleString(), "items ready to buy", "#1D7A69"],
                  [contracts.size, "contracts", "#4A44B5"],
                  [suppliers, "suppliers", "#C0501A"],
                  [peerAgencies, "peer agencies sharing prices", "#B3243F"],
                ] as const
              ).map(([n, label, color]) => (
                <div key={label}>
                  <dd className="text-2xl font-semibold tabular-nums" style={{ color }}>
                    {n}
                  </dd>
                  <dt className="text-xs text-slate">{label}</dt>
                </div>
              ))}
            </dl>
          </div>

          <div className="relative self-center">
            <div className="pointer-events-none absolute -inset-x-8 -inset-y-10 hidden grid-cols-3 grid-rows-3 gap-3 md:grid" aria-hidden>
              {mosaic.map((c, i) => (
                <div key={c} className={`flex items-center justify-center rounded-2xl ${i % 2 ? "rotate-2" : "-rotate-2"}`} style={{ background: CATEGORY_TONE[c].bg }}>
                  <span className="opacity-60">
                    <CategoryIcon category={c} size="sm" />
                  </span>
                </div>
              ))}
            </div>
            <div className="relative">
              <HeroPreview
                rows={preview.map((l) => ({ listing: l, supplier: db.suppliers.find((x) => x.id === l.supplier_id)! }))}
                contractCount={contracts.size}
                onRun={() => submit(EXAMPLES[0])}
              />
            </div>
          </div>
        </div>
      </section>

      {changing && <BuyerPicker onDone={() => setChanging(false)} />}

      <section>
        <div className="flex items-end justify-between">
          <h2 className="text-lg font-semibold text-navy">Shop by category</h2>
          <Link href="/browse" className="text-sm text-slate hover:text-navy">
            See everything
          </Link>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {CATEGORIES.filter((c) => available.some((l) => l.category === c)).map((c) => {
            const n = available.filter((l) => l.category === c).length;
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
                    {n.toLocaleString()} items
                  </span>
                </span>
              </Link>
            );
          })}
        </div>
      </section>

      {shelf.length > 0 && (
        <section>
          <h2 className="text-lg font-semibold text-navy">On contract for {buyer?.name ?? "you"}</h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {shelf.map((l) => (
              <Link
                key={l.id}
                href={`/product/${l.id}`}
                className="group flex flex-col overflow-hidden rounded-2xl border border-line bg-white transition-shadow hover:shadow-[0_16px_32px_-20px_rgba(20,33,61,0.4)]"
              >
                <div className="h-32 transition-transform duration-300 group-hover:scale-[1.03]">
                  <CategoryIcon category={l.category} size="xl" />
                </div>
                <div className="flex flex-1 flex-col p-4">
                <div className="line-clamp-2 text-sm font-semibold text-navy">{l.title}</div>
                <div className="mt-1 text-xs text-slate">{supplierOf(l)}</div>
                <div className="mt-auto flex items-end justify-between pt-4">
                  <SourcePill source={l.source} />
                  <span className="text-base font-semibold tabular-nums text-navy">
                    {money(l.unit_price)}
                    <span className="text-xs font-normal text-slate"> / {l.unit}</span>
                  </span>
                </div>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      <div className="grid gap-6 md:grid-cols-2">
        <section className="min-w-0 rounded-xl border border-line bg-white p-6">
          <h2 className="text-lg font-semibold text-navy">Coming up</h2>
          <ul className="mt-2 divide-y divide-line">
            <li className="flex gap-3 py-3">
              <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg [&>svg]:h-4 [&>svg]:w-4" style={{ background: "#FBE4E8", color: "#B3243F" }}>
                <Calendar />
              </span>
              <div>
              <div className="text-sm font-semibold text-navy">Custodial contract expires in {daysLeft} days</div>
              <div className="mt-0.5 text-sm text-slate">CleanLine Janitorial Supply, RB-2023-042</div>
              {renewalStarted ? (
                <div className="mt-1 text-sm text-emerald-700">Renewal solicitation published</div>
              ) : (
                <button onClick={renew} disabled={busy} className="mt-1 text-sm font-semibold text-maroon hover:underline">
                  Start an early renewal
                </button>
              )}
              </div>
            </li>
            <li className="flex gap-3 py-3">
              <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg [&>svg]:h-4 [&>svg]:w-4" style={{ background: "#DDF3EE", color: "#1D7A69" }}>
                <Chair />
              </span>
              <div>
              <div className="text-sm font-semibold text-navy">Eastside rec center opens in March</div>
              <div className="mt-0.5 text-sm text-slate">The capital plan calls for tables, stacking chairs and storage carts.</div>
              <button onClick={() => submit(EXAMPLES[0])} className="mt-1 text-sm font-semibold text-maroon hover:underline">
                Find folding tables
              </button>
              </div>
            </li>
            <li className="flex gap-3 py-3">
              <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg [&>svg]:h-4 [&>svg]:w-4" style={{ background: "#E0F0FB", color: "#1E6FA8" }}>
                <Repeat />
              </span>
              <div>
              <div className="text-sm font-semibold text-navy">Trash liners are due for a reorder</div>
              <div className="mt-0.5 text-sm text-slate">You order about every 30 days; the last order was Oct 9.</div>
              <Link href="/checkout?listing=lst_009&qty=12" className="mt-1 inline-block text-sm font-semibold text-maroon hover:underline">
                Reorder 12 cases
              </Link>
              </div>
            </li>
          </ul>
        </section>

        <section className="min-w-0 rounded-xl border border-line bg-white p-6">
          <h2 className="text-lg font-semibold text-navy">Recently bought by Parks and Recreation</h2>
          <ul className="mt-2 divide-y divide-line">
            {db.recent.map((r) => {
              const l = byId(r.listing_id);
              return (
                <li key={r.listing_id} className="flex items-center gap-3 py-3">
                  {l && <CategoryIcon category={l.category} size="sm" />}
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm text-navy">{r.title}</div>
                    <div className="text-xs text-slate">
                      {r.qty} from {r.supplier}, {new Date(r.date).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                    </div>
                  </div>
                  <Link href={`/checkout?listing=${r.listing_id}&qty=${r.qty}`} className="shrink-0 rounded-md border border-line px-2.5 py-1 text-xs font-semibold text-navy hover:border-navy/30">
                    Reorder
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      </div>

      <section className="flex flex-wrap items-center gap-x-8 gap-y-3 border-t border-line pt-8">
        <span className="text-sm text-slate">Buy through</span>
        {vehicles.map((v) => (
          <Link key={v} href="/vehicles" className="text-sm font-semibold tracking-tight text-slate/80 hover:text-navy">
            {v}
          </Link>
        ))}
      </section>
    </div>
  );
}
