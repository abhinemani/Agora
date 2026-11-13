"use client";

import { useRef, useState } from "react";
import { registerContracts } from "@/lib/agency";
import type { RegisterIssue, RegisterRow } from "@/lib/register";
import { Upload } from "./icons";
import { useStore } from "./store";
import { Badge, Button, Card, ErrorNote, money } from "./ui";

interface Report {
  filename: string;
  agency: string;
  header_row: number;
  columns: Record<string, string>;
  added: number;
  updated: number;
  rows: RegisterRow[];
  issues: RegisterIssue[];
}

const FIELD_LABEL: Record<string, string> = { title: "Title", vendor: "Vendor", number: "Number", category: "Category", start: "Start", end: "End", ceiling: "Ceiling", url: "Link" };

/** The purchasing admin uploads the agency's contract register so staff see "we already have a contract" first. */
export function ContractRegister() {
  const { db, refresh } = useStore();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const buyer = db?.session.buyer;
  if (!db || !buyer) return null;
  const mine = registerContracts(db, buyer.name).sort((a, b) => (a.end || "9999").localeCompare(b.end || "9999"));
  const today = new Date().toISOString().slice(0, 10);

  const send = async (body: FormData | { sample: true }) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/contracts/register", body instanceof FormData ? { method: "POST", body } : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Upload failed");
      setReport(json.result);
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    }
    setBusy(false);
  };

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-xl">
          <div className="text-base font-semibold text-navy">{buyer.name}'s contracts</div>
          <p className="mt-1 text-sm text-slate">
            Upload your contract register as a CSV or XLSX, one contract per row. Agora reads the title, vendor, number, category, dates, not-to-exceed amount and link. These
            contracts are visible only to {buyer.name}.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={input}
            type="file"
            accept=".csv,.xlsx,.xls"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              const form = new FormData();
              form.append("file", f);
              send(form);
              e.target.value = "";
            }}
          />
          <Button disabled={busy} onClick={() => input.current?.click()}>
            <Upload className="mr-1.5 inline h-4 w-4" />
            {busy ? "Reading…" : "Upload register"}
          </Button>
          <Button variant="secondary" disabled={busy} onClick={() => send({ sample: true })}>
            Try the sample register
          </Button>
        </div>
      </div>
      <p className="mt-2 text-[11px] text-slate">
        The sample is <a href="/test-contracts/harmon-lake-contract-register.csv" className="font-semibold text-maroon hover:underline">harmon-lake-contract-register.csv</a>: eight rows, three of them
        broken on purpose.
      </p>
      <ErrorNote message={error} />

      {report && (
        <div className="mt-4 rounded-lg border border-line p-4">
          <div className="text-sm font-semibold text-navy">
            {report.filename}: {report.added} added{report.updated ? `, ${report.updated} updated` : ""}, {report.issues.length} couldn't be read
          </div>
          <div className="mt-1 flex flex-wrap gap-1.5 text-[11px] text-slate">
            Header on row {report.header_row}. Columns found:
            {Object.entries(report.columns).map(([f, h]) => (
              <Badge key={f}>
                {FIELD_LABEL[f] ?? f} ← “{h}”
              </Badge>
            ))}
          </div>
          {report.rows.some((r) => r.warnings.length) && (
            <ul className="mt-3 space-y-1 text-xs text-amber-800">
              {report.rows
                .filter((r) => r.warnings.length)
                .map((r) => (
                  <li key={r.row}>
                    Row {r.row}, {r.title}: imported, {r.warnings.join("; ")}.
                  </li>
                ))}
            </ul>
          )}
          {report.issues.length > 0 && (
            <div className="mt-3">
              <div className="text-xs font-semibold text-maroon">Not imported. Fix these rows and upload again:</div>
              <ul className="mt-1 space-y-1.5 text-xs">
                {report.issues.map((i) => (
                  <li key={i.row}>
                    <span className="font-semibold text-navy">Row {i.row}:</span> <span className="text-maroon">{i.problem}</span>
                    <div className="truncate font-mono text-[11px] text-slate">{i.text}</div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {mine.length > 0 && (
        <table className="mt-4 w-full text-left text-xs">
          <thead className="text-slate">
            <tr>
              <th className="py-1.5 font-semibold">Contract</th>
              <th className="py-1.5 font-semibold">Vendor</th>
              <th className="hidden py-1.5 font-semibold sm:table-cell">Ends</th>
              <th className="hidden py-1.5 text-right font-semibold sm:table-cell">Not to exceed</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-navy/5">
            {mine.map((c) => (
              <tr key={c.id} className={c.end && c.end < today ? "text-slate" : "text-navy"}>
                <td className="py-1.5 pr-2">
                  {c.title}
                  <span className="block font-mono text-[10px] text-slate">{c.contract_number}</span>
                </td>
                <td className="py-1.5 pr-2">{db.suppliers.find((s) => s.id === c.supplier_id)?.name}</td>
                <td className="hidden py-1.5 sm:table-cell">{c.end ? (c.end < today ? `Expired ${c.end}` : c.end) : "—"}</td>
                <td className="hidden py-1.5 text-right tabular-nums sm:table-cell">{c.ceiling ? money(c.ceiling, false) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}
