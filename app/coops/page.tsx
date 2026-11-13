"use client";

import { useRef, useState } from "react";
import { Upload } from "@/components/icons";
import { useStore } from "@/components/store";
import { Badge, Button, Card, ErrorNote, Loading, PageTitle } from "@/components/ui";
import type { Coop } from "@/lib/types";

interface Report {
  coop: string;
  filename: string;
  mode: "replace" | "merge";
  header_row: number;
  columns: Record<string, string>;
  imported: number;
  total: number;
  name_only: number;
  issues: { row: number; problem: string; text: string }[];
  matched: string[];
}

const STATUS = { none: "No member list yet", partial: "Partial member list", full: "Full member list" } as const;
const SOURCE = { "co-op": "uploaded from the co-op", scraped: "scraped from public pages", demo: "demo list for illustration" } as const;
const FIELD = { name: "Government", domain: "Website", email: "Email", state: "State" } as Record<string, string>;

/** Sovra ops: upload each co-op's list of member governments, so Agora can tell every agency which co-ops it's on. */
export default function CoopMemberLists() {
  const { db, act } = useStore();
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ name: "", website: "" });
  const [error, setError] = useState<string | null>(null);
  if (!db) return <Loading />;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageTitle title="Co-op member lists">
        Upload the list of governments that belong to each co-op. Agora matches them to agencies by website (or the domain of a contact email), and by name and state when a row
        has neither. Matched agencies see the co-op under “Co-ops you're on” in their results.
      </PageTitle>

      {db.coops.map((c) => (
        <CoopCard key={c.id} coop={c} />
      ))}

      <Card className="p-5">
        {adding ? (
          <form
            className="grid gap-3 sm:grid-cols-[1.4fr_1.4fr_auto] sm:items-end"
            onSubmit={async (e) => {
              e.preventDefault();
              setError(null);
              try {
                await act("addCoop", form);
                setForm({ name: "", website: "" });
                setAdding(false);
              } catch (err) {
                setError((err as Error).message);
              }
            }}
          >
            <label className="block text-xs font-semibold text-slate">
              Co-op name
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. TIPS" className="mt-1 w-full" />
            </label>
            <label className="block text-xs font-semibold text-slate">
              Website
              <input value={form.website} onChange={(e) => setForm({ ...form, website: e.target.value })} placeholder="optional" className="mt-1 w-full" />
            </label>
            <Button type="submit" disabled={!form.name.trim()}>
              Add co-op
            </Button>
          </form>
        ) : (
          <button onClick={() => setAdding(true)} className="text-sm font-semibold text-maroon hover:underline">
            Add a co-op Agora doesn't track yet
          </button>
        )}
        <ErrorNote message={error} />
      </Card>
    </div>
  );
}

