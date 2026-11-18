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
    },
    {
      eyebrow: "For suppliers",
      title: "Storefront",
      body: "A supplier's own page in Agora: its catalog, contracts, certifications, and reviews, shown to every agency allowed to buy from it.",
      price: "Basic page free; featured storefront on the Edge Position supplier plan",
      href: "/storefronts",
      cta: "Browse storefronts",
    },
  ];
  return (
    <section className={dark ? "" : "border border-base-lighter bg-white p-6 sm:p-8"}>
      {!dark && (
        <>
          <h2 className="text-xl font-bold tracking-tight text-ink">Two products on one marketplace</h2>
          <p className="mt-1 text-sm text-slate">Searching Agora is free. Agencies and suppliers each pay for their own presence on it.</p>
        </>
      )}
      <div className={`grid gap-4 md:grid-cols-2 ${dark ? "" : "mt-5"}`}>
        {items.map((i) => (
          <Link
            key={i.title}
            href={i.href}
            className={`flex flex-col p-5 no-underline transition ${dark ? "border border-[rgba(255,255,255,0.25)] bg-[#0F3D73] hover:border-[rgba(255,255,255,0.6)]" : "border border-base-lighter hover:border-primary-light"}`}
          >
            <div className={`font-mono text-[11px] uppercase tracking-[0.14em] ${dark ? "text-[#A8CBF2]" : "text-primary"}`}>{i.eyebrow}</div>
            <div className={`mt-2 text-lg font-bold tracking-tight ${dark ? "text-[#fff]" : "text-ink"}`}>{i.title}</div>
            <p className={`mt-1 text-sm leading-relaxed ${dark ? "text-[#D3E3F6]" : "text-base-dark"}`}>{i.body}</p>
            <div className={`mt-3 text-xs ${dark ? "text-[#BFD5EE]" : "text-base-dark"}`}>{i.price}</div>
            <div className={`mt-4 text-sm font-semibold ${dark ? "text-[#fff]" : "text-primary"}`}>{i.cta} →</div>
          </Link>
        ))}
      </div>
    </section>
  );
}
