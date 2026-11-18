"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { useStore } from "@/components/store";
import { Button, Card, ErrorNote, Loading, PageTitle } from "@/components/ui";
import { FREE_RFP_LIMIT, rfpsLeft, settingsFor } from "@/lib/agency";
import type { Solicitation } from "@/lib/types";

export default function NewSolicitationPage() {
  return (
    <Suspense fallback={<Loading />}>
      <NewSolicitation />
    </Suspense>
  );
}

function NewSolicitation() {
  const requestId = useSearchParams().get("request");
  const { act, db } = useStore();
  const router = useRouter();
  const [draft, setDraft] = useState<Solicitation | null>(null);
  const [basedOn, setBasedOn] = useState<Solicitation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!requestId) return;
    act<{ draft: Solicitation; basedOn: Solicitation | null }>("draftSolicitation", { requestId })
      .then((r) => {
        setDraft(r.draft);
        setBasedOn(r.basedOn);
      })
      .catch((e) => setError(e.message));
  }, [act, requestId]);

  if (!requestId) return <ErrorNote message="Solicitations start from a request that nothing in Agora covers." />;
  if (error && !draft) return <ErrorNote message={error} />;
  if (!draft) return <Loading label="Drafting from your request and the solicitation library" />;
  const set = (patch: Partial<Solicitation>) => setDraft({ ...draft, ...patch });
  const settings = db ? settingsFor(db, db.session.buyer?.name) : null;
  const left = settings ? rfpsLeft(settings) : null;
  const atLimit = Boolean(error?.startsWith("PLAN_LIMIT")) || left === 0;

  return (
    <div className="mx-auto max-w-3xl">
      <PageTitle eyebrow="Start a solicitation" title="Draft solicitation">
        Prefilled from the request{basedOn ? ` and from "${basedOn.title}", the closest past solicitation in Riverbend's library` : ""}. Edit anything, then publish.
      </PageTitle>
      <Card className="space-y-4 p-6">
        <Field label="Title">
          <input value={draft.title} onChange={(e) => set({ title: e.target.value })} className="w-full" />
        </Field>
        <Field label="Scope">
          <textarea value={draft.scope} onChange={(e) => set({ scope: e.target.value })} rows={5} className="w-full" />
        </Field>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Quantity">
            <input value={draft.quantity} onChange={(e) => set({ quantity: e.target.value })} className="w-full" />
          </Field>
          <Field label="Estimated budget">
            <input type="number" value={draft.est_budget} onChange={(e) => set({ est_budget: Number(e.target.value) })} className="w-full" />
          </Field>
          <Field label="Category">
            <input value={draft.category} readOnly className="w-full bg-tint" />
          </Field>
        </div>
        <Field label="Suggested evaluation criteria">
          <ul className="space-y-2">
            {draft.criteria.map((c, i) => (
              <li key={i}>
                <input value={c} onChange={(e) => set({ criteria: draft.criteria.map((x, j) => (j === i ? e.target.value : x)) })} className="w-full" />
              </li>
            ))}
          </ul>
        </Field>
        <label className="flex items-start gap-3 rounded-md bg-tint p-3">
          <input type="checkbox" checked={draft.piggybackable} onChange={(e) => set({ piggybackable: e.target.checked })} className="mt-1 !p-0" />
          <span className="text-sm">
            <span className="font-semibold text-navy">Piggybackable</span>
            <span className="block text-slate">When awarded, this contract will be listed in Riverbend's marketplace and in Agora for other agencies.</span>
          </span>
        </label>
        {settings && left !== null && (
          <div className={`rounded-md px-3 py-2 text-sm ${atLimit ? "bg-maroon-50 text-maroon" : "bg-tint text-slate"}`}>
            {atLimit ? (
              <>
                <span className="font-semibold">{settings.agency} has used all {FREE_RFP_LIMIT} free RFPs for {settings.rfp_year}.</span> Search stays free. To publish this one,{" "}
                <button
                  className="font-semibold underline"
                  onClick={async () => {
                    await act("setPlan", { plan: "paid" });
                    setError(null);
                  }}
                >
                  upgrade (demo)
                </button>{" "}
                or go back and send it to your own RFP tool.
              </>
            ) : (
              <>
                Free plan: publishing uses 1 of {settings.agency}'s {left} remaining free RFPs for {settings.rfp_year}.
              </>
            )}
          </div>
        )}
        <ErrorNote message={error?.startsWith("PLAN_LIMIT") ? null : error} />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => router.back()}>
            Cancel
          </Button>
          <Button
            variant="maroon"
            disabled={busy || atLimit}
            onClick={async () => {
              setBusy(true);
              try {
                await act("publishSolicitation", { draft });
                router.push("/solicitations");
              } catch (e) {
                setError((e as Error).message);
                setBusy(false);
              }
            }}
          >
            {busy ? "Publishing…" : "Publish"}
          </Button>
        </div>
      </Card>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1 text-xs font-semibold text-slate">{label}</div>
      {children}
    </div>
  );
}
