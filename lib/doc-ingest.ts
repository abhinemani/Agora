// Fills the document store (lib/doc-store.ts) on the server: the text of every document linked to a TRX
// program's contracts (NJSTART, OregonBuys, Hawaii SPO, Arkansas OSP, NYS OGS, Empire Procure Connect).
//
// It starts a minute after the server does, when DATABASE_URL is set, and picks up where it left off after a
// restart: documents already stored, or tried and not worth retrying yet, are skipped. First it records which
// contract links to which document; then it stores the text Agora already holds (seed/catalog/doctext), which
// needs no fetching; then it fetches the rest from their publishers, two at a time per host with a pause between
// requests, price sheets first. Alongside, scanned PDFs (no text layer) are read by Claude (lib/doc-ocr.ts) when an
// API key is set, three at a time, up to AGORA_OCR_PAGE_LIMIT pages in all (default 150,000; AGORA_OCR=off turns
// it off). It stops filling the database before the volume runs out (AGORA_DOC_DB_LIMIT_MB, default 4,000).
// AGORA_DOC_INGEST=off turns all of it off. Server-only.

import { catalogTrxDocuments } from "./catalog";
import { databaseMb, docSchema, linkDocuments, scanNotRead, scanPagesRead, scansToRead, settledUrls, storeDocument } from "./doc-store";
import { downloadDocument, fetchDocument, INGEST_MAX_BYTES } from "./doc-fetch";
import { readScan } from "./doc-ocr";
import { modelOn } from "./llm";
import { fetchable, heldPages } from "./docs";
import { hasDatabase } from "./pg";

interface IngestState {
  started: boolean;
  phase: "waiting" | "linking" | "held" | "fetching" | "done" | "stopped" | "off";
  started_at: string | null;
  queued: number;
  done: number;
  stored: number;
  not_read: Record<string, number>;
  by_host: Record<string, { queued: number; done: number }>;
  stopped_reason: string | null;
  last_error: string | null;
  scans: { phase: "off" | "waiting" | "reading" | "done" | "stopped"; read: number; pages: number; not_read: number; last_error: string | null; stopped_reason: string | null };
}
const g = globalThis as unknown as { __agoraIngest?: IngestState };
const state: IngestState = (g.__agoraIngest ??= { started: false, phase: "off", started_at: null, queued: 0, done: 0, stored: 0, not_read: {}, by_host: {}, stopped_reason: null, last_error: null, scans: { phase: "off", read: 0, pages: 0, not_read: 0, last_error: null, stopped_reason: null } });

export const ingestState = (): IngestState => state;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const LIMIT_MB = Number(process.env.AGORA_DOC_DB_LIMIT_MB ?? 4000);
const PER_HOST = Number(process.env.AGORA_DOC_PER_HOST ?? 2);
const PAUSE_MS = Number(process.env.AGORA_DOC_PAUSE_MS ?? 1500);
/** For a test run: fetch at most this many documents per host. */
const FETCH_LIMIT = Number(process.env.AGORA_DOC_FETCH_LIMIT ?? Infinity);
const OCR_PAGE_LIMIT = Number(process.env.AGORA_OCR_PAGE_LIMIT ?? 150_000);
const OCR_WORKERS = Number(process.env.AGORA_OCR_WORKERS ?? 3);
/** Price sheets and price lists first: they're what search most needs. */
const priority = (label: string) => (/price|pricing|cost|rate|catalog|bid sheet|ps final|offer/i.test(label) ? 0 : /method of operation|terms|contract|agreement|specification|scope/i.test(label) ? 1 : 2);

export function startDocIngest(): void {
  if (state.started) return;
  if (!hasDatabase() || process.env.AGORA_DOC_INGEST === "off") return;
  state.started = true;
  state.phase = "waiting";
  setTimeout(() => {
    run().catch((e) => {
      state.phase = "stopped";
      state.stopped_reason = (e as Error).message;
      console.error("[ingest] stopped:", (e as Error).message);
    });
  }, Number(process.env.AGORA_DOC_INGEST_DELAY_MS ?? 60_000));
}

async function tooBig(): Promise<boolean> {
  const mb = await databaseMb().catch(() => null);
  if (mb != null && mb >= LIMIT_MB) {
    state.phase = "stopped";
    state.stopped_reason = `the database reached ${mb} MB (limit ${LIMIT_MB} MB)`;
    console.error(`[ingest] stopped: ${state.stopped_reason}`);
    return true;
  }
  return false;
}

