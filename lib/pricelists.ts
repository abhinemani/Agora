// The price-list queue: co-op catalog and price-list documents (lib/catalog.ts) fetched
// on the server and handed to Agora's contract reader (lib/parser.ts). Only documents
// in the catalog can be fetched, so the reader can't be pointed at an arbitrary address.

import { catalogContract, catalogDocument, catalogSupplierById } from "./catalog";
import type { ContractHeader } from "./types";
import { getDb } from "./db";
import { ParseError, type InputFile } from "./parser";

const MAX_BYTES = 15 * 1024 * 1024;
const EXT_BY_TYPE: [RegExp, string][] = [
  [/pdf/i, "pdf"],
  [/spreadsheetml|ms-excel/i, "xlsx"],
  [/csv/i, "csv"],
  [/wordprocessingml/i, "docx"],
  [/html/i, "htm"],
];

/** Download one catalog document, with a size and time limit, named so the reader knows its kind. */
export async function fetchCatalogDocument(id: string): Promise<{ file: InputFile; label: string }> {
  const doc = catalogDocument(id);
  if (!doc) throw new ParseError("That document isn't in the co-op catalog.");
  if (!/^https?:\/\//i.test(doc.url)) throw new ParseError("That document has no web address.");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25_000);
  try {
    const res = await fetch(doc.url, { signal: controller.signal, redirect: "follow", headers: { "user-agent": "Agora price-list reader" } });
    if (!res.ok) throw new ParseError(`The co-op's site answered ${res.status} for this document.`);
    const declared = Number(res.headers.get("content-length") ?? 0);
    if (declared > MAX_BYTES) throw new ParseError("This document is over 15 MB, too large for the reader.");
    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.length > MAX_BYTES) throw new ParseError("This document is over 15 MB, too large for the reader.");
    const type = res.headers.get("content-type") ?? "";
    const ext = doc.kind !== "unknown" ? doc.kind : (EXT_BY_TYPE.find(([re]) => re.test(type))?.[1] ?? "htm");
    const base = decodeURIComponent(new URL(res.url || doc.url).pathname.split("/").pop() || doc.id).replace(/\.[a-z0-9]+$/i, "") || doc.id;
    return { file: { filename: `${base}.${ext}`, buffer }, label: doc.label };
  } catch (e) {
    if (e instanceof ParseError) throw e;
    throw new ParseError((e as Error).name === "AbortError" ? "The co-op's site took too long to send this document." : "Couldn't download this document from the co-op's site.");
  } finally {
    clearTimeout(timer);
  }
}

/** Record how a read went, so the queue shows it. */
export function recordRead(documentId: string, read: { status: "read" | "failed"; items: number; supplier: string; message: string }) {
  const db = getDb();
  db.price_list_reads = db.price_list_reads.filter((r) => r.document_id !== documentId);
  db.price_list_reads.unshift({ document_id: documentId, ...read, at: new Date().toISOString() });
}

/** What the catalog already knows about a document's contract, for the reader to fall back on. */
export function catalogHint(documentId: string): Partial<ContractHeader> {
  const doc = catalogDocument(documentId);
  const c = doc ? catalogContract(doc.contract) : null;
  if (!c) return {};
  return {
    supplier_name: catalogSupplierById(c.supplier)?.name ?? "",
    contract_number: c.number,
    owner: c.coop === "GSA MAS" ? "General Services Administration" : c.coop,
    source: c.coop === "GSA MAS" ? "gsa" : "coop_contract",
    title: c.title,
    start: c.start ?? "",
    end: c.end ?? "",
  };
}
