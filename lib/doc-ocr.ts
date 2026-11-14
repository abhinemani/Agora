// Scanned contract documents into searchable text. A PDF with no text layer (a signed agreement, an
// amendment printed and scanned) is split into short runs of pages, and Claude transcribes each run
// through structured() (lib/llm.ts). What it returns is checked page by page: a page must be one of
// the pages sent, appear once, and carry text; anything else is dropped. The text goes into the
// document store marked as read from a scan (lib/doc-ingest.ts). Server-only.

import { PDFDocument } from "pdf-lib";
import * as z from "zod/v4";
import type { Page } from "./docs";
import { pieces, structured } from "./llm";

/** Pages per request: enough to keep the request count down, few enough that a dense run of price tables fits the answer. */
const RUN = 10;
const MAX_PAGES = 600;

const SYSTEM =
  `You transcribe scanned government contract documents into plain text, so they can be searched.\n` +
  `- Transcribe every page you're given, in reading order, exactly as printed: numbers, prices, dates, names, part and contract numbers and punctuation as they appear.\n` +
  `- Keep each table row on one line, with cells separated by " | ".\n` +
  `- Don't summarize, correct, translate, reorder or add anything, and don't describe the page. Write [illegible] for words you can't read.\n` +
  `- A blank page, or one with only a signature, initials or a stamp: give what is printed (a name under a signature line, a date), or an empty string, and set legible to false.`;

const Schema = z.object({
  pages: z.array(
    z.object({
      page: z.number().int().describe("The page's number within this file, starting at 1."),
      text: z.string().describe("Everything printed on the page, transcribed."),
      legible: z.boolean().describe("False for a blank page, or one with only a signature, initials or a stamp."),
    }),
  ),
});

export interface ScanReading {
  pages: Page[];
  /** Pages in the file, and how many of them came back with text. */
  page_count: number;
  read: number;
  /** Runs the model didn't answer (a failed call, an answer too long). */
  failed_runs: number;
}

/** Check one run's pages: each must be one of the pages sent, come back once, and carry text or be marked blank.
 * Returns the pages with text (renumbered to the original document), how many pages passed, and what failed. */
export function checkRun(out: z.infer<typeof Schema>, count: number, first: number): { kept: Page[]; passed: number; problems: string[] } {
  const seen = new Set<number>();
  const kept: Page[] = [];
  const problems: string[] = [];
  let passed = 0;
  for (const p of out.pages) {
    if (p.page < 1 || p.page > count) {
      problems.push(`page ${p.page} isn't one of the ${count} pages sent`);
      continue;
    }
    if (seen.has(p.page)) {
      problems.push(`page ${p.page} came back twice`);
      continue;
    }
    seen.add(p.page);
    const text = p.text.replace(/\u0000/g, "").trim();
    const hasText = text.replace(/\[illegible\]/gi, "").replace(/\s/g, "").length >= 3;
    if (hasText) kept.push({ num: first + p.page - 1, text });
    if (hasText || !p.legible) passed++;
    else problems.push(`page ${p.page} came back empty but marked legible`);
  }
  const missing = count - seen.size;
  if (missing > 0) problems.push(`${missing} of the ${count} pages didn't come back`);
  return { kept, passed, problems };
}

async function slice(src: PDFDocument, from: number, count: number): Promise<string> {
  const out = await PDFDocument.create();
  const pages = await out.copyPages(src, Array.from({ length: count }, (_, i) => from + i));
  for (const p of pages) out.addPage(p);
  return Buffer.from(await out.save()).toString("base64");
}

/** Read a run of pages; a run the model can't answer whole is tried again in halves, down to one page. */
async function readRun(src: PDFDocument, label: string, from: number, count: number, out: ScanReading): Promise<void> {
  const first = from + 1;
  const res = await structured({
    task: "scan_text",
    about: `${label}, pages ${first}-${from + count}`,
    system: SYSTEM,
    user: `Transcribe all ${count} page${count === 1 ? "" : "s"} of this scanned file (pages ${first} to ${from + count} of "${label}"). Number them 1 to ${count} as they appear in this file.`,
    documents: [{ data: await slice(src, from, count), title: label.slice(0, 200) }],
    schema: Schema,
    maxTokens: 32_000,
    timeoutMs: 300_000,
    effort: "low",
  });
  if (!res) {
    if (count > 1) {
      const half = Math.ceil(count / 2);
      await readRun(src, label, from, half, out);
      await readRun(src, label, from + half, count - half, out);
    } else out.failed_runs++;
    return;
  }
  const { kept, passed, problems } = checkRun(res, count, first);
  // Out of every page sent and every page returned, so an extra page (one the file doesn't have) counts against it.
  pieces(res, `${kept.length} of ${count} pages transcribed`, passed, Math.max(count, res.pages.length), problems.join("; "));
  out.pages.push(...kept);
  out.read += kept.length;
}

/** Transcribe a scanned PDF. Throws when the file can't be opened as a PDF. */
export async function readScan(buffer: Buffer, label: string): Promise<ScanReading> {
  const src = await PDFDocument.load(new Uint8Array(buffer), { ignoreEncryption: true });
  const total = Math.min(src.getPageCount(), MAX_PAGES);
  const out: ScanReading = { pages: [], page_count: total, read: 0, failed_runs: 0 };
  for (let from = 0; from < total; from += RUN) await readRun(src, label, from, Math.min(RUN, total - from), out);
  out.pages.sort((a, b) => a.num - b.num);
  return out;
}
