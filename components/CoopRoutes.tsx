"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { CatalogStorefront, CatalogSupplier } from "@/lib/catalog";
import { goHref } from "@/lib/coops";
import { useStore } from "./store";
import { Badge, Button, Card, ErrorNote, Loading, money } from "./ui";

const date = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

function useStorefront(query: string | null) {
  const { db } = useStore();
  const buyer = db?.session.buyer?.name ?? "";
  const [data, setData] = useState<CatalogStorefront | null | undefined>(undefined);
  useEffect(() => {
    if (!query) return;
    let live = true;
    setData(undefined);
    fetch(`/api/catalog/suppliers?${query}`)
      .then((r) => r.json())
      .then((j) => live && setData(j.storefront ?? null))
      .catch(() => live && setData(null));
    return () => {
      live = false;
    };
  }, [query, buyer]);
  return data;
}

/** Every co-op contract a supplier holds, from the co-ops' own directories. */
export function CoopRoutesSection({ data, name }: { data: CatalogStorefront; name: string }) {
  const { db } = useStore();
  const buyer = db?.session.buyer ?? null;
  const [all, setAll] = useState(false);
  const shown = all ? data.contracts : data.contracts.slice(0, 8);
  const coops = [...new Set(data.contracts.map((c) => c.coop_name))];
  if (!data.contracts.length) return null;
  return (
    <section id="coop-routes" className="scroll-mt-24">
      <h2 className="text-xl font-extrabold tracking-tight text-navy">On co-op contracts</h2>
      <p className="mt-1 max-w-3xl text-sm text-slate">
        {name} holds {data.contracts.length} current contract{data.contracts.length === 1 ? "" : "s"} across {coops.length} co-op{coops.length === 1 ? "" : "s"} ({coops.slice(0, 6).join(", ")}
        {coops.length > 6 ? ", and more" : ""}), from the co-ops' public directories retrieved {date(data.retrieved)}. Ordering happens on the co-op's site.
        {buyer ? ` Your agency's co-ops come first.` : ""}
      </p>
      <div className="mt-4 grid gap-3 md:grid-cols-2">
        {shown.map((c) => (
          <Card key={c.id} className="p-4">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-sm font-semibold text-navy">{c.coop_name}</span>
              <span className="font-mono text-[11px] text-slate">{c.number}</span>
              {buyer && c.member && <Badge tone="green">Your co-op</Badge>}
              {buyer && !c.member && c.coop_id !== "gsa_mas" && <Badge tone="maroon">Join to use</Badge>}
            </div>
            <Link href={`/contracts/${c.id}`} className="mt-1 block text-xs text-navy underline decoration-base-light underline-offset-2 hover:text-maroon">
              {c.title}
            </Link>
            <div className={`mt-1 text-[11px] ${c.eligible ? "text-slate" : "text-maroon"}`}>
              {c.eligible ? c.reason : `Not open to you: ${c.reason}`}
              {c.end ? ` · through ${date(c.end)}` : " · end date not published"}
            </div>
            <div className="mt-2">
              {c.url ? (
                <a href={goHref(c.id)} target="_blank" rel="noreferrer" className="text-xs font-semibold text-primary hover:underline">
                  Contract on {c.coop_name} ↗
                </a>
              ) : (
                c.directory && (
                  <a href={c.directory} target="_blank" rel="noreferrer" className="text-xs font-semibold text-primary hover:underline">
                    Find {c.number} on {c.coop_name} ↗
                  </a>
                )
              )}
            </div>
          </Card>
        ))}
      </div>
      {data.contracts.length > shown.length && (
        <button onClick={() => setAll(true)} className="mt-3 text-sm font-semibold text-maroon hover:underline">
          Show all {data.contracts.length}
        </button>
      )}
      {data.products.total > 0 && (
        <div className="mt-6">
          <h3 className="text-sm font-bold text-navy">
            {data.products.total.toLocaleString()} product{data.products.total === 1 ? "" : "s"} in the co-ops' catalogs
            {data.products.priced ? `, ${data.products.priced.toLocaleString()} with a published price` : ""}
          </h3>
          <ul className="mt-2 grid gap-x-6 gap-y-1 text-xs text-navy sm:grid-cols-2">
            {data.products.sample.map((p) => (
              <li key={p.product_id} className="flex justify-between gap-3 border-b border-base-lighter py-1">
                <span className="truncate">{p.name}</span>
                <span className="shrink-0 text-slate">{p.price != null ? money(p.price) : p.discount != null ? `${p.discount}% off list` : p.coop}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

/** The co-op routes behind one of Agora's own suppliers, when the catalog knows it. */
export function CoopRoutes({ supplierId, name }: { supplierId: string; name: string }) {
  const data = useStorefront(supplierId.startsWith("cat_") ? `id=${encodeURIComponent(supplierId)}` : `for=${encodeURIComponent(supplierId)}`);
  if (!data) return null;
  return <CoopRoutesSection data={data} name={name} />;
}

/** A storefront Agora built from a supplier's public co-op contracts, before anyone claimed it. */
export function CatalogStorefrontPage({ id }: { id: string }) {
  const { act, refresh } = useStore();
  const data = useStorefront(`id=${encodeURIComponent(id)}`);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (data === undefined) return <Loading />;
  if (!data) return <ErrorNote message="No storefront for that supplier." />;
  const s = data.supplier;
  return (
    <div className="space-y-10 pb-8">
      <div className="pt-6">
        <div className="text-[11px] font-extrabold uppercase text-maroon/80">Storefront</div>
        <h1 className="mt-2 text-[clamp(1.8rem,4vw,2.6rem)] font-extrabold leading-[1.1] text-navy">{s.name}</h1>
        <p className="mt-2 text-sm text-slate">
          {s.websites[0] ? (
            <a href={`https://${s.websites[0]}`} target="_blank" rel="noreferrer" className="text-primary">
              {s.websites[0]} ↗
            </a>
          ) : (
            "No website on file"
          )}
          {s.aliases.length > 0 && ` · also listed as ${s.aliases.slice(0, 3).join(", ")}`}
        </p>
        <Card className="mt-5 max-w-3xl p-5">
          <div className="text-sm font-semibold text-navy">Agora built this page from {s.name}'s public co-op contracts.</div>
          <p className="mt-1 text-sm text-slate">
            Nobody from {s.name} has claimed it yet, and Agora hasn't run its supplier checks. Claiming it adds the company's own description, catalog and certifications.
          </p>
          <Button
            className="mt-3"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                await act("adoptCatalogSupplier", { supplierId: s.id });
                await refresh();
              } catch (e) {
                setError((e as Error).message);
                setBusy(false);
              }
            }}
          >
            Claim this storefront
          </Button>
          <ErrorNote message={error} />
        </Card>
      </div>
      <CoopRoutesSection data={data} name={s.name} />
    </div>
  );
}

/** Search every supplier on a co-op contract, beyond the ones with a full storefront. */
export function CatalogSupplierSearch() {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<CatalogSupplier[]>([]);
  useEffect(() => {
    const query = q.trim();
    if (query.length < 2) {
      setResults([]);
      return;
    }
    const t = setTimeout(() => {
      fetch(`/api/catalog/suppliers?q=${encodeURIComponent(query)}`)
        .then((r) => r.json())
        .then((j) => setResults(j.results ?? []))
        .catch(() => setResults([]));
    }, 180);
    return () => clearTimeout(t);
  }, [q]);
  return (
    <section>
      <h2 className="text-xl font-extrabold tracking-tight text-navy">Every supplier on a co-op contract</h2>
      <p className="mt-1 max-w-2xl text-sm text-slate">
        22,000+ suppliers from 13 co-ops' public directories. Each has a storefront built from its contracts, ready for the company to claim.
      </p>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search suppliers, e.g. Grainger or Landscape Structures" className="mt-3 w-full max-w-xl" aria-label="Search suppliers" />
      {results.length > 0 && (
        <ul className="mt-3 max-w-3xl divide-y divide-base-lighter rounded-lg border-2 border-base-lighter bg-white">
          {results.map((s) => (
            <li key={s.id}>
              <Link href={`/storefronts/${s.id}`} className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-2.5 no-underline hover:bg-base-lightest">
                <span className="text-sm font-semibold text-navy">{s.name}</span>
                <span className="text-[11px] text-slate">
                  {s.contracts} contract{s.contracts === 1 ? "" : "s"} · {s.coops.slice(0, 4).join(", ")}
                  {s.coops.length > 4 ? ` +${s.coops.length - 4}` : ""}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
