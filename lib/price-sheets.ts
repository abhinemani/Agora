// Item prices from the state programs' price sheets. The document store (lib/doc-store.ts) holds the text of every
// attachment; the ones labelled as price sheets or price lists (NJSTART, OregonBuys, Empire Procure Connect) are read
// here into rows: item, unit, price, and the line the price is printed on. A scanned price sheet is first re-read with
// the main model, so no misread amount from the smaller scan model becomes a contract price.
//
// The model (SCAN_MODEL) only proposes rows; the check decides. A row stands only when its line is in the sheet's
// stored text word for word, the price is one of the figures on that line, a word of the item's name is on the line
// too, and the figure is a price, not a discount. List prices are kept as list prices (basis list_price), never as what
// a buyer pays: the catalog shows them as "List $X · before the contract discount". A sheet
// linked to more than one contract is passed over, since its rows can't be pinned to one supplier.
//
// It runs on the server when AGORA_PRICE_SHEETS is set: "sample" reads 25 NJSTART and 15 OregonBuys sheets and reports
// the yield; "all" reads every one not read yet; a number ("500") reads that many not read yet, then stops. Rows go to the doc_prices table, /api/docs/status reports progress
// under price_sheets, and /api/docs/prices exports the rows for npm run import:doc-prices. Server-only.

import * as z from "zod/v4";
import { downloadDocument, INGEST_MAX_BYTES } from "./doc-fetch";
import { docSchema, storeDocument } from "./doc-store";
import { imageToPdf, readScan } from "./doc-ocr";
import { MODEL, modelOn, pieces, SCAN_MODEL, structured } from "./llm";
import { pool } from "./pg";

const PROGRAMS = ["NJSTART", "OregonBuys", "Empire Procure Connect"];
/** Labels that mark a price sheet or price list. */
export const PRICE_LABEL = /price ?sheet|price ?list|pricing|price schedule|schedule of prices|rate sheet|rate schedule|cost sheet|bid sheet|ps final|price line|\bprices?\b/i;
/** Labels that match but aren't price sheets: Oregon's summary page (written from the agreement's web page) and terms. */
const NOT_PRICES = /summary page|terms and conditions/i;
export const isPriceSheet = (label: string) => PRICE_LABEL.test(label) && !NOT_PRICES.test(label);
/** Characters of sheet text per request: enough rows to be worth a call, few enough that the answer fits. */
const CHUNK = 14_000;
/** Parts of one sheet sent to the model at once (AGORA_PRICE_PARTS); sheets read at once is AGORA_PRICE_WORKERS. */
const PARTS_AT_ONCE = Number(process.env.AGORA_PRICE_PARTS ?? 4);

// ------------------------------------------------------------------ the reading and the check (pure where possible)

const SYSTEM =
  `You read government contract price sheets and list the item prices on them.\n` +
  `- One row per priced item: what it is, the unit, the price, and the line it is printed on.\n` +
  `- "line": copy the single line of the text that prints this price, exactly as it appears, character for character. Don't join lines or tidy spacing.\n` +
  `- "price": the number as printed on that line, without $ or commas. If a line prints several prices (zones, tiers, years), make a row for each and say which in "note".\n` +
  `- "basis": contract_price for a fixed awarded price; net_price for a price after the contract discount; ceiling for a not-to-exceed or maximum rate; list_price for a manufacturer's or catalog list price before discount; discount when the figure is a percentage off.\n` +
  `- Skip anything that isn't an item price: totals, subtotals, quantities, estimated usage, fees, minimum orders, page numbers, dates, and blank or $0.00 price cells.\n` +
  `- Never invent an item or a price. If the sheet has no item prices, return no rows.`;

const RowSchema = z.object({
  item: z.string().describe("What is priced, in a few words, from the line or the row's description."),
  sku: z.string().nullable().describe("Part, model or item number printed on the line, or null."),
  unit: z.string().nullable().describe("each, hour, gallon, case, ton, month… as printed, or null."),
  price: z.number().describe("The price as printed on the line."),
  basis: z.enum(["contract_price", "net_price", "ceiling", "list_price", "discount"]),
  note: z.string().nullable().describe("Which price this is when a line prints several (zone, tier, year), or null."),
  line: z.string().describe("The line that prints this price, copied exactly."),
});
const Schema = z.object({ rows: z.array(RowSchema) });
export type PriceRow = z.infer<typeof RowSchema>;

const norm = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();
const STOP = new Set("the and for with each per unit item price total cost line from new all of to in a an or".split(" "));
const itemWords = (s: string) => (s.toLowerCase().match(/[a-z][a-z0-9]{2,}/g) ?? []).filter((w) => !STOP.has(w));

