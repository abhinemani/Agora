// What the model made of a request and its products, kept so a page doesn't ask again: the reading of a request (task
// dive_understand) by the request's item, and each product's fit verdict (task dive_fit) by the request's item and what
// the judge was shown about the product. Shared by the dive and the results page. Server-only.
//
// In memory always; with DATABASE_URL set, also in Postgres (table dive_memo), so a restart or a second server finds
// them. Each entry carries the version of the prompt that made it (READ_VERSION, FIT_VERSION in lib/dive-ai.ts): a
// changed prompt starts fresh, and a product whose name, kind or specs change is judged again.

import { createHash } from "node:crypto";
import type { DiveReading, FitVerdict } from "./dive";
import { FIT_VERSION, fitInputLine, READ_VERSION, type FitInput } from "./dive-ai";
import { hasDatabase, pool } from "./pg";

export type Reading = DiveReading & { need: string };
export type Fit = { fit: FitVerdict; reason: string; log_id?: string };
type Memo = { reads: Map<string, Reading>; fits: Map<string, Fit>; table?: Promise<boolean> };

const g = globalThis as unknown as { __agoraDiveAI?: Memo };
const memo = (): Memo => (g.__agoraDiveAI ??= { reads: new Map(), fits: new Map() });
const cap = <K, V>(m: Map<K, V>, n: number) => {
  while (m.size > n) m.delete(m.keys().next().value as K);
};
const itemKey = (item: string) => item.trim().toLowerCase();
/** A verdict's key: the request's item, the product, and a hash of the line the judge read about it. */
export const fitKey = (item: string, p: FitInput) => `${itemKey(item)}|${p.id}|${createHash("sha1").update(fitInputLine(p)).digest("hex").slice(0, 12)}`;

function table(): Promise<boolean> {
  const p = pool();
  if (!p) return Promise.resolve(false);
  return (memo().table ??= p
    .query(
      `create table if not exists dive_memo (
         kind text not null,
         version text not null,
         key text not null,
         value jsonb not null,
         made_at timestamptz not null default now(),
         primary key (kind, version, key)
       )`,
    )
    .then(() => true)
    .catch((e) => {
      console.warn("[dive-memo] no table:", (e as Error).message);
      return false;
    }));
}

/** The reading of a request, from memory only (for synchronous callers). */
export const readingNow = (item: string) => memo().reads.get(itemKey(item));
/** A product's verdict for a request, from memory only. */
export const fitNow = (item: string, p: FitInput) => memo().fits.get(fitKey(item, p));

/** The reading of a request, from memory or, failing that, Postgres. */
export async function loadReading(item: string): Promise<Reading | undefined> {
  const have = readingNow(item);
  if (have || !hasDatabase() || !(await table())) return have;
  try {
    const r = await pool()!.query<{ value: Reading }>(`select value from dive_memo where kind = 'read' and version = $1 and key = $2`, [READ_VERSION, itemKey(item)]);
    const got = r.rows[0]?.value;
    if (got) memo().reads.set(itemKey(item), got);
    return got;
  } catch (e) {
    console.warn("[dive-memo] read failed:", (e as Error).message);
    return undefined;
  }
}

/** Bring the saved verdicts for these products into memory, where Postgres has them and memory doesn't. */
export async function loadFits(item: string, products: FitInput[]): Promise<void> {
  const m = memo();
  const missing = products.map((p) => fitKey(item, p)).filter((k) => !m.fits.has(k));
  if (!missing.length || !hasDatabase() || !(await table())) return;
  try {
    const r = await pool()!.query<{ key: string; value: Fit }>(`select key, value from dive_memo where kind = 'fit' and version = $1 and key = any($2)`, [FIT_VERSION, missing]);
    for (const row of r.rows) m.fits.set(row.key, row.value);
  } catch (e) {
    console.warn("[dive-memo] fits failed:", (e as Error).message);
  }
}

/** Keep a reading, in memory and (when there's a database) in Postgres. */
export function saveReading(item: string, reading: Reading): void {
  const m = memo();
  m.reads.set(itemKey(item), reading);
  cap(m.reads, 500);
  if (hasDatabase())
    void (async () => {
      if (!(await table())) return;
      await pool()!.query(`insert into dive_memo (kind, version, key, value) values ('read', $1, $2, $3) on conflict (kind, version, key) do update set value = excluded.value, made_at = now()`, [READ_VERSION, itemKey(item), JSON.stringify(reading)]);
    })().catch((e) => console.warn("[dive-memo] save failed:", (e as Error).message));
}

/** Keep verdicts, in memory and (when there's a database) in Postgres. */
export function saveFits(item: string, verdicts: [FitInput, Fit][]): void {
  if (!verdicts.length) return;
  const m = memo();
  const rows = verdicts.map(([p, f]) => [fitKey(item, p), f] as const);
  for (const [k, f] of rows) m.fits.set(k, f);
  cap(m.fits, 5000);
  if (hasDatabase())
    void (async () => {
      if (!(await table())) return;
      await pool()!.query(
        `insert into dive_memo (kind, version, key, value) select 'fit', $1, k, v from unnest($2::text[], $3::jsonb[]) as t(k, v)
         on conflict (kind, version, key) do update set value = excluded.value, made_at = now()`,
        [FIT_VERSION, rows.map(([k]) => k), rows.map(([, f]) => JSON.stringify(f))],
      );
    })().catch((e) => console.warn("[dive-memo] save failed:", (e as Error).message));
}
