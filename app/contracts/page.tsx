"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { BuyerPicker } from "@/components/BuyerPicker";
import { AccessTag, contractHref, shortDate } from "@/components/ContractBits";
import { useStore } from "@/components/store";
import { Badge, Checkbox, ErrorNote, Loading, PageTitle } from "@/components/ui";
import type { ContractKind, ContractRow, ExploreResult } from "@/lib/contracts";

const KIND: Record<ContractKind, string> = { agency: "Your agency's", state: "State", coop: "Co-op", reseller: "Reseller", federal: "Federal (GSA)" };

export default function ContractsPage() {
  return (
    <Suspense fallback={<Loading />}>
      <Explorer />
    </Suspense>
  );
}

function Explorer() {
  const { db } = useStore();
  const router = useRouter();
  const params = useSearchParams();
  const [q, setQ] = useState(params.get("q") ?? "");
  const [typed, setTyped] = useState(q);
  const [kind, setKind] = useState<ContractKind | "">((params.get("kind") as ContractKind | null) ?? "");
  const [coop, setCoop] = useState(params.get("coop") ?? "");
  const [category, setCategory] = useState("");
  const [usable, setUsable] = useState(false);
  const [priced, setPriced] = useState(false);
  const [readable, setReadable] = useState(false);
  const [data, setData] = useState<ExploreResult | null>(null);
  const [rows, setRows] = useState<ContractRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [changing, setChanging] = useState(false);
  const [allPrograms, setAllPrograms] = useState(false);
  const buyer = db?.session.buyer ?? null;
  const buyerKey = buyer ? `${buyer.name}|${buyer.state}` : "";
  // Membership changes move contracts between "can use" and "join to use".
  const memberships = db?.memberships.length ?? 0;

  const query = (offset: number) => {
    const p = new URLSearchParams();
    if (q) p.set("q", q);
    if (kind) p.set("kind", kind);
    if (coop) p.set("coop", coop);
    if (category) p.set("category", category);
    if (usable) p.set("usable", "1");
    if (priced) p.set("priced", "1");
    if (readable) p.set("readable", "1");
    if (offset) p.set("offset", String(offset));
    return p.toString();
  };

  useEffect(() => {
    let live = true;
    setBusy(true);
    setError(null);
    fetch(`/api/catalog/contracts?${query(0)}`)
      .then((r) => r.json())
      .then((j: ExploreResult) => {
        if (!live) return;
        setData(j);
        setRows(j.rows);
      })
      .catch(() => live && setError("Couldn't load contracts. Try again."))
      .finally(() => live && setBusy(false));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, kind, coop, category, usable, priced, readable, buyerKey, memberships]);

  const more = async () => {
    setBusy(true);
    try {
      const j: ExploreResult = await fetch(`/api/catalog/contracts?${query(rows.length)}`).then((r) => r.json());
      setRows((have) => [...have, ...j.rows]);
    } catch {
      setError("Couldn't load more contracts. Try again.");
    }
    setBusy(false);
  };

  const submit = (text: string) => {
    const next = text.trim();
    setQ(next);
    setCoop("");
    setCategory("");
    router.replace(next ? `/contracts?q=${encodeURIComponent(next)}` : "/contracts", { scroll: false });
  };

  const programs = data ? (allPrograms ? data.programs : data.programs.slice(0, 8)) : [];
  const chip = (on: boolean) =>
    `inline-flex min-h-[36px] items-center rounded-md px-3 text-ui-2xs font-bold leading-none ${on ? "bg-primary text-white" : "bg-white text-base-darker shadow-[inset_0_0_0_1px_theme(colors.base.light)] hover:text-primary"}`;

  return (
    <div>
      <PageTitle title="Contracts">
        Most of what a government can buy through isn't an item with a price. It's a contract someone already competed: your own, your state's, a co-op's. Search{" "}
        {data ? data.universe.toLocaleString() : "every"} of them here by what they cover, who holds them or their number, and open any one for its terms, documents and how to buy under it.
        {buyer ? (
          <>
            {" "}
            Showing access for <span className="font-semibold text-ink">{buyer.name}</span>.{" "}
            <button onClick={() => setChanging(!changing)} className="font-semibold text-primary hover:underline">
              {changing ? "Cancel" : "Change"}
            </button>
          </>
        ) : (
          <>
            {" "}
            <button onClick={() => setChanging(!changing)} className="font-semibold text-primary hover:underline">
              {changing ? "Cancel" : "Set your agency"}
            </button>{" "}
            to see which ones you can use.
          </>
        )}
      </PageTitle>
      {changing && (
        <div className="mb-6">
          <BuyerPicker onDone={() => setChanging(false)} onClose={() => setChanging(false)} />
        </div>
      )}

      <form
        className="flex max-w-3xl gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          submit(typed);
        }}
      >
        <label htmlFor="contract-search" className="sr-only">
          Search contracts
        </label>
        <input id="contract-search" type="search" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="What it covers, a supplier, or a contract number: fire apparatus, Dell, 724-23" className="min-w-0 flex-1" />
        <button type="submit" className="inline-flex items-center rounded-md bg-primary px-5 text-ui-xs font-bold text-white hover:bg-primary-dark">
          Search
        </button>
      </form>

      <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2">
        <Checkbox checked={usable} onChange={setUsable} label={buyer ? "My agency can use it today" : "Open without a membership"} />
        <Checkbox checked={priced} onChange={setPriced} label="Has item prices" />
        <Checkbox checked={readable} onChange={setReadable} label="Has a document Agora can read" />
      </div>
      {data && data.kinds.length > 1 && (
        <div className="mt-4 flex flex-wrap gap-2" role="group" aria-label="Kind of contract">
          <button className={chip(!kind)} onClick={() => setKind("")}>
            All kinds
          </button>
          {data.kinds.map((k) => (
            <button key={k.id} className={chip(kind === k.id)} aria-pressed={kind === k.id} onClick={() => setKind(kind === k.id ? "" : k.id)}>
              {KIND[k.id]} <span className="ml-1.5 font-normal opacity-80">{k.count.toLocaleString()}</span>
            </button>
          ))}
        </div>
      )}

      <ErrorNote message={error} />
      {!data && !error && <Loading label="Loading contracts" />}

      {data && (
        <div className="mt-6 grid items-start gap-8 lg:grid-cols-[230px_minmax(0,1fr)]">
          <aside className="space-y-6 text-sm">
            <Facet title="Program" items={programs.map((p) => ({ id: p.id, label: p.name, count: p.count }))} value={coop} onChange={setCoop} />
            {data.programs.length > programs.length && (
              <button onClick={() => setAllPrograms(true)} className="-mt-4 text-ui-2xs font-semibold text-primary hover:underline">
                All {data.programs.length} programs
              </button>
            )}
            <Facet title="Category" items={data.categories.map((c) => ({ id: c.name, label: c.name, count: c.count }))} value={category} onChange={setCategory} />
          </aside>

          <section aria-live="polite" id="contract-results" className={busy ? "opacity-60" : ""}>
            <p className="text-ui-xs text-base-darker">
              <span className="font-bold text-ink">{data.total.toLocaleString()}</span> contract{data.total === 1 ? "" : "s"}
              {q ? ` matching “${q}”` : ""}
              {data.total > 0 && `. ${q ? "Closest scope first, then" : "Ordered by"} what ${buyer ? buyer.name : "an agency"} can use, your own and state contracts before co-ops.`}
            </p>
            {data.total === 0 && (
              <div className="mt-4 border border-dashed border-base-light bg-white px-5 py-8 text-sm text-base-darker">
                No contract matches that. Try the words a contract title would use ("copiers" rather than a model number), or clear a filter.
              </div>
            )}
            <ul className="mt-3 divide-y divide-base-lighter border-y border-base-lighter bg-white">
              {rows.map((r) => (
                <Row key={r.id} r={r} />
              ))}
            </ul>
            {rows.length < data.total && (
              <button onClick={more} disabled={busy} className="mt-4 w-full rounded-md border border-dashed border-base-light py-3 text-sm font-semibold text-ink hover:bg-white disabled:opacity-60">
                Show more ({(data.total - rows.length).toLocaleString()} left)
              </button>
            )}
            <p className="mt-6 max-w-[75ch] text-ui-3xs leading-relaxed text-base-dark">
              Co-op and federal contracts come from 13 programs' public directories, retrieved {shortDate(data.retrieved)}; their terms and eligibility aren't independently verified. Contracts with prices loaded in Agora
              are also listed on the{" "}
              <Link href="/vehicles" className="underline">
                loaded contracts
              </Link>{" "}
              page.{" "}
              <Link href="/data#catalog" className="underline">
                About the co-op catalog
              </Link>
            </p>
          </section>
        </div>
      )}
    </div>
  );
}