/** The figures on a line, with whether each is a percentage ("15%" or "15 %"). */
const figuresOn = (line: string) => [...line.matchAll(/(\d[\d,]*(?:\.\d+)?)(\s*%)?/g)].map((m) => ({ n: Number(m[1].replace(/,/g, "")), pct: Boolean(m[2]) }));

/** Why a proposed row can't stand, or null when it can. `text` is the sheet's text (or the run of it that was sent);
 * pass `normText` (the same text through norm) when checking many rows against one text. */
export function rowProblem(row: PriceRow, text: string, normText = norm(text)): string | null {
  if (!(row.price > 0)) return "no price";
  if (row.basis === "discount") return "a discount, not a price";
  const line = norm(row.line);
  if (line.length < 4) return "no line";
  if (!normText.includes(line)) return "the line isn't in the sheet";
  const same = figuresOn(row.line).filter((f) => Math.abs(f.n - row.price) < 0.005);
  if (!same.length) return "the price isn't on its line";
  // A percentage is a discount whatever the model called it.
  if (same.every((f) => f.pct)) return "the figure is a percentage";
  if (!/[a-z]{3,}/i.test(row.line)) return "the line has no words";
  if (/^[\W\d]*(grand |sub|estimated[a-z ]*)?total\b/i.test(row.line) || /\bestimated (annual |contract )?(total|usage|quantity|spend)\b/i.test(row.line)) return "a total, not an item price";
  const words = itemWords(row.item);
  if (words.length && !words.some((w) => line.includes(w))) return "the item isn't named on its line";
  return null;
}

/** A sheet's text in runs of about CHUNK characters, cut at line breaks. */
export function chunks(text: string): string[] {
  const out: string[] = [];
  let cur = "";
  for (const line of text.split("\n")) {
    if (cur.length + line.length > CHUNK && cur) {
      out.push(cur);
      cur = "";
    }
    cur += (cur ? "\n" : "") + line;
  }
  if (cur.trim()) out.push(cur);
  return out;
}

/** Read one sheet's text into checked rows. Each run is one model call, reported with pieces(). */
export async function readPriceSheet(text: string, label: string): Promise<{ rows: (PriceRow & { run: number })[]; proposed: number; dropped: Record<string, number>; examples: { why: string; item: string; price: number; line: string }[]; failed_runs: number }> {
  const examples: { why: string; item: string; price: number; line: string }[] = [];
  const kept: (PriceRow & { run: number })[] = [];
  const dropped: Record<string, number> = {};
  let proposed = 0;
  let failed = 0;
  const runs = chunks(text).slice(0, 60);
  // A sheet's parts go to the model a few at a time; the rows are checked and kept in the sheet's order afterwards.
  const ask = (run: string, i: number) =>
    structured({
      task: "price_sheet",
      about: `${label}, part ${i + 1} of ${runs.length}`,
      system: SYSTEM,
      user: `PRICE SHEET: ${label}${runs.length > 1 ? ` (part ${i + 1} of ${runs.length})` : ""}\n\n${run}`,
      schema: Schema,
      maxTokens: 24_000,
      timeoutMs: 240_000,
      effort: "low",
      model: SCAN_MODEL,
    });
  const answers: (z.infer<typeof Schema> | null)[] = new Array(runs.length).fill(null);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(PARTS_AT_ONCE, runs.length) }, async () => {
      while (next < runs.length) {
        const i = next++;
        answers[i] = await ask(runs[i], i);
      }
    }),
  );
  for (const [i, run] of runs.entries()) {
    const out = answers[i];
    if (!out) {
      failed++;
      continue;
    }
    const seen = new Set<string>();
    const normRun = norm(run);
    let good = 0;
    const why: string[] = [];
    for (const r of out.rows) {
      proposed++;
      const key = `${norm(r.line)}|${r.price}|${r.note ?? ""}`;
      const problem = seen.has(key) ? "a repeated row" : rowProblem(r, run, normRun);
      seen.add(key);
      if (problem) {
        dropped[problem] = (dropped[problem] ?? 0) + 1;
        if (examples.filter((x) => x.why === problem).length < 3) examples.push({ why: problem, item: r.item, price: r.price, line: r.line.slice(0, 200) });
        why.push(problem);
        continue;
      }
      good++;
      kept.push({ ...r, item: r.item.slice(0, 200), line: r.line.slice(0, 400), run: i + 1 });
    }
    pieces(out, `${good} of ${out.rows.length} rows kept`, good, out.rows.length, [...new Set(why)].join("; "), { declined: !out.rows.length });
  }
  return { rows: kept, proposed, dropped, examples, failed_runs: failed };
}

// ------------------------------------------------------------------ the run on the server

