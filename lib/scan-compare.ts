// How much the smaller scan model gives up against the main model's readings. The main model read the first few
// hundred scans before the switch (doc_urls.read_by = MODEL); those are the reference set. This re-reads a sample of
// them with SCAN_MODEL, never overwriting what is stored, and compares the two: words, numbers, and above all dollar
// amounts, with any that look like a misread digit ($33.28 against $38.28). Price sheets are half the sample, since
// that is where a misreading would become a wrong contract price.
//
// It runs once on the server when AGORA_SCAN_COMPARE is set to the sample size, compares only scans it hasn't
// compared yet for the current scan model, and writes each result to scan_compare. /api/docs/status reports the
// summary. Server-only.

import { downloadDocument, INGEST_MAX_BYTES } from "./doc-fetch";
import { docSchema } from "./doc-store";
import { imageToPdf, readScan } from "./doc-ocr";
import { MODEL, modelOn, SCAN_MODEL } from "./llm";
import { pool } from "./pg";

// ------------------------------------------------------------------ the comparison (pure, so it can be tested)

const words = (t: string) => t.toLowerCase().match(/[a-z0-9]+/g) ?? [];
/** Dollar amounts with cents, as printed ("$1,234.50" and "$ 1234.50" are the same amount). */
const prices = (t: string) => (t.match(/\$\s?\d[\d,]*\.\d{2}\b/g) ?? []).map((p) => p.replace(/[\s,]/g, ""));
/** Numbers of two digits or more, commas dropped: page numbers and list markers are mostly single digits. */
const numbers = (t: string) => (t.match(/\d[\d,]*(?:\.\d+)?/g) ?? []).map((n) => n.replace(/,/g, "")).filter((n) => n.replace(/\D/g, "").length >= 2);

function bag(xs: string[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const x of xs) m.set(x, (m.get(x) ?? 0) + 1);
  return m;
}
/** How many items the two lists share, counting repeats. */
function shared(a: string[], b: string[]): number {
  const mb = bag(b);
  let n = 0;
  for (const [x, c] of bag(a)) n += Math.min(c, mb.get(x) ?? 0);
  return n;
}
/** Two amounts that differ in one digit, or by two neighbouring digits swapped: a misreading, not a different price. */
function nearMiss(a: string, b: string): boolean {
  if (a === b || a.length !== b.length) return false;
  const diff = [...a].map((c, i) => (c === b[i] ? -1 : i)).filter((i) => i >= 0);
  if (diff.length === 1) return /\d/.test(a[diff[0]]) && /\d/.test(b[diff[0]]);
  return diff.length === 2 && diff[1] === diff[0] + 1 && a[diff[0]] === b[diff[1]] && a[diff[1]] === b[diff[0]];
}

export interface Comparison {
  /** Word overlap, 0 to 1 (F1 over the two bags of words). */
  words_f1: number;
  /** Of the reference's numbers, the share the new reading has; and of the new reading's, the share the reference has. */
  numbers_recall: number;
  numbers_precision: number;
  /** Dollar amounts in the reference, how many the new reading has exactly, and amounts only the new reading has. */
  prices_ref: number;
  prices_matched: number;
  prices_extra: number;
  /** Reference amounts the new reading has with a digit wrong: [reference, new]. */
  near_misses: [string, string][];
}

export function compareReadings(reference: string, reading: string): Comparison {
  const wr = words(reference);
  const wn = words(reading);
  const common = shared(wr, wn);
  const f1 = wr.length + wn.length ? (2 * common) / (wr.length + wn.length) : 1;
  const nr = numbers(reference);
  const nn = numbers(reading);
  const nCommon = shared(nr, nn);
  const pr = prices(reference);
  const pn = prices(reading);
  const matched = shared(pr, pn);
  // Amounts left on each side once the exact matches are taken out.
  const leftRef = [...pr];
  const leftNew = [...pn];
  for (const p of pn) {
    const i = leftRef.indexOf(p);
    if (i >= 0) {
      leftRef.splice(i, 1);
      leftNew.splice(leftNew.indexOf(p), 1);
    }
  }
  const near: [string, string][] = [];
  for (const r of leftRef) {
    const j = leftNew.findIndex((n) => nearMiss(r, n));
    if (j >= 0) near.push([r, leftNew.splice(j, 1)[0]]);
  }
  return {
    words_f1: Math.round(f1 * 1000) / 1000,
    numbers_recall: nr.length ? Math.round((nCommon / nr.length) * 1000) / 1000 : 1,
    numbers_precision: nn.length ? Math.round((nCommon / nn.length) * 1000) / 1000 : 1,
    prices_ref: pr.length,
    prices_matched: matched,
    prices_extra: pn.length - matched,
    near_misses: near,
  };
}

// ------------------------------------------------------------------ the run on the server

const PRICE_LABEL = /price|pricing|cost|rate|bid sheet|schedule|offer|quote/i;
const state = ((globalThis as unknown as { __agoraScanCompare?: { phase: string; done: number; planned: number; last_error: string | null } }).__agoraScanCompare ??= { phase: "off", done: 0, planned: 0, last_error: null });
export const scanCompareState = () => state;

async function schema(): Promise<boolean> {
  const p = pool();
  if (!p || !(await docSchema())) return false;
  await p.query(
    `create table if not exists scan_compare (
       url text not null,
       ref_model text not null,
       new_model text not null,
       label text,
       price_doc boolean not null,
       pages_ref int,
       pages_new int,
       words_f1 real,
       numbers_recall real,
       numbers_precision real,
       prices_ref int,
       prices_matched int,
       prices_extra int,
       near_misses jsonb,
       error text,
       compared_at timestamptz not null default now(),
       primary key (url, new_model)
     )`,
  );
  return true;
}

