"use client";

import { Check, File, Lock } from "@/components/icons";
import { BuyerPicker } from "@/components/BuyerPicker";
import { useStore } from "@/components/store";
import { Badge, Card, Loading, PageTitle, SectionLabel } from "@/components/ui";
import type { Contract } from "@/lib/types";
import { checkEligibility, stateName } from "@/lib/vehicles";
import { useState } from "react";

const BASIS: Record<NonNullable<Contract["pricing_basis"]>, string> = {
  published_price: "Published prices",
  discount_from_list: "Discount off list; quote required",
  quote: "Quote only; no price file loaded",
};

const GROUPS: { title: string; blurb: string; test: (c: Contract) => boolean }[] = [
  { title: "State contracts", blurb: "Awarded by a state; open to that state's agencies and, usually, its local governments.", test: (c) => c.source === "state_contract" },
  { title: "Cooperative contracts", blurb: "Awarded once by a co-op and open to members nationwide.", test: (c) => c.source === "coop_contract" || c.source === "gsa" },
  { title: "Resellers", blurb: "Resellers on master agreements adopted by participating states and co-ops.", test: (c) => c.source === "reseller" },
  { title: "Agency contracts", blurb: "An agency's own awards, sometimes open to others by piggyback.", test: (c) => c.source === "own_contract" },
];

export default function Vehicles() {
  const { db } = useStore();
  const [changing, setChanging] = useState(false);
  if (!db) return <Loading />;
  const buyer = db.session.buyer;
  const count = (c: Contract) => {
    const ls = db.listings.filter((l) => l.contract_id === c.id);
    return { listings: ls.length, products: new Set(ls.map((l) => l.family ?? l.id)).size };
  };

  return (
    <div className="space-y-8">
      <PageTitle eyebrow="Contract vehicles" title="Every contract in Agora">
        Which contracts are loaded, who may use each one, how prices are set, and how far each has been verified.
        {buyer ? (
          <>
            {" "}
            Showing access for <span className="font-semibold text-navy">{buyer.name}</span>, {stateName(buyer.state)}.{" "}
            <button onClick={() => setChanging(!changing)} className="font-semibold text-maroon hover:underline">
              {changing ? "Cancel" : "Change"}
            </button>
          </>
        ) : null}
      </PageTitle>
      {changing && <BuyerPicker onDone={() => setChanging(false)} />}

      {GROUPS.map((g) => {
        const contracts = db.contracts.filter(g.test);
        if (!contracts.length) return null;
        return (
          <section key={g.title}>
            <SectionLabel>{g.title}</SectionLabel>
            <p className="-mt-1 mb-3 text-sm text-slate">{g.blurb}</p>
            <Card className="divide-y divide-navy/5">
              {contracts.map((c) => {
                const supplier = db.suppliers.find((s) => s.id === c.supplier_id);
                const access = checkEligibility(c, buyer);
                const n = count(c);
                const v = c.verification ?? "demo";
                return (
                  <div key={c.id} className="grid gap-3 p-4 sm:grid-cols-[1.6fr_1.4fr_auto] sm:items-center">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold text-navy">{c.vehicle ?? c.owner}</span>
                        <span className="font-mono text-xs text-slate">{c.contract_number}</span>
                      </div>
                      <div className="text-sm text-navy">
                        {supplier?.name} · {c.title}
                      </div>
                      <div className="text-xs text-slate">
                        {c.owner}
                        {c.master_agreement ? ` · adopted from ${c.master_agreement}` : ""}
                      </div>
                    </div>
                    <div className="text-xs text-slate">
                      <div>{c.eligibility ? `Open to ${c.eligibility.note}` : "Open to the agency that holds it"}</div>
                      {c.eligibility?.requires && <div>Requires: {c.eligibility.requires}</div>}
                      <div className="mt-1">
                        {BASIS[c.pricing_basis ?? "published_price"]}
                        {n.listings > 0 ? ` · ${n.products.toLocaleString()} products, ${n.listings.toLocaleString()} prices` : " · no line items loaded"}
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 sm:flex-col sm:items-end">
                      {c.end && c.end < new Date().toISOString().slice(0, 10) && <span className="text-xs font-semibold text-maroon">Expired {c.end}</span>}
                      {buyer && (
                        <span
                          className={`inline-flex items-center gap-1 text-xs font-semibold ${!access.eligible ? "text-maroon" : v === "research_lead" ? "text-amber-800" : "text-emerald-800"}`}
                        >
                          {access.eligible ? <Check className="h-3.5 w-3.5" /> : <Lock className="h-3.5 w-3.5" />}
                          {!access.eligible ? "Not open to you" : v === "research_lead" ? "Likely open: verify" : "Open to you"}
                        </span>
                      )}
                      <Badge tone={v === "source_document" ? "green" : v === "research_lead" ? "amber" : "neutral"}>
                        {v === "source_document" ? "Source document" : v === "research_lead" ? "Research lead" : "Demo data"}
                      </Badge>
                      {c.source_url && (
                        <a href={c.source_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs font-semibold text-maroon hover:underline">
                          <File className="h-3.5 w-3.5" /> Source
                        </a>
                      )}
                    </div>
                  </div>
                );
              })}
            </Card>
          </section>
        );
      })}
      <p className="text-xs text-slate">
        Source document: prices read from the awarded price file. Research lead: the vehicle was located in research and its terms still need checking against the source.
        Demo data: invented for the Riverbend demo.
      </p>
    </div>
  );
}
