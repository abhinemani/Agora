"use client";

import Link from "next/link";
import { useStore } from "@/components/store";
import { Arrow } from "@/components/icons";
import { Card, Eyebrow, Loading, money } from "@/components/ui";
import { EDGE_TIER, FIVE_WAYS, PURCHASE_KINDS, REVENUE_OPTIONS } from "@/lib/revenue_rules";
import type { Db } from "@/lib/types";

/** Where in the prototype each option can be triggered, for the "Try it" column. */
const TRY: Record<number, { href: string; label: string }> = {
  1: { href: "/", label: "Credited on every contract or P-card order" },
  2: { href: "/contracts/upload?as=supplier", label: "Upload a contract" },
  3: { href: "/", label: "Order folding tables" },
  4: { href: "/supplier?tab=storefronts", label: "Add a storefront" },
  5: { href: "/", label: "Search for folding tables" },
  6: { href: "/supplier?tab=reviews", label: "Respond to a review" },
  7: { href: "/procurement/spend", label: "Open spend intelligence" },
  8: { href: "/", label: "Ask for an LED retrofit" },
  9: { href: "/", label: "Buy pencils on a P-card" },
  10: { href: "/supplier?tab=apps", label: "Start a partner app" },
};

function live(db: Db) {
  const byOpt = (o: number) => db.revenue.filter((e) => e.option === o);
  const sum = (opts: readonly number[]) => db.revenue.filter((e) => opts.includes(e.option)).reduce((n, e) => n + e.amount, 0);
  const fired = (o: number) => byOpt(o).length > 0;
  return { byOpt, sum, fired };
}

/** A revenue badge that is filled once the option has fired this session. */
function Tag({ o, fired }: { o: number | "E"; fired: boolean }) {
  const name = o === "E" ? "Existing Edge subscription" : `Option ${o}: ${REVENUE_OPTIONS[o].name}`;
  return (
    <span
      title={`${name}${fired ? " · fired this session" : " · not yet fired"}`}
      className={`inline-flex h-6 min-w-6 items-center justify-center rounded-full px-1 text-[11px] font-bold ring-2 ring-white transition ${
        fired ? "bg-maroon text-white" : "border border-dashed border-maroon/60 bg-white text-maroon"
      }`}
    >
      {o}
    </span>
  );
}

function Tags({ opts, fired }: { opts: (number | "E")[]; fired: (o: number) => boolean }) {
  return (
    <span className="absolute -right-2 -top-3 flex gap-0.5">
      {opts.map((o) => (
        <Tag key={o} o={o} fired={o === "E" ? true : fired(o)} />
      ))}
    </span>
  );
}