const state = ((globalThis as unknown as { __agoraPriceSheets?: { mode: string; phase: string; planned: number; done: number; rescanned: number; rows: number; proposed: number; skipped_shared: number; dropped: Record<string, number>; last_error: string | null } }).__agoraPriceSheets ??= {
  mode: "off",
  phase: "off",
  planned: 0,
  done: 0,
  rescanned: 0,
  rows: 0,
  proposed: 0,
  skipped_shared: 0,
  dropped: {},
  last_error: null,
});
export const priceSheetState = () => state;

async function schema(): Promise<boolean> {
  const p = pool();
  if (!p || !(await docSchema())) return false;
  await p.query(
    `create table if not exists doc_prices (
       url text not null,
       contract_id text not null,
       program text not null,
       label text,
       n int not null,
       item text not null,
       sku text,
       unit text,
       price numeric not null,
       basis text not null,
       note text,
       line text not null,
       model text not null,
       read_at timestamptz not null default now(),
       primary key (url, n)
     );
     create table if not exists doc_price_reads (
       url text primary key,
       contract_id text,
       program text,
       label text,
       sample boolean not null default false,
       rows int not null default 0,
       proposed int not null default 0,
       dropped jsonb,
       error text,
       read_at timestamptz not null default now()
     );`,
  );
  return true;
}

/** Start the price-sheet reading if AGORA_PRICE_SHEETS asks for it ("sample", "all" or a number of sheets). */
export function startPriceSheets(): void {
  const mode = process.env.AGORA_PRICE_SHEETS ?? "";
  if (!(["sample", "all"].includes(mode) || /^\d+$/.test(mode)) || state.phase !== "off" || !pool()) return;
  state.mode = mode;
  state.phase = "waiting";
  setTimeout(() => {
    runPriceSheets(mode as Mode).catch((e) => {
      state.phase = "stopped";
      state.last_error = (e as Error).message;
      console.error("[prices] stopped:", (e as Error).message);
    });
  }, 120_000);
}

interface Sheet { url: string; contract_id: string; program: string; label: string; links: number; via: string; read_by: string | null; filename: string | null }

/** The run itself (startPriceSheets calls it after a pause; exported for tests). */
/** "sample", "all", or a number of sheets not yet read ("500"), after which the run stops. */
type Mode = "sample" | "all" | `${number}`;
export async function runPriceSheets(mode: Mode): Promise<void> {
  if (!modelOn()) {
    state.phase = "off";
    state.last_error = "no API key";
    return;
  }
  if (!(await schema())) throw new Error("the price tables couldn't be created");
  const p = pool()!;
  // Every stored document labelled as prices on these programs' contracts, not yet read.
  const found = (
    await p.query<Sheet>(
      `select u.url, min(l.contract_id) contract_id, min(l.program) program, min(l.label) label, count(distinct l.contract_id)::int links, u.via, u.read_by, u.filename
       from doc_urls u join doc_links l on l.url = u.url
       where u.status = 'text' and l.program = any($1)
         and not exists (select 1 from doc_price_reads r where r.url = u.url)
       group by u.url, u.via, u.read_by, u.filename
       order by md5(u.url)`,
      [PROGRAMS],
    )
  ).rows;
  const fresh = found.filter((s) => isPriceSheet(s.label));
  // Sheets read before list prices were kept, whose list prices were dropped: read again, ahead of the rest and not
  // counted against a number of sheets. Clearing their records puts them back among the unread.
  const LIST_DROPPED = "a list price, not what a buyer pays";
  const again = (await p.query<{ url: string }>(`select url from doc_price_reads where dropped ? $1`, [LIST_DROPPED])).rows.map((r) => r.url);
  let reread: Sheet[] = [];
  if (again.length) {
    reread = (
      await p.query<Sheet>(
        `select u.url, min(l.contract_id) contract_id, min(l.program) program, min(l.label) label, count(distinct l.contract_id)::int links, u.via, u.read_by, u.filename
         from doc_urls u join doc_links l on l.url = u.url where u.url = any($1) group by u.url, u.via, u.read_by, u.filename`,
        [again],
      )
    ).rows;
    await p.query(`delete from doc_prices where url = any($1)`, [again]);
    await p.query(`delete from doc_price_reads where url = any($1)`, [again]);
    console.log(`[prices] reading ${reread.length} sheets again for their list prices`);
  }
  const all = fresh;
  const sheets =
    [...reread, ...(mode === "sample" ? [...all.filter((s) => s.program === "NJSTART").slice(0, 25), ...all.filter((s) => s.program === "OregonBuys").slice(0, 15)] : mode === "all" ? all : all.slice(0, Number(mode)))];
  state.planned = sheets.length;
  state.phase = "reading";
  console.log(`[prices] reading ${sheets.length} price sheets (${mode})`);
  let next = 0;
  const worker = async () => {
    while (next < sheets.length) {
      const s = sheets[next++];
      for (let i = 0; i < 40 && process.memoryUsage().heapUsed / 1048576 > 2500; i++) await new Promise((r) => setTimeout(r, 15_000));
      await readOne(s, mode === "sample" && !reread.includes(s)).catch((e) => {
        state.last_error = (e as Error).message;
      });
      state.done++;
    }
  };
  await Promise.all(Array.from({ length: Number(process.env.AGORA_PRICE_WORKERS ?? 8) }, worker));
  state.phase = "done";
  console.log(`[prices] done: ${state.rows} rows from ${state.done} sheets`);
}

