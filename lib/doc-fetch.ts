// Fetching a contract document from its publisher and reading its text, shared by the document reader
// (lib/docs.ts) and the document store's ingest (lib/doc-ingest.ts). Server-only.

import type { Page } from "./docs";
import { extractFile } from "./parser";

const MAX_BYTES = 15 * 1024 * 1024;
const MAX_PAGES = 600;

/** Fetch a document from its publisher and read its text. Throws with the reason it couldn't be read; `status` on
 * the error says which kind ("scan", "too_large", "unsupported", "failed"), for the document store. */
export async function fetchDocument(url: string): Promise<{ pages: Page[]; filename: string; bytes: number }> {
  let buffer: Buffer;
  let filename: string;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 45_000);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { "user-agent": "Agora contract reader" } });
    if (!res.ok) throw new Error(`its publisher answered ${res.status}`);
    if (Number(res.headers.get("content-length") ?? 0) > MAX_BYTES) throw docError("it is over 15 MB", "too_large");
    buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.length > MAX_BYTES) throw docError("it is over 15 MB", "too_large");
    let from = new URL(url);
    // GSA's "online" page is a redirect stub to the contract's PDF in the same folder.
    const hop = buffer.length < 4000 ? buffer.toString("utf8").match(/http-equiv=["']?refresh["']?[^>]*url=([^"'>\s]+)/i) : null;
    if (hop) {
      const next = new URL(hop[1], from);
      if (next.host !== from.host || !next.pathname.startsWith("/ref_text/")) throw new Error("it points somewhere Agora doesn't read");
      const res2 = await fetch(next, { signal: controller.signal, headers: { "user-agent": "Agora contract reader" } });
      if (!res2.ok) throw new Error(`its publisher answered ${res2.status}`);
      if (Number(res2.headers.get("content-length") ?? 0) > MAX_BYTES) throw docError("it is over 15 MB", "too_large");
      buffer = Buffer.from(await res2.arrayBuffer());
      if (buffer.length > MAX_BYTES) throw docError("it is over 15 MB", "too_large");
      from = next;
    }
    // A download action names the file in its Content-Disposition header ("Price Sheet.xlsx").
    const disposed = res.headers.get("content-disposition")?.match(/filename\*?=(?:UTF-8'')?"?([^";]+)"?/i)?.[1];
    filename = disposed ? safeDecode(disposed) : safeDecode(from.pathname.split("/").pop() || "document.pdf");
    if (!/\.\w{2,4}$/.test(filename)) filename += buffer.subarray(0, 4).toString("latin1") === "%PDF" ? ".pdf" : buffer.subarray(0, 2).toString("latin1") === "PK" ? ".xlsx" : "";
  } catch (e) {
    const m = (e as Error).message;
    if ((e as { status?: string }).status) throw e;
    throw new Error((e as Error).name === "AbortError" ? "its publisher took too long" : !m || m === "fetch failed" ? "its publisher couldn't be reached" : m);
  } finally {
    clearTimeout(timer);
  }
  return { pages: await readBuffer(buffer, filename), filename, bytes: buffer.length };
}
const docError = (message: string, status: string) => Object.assign(new Error(message), { status });
const safeDecode = (s: string) => {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
};

/** A file's text by page: PDFs read directly, everything else through the upload reader. */
export async function readBuffer(buffer: Buffer, filename: string): Promise<Page[]> {
  let pages: Page[];
  if (/\.pdf$/i.test(filename)) {
    // Read directly: master agreements and price lists run past the upload reader's 60-page limit.
    const { PDFParse } = await import("pdf-parse");
    const parser = new PDFParse({ data: new Uint8Array(buffer) });
    try {
      const res = await parser.getText();
      pages = res.pages.slice(0, MAX_PAGES).map((p) => ({ num: p.num, text: p.text }));
    } finally {
      await parser.destroy();
    }
    if (pages.reduce((n, p) => n + p.text.replace(/\s/g, "").length, 0) < 40 * pages.length) throw docError("it is a scanned document with no text layer", "scan");
    return pages;
  }
  if (!/\.(xlsx|xls|csv|docx|htm|html)$/i.test(filename)) throw docError(`Agora doesn't read ${filename.split(".").pop()?.toUpperCase() || "this kind of"} files`, "unsupported");
  try {
    const file = await extractFile({ filename, buffer, keep: false });
    return file.rows?.length ? [{ num: 1, text: file.rows.map((r) => r.map((c) => String(c ?? "")).join("  ")).join("\n") }] : file.pages;
  } catch (e) {
    throw docError((e as Error).message.replace(/\.$/, ""), /scanned/i.test((e as Error).message) ? "scan" : "failed");
  }
}

