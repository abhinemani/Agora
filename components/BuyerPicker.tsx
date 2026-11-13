"use client";

import { useState } from "react";
import type { Buyer, EntityType } from "@/lib/types";
import { BUYER_PRESETS, ENTITY_LABEL, STATES } from "@/lib/vehicles";
import { DirectorySearch } from "./DirectorySearch";
import { People } from "./icons";
import { useStore } from "./store";
import { Button, Card, ErrorNote, IconCircle } from "./ui";

/** "Who's buying?": decides which contracts the buyer may use. */
export function BuyerPicker({ onDone, onClose, compact = false }: { onDone?: (b: Buyer | null) => void; onClose?: () => void; compact?: boolean }) {
  const { act, db } = useStore();
  const current = db?.session.buyer;
  const [custom, setCustom] = useState(false);
  const [form, setForm] = useState<{ name: string; state: string; entity_type: EntityType; population: string; domain: string }>({
    name: current?.name ?? "",
    state: current?.state ?? "NJ",
    entity_type: current?.entity_type ?? "municipality",
    population: current?.population ? String(current.population) : "",
    domain: current?.domain ?? "",
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const choose = async (b: Buyer) => {
    setBusy(true);
    setError(null);
    try {
      const saved = await act<Buyer>("setBuyer", { buyer: b });
      onDone?.(saved);
    } catch (e) {
      setError((e as Error).message);
    }
    setBusy(false);
  };

  return (
    <Card accent="maroon" className="p-5">
      <div className="flex gap-4">
        {!compact && (
          <IconCircle>
            <People />
          </IconCircle>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-4">
            <div className="text-lg font-semibold text-navy">Set your agency (optional)</div>
            {onClose && (
              <button onClick={onClose} className="text-sm text-slate hover:text-navy" aria-label="Close">
                Close
              </button>
            )}
          </div>
          <p className="mt-1 text-sm text-slate">
            Agora searches every contract by default. Contracts are open to different buyers (NJSTART to New Jersey public entities, Sourcewell to members nationwide), so
            setting your agency shows only the ways you can actually buy.
          </p>

          <div className="mt-4 grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
            <button
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                await act("clearBuyer");
                setBusy(false);
                onDone?.(null);
              }}
              className={`rounded-lg border p-3 text-left transition hover:border-navy/40 ${!current ? "border-primary bg-primary-lighter" : "border-line bg-white"}`}
            >
              <div className="text-sm font-semibold text-navy">Any agency</div>
              <div className="text-[11px] text-slate">Every contract in Agora</div>
              <div className="mt-1 text-xs text-slate">Shows who each contract is open to</div>
            </button>
            {BUYER_PRESETS.map(({ buyer, blurb }) => {
              const active = current?.name === buyer.name && current?.state === buyer.state;
              return (
                <button
                  key={buyer.name}
                  disabled={busy}
                  onClick={() => choose(buyer)}
                  className={`rounded-lg border p-3 text-left transition hover:border-navy/40 hover:shadow-card ${active ? "border-primary bg-primary-lighter" : "border-navy/15 bg-white"}`}
                >
                  <div className="text-sm font-semibold text-navy">
                    {buyer.name}, {buyer.state}
                  </div>
                  <div className="text-[11px] text-slate">
                    {ENTITY_LABEL[buyer.entity_type]}
                    {buyer.population ? ` · pop. ${buyer.population.toLocaleString()}` : ""}
                  </div>
                  <div className="mt-1 text-xs text-slate">{blurb}</div>
                </button>
              );
            })}
          </div>

          <div className="mt-4 max-w-xl">
            <DirectorySearch
              label="Or find yours among 130,000 governments"
              onPick={(g) =>
                choose({ name: g.name, state: g.state, entity_type: g.entity_type, population: null, domain: g.domain, directory_id: g.id })
              }
            />
            <p className="mt-1 text-[11px] text-slate">Picking your agency brings in the co-ops it's on, from published rosters and its own procurement pages.</p>
          </div>

          {!custom ? (
            <button onClick={() => setCustom(true)} className="mt-3 text-sm font-semibold text-maroon hover:underline">
              Not listed? Enter it by hand →
            </button>
          ) : (
            <form
              className="mt-4 grid gap-3 sm:grid-cols-2 sm:items-end lg:grid-cols-[1.4fr_1fr_1.2fr_0.8fr_1.2fr_auto]"
              onSubmit={(e) => {
                e.preventDefault();
                choose({ name: form.name, state: form.state, entity_type: form.entity_type, population: form.population ? Number(form.population) : null, domain: form.domain || undefined });
              }}
            >
              <label className="block text-xs font-semibold text-slate">
                Agency
                <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Borough of Example" className="mt-1 w-full" />
              </label>
              <label className="block text-xs font-semibold text-slate">
                State
                <select value={form.state} onChange={(e) => setForm({ ...form, state: e.target.value })} className="mt-1 w-full">
                  {STATES.map(([c, n]) => (
                    <option key={c} value={c}>
                      {n}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-xs font-semibold text-slate">
                Type
                <select value={form.entity_type} onChange={(e) => setForm({ ...form, entity_type: e.target.value as EntityType })} className="mt-1 w-full">
                  {(Object.keys(ENTITY_LABEL) as EntityType[]).map((t) => (
                    <option key={t} value={t}>
                      {ENTITY_LABEL[t]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-xs font-semibold text-slate">
                Population
                <input type="number" min={0} value={form.population} onChange={(e) => setForm({ ...form, population: e.target.value })} placeholder="optional" className="mt-1 w-full" />
              </label>
              <label className="block text-xs font-semibold text-slate">
                Website
                <input value={form.domain} onChange={(e) => setForm({ ...form, domain: e.target.value })} placeholder="finds your co-ops" className="mt-1 w-full" />
              </label>
              <Button type="submit" disabled={busy || !form.name.trim()}>
                Use this agency
              </Button>
            </form>
          )}
          <div className="mt-3">
            <ErrorNote message={error} />
          </div>
        </div>
      </div>
    </Card>
  );
}
