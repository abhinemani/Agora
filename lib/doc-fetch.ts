// Fetching a contract document from its publisher and reading its text, shared by the document reader
// (lib/docs.ts) and the document store's ingest (lib/doc-ingest.ts), which also hands scans to Claude
// (lib/doc-ocr.ts). Server-only.

import type { Page } from "./docs";
import { extractFile } from "./parser";

/** What a person waits for when they ask a question; the background ingest takes larger files. */
export const READER_MAX_BYTES = 15 * 1024 * 1024;
export const INGEST_MAX_BYTES = 40 * 1024 * 1024;
/** Spreadsheets swell many times over when read, so they get a lower limit than other files. */
const SHEET_MAX_BYTES = 20 * 1024 * 1024;
const MAX_PAGES = 600;

export const docError = (message: string, status: string) => Object.assign(new Error(message), { status });
const safeDecode = (s: string) => {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
};
const mb = (n: number) => `${Math.round(n / 1024 / 1024)} MB`;

/** Download a document. Throws with the reason; `status` on the error is "too_large" or "failed". */
export async function downloadDocument(url: string, maxBytes = READER_MAX_BYTES): Promise<{ buffer: Buffer; filename: string }> {
  let buffer: Buffer;
  let filename: string;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), maxBytes > READER_MAX_BYTES ? 120_000 : 45_000);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { "user-agent": "Agora contract reader" } });
    if (!res.ok) throw new Error(`its publisher answered ${res.status}`);
    if (Number(res.headers.get("content-length") ?? 0) > maxBytes) throw docError(`it is over ${mb(maxBytes)}`, "too_large");
    buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.length > maxBytes) throw docError(`it is over ${mb(maxBytes)}`, "too_large");
    let from = new URL(url);
    // GSA's "online" page is a redirect stub to the contract's PDF in the same folder.
    const hop = buffer.length < 4000 ? buffer.toString("utf8").match(/http-equiv=["']?refresh["']?[^>]*url=([^"'>\s]+)/i) : null;
    if (hop) {
      const next = new URL(hop[1], from);
      if (next.host !== from.host || !next.pathname.startsWith("/ref_text/")) throw new Error("it points somewhere Agora doesn't read");
      const res2 = await fetch(next, { signal: controller.signal, headers: { "user-agent": "Agora contract reader" } });
      if (!res2.ok) throw new Error(`its publisher answered ${res2.status}`);
      if (Number(res2.headers.get("content-length") ?? 0) > maxBytes) throw docError(`it is over ${mb(maxBytes)}`, "too_large");
      buffer = Buffer.from(await res2.arrayBuffer());
      if (buffer.length > maxBytes) throw docError(`it is over ${mb(maxBytes)}`, "too_large");
      from = next;
    }
    // A download action names the file in its Content-Disposition header ("Price Sheet.xlsx").
    const disposed = res.headers.get("content-disposition")?.match(/filename\*?=(?:UTF-8'')?"?([^";]+)"?/i)?.[1];
    filename = disposed ? safeDecode(disposed) : safeDecode(from.pathname.split("/").pop() || "document.pdf");
    if (!/\.\w{2,4}$/.test(filename)) filename += extensionOf(buffer);
  } catch (e) {
    const m = (e as Error).message;
    if ((e as { status?: string }).status) throw e;
    throw new Error((e as Error).name === "AbortError" ? "its publisher took too long" : !m || m === "fetch failed" ? "its publisher couldn't be reached" : m);
  } finally {
    clearTimeout(timer);
  }
  return { buffer, filename };
}

