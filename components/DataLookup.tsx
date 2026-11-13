"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Buyer, DirectoryGovernment, MembershipEvidence } from "@/lib/types";
import { ENTITY_LABEL, stateName } from "@/lib/vehicles";
import { DirectorySearch } from "./DirectorySearch";
import { useStore } from "./store";
import { Button, Card, ErrorNote } from "./ui";

const EVIDENCE: Record<MembershipEvidence, { label: string; tone: string }> = {
  purchase: { label: "Bought through it", tone: "bg-success-lighter text-success-darker" },
  agency: { label: "Agency names it", tone: "bg-info-lighter text-info-darker" },
  roster: { label: "On published roster", tone: "bg-base-lightest text-base-darker" },
  list: { label: "On a member list", tone: "bg-base-lightest text-base-darker" },
};

const usd = (x: number) => (x >= 1e6 ? `$${(x / 1e6).toFixed(1)}M` : `$${Math.round(x).toLocaleString()}`);

const EXAMPLES: [string, string][] = [
  ["gov_tx_plano-isd", "Plano ISD"],
  ["gov_ks_lawrence", "City of Lawrence, KS"],
  ["gov_co_crested-butte", "Town of Crested Butte"],
  ["gov_fl_ocala", "City of Ocala"],
  ["gov_ny_deruyter-village", "Village of DeRuyter, NY"],
];

const WEB_SOURCE = { gov: ".gov registry", census: "Census of Governments", nces: "NCES", ipeds: "IPEDS" } as const;

/** A government's permanent federal IDs, and where its website came from. */
function FederalIds({ gov }: { gov: DirectoryGovernment }) {
  const ids = gov.ids ?? {};
  const items: React.ReactNode[] = [];
  if (ids.census) items.push(<span key="c">Census of Governments ID {ids.census}</span>);
  if (ids.nces)
    items.push(
      <a key="n" href={`https://nces.ed.gov/ccd/districtsearch/district_detail.asp?ID2=${ids.nces}`} target="_blank" rel="noreferrer" className="text-primary">
        NCES district {ids.nces} ↗
      </a>,
    );
  if (ids.ipeds)
    items.push(
      <a key="u" href={`https://nces.ed.gov/collegenavigator/?id=${ids.ipeds}`} target="_blank" rel="noreferrer" className="text-primary">
        IPEDS {ids.ipeds} ↗
      </a>,
    );
  return (
    <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-ui-3xs text-base-dark">
      {items.length ? items : <span>No federal ID matched yet</span>}
      {gov.domain && (
        <a href={`https://${gov.domain}`} target="_blank" rel="noreferrer" className="text-primary">
          {gov.domain} ↗{gov.domain_source ? <span className="text-base-dark"> (from {WEB_SOURCE[gov.domain_source]})</span> : null}
        </a>
      )}
    </div>
  );
}

