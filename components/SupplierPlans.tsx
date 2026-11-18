"use client";

import { useState } from "react";
import { PLANS, canSponsor, isClaimed, isOffContract, listingFeeCurrent } from "@/lib/suppliers";
import { CATEGORIES, type Category, type Supplier, type SupplierPlan } from "@/lib/types";
import { STATES, stateName } from "@/lib/vehicles";
import { useStore } from "./store";
import { Alert, Button, Card, ErrorNote, RevenueTags, money } from "./ui";

/** The supplier's storefront plan, its own copy, targeted placements and (off contract) the listing fee. */
export function SupplierPlans({ s }: { s: Supplier }) {
  const { db, act } = useStore();
  const [error, setError] = useState<string | null>(null);
  const [category, setCategory] = useState<Category>(s.categories[0] ?? "Office supplies");
  const [state, setState] = useState("any");
  const [copy, setCopy] = useState({ tagline: s.profile?.tagline ?? "", about: s.profile?.about ?? "" });
  const [saved, setSaved] = useState(false);
  if (!db) return null;
  const plan = s.plan ?? "basic";
  const mine = db.placements.filter((p) => p.supplier_id === s.id);
  const offContract = isOffContract(db, s);
  const run = async (action: string, body: Record<string, unknown>) => {
    setError(null);
    try {
      await act(action, body);
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    }
  };

  if (!isClaimed(s))
    return (
      <Alert type="info" heading="Claim this storefront first">
        Plans and placements are for the company's own people. Claim the storefront from its public page to get started.
      </Alert>
    );

  return (
    <div className="space-y-8">
      <ErrorNote message={error} />

      <section>
        <h2 className="font-heading text-heading-md font-bold text-ink">Storefront plan</h2>
        <div className="mt-4 grid gap-4 md:grid-cols-3">
          {(Object.keys(PLANS) as SupplierPlan[]).map((k) => {
            const p = PLANS[k];
            const on = plan === k;
            return (
              <div key={k} className={`flex flex-col border p-5 ${on ? "border-ink" : "border-base-lighter"}`}>
                <div className="text-ui-3xs uppercase tracking-label text-base-dark">{on ? "Your plan" : k === "basic" ? "Free" : "Paid"}</div>
                <div className="mt-1 text-body-md font-semibold text-ink">{p.name}</div>
                <div className="mt-1 text-heading-lg font-light text-ink">{p.price ? `${money(p.price, false)}/yr` : "Free"}</div>
                <ul className="mt-3 flex-1 space-y-1 text-ui-2xs text-base-darker">
                  {p.includes.map((i) => (
                    <li key={i}>{i}</li>
                  ))}
                </ul>
                <div className="mt-4 flex items-center gap-2">
                  <Button variant={on ? "secondary" : "primary"} disabled={on} onClick={() => run("setSupplierPlan", { supplierId: s.id, plan: k })} className="flex-1">
                    {on ? "Current plan" : p.price > PLANS[plan].price ? "Upgrade" : "Switch"}
                  </Button>
                  {!on && p.price > PLANS[plan].price && <RevenueTags options={[6]} />}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {plan !== "basic" && (
        <section>
          <h2 className="font-heading text-heading-md font-bold text-ink">Your storefront's description</h2>
          <p className="mt-1 text-ui-xs text-base-dark">Shown at the top of your storefront, in place of what Agora wrote from your contracts.</p>
          <form
            className="mt-4 max-w-2xl space-y-3"
            onSubmit={async (e) => {
              e.preventDefault();
              setSaved(false);
              if (await run("updateStorefront", { supplierId: s.id, ...copy })) setSaved(true);
            }}
          >
            <label className="block text-ui-2xs font-bold text-ink">
              Tagline
              <input value={copy.tagline} onChange={(e) => setCopy({ ...copy, tagline: e.target.value })} maxLength={120} className="mt-1 block w-full" />
            </label>
            <label className="block text-ui-2xs font-bold text-ink">
              About
              <textarea value={copy.about} onChange={(e) => setCopy({ ...copy, about: e.target.value })} rows={4} maxLength={800} className="mt-1 block w-full" />
            </label>
            <div className="flex items-center gap-3">
              <Button type="submit">Save description</Button>
              {saved && <span className="text-ui-2xs text-success-darker">Saved. It's on your storefront now.</span>}
            </div>
          </form>
        </section>
      )}

      <section>
        <h2 className="font-heading text-heading-md font-bold text-ink">Sponsored placements</h2>
        <p className="mt-1 max-w-2xl text-ui-xs text-base-dark">
          Show your listings as Sponsored on searches in a category, in one state or anywhere. You pay $2.00 each time a results page shows them. Sponsorship can move you up within
          your own kind of contract; it never changes a fit score or which contracts an agency can use.
        </p>
        {!canSponsor(s) ? (
          <p className="mt-3 text-ui-xs text-ink">Placements come with the Profile plan or above.</p>
        ) : (
          <>
            <form
              className="mt-4 flex flex-wrap items-end gap-3"
              onSubmit={async (e) => {
                e.preventDefault();
                await run("addPlacement", { supplierId: s.id, category, state });
              }}
            >
              <label className="block text-ui-2xs font-bold text-ink">
                Category
                <select value={category} onChange={(e) => setCategory(e.target.value as Category)} className="mt-1 block">
                  {CATEGORIES.map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              </label>
              <label className="block text-ui-2xs font-bold text-ink">
                Where
                <select value={state} onChange={(e) => setState(e.target.value)} className="mt-1 block">
                  <option value="any">Anywhere</option>
                  {STATES.map(([c, n]) => (
                    <option key={c} value={c}>
                      {n}
                    </option>
                  ))}
                </select>
              </label>
              <Button type="submit">Add placement</Button>
              <RevenueTags options={[5]} />
            </form>
            <ul className="mt-4 divide-y divide-base-lighter border-y border-base-lighter">
              {mine.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-3 py-3 text-ui-xs">
                  <span className="text-ink">
                    {p.category}, {p.state === "any" ? "anywhere" : stateName(p.state)}
                  </span>
                  <Button variant="ghost" onClick={() => run("removePlacement", { placementId: p.id })}>
                    Remove
                  </Button>
                </li>
              ))}
              {!mine.length && <li className="py-3 text-ui-xs text-base-dark">No placements yet.</li>}
            </ul>
          </>
        )}
      </section>

      {offContract && (
        <Card className="p-5">
          <h2 className="font-heading text-heading-md font-bold text-ink">Listing fee</h2>
          <p className="mt-1 text-ui-xs text-base-dark">
            {s.name} sells off contract, for purchases under an agency's quick-buy limit. Your listings appear in Agora while your listing fee ($150 a year) is current.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <span className={`text-ui-xs ${listingFeeCurrent(s) ? "text-success-darker" : "text-error-dark"}`}>
              {listingFeeCurrent(s) ? `Current through ${s.listing_fee_through}` : "Not current: your listings are hidden"}
            </span>
            <Button variant={listingFeeCurrent(s) ? "secondary" : "primary"} onClick={() => run("payListingFee", { supplierId: s.id })}>
              {listingFeeCurrent(s) ? "Renew for another year" : "Pay listing fee"}
            </Button>
            <RevenueTags options={[2]} />
          </div>
        </Card>
      )}
    </div>
  );
}