function Facet({ title, items, value, onChange }: { title: string; items: { id: string; label: string; count: number }[]; value: string; onChange: (v: string) => void }) {
  if (!items.length) return null;
  return (
    <div>
      <h2 className="mb-1.5 text-ui-2xs font-bold uppercase tracking-label text-base-dark">{title}</h2>
      <ul className="space-y-0.5">
        {items.map((i) => {
          const on = value === i.id;
          return (
            <li key={i.id}>
              <button
                aria-pressed={on}
                onClick={() => onChange(on ? "" : i.id)}
                className={`flex min-h-[32px] w-full items-center justify-between gap-2 rounded-md px-2.5 text-left text-ui-xs ${on ? "bg-primary-lighter font-bold text-primary-darker" : "text-ink hover:bg-white"}`}
              >
                <span className="truncate">{i.label}</span>
                <span className="shrink-0 tabular-nums text-base-dark">{i.count.toLocaleString()}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function Row({ r }: { r: ContractRow }) {
  const onFile = [
    r.in_agora ? `${r.priced.toLocaleString()} prices, buyable in Agora` : r.priced > 0 ? `${r.priced.toLocaleString()} item prices` : r.items > 0 ? `${r.items.toLocaleString()} items listed, no prices` : "No item prices",
    r.readable ? "document Agora can read" : r.documents > 0 ? "documents linked" : null,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <li>
      <Link href={contractHref(r.id)} className="group grid gap-x-4 gap-y-1 px-4 py-3.5 no-underline hover:bg-primary-lighter/30 sm:grid-cols-[minmax(0,1fr)_auto]">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-ui-2xs text-base-darker">
            <span className="font-bold text-ink">{r.program}</span>
            {r.trx && (
              <span title="A state contract on the TRX program, which Sovra supports. Listed first for that state's buyers.">
                <Badge tone="green">TRX</Badge>
              </span>
            )}
            <span className="font-mono">{r.number}</span>
            {r.category && <span>· {r.category}</span>}
          </div>
          <div className="mt-0.5 text-body-sm font-semibold leading-snug text-ink group-hover:underline">{r.title}</div>
          <div className="mt-0.5 text-ui-2xs text-base-darker">
            {r.supplier}
            {r.end ? ` · through ${shortDate(r.end)}` : " · end date not published"}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:flex-col sm:items-end sm:justify-center">
          <AccessTag access={r.access} />
          <span className="text-ui-3xs text-base-dark">{onFile}</span>
        </div>
      </Link>
    </li>
  );
}
