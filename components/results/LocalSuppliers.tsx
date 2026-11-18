"use client";

// The results page's suppliers for a service request: those whose service listings offer it where the
// request or the buyer is. Copy is formal and third-person, as on the rest of the results page.

import Link from "next/link";
import { Badge, money } from "@/components/ui";
import type { LocalSupplierHit } from "@/lib/service-listing";

const shortDate = (d: string) => new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

const CERT: Record<LocalSupplierHit["certifications"][number]["status"], { tone: "green" | "neutral" | "amber"; text: string }> = {
  confirmed: { tone: "green", text: "confirmed" },
  self_reported: { tone: "neutral", text: "self-reported" },
  not_listed: { tone: "amber", text: "not on the registry" },
  not_found: { tone: "amber", text: "company not found on the registry" },
  unreachable: { tone: "neutral", text: "self-reported; registry not reached" },
};

export function LocalSuppliers({ data, texas }: { data: { hits: LocalSupplierHit[]; place: string | null; source: string | null }; texas: boolean }) {
  if (!data.hits.length) return null;
  return (
    <section id="local-suppliers" aria-labelledby="local-suppliers-heading" className="scroll-mt-24 border-y-2 border-base-lighter bg-white py-6">
      <h2 id="local-suppliers-heading" className="text-lg font-bold tracking-tight text-navy">
        Suppliers that list this service{data.place ? ` in ${data.place}` : ""}
      </h2>
      <p className="mt-1 max-w-3xl text-sm text-slate">
        From the suppliers' own service listings, priced by quote unless a package price is shown.
        {data.source ? ` The area is ${data.source}.` : " No place was named and no agency is selected, so each supplier's own area is shown."} Past work is as each supplier reports it; Agora
        matches each government named against its directory, and checks certifications against the issuing registry where it can.
      </p>
      {texas && (
        <p className="mt-2 max-w-3xl text-ui-2xs text-base-dark">
          Texas municipalities buying from $3,000 to $100,000 must contact two historically underutilized businesses. The Comptroller now certifies HUBs as VetHUB, for businesses
          owned by Texas service-disabled veterans; a small business flag on the Comptroller's bidders list (CMBL) is not a HUB certification.
        </p>
      )}
      <ul className="mt-4 grid gap-2 lg:grid-cols-2">
        {data.hits.map((h) => (
          <li key={h.supplier_id} className="flex flex-col rounded-lg border-2 border-base-lighter bg-white p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <Link href={`/storefronts/${h.supplier_id}`} className="text-[15px] font-bold text-navy hover:text-maroon">
                {h.name}
              </Link>
              <span className="text-xs text-slate">
                {h.city ? `${h.city}, ${h.state}` : h.state}
              </span>
            </div>
            <div className="mt-1 text-sm text-navy">
              {h.service.name}
              <span className="text-slate"> · {h.service.price ? `${money(h.service.price.amount)} / ${h.service.price.unit}` : "priced by quote"}</span>
            </div>
            {h.area && (
              <div className="mt-1 text-xs text-slate">
                Works in {h.area.counties.slice(0, 6).join(", ")}
                {h.area.counties.length > 6 ? ` and ${h.area.counties.length - 6} more` : ""} {h.area.counties.length === 1 ? "County" : "counties"}, {h.area.state}
              </div>
            )}
            <div className="mt-2 flex flex-wrap gap-1.5">
              {h.certifications.map((c) => (
                <span key={c.label} title={c.checked_at ? `Checked ${shortDate(c.checked_at)}` : "As the supplier reports it"}>
                  <Badge tone={CERT[c.status].tone}>
                    {c.label}: {CERT[c.status].text}
                  </Badge>
                </span>
              ))}
            </div>
            {h.past_work.total > 0 && (
              <div className="mt-2 text-xs text-slate">
                {h.past_work.total} public job{h.past_work.total === 1 ? "" : "s"} listed; {h.past_work.matched} matched to a government in Agora's directory
                {data.place && h.past_work.nearby ? `, ${h.past_work.nearby} in this area` : ""}.
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
