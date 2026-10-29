"use client";

import { useState } from "react";
import { useStore } from "@/components/store";
import { Badge, Button, Card, ErrorNote, Loading, PageTitle, money } from "@/components/ui";

const TONE = { open: "amber", awarded: "green", closed: "neutral", draft: "neutral" } as const;

export default function Solicitations() {
  const { db, act, role } = useStore();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  if (!db) return <Loading />;

  return (
    <div>
      <PageTitle eyebrow="The exception, not the rule" title="Solicitations">
        Riverbend only bids what no contract covers. Every award becomes a storefront listing, open to neighboring agencies when piggybackable.
      </PageTitle>
      <ErrorNote message={error} />
      <Card className="mt-4 divide-y divide-navy/5">
        {db.solicitations.map((s) => {
          const supplier = db.suppliers.find((x) => x.id === s.awarded_supplier_id);
          return (
            <div key={s.id} className="flex flex-wrap items-start justify-between gap-4 p-5">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold text-navy">{s.title}</span>
                  <Badge tone={TONE[s.status]}>{s.status === "closed" ? "Past" : s.status[0].toUpperCase() + s.status.slice(1)}</Badge>
                  {s.piggybackable && <Badge tone="navy">Piggybackable</Badge>}
                </div>
                <div className="mt-1 text-sm text-slate">{s.scope}</div>
                <div className="mt-2 text-xs text-slate">
                  {s.category} · {s.quantity} · est. {money(s.est_budget, false)}
                  {s.published_at && ` · published ${new Date(s.published_at).toLocaleDateString()}`}
                </div>
                {supplier && (
                  <div className="mt-2 text-xs text-navy">
                    Awarded to <span className="font-semibold">{supplier.name}</span> at {money(s.awarded_price ?? 0)} / {s.awarded_unit}
                  </div>
                )}
              </div>
              {s.status === "awarded" && (
                s.awarded_listing_id ? (
                  <Badge tone="green">Listed in storefront</Badge>
                ) : (
                  <Button
                    variant="maroon"
                    disabled={busy === s.id || role === "supplier"}
                    onClick={async () => {
                      setBusy(s.id);
                      setError(null);
                      try {
                        await act("listAward", { solicitationId: s.id });
                      } catch (e) {
                        setError((e as Error).message);
                      }
                      setBusy(null);
                    }}
                  >
                    List award in storefront
                  </Button>
                )
              )}
            </div>
          );
        })}
      </Card>
    </div>
  );
}