/** /data: look a government up in the co-op directory, and optionally search as it. */
export function DataLookup() {
  const { db, act } = useStore();
  const router = useRouter();
  const [gov, setGov] = useState<DirectoryGovernment | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const coopName = (id: string) => db?.coops.find((c) => c.id === id)?.name ?? id;

  const searchAs = async (g: DirectoryGovernment) => {
    setBusy(true);
    setError(null);
    try {
      await act<Buyer>("setBuyer", { buyer: { name: g.name, state: g.state, entity_type: g.entity_type, population: null, domain: g.domain, directory_id: g.id } });
      router.push("/");
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  const loadExample = async (id: string) => {
    const res = await fetch(`/api/directory?id=${id}`);
    if (res.ok) setGov((await res.json()).government);
  };

  return (
    <div className="space-y-4">
      <div className="max-w-xl">
        <DirectorySearch label="Agency" placeholder="Try Plano, Crested Butte or Marin County" onPick={setGov} />
        <div className="mt-2 flex flex-wrap gap-x-3 text-ui-3xs text-base-dark">
          Examples:
          {EXAMPLES.map(([id, label]) => (
            <button key={id} className="font-bold text-primary underline" onClick={() => loadExample(id)}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {gov && (
        <Card className="p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="font-heading text-heading-sm font-bold text-ink">{gov.name}</div>
              <div className="mt-1 text-ui-xs text-base-dark">
                {ENTITY_LABEL[gov.entity_type]} · {gov.city && gov.city !== gov.name ? `${gov.city}, ` : ""}
                {stateName(gov.state)}
                {gov.county ? ` · ${gov.county} County` : ""}
                {gov.population ? ` · pop. ${gov.population.toLocaleString()}` : ""}
                {gov.enrollment ? ` · ${gov.enrollment.toLocaleString()} students` : ""}
                {gov.status === "inferred" && " · public status inferred from its name"}
              </div>
              {gov.aliases.length > 0 && <div className="mt-1 text-ui-3xs text-base-dark">Also published as {gov.aliases.map((a) => `“${a}”`).join(", ")}</div>}
              <FederalIds gov={gov} />
            </div>
            <Button disabled={busy} onClick={() => searchAs(gov)}>
              Search as {gov.name.length > 28 ? "this agency" : gov.name}
            </Button>
          </div>

          <div className="mt-5 grid gap-5 sm:grid-cols-2">
            <div>
              <div className="text-ui-3xs uppercase tracking-label text-base-dark">Co-ops ({gov.coops.length})</div>
              {gov.coops.length ? (
                <ul className="mt-2 space-y-1.5">
                  {gov.coops.map((c) => (
                    <li key={c.coop_id} className="flex flex-wrap items-center gap-2 text-ui-xs">
                      <span className="font-bold text-ink">{coopName(c.coop_id)}</span>
                      <span className={`rounded-full px-2 py-0.5 text-ui-3xs font-bold ${EVIDENCE[c.evidence].tone}`}>{EVIDENCE[c.evidence].label}</span>
                      {c.member_id && <span className="text-ui-3xs text-base-dark">member #{c.member_id}</span>}
                      {c.source_url && (
                        <a href={c.source_url} target="_blank" rel="noreferrer" className="text-ui-3xs font-bold text-primary">
                          source ↗
                        </a>
                      )}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2 text-ui-xs text-base-darker">None found on the rosters Agora holds, so every co-op shows under &quot;Co-ops you could join.&quot;</p>
              )}
            </div>
            <div className="space-y-4">
              {Object.keys(gov.routes).length > 0 && (
                <div>
                  <div className="text-ui-3xs uppercase tracking-label text-base-dark">Other routes</div>
                  <ul className="mt-2 space-y-1.5">
                    {Object.entries(gov.routes).map(([r, e]) => (
                      <li key={r} className="flex items-center gap-2 text-ui-xs">
                        <span className="font-bold text-ink">{r}</span>
                        <span className={`rounded-full px-2 py-0.5 text-ui-3xs font-bold ${EVIDENCE[e].tone}`}>{EVIDENCE[e].label}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {gov.dir && (
                <div>
                  <div className="text-ui-3xs uppercase tracking-label text-base-dark">Texas DIR</div>
                  <p className="mt-1 text-ui-xs text-ink">
                    <span className="font-bold">{usd(gov.dir.sales)}</span> reported across {gov.dir.lines.toLocaleString()} line items, {gov.dir.first} to {gov.dir.last}
                  </p>
                </div>
              )}
              {gov.purchases?.map((p) => (
                <div key={`${p.date}${p.contract}${p.category}`}>
                  <div className="text-ui-3xs uppercase tracking-label text-base-dark">Documented purchase</div>
                  <p className="mt-1 text-ui-xs text-ink">
                    {p.route}: {p.supplier ? `${p.supplier}, ` : ""}
                    {p.category}
                    {p.amount ? `, ${usd(p.amount)}` : ""} · {p.status}, {p.date}{" "}
                    {p.url && (
                      <a href={p.url} target="_blank" rel="noreferrer" className="font-bold text-primary">
                        source ↗
                      </a>
                    )}
                  </p>
                </div>
              ))}
            </div>
          </div>
          <p className="mt-5 text-ui-3xs text-base-dark">Sources: {gov.sources.join(", ")}.</p>
          <ErrorNote message={error} />
        </Card>
      )}
    </div>
  );
}