function Node({ k, title, sub, opts = [], fired, dashed, accent }: { k?: string; title: string; sub?: string; opts?: (number | "E")[]; fired: (o: number) => boolean; dashed?: boolean; accent?: boolean }) {
  return (
    <div
      className={`relative rounded-lg px-3 py-2.5 text-center ${
        dashed ? "border border-dashed border-rose bg-white" : accent ? "border border-maroon/30 bg-maroon-50" : "border border-steel/50 bg-tint"
      }`}
    >
      {opts.length > 0 && <Tags opts={opts} fired={fired} />}
      {k && <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate">{k}</div>}
      <div className="text-sm font-semibold text-navy">{title}</div>
      {sub && <div className="text-[11px] text-slate">{sub}</div>}
    </div>
  );
}

const Chain = ({ active }: { active: string }) => (
  <div className="mb-6">
    <Eyebrow tone="slate">Sovra value chain</Eyebrow>
    <div className="mt-2 flex flex-wrap items-center gap-2">
      {["Plan", "Source", "Contract", "Buy", "Pay"].map((s, i) => (
        <span key={s} className="flex items-center gap-2">
          {i > 0 && <Arrow className="h-4 w-4 text-slate" />}
          <span className={`rounded-full px-6 py-1.5 text-sm font-semibold text-white sm:px-9 ${s === active ? "bg-maroon" : "bg-navy"}`}>{s}</span>
        </span>
      ))}
    </div>
  </div>
);

const Flow = () => <Arrow className="mx-auto h-4 w-4 shrink-0 rotate-90 text-slate md:rotate-0" />;

export default function Model() {
  const { db } = useStore();
  if (!db) return <Loading />;
  const { sum, fired, byOpt } = live(db);
  const total = db.revenue.reduce((n, e) => n + e.amount, 0);
  const firedCount = Object.keys(REVENUE_OPTIONS).filter((o) => fired(Number(o))).length;

  const contractOrders = db.orders.filter((o) => db.listings.find((l) => l.id === o.listing_id)?.source !== "no_approval");
  const smallOrders = db.orders.filter((o) => db.listings.find((l) => l.id === o.listing_id)?.source === "no_approval");
  const newSols = db.solicitations.filter((s) => s.published_at);
  const credits = -db.revenue.filter((e) => e.option === 1 && e.amount < 0).reduce((n, e) => n + e.amount, 0);
  const activeStorefronts = new Set(db.contracts.flatMap((c) => c.storefront_ids)).size;
  const listedSuppliers = new Set(db.listings.map((l) => l.supplier_id)).size;

  return (
    <div className="space-y-16">
      {/* Hero */}
      <section className="relative left-1/2 -mt-8 w-screen -translate-x-1/2 bg-navy px-4 pb-12 pt-14 text-white">
        <div className="mx-auto max-w-6xl">
          <Eyebrow tone="rose">Sovra · Business model, live</Eyebrow>
          <h1 className="mt-4 text-4xl font-light tracking-tight sm:text-5xl">How the storefront earns</h1>
          <p className="mt-4 max-w-2xl text-lg font-light text-steel">
            A local government's own storefront for everything it can buy, and ten ways to earn from it beyond SaaS. Every diagram on this page is driven by what has happened in this demo session.
          </p>
          <div className="mt-6 h-0.5 w-16 bg-maroon" />
          <div className="mt-8 grid gap-6 sm:grid-cols-3">
            <Stat label="Earned this session" value={money(total)} />
            <Stat label="Revenue options fired" value={`${firedCount} of 10`} />
            <Stat label="Riverbend's net subscription" value={money(2000 - credits)} sub={`$2,000 less ${money(credits)} in credits`} />
          </div>
        </div>
      </section>

      {/* Three kinds of purchase */}
      <section>
        <h2 className="text-3xl font-light tracking-tight text-navy">Three kinds of purchase, each earning differently</h2>
        <div className="mt-6 grid gap-4 md:grid-cols-3">
          {(
            [
              [PURCHASE_KINDS.contract, contractOrders.length, contractOrders.length === 1 ? "order on contract" : "orders on contract"],
              [PURCHASE_KINDS.no_approval, smallOrders.length, smallOrders.length === 1 ? "small purchase" : "small purchases"],
              [PURCHASE_KINDS.new_need, newSols.length, newSols.length === 1 ? "solicitation started" : "solicitations started"],
            ] as const
          ).map(([k, count, unit]) => (
            <div key={k.n} className={`rounded-xl p-6 ${k.n === 3 ? "border-2 border-dashed border-rose/70 bg-white" : "bg-tint"}`}>
              <div className={`text-5xl font-light ${k.n === 3 ? "text-rose" : "text-maroon"}`}>{k.n}</div>
              <div className="mt-3 text-lg font-semibold text-navy">{k.title}</div>
              <p className="mt-2 text-sm text-slate">
                <span className="font-semibold text-navy">Earns: </span>
                {k.earns}.
              </p>
              <div className="mt-4 flex items-center justify-between border-t border-navy/10 pt-3 text-xs text-slate">
                <span>
                  <span className="text-base font-semibold text-navy">{count}</span> {unit} this session
                </span>
                <span className="flex gap-1">
                  {k.options.map((o) => (
                    <Tag key={o} o={o} fired={fired(o)} />
                  ))}
                </span>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Buyer value chain */}
      <section>
        <h2 className="text-3xl font-light tracking-tight text-navy">One storefront, and an RFP only when needed</h2>
        <Card className="mt-6 p-6">
          <Chain active="Buy" />
          <div className="grid items-center gap-4 md:grid-cols-[1fr_auto_1.1fr_auto_1.6fr_auto_1.1fr_auto_1fr]">
            <Node k="Plan" title="A staff need" fired={fired} />
            <Flow />
            <Node k="Buy" title="Ask or search" sub="one storefront" opts={[7, 1]} fired={fired} />
            <Flow />
            <div className="rounded-xl border border-dashed border-steel p-3">
              <div className="space-y-3">
                <Node title="Own contracts" sub="awarded locally" opts={[3, 2]} fired={fired} />
                <Node title="State and co-op" sub="contracts it can use" opts={[3]} fired={fired} />
                <Node title="GSA and resellers" sub="approved vendors" opts={[2]} fired={fired} />
                <Node title="No approval needed" sub="a box of pencils" opts={[5]} fired={fired} />
              </div>
              <div className="mt-2 text-center text-[10px] font-semibold uppercase tracking-[0.16em] text-slate">In the storefront</div>
            </div>
            <Flow />
            <Node k="Buy" title="Checkout" sub="PO or P-card" opts={[9]} fired={fired} />
            <Flow />
            <Node k="Pay" title="Pay" sub="into the ERP" fired={fired} />
          </div>
          <div className="mt-6 grid items-center gap-4 md:ml-[30%] md:grid-cols-[1fr_auto_1fr_auto_1fr]">
            <Node title="No contract yet" sub="rare: first to buy it" dashed fired={fired} />
            <Arrow className="mx-auto h-4 w-4 rotate-90 text-rose md:rotate-0" />
            <Node k="Source" title="New solicitation" sub="run in Sovra" opts={[8]} dashed fired={fired} />
            <Arrow className="mx-auto h-4 w-4 rotate-90 text-rose md:rotate-0" />
            <Node k="Contract" title="Award" sub="listed for others" opts={[2]} dashed fired={fired} />
          </div>
        </Card>
      </section>

      {/* Supplier loop */}
      <section>
        <h2 className="text-3xl font-light tracking-tight text-navy">A supplier's win becomes a listing</h2>
        <Card className="mt-6 p-6">
          <Chain active="Buy" />
          <div className="grid items-center gap-4 md:grid-cols-[1fr_auto_1fr_auto_1fr_auto_1fr_auto_1fr]">
            <Node k="Discover" title="Find bids" sub="on the network" opts={["E"]} fired={fired} />
            <Flow />
            <Node k="Win" title="Write the bid" sub="and submit it" fired={fired} />
            <Flow />
            <Node k="Contract" title="Win the award" fired={fired} />
            <Flow />
            <Node k="Position" title="Get listed" sub="in the storefront" opts={[2]} accent fired={fired} />
            <Flow />
            <Node k="Buy · Pay" title="Take orders" sub="and get paid" opts={[9, 5, 3]} accent fired={fired} />
          </div>
          <div className="mt-8 grid items-center gap-4 md:grid-cols-[1.4fr_1fr_auto_1fr]">
            <div className="flex items-center gap-2 text-sm font-semibold text-rose">
              <Arrow className="h-4 w-4 rotate-180" /> Signals point to the next solicitation
            </div>
            <Node k="Position" title="See unmet demand" sub={`${db.unmet.length} searches no contract covered`} opts={[6]} dashed fired={fired} />
            <Arrow className="mx-auto h-4 w-4 rotate-180 text-rose" />
            <Node k="Position" title="Reach more storefronts" sub={`${activeStorefronts} storefronts active`} opts={[4]} dashed fired={fired} />
          </div>
          <p className="mt-6 text-xs text-slate">Badges show the revenue option at each step; E is the existing Edge subscription. Filled badges have fired in this session.</p>
        </Card>
      </section>

      {/* Flywheel */}
      <section>
        <h2 className="text-3xl font-light tracking-tight text-navy">Every turn of the flywheel earns revenue</h2>
        <p className="mt-2 text-slate">Start at the top and follow the arrows clockwise. Each box shows what it has earned so far.</p>
        <div className="mt-8 grid items-center gap-6 lg:grid-cols-[1fr_minmax(0,400px)_1fr]">
          <div className="order-2 space-y-4 lg:order-1">
            <RevBox kind="Credit" title="Credit to the agency" sub="A share of spend fees offsets its cost" amount={-credits} credit opts={[]} fired={fired} />
            <RevBox title="Sourcing services" sub="Agency pays for each solicitation Sovra runs" amount={sum([8])} opts={[8]} fired={fired} />
            <RevBox title="Data products" sub="Demand signals and spend intelligence" amount={sum([6, 7])} opts={[6, 7]} fired={fired} />
          </div>
          <div className="order-1 lg:order-2">
            <Flywheel />
          </div>
          <div className="order-3 space-y-4">
            <RevBox title="Subscription" sub="Local government pays, less credits from fees" amount={sum([1])} opts={[1]} fired={fired} />
            <RevBox title="Supplier fees" sub="Listings in each storefront, plus partner apps" amount={sum([2, 10, 4])} opts={[2, 10, 4]} fired={fired} />
            <RevBox title="Fees on spend" sub="Order fees, card share, sponsored placement" amount={sum([3, 5, 9])} opts={[3, 5, 9]} fired={fired} />
          </div>
        </div>
        <div className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <Mini step="Start" label="Storefronts" value={activeStorefronts} />
          <Mini step="Step 2" label="Suppliers listed" value={listedSuppliers} />
          <Mini step="Step 3" label="Orders" value={db.orders.length} />
          <Mini step="Step 4" label="Requests captured" value={db.requests.length} />
          <Mini step="Step 5" label="Gaps filled" value={newSols.length + db.solicitations.filter((s) => s.awarded_listing_id).length} />
          <Mini step="Step 6" label="Credits to Riverbend" value={money(credits)} />
        </div>
      </section>

      {/* Five ways */}
      <section className="-mx-4 bg-navy px-4 py-14 text-white sm:rounded-3xl">
        <div className="mx-auto max-w-5xl">
          <h2 className="text-3xl font-light tracking-tight">Revenue per storefront adds up five ways</h2>
          <div className="mt-8 divide-y divide-white/10">
            {FIVE_WAYS.map((w, i) => (
              <div key={w.label} className="grid grid-cols-[2rem_1fr_auto] items-center gap-4 py-4 sm:grid-cols-[2rem_1fr_14rem_8rem]">
                <span className="text-2xl font-light text-rose">{i === 0 ? "" : "+"}</span>
                <span className="text-lg font-light sm:text-2xl">{w.label}</span>
                <span className="hidden text-right text-sm text-steel sm:block">
                  {w.who} · option{w.options.length > 1 ? "s" : ""} {w.options.join(", ")}
                </span>
                <span className="text-right text-lg font-semibold tabular-nums">{money(sum(w.options), false)}</span>
              </div>
            ))}
            <div className="grid grid-cols-[2rem_1fr_auto] items-center gap-4 pt-5 sm:grid-cols-[2rem_1fr_14rem_8rem]">
              <span className="text-2xl font-light text-rose">=</span>
              <span className="text-lg font-semibold sm:text-2xl">Riverbend storefront, this session</span>
              <span className="hidden sm:block" />
              <span className="text-right text-xl font-bold tabular-nums">{money(total, false)}</span>
            </div>
          </div>
          <p className="mt-8 max-w-3xl text-steel">
            Each turn of the flywheel grows the middle terms. Credits are only a share of spend fees, so Sovra's net take rises as spend grows, even as the agency's cost falls.
          </p>
        </div>
      </section>

      {/* Ten ways */}
      <section>
        <h2 className="text-3xl font-light tracking-tight text-navy">Ten ways to earn, and four fit inside Edge</h2>
        <Card className="mt-6 overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="bg-tint text-left text-[11px] uppercase tracking-wider text-slate">
              <tr>
                <th className="px-4 py-3">#</th>
                <th className="px-4 py-3">Option</th>
                <th className="px-4 py-3">Who pays</th>
                <th className="px-4 py-3">Edge tier</th>
                <th className="px-4 py-3 text-right">This session</th>
                <th className="px-4 py-3">Try it</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(REVENUE_OPTIONS).map(([k, def]) => {
                const o = Number(k);
                const evts = byOpt(o);
                return (
                  <tr key={k} className={`border-t border-navy/5 ${EDGE_TIER[o] ? "bg-navy-50/40" : ""}`}>
                    <td className="px-4 py-3">
                      <Tag o={o} fired={evts.length > 0} />
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-semibold text-navy">{def.name}</div>
                      <div className="text-xs text-slate">{def.rule}</div>
                    </td>
                    <td className="px-4 py-3 text-slate">{def.payer.replace("_", " ").replace(/^\w/, (c) => c.toUpperCase())}</td>
                    <td className="px-4 py-3 text-slate">{EDGE_TIER[o] ?? "—"}</td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      <span className="font-semibold text-navy">{money(evts.reduce((n, e) => n + e.amount, 0))}</span>
                      <div className="text-[11px] text-slate">{evts.length} event{evts.length === 1 ? "" : "s"}</div>
                    </td>
                    <td className="px-4 py-3">
                      <Link href={TRY[o].href} className="text-xs font-semibold text-maroon hover:underline">
                        {TRY[o].label} →
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
        <p className="mt-3 text-xs text-slate">Shaded rows fit Edge tiers. Option 6 covers what suppliers pay to manage their Procurated profile. Amounts are placeholders, not pricing proposals.</p>
      </section>
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.04] p-5">
      <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-steel">{label}</div>
      <div className="mt-2 text-3xl font-light tabular-nums">{value}</div>
      {sub && <div className="mt-1 text-xs text-steel">{sub}</div>}
    </div>
  );
}

function RevBox({ kind = "Revenue", title, sub, amount, opts, fired, credit }: { kind?: string; title: string; sub: string; amount: number; opts: number[]; fired: (o: number) => boolean; credit?: boolean }) {
  return (
    <div className={`relative rounded-xl bg-white p-4 ${credit ? "border border-dashed border-rose" : "border border-maroon/40"}`}>
      {opts.length > 0 && (
        <span className="absolute -right-2 -top-3 flex gap-0.5">
          {opts.map((o) => (
            <Tag key={o} o={o} fired={fired(o)} />
          ))}
        </span>
      )}
      <Eyebrow tone={credit ? "rose" : "maroon"}>{kind}</Eyebrow>
      <div className="mt-1 flex items-baseline justify-between gap-2">
        <span className="font-semibold text-navy">{title}</span>
        <span className={`font-semibold tabular-nums ${credit ? "text-emerald-700" : "text-navy"}`}>{money(amount)}</span>
      </div>
      <div className="text-xs text-slate">{sub}</div>
    </div>
  );
}

function Mini({ step, label, value }: { step: string; label: string; value: string | number }) {
  return (
    <div className="rounded-lg bg-white p-3 text-center shadow-card">
      <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-rose">{step}</div>
      <div className="mt-1 text-xl font-light text-navy tabular-nums">{value}</div>
      <div className="text-[11px] text-slate">{label}</div>
    </div>
  );
}

function Flywheel() {
  const steps = [
    ["Start", "More", "storefronts"],
    ["Step 2", "More", "suppliers"],
    ["Step 3", "More", "orders"],
    ["Step 4", "More", "data"],
    ["Step 5", "Gaps", "filled"],
    ["Step 6", "Lower", "net cost"],
  ];
  const C = 200;
  const R = 140;
  const pt = (deg: number, r = R) => [C + r * Math.cos((deg * Math.PI) / 180), C + r * Math.sin((deg * Math.PI) / 180)];
  return (
    <svg viewBox="0 0 400 400" className="mx-auto w-full max-w-[400px]" role="img" aria-label="Marketplace 2.0 flywheel: more storefronts, more suppliers, more orders, more data, gaps filled, lower net cost">
      <defs>
        <marker id="fw-arrow" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
          <path d="M0 0 10 5 0 10z" fill="#D06470" />
        </marker>
      </defs>
      <circle cx={C} cy={C} r={R} fill="none" stroke="#E3E7EF" strokeWidth="16" />
      {steps.map((_, i) => {
        const a1 = -90 + i * 60 + 24;
        const a2 = -90 + (i + 1) * 60 - 24;
        const [x1, y1] = pt(a1);
        const [x2, y2] = pt(a2);
        return <path key={i} d={`M${x1} ${y1} A${R} ${R} 0 0 1 ${x2} ${y2}`} fill="none" stroke="#D06470" strokeWidth="3.5" markerEnd="url(#fw-arrow)" />;
      })}
      <text x={C} y={C + 5} textAnchor="middle" className="fill-navy" style={{ fontSize: 15, fontWeight: 300 }}>
        Marketplace 2.0
      </text>
      {steps.map(([k, a, b], i) => {
        const [x, y] = pt(-90 + i * 60);
        return (
          <g key={k}>
            <circle cx={x} cy={y} r="44" fill="#14213D" />
            <text x={x} y={y - 12} textAnchor="middle" fill="#D06470" style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1 }}>
              {k.toUpperCase()}
            </text>
            <text x={x} y={y + 4} textAnchor="middle" fill="#fff" style={{ fontSize: 12.5, fontWeight: 600 }}>
              {a}
            </text>
            <text x={x} y={y + 19} textAnchor="middle" fill="#fff" style={{ fontSize: 12.5, fontWeight: 600 }}>
              {b}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
