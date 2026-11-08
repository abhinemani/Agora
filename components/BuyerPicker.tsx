"use client";

import { useState } from "react";
import type { Buyer, EntityType } from "@/lib/types";
import { BUYER_PRESETS, ENTITY_LABEL, STATES } from "@/lib/vehicles";
import { People } from "./icons";
import { useStore } from "./store";
import { Button, Card, ErrorNote, Eyebrow, IconCircle } from "./ui";

/** "Who's buying?": decides which contracts the buyer may use. */
export function BuyerPicker({ onDone, compact = false }: { onDone?: (b: Buyer) => void; compact?: boolean }) {
  const { act, db } = useStore();
  const current = db?.session.buyer;
  const [custom, setCustom] = useState(false);
  const [form, setForm] = useState<{ name: string; state: string; entity_type: EntityType; population: string }>({
    name: current?.name ?? "",
    state: current?.state ?? "NJ",
    entity_type: current?.entity_type ?? "municipality",
    population: current?.population ? String(current.population) : "",
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
          <Eyebrow>Who's buying?</Eyebrow>
          <div className="mt-1 text-lg font-semibold text-navy">Which agency is this for?</div>
          <p className="mt-1 text-sm text-slate">
            Contracts are open to different buyers: NJSTART to New Jersey public entities, Sourcewell to members nationwide, an agency's own contracts mostly to itself. We'll
            show only the ways you can actually buy.
          </p>

          <div className="mt-4 grid gap-2 sm:grid-cols-3">
            {BUYER_PRESETS.map(({ buyer, blurb }) => {
              const active = current?.name === buyer.name && current?.state === buyer.state;
              return (
                <button
                  key={buyer.name}
                  disabled={busy}
                  onClick={() => choose(buyer)}
                  className={`rounded-lg border p-3 text-left transition hover:border-navy/40 hover:shadow-card ${active ? "border-navy bg-navy-50" : "border-navy/15 bg-white"}`}
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

          {!custom ? (
            <button onClick={() => setCustom(true)} className="mt-3 text-sm font-semibold text-maroon hover:underline">
              Another agency →
            </button>
          ) : (
            <form
              className="mt-4 grid gap-3 sm:grid-cols-[1.4fr_1fr_1.2fr_0.8fr_auto] sm:items-end"
              onSubmit={(e) => {
                e.preventDefault();
                choose({ name: form.name, state: form.state, entity_type: form.entity_type, population: form.population ? Number(form.population) : null });
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
