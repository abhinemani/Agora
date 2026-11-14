"use client";

import Link from "next/link";
import { useState } from "react";
import type { ResultOption } from "@/lib/assistant";
import type { Buyer } from "@/lib/types";
import { AddToCart } from "@/components/AddToCart";
import { CoopLink } from "@/components/CoopLink";
import { FitPill } from "@/components/CoopSection";
import { contractHref } from "@/components/ContractBits";
import { RefTag } from "@/components/blueprint";
import { useStore } from "@/components/store";
import { ErrorNote, RevenueTags, Stars, SupplierBadges, money, sourceLabel } from "@/components/ui";
import { TRANSACTION_FEE_SOURCES } from "@/lib/revenue_rules";

const label = "font-mono text-[10.5px] uppercase tracking-[0.1em]";
const cols = "lg:grid-cols-[132px_minmax(0,1.5fr)_84px_96px_minmax(0,1fr)_minmax(0,1fr)_88px_200px]";
const primaryLink = "inline-flex min-h-[44px] items-center justify-center rounded-md bg-primary px-4 text-ui-xs font-bold leading-none text-white no-underline hover:bg-primary-dark";
const outlineLink = "inline-flex min-h-[44px] items-center justify-center rounded-md bg-white px-4 text-ui-xs font-bold leading-none text-primary no-underline shadow-[inset_0_0_0_2px_theme(colors.primary.DEFAULT)] hover:text-primary-dark";

export interface Fact {
  text: string;
  note?: string;
  tone?: string;
}

/** Whether this buyer can use the option, from what the rules already decided (never recomputed here). */
export function eligibilityFact(o: ResultOption, buyer: Buyer | null): Fact {
  if (o.quote_route) return { text: "By quote", note: `Under ${o.quote_route.vehicle} ${o.quote_route.contract_number}` };
  if (o.member === false) return { text: "Membership required", note: o.link_out ? `Not on ${o.link_out.coop} yet` : "Not on this co-op yet", tone: "text-warning-darker" };
  if (!buyer) return { text: "Not checked", note: "Select an agency", tone: "text-base-dark" };
  return { text: "Eligible", note: o.group === "own_contract" ? `${buyer.name} contract` : o.member ? "On your co-op" : sourceLabel(o.group), tone: "text-success-darker" };
}

/** What the purchase takes: a P-card, a purchase order, a quote, or an order on the co-op's own site. */
export function requirementFact(o: ResultOption, payment: "pcard" | "po"): Fact {
  if (o.quote_route) return { text: "Quote", note: "Supplier quotes off list" };
  if (o.link_out) return { text: "Co-op order", note: `Placed on ${o.link_out.coop}'s site` };
  return payment === "pcard" ? { text: "P-card", note: "Under the quick-buy limit" } : { text: "Purchase order", note: "Over the quick-buy limit" };
}

export function leadTimeFact(o: ResultOption): Fact {
  const days = o.listing.lead_time_days;
  return {
    text: days ? `${days} day${days === 1 ? "" : "s"}` : o.delivery || "Not stated",
    note: o.meets_deadline === true ? "Meets the deadline" : o.meets_deadline === false ? "Misses the deadline" : days ? o.delivery : undefined,
    tone: o.meets_deadline === false ? "text-error-dark" : undefined,
  };
}

function earnsFor(o: ResultOption, payment: "pcard" | "po") {
  const tags: number[] = [];
  if (o.listing.source !== "no_approval") tags.push(2);
  if (TRANSACTION_FEE_SOURCES.includes(o.listing.source)) tags.push(3);
  if (o.sponsored) tags.push(5);
  if (payment === "pcard") tags.push(9);
  return tags;
}

/** Every priced option for the request, side by side, in ranked order. One row each; details on demand. */
export function OptionsTable({ options, qty, requestId, recommendedId, refs, buyer, footer }: { options: ResultOption[]; qty: number; requestId: string; recommendedId?: string; refs: Record<string, number>; buyer: Buyer | null; footer?: React.ReactNode }) {
  if (!options.length) return null;
  return (
    <div className="border border-base-light bg-white">
      <div className={`hidden gap-x-4 border-b border-base-light bg-base-lightest px-5 py-2.5 text-base-darker lg:grid ${cols} ${label}`}>
        <div>Route</div>
        <div>Supplier and item</div>
        <div className="text-right">Each</div>
        <div className="text-right">{qty > 1 ? `${qty} units` : "Total"}</div>
        <div>Eligibility</div>
        <div>Requirement</div>
        <div>Lead time</div>
        <div />
      </div>
      <div id="options" className="scroll-mt-24">
        {options.map((o) => (
          <OptionRow key={o.listing.id} o={o} qty={qty} requestId={requestId} recommended={o.listing.id === recommendedId} refN={refs[o.listing.id]} buyer={buyer} />
        ))}
      </div>
      {footer && <div className="px-5 py-3">{footer}</div>}
    </div>
  );
}

