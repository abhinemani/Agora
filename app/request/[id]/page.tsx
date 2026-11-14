"use client";

import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { BuyerPicker } from "@/components/BuyerPicker";
import { CatalogProducts } from "@/components/CatalogProducts";
import { CoopContracts, GsaContracts, StateContracts, coopCounts } from "@/components/CoopSection";
import { ExpiredNote, InviteAdminBanner, NextSteps, OwnContractsCard } from "@/components/ResultExtras";
import { Shopper } from "@/components/Shopper";
import { Fold, FoldGroup } from "@/components/results/Fold";
import { OptionsTable } from "@/components/results/OptionsTable";
import { RequestSummary } from "@/components/results/RequestSummary";
import { shopperApplies, shopperRefs } from "@/lib/shopper";
import { useStore } from "@/components/store";
import { Lock, People, Plus } from "@/components/icons";
import { Badge, Button, Card, Checkbox, ErrorNote, Eyebrow, IconCircle, Loading, RevenueTags, Stars, money } from "@/components/ui";
import { verificationSummary } from "@/lib/verification";
import { goHref } from "@/lib/coops";
import { contractHref } from "@/components/ContractBits";
import type { ContractLead, Results, Unavailable } from "@/lib/assistant";
import { PURCHASE_KINDS } from "@/lib/revenue_rules";

function KindBanner({ kind }: { kind: (typeof PURCHASE_KINDS)[keyof typeof PURCHASE_KINDS] }) {
  return (
    <div className={`flex flex-wrap items-center gap-4 rounded-xl px-5 py-3 ${kind.n === 3 ? "border border-dashed border-rose bg-white" : "bg-white shadow-card"}`}>
      <span className={`text-3xl font-light ${kind.n === 3 ? "text-rose" : "text-maroon"}`}>{kind.n}</span>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold text-navy">{kind.title}</div>
        <div className="text-xs text-slate">
          <span className="font-semibold">Earns:</span> {kind.earns}.
        </div>
      </div>
      <RevenueTags options={kind.options} size="md" />
    </div>
  );
}

/** Cards shown before "Show all"; large catalogs can match dozens. */
const GRID_LIMIT = 9;

