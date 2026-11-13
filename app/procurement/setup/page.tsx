"use client";

import { BuyerPicker } from "@/components/BuyerPicker";
import { ContractRegister } from "@/components/ContractRegister";
import { CoopMemberships } from "@/components/CoopMemberships";
import { Check } from "@/components/icons";
import { useStore } from "@/components/store";
import { Button, Card, ErrorNote, Loading, PageTitle } from "@/components/ui";
import { FREE_RFP_LIMIT, rfpsLeft, settingsFor, setupStatus } from "@/lib/agency";
import { stateName } from "@/lib/vehicles";
import { useEffect, useState } from "react";

/** The purchasing admin's one-time setup: what staff searches will know about this agency. */
export default function AgencySetup() {
  const { db, act, role, setRole } = useStore();
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (role !== "procurement") setRole("procurement");
  }, [role, setRole]);
  if (!db) return <Loading />;
  const buyer = db.session.buyer;

  if (!buyer)
    return (
      <div className="mx-auto max-w-4xl">
        <PageTitle title="Agency setup">Pick the agency you're setting up. Staff searches use what you configure here.</PageTitle>
        <BuyerPicker />
      </div>
    );

  const status = setupStatus(db, buyer);
  const settings = settingsFor(db, buyer.name);
  const left = rfpsLeft(settings);
  const invites = db.invites.filter((i) => i.agency === buyer.name);
  const run = async (action: string, body: Record<string, unknown>) => {
    setError(null);
    try {
      await act(action, body);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageTitle title={`Set up ${buyer.name}`}>
        Do this once. Afterward, anyone at {buyer.name} can type a need and see your own contracts first, then {stateName(buyer.state)}'s, then the co-ops you're on, without knowing
        any of it themselves.
      </PageTitle>

      {invites.length > 0 && (
        <Card className="border-maroon/30 bg-maroon-50 p-4 text-sm text-navy">
          <span className="font-semibold">Staff asked you to finish setup.</span> {invites.length === 1 ? "An invitation went" : `${invites.length} invitations went`} to{" "}
          {[...new Set(invites.map((i) => i.email))].join(", ")}. Demo only: no email is sent.
        </Card>
      )}

      <Card className="divide-y divide-navy/5">
        <Step done={status.steps.state} title="State" detail={`${stateName(buyer.state)}, from your agency profile. State contracts apply automatically.`} />
        <Step
          done={status.steps.contracts}
          title="Your own contracts"
          detail={status.own_contracts ? `${status.own_contracts} on file. Staff see these before anything else.` : "Upload your contract register so staff see “we already have a contract for this” first."}
        />
        <Step
          done={status.steps.coops}
          title="Co-op memberships"
          detail={
            status.confirmed_coops
              ? `${status.confirmed_coops} confirmed${status.detected_coops ? `, ${status.detected_coops} detected and waiting for you` : ""}.`
              : status.detected_coops
                ? `${status.detected_coops} detected from co-op member lists. Confirm them below.`
                : "None found on the member lists Agora holds. Add the co-ops you belong to."
          }
        >
          <div className="mt-2">
            <CoopMemberships />
          </div>
        </Step>
      </Card>

      <ContractRegister />

      <Card className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="text-base font-semibold text-navy">{settings.plan === "paid" ? "Paid plan" : "Free plan"}</div>
            <p className="mt-1 max-w-xl text-sm text-slate">
              {settings.plan === "paid"
                ? "Unlimited RFPs, and you choose whether staff see sponsored placements."
                : `Search is always free. The free plan includes ${FREE_RFP_LIMIT} RFPs a year and shows sponsored placements, marked as sponsored.`}
            </p>
          </div>
          <Button variant={settings.plan === "paid" ? "secondary" : "maroon"} onClick={() => run("setPlan", { plan: settings.plan === "paid" ? "free" : "paid" })}>
            {settings.plan === "paid" ? "Switch to free (demo)" : "Upgrade (demo)"}
          </Button>
        </div>
        {left !== null && (
          <div className="mt-4">
            <div className="flex justify-between text-xs text-slate">
              <span>RFPs published in {settings.rfp_year}</span>
              <span className="font-semibold text-navy">
                {settings.rfp_used} of {FREE_RFP_LIMIT}
              </span>
            </div>
            <div className="mt-1 h-1.5 rounded bg-tint">
              <div className={`h-1.5 rounded ${left === 0 ? "bg-maroon" : "bg-navy"}`} style={{ width: `${Math.min(100, (settings.rfp_used / FREE_RFP_LIMIT) * 100)}%` }} />
            </div>
          </div>
        )}
        <label className={`mt-4 flex items-center gap-2 text-sm ${settings.plan === "paid" ? "text-navy" : "text-slate"}`}>
          <input
            type="checkbox"
            className="!p-0"
            checked={!settings.ad_free}
            disabled={settings.plan !== "paid"}
            onChange={(e) => run("setAdFree", { on: !e.target.checked })}
          />
          Show sponsored placements to staff{settings.plan !== "paid" && " (always on in the free plan)"}
        </label>
        <ErrorNote message={error} />
      </Card>
    </div>
  );
}

function Step({ done, title, detail, children }: { done: boolean; title: string; detail: string; children?: React.ReactNode }) {
  return (
    <div className="flex gap-3 p-4">
      <span className={`mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full ${done ? "bg-emerald-600 text-white" : "border border-line bg-white text-slate"}`}>
        {done ? <Check className="h-3.5 w-3.5" /> : null}
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold text-navy">{title}</div>
        <div className="text-sm text-slate">{detail}</div>
        {children}
      </div>
    </div>
  );
}
