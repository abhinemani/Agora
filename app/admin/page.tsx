"use client";

// The site's admin pages: who has an account and what they may do, supplier claims waiting for review,
// the services this server has, and a log of what admins have changed. Everything comes from /api/admin,
// which answers only admins (lib/admin.ts).

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useStore } from "@/components/store";
import { Alert, Button, ErrorNote, Loading, PageTitle } from "@/components/ui";
import type { AdminEntry } from "@/lib/admin-log";
import type { AccountCounts, AccountRole, AccountRow } from "@/lib/auth";

type Row = AccountRow & { root: boolean; admin: boolean; self: boolean };
interface Claim {
  supplier_id: string;
  supplier: string;
  website: string | null;
  name: string;
  email: string;
  at: string;
}
interface Overview {
  accounts: AccountCounts;
  config: { database: boolean; ai: boolean; email: boolean; root_admins: number };
  site: { requests: number; orders: number; carts: number; quotes: number; suppliers: number; claimed: number };
  claims: Claim[];
  log: AdminEntry[];
}
type Docs = { texts: number; pages: number; linked_urls: number; contracts: number; database_mb: number | null; ingest: { phase: string; queued: number; done: number; stopped_reason: string | null } } | null;

const TABS = [
  ["overview", "Overview"],
  ["people", "People"],
  ["claims", "Supplier claims"],
  ["activity", "Activity"],
] as const;
type Tab = (typeof TABS)[number][0];

const ROLES: [AccountRole, string][] = [
  ["buyer", "Buyer"],
  ["procurement", "Purchasing"],
  ["supplier", "Supplier"],
];

const label = "font-mono text-[11px] uppercase tracking-[0.14em]";
const n = (x: number) => x.toLocaleString("en-US");
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }) : "–");
const ago = (iso: string | null) => {
  if (!iso) return "Never";
  const m = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  if (m < 5) return "Just now";
  if (m < 60) return `${m} min ago`;
  if (m < 60 * 24) return `${Math.round(m / 60)} h ago`;
  return `${Math.round(m / 1440)} d ago`;
};

