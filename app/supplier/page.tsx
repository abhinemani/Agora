"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { useStore } from "@/components/store";
import { Arrow, BadgeCheck, Globe, Lock, Search, Star } from "@/components/icons";
import { Badge, Button, Card, ErrorNote, Eyebrow, IconCircle, LinkButton, Loading, RevenueTags, SourcePill, Stars, money } from "@/components/ui";
import type { EdgeTier } from "@/lib/types";

const TABS = [
  { id: "contracts", label: "Contracts" },
  { id: "storefronts", label: "Storefronts" },
  { id: "insights", label: "Insights" },
  { id: "apps", label: "Apps" },
  { id: "reviews", label: "Reviews" },
] as const;
type Tab = (typeof TABS)[number]["id"];

const TIER_LABEL: Record<EdgeTier, string> = { discover: "Edge Discover", win: "Edge Win", position: "Edge Position" };

export default function SupplierPage() {
  return (
    <Suspense fallback={<Loading />}>
      <Supplier />
    </Suspense>
  );
}

function Supplier() {
  const params = useSearchParams();
  const router = useRouter();
  const tab = (params.get("tab") as Tab) ?? "contracts";
  const { db, act, role, setRole } = useStore();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (role !== "supplier") setRole("supplier");
  }, [role, setRole]);
  if (!db) return <Loading />;

  const s = db.suppliers.find((x) => x.id === db.session.acting_supplier_id)!;
  const run = async (action: string, args: Record<string, unknown> = {}) => {
    setError(null);
    try {
      await act(action, args);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div className="space-y-6">
      <Card className="p-6">
        <div className="flex flex-wrap items-start justify-between gap-6">
          <div className="flex gap-4">
            <span className="flex h-14 w-14 items-center justify-center rounded-full bg-maroon text-xl font-bold text-white">RO</span>
            <div>
              <h1 className="text-3xl font-light tracking-tight text-navy">{s.name}</h1>
              <div className="text-sm text-slate">
                {s.city}, {s.state} · {s.categories.join(", ")}
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-navy px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-white">{TIER_LABEL[s.edge_tier]}</span>
                {s.certifications.map((c) => (
                  <Badge key={c} tone="maroon">
                    {c}-certified
                  </Badge>
                ))}
                {s.verified.insurance && <Badge tone="green">Insurance on file</Badge>}
                {s.verified.bond && <Badge tone="green">Bond on file</Badge>}
                {s.is_local && <Badge tone="navy">Local to Riverbend</Badge>}
              </div>
              <div className="mt-2">
                <Stars rating={s.rating} count={s.review_count} /> <span className="text-xs text-slate">· peer reviews from agencies</span>
              </div>
            </div>
          </div>
          <div className="space-y-3 text-sm">
            <div>
              <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate">Edge tier (demo control)</div>
              <div className="flex rounded-md bg-tint p-0.5">
                {(["discover", "win", "position"] as EdgeTier[]).map((t) => (
                  <button key={t} onClick={() => run("setTier", { tier: t })} className={`rounded px-3 py-1 text-xs font-semibold ${s.edge_tier === t ? "bg-navy text-white" : "text-navy"}`}>
                    {TIER_LABEL[t].replace("Edge ", "")}
                  </button>
                ))}
              </div>
            </div>
            <label className={`flex items-center justify-between gap-3 ${s.edge_tier === "discover" ? "text-steel" : "text-navy"}`}>
              <span>
                <span className="font-semibold">Sponsored placement</span>
                <span className="block text-xs text-slate">{s.edge_tier === "discover" ? "Needs Win or Position" : "$2.00 per buyer impression"}</span>
              </span>
              <button
                role="switch"
                aria-checked={s.sponsored}
                disabled={s.edge_tier === "discover"}
                onClick={() => run("setSponsored", { on: !s.sponsored })}
                className={`relative h-6 w-11 rounded-full transition ${s.sponsored ? "bg-maroon" : "bg-steel/50"} disabled:opacity-40`}
              >
                <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition ${s.sponsored ? "left-[22px]" : "left-0.5"}`} />
              </button>
            </label>
          </div>
        </div>
      </Card>

      <ErrorNote message={error} />

      <Journey tier={s.edge_tier} />
      <Payoff />

      <div className="flex gap-1 border-b border-navy/10">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => router.replace(`/supplier?tab=${t.id}`)}
            className={`-mb-px border-b-2 px-4 py-2 text-sm font-semibold ${tab === t.id ? "border-maroon text-navy" : "border-transparent text-slate hover:text-navy"}`}
          >
            {t.label}
            {t.id === "insights" && s.edge_tier !== "position" && <Lock className="ml-1 inline h-3.5 w-3.5 align-[-2px]" />}
          </button>
        ))}
      </div>

      {tab === "contracts" && <ContractsTab run={run} />}
      {tab === "storefronts" && <StorefrontsTab run={run} />}
      {tab === "insights" && <InsightsTab run={run} />}
      {tab === "apps" && <AppsTab run={run} />}
      {tab === "reviews" && <ReviewsTab run={run} />}
    </div>
  );
}

type Run = (action: string, args?: Record<string, unknown>) => Promise<void>;

function ContractsTab({ run }: { run: Run }) {
  const { db } = useStore();
  const sid = db!.session.acting_supplier_id;
  const contracts = db!.contracts.filter((c) => c.supplier_id === sid);
  const queue = db!.attention.filter((a) => a.supplier_id === sid && !a.resolved);
  const [prices, setPrices] = useState<Record<string, string>>({});

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="space-y-3 lg:col-span-2">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-slate">Contracts held</h2>
          <LinkButton href="/contracts/upload?as=supplier" variant="maroon">
            Upload a contract
          </LinkButton>
        </div>
        {contracts.map((c) => {
          const n = db!.listings.filter((l) => l.contract_id === c.id).length;
          return (
            <Card key={c.id} className="p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-navy">{c.title}</span>
                    <SourcePill source={c.source} />
                  </div>
                  <div className="mt-1 text-xs text-slate">
                    {c.contract_number} · {c.owner} · through {c.end}
                  </div>
                </div>
                <div className="text-right text-sm">
                  <div className="font-semibold text-navy">{n} listings</div>
                  {c.piggybackable && <div className="text-xs text-slate">Piggybackable</div>}
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5 text-xs">
                <span className="text-slate">Appears in:</span>
                {c.storefront_ids.map((id) => (
                  <Badge key={id} tone="navy">
                    {db!.storefronts.find((s) => s.id === id)?.agency_name}
                  </Badge>
                ))}
              </div>
            </Card>
          );
        })}
      </div>
      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate">Needs attention ({queue.length})</h2>
        <Card className="divide-y divide-navy/5">
          {queue.map((a) => (
            <div key={a.id} className="p-4">
              <div className="text-sm font-semibold text-navy">{a.description}</div>
              <div className="text-xs text-maroon">{a.reason}</div>
              <blockquote className="mt-1 border-l-2 border-steel pl-2 text-xs italic text-slate">“{a.source_excerpt}”</blockquote>
              <div className="mt-2 flex gap-1">
                <input type="number" step="0.01" placeholder="Contract price" value={prices[a.id] ?? ""} onChange={(e) => setPrices({ ...prices, [a.id]: e.target.value })} className="w-32 !px-2 !py-1" />
                <Button variant="secondary" className="!px-2 !py-1 text-xs" disabled={!(Number(prices[a.id]) > 0)} onClick={() => run("resolveAttention", { id: a.id, price: prices[a.id] })}>
                  List it
                </Button>
              </div>
            </div>
          ))}
          {!queue.length && <div className="p-4 text-sm text-slate">Nothing waiting. Items you couldn't price during an upload show up here.</div>}
        </Card>
      </section>
    </div>
  );
}

function StorefrontsTab({ run }: { run: Run }) {
  const { db } = useStore();
  const sid = db!.session.acting_supplier_id;
  const s = db!.suppliers.find((x) => x.id === sid)!;
  const contracts = db!.contracts.filter((c) => c.supplier_id === sid);
  const active = new Set(contracts.flatMap((c) => c.storefront_ids));
  const listings = db!.listings.filter((l) => l.supplier_id === sid);

  return (
    <div className="grid gap-4 md:grid-cols-2">
      {db!.storefronts.map((sf) => {
        const on = active.has(sf.id);
        const count = listings.filter((l) => l.storefront_ids.includes(sf.id)).length;
        return (
          <Card key={sf.id} className="flex items-center justify-between gap-4 p-5">
            <div>
              <div className="font-semibold text-navy">{sf.agency_name}</div>
              <div className="text-xs text-slate">{sf.id === "sf_riverbend" ? "Home storefront" : `${sf.distance_miles} mi from Riverbend`}</div>
            </div>
            {on ? (
              <div className="text-right">
                <Badge tone="green">Active</Badge>
                <div className="mt-1 text-xs text-slate">{count} listings</div>
              </div>
            ) : (
              <div className="text-right">
                <div className="mb-1 text-xs text-slate">Available to list · $400/yr</div>
                <Button variant="maroon" onClick={() => run("addStorefront", { storefrontId: sf.id })}>
                  Add storefront
                </Button>
              </div>
            )}
          </Card>
        );
      })}
      <p className="text-xs text-slate md:col-span-2">
        Adding a storefront lists your piggybackable contracts in a neighboring agency's storefront. {s.name} holds {contracts.filter((c) => c.piggybackable).length} piggybackable contracts.
      </p>
    </div>
  );
}

function InsightsTab({ run }: { run: Run }) {
  const { db } = useStore();
  const s = db!.suppliers.find((x) => x.id === db!.session.acting_supplier_id)!;
  if (s.edge_tier !== "position")
    return (
      <Card className="mx-auto max-w-xl p-8 text-center">
        <div className="mx-auto w-fit">
          <IconCircle size="lg">
            <Lock />
          </IconCircle>
        </div>
        <h2 className="mt-3 text-lg font-bold text-navy">Insights are part of Edge Position</h2>
        <p className="mt-2 text-sm text-slate">
          See what agencies searched for and couldn't find, solicitations coming up in your categories, and contracts about to expire, before your competitors do.
        </p>
        <Button variant="maroon" className="mt-4" onClick={() => run("setTier", { tier: "position" })}>
          Upgrade to Position · $350/mo
        </Button>
      </Card>
    );

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <Card className="p-5">
        <h2 className="text-sm font-semibold text-navy">Searched for and couldn't find</h2>
        <ul className="mt-3 space-y-2">
          {db!.unmet.slice(0, 10).map((u) => (
            <li key={u.id} className={`rounded p-2 text-sm ${u.agency_name === "City of Riverbend" && u.id.startsWith("um_req") ? "bg-maroon-50" : ""}`}>
              <div className="font-semibold text-navy">“{u.search_text}”</div>
              <div className="text-xs text-slate">
                {u.agency_name} · {u.category} · {u.date}
              </div>
            </li>
          ))}
        </ul>
      </Card>
      <Card className="p-5">
        <h2 className="text-sm font-semibold text-navy">Upcoming solicitations in your categories</h2>
        <ul className="mt-3 space-y-3">
          {db!.upcoming.map((u) => (
            <li key={u.id} className="text-sm">
              <div className="font-semibold text-navy">{u.title}</div>
              <div className="text-xs text-slate">
                {u.agency_name} · due {u.due} · est. {money(u.est_value, false)}
              </div>
            </li>
          ))}
        </ul>
      </Card>
      <Card className="p-5">
        <h2 className="text-sm font-semibold text-navy">Contracts expiring in your categories</h2>
        <ul className="mt-3 space-y-3">
          {db!.expiring.map((e) => (
            <li key={e.id} className="text-sm">
              <div className="font-semibold text-navy">{e.title}</div>
              <div className="text-xs text-slate">
                {e.agency_name} · {e.incumbent} · expires {e.expires}
              </div>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

function AppsTab({ run }: { run: Run }) {
  const { db } = useStore();
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {db!.apps.map((a) => (
        <Card key={a.id} className="flex flex-col p-5">
          <div className="text-xs font-semibold uppercase tracking-wider text-maroon">{a.partner}</div>
          <div className="mt-1 font-semibold text-navy">{a.name}</div>
          <p className="mt-1 flex-1 text-sm text-slate">{a.blurb}</p>
          {a.started ? (
            <Badge tone="green">Started · partner will reach out</Badge>
          ) : (
            <Button variant="secondary" className="mt-3 self-start" onClick={() => run("startApp", { appId: a.id })}>
              Get started
            </Button>
          )}
        </Card>
      ))}
    </div>
  );
}

function ReviewsTab({ run }: { run: Run }) {
  const { db } = useStore();
  const sid = db!.session.acting_supplier_id;
  const reviews = db!.reviews.filter((r) => r.supplier_id === sid);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  return (
    <div className="space-y-3">
      {reviews.map((r) => (
        <Card key={r.id} className="p-5">
          <div className="flex items-center justify-between">
            <div className="text-sm font-semibold text-navy">{r.agency_name}</div>
            <div className="flex items-center gap-2 text-xs text-slate">
              <span className="text-maroon">{"★".repeat(r.rating)}</span>
              {r.date}
            </div>
          </div>
          <p className="mt-1 text-sm text-navy">{r.text}</p>
          {r.response ? (
            <div className="mt-3 rounded bg-tint p-3 text-sm text-slate">
              <span className="font-semibold text-navy">Your response: </span>
              {r.response}
            </div>
          ) : (
            <div className="mt-3 flex gap-2">
              <input placeholder="Respond publicly…" value={drafts[r.id] ?? ""} onChange={(e) => setDrafts({ ...drafts, [r.id]: e.target.value })} className="flex-1" />
              <Button variant="secondary" disabled={!drafts[r.id]?.trim()} onClick={() => run("respondToReview", { reviewId: r.id, text: drafts[r.id] })}>
                Respond
              </Button>
            </div>
          )}
        </Card>
      ))}
      <p className="text-xs text-slate">
        Reviews come from agencies that bought from you, Procurated-style. <Link href="/supplier?tab=insights" className="text-maroon">See insights →</Link>
      </p>
    </div>
  );
}

const STEPS: { tier: string; title: string; sub: string; opts: number[]; need: EdgeTier | null }[] = [
  { tier: "Discover", title: "Find bids", sub: "on the network", opts: [], need: null },
  { tier: "Win", title: "Write the bid", sub: "and submit it", opts: [], need: "win" },
  { tier: "Contract", title: "Win the award", sub: "becomes a contract", opts: [], need: null },
  { tier: "Position", title: "Get listed", sub: "in every storefront", opts: [2], need: "position" },
  { tier: "Buy · Pay", title: "Take orders", sub: "and get paid", opts: [9, 5, 3], need: null },
  { tier: "Position", title: "Reach more", sub: "storefronts", opts: [4], need: "position" },
  { tier: "Position", title: "See unmet demand", sub: "and upcoming bids", opts: [6], need: "position" },
];

const RANK: Record<EdgeTier, number> = { discover: 0, win: 1, position: 2 };

/** The deck's "a supplier's win becomes a listing" loop, lit up by tier. */
function Journey({ tier }: { tier: EdgeTier }) {
  return (
    <Card className="p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <Eyebrow tone="slate">A supplier's win becomes a listing</Eyebrow>
        <span className="text-xs text-slate">Steps your Edge tier unlocks are highlighted</span>
      </div>
      <div className="flex flex-wrap items-stretch gap-2">
        {STEPS.map((st, i) => {
          const on = !st.need || RANK[tier] >= RANK[st.need];
          return (
            <div key={i} className="flex items-center gap-2">
              {i > 0 && <Arrow className={`h-3.5 w-3.5 ${i === 5 ? "text-rose" : "text-slate"}`} />}
              <div
                className={`relative min-w-[118px] rounded-lg px-3 pb-2 pt-3.5 text-center ${
                  i >= 5 ? "border border-dashed border-rose" : "border border-steel/50"
                } ${on ? (st.need ? "bg-maroon-50" : "bg-tint") : "bg-white opacity-50"}`}
              >
                {st.opts.length > 0 && (
                  <span className="absolute -right-2 -top-3">
                    <RevenueTags options={st.opts} />
                  </span>
                )}
                <div className="text-[9px] font-semibold uppercase tracking-[0.16em] text-slate">{st.tier}</div>
                <div className="text-sm font-semibold text-navy">{st.title}</div>
                <div className="text-[11px] text-slate">{on ? st.sub : `Needs Edge ${st.need === "win" ? "Win" : "Position"}`}</div>
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

/** "A supplier profile pays off beyond RFPs", with this session's numbers. */
function Payoff() {
  const { db } = useStore();
  const s = db!.suppliers.find((x) => x.id === db!.session.acting_supplier_id)!;
  const appearances = db!.counters[`appear_${s.id}`] ?? 0;
  const storefronts = new Set(db!.contracts.filter((c) => c.supplier_id === s.id).flatMap((c) => c.storefront_ids)).size;
  const reviewers = new Set(db!.reviews.filter((r) => r.supplier_id === s.id).map((r) => r.agency_name)).size;
  const cards = [
    { icon: <Search />, title: "Found in everyday buying", stat: `${appearances}`, unit: `buyer result page${appearances === 1 ? "" : "s"} this session`, body: "AI search matches your profile to small buys and co-op purchases that never become an RFP." },
    { icon: <BadgeCheck />, title: "Meets agency preferences", stat: [s.is_local ? "Local" : null, ...s.certifications].filter(Boolean).join(" + ") || "None", unit: "verified", body: "Certifications put you at the top when an agency asks for local or MBE vendors." },
    { icon: <Star />, title: "Reviews replace references", stat: s.rating.toFixed(1), unit: `from ${reviewers} agencies`, body: "Peer reviews give a buyer confidence without calling two or three references." },
    { icon: <Globe />, title: "One profile, every storefront", stat: `${storefronts}`, unit: `storefront${storefronts === 1 ? "" : "s"} active`, body: "Contracts listed once show up wherever an agency is allowed to buy from you." },
  ];
  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <Eyebrow tone="slate">Your profile pays off beyond RFPs</Eyebrow>
        <RevenueTags options={[6]} />
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((c) => (
          <div key={c.title} className="rounded-xl bg-navy p-4 text-white">
            <div className="flex items-center gap-3">
              <IconCircle>{c.icon}</IconCircle>
              <div className="text-sm font-semibold leading-tight">{c.title}</div>
            </div>
            <div className="mt-3 text-2xl font-light">{c.stat}</div>
            <div className="text-[11px] text-steel">{c.unit}</div>
            <p className="mt-2 text-xs leading-relaxed text-steel">{c.body}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
