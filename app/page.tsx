"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Book, Calendar, Clock, People, Repeat, Search } from "@/components/icons";
import { useStore } from "@/components/store";
import { Badge, Button, Card, ErrorNote, Eyebrow, IconCircle, Loading, RevenueTags, SectionLabel, Stars, money } from "@/components/ui";
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
  const listingCount = db.listings.filter((l) => l.storefront_ids.includes("sf_riverbend")).length;
  const sources = new Set(db.listings.filter((l) => l.storefront_ids.includes("sf_riverbend")).map((l) => l.source)).size;

  return (
    <div className="space-y-12">
      <section className="relative left-1/2 -mt-8 w-screen -translate-x-1/2 bg-navy px-4 pb-14 pt-16 text-white">
        <div className="mx-auto max-w-3xl text-center">
          <Eyebrow tone="rose">City of Riverbend · Storefront</Eyebrow>
          <h1 className="mt-4 text-4xl font-light tracking-tight sm:text-5xl">What do you need?</h1>
          <p className="mt-3 text-lg font-light text-steel">Describe it the way you'd tell a colleague. We'll check every way Riverbend can buy it.</p>
          <form
            className="mt-8 flex gap-2 rounded-2xl bg-white p-2 shadow-2xl shadow-black/20"
            onSubmit={(e) => {
              e.preventDefault();
              submit(text);
            }}
          >
            <span className="flex items-center pl-3 text-slate">
              <Search className="h-5 w-5" />
            </span>
            <input
              autoFocus
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={`e.g. ${EXAMPLES[ph]}`}
              className="min-w-0 flex-1 !border-0 !py-3 !text-base !shadow-none !ring-0"
              aria-label="What do you need?"
            />
            <Button type="submit" variant="maroon" disabled={busy || !text.trim()} className="!rounded-xl !px-6">
              {busy ? "Looking…" : "Ask"}
            </Button>
          </form>
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            {EXAMPLES.slice(0, 3).map((ex) => (
              <button
                key={ex}
                onClick={() => {
                  setText(ex);
                  submit(ex);
                }}
                className="rounded-full border border-white/15 px-3 py-1 text-xs text-steel transition-colors hover:border-white/40 hover:text-white"
              >
                {ex}
              </button>
            ))}
          </div>
          <div className="mx-auto mt-4 max-w-2xl text-left">
            <ErrorNote message={error} />
          </div>
          <div className="mt-8 flex flex-wrap justify-center gap-x-8 gap-y-2 text-sm text-steel">
            <span>
              <span className="font-semibold text-white">{listingCount}</span> items on contract or ready to buy
            </span>
            <span>
              <span className="font-semibold text-white">{sources}</span> sources in one storefront
            </span>
            <span>
              <span className="font-semibold text-white">{money(db.agency.quick_buy_threshold, false)}</span> quick-buy limit
            </span>
          </div>
        </div>
      </section>

      <div className="grid gap-4 sm:grid-cols-3">
        <QuickStart href="#recent" icon={<Repeat />} title="Reorder something" sub="From your department's history" />
        <QuickStart href="/browse" icon={<Book />} title="Browse by category" sub="The whole shelf, labeled by source" />
        <QuickStart href="/requests" icon={<Clock />} title="Check a request" sub="Orders, approvals and solicitations" />
      </div>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-10">
          <section id="recent">
            <SectionLabel>Recently bought by Parks and Recreation</SectionLabel>
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
            <SectionLabel right={<RevenueTags options={[4, 7, 6]} />}>What agencies near you bought</SectionLabel>
            <div className="grid gap-3 sm:grid-cols-2">
              {db.peers.slice(0, 4).map((p) => (
                <Card key={p.id} className="p-4">
                  <div className="flex items-center gap-2 text-xs text-slate">
                    <People className="h-3.5 w-3.5" /> {p.agency_name} · {p.distance_miles} mi
                  </div>
                  <div className="mt-1 text-sm font-semibold text-navy">{p.listing_title}</div>
                  <div className="mt-2 flex items-center justify-between">
                    <span className="text-sm font-semibold text-navy">{money(p.unit_price)}</span>
                    <Stars rating={p.rating} />
                  </div>
                  <div className="mt-2">{p.piggybackable ? <Badge tone="green">Piggyback OK</Badge> : <Badge tone="amber">No piggyback</Badge>}</div>
                </Card>
              ))}
            </div>
          </section>
        </div>

        <aside>
          <SectionLabel right={<RevenueTags options={[3, 8]} />}>Coming up</SectionLabel>
          <Card accent="maroon" className="divide-y divide-navy/5">
            <Prompt icon={<Calendar />} title={`Your custodial supply contract expires in ${daysLeft} days`} sub="CleanLine Janitorial Supply · RB-2023-042. Start the rebid now so there's no gap.">
              {renewalStarted ? (
                <Badge tone="green">Renewal solicitation published</Badge>
              ) : (
                <button onClick={renew} disabled={busy} className="text-xs font-semibold text-maroon hover:underline">
                  Start an early renewal →
                </button>
              )}
            </Prompt>
            <Prompt icon={<Book />} title="Capital plan: Eastside rec center opens March" sub="Likely needs furniture: tables, stacking chairs, storage carts.">
              <button onClick={() => submit(EXAMPLES[0])} className="text-xs font-semibold text-maroon hover:underline">
                Start with folding tables →
              </button>
            </Prompt>
            <Prompt icon={<Repeat />} title="Trash liners are due for a reorder" sub="You order about every 30 days; the last order was Oct 9.">
              <Link href="/checkout?listing=lst_009&qty=12" className="text-xs font-semibold text-maroon hover:underline">
                Reorder 12 cases →
              </Link>
            </Prompt>
          </Card>
          <p className="mt-3 text-xs text-slate">Capital plans, contract expiry dates and order history prompt reorders, renewals and early bids.</p>
        </aside>
      </div>
    </div>
  );
}

function QuickStart({ href, icon, title, sub }: { href: string; icon: React.ReactNode; title: string; sub: string }) {
  return (
    <Link href={href} className="group flex items-center gap-4 rounded-xl border border-navy/10 bg-white p-4 shadow-card transition hover:-translate-y-0.5 hover:border-navy/30 hover:shadow-md">
      <IconCircle>{icon}</IconCircle>
      <span>
        <span className="block text-sm font-semibold text-navy">{title}</span>
        <span className="block text-xs text-slate">{sub}</span>
      </span>
    </Link>
  );
}

function Prompt({ icon, title, sub, children }: { icon: React.ReactNode; title: string; sub: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3 p-4">
      <IconCircle>{icon}</IconCircle>
      <div>
        <div className="text-sm font-semibold text-navy">{title}</div>
        <div className="mt-0.5 text-xs text-slate">{sub}</div>
        <div className="mt-1.5">{children}</div>
      </div>
    </div>
  );
}
