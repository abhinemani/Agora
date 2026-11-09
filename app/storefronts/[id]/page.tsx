"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { CATEGORY_TONE, CategoryIcon } from "@/components/CategoryIcon";
import { Check, File, Globe, Lock, Search } from "@/components/icons";
import { useStore } from "@/components/store";
import { ErrorNote, Loading, SourcePill, Stars, SupplierBadges, money, supplierColor } from "@/components/ui";
import type { Contract, Listing } from "@/lib/types";
import { checkEligibility, defaultVariant, stateName } from "@/lib/vehicles";

const PAGE = 12;
const LINE_COLORS = ["#315BD0", "#167757", "#B45309", "#7C3AED", "#BE185D", "#0E7490", "#4D7C0F", "#9333EA", "#C2410C", "#1D4ED8", "#047857", "#A16207", "#6D28D9"];
const date = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

type Product = { l: Listing; tiers: number; from: number; line: string };

/** A supplier's storefront: its catalog, the contracts it sells through, and its reviews.
 * Suppliers with a profile (the featured tier) also get an about section, product
 * lines and featured products. */
export default function SupplierStorefront() {
  const { id } = useParams<{ id: string }>();
  const { db } = useStore();
  const [q, setQ] = useState("");
  const [line, setLine] = useState<string | null>(null);
  const [shown, setShown] = useState(PAGE);
  if (!db) return <Loading />;
  const s = db.suppliers.find((x) => x.id === id);
  if (!s) return <ErrorNote message="No storefront for that supplier." />;

  const buyer = db.session.buyer;
  const contracts = db.contracts.filter((c) => c.supplier_id === s.id);
  const reviews = db.reviews.filter((r) => r.supplier_id === s.id);
  const profile = s.profile;
  const color = supplierColor(s.id);

  // One card per product: tiers of the same product collapse to the tier that fits the buyer.
  const families = new Map<string, Listing[]>();
  for (const l of db.listings.filter((x) => x.supplier_id === s.id)) {
    const k = `${l.contract_id}|${l.family ?? l.id}`;
    families.set(k, [...(families.get(k) ?? []), l]);
  }
  const products: Product[] = [...families.values()].map((ls) => ({
    l: defaultVariant(ls, buyer),
    tiers: ls.length,
    from: Math.min(...ls.map((x) => x.unit_price)),
    line: ls[0].path?.split(" › ")[0] ?? ls[0].category,
  }));
  const lines = [...new Set(products.map((p) => p.line))];
  const lineColor = (n: string) => LINE_COLORS[lines.indexOf(n) % LINE_COLORS.length];
  const featured = (profile?.featured_families ?? []).map((f) => products.find((p) => p.l.family === f)).filter((p): p is Product => !!p);
  const needle = q.trim().toLowerCase();
  const filtered = products.filter((p) => (!line || p.line === line) && (!needle || `${p.l.title} ${p.l.detail ?? ""} ${p.l.keywords ?? ""}`.toLowerCase().includes(needle)));
  const nameOf = (p: Product) => (p.tiers > 1 ? p.l.title.replace(/\s*\([^)]*\)\s*$/, "") : p.l.title);
  const open = buyer ? contracts.filter((c) => checkEligibility(c, buyer).eligible).length : null;

  return (
    <div className="space-y-12 pb-8">
      <div>
        <Link href="/storefronts" className="text-sm text-slate hover:text-navy">
          ← Storefronts
        </Link>
        <div className="mt-4 overflow-hidden rounded-3xl border border-line bg-white">
          <div className="relative h-28 overflow-hidden" style={{ background: `linear-gradient(120deg, ${color}, ${color}aa)` }}>
            {profile && (
              <div className="absolute inset-y-0 right-0 hidden items-center gap-2 pr-8 opacity-90 sm:flex">
                {lines.slice(0, 6).map((n) => (
                  <span key={n} className="rounded-full bg-white/15 px-3 py-1 text-[11px] font-semibold text-white ring-1 ring-white/25">
                    {n}
                  </span>
                ))}
              </div>
            )}
          </div>
          <div className="flex flex-wrap items-end justify-between gap-6 px-6 pb-6 sm:px-8">
            <div className="relative z-10 -mt-9 min-w-0 max-w-2xl">
              <span className="grid h-[72px] w-[72px] place-items-center rounded-2xl border-4 border-white text-3xl font-extrabold text-white shadow-sm" style={{ background: color }}>
                {s.name[0]}
              </span>
              <div className="mt-3 flex items-center gap-2 text-[11px] font-extrabold uppercase tracking-[0.18em] text-maroon/80">
                Storefront
                {profile && <span className="rounded bg-[#e8f6ef] px-1.5 py-0.5 text-[10px] tracking-normal text-[#167854] normal-case">Featured</span>}
              </div>
              <h1 className="mt-1 text-[2.1rem] font-extrabold leading-tight tracking-[-0.03em] text-navy">{s.name}</h1>
              {profile && <p className="mt-1 text-[15px] text-slate">{profile.tagline}</p>}
              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-slate">
                {s.city && (
                  <span>
                    {s.city}, {s.state}
                  </span>
                )}
                {s.website && (
                  <a href={`https://${s.website}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-maroon hover:underline">
                    <Globe className="h-3.5 w-3.5" /> {s.website}
                  </a>
                )}
                <SupplierBadges supplier={s} />
                <Stars rating={s.rating} count={s.review_count} />
              </div>
            </div>
            <dl className="grid grid-cols-3 gap-6 text-center">
              {[
                [products.length.toLocaleString(), "products"],
                [contracts.length, contracts.length === 1 ? "contract" : "contracts"],
                open === null ? [lines.length, lines.length === 1 ? "product line" : "product lines"] : [open, `open to ${buyer!.name.replace(/^(City|Town|Township) of /, "")}`],
              ].map(([n, label]) => (
                <div key={String(label)}>
                  <dt className="text-2xl font-extrabold tracking-tight text-navy">{n}</dt>
                  <dd className="max-w-[7rem] text-xs text-slate">{label}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
        <p className="mt-2 text-xs text-slate">
          {profile?.disclaimer ?? "Basic storefront, built from the contracts on file. Suppliers on the Edge Position plan get a featured storefront with their own copy, product lines and insights."}
        </p>
      </div>

      {profile && (
        <section className="grid gap-8 lg:grid-cols-[1fr_1.4fr]">
          <div>
            <h2 className="text-xl font-extrabold tracking-tight text-navy">About</h2>
            <p className="mt-2 text-[15px] leading-relaxed text-slate">{profile.about}</p>
            <a href="#ways-to-buy" className="mt-4 inline-flex rounded-[10px] bg-maroon px-4 py-2.5 text-sm font-bold text-white hover:bg-maroon-600">
              See ways to buy
            </a>
          </div>
          <div>
            <h2 className="text-xl font-extrabold tracking-tight text-navy">Product lines</h2>
            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
              {lines.map((n) => {
                const ps = products.filter((p) => p.line === n);
                return (
                  <button
                    key={n}
                    onClick={() => {
                      setLine(n);
                      setShown(PAGE);
                      document.getElementById("catalog")?.scrollIntoView({ behavior: "smooth" });
                    }}
                    className="rounded-xl border border-line bg-white p-3 text-left transition hover:-translate-y-0.5 hover:border-[#bbcae8]"
                  >
                    <span className="block h-1.5 w-8 rounded-full" style={{ background: lineColor(n) }} />
                    <span className="mt-2 block text-sm font-semibold leading-snug text-navy">{n}</span>
                    <span className="block text-[11px] text-slate">
                      {ps.length} product{ps.length === 1 ? "" : "s"} · from {money(Math.min(...ps.map((p) => p.from)), false)}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </section>
      )}

      {featured.length > 0 && (
        <section>
          <h2 className="text-xl font-extrabold tracking-tight text-navy">Featured</h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {featured.map((p) => (
              <Link
                key={p.l.id}
                href={`/product/${p.l.id}`}
                className="group flex flex-col overflow-hidden rounded-2xl border border-line bg-white transition hover:shadow-[0_16px_32px_-20px_rgba(20,33,61,0.4)]"
              >
                <div className="flex h-24 items-center justify-between px-5" style={{ background: CATEGORY_TONE[p.l.category].bg }}>
                  <CategoryIcon category={p.l.category} size="md" />
                  <span className="rounded-full bg-white/80 px-2.5 py-1 text-[11px] font-semibold" style={{ color: lineColor(p.line) }}>
                    {p.line}
                  </span>
                </div>
                <div className="flex flex-1 flex-col p-5">
                  <div className="text-[16px] font-bold leading-snug text-navy group-hover:text-maroon">{nameOf(p)}</div>
                  {p.l.detail && <p className="mt-1 line-clamp-2 text-xs text-slate">{p.l.detail}</p>}
                  <div className="mt-auto flex items-end justify-between pt-4">
                    <SourcePill source={p.l.source} />
                    <span className="text-sm font-extrabold tabular-nums text-navy">
                      {p.tiers > 1 ? "from " : ""}
                      {money(p.from)}
                      <span className="text-[11px] font-medium text-slate"> / {p.l.unit}</span>
                    </span>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      <section id="ways-to-buy" className="scroll-mt-24">
        <h2 className="text-xl font-extrabold tracking-tight text-navy">Ways to buy from {s.name}</h2>
        <p className="mt-1 text-sm text-slate">
          {buyer ? `Checked for ${buyer.name}, ${stateName(buyer.state)}.` : "Set your agency to see which of these you can use."}
        </p>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {contracts.map((c) => (
            <ContractCard key={c.id} c={c} />
          ))}
          {!contracts.length && <p className="text-sm text-slate">No contracts on file; small purchases only.</p>}
        </div>
      </section>

      {products.length > 0 && (
        <section id="catalog" className="scroll-mt-24">
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
          {lines.length > 1 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {[null, ...lines].map((n) => (
                <button
                  key={n ?? "all"}
                  onClick={() => {
                    setLine(n);
                    setShown(PAGE);
                  }}
                  className={`rounded-full border px-3 py-1.5 text-xs ${line === n ? "border-maroon bg-maroon-50 text-maroon" : "border-line bg-white text-[#4c607e] hover:border-maroon"}`}
                >
                  {n ?? `All ${products.length}`}
                </button>
              ))}
            </div>
          )}
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {filtered.slice(0, shown).map((p) => (
              <Link key={p.l.id} href={`/product/${p.l.id}`} className="flex flex-col rounded-2xl border border-line bg-white p-4 transition hover:border-[#bbcae8]">
                <div className="flex items-start justify-between gap-3">
                  <CategoryIcon category={p.l.category} size="sm" />
                  <SourcePill source={p.l.source} />
                </div>
                <div className="mt-3 line-clamp-2 text-[15px] font-bold leading-snug text-navy">{nameOf(p)}</div>
                {p.l.detail && <p className="mt-1 line-clamp-2 text-xs text-slate">{p.l.detail}</p>}
                <div className="mt-auto flex items-end justify-between gap-2 pt-3">
                  <span className="truncate text-[11px]" style={{ color: lineColor(p.line) }}>
                    {p.line}
                    {p.tiers > 1 ? ` · ${p.tiers} tiers` : ""}
                  </span>
                  <span className="shrink-0 text-sm font-extrabold tabular-nums text-navy">
                    {p.tiers > 1 ? "from " : ""}
                    {money(p.from)}
                    <span className="text-[11px] font-medium text-slate"> / {p.l.unit}</span>
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
      )}

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

function ContractCard({ c }: { c: Contract }) {
  const { db } = useStore();
  const buyer = db!.session.buyer;
  const access = checkEligibility(c, buyer);
  const expired = !!c.end && c.end < new Date().toISOString().slice(0, 10);
  const states = c.eligibility && c.eligibility.states !== "any" ? c.eligibility.states : null;
  return (
    <div className={`flex flex-col rounded-2xl border bg-white p-4 ${expired ? "border-dashed border-line opacity-75" : "border-line"}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold text-navy">{c.vehicle ?? c.owner}</span>
        <span className="font-mono text-xs text-slate">{c.contract_number}</span>
        <SourcePill source={c.source} />
        {expired && <span className="rounded bg-[#fdecec] px-1.5 py-0.5 text-[10px] font-bold text-[#b42318]">Expired</span>}
      </div>
      <div className="mt-1 text-sm text-navy">{c.title}</div>
      <div className="mt-1 text-xs text-slate">
        {c.owner}
        {c.start || c.end ? ` · ${c.start ? `awarded ${date(c.start)}` : ""}${c.start && c.end ? ", " : ""}${c.end ? `${expired ? "expired" : "expires"} ${date(c.end)}` : ""}` : ""}
      </div>
      <div className="mt-2 text-xs text-slate">{c.eligibility ? `Open to ${c.eligibility.note}` : "Open to the agency that holds it"}</div>
      {states && states.length > 1 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {states.map((st) => (
            <span
              key={st}
              title={stateName(st)}
              className={`rounded px-1.5 py-0.5 font-mono text-[10px] font-semibold ${buyer?.state === st ? "bg-maroon text-white" : "bg-[#eef3fa] text-[#59708c]"}`}
            >
              {st}
            </span>
          ))}
        </div>
      )}
      {c.relation_note && <p className="mt-2 text-xs text-navy">{c.relation_note}</p>}
      {buyer && (
        <div className={`mt-2 inline-flex items-center gap-1 text-xs font-semibold ${access.eligible ? "text-emerald-800" : "text-maroon"}`}>
          {access.eligible ? <Check className="h-3.5 w-3.5" /> : <Lock className="h-3.5 w-3.5" />}
          {access.eligible ? `Open to ${buyer.name}` : `Not open to ${buyer.name}: ${access.reason.replace(/^Open to /, "open to ")}`}
        </div>
      )}
      {(c.documents?.length || c.source_url) && (
        <div className="mt-auto flex flex-wrap gap-x-3 gap-y-1 pt-3">
          {(c.documents ?? [{ label: "Source", url: c.source_url! }]).map((d) => (
            <a key={d.url} href={d.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs font-semibold text-maroon hover:underline">
              <File className="h-3.5 w-3.5" /> {d.label}
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