async function call<T>(method: "GET" | "POST", qs: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api/admin${qs}`, { method, cache: "no-store", headers: body ? { "content-type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error ?? "Something went wrong.");
  return json.result as T;
}

function Stat({ k, v, note }: { k: string; v: string; note?: string }) {
  return (
    <div className="p-4">
      <dt className={`${label} text-base-dark`}>{k}</dt>
      <dd className="mt-1 text-xl font-bold tabular-nums text-ink">{v}</dd>
      {note && <dd className="mt-0.5 text-ui-3xs text-base-dark">{note}</dd>}
    </div>
  );
}

function Tag({ tone, children }: { tone: "admin" | "warn" | "off" | "plain"; children: React.ReactNode }) {
  const t = { admin: "border-primary bg-primary-lighter text-primary-darker", warn: "border-warning bg-warning-lighter text-ink", off: "border-error bg-error-lighter text-error-dark", plain: "border-base-light bg-base-lightest text-base-darker" }[tone];
  return <span className={`inline-flex items-center border px-1.5 py-0.5 text-ui-3xs font-bold ${t}`}>{children}</span>;
}

// ---------------------------------------------------------------- overview

function OverviewTab({ o, docs, onReset, go }: { o: Overview; docs: Docs | undefined; onReset: () => Promise<void>; go: (t: Tab) => void }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const a = o.accounts;
  const services: [string, boolean, string][] = [
    ["Saved state", o.config.database, o.config.database ? "Accounts and the demo are saved to Postgres." : "No DATABASE_URL: everything is in memory and lost on restart, and every signed-in account is an admin."],
    ["AI", o.config.ai, o.config.ai ? "Claude words plans, reads quotes and answers from contracts." : "No API key: every page shows its rule-based version."],
    ["Email", o.config.email, o.config.email ? "Confirmation, reset and approval emails go out through Resend." : "No RESEND_API_KEY: links are logged on the server, not sent."],
    ["Root admins", o.config.root_admins > 0, o.config.root_admins ? `${o.config.root_admins} named in AGORA_ADMIN_EMAILS.` : "AGORA_ADMIN_EMAILS is empty on this server."],
  ];
  return (
    <div className="space-y-8">
      {o.claims.length > 0 && (
        <Alert type="warning" heading={`${o.claims.length} supplier claim${o.claims.length === 1 ? "" : "s"} waiting for review`} action={<Button variant="secondary" onClick={() => go("claims")}>Review claims</Button>}>
          Each was made from an email that isn't on the company's website domain, so it needs a person to check it.
        </Alert>
      )}

      <section className="space-y-3">
        <h2 className="font-heading text-heading-md font-bold text-ink">Accounts</h2>
        <dl className="grid grid-cols-2 divide-base-light border border-base-light bg-white sm:grid-cols-3 lg:grid-cols-6 [&>*]:border-base-light [&>*]:border-b lg:[&>*]:border-b-0 [&>*:not(:first-child)]:border-l">
          <Stat k="Accounts" v={n(a.total)} />
          <Stat k="Confirmed" v={n(a.verified)} note={a.total ? `${Math.round((100 * a.verified) / a.total)}% of accounts` : undefined} />
          <Stat k="Seen this week" v={n(a.seen_7d)} />
          <Stat k="New this week" v={n(a.new_7d)} />
          <Stat k="Made admin" v={n(a.granted_admin)} note="plus the root admins" />
          <Stat k="Suspended" v={n(a.disabled)} />
        </dl>
        <p className="text-ui-xs text-base-darker">
          By role: {ROLES.map(([r, l]) => `${l} ${n(a.by_role[r] ?? 0)}`).join(" · ")}.{" "}
          <button className="font-bold text-primary hover:text-primary-dark" onClick={() => go("people")}>
            Manage people →
          </button>
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="font-heading text-heading-md font-bold text-ink">This server</h2>
        <p className="max-w-[72ex] text-body-sm text-base-darker">What the server running this page has been given. These are set as environment variables on Railway; nothing here changes them.</p>
        <ul className="divide-y divide-base-lighter border border-base-light bg-white">
          {services.map(([k, on, text]) => (
            <li key={k} className="flex flex-wrap items-baseline gap-x-4 gap-y-1 px-4 py-3">
              <span className="w-28 shrink-0 font-bold text-ink">{k}</span>
              <span className={`w-12 shrink-0 text-ui-xs font-bold ${on ? "text-success-dark" : "text-warning-darker"}`}>{on ? "On" : "Off"}</span>
              <span className="min-w-0 basis-full text-ui-xs text-base-darker [overflow-wrap:anywhere] sm:flex-1 sm:basis-0">{text}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="space-y-3">
        <h2 className="font-heading text-heading-md font-bold text-ink">The demo</h2>
        <p className="max-w-[72ex] text-body-sm text-base-darker">Activity in the shared demo store, across every agency. Resetting it puts back the seeded searches, carts, orders and storefronts; accounts are kept.</p>
        <dl className="grid grid-cols-2 border border-base-light bg-white sm:grid-cols-5 [&>*:not(:first-child)]:border-l [&>*]:border-base-light">
          <Stat k="Searches" v={n(o.site.requests)} />
          <Stat k="Orders" v={n(o.site.orders)} />
          <Stat k="Carts" v={n(o.site.carts)} />
          <Stat k="Quote requests" v={n(o.site.quotes)} />
          <Stat k="Storefronts claimed" v={`${n(o.site.claimed)} of ${n(o.site.suppliers)}`} />
        </dl>
        <div className="border border-error bg-white p-4">
          <div className="font-bold text-ink">Reset the demo for everyone</div>
          <p className="mt-1 text-ui-xs text-base-darker">Every visitor's searches, carts, orders, quotes and claims made since the last reset are cleared. It can't be undone.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {confirming ? (
              <>
                <Button
                  className="!bg-error-dark hover:!bg-error-darker"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    await onReset();
                    setBusy(false);
                    setConfirming(false);
                  }}
                >
                  {busy ? "Resetting…" : "Yes, reset the demo"}
                </Button>
                <Button variant="secondary" disabled={busy} onClick={() => setConfirming(false)}>
                  Cancel
                </Button>
              </>
            ) : (
              <Button variant="secondary" onClick={() => setConfirming(true)}>
                Reset the demo…
              </Button>
            )}
          </div>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="font-heading text-heading-md font-bold text-ink">Document store</h2>
        {docs === undefined ? (
          <p className="text-ui-xs text-base-darker">Reading the counts…</p>
        ) : docs ? (
          <>
            <dl className="grid grid-cols-2 border border-base-light bg-white sm:grid-cols-4 [&>*:not(:first-child)]:border-l [&>*]:border-base-light">
              <Stat k="Documents read" v={n(docs.texts)} note={`of ${n(docs.linked_urls)} linked`} />
              <Stat k="Pages" v={n(docs.pages)} />
              <Stat k="Contracts" v={n(docs.contracts)} />
              <Stat k="Database" v={docs.database_mb == null ? "–" : `${n(docs.database_mb)} MB`} />
            </dl>
            <p className="text-ui-xs text-base-darker">
              Background reading: {docs.ingest.phase}
              {docs.ingest.queued ? `, ${n(docs.ingest.done)} of ${n(docs.ingest.queued)} fetched` : ""}
              {docs.ingest.stopped_reason ? `. Stopped: ${docs.ingest.stopped_reason}` : ""}.{" "}
              <a href="/api/docs/status" className="font-bold text-primary hover:text-primary-dark">
                Full status →
              </a>
            </p>
          </>
        ) : (
          <p className="text-ui-xs text-base-darker">
            {o.config.database ? (
              <>
                The counts couldn't be read just now.{" "}
                <a href="/api/docs/status" className="font-bold text-primary hover:text-primary-dark">Full status →</a>
              </>
            ) : (
              "No database on this server, so documents are read from the held text as before."
            )}
          </p>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="font-heading text-heading-md font-bold text-ink">Elsewhere</h2>
        <p className="text-ui-xs text-base-darker">
          <Link href="/quality" className="font-bold text-primary hover:text-primary-dark">AI quality</Link> counts what the checks kept and what people marked wrong.{" "}
          <Link href="/coops/price-lists" className="font-bold text-primary hover:text-primary-dark">The price-list queue</Link> and{" "}
          <Link href="/data" className="font-bold text-primary hover:text-primary-dark">co-op data</Link> cover the datasets.
        </p>
      </section>
    </div>
  );
}

// ---------------------------------------------------------------- people

function Manage({ r, run, close }: { r: Row; run: (op: string, extra?: Record<string, unknown>, ok?: string) => Promise<boolean>; close: () => void }) {
  const [deleting, setDeleting] = useState(false);
  const [confirm, setConfirm] = useState("");
  const locked = r.self || r.root;
  const why = r.self ? "This is your account, so another admin has to change its admin status, suspend it or delete it." : r.root ? "This is a root admin, named in AGORA_ADMIN_EMAILS on the server. Take it off that list to change its admin status, suspend it or delete it." : null;
  return (
    <div className="space-y-4 bg-base-lightest px-4 py-4">
      <div className="grid gap-x-6 gap-y-1 text-ui-xs text-base-darker sm:grid-cols-2">
        <div>Account id: <span className="font-mono">{r.id}</span></div>
        <div>Joined {when(r.created_at)}</div>
        <div>Agency: {r.agency ? `${r.agency.name}, ${r.agency.state}` : "None chosen"}</div>
        <div>Signed in on {r.sessions} browser{r.sessions === 1 ? "" : "s"} · last seen {ago(r.last_seen_at).toLowerCase()}</div>
      </div>
      {why && <p className="text-ui-xs text-base-darker">{why}</p>}
      <div className="flex flex-wrap gap-2">
        {r.verified ? (
          <Button variant="secondary" onClick={() => run("setVerified", { on: false }, "Marked unconfirmed.")}>Mark unconfirmed</Button>
        ) : (
          <>
            <Button variant="secondary" onClick={() => run("setVerified", { on: true }, "Address confirmed.")}>Confirm address</Button>
            <Button variant="secondary" onClick={() => run("sendVerification", {}, "Confirmation link sent.")}>Send confirmation link</Button>
          </>
        )}
        <Button variant="secondary" onClick={() => run("sendReset", {}, "Password-reset link sent.")}>Send password reset</Button>
        <Button variant="secondary" disabled={!r.sessions} onClick={() => run("signOut", {}, "Signed out everywhere.")}>Sign out everywhere</Button>
        {!locked && (
          <>
            {r.granted_admin ? (
              <Button variant="secondary" onClick={() => run("setAdmin", { on: false }, "No longer an admin.")}>Remove admin</Button>
            ) : (
              <Button variant="secondary" disabled={!r.verified} title={r.verified ? undefined : "Admins need a confirmed address"} onClick={() => run("setAdmin", { on: true }, "Now an admin.")}>
                Make admin
              </Button>
            )}
            {r.disabled ? (
              <Button variant="secondary" onClick={() => run("setDisabled", { on: false }, "Account restored.")}>Restore account</Button>
            ) : (
              <Button variant="secondary" onClick={() => run("setDisabled", { on: true }, "Account suspended and signed out.")}>Suspend</Button>
            )}
            <Button variant="secondary" className="!border-error !text-error-dark" onClick={() => setDeleting(!deleting)}>Delete…</Button>
          </>
        )}
        <Button variant="secondary" onClick={close} className="ml-auto">Close</Button>
      </div>
      {deleting && (
        <form
          className="space-y-2 border border-error bg-white p-3"
          onSubmit={async (e) => {
            e.preventDefault();
            if (await run("delete", { confirm }, "Account deleted.")) close();
          }}
        >
          <p className="text-ui-xs text-ink">
            Deleting removes the account, its sessions, its searches nothing else refers to and its unpublished contract reads. Orders and carts stay with the agency. Type <span className="font-mono font-bold">{r.email}</span> to confirm.
          </p>
          <div className="flex flex-wrap gap-2">
            <input className="min-w-0 flex-1 text-sm" value={confirm} onChange={(e) => setConfirm(e.target.value)} aria-label="Type the account's email to confirm" autoComplete="off" />
            <Button type="submit" className="!bg-error-dark hover:!bg-error-darker" disabled={confirm.trim().toLowerCase() !== r.email.toLowerCase()}>
              Delete the account
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}

function PeopleTab({ flash }: { flash: (msg: string) => void }) {
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<Row[] | null>(null);
  const [total, setTotal] = useState(0);
  const [open, setOpen] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);

  const load = useCallback(async (query: string, offset = 0) => {
    const mine = ++seq.current;
    try {
      const r = await call<{ rows: Row[]; total: number }>("GET", `?view=accounts&q=${encodeURIComponent(query)}&offset=${offset}`);
      if (mine !== seq.current) return;
      setRows((prev) => (offset ? [...(prev ?? []), ...r.rows] : r.rows));
      setTotal(r.total);
      setError(null);
    } catch (e) {
      if (mine === seq.current) setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => void load(q), q ? 250 : 0);
    return () => clearTimeout(t);
  }, [q, load]);

  const run = async (id: string, op: string, extra: Record<string, unknown> = {}, ok = "Done.") => {
    try {
      const res = await call<{ emailed?: boolean }>("POST", "", { op, id, ...extra });
      flash(res?.emailed === false ? `${ok.replace(/\.$/, "")}, but no email went out: this server has no email service, or the address had three links in the last hour.` : ok);
      await load(q);
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <label className="block min-w-0 flex-1 text-sm font-bold text-ink">
          Find an account
          <input className="mt-1 w-full text-sm" type="search" placeholder="Name, email or agency" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
        <span className="pb-2 text-ui-xs text-base-dark">{rows ? `${n(total)} account${total === 1 ? "" : "s"}${q ? " match" : ""}` : ""}</span>
      </div>
      <ErrorNote message={error} />
      {!rows ? (
        <Loading label="Reading accounts" />
      ) : rows.length === 0 ? (
        <div className="border border-dashed border-base-light bg-white px-5 py-8 text-sm text-base-darker">{q ? "No account matches that." : "Nobody has made an account yet."}</div>
      ) : (
        <div className="overflow-x-auto border border-base-light bg-white">
          <table className="w-full min-w-[820px] text-left text-ui-xs">
            <thead className={`${label} bg-base-lightest text-base-dark`}>
              <tr>
                {["Person", "Role", "Agency", "Status", "Last seen", ""].map((h) => (
                  <th key={h} className="px-3 py-2 font-normal">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <FragmentRow key={r.id} r={r} open={open === r.id} toggle={() => setOpen(open === r.id ? null : r.id)} run={(op, extra, ok) => run(r.id, op, extra, ok)} />
              ))}
            </tbody>
          </table>
        </div>
      )}
      {rows && rows.length < total && (
        <Button variant="secondary" onClick={() => load(q, rows.length)}>
          Show more ({n(total - rows.length)} left)
        </Button>
      )}
    </div>
  );
}

function FragmentRow({ r, open, toggle, run }: { r: Row; open: boolean; toggle: () => void; run: (op: string, extra?: Record<string, unknown>, ok?: string) => Promise<boolean> }) {
  return (
    <>
      <tr className={`border-t border-base-lighter align-top ${r.disabled ? "bg-error-lighter/40" : ""}`}>
        <td className="px-3 py-3">
          <div className="font-bold text-ink">{r.name}{r.self && <span className="font-normal text-base-dark"> (you)</span>}</div>
          <div className="break-all text-base-darker">{r.email}</div>
        </td>
        <td className="px-3 py-3">
          <select aria-label={`Role for ${r.email}`} className="text-ui-xs" value={r.role} onChange={(e) => void run("setRole", { role: e.target.value }, "Role changed.")}>
            {ROLES.map(([v, l]) => (
              <option key={v} value={v}>{l}</option>
            ))}
          </select>
        </td>
        <td className="px-3 py-3 text-base-darker">{r.agency ? `${r.agency.name}, ${r.agency.state}` : "–"}</td>
        <td className="px-3 py-3">
          <div className="flex flex-wrap gap-1">
            {r.root ? <Tag tone="admin">Root admin</Tag> : r.granted_admin ? <Tag tone="admin">Admin</Tag> : null}
            {r.disabled && <Tag tone="off">Suspended</Tag>}
            {!r.verified && <Tag tone="warn">Unconfirmed</Tag>}
            {r.verified && !r.disabled && !r.granted_admin && !r.root && <Tag tone="plain">Active</Tag>}
          </div>
        </td>
        <td className="px-3 py-3 text-base-darker" title={when(r.last_seen_at)}>{ago(r.last_seen_at)}</td>
        <td className="px-3 py-3 text-right">
          <button onClick={toggle} aria-expanded={open} className="font-bold text-primary hover:text-primary-dark">
            {open ? "Close" : "Manage"}
          </button>
        </td>
      </tr>
      {open && (
        <tr>
          <td colSpan={6} className="p-0">
            <Manage r={r} run={run} close={toggle} />
          </td>
        </tr>
      )}
    </>
  );
}

// ---------------------------------------------------------------- claims and activity

function ClaimsTab({ claims, run }: { claims: Claim[]; run: (op: string, supplierId: string, ok: string) => Promise<void> }) {
  if (!claims.length) return <div className="border border-dashed border-base-light bg-white px-5 py-8 text-sm text-base-darker">No claims are waiting. A claim made from an email on the company's website domain is approved without review.</div>;
  return (
    <div className="space-y-3">
      <p className="max-w-[72ex] text-body-sm text-base-darker">These claims came from addresses that don't match the company's website, so a person checks each one. Approving lets the claimant manage the storefront; rejecting returns it to unclaimed.</p>
      <ul className="divide-y divide-base-lighter border border-base-light bg-white">
        {claims.map((c) => (
          <li key={c.supplier_id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-4">
            <div className="min-w-0">
              <div className="font-bold text-ink">
                <Link href={`/storefronts/${c.supplier_id}`} className="text-ink hover:text-primary">{c.supplier}</Link>
              </div>
              <div className="text-ui-xs text-base-darker">
                {c.name} · <span className="break-all">{c.email}</span>
              </div>
              <div className="text-ui-3xs text-base-dark">
                Website {c.website ?? "not on file"} · claimed {when(c.at)}
              </div>
            </div>
            <div className="flex gap-2">
              <Button onClick={() => run("approveClaim", c.supplier_id, `${c.supplier}: claim approved.`)}>Approve</Button>
              <Button variant="secondary" onClick={() => run("rejectClaim", c.supplier_id, `${c.supplier}: claim rejected.`)}>Reject</Button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ActivityTab({ log }: { log: AdminEntry[] }) {
  if (!log.length) return <div className="border border-dashed border-base-light bg-white px-5 py-8 text-sm text-base-darker">No admin actions have been recorded yet.</div>;
  return (
    <div className="space-y-3">
      <p className="max-w-[72ex] text-body-sm text-base-darker">The 25 most recent changes made by admins, here and elsewhere on the site, newest first.</p>
      <div className="overflow-x-auto border border-base-light bg-white">
        <table className="w-full min-w-[680px] text-left text-ui-xs">
          <thead className={`${label} bg-base-lightest text-base-dark`}>
            <tr>
              {["When", "Admin", "What", "To", "Detail"].map((h) => (
                <th key={h} className="px-3 py-2 font-normal">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {log.map((e) => (
              <tr key={e.id} className="border-t border-base-lighter align-top">
                <td className="whitespace-nowrap px-3 py-2 text-base-darker">{when(e.made_at)}</td>
                <td className="break-all px-3 py-2 text-base-darker">{e.actor_email}</td>
                <td className="px-3 py-2 font-bold text-ink">{e.action}</td>
                <td className="break-all px-3 py-2 text-base-darker">{e.target ?? "–"}</td>
                <td className="px-3 py-2 text-base-darker">{e.detail ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- the page

export default function AdminPage() {
  const { user, refresh } = useStore();
  const [tab, setTab] = useState<Tab>("overview");
  const [o, setO] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  // The tab follows the address's #hash, so a link to /admin#claims opens Supplier claims.
  useEffect(() => {
    const follow = () => {
      const h = window.location.hash.slice(1);
      if (TABS.some(([t]) => t === h)) setTab(h as Tab);
    };
    follow();
    window.addEventListener("hashchange", follow);
    return () => window.removeEventListener("hashchange", follow);
  }, []);
  const go = (t: Tab) => {
    setTab(t);
    history.replaceState(null, "", `#${t}`);
  };

  const load = useCallback(async () => {
    try {
      setO(await call<Overview>("GET", "?view=overview"));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    if (user?.admin) void load();
  }, [user?.admin, user?.id, load]);
  // Each tab change re-reads the overview (accounts, claims and the log: light queries), so they stay current.
  useEffect(() => {
    if (user?.admin && o) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  // The document store's counts are read once per visit, and only if the Overview is opened: those queries share
  // the database connections with the background document ingest, so the page never repeats them on its own.
  const [docs, setDocs] = useState<Docs | undefined>(undefined);
  const askedDocs = useRef(false);
  useEffect(() => {
    if (!user?.admin || tab !== "overview" || askedDocs.current) return;
    askedDocs.current = true;
    call<Docs>("GET", "?view=docs").then(setDocs, () => setDocs(null));
  }, [user?.admin, tab]);

  const flash = (msg: string) => {
    setNote(msg);
    setTimeout(() => setNote((m) => (m === msg ? null : m)), 6000);
  };

  if (!user) return <Loading />;
  if (!user.admin)
    return (
      <div className="mx-auto max-w-xl space-y-3">
        <PageTitle title="Site admin" />
        <Alert type="info" heading="This page is for Loci's admins">
          {user.verified ? "Your account isn't an admin. An existing admin can make it one from this page." : "Admins need a confirmed email address. Confirm yours from the link we sent, then ask an existing admin."}
        </Alert>
      </div>
    );

  const claimRun = async (op: string, supplierId: string, ok: string) => {
    try {
      await call("POST", "", { op, supplierId });
      flash(ok);
      await Promise.all([load(), refresh()]);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div className="space-y-6">
      <PageTitle title="Site admin">
        <p>Accounts, supplier claims and the shared demo. Every change made here is recorded under Activity with the admin who made it.</p>
      </PageTitle>

      <div role="tablist" aria-label="Admin sections" className="flex flex-wrap gap-x-1 border-b border-base-light">
        {TABS.map(([t, l]) => {
          const count = t === "claims" ? o?.claims.length : t === "people" ? o?.accounts.total : undefined;
          return (
            <button
              key={t}
              role="tab"
              aria-selected={tab === t}
              onClick={() => go(t)}
              className={`-mb-px flex min-h-[44px] items-center gap-2 border-b-4 px-3 text-ui-xs font-bold ${tab === t ? "border-primary text-ink" : "border-transparent text-base-dark hover:text-ink"}`}
            >
              {l}
              {count ? <span className={`rounded-full px-1.5 text-ui-3xs tabular-nums ${t === "claims" ? "bg-warning text-ink" : "bg-base-lighter text-base-darker"}`}>{n(count)}</span> : null}
            </button>
          );
        })}
      </div>

      {note && <Alert type="success">{note}</Alert>}
      <ErrorNote message={error} />

      {tab === "people" ? (
        <PeopleTab flash={flash} />
      ) : !o ? (
        <Loading label="Reading the site" />
      ) : tab === "overview" ? (
        <OverviewTab
          o={o}
          docs={docs}
          go={go}
          onReset={async () => {
            try {
              await call("POST", "", { op: "resetDemo" });
              flash("The demo was reset.");
              await Promise.all([load(), refresh()]);
            } catch (e) {
              setError((e as Error).message);
            }
          }}
        />
      ) : tab === "claims" ? (
        <ClaimsTab claims={o.claims} run={claimRun} />
      ) : (
        <ActivityTab log={o.log} />
      )}
    </div>
  );
}