/** A file's type from its first bytes, for a download that names no extension. */
function extensionOf(buffer: Buffer): string {
  const head = buffer.subarray(0, 8);
  if (head.subarray(0, 4).toString("latin1") === "%PDF") return ".pdf";
  if (head.subarray(0, 2).toString("latin1") === "PK")
    return buffer.includes("word/document.xml") ? ".docx" : buffer.includes("ppt/presentation.xml") ? ".pptx" : buffer.includes("xl/workbook") ? ".xlsx" : ".zip";
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return ".jpg";
  if (head.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]))) return ".png";
  if (head.subarray(0, 5).toString("latin1") === "{\\rtf") return ".rtf";
  // An old Office file (Word 97-2003 or Excel 97-2003) is an OLE compound file.
  if (head.equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]))) return buffer.includes(Buffer.from("W\0o\0r\0d\0D\0o\0c\0u\0m\0e\0n\0t", "latin1")) ? ".doc" : ".xls";
  return "";
}

/** Fetch a document from its publisher and read its text. Throws with the reason it couldn't be read; `status` on
 * the error says which kind ("scan", "too_large", "unsupported", "failed"), for the document store. */
export async function fetchDocument(url: string, maxBytes = READER_MAX_BYTES): Promise<{ pages: Page[]; filename: string; bytes: number }> {
  const { buffer, filename } = await downloadDocument(url, maxBytes);
  try {
    return { pages: await readBuffer(buffer, filename), filename, bytes: buffer.length };
  } catch (e) {
    throw Object.assign(e as Error, { filename, bytes: buffer.length });
  }
}

/** A file's text by page: PDFs read directly, old Word files with word-extractor, everything else through the upload reader. */
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
  if (/\.doc$/i.test(filename)) {
    // Word 97-2003: the text is in the file, just not in a format the upload reader knows.
    const { default: WordExtractor } = await import("word-extractor");
    const doc = await new WordExtractor().extract(buffer);
    const text = [doc.getBody(), doc.getFootnotes(), doc.getEndnotes()].filter((t) => t && t.trim()).join("\n\n");
    if (text.replace(/\s/g, "").length < 40) throw docError("it has almost no text", "failed");
    return [{ num: 1, text }];
  }
  // An image is a one-page scan: the scan reader (lib/doc-ocr.ts) wraps it in a PDF and reads it.
  if (/\.(jpe?g|png)$/i.test(filename)) throw docError("it is an image of a page", "scan");
  if (/\.(pptx|ppsx)$/i.test(filename)) return slides(buffer);
  if (/\.zip$/i.test(filename)) return zipped(buffer);
  if (/\.rtf$/i.test(filename)) return plain(rtfText(buffer.toString("latin1")));
  if (/\.(txt|text)$/i.test(filename)) return plain(buffer.toString("utf8"));
  if (/\.(xlsx|xlsm|xlsb|xls|csv)$/i.test(filename) && buffer.length > SHEET_MAX_BYTES) throw docError(`it is a spreadsheet over ${mb(SHEET_MAX_BYTES)}`, "too_large");
  // Macro-enabled and binary workbooks read like any workbook.
  if (/\.(xlsm|xlsb)$/i.test(filename)) filename = filename.replace(/\.xls[mb]$/i, ".xlsx");
  if (!/\.(xlsx|xls|csv|docx|htm|html)$/i.test(filename)) throw docError(`Agora doesn't read ${filename.split(".").pop()?.toUpperCase() || "this kind of"} files`, "unsupported");
  try {
    const file = await extractFile({ filename, buffer, keep: false });
    return file.rows?.length ? [{ num: 1, text: file.rows.map((r) => r.map((c) => String(c ?? "")).join("  ")).join("\n") }] : file.pages;
  } catch (e) {
    throw docError((e as Error).message.replace(/\.$/, ""), /scanned/i.test((e as Error).message) ? "scan" : "failed");
  }
}

/** Plain text as one page, when there is enough of it to search. */
function plain(text: string): Page[] {
  if (text.replace(/\s/g, "").length < 40) throw docError("it has almost no text", "failed");
  return [{ num: 1, text }];
}