function CoopCard({ coop }: { coop: Coop }) {
  const { db, refresh } = useStore();
  const input = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<"merge" | "replace">(coop.members?.length ? "merge" : "replace");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [filter, setFilter] = useState("");
  const [all, setAll] = useState(false);
  if (!db) return null;
  const members = coop.members ?? [];
  const agencies = db.memberships.filter((m) => m.coop_id === coop.id);
  const shown = members.filter((m) => !filter || `${m.name} ${m.domain} ${m.state ?? ""}`.toLowerCase().includes(filter.toLowerCase()));

  const send = async (body: FormData | Record<string, unknown>) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(
        "/api/coops/members",
        body instanceof FormData ? { method: "POST", body } : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) },
      );
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
        <div>
          <div className="text-lg font-semibold text-navy">{coop.name}</div>
          <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-slate">
            <Badge tone={coop.member_list_status === "none" ? "amber" : "green"}>{STATUS[coop.member_list_status]}</Badge>
            {coop.member_list_source && <span>{SOURCE[coop.member_list_source]}</span>}
            {coop.member_list_updated_at && <span>, updated {new Date(coop.member_list_updated_at).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}</span>}
          </div>
          <div className="mt-1 text-sm text-navy">
            {members.length} government{members.length === 1 ? "" : "s"} on the list, {agencies.length} matched to agencies in Agora
          </div>
          {coop.access === "state_addendum" && (
            <div className="mt-1 max-w-lg text-xs text-slate">Agencies also reach {coop.name} through their state's participating addendum, whether or not they're on this list.</div>
          )}
        </div>
        <div className="flex flex-col items-end gap-2">
          <div className="flex" role="radiogroup" aria-label="Upload mode">
            {(
              [
                ["merge", "Add to list"],
                ["replace", "Replace list"],
              ] as const
            ).map(([m, label], i) => (
              <button
                key={m}
                role="radio"
                aria-checked={mode === m}
                onClick={() => setMode(m)}
                className={`px-4 py-2 text-ui-2xs font-bold ${i ? "-ml-0.5 rounded-r-md" : "rounded-l-md"} ${mode === m ? "relative z-10 bg-primary text-white" : "bg-white text-primary shadow-[inset_0_0_0_1px_theme(colors.primary.DEFAULT)] hover:text-primary-dark"}`}
              >
                {label}
              </button>
            ))}
          </div>
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
              form.append("coopId", coop.id);
              form.append("mode", mode);
              send(form);
              e.target.value = "";
            }}
          />
          <div className="flex gap-2">
            <Button disabled={busy} onClick={() => input.current?.click()}>
              <Upload className="h-4 w-4" />
              {busy ? "Reading" : "Upload member list"}
            </Button>
            {coop.id === "coop_sourcewell" && (
              <Button variant="secondary" disabled={busy} onClick={() => send({ sample: true, coopId: coop.id, mode })}>
                Try the sample
              </Button>
            )}
          </div>
        </div>
      </div>
      <ErrorNote message={error} />

      {report && (
        <div className="mt-4 rounded-lg border border-line p-4 text-sm">
          <div className="font-semibold text-navy">
            {report.filename}: {report.imported} government{report.imported === 1 ? "" : "s"} {report.mode === "replace" ? "now make up the list" : "read"}, {report.total} on the list in all
            {report.issues.length ? `, ${report.issues.length} rows skipped` : ""}
          </div>
          <div className="mt-1 flex flex-wrap gap-1.5 text-[11px] text-slate">
            Columns found:
            {Object.entries(report.columns).map(([f, h]) => (
              <Badge key={f}>
                {FIELD[f] ?? f} from “{h}”
              </Badge>
            ))}
          </div>
          <p className="mt-2 text-xs text-emerald-800">
            {report.matched.length ? `Matched in Agora: ${report.matched.join(", ")}.` : "No agency in Agora matched this list yet."}
          </p>
          {report.name_only > 0 && <p className="mt-1 text-xs text-amber-800">{report.name_only} rows have no website or email, so they match by name and state only.</p>}
          {report.issues.length > 0 && (
            <ul className="mt-2 space-y-1 text-xs">
              {report.issues.map((i) => (
                <li key={i.row}>
                  <span className="font-semibold text-navy">Row {i.row}:</span> <span className="text-maroon">{i.problem}</span>
                  <span className="block truncate text-[11px] text-slate">{i.text}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {members.length > 0 && (
        <div className="mt-4">
          {members.length > 8 && <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder={`Search ${members.length} members`} className="mb-2 w-full sm:w-72" />}
          <table className="w-full text-left text-xs">
            <thead className="text-slate">
              <tr>
                <th className="py-1.5 font-semibold">Government</th>
                <th className="py-1.5 font-semibold">State</th>
                <th className="hidden py-1.5 font-semibold sm:table-cell">Matches on</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-navy/5 text-navy">
              {(all ? shown : shown.slice(0, 8)).map((m) => (
                <tr key={m.domain || `${m.name}|${m.state}`}>
                  <td className="py-1.5 pr-2">{m.name}</td>
                  <td className="py-1.5 pr-2">{m.state ?? ""}</td>
                  <td className="hidden py-1.5 text-slate sm:table-cell">{m.domain || "name and state"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {shown.length > 8 && !all && (
            <button onClick={() => setAll(true)} className="mt-2 text-xs font-semibold text-maroon hover:underline">
              Show all {shown.length}
            </button>
          )}
        </div>
      )}
    </Card>
  );
}
