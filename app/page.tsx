"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Search } from "@/components/icons";
import { useStore } from "@/components/store";
import { Button, ErrorNote, Loading } from "@/components/ui";
import type { Request } from "@/lib/types";

const EXAMPLES = [
  "40 folding tables for the Eastside rec center, delivered before March",
  "a box of pencils for the front desk",
  "jury management software",
];

export default function BuyerHome() {
  const { db, act, role, setRole } = useStore();
  const router = useRouter();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (role !== "buyer") setRole("buyer");
  }, [role, setRole]);

  if (!db) return <Loading />;

  const submit = async (q: string) => {
    if (!q.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const { request, needsPreference } = await act<{ request: Request; needsPreference: boolean }>("createRequest", { text: q });
      router.push(`/request/${request.id}${needsPreference ? "?ask=1" : ""}`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  const renew = async () => {
    setBusy(true);
    try {
      const r = await act<Request>("startRenewal", { contractId: "ctr_cleanline_own" });
      router.push(`/solicitations/new?request=${r.id}`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  const custodial = db.contracts.find((c) => c.id === "ctr_cleanline_own");
  const daysLeft = custodial ? Math.ceil((new Date(custodial.end).getTime() - Date.now()) / 86_400_000) : 45;
  const renewalStarted = db.requests.some((r) => r.raw_text.includes("RB-2023-042") && r.outcome === "solicitation");

  return (
    <div className="space-y-16 pt-8">
      <section className="max-w-3xl">
        <h1 className="text-[2.1rem] font-semibold leading-tight tracking-tight text-navy">What do you need?</h1>
        <p className="mt-2 text-[17px] text-slate">Describe it the way you'd tell a colleague. We'll check every contract you can buy from.</p>
        <form
          className="mt-6 flex items-center gap-2 rounded-xl border border-line bg-white p-1.5 pl-4 shadow-[0_1px_2px_rgba(20,33,61,0.04)] focus-within:border-navy/40"
          onSubmit={(e) => {
            e.preventDefault();
            submit(text);
          }}
        >
          <Search className="h-5 w-5 shrink-0 text-steel" />
          <input
            autoFocus
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="e.g. 40 folding tables for the rec center"
            className="min-w-0 flex-1 !border-0 !px-1 !py-2.5 !text-base !shadow-none !outline-none !ring-0"
            aria-label="What do you need?"
          />
          <Button type="submit" variant="maroon" disabled={busy || !text.trim()} className="!rounded-lg !px-5">
            {busy ? "Looking" : "Ask"}
          </Button>
        </form>
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm text-slate">
          <span>Try</span>
          {EXAMPLES.map((ex) => (
            <button
              key={ex}
              onClick={() => {
                setText(ex);
                submit(ex);
              }}
              className="text-navy underline decoration-line underline-offset-4 hover:decoration-navy"
            >
              {ex.length > 44 ? `${ex.slice(0, 41)}…` : ex}
            </button>
          ))}
        </div>
        <div className="mt-4">
          <ErrorNote message={error} />
        </div>
      </section>

      <div className="grid gap-12 border-t border-line pt-10 md:grid-cols-2">
        <section>
          <h2 className="text-base font-semibold text-navy">Coming up</h2>
          <ul className="mt-3 divide-y divide-line">
            <li className="py-3">
              <div className="text-sm text-navy">Custodial supply contract expires in {daysLeft} days</div>
              <div className="mt-0.5 text-sm text-slate">CleanLine Janitorial Supply, RB-2023-042</div>
              {renewalStarted ? (
                <div className="mt-1 text-sm text-emerald-700">Renewal solicitation published</div>
              ) : (
                <button onClick={renew} disabled={busy} className="mt-1 text-sm font-semibold text-maroon hover:underline">
                  Start an early renewal
                </button>
              )}
            </li>
            <li className="py-3">
              <div className="text-sm text-navy">Eastside rec center opens in March</div>
              <div className="mt-0.5 text-sm text-slate">The capital plan suggests tables, stacking chairs and storage carts.</div>
              <button onClick={() => submit(EXAMPLES[0])} className="mt-1 text-sm font-semibold text-maroon hover:underline">
                Find folding tables
              </button>
            </li>
            <li className="py-3">
              <div className="text-sm text-navy">Trash liners are due for a reorder</div>
              <div className="mt-0.5 text-sm text-slate">You order about every 30 days; the last order was Oct 9.</div>
              <Link href="/checkout?listing=lst_009&qty=12" className="mt-1 inline-block text-sm font-semibold text-maroon hover:underline">
                Reorder 12 cases
              </Link>
            </li>
          </ul>
        </section>

        <section>
          <h2 className="text-base font-semibold text-navy">Recently bought by Parks and Recreation</h2>
          <ul className="mt-3 divide-y divide-line">
            {db.recent.map((r) => (
              <li key={r.listing_id} className="flex items-center justify-between gap-4 py-3">
                <div className="min-w-0">
                  <div className="truncate text-sm text-navy">{r.title}</div>
                  <div className="text-sm text-slate">
                    {r.qty} from {r.supplier}, {new Date(r.date).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                  </div>
                </div>
                <Link href={`/checkout?listing=${r.listing_id}&qty=${r.qty}`} className="shrink-0 text-sm font-semibold text-navy hover:text-maroon">
                  Reorder
                </Link>
              </li>
            ))}
          </ul>
          <Link href="/browse" className="mt-3 inline-block text-sm text-slate hover:text-navy">
            Browse everything in the storefront
          </Link>
        </section>
      </div>
    </div>
  );
}