/** The words of an RTF file. A small parser, since RTF nests groups: tables of fonts, colors and styles, pictures and
 * other "destinations" are skipped whole; \par and \line become line breaks, \tab and \cell tabs; \'hh escapes decoded. */
function rtfText(rtf: string): string {
  const SKIP = /^(fonttbl|colortbl|stylesheet|info|pict|themedata|colorschememapping|latentstyles|datastore|xmlnstbl|listtable|listoverridetable|rsidtbl|generator|header|footer|headerl|headerr|footerl|footerr|object|fldinst|bkmkstart|bkmkend)$/;
  const stack: boolean[] = [];
  let skip = false;
  let out = "";
  for (let i = 0; i < rtf.length; ) {
    const c = rtf[i];
    if (c === "{") {
      stack.push(skip);
      i++;
    } else if (c === "}") {
      skip = stack.pop() ?? false;
      i++;
    } else if (c === "\\") {
      const m = rtf.slice(i, i + 40).match(/^\\([a-z]+)(-?\d+)? ?|^\\'([0-9a-f]{2})|^\\([^a-z])/i);
      if (!m) {
        i++;
        continue;
      }
      i += m[0].length;
      if (m[3]) {
        if (!skip) out += String.fromCharCode(parseInt(m[3], 16));
      } else if (m[4]) {
        if (m[4] === "*") skip = true;
        else if (!skip) out += m[4] === "~" ? " " : "\\{}".includes(m[4]) ? m[4] : "";
      } else if (SKIP.test(m[1])) skip = true;
      else if (!skip) out += m[1] === "par" || m[1] === "line" || m[1] === "row" ? "\n" : m[1] === "tab" || m[1] === "cell" ? "\t" : "";
    } else {
      if (!skip && c !== "\r" && c !== "\n") out += c;
      i++;
    }
  }
  return out.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** A PowerPoint deck's text, one page per slide, in slide order. */
async function slides(buffer: Buffer): Promise<Page[]> {
  const { default: JSZip } = await import("jszip");
  const zip = await JSZip.loadAsync(buffer);
  const names = Object.keys(zip.files)
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => Number(a.match(/(\d+)\.xml$/)![1]) - Number(b.match(/(\d+)\.xml$/)![1]));
  const pages: Page[] = [];
  for (const [i, n] of names.entries()) {
    const xml = await zip.files[n].async("string");
    const text = xml
      .split(/<\/a:p>/)
      .map((para) => [...para.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((m) => decodeXml(m[1])).join(""))
      .filter((t) => t.trim())
      .join("\n");
    if (text.trim()) pages.push({ num: i + 1, text });
  }
  if (!pages.length) throw docError("the deck has no text on its slides", "failed");
  return pages;
}
const decodeXml = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");

/** The readable files inside a zip, each read as it would be on its own, as one run of pages headed by the file's name.
 * Scans and files Agora can't read inside are passed over; zips inside zips aren't opened. */
async function zipped(buffer: Buffer): Promise<Page[]> {
  const { default: JSZip } = await import("jszip");
  const zip = await JSZip.loadAsync(buffer);
  const entries = Object.values(zip.files).filter((f) => !f.dir && !/(^|\/)(__MACOSX|\.)/.test(f.name) && !/\.zip$/i.test(f.name)).slice(0, 40);
  const pages: Page[] = [];
  let passedOver = 0;
  for (const f of entries) {
    const inner = await f.async("nodebuffer");
    if (inner.length > INGEST_MAX_BYTES) continue;
    try {
      const name = f.name.split("/").pop()!;
      for (const p of await readBuffer(inner, /\.\w{2,5}$/.test(name) ? name : name + extensionOf(inner))) pages.push({ num: pages.length + 1, text: `[${f.name}, page ${p.num}]\n${p.text}` });
    } catch {
      passedOver++;
    }
  }
  if (!pages.length) throw docError(passedOver ? `none of the ${passedOver} files inside could be read` : "the zip holds no file Agora reads", "unsupported");
  return pages;
}
