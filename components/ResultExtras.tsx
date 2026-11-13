"use client";

import Link from "next/link";
import { useState } from "react";
import type { OwnHit, Unavailable } from "@/lib/assistant";
import { FitPill } from "./CoopSection";
import { FREE_RFP_LIMIT, rfpsLeft, settingsFor, setupStatus } from "@/lib/agency";
import { Check } from "./icons";
import { useStore } from "./store";
import { Button, ErrorNote, LinkButton, money } from "./ui";

/** "We already have a contract for this": the agency's own register, shown before anything else. */
export function OwnContractsCard({ hits, agency }: { hits: OwnHit[]; agency: string }) {
  if (!hits.length) return null;
  return (
    <section id="own-contracts" className="scroll-mt-24 rounded-xl bg-success-container/60 p-5">
      <div className="flex items-center gap-2">
        <span className="grid h-6 w-6 place-items-center rounded-full bg-emerald-600 text-white">
          <Check className="h-3.5 w-3.5" />
        </span>
        <h2 className="text-lg font-bold tracking-tight text-navy">{agency} already has a contract for this</h2>
      </div>
      <p className="mt-1 text-xs text-slate">From your agency's contract register. Buy under it before looking anywhere else.</p>
      <ul className="mt-3 space-y-2">
        {hits.map((h) => (
          <li key={h.contract_id} className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-emerald-200 bg-white p-3">
            <div className="min-w-0">
              <div className="text-sm font-semibold text-navy">{h.title}</div>
              <div className="mt-0.5 text-xs text-slate">
                <Link href={`/storefronts/${h.supplier_id}`} className="text-navy hover:text-maroon hover:underline">
                  {h.vendor}
                </Link>{" "}
                · <span className="font-mono">{h.contract_number}</span>
                {h.end && ` · through ${h.end}`}
                {h.ceiling ? ` · not to exceed ${money(h.ceiling, false)}` : ""}
              </div>
            </div>
            <div className="flex items-center gap-2">
              {h.url && (
                <a href={h.url} target="_blank" rel="noreferrer" className="text-xs font-semibold text-maroon hover:underline">
                  Open contract ↗
                </a>
              )}
              <FitPill fit={h.fit} />
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Expired contracts are hidden by default; one line says how many and lets the buyer look. */
export function ExpiredNote({ items }: { items: Unavailable[] }) {
  const [open, setOpen] = useState(false);
  if (!items.length) return null;
  return (
    <div className="text-xs text-slate">
      {items.length} expired contract{items.length === 1 ? "" : "s"} also matched and {items.length === 1 ? "is" : "are"} hidden.{" "}
      <button onClick={() => setOpen(!open)} className="font-semibold text-maroon hover:underline">
        {open ? "Hide" : "Show"}
      </button>
      {open && (
        <ul className="mt-2 space-y-1">
          {items.map((u) => (
            <li key={`${u.vehicle}|${u.contract_number}`}>
              <span className="font-semibold text-navy">
                {u.vehicle} {u.contract_number}
              </span>{" "}
              · {u.owner} · {u.examples[0]} · <span className="text-maroon">{u.reason}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const TOOLS = [
  { id: "euna", label: "Euna Procurement" },
  { id: "opengov", label: "OpenGov Procurement" },
  { id: "bonfire", label: "Bonfire" },
] as const;

/** When nothing covers a need: RFP Lite (free, counted), Sovra's full RFP tool, or the agency's own tool. */
export function NextSteps({ requestId }: { requestId: string }) {
  const { db, act } = useStore();
  const [sent, setSent] = useState<string | null>(null);
  const [tool, setTool] = useState<(typeof TOOLS)[number]["id"]>("euna");
  const [error, setError] = useState<string | null>(null);
  if (!db) return null;
  const agency = db.session.buyer?.name ?? db.agency.name;
  const settings = settingsFor(db, agency);
  const left = rfpsLeft(settings);
  const handoff = async (t: string, label: string) => {
    setError(null);
    try {
      await act("handoffRfp", { requestId, tool: t });
      setSent(label);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  if (sent) return <p className="mt-4 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-900">Sent to {sent} with your request as the starting scope. Demo only: no integration is called.</p>;
  return (
    <div className="mt-4 grid gap-3 sm:grid-cols-3">
      <div className="flex flex-col justify-between rounded-xl border border-line p-3">
        <div>
          <div className="text-sm font-semibold text-navy">RFP Lite</div>
          <div className="text-xs text-slate">Free. Agora drafts it from your request and the closest past solicitation.</div>
          <div className={`mt-1 text-[11px] font-semibold ${left === 0 ? "text-maroon" : "text-slate"}`}>
            {left === null ? "Unlimited on your plan" : left === 0 ? `All ${FREE_RFP_LIMIT} free RFPs used this year` : `${left} of ${FREE_RFP_LIMIT} free RFPs left this year`}
          </div>
        </div>
        <LinkButton href={`/solicitations/new?request=${requestId}`} variant="maroon" className="mt-3 text-center">
          Build it
        </LinkButton>
      </div>
      <div className="flex flex-col justify-between rounded-xl border border-line p-3">
        <div>
          <div className="text-sm font-semibold text-navy">Sovra's full RFP tool</div>
          <div className="text-xs text-slate">Paid. Evaluation, scoring and award, for larger or formal solicitations.</div>
        </div>
        <Button variant="secondary" className="mt-3" onClick={() => handoff("sovra_rfp", "Sovra's RFP tool")}>
          Start in Sovra RFP
        </Button>
      </div>
      <div className="flex flex-col justify-between rounded-xl border border-line p-3">
        <div>
          <div className="text-sm font-semibold text-navy">Your own RFP tool</div>
          <div className="text-xs text-slate">Keep the tool you use. Agora hands off the request.</div>
          <select value={tool} onChange={(e) => setTool(e.target.value as typeof tool)} className="mt-2 w-full !py-1 text-xs">
            {TOOLS.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
        </div>
        <Button variant="secondary" className="mt-3" onClick={() => handoff(tool, TOOLS.find((t) => t.id === tool)!.label)}>
          Send it over
        </Button>
      </div>
      {error && (
        <div className="sm:col-span-3">
          <ErrorNote message={error} />
        </div>
      )}
    </div>
  );
}

/** Setup a requester can't answer (co-ops, the agency's own contracts) goes to the purchasing admin. */
export function InviteAdminBanner({ requestId }: { requestId: string }) {
  const { db, act, role } = useStore();
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  if (!db || role !== "buyer" || !db.session.buyer) return null;
  const buyer = db.session.buyer;
  const status = setupStatus(db, buyer);
  if (status.complete) return null;
  const invited = db.invites.find((i) => i.agency === buyer.name);
  const gaps = [
    !status.steps.contracts && { what: "its own contracts", effect: "you won't see contracts it already holds" },
    !status.steps.coops && { what: "its co-op memberships", effect: "Agora can't tell which co-ops you're on" },
  ].filter((g): g is { what: string; effect: string } => Boolean(g));
  const missing = gaps.map((g) => g.what).join(" and ");
  const effect = gaps.map((g) => g.effect).join(", and ");
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-line bg-white px-4 py-2.5 text-xs text-slate">
      <span>
        {buyer.name} hasn't set up {missing} yet, so {effect}.{" "}
        {invited ? <span className="font-semibold text-emerald-800">Purchasing was invited ({invited.email}).</span> : "Your purchasing admin can finish setup in a few minutes."}
      </span>
      {!invited &&
        (open ? (
          <form
            className="flex items-center gap-2"
            onSubmit={async (e) => {
              e.preventDefault();
              setError(null);
              try {
                await act("inviteAdmin", { email, requestId });
              } catch (err) {
                setError((err as Error).message);
              }
            }}
          >
            <input type="email" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} placeholder="purchasing@yourtown.gov" className="!py-1 text-xs" />
            <Button type="submit">Invite</Button>
            {error && <span className="text-maroon">{error}</span>}
          </form>
        ) : (
          <button onClick={() => setOpen(true)} className="font-semibold text-maroon hover:underline">
            Invite purchasing →
          </button>
        ))}
    </div>
  );
}
