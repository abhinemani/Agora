"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { BuyerPicker } from "@/components/BuyerPicker";
import { AccessTag, contractHref, shortDate } from "@/components/ContractBits";
import { letBy, Nest, NodeTag, splitTitle, Twig } from "@/components/contracts/Nest";
import { useStore } from "@/components/store";
import { Badge, Checkbox, ErrorNote, Loading, PageTitle } from "@/components/ui";
import type { AwardGroup, ContractKind, ContractRow, ExploreEntry, ExploreResult } from "@/lib/contracts";

const isGroup = (e: ExploreEntry): e is AwardGroup => "group" in e;
const awardHref = (key: string) => `/contracts?award=${encodeURIComponent(key)}`;

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
  const [category, setCategory] = useState(params.get("category") ?? "");
  const [usable, setUsable] = useState(false);
  const [priced, setPriced] = useState(false);
  const [readable, setReadable] = useState(false);
  const [data, setData] = useState<ExploreResult | null>(null);
  const [rows, setRows] = useState<ExploreEntry[]>([]);
  // The explorer opened on one award: its supplier contracts, one by one.
  const award = params.get("award") ?? "";
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
    if (award) p.set("award", award);
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
        setRows(j.entries);
      })
      .catch(() => live && setError("Couldn't load contracts. Try again."))
      .finally(() => live && setBusy(false));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, kind, coop, category, usable, priced, readable, buyerKey, memberships, award]);

  const more = async () => {
    setBusy(true);
    try {
      const j: ExploreResult = await fetch(`/api/catalog/contracts?${query(rows.length)}`).then((r) => r.json());
      setRows((have) => [...have, ...j.entries]);
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
      {award && data?.award && <AwardHeader a={data.award} shown={data.contracts} />}
      {!award && (
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
      )}
      {changing && (
        <div className="mb-6">
          <BuyerPicker onDone={() => setChanging(false)} onClose={() => setChanging(false)} />
        </div>
      )}

      {!award && (
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
        <input id="contract-search" type="search" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="What it covers, a supplier, a contract number or a NIGP code: fire apparatus, Dell, 724-23, 765" className="min-w-0 flex-1" />
        <button type="submit" className="inline-flex items-center rounded-md bg-primary px-5 text-ui-xs font-bold text-white hover:bg-primary-dark">
          Search
        </button>
      </form>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2">
        <Checkbox checked={usable} onChange={setUsable} label={buyer ? "My agency can use it today" : "Open without a membership"} />
        <Checkbox checked={priced} onChange={setPriced} label="Has item prices" />
        <Checkbox checked={readable} onChange={setReadable} label="Has a document Loci can read" />
      </div>
      {data && !award && data.kinds.length > 1 && (
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
        <div className={`mt-6 grid grid-cols-[minmax(0,1fr)] items-start gap-8 ${award ? "" : "lg:grid-cols-[230px_minmax(0,1fr)]"}`}>
          {!award && (
          <aside className="space-y-6 text-sm">
            <Facet title="Program" items={programs.map((p) => ({ id: p.id, label: p.name, count: p.count }))} value={coop} onChange={setCoop} />
            {data.programs.length > programs.length && (
              <button onClick={() => setAllPrograms(true)} className="-mt-4 text-ui-2xs font-semibold text-primary hover:underline">
                All {data.programs.length} programs
              </button>
            )}
            <Facet title="Category" items={data.categories.map((c) => ({ id: c.name, label: c.name, count: c.count }))} value={category} onChange={setCategory} />
          </aside>
          )}

          <section aria-live="polite" id="contract-results" className={busy ? "opacity-60" : ""}>
            <p className="text-ui-xs text-base-darker">
              <span className="font-bold text-ink">{data.contracts.toLocaleString()}</span> contract{data.contracts === 1 ? "" : "s"}
              {q ? ` matching “${q}”` : ""}
              {!data.award && data.total < data.contracts && (
                <>
                  , in <span className="font-bold text-ink">{data.total.toLocaleString()}</span> entries: contracts let under one award are listed together, each supplier nested under it
                </>
              )}
              {data.total > 0 && !data.award && `. ${q ? "Closest scope first, then" : "Ordered by"} what ${buyer ? buyer.name : "an agency"} can use, your own and state contracts before co-ops.`}
              {data.award && ". Each holds the same award; open one for its prices, documents and how to buy under it."}
            </p>
            {data.total === 0 && (
              <div className="mt-4 border border-dashed border-base-light bg-white px-5 py-8 text-sm text-base-darker">
                No contract matches that. Try the words a contract title would use ("copiers" rather than a model number), or clear a filter.
              </div>
            )}
            <ul className="mt-3 divide-y divide-base-lighter border-y border-base-lighter bg-white">
              {rows.map((r) => (isGroup(r) ? <Group key={r.key} g={r} /> : <Row key={r.id} r={r} inAward={Boolean(data.award)} />))}
            </ul>
            {rows.length < data.total && (
              <button onClick={more} disabled={busy} className="mt-4 w-full rounded-md border border-dashed border-base-light py-3 text-sm font-semibold text-ink hover:bg-white disabled:opacity-60">
                Show more ({(data.total - rows.length).toLocaleString()} {data.award ? "contracts" : "entries"} left)
              </button>
            )}
            <p className="mt-6 max-w-[75ch] text-ui-3xs leading-relaxed text-base-dark">
              Co-op and federal contracts come from 13 programs' public directories, retrieved {shortDate(data.retrieved)}; their terms and eligibility aren't independently verified. Contracts with prices loaded in Loci
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

function onFileLine(r: Pick<ContractRow, "in_agora" | "priced" | "items" | "readable" | "documents">) {
  return [
    r.in_agora ? `${r.priced.toLocaleString()} prices, buyable in Loci` : r.priced > 0 ? `${r.priced.toLocaleString()} item prices` : r.items > 0 ? `${r.items.toLocaleString()} items listed, no prices` : "No item prices",
    r.readable ? "document Loci can read" : r.documents > 0 ? "documents linked" : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** A long title, cut to what names it; the full title is on hover and on the contract's page. */
function Title({ text, className = "" }: { text: string; className?: string }) {
  const t = splitTitle(text);
  return (
    <div className={`line-clamp-2 ${className}`} title={text}>
      {t.head}
      {t.rest.length > 0 && <span className="font-normal text-base-darker"> · and {t.rest.length} more areas</span>}
    </div>
  );
}

const awardTag = (label: string) => (label.startsWith("Contracts ") ? "Award" : label.split(" ")[0]);
const awardName = (label: string) => label.replace(/^(Award|Solicitation|Contract) /, "");

/** The explorer opened on an award: the program, the award, then its supplier contracts below. */
function AwardHeader({ a, shown }: { a: NonNullable<ExploreResult["award"]>; shown: number }) {
  return (
    <div className="mb-2">
      <Link href="/contracts" className="text-sm text-base-darker hover:text-ink">
        ← All contracts
      </Link>
      <div className="mt-3 rounded-md border border-base-lighter bg-white px-4 py-3">
        <Nest root label="Where this award sits">
          <Twig>
            <div className="flex min-h-[2rem] items-center gap-2.5">
              <NodeTag>Program</NodeTag>
              <span className="font-semibold text-ink">{a.program}</span>
            </div>
            <Nest>
              <Twig path>
                <div className="flex min-h-[2rem] flex-wrap items-center gap-x-2.5">
                  <NodeTag here>{awardTag(a.label)}</NodeTag>
                  <span className="font-mono text-ui-xs font-semibold text-ink">{awardName(a.label)}</span>
                </div>
                <h1 className="max-w-[60ch] font-heading text-heading-lg font-bold leading-snug text-ink">{splitTitle(a.title).head}</h1>
                <p className="mt-1 max-w-[75ch] text-ui-2xs text-base-darker">
                  {a.size.toLocaleString()} supplier contract{a.size === 1 ? "" : "s"} on this award{a.lead ? `, ${letBy(a.lead)}` : ""}
                  {shown < a.size ? `; ${shown.toLocaleString()} match the filters` : ""}. They share the award&apos;s terms; each supplier&apos;s contract has its own number, prices and documents.
                </p>
                <Nest className="mt-1">
                  <Twig>
                    <div className="flex min-h-[2rem] items-center gap-2.5">
                      <NodeTag>Supplier contracts</NodeTag>
                      <span className="text-ui-2xs text-base-darker">listed below</span>
                    </div>
                  </Twig>
                </Nest>
              </Twig>
            </Nest>
          </Twig>
        </Nest>
      </div>
    </div>
  );
}

/** An award with its matching supplier contracts nested under it. */
function Group({ g }: { g: AwardGroup }) {
  const [open, setOpen] = useState(false);
  const rows = open ? g.rows : g.rows.slice(0, 3);
  return (
    <li className="px-4 py-3.5">
      <div className="grid gap-x-4 gap-y-1 sm:grid-cols-[minmax(0,1fr)_auto]">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-ui-2xs text-base-darker">
            <span className="font-bold text-ink">{g.program}</span>
            {g.trx && (
              <span title="A state contract on the TRX program, which Sovra supports. Listed first for that state's buyers.">
                <Badge tone="green">TRX</Badge>
              </span>
            )}
            <span className="font-mono">{g.label}</span>
            {g.lead && <span>· {letBy(g.lead)}</span>}
          </div>
          <Link href={awardHref(g.key)} className="group no-underline">
            <Title text={g.title} className="mt-0.5 text-body-sm font-semibold leading-snug text-ink group-hover:underline" />
          </Link>
          <div className="mt-0.5 text-ui-2xs text-base-darker">
            {g.size.toLocaleString()} supplier contracts on this award
            {g.matched < g.size ? `, ${g.matched.toLocaleString()} matching` : ""}
            {g.end ? ` · the latest runs through ${shortDate(g.end)}` : ""}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:flex-col sm:items-end sm:justify-center">
          <AccessTag access={g.access} />
          <span className="text-ui-3xs text-base-dark">{[g.priced ? `${g.priced.toLocaleString()} item prices` : "No item prices", g.readable ? "documents Loci can read" : null].filter(Boolean).join(" · ")}</span>
        </div>
      </div>
      <Nest className="mt-1.5" label={`Supplier contracts on ${g.label}`}>
        {rows.map((r) => (
          <Twig key={r.id}>
            <Link href={contractHref(r.id)} className="group flex min-h-[2rem] flex-wrap items-center gap-x-3 gap-y-0.5 rounded-sm py-1 pr-2 no-underline hover:bg-primary-lighter/30">
              <span className="font-semibold text-ink group-hover:underline">{r.supplier || "Unnamed supplier"}</span>
              <span className="font-mono text-ui-2xs text-base-darker">{r.number}</span>
              {r.title !== g.title && <span className="min-w-0 truncate text-ui-2xs text-base-darker">{splitTitle(r.title).head}</span>}
              <span className="ml-auto flex items-center gap-2">
                <span className="hidden text-ui-3xs text-base-dark md:inline">{onFileLine(r)}</span>
                <AccessTag access={r.access} />
              </span>
            </Link>
          </Twig>
        ))}
        <Twig>
          <div className="flex min-h-[2rem] flex-wrap items-center gap-x-4 text-ui-2xs">
            {g.rows.length > rows.length && (
              <button onClick={() => setOpen(true)} className="font-semibold text-primary hover:underline">
                {g.rows.length - rows.length} more here
              </button>
            )}
            <Link href={awardHref(g.key)} className="font-semibold text-primary hover:underline">
              {g.matched < g.size ? `All ${g.size.toLocaleString()} on this award →` : `See all ${g.size.toLocaleString()} →`}
            </Link>
          </div>
        </Twig>
      </Nest>
    </li>
  );
}

function Row({ r, inAward }: { r: ContractRow; inAward?: boolean }) {
  return (
    <li>
      <Link href={contractHref(r.id)} className="group grid gap-x-4 gap-y-1 px-4 py-3.5 no-underline hover:bg-primary-lighter/30 sm:grid-cols-[minmax(0,1fr)_auto]">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-ui-2xs text-base-darker">
            <span className="font-bold text-ink">{inAward ? r.supplier || "Unnamed supplier" : r.program}</span>
            {r.trx && !inAward && (
              <span title="A state contract on the TRX program, which Sovra supports. Listed first for that state's buyers.">
                <Badge tone="green">TRX</Badge>
              </span>
            )}
            <span className="font-mono">{r.number}</span>
            {r.category && <span>· {r.category}</span>}
            {r.nigp.length > 0 && (
              <span className="font-mono" title={r.nigp_source === "published" ? "NIGP classes printed on the contract" : "NIGP classes from Loci's AI review"}>
                · NIGP {r.nigp.slice(0, 3).join(", ")}
                {r.nigp_source === "reviewed" ? "*" : ""}
              </span>
            )}
          </div>
          {!inAward && <Title text={r.title} className="mt-0.5 text-body-sm font-semibold leading-snug text-ink group-hover:underline" />}
          <div className="mt-0.5 text-ui-2xs text-base-darker">
            {inAward ? (r.end ? `Through ${shortDate(r.end)}` : "End date not published") : `${r.supplier}${r.end ? ` · through ${shortDate(r.end)}` : " · end date not published"}`}
          </div>
          {r.found_in && (
            <div className="mt-1 text-ui-2xs text-base-darker">
              In {r.found_in.label}
              {r.found_in.page > 1 ? `, page ${r.found_in.page}` : ""}: <span className="italic">&ldquo;{r.found_in.snippet}&rdquo;</span>
            </div>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:flex-col sm:items-end sm:justify-center">
          <AccessTag access={r.access} />
          <span className="text-ui-3xs text-base-dark">{onFileLine(r)}</span>
        </div>
      </Link>
      {!inAward && r.award && r.award.size > 1 && (
        <div className="-mt-2 px-4 pb-3 text-ui-2xs text-base-darker">
          One of {r.award.size.toLocaleString()} supplier contracts on {r.award.label}.{" "}
          <Link href={awardHref(r.award.key)} className="font-semibold text-primary hover:underline">
            See the award →
          </Link>
        </div>
      )}
    </li>
  );
}