async function readOne(s: Sheet, sample: boolean): Promise<void> {
  const p = pool()!;
  const record = (fields: { rows?: number; proposed?: number; dropped?: Record<string, number>; error?: string }) =>
    p.query(
      `insert into doc_price_reads (url, contract_id, program, label, sample, rows, proposed, dropped, error) values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       on conflict (url) do update set rows = excluded.rows, proposed = excluded.proposed, dropped = excluded.dropped, error = excluded.error, read_at = now()`,
      [s.url, s.contract_id, s.program, s.label, sample, fields.rows ?? 0, fields.proposed ?? 0, JSON.stringify(fields.dropped ?? {}), fields.error ?? null],
    );
  if (s.links > 1) {
    state.skipped_shared++;
    await record({ error: "linked to more than one contract" });
    return;
  }
  // A scan read by the smaller model is read again by the main model before any price comes from it.
  if (s.via === "scan" && s.read_by !== MODEL) {
    const { buffer: raw, filename } = await downloadDocument(s.url, INGEST_MAX_BYTES);
    const buffer = /\.(jpe?g|png)$/i.test(filename) ? await imageToPdf(raw, filename) : raw;
    const got = await readScan(buffer, s.label, MODEL);
    if (!got.pages.length) {
      await record({ error: "the main model couldn't read the scan" });
      return;
    }
    await storeDocument(s.url, { pages: got.pages, filename, bytes: buffer.length, via: "scan", readBy: MODEL });
    state.rescanned++;
  }
  const text = (await p.query<{ text: string }>(`select string_agg(d.text, '\n' order by d.num, d.part) as text from doc_urls u join doc_pages d on d.hash = u.hash where u.url = $1`, [s.url])).rows[0]?.text ?? "";
  if (!text.trim()) {
    await record({ error: "no text" });
    return;
  }
  const got = await readPriceSheet(text, s.label);
  state.proposed += got.proposed;
  for (const [k, v] of Object.entries(got.dropped)) state.dropped[k] = (state.dropped[k] ?? 0) + v;
  for (const [n, r] of got.rows.entries())
    await p.query(
      `insert into doc_prices (url, contract_id, program, label, n, item, sku, unit, price, basis, note, line, model) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) on conflict (url, n) do nothing`,
      [s.url, s.contract_id, s.program, s.label, n, r.item, r.sku, r.unit, r.price, r.basis, r.note, r.line, SCAN_MODEL],
    );
  state.rows += got.rows.length;
  await record({ rows: got.rows.length, proposed: got.proposed, dropped: got.dropped, error: got.failed_runs ? `${got.failed_runs} part(s) unanswered` : undefined });
}

/** Progress and yield, for /api/docs/status. */
export async function priceSheetSummary(): Promise<Record<string, unknown>> {
  const p = pool();
  if (!p) return { ...state };
  const ok = (await p.query(`select to_regclass('doc_price_reads') is not null as ok`)).rows[0].ok;
  if (!ok) return { ...state };
  const by = await p.query<{ program: string; sample: boolean; sheets: string; with_rows: string; rows: string; proposed: string }>(
    `select program, sample, count(*) sheets, count(*) filter (where rows > 0) with_rows, sum(rows) rows, sum(proposed) proposed from doc_price_reads group by 1, 2 order by 1, 2`,
  );
  return { ...state, by_program: by.rows.map((r) => ({ program: r.program, sample: r.sample, sheets: Number(r.sheets), sheets_with_rows: Number(r.with_rows), rows_kept: Number(r.rows), rows_proposed: Number(r.proposed) })) };
}

/** Kept rows a page at a time, for the export npm run import:doc-prices reads. */
export async function exportPrices(offset = 0, limit = 10_000): Promise<{ total: number; offset: number; rows: Record<string, unknown>[] }> {
  const p = pool();
  if (!p || !(await schema())) return { total: 0, offset, rows: [] };
  const total = Number((await p.query(`select count(*) n from doc_prices`)).rows[0].n);
  const r = await p.query(
    `select url, contract_id, program, label, n, item, sku, unit, price::float8 as price, basis, note, line, model, to_char(read_at, 'YYYY-MM-DD') as read_on
     from doc_prices order by contract_id, url, n offset $1 limit $2`,
    [offset, limit],
  );
  return { total, offset, rows: r.rows };
}