export default function RequestResults() {
  const { id } = useParams<{ id: string }>();
  const ask = useSearchParams().get("ask") === "1";
  const { db, act, showEarn } = useStore();
  const [results, setResults] = useState<Results | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [answered, setAnswered] = useState(false);
  const [why, setWhy] = useState(false);
  const [verifiedOnly, setVerifiedOnly] = useState(false);
  const [changing, setChanging] = useState(false);

  const request = db?.requests.find((r) => r.id === id);
  const buyer = db?.session.buyer ?? null;
  // Agora searches every contract by default; the agency is optional.
  const needsBuyer = false;
  // Riverbend's preference policy is the only one on file, so only its buyers are asked.
  const isHome = buyer?.name === db?.agency.name;
  const needsAnswer = !needsBuyer && isHome && ask && !answered && request && (request.preference_answer === null || request.preference_answer === "always_ask");
  const buyerKey = buyer ? `${buyer.name}|${buyer.state}|${buyer.entity_type}|${buyer.population}` : "";

  // A different buyer can use different contracts: fetch fresh results.
  useEffect(() => {
    setResults(null);
    setError(null);
  }, [buyerKey]);

  const load = useCallback(async () => {
    try {
      setResults(await act<Results>("getResults", { requestId: id }));
    } catch (e) {
      setError((e as Error).message);
    }
  }, [act, id]);

  useEffect(() => {
    if (db && request && !needsBuyer && !needsAnswer && !results && !error) load();
  }, [db, request, needsBuyer, needsAnswer, results, error, load]);

  if (!db) return <Loading />;
  if (!request) return <ErrorNote message="That request isn't in this demo session. It may have been cleared by a reset." />;

  const p = request.parsed;

  // "Verified suppliers only": every check run and passed (an expiring certification counts as not passed).
  const supplierVerified = (sid: string) => {
    const sup = db.suppliers.find((x) => x.id === sid);
    if (!sup) return false;
    const v = verificationSummary(sup);
    return !v.unchecked && v.problems === 0 && v.checks.every((c) => c.status === "pass" || c.id === "bond");
  };
  const everything = results ? results.groups.flatMap((g) => g.options) : [];
  const all = verifiedOnly ? everything.filter((o) => supplierVerified(o.supplier.id)) : everything;
  const coops = results && verifiedOnly ? { ...results.coops, hits: results.coops.hits.filter((h) => supplierVerified(h.supplier_id)), better: results.coops.better && supplierVerified(results.coops.better.hit.supplier_id) ? results.coops.better : null } : results?.coops;
  const hiddenByVerified = results && verifiedOnly ? everything.length - all.length + (results.coops.hits.length - (coops?.hits.length ?? 0)) : 0;
  const shown = showAll ? all : all.slice(0, GRID_LIMIT);
  // Best fit: the top-ranked option the buyer can act on right away (no quote, no co-op to join first).
  const bestId = all.length > 1 ? all.find((o) => !o.quote_route && o.member !== false)?.listing.id : undefined;
  const sources = results ? results.groups.length : 0;
  // The personal shopper cites results by number; the same number is tagged on each cited result.
  const refs = results ? shopperRefs(results) : [];
  const listingRefs = Object.fromEntries(refs.filter((r) => r.key.startsWith("listing:")).map((r) => [r.key.slice(8), r.n]));
  const contractRefs = Object.fromEntries(refs.filter((r) => r.key.startsWith("contract:")).map((r) => [r.key.slice(9), r.n]));
  const priced = results && !results.no_match;
  const cc = results ? coopCounts(coops!) : null;
  const who = buyer?.name ?? "this agency";
  const counts = priced ? `${all.length} priced option${all.length === 1 ? "" : "s"} on ${sources} kind${sources === 1 ? "" : "s"} of contract` : null;
  const dateOf = (d: string) => new Date(d).toLocaleDateString("en-US", { month: "long", year: "numeric" });

  // Everything under the recommended route: every priced option, then the other sources, folded.
  const main = results && (
    <>
      <InviteAdminBanner requestId={id} />
      <OwnContractsCard hits={results.own_contracts} agency={results.buyer?.name ?? "Your agency"} />

      {priced && (
        <section aria-labelledby="options-heading" className="space-y-3">
          {showEarn && <KindBanner kind={results.groups.every((g) => g.source === "no_approval") ? PURCHASE_KINDS.no_approval : PURCHASE_KINDS.contract} />}
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
            <h2 id="options-heading" className="font-heading text-heading-lg font-bold text-ink">
              Purchasing options
            </h2>
            <p className="text-ui-xs text-base-dark">
              {counts}. {buyer ? `Only contracts open to ${buyer.name}, ${buyer.state} are listed` : "Every contract in Agora is listed; select an agency to limit them to the ones it can use"}.
            </p>
          </div>
          <OptionsTable
            options={shown}
            qty={p.quantity}
            requestId={id}
            recommendedId={bestId}
            refs={listingRefs}
            buyer={buyer}
            footer={
              <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
                <p className="min-w-0 flex-[1_1_320px] text-ui-2xs text-base-dark">Prices are published prices from each supplier's listing. Sponsored suppliers are marked and are not ranked higher for it.</p>
                <Checkbox checked={verifiedOnly} onChange={setVerifiedOnly} label="Verified suppliers only" />
                <button type="button" onClick={() => setWhy(!why)} aria-expanded={why} className="inline-flex min-h-[44px] items-center text-ui-xs font-bold text-primary hover:text-primary-dark">
                  {why ? "Hide ranking" : "How these are ranked"}
                </button>
              </div>
            }
          />
          {why && (
            <Card className="bg-navy-50/60 p-4">
              <ul className="list-disc space-y-1 pl-5 text-sm text-navy">
                {results.explanation.map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
            </Card>
          )}
          {verifiedOnly && hiddenByVerified > 0 && (
            <p className="text-ui-2xs text-base-dark">
              {hiddenByVerified} option{hiddenByVerified === 1 ? "" : "s"} from suppliers whose checks aren't all passing {hiddenByVerified === 1 ? "is" : "are"} hidden.{" "}
              <button onClick={() => setVerifiedOnly(false)} className="text-ink underline">
                Show everything
              </button>
            </p>
          )}
          {all.length > shown.length && (
            <button onClick={() => setShowAll(true)} className="w-full border border-dashed border-base-light py-3 text-sm font-semibold text-ink hover:bg-white">
              Show all {all.length} options
            </button>
          )}
        </section>
      )}

      {results.no_match && showEarn && <KindBanner kind={PURCHASE_KINDS.new_need} />}
      {results.no_match && (
        <Card className="p-6">
          <div className="flex gap-4">
            <IconCircle size="lg">
              <Plus />
            </IconCircle>
            <div>
              <h2 className="font-heading text-heading-lg font-bold text-ink">
                {results.own_contracts.length
                  ? "Nothing else in Agora covers this, but the agency's own contract does."
                  : results.contract_leads.some((c) => c.eligible) || results.coops.hits.some((h) => h.eligible)
                    ? "No published prices for this yet. Contracts that cover it are listed below."
                    : results.unavailable.length
                      ? `No contract open to ${who} covers this yet.`
                      : "No contract covers this yet."}
              </h2>
              {results.contract_leads.some((c) => c.eligible) && (
                <p className="mt-2 text-sm text-navy">
                  The contracts listed below cover this kind of purchase, but Agora doesn't hold their prices yet. Open one for its terms and how to buy under it, and ask the
                  supplier for a quote under the contract before running a solicitation.
                </p>
              )}
              <p className="mt-2 text-sm text-slate">
                Most requests resolve to something already on contract or under a quick-buy limit. {results.buyer?.name ?? "The agency"} can run a solicitation, and once it's
                awarded the contract joins Agora for the next agency that needs the same thing.
              </p>
              {results.similar_solicitation && (
                <p className="mt-3 text-sm text-navy">
                  The draft starts from the closest past solicitation: <span className="font-semibold">{results.similar_solicitation.title}</span>.
                </p>
              )}
              <NextSteps requestId={id} />
              <Link href="/" className="mt-3 inline-block text-xs font-semibold text-slate hover:text-navy">
                Search with different words →
              </Link>
            </div>
          </div>
        </Card>
      )}

      {/* TRX state contracts are the preferred route for their own state's buyers, so they stay open above every co-op. */}
      {buyer && <StateContracts section={coops!} requestId={id} refs={contractRefs} />}

      <FoldGroup title="Other sources" note="Additional contracts and procurement methods for this request.">
        {cc!.coops > 0 && (
          <Fold
            id="coops"
            title="Cooperative contracts"
            count={cc!.coops}
            note={buyer ? `Split by the co-ops ${buyer.name} belongs to and the ones it could join.` : "Open to members, or to agencies in states that have signed on. Depends on the agency."}
            defaultOpen={!all.length}
          >
            <CoopContracts section={coops!} requestId={id} onMembershipChange={() => setResults(null)} refs={contractRefs} query={p.item} />
          </Fold>
        )}
        {!buyer && cc!.state > 0 && (
          <Fold id="other-state-contracts" title="State contracts" count={cc!.state} note={`${cc!.stateNames.join(", ")}. Open to local governments in ${cc!.stateNames.length === 1 ? "that state" : "those states"} only.`}>
            <StateContracts section={coops!} requestId={id} refs={contractRefs} />
          </Fold>
        )}
        {cc!.gsa > 0 && (
          <Fold id="gsa" title="Federal schedule (GSA)" count={cc!.gsa} note="Open to state and local governments only for the categories GSA allows.">
            <GsaContracts section={coops!} requestId={id} refs={contractRefs} />
          </Fold>
        )}
        {results.catalog_products && results.catalog_products.hits.length > 0 && (
          <Fold id="catalog-products-fold" title="Products in co-op price files" count={results.catalog_products.total} note="Published prices with their vintage, not quotes. Ordering happens on the co-op's site.">
            <CatalogProducts data={results.catalog_products} requestId={id} />
          </Fold>
        )}
        {results.contract_leads.length > 0 && (
          <Fold id="by-quote" title="Contracts with no prices on file" count={results.contract_leads.length} note="They cover this purchase; the price comes by quote.">
            <ContractLeadsCard leads={results.contract_leads} />
          </Fold>
        )}
        {results.peer && (
          <Fold
            id="peer"
            title="Peer purchase on record"
            note={`${results.peer.agency_name} (${results.peer.distance_miles} miles), ${dateOf(results.peer.date)}: ${money(results.peer.unit_price)} each from ${results.peer.supplier_name.replace(/\.$/, "")}. For reference; not a price offered to ${who}.`}
          >
            <div className="max-w-md">
              <PeerCard peer={results.peer} qty={p.quantity} />
            </div>
          </Fold>
        )}
        {results.unavailable.length > 0 && (
          <Fold id="not-open" title={`Contracts not open to ${who}`} count={results.unavailable.length} note="Matches on contracts this agency can't use, with the reason.">
            <UnavailableCard items={results.unavailable} buyerName={who} />
          </Fold>
        )}
        <Link href={`/solicitations/new?request=${id}`} className="flex min-h-[44px] items-center gap-4 px-5 py-3.5 text-ink no-underline hover:bg-base-lightest">
          <span className="w-12 shrink-0" aria-hidden />
          <span className="min-w-0 flex-1">
            <span className="block text-body-sm font-bold">Issue a solicitation</span>
            <span className="block text-ui-2xs text-base-dark">A draft is generated from this request and the closest past award.</span>
          </span>
          <span className="shrink-0 whitespace-nowrap text-ui-xs font-bold text-primary">Start a draft</span>
        </Link>
      </FoldGroup>
      <ExpiredNote items={results.expired} />
    </>
  );

  return (
    <div className="space-y-6 pb-20 lg:pb-0">
      <Link href="/" className="text-sm text-slate hover:text-navy">
        ← New search
      </Link>
      <RequestSummary request={request} buyer={buyer} counts={counts} onAgency={() => setChanging(!changing)} changing={changing} />

      {changing && <BuyerPicker onDone={() => setChanging(false)} onClose={() => setChanging(false)} />}

      {!buyer && !changing && (
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3 border border-warning bg-warning-lighter px-5 py-4">
          <div className="min-w-0 flex-[1_1_360px]">
            <h2 className="text-body-md font-bold text-ink">No agency selected</h2>
            <p className="text-ui-xs text-base-darker">
              Eligibility depends on state law and the agency's cooperative memberships. Until an agency is selected, every contract is listed and none is checked against them.
            </p>
          </div>
          <Button onClick={() => setChanging(true)}>Select agency</Button>
        </div>
      )}

      {needsAnswer && !changing && (
        <Card accent="maroon" className="flex flex-wrap items-center gap-4 p-5">
          <div className="min-w-0 flex-1">
            <div className="font-semibold text-navy">Riverbend has a local-vendor preference. Favor local and MBE-certified suppliers for this request?</div>
            <div className="text-xs text-slate">The answer is kept for the rest of this session.</div>
          </div>
          <div className="flex gap-2">
            {(
              [
                ["yes", "Yes"],
                ["no", "No"],
                ["always_ask", "Always ask"],
              ] as const
            ).map(([a, label]) => (
              <Button
                key={a}
                variant={a === "yes" ? "primary" : "secondary"}
                onClick={async () => {
                  await act("setPreference", { requestId: id, answer: a });
                  setAnswered(true);
                }}
              >
                {label}
              </Button>
            ))}
          </div>
        </Card>
      )}

      <ErrorNote message={error} />
      {!needsBuyer && !needsAnswer && !results && !error && <Loading label={buyer ? `Checking every contract ${buyer.name} can use` : "Checking every contract in Agora"} />}

      {results &&
        (shopperApplies(results) ? (
          <Shopper results={results} requestId={id} onChanged={() => setResults(null)} options={all}>
            {main}
          </Shopper>
        ) : (
          <div className="space-y-8">{main}</div>
        ))}
    </div>
  );
}

/** Matches on contracts this buyer can't use: said plainly, never hidden. */
function UnavailableCard({ items, buyerName }: { items: Unavailable[]; buyerName: string }) {
  if (!items.length) return null;
  return (
    <Card className="rounded-2xl p-5">
      <div className="flex items-center gap-2 text-sm font-semibold text-navy">
        <Lock className="h-4 w-4 text-slate" /> On contracts {buyerName} can't use
      </div>
      <ul className="mt-2 space-y-3">
        {items.map((u) => (
          <li key={u.contract_number} className="text-xs text-slate">
            <div>
              <span className="font-semibold text-navy">{u.vehicle}</span> {u.contract_number}: {u.products} matching product{u.products === 1 ? "" : "s"}
            </div>
            <div className="truncate">e.g. {u.examples.join(", ")}</div>
            <div className="text-maroon">{u.reason}</div>
            {u.master_agreement && (
              <div className="mt-1 text-navy">
                Adopted from {u.master_agreement}. Ask your purchasing office whether your state has signed a participating addendum to it.
              </div>
            )}
          </li>
        ))}
      </ul>
      <p className="mt-3 text-[11px] text-slate">Change your agency above to see how the options change.</p>
    </Card>
  );
}

function PeerCard({ peer, qty }: { peer: NonNullable<Results["peer"]>; qty: number }) {
  return (
    <Card accent="steel" className="rounded-2xl p-5">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1.5">
          <People className="h-3.5 w-3.5 text-slate" />
          <Eyebrow tone="slate">Peer pick</Eyebrow>
        </span>
        <RevenueTags options={[4, 7, 6]} />
      </div>
      <div className="mt-1 text-sm font-semibold text-navy">
        {peer.agency_name} bought this {new Date(peer.date).toLocaleDateString("en-US", { month: "long", year: "numeric" })}
      </div>
      <div className="mt-2 text-sm text-navy">{peer.listing_title}</div>
      <div className="mt-1 text-xs text-slate">
        {peer.supplier_name} · {peer.distance_miles} mi away{peer.note ? ` · ${peer.note}` : ""}
      </div>
      <div className="mt-2 flex items-center justify-between">
        <span className="text-lg font-bold text-navy">{money(peer.unit_price)}</span>
        <Stars rating={peer.rating} />
      </div>
      <div className="text-xs text-slate">About {money(peer.unit_price * qty, false)} for {qty}</div>
      <div className="mt-3">
        {peer.piggybackable ? (
          <Badge tone="green">Their contract allows piggybacking</Badge>
        ) : (
          <Badge tone="amber">Their contract does not allow piggybacking</Badge>
        )}
      </div>
    </Card>
  );
}

/** Contracts that cover the request with no prices loaded: a quote is the next step. */
function ContractLeadsCard({ leads }: { leads: ContractLead[] }) {
  if (!leads.length) return null;
  return (
    <Card className="rounded-2xl p-5">
      <div className="text-sm font-semibold text-navy">Also on contract, by quote</div>
      <p className="mt-0.5 text-[11px] text-slate">These contracts cover this, but their prices aren't loaded into Agora.</p>
      <ul className="mt-3 space-y-3">
        {leads.slice(0, 5).map((c) => (
          <li key={c.contract_id} className="text-xs">
            <Link href={`/storefronts/${c.supplier_id}`} className="font-semibold text-navy hover:text-maroon hover:underline">
              {c.supplier}
            </Link>
            <Link href={contractHref(c.contract_id)} className="block text-slate underline decoration-base-light underline-offset-2 hover:text-maroon">
              {c.vehicle} {c.contract_number} · {c.title}
            </Link>
            <div className={c.eligible ? "text-emerald-700" : "text-maroon"}>{c.eligible ? c.reason : `Not open to you: ${c.reason.replace(/^Open to /, "open to ")}`}</div>
            {c.link_out?.has_link && (
              <a href={goHref(c.contract_id)} target="_blank" rel="noreferrer" className="font-semibold text-maroon hover:underline">
                View on {c.link_out.coop} ↗
              </a>
            )}
          </li>
        ))}
      </ul>
      {leads.length > 5 && (
        <p className="mt-2 text-[11px] text-slate">
          And {leads.length - 5} more on the{" "}
          <Link href="/contracts" className="underline">
            Contracts page
          </Link>
          .
        </p>
      )}
    </Card>
  );
}
