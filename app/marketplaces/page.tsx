import Link from "next/link";
import { TwoProducts } from "@/components/TwoProducts";

const MARKETPLACES = [
  { name: "City of Riverbend", where: "Oregon · pop. 85,000", href: "/marketplaces/riverbend", live: true, blurb: "Own contracts, a $10K quick-buy limit, renewals and reorders.", color: "#315BD0" },
  { name: "Harper County", where: "Texas · pop. 210,000", live: false, blurb: "County fleet, public safety, and courts.", color: "#167757" },
  { name: "Town of Millbrook", where: "New Jersey · pop. 18,000", live: false, blurb: "A small town buying mostly off NJSTART.", color: "#B45309" },
  { name: "Lakeview School District", where: "Ohio · 12 schools", live: false, blurb: "Classroom tech, facilities, and food service.", color: "#7C3AED" },
];

const INCLUDED = [
  ["Its own address and brand", "A marketplace at the city's own address, in its colors, that staff use instead of the public Agora search."],
  ["Its contracts first", "The city's own awards alongside the state and co-op contracts it may use, with the rest hidden."],
  ["Its rules", "Quick-buy limits, approvals, preferred suppliers, and local or MBE preferences applied on every search."],
  ["Its calendar", "Renewals coming due, reorders, and capital-plan purchases on one page."],
];

export default function Marketplaces() {
  return (
    <div className="space-y-12 pb-8">
      <div className="max-w-2xl pt-6">
        <div className="text-[11px] font-extrabold uppercase text-maroon/80">City marketplaces</div>
        <h1 className="mt-3 text-[clamp(2rem,4vw,2.8rem)] font-extrabold leading-[1.1] text-navy">Agora, as your city's own marketplace.</h1>
        <p className="mt-3 text-base leading-relaxed text-slate">
          Anyone can search Agora for free. A city marketplace is a white-labeled Agora that a city, county, or district runs for its own staff: its contracts, its rules, its
          brand, on top of the same shared catalog.
        </p>
      </div>

      <section className="grid gap-4 sm:grid-cols-2">
        {MARKETPLACES.map((s) => {
          const body = (
            <>
              <div className="flex items-start justify-between gap-3">
                <span className="grid h-11 w-11 place-items-center rounded-xl text-lg font-extrabold text-[#fff]" style={{ background: s.color }}>
                  {s.name.replace(/^(City|Town) of /, "")[0]}
                </span>
                <span className={`rounded-md px-2 py-1 text-[10px] font-bold ${s.live ? "bg-success-lighter text-success-darker" : "bg-primary-lighter text-base-dark"}`}>{s.live ? "Live" : "Available"}</span>
              </div>
              <div className="mt-5 text-lg font-bold tracking-tight text-navy">{s.name}</div>
              <div className="text-xs text-slate">{s.where}</div>
              <p className="mt-2 text-sm text-slate">{s.blurb}</p>
              <div className="mt-auto border-t border-base-lighter pt-3 text-sm font-semibold text-maroon">{s.live ? "Open marketplace →" : "Demo on request"}</div>
            </>
          );
          return s.href ? (
            <Link key={s.name} href={s.href} className="flex min-h-[220px] flex-col rounded-2xl border border-line bg-white p-5 transition hover:border-base-dark">
              {body}
            </Link>
          ) : (
            <div key={s.name} className="flex min-h-[220px] flex-col rounded-2xl border border-dashed border-line bg-white/60 p-5">
              {body}
            </div>
          );
        })}
      </section>

      <section className="rounded-3xl border border-line bg-white p-6 sm:p-8">
        <h2 className="text-xl font-extrabold tracking-tight text-navy">What a city marketplace includes</h2>
        <div className="mt-5 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {INCLUDED.map(([t, d]) => (
            <div key={t}>
              <div className="text-sm font-bold text-navy">{t}</div>
              <p className="mt-1 text-sm leading-relaxed text-slate">{d}</p>
            </div>
          ))}
        </div>
      </section>

      <TwoProducts />
    </div>
  );
}
