"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { post, useStore } from "@/components/store";
import { Badge, Button, Card, ErrorNote, IconCircle, Loading, PageTitle, SourcePill, money } from "@/components/ui";
import { SAMPLE_CONTRACTS } from "@/lib/samples";
import { CATEGORIES } from "@/lib/types";
import type { ContractDocument, ContractHeader, ContractSource, ExtractedItem, Role, Supplier } from "@/lib/types";

interface ParseResult {
  documents: ContractDocument[];
  files: { filename: string; kind: string; page_count: number; pages: { num: number; text: string }[] }[];
  header: ContractHeader;
  items: ExtractedItem[];
  mode: "llm" | "offline";
  supplier: Supplier | null;
  duration_ms: number;
}

interface PublishResult {
  listed: number;
  replaced: number;
  attention: number;
  storefronts: string[];
  contract: { id: string; contract_number: string };
}

const STEPS = ["Reading files", "Extracting text and tables", "Finding contract terms", "Structuring priced line items", "Checking against the storefront"];

export default function UploadPage() {
  return (
    <Suspense fallback={<Loading />}>
      <Upload />
    </Suspense>
  );
}

function Upload() {
  const as = (useSearchParams().get("as") as Role) ?? "supplier";
  const { db, refresh, role, setRole } = useStore();
  const [phase, setPhase] = useState<"pick" | "parsing" | "review" | "done">("pick");
  const [tick, setTick] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ParseResult | null>(null);
  const [header, setHeader] = useState<ContractHeader | null>(null);
  const [items, setItems] = useState<ExtractedItem[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [storefronts, setStorefronts] = useState<string[]>(["sf_riverbend"]);
  const [published, setPublished] = useState<PublishResult | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    if (as === "procurement" || as === "supplier") if (role !== as) setRole(as);
  }, [as, role, setRole]);

  useEffect(() => {
    if (phase !== "parsing") return;
    const t = setInterval(() => setTick((n) => Math.min(n + 1, STEPS.length - 1)), 650);
    return () => clearInterval(t);
  }, [phase]);

  const start = async (body: { sample: string } | FileList) => {
    setPhase("parsing");
    setTick(0);
    setError(null);
    try {
      let res: ParseResult;
      if (body instanceof FileList) {
        const form = new FormData();
        for (const f of Array.from(body)) form.append("files", f);
        form.append("role", as);
        const r = await fetch("/api/contracts/parse", { method: "POST", body: form });
        const json = await r.json();
        if (!r.ok) throw new Error(json.error);
        res = json.result;
      } else {
        res = await post<ParseResult>("/api/contracts/parse", { ...body, role: as });
      }
      setTick(STEPS.length);
      await new Promise((r) => setTimeout(r, 350));
      setResult(res);
      setHeader(res.header);
      setItems(res.items);
      setSelected(sortItems(res.items)[0]?.id ?? null);
      setPhase("review");
      refresh();
    } catch (e) {
      setError((e as Error).message);
      setPhase("pick");
    }
  };

  if (!db) return <Loading />;

  if (phase === "pick")
    return (
      <div className="mx-auto max-w-4xl">
        <PageTitle eyebrow={as === "supplier" ? "Riverside Office Supply · Contracts" : "Purchasing · Add a contract"} title="Upload a contract">
          Drop in a contract and its price list. We'll pull out the supplier, terms, piggyback clause and every priced item, then you check the handful of rows we're unsure about and publish.
        </PageTitle>
        <ErrorNote message={error} />
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            if (e.dataTransfer.files.length) start(e.dataTransfer.files);
          }}
          className={`mt-4 rounded-lg border-2 border-dashed p-10 text-center ${dragging ? "border-maroon bg-maroon-50" : "border-steel bg-white"}`}
        >
          <div className="text-lg font-semibold text-navy">Drop contract files here</div>
          <div className="mt-1 text-sm text-slate">PDF, DOCX, XLSX or CSV. Add a price-list spreadsheet alongside its contract.</div>
          <Button variant="secondary" className="mt-4" onClick={() => fileRef.current?.click()}>
            Choose files
          </Button>
          <input
            ref={fileRef}
            type="file"
            multiple
            accept=".pdf,.docx,.xlsx,.xls,.csv"
            className="hidden"
            onChange={(e) => e.target.files?.length && start(e.target.files)}
          />
        </div>
        <h2 className="mb-3 mt-8 text-sm font-semibold uppercase tracking-wider text-slate">Or use a sample contract</h2>
        <div className="grid gap-4 md:grid-cols-3">
          {SAMPLE_CONTRACTS.map((s) => (
            <button key={s.id} onClick={() => start({ sample: s.id })} className="text-left">
              <Card className="h-full p-5 transition hover:border-navy/40 hover:shadow-md">
                <div className="font-semibold text-navy">{s.label}</div>
                <div className="mt-0.5 text-xs text-maroon">{s.owner}</div>
                <p className="mt-2 text-sm text-slate">{s.blurb}</p>
                <div className="mt-3 space-y-1">
                  {s.files.map((f) => (
                    <div key={f} className="truncate font-mono text-[11px] text-slate">
                      {f}
                    </div>
                  ))}
                </div>
              </Card>
            </button>
          ))}
        </div>
      </div>
    );

  if (phase === "parsing")
    return (
      <div className="mx-auto max-w-md pt-10">
        <Card className="p-6">
          <div className="font-semibold text-navy">Reading your contract</div>
          <ul className="mt-4 space-y-3">
            {STEPS.map((s, i) => (
              <li key={s} className="flex items-center gap-3 text-sm">
                <span className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] ${i < tick ? "bg-navy text-white" : i === tick ? "animate-pulse bg-maroon text-white" : "bg-tint text-steel"}`}>
                  {i < tick ? "✓" : i + 1}
                </span>
                <span className={i <= tick ? "text-navy" : "text-steel"}>{s}</span>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    );

  if (phase === "done" && published && header)
    return (
      <div className="mx-auto max-w-2xl space-y-6 pt-4">
        <Card className="p-6">
          <div className="flex gap-4">
            <IconCircle>✓</IconCircle>
            <div>
              <h1 className="text-xl font-bold text-navy">
                {published.listed} items listed in {published.storefronts.join(", ")}
                {published.storefronts.length > 1 ? " storefronts" : "'s storefront"}.
              </h1>
              <p className="mt-1 text-sm text-slate">
                {published.attention ? `${published.attention} item${published.attention > 1 ? "s" : ""} need attention and are waiting on the Contracts tab.` : "Nothing needs attention."}
                {published.replaced ? ` ${published.replaced} existing listing${published.replaced > 1 ? "s" : ""} updated to the new contract price.` : ""}
              </p>
              <p className="mt-2 text-sm text-navy">
                {header.contract_number} · {header.supplier_name} · <SourcePill source={header.source} />
              </p>
            </div>
          </div>
        </Card>
        <Card className="p-5">
          <div className="text-sm font-semibold text-navy">Revenue from this publish</div>
          <ul className="mt-2 space-y-1 text-sm">
            {db.revenue
              .filter((e) => e.related_id === published.contract.id)
              .map((e) => (
                <li key={e.id} className="flex justify-between">
                  <span>
                    <Badge tone="maroon">Option {e.option}</Badge> <span className="text-slate">{e.option_name}</span>
                  </span>
                  <span className="font-semibold">{money(e.amount)}</span>
                </li>
              ))}
          </ul>
        </Card>
        <div className="flex flex-wrap gap-2">
          <BuyerLink />
          <Link href={as === "supplier" ? "/supplier?tab=contracts" : "/procurement"} className="rounded-md border border-navy/20 bg-white px-3.5 py-2 text-sm font-semibold text-navy hover:bg-tint">
            {as === "supplier" ? "Go to Contracts tab" : "Back to Purchasing"}
          </Link>
          <Button
            variant="ghost"
            onClick={() => {
              setPhase("pick");
              setPublished(null);
              setResult(null);
            }}
          >
            Upload another
          </Button>
        </div>
      </div>
    );

  if (!result || !header) return null;
  return (
    <Review
      as={as}
      result={result}
      header={header}
      setHeader={setHeader}
      items={items}
      setItems={setItems}
      selected={selected}
      setSelected={setSelected}
      storefronts={storefronts}
      setStorefronts={setStorefronts}
      busy={busy}
      error={error}
      onPublish={async () => {
        setBusy(true);
        setError(null);
        try {
          const res = await post<PublishResult>("/api/act", {
            action: "publishContract",
            documentIds: result.documents.map((d) => d.id),
            header,
            items,
            storefrontIds: storefronts,
            role: as,
          });
          await refresh();
          setPublished(res);
          setPhase("done");
        } catch (e) {
          setError((e as Error).message);
        }
        setBusy(false);
      }}
    />
  );
}

function BuyerLink() {
  const { setRole } = useStore();
  const router = useRouter();
  return (
    <Button
      onClick={() => {
        setRole("buyer");
        router.push("/browse");
      }}
    >
      See it as a buyer
    </Button>
  );
}

// ---------------------------------------------------------------- review

const sortItems = (items: ExtractedItem[]) =>
  items
    .filter((i) => i.status !== "unresolved")
    .sort((a, b) => {
      const la = a.confidence < 0.9 && a.status === "pending" ? 0 : 1;
      const lb = b.confidence < 0.9 && b.status === "pending" ? 0 : 1;
      if (la !== lb) return la - lb;
      if (la === 0 && a.confidence !== b.confidence) return a.confidence - b.confidence;
      return a.row_index - b.row_index;
    });

function Review(props: {
  as: Role;
  result: ParseResult;
  header: ContractHeader;
  setHeader: (h: ContractHeader) => void;
  items: ExtractedItem[];
  setItems: (fn: (items: ExtractedItem[]) => ExtractedItem[]) => void;
  selected: string | null;
  setSelected: (id: string | null) => void;
  storefronts: string[];
  setStorefronts: (ids: string[]) => void;
  busy: boolean;
  error: string | null;
  onPublish: () => void;
}) {
  const { db } = useStore();
  const { result, header, setHeader, items, setItems, selected, setSelected, storefronts, setStorefronts } = props;
  // Sort once per parse so rows don't jump while the reviewer works through them.
  const order = useMemo(() => sortItems(result.items).map((i) => i.id), [result.items]);
  const rows = order.map((id) => items.find((i) => i.id === id)!).filter(Boolean);
  const unresolvedIds = useMemo(() => result.items.filter((i) => i.status === "unresolved").map((i) => i.id), [result.items]);
  const unresolved = unresolvedIds.map((id) => items.find((i) => i.id === id)!).filter(Boolean);
  const update = (id: string, patch: Partial<ExtractedItem>) => setItems((all) => all.map((i) => (i.id === id ? { ...i, ...patch } : i)));
  const accepted = items.filter((i) => i.status === "accepted").length;
  const pending = items.filter((i) => i.status === "pending").length;
  const lowPending = rows.filter((i) => i.status === "pending" && i.confidence < 0.9).length;
  const sel = items.find((i) => i.id === selected) ?? null;
  const supplier = result.supplier;
  const canScale = header.piggyback_clause_present && supplier?.edge_tier === "position";
  const h = (k: keyof ContractHeader) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setHeader({ ...header, [k]: e.target.value });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <PageTitle eyebrow="Review and correct" title={`${header.title} · ${header.contract_number}`}>
          {items.length} rows found in {result.files.length} file{result.files.length > 1 ? "s" : ""} in {(result.duration_ms / 1000).toFixed(1)}s.{" "}
          Low-confidence rows are highlighted and sorted to the top. Nothing is listed until you accept it.
        </PageTitle>
        <span className="mb-6 rounded border border-steel/60 px-2 py-0.5 text-[10px] uppercase tracking-wide text-slate">
          {result.mode === "llm" ? "Structured by Claude" : "Offline parsing"}
        </span>
      </div>

      <Card className="p-5">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-slate">Contract header</h2>
          <div className="flex gap-2 text-xs text-slate">
            {result.files.map((f) => (
              <span key={f.filename} className="rounded bg-tint px-2 py-0.5 font-mono">
                {f.filename} · {f.kind === "sheet" ? `${f.page_count} sheet` : `${f.page_count} pp`}
              </span>
            ))}
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <HField label="Supplier">
            <input value={header.supplier_name} onChange={h("supplier_name")} />
          </HField>
          <HField label="Contract number">
            <input value={header.contract_number} onChange={h("contract_number")} />
          </HField>
          <HField label="Owner">
            <input value={header.owner} onChange={h("owner")} />
          </HField>
          <HField label="Source">
            <select value={header.source} onChange={(e) => setHeader({ ...header, source: e.target.value as ContractSource })}>
              <option value="own_contract">Riverbend contract</option>
              <option value="state_contract">State contract</option>
              <option value="coop_contract">Co-op contract</option>
              <option value="reseller">Reseller</option>
              <option value="gsa">GSA schedule</option>
            </select>
          </HField>
          <HField label="Start">
            <input value={header.start} onChange={h("start")} />
          </HField>
          <HField label="End">
            <input value={header.end} onChange={h("end")} />
          </HField>
          <HField label="Payment terms">
            <input value={header.payment_terms} onChange={h("payment_terms")} />
          </HField>
          <HField label="Delivery terms">
            <input value={header.delivery_terms} onChange={h("delivery_terms")} />
          </HField>
        </div>
        <div className="mt-4 rounded-md bg-tint p-3 text-sm">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-navy">Piggyback clause</span>
            {header.piggyback_clause_present ? <Badge tone="green">Found</Badge> : <Badge tone="amber">Not found</Badge>}
          </div>
          {header.piggyback_clause_present && <blockquote className="mt-1 border-l-2 border-maroon pl-3 italic text-slate">“{header.piggyback_clause_text}”</blockquote>}
        </div>
      </Card>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_280px]">
        <div className="min-w-0 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-slate">
              Line items · {accepted} accepted · {pending} to review{lowPending ? ` (${lowPending} flagged)` : ""}
            </h2>
            <Button
              variant="secondary"
              onClick={() => setItems((all) => all.map((i) => (i.status === "pending" && i.confidence >= 0.9 && i.unit_price !== null ? { ...i, status: "accepted" } : i)))}
            >
              Accept all above 90%
            </Button>
          </div>
          <Card className="overflow-x-auto">
            <table className="w-full min-w-[700px] text-sm">
              <thead className="bg-tint text-left text-[11px] uppercase tracking-wide text-slate">
                <tr>
                  <th className="px-3 py-2">SKU · Description</th>
                  <th className="px-3 py-2">Unit</th>
                  <th className="px-3 py-2 text-right">Price</th>
                  <th className="px-3 py-2">Category</th>
                  <th className="px-3 py-2">Conf.</th>
                  <th className="px-3 py-2 text-right">Review</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((it) => (
                  <Row key={it.id} it={it} selected={it.id === selected} onSelect={() => setSelected(it.id)} update={(p) => update(it.id, p)} />
                ))}
              </tbody>
            </table>
          </Card>

          {unresolved.length > 0 && (
            <section>
              <h2 className="mb-2 text-sm font-semibold uppercase tracking-wider text-slate">Unresolved · {unresolved.length} found but not priced</h2>
              <Card className="divide-y divide-navy/5">
                {unresolved.map((it) => (
                  <UnresolvedRow key={it.id} it={it} selected={it.id === selected} onSelect={() => setSelected(it.id)} update={(p) => update(it.id, p)} />
                ))}
              </Card>
              <p className="mt-2 text-xs text-slate">These are never guessed. Enter a price from the contract to list one now, or publish and they'll wait on the Contracts tab.</p>
            </section>
          )}
        </div>

        <aside className="space-y-4 xl:sticky xl:top-28 xl:self-start">
          <SourceViewer item={sel} files={result.files} />

          <Card className="p-5">
            <div className="text-sm font-semibold text-navy">Publish to storefronts</div>
            <div className="mt-3 space-y-2">
              {db!.storefronts.map((sf) => {
                const home = sf.id === "sf_riverbend";
                const disabled = home || !canScale;
                return (
                  <label key={sf.id} className={`flex items-center gap-2 text-sm ${disabled && !home ? "text-steel" : "text-navy"}`}>
                    <input
                      type="checkbox"
                      className="!p-0"
                      checked={storefronts.includes(sf.id)}
                      disabled={disabled}
                      onChange={(e) => setStorefronts(e.target.checked ? [...storefronts, sf.id] : storefronts.filter((x) => x !== sf.id))}
                    />
                    {sf.agency_name}
                    {!home && <span className="text-xs text-slate">· {sf.distance_miles} mi</span>}
                  </label>
                );
              })}
            </div>
            {!canScale && (
              <p className="mt-2 text-xs text-slate">
                {!header.piggyback_clause_present
                  ? "Other storefronts need a piggyback clause in the contract."
                  : "Listing in other agencies' storefronts is available to Edge Position suppliers."}
              </p>
            )}
            <div className="mt-4 rounded-md bg-tint p-3 text-xs text-slate">
              {accepted} item{accepted === 1 ? "" : "s"} will be listed. {pending + unresolved.filter((u) => u.status === "unresolved").length} will wait on the Contracts tab.
            </div>
            <ErrorNote message={props.error} />
            <Button variant="maroon" className="mt-3 w-full" disabled={props.busy || accepted === 0} onClick={props.onPublish}>
              {props.busy ? "Publishing…" : `Publish ${accepted} item${accepted === 1 ? "" : "s"}`}
            </Button>
          </Card>
        </aside>
      </div>
    </div>
  );
}

function HField({ label, children }: { label: string; children: React.ReactElement }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate">{label}</span>
      <span className="block [&>*]:w-full">{children}</span>
    </label>
  );
}

function Row({ it, selected, onSelect, update }: { it: ExtractedItem; selected: boolean; onSelect: () => void; update: (p: Partial<ExtractedItem>) => void }) {
  const low = it.confidence < 0.9 && it.status === "pending";
  const gone = it.status === "rejected" || it.status === "do_not_list";
  return (
    <>
      <tr
        onClick={onSelect}
        className={`cursor-pointer border-t border-navy/5 align-top ${selected ? "bg-navy-50" : low ? "bg-amber-50/70" : ""} ${gone ? "opacity-50" : ""}`}
      >
        <td className="px-3 py-2">
          <div className="mb-0.5 font-mono text-[10px] text-slate">{it.sku ?? "No SKU"}</div>
          <input value={it.description} onChange={(e) => update({ description: e.target.value })} className={`w-full min-w-[220px] !px-2 !py-1 ${gone ? "line-through" : ""}`} />
        </td>
        <td className="px-3 py-2">
          <input value={it.unit} onChange={(e) => update({ unit: e.target.value })} className="w-14 !px-2 !py-1" />
        </td>
        <td className="px-3 py-2 text-right">
          <input
            type="number"
            step="0.01"
            value={it.unit_price ?? ""}
            onChange={(e) => update({ unit_price: e.target.value === "" ? null : Number(e.target.value), confidence: 1, flags: [...it.flags.filter((f) => !f.startsWith("Price edited")), "Price edited by reviewer"] })}
            className={`w-20 !px-2 !py-1 text-right ${low ? "border-amber-400" : ""}`}
          />
          {it.tier_pricing && it.tier_pricing.length > 1 && (
            <div className="mt-1 whitespace-nowrap text-[10px] text-slate">{it.tier_pricing.map((t) => `${t.min_qty}+ ${money(t.unit_price)}`).join(" · ")}</div>
          )}
        </td>
        <td className="px-3 py-2">
          <select value={it.category} onChange={(e) => update({ category: e.target.value as ExtractedItem["category"] })} className="w-32 !px-1.5 !py-1 text-xs">
            {CATEGORIES.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </td>
        <td className="px-3 py-2">
          <Confidence value={it.confidence} />
        </td>
        <td className="whitespace-nowrap px-3 py-2 text-right">
          {it.status === "accepted" ? (
            <button onClick={(e) => { e.stopPropagation(); update({ status: "pending" }); }} className="text-xs font-semibold text-emerald-700">
              ✓ Accepted
            </button>
          ) : gone ? (
            <button onClick={(e) => { e.stopPropagation(); update({ status: "pending" }); }} className="text-xs font-semibold text-slate underline">
              {it.status === "do_not_list" ? "Not listing" : "Deleted"} · undo
            </button>
          ) : (
            <span className="flex justify-end gap-1">
              <button
                disabled={it.unit_price === null}
                onClick={(e) => { e.stopPropagation(); update({ status: "accepted" }); }}
                className="rounded bg-navy px-2 py-1 text-xs font-semibold text-white disabled:bg-steel"
              >
                Looks right
              </button>
              <RowMenu it={it} update={update} />
            </span>
          )}
        </td>
      </tr>
      {(it.flags.length > 0 || it.duplicate_of_listing_id) && !gone && (
        <tr onClick={onSelect} className={`cursor-pointer ${selected ? "bg-navy-50" : low ? "bg-amber-50/70" : ""}`}>
          <td colSpan={6} className="px-3 pb-2 text-xs">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              {it.flags.map((f) => (
                <span key={f} className={f.startsWith("Duplicate") || f.startsWith("Two prices") ? "font-semibold text-maroon" : "text-amber-800"}>
                  ⚑ {f}
                </span>
              ))}
              {it.duplicate_of_listing_id && (
                <label className="flex items-center gap-1 text-navy" onClick={(e) => e.stopPropagation()}>
                  <input type="checkbox" className="!p-0" checked={Boolean(it.replace_existing)} onChange={(e) => update({ replace_existing: e.target.checked })} />
                  Replace existing price
                </label>
              )}
              {it.duplicate_of_row != null && (
                <button onClick={(e) => { e.stopPropagation(); update({ status: "rejected" }); }} className="rounded border border-maroon/40 px-1.5 py-0.5 font-semibold text-maroon hover:bg-maroon-50">
                  Merge into row {it.duplicate_of_row + 1}
                </button>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function RowMenu({ it, update }: { it: ExtractedItem; update: (p: Partial<ExtractedItem>) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="relative">
      <button onClick={(e) => { e.stopPropagation(); setOpen(!open); }} className="rounded border border-navy/20 px-2 py-1 text-xs text-navy hover:bg-tint" aria-label="More actions">
        ⋯
      </button>
      {open && (
        <span className="absolute right-0 z-10 mt-1 flex w-32 flex-col rounded-md border border-navy/10 bg-white py-1 text-left shadow-lg" onMouseLeave={() => setOpen(false)}>
          <button onClick={(e) => { e.stopPropagation(); update({ status: "rejected" }); setOpen(false); }} className="px-3 py-1.5 text-left text-xs hover:bg-tint">
            Delete row
          </button>
          <button onClick={(e) => { e.stopPropagation(); update({ status: "do_not_list" }); setOpen(false); }} className="px-3 py-1.5 text-left text-xs hover:bg-tint">
            Do not list
          </button>
          {it.duplicate_of_row != null && (
            <button onClick={(e) => { e.stopPropagation(); update({ status: "rejected" }); setOpen(false); }} className="px-3 py-1.5 text-left text-xs hover:bg-tint">
              Merge duplicate
            </button>
          )}
        </span>
      )}
    </span>
  );
}

function UnresolvedRow({ it, selected, onSelect, update }: { it: ExtractedItem; selected: boolean; onSelect: () => void; update: (p: Partial<ExtractedItem>) => void }) {
  const [price, setPrice] = useState("");
  const resolved = it.status === "accepted";
  return (
    <div onClick={onSelect} className={`cursor-pointer p-4 ${selected ? "bg-navy-50" : ""}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-navy">{it.description}</div>
          <div className="text-xs text-maroon">{it.flags.find((f) => f.startsWith("Unresolved"))?.replace("Unresolved: ", "") ?? "No readable price"}</div>
          <blockquote className="mt-1 border-l-2 border-steel pl-2 text-xs italic text-slate">“{it.source_excerpt}”</blockquote>
        </div>
        {resolved ? (
          <span className="text-xs font-semibold text-emerald-700">✓ Listing at {money(it.unit_price ?? 0)}</span>
        ) : (
          <span className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
            <input type="number" step="0.01" placeholder="Price" value={price} onChange={(e) => setPrice(e.target.value)} className="w-24 !px-2 !py-1 text-right" />
            <Button
              variant="secondary"
              className="!px-2 !py-1 text-xs"
              disabled={!(Number(price) > 0)}
              onClick={() => update({ unit_price: Number(price), status: "accepted", confidence: 1, flags: [...it.flags, "Price entered by reviewer"] })}
            >
              Set
            </Button>
          </span>
        )}
      </div>
    </div>
  );
}

function Confidence({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  const color = value >= 0.9 ? "bg-emerald-600" : value >= 0.7 ? "bg-amber-500" : "bg-maroon";
  return (
    <span className="flex items-center gap-1.5" title={`${pct}% confidence`}>
      <span className="h-1.5 w-8 rounded bg-tint">
        <span className={`block h-1.5 rounded ${color}`} style={{ width: `${pct}%` }} />
      </span>
      <span className="text-[11px] tabular-nums text-slate">{pct}</span>
    </span>
  );
}

function SourceViewer({ item, files }: { item: ExtractedItem | null; files: ParseResult["files"] }) {
  if (!item) return null;
  const file = files.find((f) => f.filename === item.source_file) ?? files[0];
  const page = file?.pages.find((p) => p.num === (item.source_page ?? 1)) ?? file?.pages[0];
  const text = page?.text ?? "";
  // Find the excerpt (or its first line) in the page so it can be highlighted in context.
  const needle = item.source_excerpt.replace(/^Row \d+: /, "").split(" / ")[0];
  const firstCell = needle.split(" | ")[0];
  let at = text.indexOf(needle);
  let len = needle.length;
  if (at < 0 && file?.kind === "sheet") {
    const rowLabel = item.source_excerpt.match(/^Row \d+/)?.[0];
    at = rowLabel ? text.indexOf(`${rowLabel}:`) : text.indexOf(firstCell);
    len = at >= 0 ? text.indexOf("\n", at) - at : 0;
  }
  const lo = Math.max(0, at - 260);
  const hi = Math.min(text.length, at + len + 260);

  return (
    <Card className="p-4">
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold text-navy">Where this came from</div>
        <span className="font-mono text-[10px] text-slate">
          {item.source_file}
          {item.source_page ? ` · p.${item.source_page}` : ""}
        </span>
      </div>
      {at >= 0 ? (
        <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap rounded bg-tint p-3 font-mono text-[11px] leading-relaxed text-slate">
          {lo > 0 && "…"}
          {text.slice(lo, at)}
          <mark className="rounded bg-rose/30 px-0.5 text-navy">{text.slice(at, at + len)}</mark>
          {text.slice(at + len, hi)}
          {hi < text.length && "…"}
        </pre>
      ) : (
        <blockquote className="mt-2 rounded bg-tint p-3 text-xs italic text-slate">“{item.source_excerpt}”</blockquote>
      )}
    </Card>
  );
}
