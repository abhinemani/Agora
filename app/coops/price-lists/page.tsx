"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useStore } from "@/components/store";
import { Badge, Card, Loading, PageTitle } from "@/components/ui";
import type { QueueItem } from "@/lib/catalog";

interface Page {
  total: number;
  items: QueueItem[];
  counts: Record<string, number>;
}

const KIND: Record<string, string> = { htm: "Web page", pdf: "PDF", xlsx: "Spreadsheet", xls: "Spreadsheet", csv: "CSV", docx: "Word", unknown: "Document bundle" };

/** Sovra ops: the co-op catalog's price lists and catalog pages, waiting to be read into Agora. */
export default function PriceListQueue() {
  const { db } = useStore();
  const [coop, setCoop] = useState("");
  const [kind, setKind] = useState("");
  const [q, setQ] = useState("");
  const [offset, setOffset] = useState(0);
  const [page, setPage] = useState<Page | null>(null);

  useEffect(() => {
    const t = setTimeout(() => {
      const p = new URLSearchParams({ coop, kind, q, offset: String(offset) });
      fetch(`/api/catalog/documents?${p}`)
        .then((r) => r.json())
        .then(setPage)
        .catch(() => setPage({ total: 0, items: [], counts: {} }));
    }, 150);
    return () => clearTimeout(t);
  }, [coop, kind, q, offset]);

  if (!db || !page) return <Loading />;
  const coops = [...new Set(Object.keys(page.counts).map((k) => k.split("|")[0]))].sort();
  const kinds = [...new Set(Object.keys(page.counts).map((k) => k.split("|")[1]))].sort();
  const total = Object.values(page.counts).reduce((a, b) => a + b, 0);
  const reads = new Map(db.price_list_reads.map((r) => [r.document_id, r]));
  const done = db.price_list_reads.filter((r) => r.status === "read");

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageTitle title="Price-list queue">
        The co-op catalog points to {total.toLocaleString()} published price lists and catalog pages that Agora hasn't read yet. Sending one through the contract reader pulls
        out its priced rows for review, the same way an uploaded contract is read. Nothing publishes until the rows are checked.
      </PageTitle>

      <div className="grid gap-3 sm:grid-cols-3">
        <Card className="p-4">
          <div className="font-heading text-heading-md font-bold text-ink">{total.toLocaleString()}</div>
          <div className="text-ui-xs text-base-dark">documents in the queue</div>
        </Card>
        <Card className="p-4">
          <div className="font-heading text-heading-md font-bold text-ink">{done.length}</div>
          <div className="text-ui-xs text-base-dark">read this session, {done.reduce((n, r) => n + r.items, 0).toLocaleString()} priced rows found</div>
        </Card>
        <Card className="p-4">
          <div className="font-heading text-heading-md font-bold text-ink">{(page.counts["GSA MAS|htm"] ?? 0).toLocaleString()}</div>
          <div className="text-ui-xs text-base-dark">GSA Advantage catalog pages, the bulk of the queue</div>
        </Card>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <label className="text-xs font-semibold text-slate">
          Co-op
          <select value={coop} onChange={(e) => (setCoop(e.target.value), setOffset(0))} className="mt-1 block">
            <option value="">All</option>
            {coops.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs font-semibold text-slate">
          Kind
          <select value={kind} onChange={(e) => (setKind(e.target.value), setOffset(0))} className="mt-1 block">
            <option value="">All</option>
            {kinds.map((k) => (
              <option key={k} value={k}>
                {KIND[k] ?? k}
              </option>
            ))}
          </select>
        </label>
        <label className="min-w-60 flex-1 text-xs font-semibold text-slate">
          Supplier or contract
          <input value={q} onChange={(e) => (setQ(e.target.value), setOffset(0))} placeholder="e.g. Canon or GS-35F" className="mt-1 w-full" />
        </label>
      </div>

      <Card className="divide-y divide-base-lighter">
        {page.items.map((d) => {
          const read = reads.get(d.id);
          return (
            <div key={d.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-1.5 text-sm">
                  <span className="font-semibold text-navy">{d.supplier || "Unknown supplier"}</span>
                  <span className="font-mono text-[11px] text-slate">
                    {d.coop} {d.contract_number}
                  </span>
                  <Badge tone="neutral">{KIND[d.kind] ?? d.kind}</Badge>
                  {read && <Badge tone={read.status === "read" ? "green" : "amber"}>{read.message}</Badge>}
                </div>
                <div className="mt-0.5 truncate text-[11px] text-slate">
                  {d.label} ·{" "}
                  <a href={d.url} target="_blank" rel="noreferrer" className="text-primary">
                    open the original ↗
                  </a>
                </div>
              </div>
              {d.readable ? (
                <Link
                  href={`/contracts/upload?as=supplier&document=${encodeURIComponent(d.id)}`}
                  className="inline-flex items-center rounded-md bg-primary px-4 py-2.5 text-ui-xs font-bold leading-none text-white no-underline hover:bg-primary-dark"
                >
                  {read ? "Read again" : "Read it"}
                </Link>
              ) : (
                <span className="text-[11px] text-slate" title="A document bundle: open it and upload the price file inside">
                  Open and upload the price file inside
                </span>
              )}
            </div>
          );
        })}
        {!page.items.length && <p className="p-4 text-sm text-slate">No documents match.</p>}
      </Card>

      <div className="flex items-center justify-between text-sm">
        <span className="text-slate">
          {page.total ? `${(offset + 1).toLocaleString()}–${Math.min(offset + page.items.length, page.total).toLocaleString()} of ${page.total.toLocaleString()}` : ""}
        </span>
        <span className="flex gap-3">
          <button disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 25))} className="font-semibold text-maroon disabled:text-slate">
            ← Previous
          </button>
          <button disabled={offset + 25 >= page.total} onClick={() => setOffset(offset + 25)} className="font-semibold text-maroon disabled:text-slate">
            Next →
          </button>
        </span>
      </div>
    </div>
  );
}