async function run(): Promise<void> {
  if (!(await docSchema())) throw new Error("the document tables couldn't be created");
  state.started_at = new Date().toISOString();
  state.phase = "linking";
  const docs = catalogTrxDocuments();
  await linkDocuments(docs);
  const settled = await settledUrls();
  const labels = new Map<string, string>();
  for (const d of docs) if (!settled.has(d.url) && !labels.has(d.url)) labels.set(d.url, d.label);
  console.log(`[ingest] ${docs.length} document links on TRX contracts, ${new Set(docs.map((d) => d.url)).size} URLs, ${labels.size} still to store`);

  // Text Agora already holds.
  state.phase = "held";
  const toFetch: string[] = [];
  for (const url of labels.keys()) {
    const pages = heldPages(url);
    if (pages) {
      await storeDocument(url, { pages });
      state.stored++;
    } else if (fetchable(url)) toFetch.push(url);
  }
  if (await tooBig()) return;

  // Scans, read by Claude as they turn up, while the fetching goes on.
  let fetching = true;
  const scans = readScans(() => fetching).catch((e) => {
    state.scans.phase = "stopped";
    state.scans.stopped_reason = (e as Error).message;
    console.error("[ingest] scan reading stopped:", (e as Error).message);
  });

  // The rest, from their publishers.
  state.phase = "fetching";
  const byHost = new Map<string, string[]>();
  for (const url of toFetch.sort((a, b) => priority(labels.get(a)!) - priority(labels.get(b)!))) {
    const host = new URL(url).host;
    const list = byHost.get(host) ?? byHost.set(host, []).get(host)!;
    if (list.length < FETCH_LIMIT) list.push(url);
  }
  state.queued = [...byHost.values()].reduce((n, u) => n + u.length, 0);
  for (const [host, urls] of byHost) state.by_host[host] = { queued: urls.length, done: 0 };
  console.log(`[ingest] fetching ${state.queued} documents from ${[...byHost].map(([h, u]) => `${h} (${u.length})`).join(", ")}`);
  let stop = false;
  const worker = async (host: string, urls: string[]) => {
    while (!stop) {
      const url = urls.shift();
      if (!url) return;
      try {
        const got = await fetchDocument(url, INGEST_MAX_BYTES);
        await storeDocument(url, got);
        state.stored++;
      } catch (e) {
        const err = e as Error & { status?: string; filename?: string; bytes?: number };
        const status = (err.status ?? "failed") as "scan" | "unsupported" | "too_large" | "failed";
        state.not_read[status] = (state.not_read[status] ?? 0) + 1;
        state.last_error = `${host}: ${err.message}`;
        await storeDocument(url, { status, detail: err.message, filename: err.filename, bytes: err.bytes }).catch(() => undefined);
      }
      state.done++;
      state.by_host[host].done++;
      if (state.done % 100 === 0) {
        console.log(`[ingest] ${state.done} of ${state.queued} fetched (${state.stored} stored in all)`);
        if (await tooBig()) stop = true;
      }
      await sleep(PAUSE_MS);
    }
  };
  await Promise.all([...byHost].flatMap(([host, urls]) => Array.from({ length: PER_HOST }, () => worker(host, urls))));
  fetching = false;
  if (!stop) {
    state.phase = "done";
    console.log(`[ingest] done fetching: ${state.stored} stored, not read: ${JSON.stringify(state.not_read)}`);
  }
  await scans;
}

/** Read scanned documents with Claude until none are left and fetching has finished (or a limit is reached). */
async function readScans(stillFetching: () => boolean): Promise<void> {
  const sc = state.scans;
  if (process.env.AGORA_OCR === "off" || !modelOn()) {
    sc.phase = "off";
    sc.stopped_reason = process.env.AGORA_OCR === "off" ? "turned off (AGORA_OCR=off)" : "no API key";
    return;
  }
  sc.phase = "waiting";
  const inFlight = new Set<string>();
  const one = async (url: string, label: string) => {
    try {
      const { buffer, filename } = await downloadDocument(url, INGEST_MAX_BYTES);
      if (!/\.pdf$/i.test(filename)) throw new Error(`${filename} isn't a PDF`);
      const got = await readScan(buffer, label);
      if (!got.pages.length) throw new Error(got.failed_runs ? "Claude couldn't read it" : "no page had readable text");
      await storeDocument(url, { pages: got.pages, filename, bytes: buffer.length, via: "scan" });
      sc.read++;
      sc.pages += got.page_count;
    } catch (e) {
      sc.not_read++;
      sc.last_error = (e as Error).message;
      await scanNotRead(url, `read from a scan: ${(e as Error).message}`).catch(() => undefined);
    }
  };
  for (;;) {
    if ((await scanPagesRead()) >= OCR_PAGE_LIMIT) {
      sc.phase = "stopped";
      sc.stopped_reason = `reached ${OCR_PAGE_LIMIT.toLocaleString()} scanned pages (AGORA_OCR_PAGE_LIMIT)`;
      return;
    }
    if (await tooBig()) {
      sc.phase = "stopped";
      sc.stopped_reason = state.stopped_reason;
      return;
    }
    const batch = (await scansToRead(OCR_WORKERS * 4)).filter((x) => !inFlight.has(x.url));
    if (!batch.length) {
      if (!stillFetching()) {
        sc.phase = "done";
        console.log(`[ingest] scans done: ${sc.read} read (${sc.pages} pages), ${sc.not_read} not read`);
        return;
      }
      sc.phase = "waiting";
      await sleep(60_000);
      continue;
    }
    // A safeguard: if the first ten scans all fail, something is wrong with the request, not the scans. Stop rather than spend.
    if (sc.read === 0 && sc.not_read >= 10) {
      sc.phase = "stopped";
      sc.stopped_reason = `the first ${sc.not_read} scans all failed (last: ${sc.last_error})`;
      console.error(`[ingest] scan reading stopped: ${sc.stopped_reason}`);
      return;
    }
    sc.phase = "reading";
    // A small pool: at most OCR_WORKERS documents at once.
    let next = 0;
    await Promise.all(
      Array.from({ length: Math.min(OCR_WORKERS, batch.length) }, async () => {
        while (next < batch.length) {
          const { url, label } = batch[next++];
          inFlight.add(url);
          await one(url, label);
          inFlight.delete(url);
        }
      }),
    );
    if (sc.read && sc.read % 25 === 0) console.log(`[ingest] ${sc.read} scans read (${sc.pages} pages)`);
  }
}
