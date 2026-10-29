"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useStore } from "@/components/store";
import { Button, Card, ErrorNote, IconCircle, Loading } from "@/components/ui";
import type { Request } from "@/lib/types";

const EXAMPLES = [
  "40 folding tables for the Eastside rec center, delivered before March",
  "a box of pencils for the front desk",
  "LED retrofit for the ice rink",
  "12 hi-vis safety vests for the parks crew",
  "two 24 inch monitors for the library help desk",
];

export default function BuyerHome() {
  const { db, act, role, setRole } = useStore();
  const router = useRouter();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ph, setPh] = useState(0);

  useEffect(() => {
    const t = setInterval(() => setPh((p) => (p + 1) % EXAMPLES.length), 3500);
    return () => clearInterval(t);
  }, []);
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

  const custodial = db.contracts.find((c) => c.id === "ctr_cleanline_own");
  const daysLeft = custodial ? Math.ceil((new Date(custodial.end).getTime() - Date.now()) / 86_400_000) : 45;

  return (
    <div className="space-y-10">
      <section className="pt-6 text-center">
        <h1 className="text-3xl font-bold text-navy">What do you need?</h1>
        <p className="mt-2 text-sm text-slate">Describe it the way you'd tell a colleague. We'll find every way Riverbend can buy it.</p>
        <form
          className="mx-auto mt-6 flex max-w-2xl gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            submit(text);
          }}
        >
          <input
            autoFocus
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={`e.g. ${EXAMPLES[ph]}`}
            className="flex-1 !py-3 !text-base shadow-card"
            aria-label="What do you need?"
          />
          <Button type="submit" disabled={busy || !text.trim()} className="!px-6">
            {busy ? "Looking…" : "Ask"}
          </Button>
        </form>
        <div className="mx-auto mt-3 flex max-w-2xl flex-wrap justify-center gap-2">
          {EXAMPLES.slice(0, 3).map((ex) => (
            <button key={ex} onClick={() => { setText(ex); submit(ex); }} className="rounded-full border border-navy/15 bg-white px-3 py-1 text-xs text-slate hover:border-navy/40 hover:text-navy">
              {ex}
            </button>
          ))}
        </div>
        <div className="mx-auto mt-4 max-w-2xl"><ErrorNote message={error} /></div>

        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Chip href="#recent" label="Reorder something" />
          <Chip href="/browse" label="Browse by category" />
          <Chip href="/requests" label="Check a request" />
        </div>
      </section>

      <div className="grid gap-6 md:grid-cols-3">
        <section id="recent" className="md:col-span-2">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate">Recently bought by Parks and Recreation</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {db.recent.map((r) => (
              <Card key={r.listing_id} className="flex items-center justify-between gap-3 p-4">
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold text-navy">{r.title}</div>
                  <div className="text-xs text-slate">
                    {r.qty} from {r.supplier} · {new Date(r.date).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                  </div>
                </div>
                <Link href={`/checkout?listing=${r.listing_id}&qty=${r.qty}`} className="shrink-0 rounded-md border border-navy/20 px-2.5 py-1 text-xs font-semibold text-navy hover:bg-tint">
                  Reorder
                </Link>
              </Card>
            ))}
          </div>
        </section>

        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate">Coming up</h2>
          <Card className="divide-y divide-navy/5">
            <div className="flex gap-3 p-4">
              <IconCircle>!</IconCircle>
              <div>
                <div className="text-sm font-semibold text-navy">Your custodial supply contract expires in {daysLeft} days</div>
                <div className="mt-0.5 text-xs text-slate">CleanLine Janitorial Supply · RB-2023-042. Start a renewal or compare co-op options now.</div>
              </div>
            </div>
            <div className="flex gap-3 p-4">
              <IconCircle>↗</IconCircle>
              <div>
                <div className="text-sm font-semibold text-navy">Capital plan: Eastside rec center opens March</div>
                <div className="mt-0.5 text-xs text-slate">Likely needs furniture: tables, stacking chairs, storage carts.</div>
                <button onClick={() => submit(EXAMPLES[0])} className="mt-1.5 text-xs font-semibold text-maroon hover:underline">
                  Start with folding tables →
                </button>
              </div>
            </div>
          </Card>
        </section>
      </div>
    </div>
  );
}

function Chip({ href, label }: { href: string; label: string }) {
  return (
    <Link href={href} className="rounded-full bg-navy px-4 py-2 text-sm font-semibold text-white hover:bg-navy-600">
      {label}
    </Link>
  );
}