function Cell({ name, fact, right = false }: { name: string; fact: Fact; right?: boolean }) {
  return (
    <div className={right ? "lg:text-right" : ""}>
      <div className={`${label} text-base-dark lg:hidden`}>{name}</div>
      <div className={`text-ui-xs font-bold ${fact.tone ?? "text-ink"}`}>{fact.text}</div>
      {fact.note && <div className="text-ui-3xs text-base-dark">{fact.note}</div>}
    </div>
  );
}

function OptionRow({ o, qty, requestId, recommended, refN, buyer }: { o: ResultOption; qty: number; requestId: string; recommended: boolean; refN?: number; buyer: Buyer | null }) {
  const { db, act } = useStore();
  const [chosen, setChosen] = useState(o.listing.id);
  const [open, setOpen] = useState(false);
  const [quoted, setQuoted] = useState<string | null>(null);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const qr = o.quote_route;
  const lo = o.link_out;
  const l = o.variants.find((v) => v.id === chosen) ?? o.listing;
  const tiered = o.variants.length > 1;
  const total = Math.round(l.unit_price * qty * 100) / 100;
  const limit = db?.agency.quick_buy_threshold ?? 10_000;
  // The rule was worked out for the first tier; another tier is re-tested against the same limit.
  const payment: "pcard" | "po" = l.id === o.listing.id || qr ? o.rule.payment : total < limit ? "pcard" : "po";
  const title = tiered ? l.title.replace(/\s*\([^)]*\)\s*$/, "") : l.title;
  const href = `/product/${l.id}?qty=${qty}&request=${requestId}`;
  const contract = db?.contracts.find((c) => c.id === l.contract_id);
  const dateOf = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

  return (
    <div className={`border-b border-base-lighter last:border-b-0 ${recommended ? "bg-primary-lighter/30" : ""}`}>
      <div className={`grid grid-cols-3 gap-x-4 gap-y-3 px-5 py-4 ${cols} lg:items-start`}>
        <div className="col-span-3 flex flex-wrap items-center gap-x-2 gap-y-1 lg:col-span-1 lg:flex-col lg:items-start">
          <span className="text-ui-xs font-bold text-ink">{sourceLabel(o.group)}</span>
          {o.contract_number && <span className="font-mono text-[11.5px] text-base-dark">{o.contract_number}</span>}
          {recommended && <span className="bg-primary-darker px-1.5 py-0.5 text-ui-3xs font-bold text-white">Recommended</span>}
          {refN !== undefined && <RefTag n={refN} />}
        </div>
        <div className="col-span-3 min-w-0 lg:col-span-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <Link href={`/storefronts/${o.supplier.id}`} className="text-ui-xs font-bold text-ink no-underline hover:underline">
              {o.supplier.name}
            </Link>
            <SupplierBadges supplier={o.supplier} />
            {o.sponsored && <span className="border border-base-light px-1.5 py-px text-ui-3xs text-base-dark">Sponsored</span>}
          </div>
          <Link href={href} className="mt-0.5 block text-ui-xs text-base-darker no-underline hover:underline">
            {title}
          </Link>
          {l.detail && <div className="text-ui-3xs text-base-dark">{l.detail}</div>}
        </div>
        <div className="lg:text-right">
          <div className={`${label} text-base-dark lg:hidden`}>Each</div>
          <div className={`text-ui-xs font-bold tabular-nums ${qr ? "text-base-dark" : "text-ink"}`}>{money(l.unit_price)}</div>
          <div className="text-ui-3xs text-base-dark">{qr ? "Reference price" : `per ${l.unit}`}</div>
        </div>
        <div className="lg:text-right">
          <div className={`${label} text-base-dark lg:hidden`}>{qty > 1 ? `${qty} units` : "Total"}</div>
          <div className={`text-ui-xs font-bold tabular-nums ${qr ? "text-base-dark" : "text-ink"}`}>{qr ? "By quote" : money(total)}</div>
        </div>
        <Cell name="Eligibility" fact={eligibilityFact(o, buyer)} />
        <Cell name="Requirement" fact={requirementFact(o, payment)} />
        <Cell name="Lead time" fact={leadTimeFact(o)} />
        <div className="col-span-3 flex flex-wrap items-center gap-2 lg:col-span-1 lg:justify-end">
          {lo || qr ? (
            <Link href={href} className={outlineLink}>
              View
            </Link>
          ) : (
            <AddToCart listingId={l.id} quantity={qty} requestId={requestId} size="md" />
          )}
          {lo ? (
            <CoopLink contractId={lo.contract_id} coop={lo.coop} hasLink={lo.has_link} listingId={l.id} requestId={requestId} />
          ) : qr ? (
            quoted ? (
              <span className="text-ui-2xs font-bold text-success-darker">Quote {quoted} sent</span>
            ) : (
              <button
                type="button"
                className={primaryLink}
                onClick={async () => {
                  setQuoteError(null);
                  try {
                    const q = await act<{ id: string }>("requestQuote", { listingId: l.id, contractId: qr.contract_id, quantity: qty });
                    setQuoted(q.id);
                  } catch (e) {
                    setQuoteError((e as Error).message);
                  }
                }}
              >
                Request a quote
              </button>
            )
          ) : (
            <Link href={`/checkout?listing=${l.id}&qty=${qty}&request=${requestId}`} className={primaryLink}>
              Buy
            </Link>
          )}
          <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="inline-flex min-h-[44px] items-center px-1 text-ui-xs font-bold text-primary hover:text-primary-dark">
            {open ? "Hide details" : "Details"}
          </button>
        </div>
      </div>
      {quoteError && (
        <div className="px-5 pb-3">
          <ErrorNote message={quoteError} />
        </div>
      )}
      {open && (
        <div className="mx-5 mb-4 flex flex-wrap items-start gap-x-8 gap-y-4 border border-base-lighter bg-white px-4 py-3.5 lg:ml-[168px]">
          <div className="min-w-0 flex-[1_1_280px] space-y-1.5">
            <div className={`${label} text-base-dark`}>Contract</div>
            {contract ? (
              <>
                <div className="text-ui-xs text-ink">
                  {contract.owner} · {contract.title}
                  {contract.start && contract.end ? ` · ${dateOf(contract.start)} to ${dateOf(contract.end)}` : ""}
                </div>
                {contract.piggyback_clause_text && <div className="border-l-[3px] border-primary-light pl-2.5 text-ui-xs text-ink">“{contract.piggyback_clause_text}”</div>}
              </>
            ) : (
              <div className="text-ui-xs text-ink">{qr ? `${qr.reference} isn't open to this agency. The supplier quotes a discount off list under ${qr.vehicle} ${qr.contract_number}.${qr.research_note ? ` ${qr.research_note}.` : ""}` : "No contract: an off-contract purchase within the quick-buy limit."}</div>
            )}
          </div>
          <div className="min-w-0 flex-[1_1_220px] space-y-1.5">
            <div className={`${label} text-base-dark`}>Supplier and match</div>
            <div className="flex flex-wrap items-center gap-2">
              <Stars rating={o.supplier.rating} count={o.supplier.review_count} />
              <FitPill fit={o.fit} />
              {!qr && !lo && <RevenueTags options={earnsFor(o, payment)} />}
            </div>
            {tiered && (
              <label className="flex flex-wrap items-center gap-2 text-ui-2xs text-base-dark">
                {o.variants.length} price tiers
                <select value={chosen} onChange={(e) => setChosen(e.target.value)} className="min-w-0 max-w-full flex-1 !py-1 text-xs">
                  {o.variants.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.variant ?? v.sku} · {money(v.unit_price)} / {v.unit}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
          <div className="flex flex-col">
            <Link href={href} className="inline-flex min-h-[36px] items-center text-ui-xs font-bold text-primary hover:text-primary-dark">
              Product page
            </Link>
            {l.contract_id && (
              <Link href={contractHref(l.contract_id)} className="inline-flex min-h-[36px] items-center text-ui-xs font-bold text-primary hover:text-primary-dark">
                Contract record
              </Link>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
