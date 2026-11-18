"use client";

// A storefront's service listing: services, where the supplier works, the public work it reports (each
// government matched against Agora's directory) and the certifications it claims (checked live where Agora can).

import { Badge, Card, money } from "@/components/ui";
import { CERTIFICATION_KINDS, CMBL_SEARCH_URL } from "@/lib/service-listing";
import type { CertificationClaim, Supplier } from "@/lib/types";

const date = (d: string) => new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
const TYPE: Record<string, string> = { municipality: "city or town", county: "county", school_district: "school district", special_district: "special district", state_agency: "state agency", college: "college", township: "township" };

export function hasServiceListing(s: Supplier) {
  return Boolean(s.services?.length || s.service_area || s.past_work?.length || s.certification_claims?.length);
}

export function ServiceListingView({ s }: { s: Supplier }) {
  if (!hasServiceListing(s)) return null;
  const work = s.past_work ?? [];
  const matched = work.filter((w) => w.match).length;
  return (
    <section id="services" className="scroll-mt-24 space-y-8">
      {(s.services?.length || s.service_area) && (
        <div className="grid gap-8 lg:grid-cols-[1.4fr_1fr]">
          <div>
            <h2 className="text-xl font-extrabold tracking-tight text-navy">Services</h2>
            <ul className="mt-3 grid gap-2 sm:grid-cols-2">
              {(s.services ?? []).map((x) => (
                <li key={x.id} className="rounded-xl border border-line bg-white p-3">
                  <div className="text-sm font-semibold text-navy">{x.name}</div>
                  {x.detail && <p className="mt-1 text-xs text-slate">{x.detail}</p>}
                  <div className="mt-2 text-xs font-semibold text-navy">{x.price ? `${money(x.price.amount)} / ${x.price.unit}` : "Priced by quote"}</div>
                </li>
              ))}
            </ul>
          </div>
          {s.service_area && (
            <div>
              <h2 className="text-xl font-extrabold tracking-tight text-navy">Where it works</h2>
              <p className="mt-1 text-sm text-slate">
                {s.service_area.counties.length} {s.service_area.counties.length === 1 ? "county" : "counties"} in {s.service_area.state}, as the supplier lists them.
              </p>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {s.service_area.counties.map((c) => (
                  <span key={c} className="rounded-full border border-line bg-white px-3 py-1 text-xs text-navy">
                    {c}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {work.length > 0 && (
        <div>
          <h2 className="text-xl font-extrabold tracking-tight text-navy">Past public work</h2>
          <p className="mt-1 max-w-3xl text-sm text-slate">
            As {s.name} reports it. Agora matched {matched} of {work.length} government{work.length === 1 ? "" : "s"} named to a record in its government directory; a match confirms
            the government exists, not the work itself.
          </p>
          <Card className="mt-3 divide-y divide-base-lighter">
            {work.map((w) => (
              <div key={w.id} className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold text-navy">{w.what}</div>
                  <div className="mt-0.5 text-xs text-slate">
                    {w.agency}, {w.state}
                    {w.year ? ` · ${w.year}` : ""}
                    {w.url && (
                      <>
                        {" · "}
                        <a href={w.url} target="_blank" rel="noreferrer" className="font-semibold text-maroon hover:underline">
                          Award record ↗
                        </a>
                      </>
                    )}
                  </div>
                </div>
                {w.match ? (
                  <span title={`Directory record ${w.match.directory_id}`}>
                    <Badge tone="green">
                      In directory: {TYPE[w.match.entity_type] ?? w.match.entity_type}
                      {w.match.county ? `, ${w.match.county.replace(/\//g, " / ")} ${w.match.county.includes("/") ? "counties" : "County"}` : ""}
                    </Badge>
                  </span>
                ) : (
                  <Badge tone="amber">Not found in Agora's directory</Badge>
                )}
              </div>
            ))}
          </Card>
        </div>
      )}

      {(s.certification_claims?.length ?? 0) > 0 && (
        <div>
          <h2 className="text-xl font-extrabold tracking-tight text-navy">Certifications</h2>
          <p className="mt-1 max-w-3xl text-sm text-slate">Each as {s.name} claims it, with what the issuing registry showed when Agora last checked.</p>
          <ul className="mt-3 grid gap-2 md:grid-cols-2">
            {s.certification_claims!.map((c) => (
              <li key={c.id} className="rounded-xl border border-line bg-white p-4">
                <CertificationLine c={c} />
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

const STATUS = {
  confirmed: { tone: "green", text: "Confirmed" },
  not_listed: { tone: "amber", text: "Not on the registry" },
  not_found: { tone: "amber", text: "Company not found" },
  unreachable: { tone: "neutral", text: "Registry not reached" },
} as const;

export function CertificationLine({ c }: { c: CertificationClaim }) {
  const k = CERTIFICATION_KINDS[c.kind];
  const st = c.check ? STATUS[c.check.status] : null;
  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-semibold text-navy">{c.label}</span>
        {st ? <Badge tone={st.tone}>{st.text}</Badge> : <Badge>Self-reported</Badge>}
      </div>
      <div className="mt-0.5 text-xs text-slate">{c.issuer}</div>
      {c.check ? (
        <p className="mt-2 text-xs text-navy">
          {c.check.listed
            ? `${c.check.source} lists ${c.check.listed.name}${c.check.listed.city ? `, ${c.check.listed.city}` : ""}: small business ${c.check.listed.small_business === null ? "not shown" : c.check.listed.small_business ? "yes" : "no"}, CMBL ${c.check.listed.cmbl ?? "not shown"}, VetHUB ${c.check.listed.vethub ?? "not shown"}.`
            : c.check.note}{" "}
          {c.check.listed && c.check.note ? `${c.check.note} ` : ""}
          Checked {date(c.check.checked_at)}.{" "}
          <a href={CMBL_SEARCH_URL} target="_blank" rel="noreferrer" className="font-semibold text-maroon hover:underline">
            The directory ↗
          </a>
        </p>
      ) : (
        <p className="mt-2 text-xs text-slate">{k.checkable ? "Not checked against the registry yet." : k.note}</p>
      )}
    </div>
  );
}
