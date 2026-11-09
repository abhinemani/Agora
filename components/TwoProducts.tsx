import Link from "next/link";

/** The two things sold on top of the free marketplace, side by side, so the
 * names never blur: a city marketplace is for an agency, a storefront is for a
 * supplier. */
export function TwoProducts({ dark = false }: { dark?: boolean }) {
  const items = [
    {
      eyebrow: "For agencies",
      title: "City marketplace",
      body: "A white-labeled Agora for one city, county, or district: its own contracts, rules, approvals and brand, for its own staff.",
      price: "Subscription paid by the agency",
      href: "/marketplaces",
      cta: "See city marketplaces",
      color: "#315BD0",
    },
    {
      eyebrow: "For suppliers",
      title: "Storefront",
      body: "A supplier's own page in Agora: its catalog, contracts, certifications, and reviews, shown to every agency allowed to buy from it.",
      price: "Basic page free; featured storefront on the Edge Position supplier plan",
      href: "/storefronts",
      cta: "Browse storefronts",
      color: "#167757",
    },
  ];
  return (
    <section className={dark ? "" : "rounded-3xl border border-line bg-white p-6 sm:p-8"}>
      {!dark && (
        <>
          <h2 className="text-xl font-extrabold tracking-tight text-navy">Two products on one marketplace</h2>
          <p className="mt-1 text-sm text-slate">Searching Agora is free. Agencies and suppliers each pay for their own presence on it.</p>
        </>
      )}
      <div className={`grid gap-4 md:grid-cols-2 ${dark ? "" : "mt-5"}`}>
        {items.map((i) => (
          <Link
            key={i.title}
            href={i.href}
            className={`flex flex-col rounded-2xl p-5 transition ${dark ? "bg-white/10 ring-1 ring-white/15 hover:bg-white/15" : "border border-line hover:border-[#bbcae8]"}`}
          >
            <div className="text-[11px] font-extrabold uppercase tracking-[0.16em]" style={{ color: dark ? "rgba(255,255,255,0.6)" : i.color }}>
              {i.eyebrow}
            </div>
            <div className={`mt-2 text-lg font-bold tracking-tight ${dark ? "text-white" : "text-navy"}`}>{i.title}</div>
            <p className={`mt-1 text-sm leading-relaxed ${dark ? "text-white/75" : "text-slate"}`}>{i.body}</p>
            <div className={`mt-3 text-xs ${dark ? "text-white/60" : "text-slate"}`}>{i.price}</div>
            <div className={`mt-4 text-sm font-semibold ${dark ? "text-white" : "text-maroon"}`}>{i.cta} →</div>
          </Link>
        ))}
      </div>
    </section>
  );
}