/** Start the comparison if AGORA_SCAN_COMPARE asks for one. */
export function startScanComparison(): void {
  const n = Number(process.env.AGORA_SCAN_COMPARE ?? 0);
  if (!n || state.phase !== "off" || !pool()) return;
  if (SCAN_MODEL === MODEL) return;
  state.phase = "waiting";
  setTimeout(() => {
    run(n).catch((e) => {
      state.phase = "stopped";
      state.last_error = (e as Error).message;
      console.error("[compare] stopped:", (e as Error).message);
    });
  }, 90_000);
}

async function run(n: number): Promise<void> {
  if (!modelOn()) {
    state.phase = "off";
    state.last_error = "no API key";
    return;
  }
  if (!(await schema())) throw new Error("the comparison table couldn't be created");
  const p = pool()!;
  // Half price sheets (or as many as there are), half the rest, from reference scans not compared yet for this model.
  const pick = async (price: boolean, limit: number) =>
    (
      await p.query<{ url: string; hash: string; label: string }>(
        `select u.url, u.hash, coalesce((select l.label from doc_links l where l.url = u.url limit 1), u.filename, '') as label
         from doc_urls u
         where u.via = 'scan' and u.status = 'text' and u.read_by = $1
           and not exists (select 1 from scan_compare c where c.url = u.url and c.new_model = $2)
           and (coalesce((select l.label from doc_links l where l.url = u.url limit 1), u.filename, '') ~* $3) = $4
         order by md5(u.url) limit $5`,
        [MODEL, SCAN_MODEL, PRICE_LABEL.source, price, limit],
      )
    ).rows;
  const prices = await pick(true, Math.ceil(n / 2));
  const others = await pick(false, n - prices.length);
  const sample = [...prices.map((x) => ({ ...x, price: true })), ...others.map((x) => ({ ...x, price: false }))];
  state.planned = sample.length;
  state.phase = "comparing";
  console.log(`[compare] re-reading ${sample.length} reference scans (${prices.length} price sheets) with the scan model`);
  for (const s of sample) {
    // The web server shares this process: wait while the heap is high.
    for (let i = 0; i < 40 && process.memoryUsage().heapUsed / 1048576 > 2500; i++) await new Promise((r) => setTimeout(r, 15_000));
    let row: Record<string, unknown> = { error: null };
    try {
      const ref = await p.query<{ num: number; text: string }>(`select num, string_agg(text, '' order by part) as text from doc_pages where hash = $1 group by num order by num`, [s.hash]);
      const { buffer: raw, filename } = await downloadDocument(s.url, INGEST_MAX_BYTES);
      const buffer = /\.(jpe?g|png)$/i.test(filename) ? await imageToPdf(raw, filename) : raw;
      const got = await readScan(buffer, s.label || filename);
      const c = compareReadings(ref.rows.map((r) => r.text).join("\n\n"), got.pages.map((pg) => pg.text).join("\n\n"));
      row = { pages_ref: ref.rows.length, pages_new: got.pages.length, ...c, near_misses: JSON.stringify(c.near_misses) };
    } catch (e) {
      row = { error: (e as Error).message.slice(0, 300) };
      state.last_error = (e as Error).message;
    }
    await p.query(
      `insert into scan_compare (url, ref_model, new_model, label, price_doc, pages_ref, pages_new, words_f1, numbers_recall, numbers_precision, prices_ref, prices_matched, prices_extra, near_misses, error)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15) on conflict (url, new_model) do nothing`,
      [s.url, MODEL, SCAN_MODEL, s.label.slice(0, 300), s.price, row.pages_ref ?? null, row.pages_new ?? null, row.words_f1 ?? null, row.numbers_recall ?? null, row.numbers_precision ?? null, row.prices_ref ?? null, row.prices_matched ?? null, row.prices_extra ?? null, row.near_misses ?? null, row.error],
    );
    state.done++;
  }
  state.phase = "done";
  console.log(`[compare] done: ${state.done} compared`);
}

/** The results so far, for /api/docs/status: overall, price sheets apart, and the five scans whose amounts agree least. */
export async function scanCompareSummary(): Promise<Record<string, unknown> | null> {
  const p = pool();
  if (!p) return null;
  const exists = await p.query(`select to_regclass('scan_compare') is not null as ok`);
  if (!exists.rows[0].ok) return { ...state };
  const groups = await p.query<Record<string, string | null>>(
    `select case when price_doc then 'price_sheets' else 'other_scans' end as grp, count(*) filter (where error is null) compared, count(*) filter (where error is not null) errors,
            round(avg(words_f1)::numeric, 3) words, round(avg(numbers_recall)::numeric, 3) numbers_found, round(avg(numbers_precision)::numeric, 3) numbers_correct,
            sum(prices_ref) prices_ref, sum(prices_matched) prices_matched, sum(prices_extra) prices_extra,
            sum(jsonb_array_length(coalesce(near_misses, '[]'::jsonb))) prices_misread
     from scan_compare where new_model = $1 group by 1`,
    [SCAN_MODEL],
  );
  const worst = await p.query<{ label: string; prices_ref: number; prices_matched: number; words_f1: number; near_misses: unknown }>(
    `select label, prices_ref, prices_matched, words_f1, near_misses from scan_compare
     where new_model = $1 and error is null and prices_ref > 0 order by prices_matched::real / prices_ref, words_f1 limit 5`,
    [SCAN_MODEL],
  );
  return {
    ...state,
    reference_model: MODEL,
    scan_model: SCAN_MODEL,
    groups: Object.fromEntries(groups.rows.map((g) => [g.grp, Object.fromEntries(Object.entries(g).filter(([k]) => k !== "grp").map(([k, v]) => [k, v === null ? null : Number(v)]))])),
    least_agreement: worst.rows,
  };
}
