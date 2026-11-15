"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { AccessTag, contractHref, shortDate } from "@/components/ContractBits";
import { Check, Globe, Lock, Search } from "@/components/icons";
import { ProgramKindTag, ProgramMark, programColor } from "@/components/ProgramBits";
import { useStore } from "@/components/store";
import { Card, Checkbox, ErrorNote, Loading, money } from "@/components/ui";
import type { AccessStatus } from "@/lib/contracts";
import type { ProgramContractRow, ProgramPage } from "@/lib/programs";

const longDate = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
const n = (x: number, one: string, many = `${one}s`) => `${x.toLocaleString()} ${x === 1 ? one : many}`;
const shortName = (name: string) => name.replace(/^(City|Town|Township|Village|Borough) of /, "");

/** A program's page, built like a storefront: what it covers, who holds its contracts, the prices on file, and how to buy through it. */
export default function ProgramPageView() {
  const { id } = useParams<{ id: string }>();
  const { db } = useStore();
  const router = useRouter();
  const buyer = db?.session.buyer ?? null;
  const buyerKey = buyer ? `${buyer.name}|${buyer.state}` : "";
  const memberships = db?.memberships.length ?? 0;
  const [p, setP] = useState<ProgramPage | null | undefined>(undefined);
  const [category, setCategory] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    fetch(`/api/catalog/programs?id=${encodeURIComponent(id)}`)
      .then((r) => r.json())
      .then((j) => {
        if (!live) return;
        setP(j.program ?? null);
        // Links by catalog id (/programs/state_nj) settle on the program's own address (/programs/njstart).
        if (j.program && j.program.slug !== id) router.replace(`/programs/${j.program.slug}`, { scroll: false });
      })
      .catch(() => live && setP(null));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, buyerKey, memberships]);

  if (p === undefined) return <Loading />;
  if (!p) return <ErrorNote message="Loci doesn't hold a program by that name." />;
  const color = programColor(p);
  const pick = (c: string | null) => {
    setCategory(c);
    document.getElementById("contracts")?.scrollIntoView({ behavior: "smooth" });
  };

  return (
    <div className="space-y-12 pb-8">
      <div>
        <Link href="/programs" className="text-sm text-slate hover:text-navy">
          ← Programs
        </Link>
        <div className="mt-4 overflow-hidden rounded-3xl border border-line bg-white">
          <div className="relative h-28 overflow-hidden" style={{ background: `linear-gradient(120deg, ${color}, ${color}aa)` }}>
            <div className="absolute inset-y-0 right-0 hidden items-center gap-2 pr-8 opacity-90 sm:flex">
              {p.categories.slice(0, 5).map((c) => (
                <span key={c.name} className="max-w-[14rem] truncate rounded-full bg-[#fff]/15 px-3 py-1 text-[11px] font-semibold text-[#fff] ring-1 ring-[#fff]/25">
                  {c.name}
                </span>
              ))}
            </div>
          </div>
          <div className="flex flex-wrap items-end justify-between gap-6 px-6 pb-6 sm:px-8">
            <div className="relative z-10 -mt-9 min-w-0 max-w-2xl">
              <ProgramMark p={p} size="lg" />
              <div className="mt-3 flex items-center gap-2 text-[11px] font-extrabold uppercase text-maroon/80">
                Program
                <span className="normal-case tracking-normal">
                  <ProgramKindTag p={p} />
                </span>
              </div>
              <h1 className="mt-1 text-[2.1rem] font-extrabold leading-tight text-navy">{p.name}</h1>
              <p className="mt-1 text-[15px] text-slate">{p.tagline}</p>
              {p.website && (
                <a href={p.website} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 text-sm text-maroon hover:underline">
                  <Globe className="h-3.5 w-3.5" /> {p.website.replace(/^https?:\/\/(www\.)?/, "").replace(/\/.*$/, "")}
                </a>
              )}
            </div>
            <dl className="grid grid-cols-3 gap-6 text-center">
              {[
                [p.contracts.toLocaleString(), p.contracts === 1 ? "contract" : "contracts"],
                [p.suppliers.toLocaleString(), p.suppliers === 1 ? "supplier" : "suppliers"],
                p.buyer ? [p.buyer.open.toLocaleString(), `open to ${shortName(p.buyer.name)}`] : [p.products.toLocaleString(), "priced products"],
              ].map(([v, label]) => (
                <div key={label}>
                  <dt className="text-2xl font-extrabold tracking-tight text-navy">{v}</dt>
                  <dd className="max-w-[7rem] text-xs text-slate">{label}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
        <p className="mt-2 text-xs text-slate">
          Built from {p.name}'s public list of contracts, retrieved {longDate(p.retrieved)}. Only current contracts are counted.
          {p.data_anchor && (
            <>
              {" "}
              <Link href={`/data#${p.data_anchor}`} className="font-semibold text-maroon hover:underline">
                How Loci reads it
              </Link>
              .
            </>
          )}
        </p>
      </div>

      <section className="grid gap-8 lg:grid-cols-[1fr_1.3fr]">
        <div>
          <h2 className="text-xl font-extrabold tracking-tight text-navy">How to buy through {p.name}</h2>
          <ol className="mt-3 space-y-3">
            {p.steps.map((s, i) => (
              <li key={i} className="flex gap-3 text-[15px] leading-relaxed text-slate">
                <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs font-extrabold text-[#fff]" style={{ background: color }}>
                  {i + 1}
                </span>
                <span>{s}</span>
              </li>
            ))}
          </ol>
          <BuyerStanding p={p} />
          {p.roster && (
            <p className="mt-3 text-xs text-slate">
              Loci places {n(p.roster.count, "government")} on {p.name}. {p.roster.note}
            </p>
          )}
        </div>
        <div>
          <h2 className="text-xl font-extrabold tracking-tight text-navy">What's on contract</h2>
          <p className="mt-1 text-sm text-slate">
            {p.group_by === "category" ? "By Loci's categories." : `By ${p.name}'s own headings, where several contracts share one.`} Choose one to see its contracts.
          </p>
          {p.categories.length ? (
            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
              {p.categories.slice(0, 12).map((c, i) => (
                <button key={c.name} onClick={() => pick(c.name)} className="rounded-xl border border-line bg-white p-3 text-left transition hover:-translate-y-0.5 hover:border-base-dark">
                  <span className="block h-1.5 w-8 rounded-full" style={{ background: color, opacity: 1 - Math.min(i, 8) * 0.08 }} />
                  <span className="mt-2 line-clamp-2 block text-sm font-semibold leading-snug text-navy">{c.name}</span>
                  <span className="block text-[11px] text-slate">{n(c.count, "contract")}</span>
                </button>
              ))}
            </div>
          ) : (
            <p className="mt-3 text-sm text-slate">Its contracts don't share headings Loci can group by. Search them below.</p>
          )}
        </div>
      </section>

      {p.products_sample.length > 0 && (
        <section>
          <h2 className="text-xl font-extrabold tracking-tight text-navy">Prices on file</h2>
          <p className="mt-1 text-sm text-slate">
            {n(p.products, "product")} on {n(p.priced_contracts, "contract")} carry a price. A sample across what it sells, each labelled with what its price is.
          </p>
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {p.products_sample.map((x) => (
              <Link key={x.product_id} href={contractHref(x.contract_id)} className="flex min-w-0 flex-col rounded-2xl border border-line bg-white p-4 no-underline transition hover:border-base-dark">
                <div className="line-clamp-2 break-words text-[15px] font-bold leading-snug text-navy">{x.name}</div>
                <div className="mt-1 truncate text-xs text-slate">
                  {x.maker ? `${x.maker} · ` : ""}
                  {x.supplier}
                </div>
                <div className="mt-auto pt-4">
                  {x.price != null ? (
                    <div className="text-lg font-extrabold tabular-nums text-navy">
                      {money(x.price)}
                      {x.unit && <span className="text-[11px] font-medium text-slate"> / {x.unit}</span>}
                    </div>
                  ) : (
                    <div className="text-sm font-bold tabular-nums text-navy">List {money(x.list!)}</div>
                  )}
                  <div className="mt-0.5 flex items-baseline justify-between gap-2 text-[11px] text-slate">
                    <span>{x.note}</span>
                    <span className="shrink-0 font-mono">{x.contract_number}</span>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      <section>
        <h2 className="text-xl font-extrabold tracking-tight text-navy">Who holds its contracts</h2>
        <p className="mt-1 text-sm text-slate">The suppliers with the most current {p.name} contracts. Each has a storefront.</p>
        <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {p.top_suppliers.map((s) => (
            <Link key={s.id} href={`/storefronts/${s.id}`} className="flex min-w-0 items-center gap-3 rounded-xl border border-line bg-white px-3 py-2.5 no-underline transition hover:border-base-dark">
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-base-lighter text-sm font-extrabold text-navy">{s.name[0]}</span>
              <span className="min-w-0">
                <span className="block truncate text-sm font-semibold text-navy">{s.name}</span>
                <span className="block text-[11px] text-slate">
                  {n(s.contracts, "contract")}
                  {s.products ? ` · ${n(s.products, "product")}` : ""}
                </span>
              </span>
            </Link>
          ))}
        </div>
      </section>

      <Contracts p={p} category={category} setCategory={setCategory} buyerKey={buyerKey} memberships={memberships} />
    </div>
  );
}

function BuyerStanding({ p }: { p: ProgramPage }) {
  if (!p.buyer) return <p className="mt-4 text-sm text-slate">Set your agency to see whether it can use {p.name}'s contracts.</p>;
  const good = p.buyer.status === "member" || p.buyer.status === "open";
  const tone = good ? "border-success-light bg-success-lighter/50 text-success-darker" : p.buyer.status === "join" ? "border-primary-light bg-primary-lighter/40 text-primary-darker" : "border-base-lighter bg-base-lightest text-base-darker";
  return (
    <div className={`mt-4 flex gap-2 rounded-xl border px-4 py-3 text-sm ${tone}`}>
      {good ? <Check className="mt-0.5 h-4 w-4 shrink-0" /> : <Lock className="mt-0.5 h-4 w-4 shrink-0" />}
      <span>{p.buyer.text}</span>
    </div>
  );
}

const accessOf = (r: ProgramContractRow, hasBuyer: boolean): AccessStatus => (!hasBuyer ? "unknown" : !r.eligible ? "closed" : r.member ? "open" : "join");

function Contracts({ p, category, setCategory, buyerKey, memberships }: { p: ProgramPage; category: string | null; setCategory: (c: string | null) => void; buyerKey: string; memberships: number }) {
  const [typed, setTyped] = useState("");
  const [q, setQ] = useState("");
  const [usable, setUsable] = useState(false);
  const [rows, setRows] = useState<ProgramContractRow[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setQ(typed.trim()), 220);
    return () => clearTimeout(t);
  }, [typed]);

  const query = (offset: number) => {
    const s = new URLSearchParams({ id: p.slug, contracts: "1" });
    if (q) s.set("q", q);
    if (category) s.set("category", category);
    if (usable) s.set("usable", "1");
    if (offset) s.set("offset", String(offset));
    return `/api/catalog/programs?${s}`;
  };
  const load = (offset: number) => {
    setBusy(true);
    return fetch(query(offset))
      .then((r) => r.json())
      .then((j) => {
        setTotal(j.total ?? 0);
        setRows((prev) => (offset ? [...prev, ...(j.rows ?? [])] : (j.rows ?? [])));
      })
      .catch(() => setTotal(0))
      .finally(() => setBusy(false));
  };
  useEffect(() => {
    load(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.slug, q, category, usable, buyerKey, memberships]);

  const explorer = new URLSearchParams({ coop: p.explorer_id });
  if (q) explorer.set("q", q);
  return (
    <section id="contracts" className="scroll-mt-24">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-extrabold tracking-tight text-navy">Contracts</h2>
          <p className="mt-1 text-sm text-slate">
            {total === null ? "Loading…" : `${n(total, "contract")}${category ? ` under ${category}` : ""}${q ? ` matching “${q}”` : ""}${p.buyer ? `, those open to ${shortName(p.buyer.name)} first` : ""}.`}
          </p>
        </div>
        <label className="flex w-full max-w-xs items-center gap-2 rounded-xl border border-line bg-white px-3 focus-within:border-maroon/50">
          <Search className="h-4 w-4 shrink-0 text-steel" />
          <input
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder={`Search ${p.name}`}
            aria-label={`Search ${p.name}'s contracts`}
            className="min-w-0 flex-1 !border-0 !px-0 !py-2 text-sm !shadow-none !outline-none !ring-0"
          />
        </label>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {p.categories.length > 1 &&
          [null, ...p.categories.slice(0, 12).map((c) => c.name)].map((c) => (
            <button
              key={c ?? "all"}
              onClick={() => setCategory(c)}
              className={`max-w-[16rem] truncate rounded-full border px-3 py-1.5 text-xs ${category === c ? "border-maroon bg-maroon-50 text-maroon" : "border-line bg-white text-base-dark hover:border-maroon"}`}
            >
              {c ?? "All"}
            </button>
          ))}
        {category && !p.categories.slice(0, 12).some((c) => c.name === category) && (
          <button onClick={() => setCategory(null)} className="rounded-full border border-maroon bg-maroon-50 px-3 py-1.5 text-xs text-maroon">
            {category} ✕
          </button>
        )}
        {p.buyer && (
          <span className="ml-auto">
            <Checkbox checked={usable} onChange={setUsable} label={`Only ones ${shortName(p.buyer.name)} can use`} />
          </span>
        )}
      </div>
      <Card className="mt-4 divide-y divide-base-lighter">
        {rows.map((r) => (
          <Link key={r.id} href={contractHref(r.id)} className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1 px-4 py-3 no-underline hover:bg-base-lightest">
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold text-navy">{r.title}</span>
              <span className="mt-0.5 block text-xs text-slate">
                {r.supplier} · <span className="font-mono">{r.number}</span>
                {r.end ? ` · through ${shortDate(r.end)}` : ""}
                {r.priced ? ` · ${n(r.priced, "price")}` : ""}
              </span>
            </span>
            <span title={r.reason}>
              <AccessTag access={accessOf(r, !!p.buyer)} />
            </span>
          </Link>
        ))}
        {total === 0 && <p className="px-4 py-6 text-sm text-slate">No {p.name} contract matches that.</p>}
      </Card>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        {total !== null && rows.length < total ? (
          <button onClick={() => load(rows.length)} disabled={busy} className="rounded-xl border border-dashed border-navy/20 px-4 py-2.5 text-sm font-semibold text-navy hover:bg-white disabled:opacity-60">
            {busy ? "Loading…" : `Show more (${(total - rows.length).toLocaleString()} left)`}
          </button>
        ) : (
          <span />
        )}
        <Link href={`/contracts?${explorer}`} className="text-sm font-semibold text-maroon hover:underline">
          Open {p.name} in the contract explorer →
        </Link>
      </div>
    </section>
  );
}
