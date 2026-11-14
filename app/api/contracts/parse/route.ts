// Contract upload: multipart files, JSON { sample } for a seeded contract, or JSON
// { document } for a co-op catalog document from the price-list queue.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { NextResponse } from "next/server";
import { withSession } from "@/lib/session";
import { ActionError, parseUpload } from "@/lib/actions";
import { ParseError, type InputFile } from "@/lib/parser";
import { catalogDocument } from "@/lib/catalog";
import { catalogHint, fetchCatalogDocument, recordRead } from "@/lib/pricelists";
import { SAMPLE_CONTRACTS } from "@/lib/samples";
import type { Role } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export const POST = withSession(async (req: Request) => {
  let documentId: string | null = null;
  try {
    let files: InputFile[] = [];
    let role: Role = "supplier";
    if (req.headers.get("content-type")?.includes("application/json")) {
      const body = await req.json();
      role = body.role ?? role;
      if (body.document) {
        // A co-op catalog document from the price-list queue: fetched on the server, then read like an upload.
        if (!catalogDocument(String(body.document))) return NextResponse.json({ error: "That document isn't in the co-op catalog." }, { status: 404 });
        documentId = String(body.document);
        const { file } = await fetchCatalogDocument(documentId);
        files = [file];
      } else {
        const sample = SAMPLE_CONTRACTS.find((s) => s.id === body.sample);
        if (!sample) return NextResponse.json({ error: "Unknown sample" }, { status: 400 });
        files = sample.files.map((f) => ({ filename: f, buffer: readFileSync(join(process.cwd(), "seed", "contracts", f)) }));
      }
    } else {
      const form = await req.formData();
      role = (form.get("role") as Role) ?? role;
      for (const entry of form.getAll("files")) {
        if (entry instanceof File) files.push({ filename: entry.name, buffer: Buffer.from(await entry.arrayBuffer()) });
      }
    }
    if (!files.length) return NextResponse.json({ error: "Choose a file or a sample contract." }, { status: 400 });
    const result = await parseUpload(files, role, documentId ? catalogHint(documentId) : undefined);
    if (documentId) {
      const n = result.items.length;
      recordRead(documentId, { status: n ? "read" : "failed", items: n, supplier: result.header.supplier_name ?? "", message: n ? `${n} priced row${n === 1 ? "" : "s"} found` : "No priced rows found" });
    }
    return NextResponse.json({ result });
  } catch (err) {
    if (documentId) recordRead(documentId, { status: "failed", items: 0, supplier: "", message: err instanceof ParseError || err instanceof ActionError ? err.message : "Could not read this document." });
    if (err instanceof ParseError || err instanceof ActionError) return NextResponse.json({ error: err.message }, { status: 422 });
    console.error(err);
    return NextResponse.json({ error: "Could not read that file." }, { status: 500 });
  }
});
