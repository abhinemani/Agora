// Contract upload: multipart files, JSON { sample } for a seeded contract, or JSON
// { document } for a co-op catalog document from the price-list queue. POST starts the read
// and answers with a job id; GET ?job=<id> returns the result when it is ready.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { NextResponse } from "next/server";
import { withSession } from "@/lib/session";
import { currentScope } from "@/lib/db";
import { readJob, startJob } from "@/lib/parse-jobs";
import { saveSoon } from "@/lib/persist";
import { ActionError, parseUpload } from "@/lib/actions";
import { ParseError, type InputFile } from "@/lib/parser";
import { catalogDocument } from "@/lib/catalog";
import { catalogHint, fetchCatalogDocument, recordRead } from "@/lib/pricelists";
import { SAMPLE_CONTRACTS } from "@/lib/samples";
import type { Role } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** What a failed read tells the person: the parser's own message when it has one. */
const failure = (err: unknown) => {
  if (err instanceof ParseError || err instanceof ActionError) return { error: err.message, code: 422 };
  console.error(err);
  return { error: "Could not read that file.", code: 500 };
};

// The upload is checked here and read in the background (lib/parse-jobs.ts): the answer is a job id,
// and GET ?job=<id> returns the result once the read is finished.
export const POST = withSession(async (req: Request) => {
  const owner = currentScope()?.user?.id ?? "";
  let files: InputFile[] = [];
  let role: Role = "supplier";
  let documentId: string | null = null;
  try {
    if (req.headers.get("content-type")?.includes("application/json")) {
      const body = await req.json();
      role = body.role ?? role;
      if (body.document) {
        // A co-op catalog document from the price-list queue: fetched on the server, then read like an upload.
        if (!catalogDocument(String(body.document))) return NextResponse.json({ error: "That document isn't in the co-op catalog." }, { status: 404 });
        documentId = String(body.document);
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
  } catch (err) {
    const f = failure(err);
    return NextResponse.json({ error: f.error }, { status: f.code });
  }
  if (!files.length && !documentId) return NextResponse.json({ error: "Choose a file or a sample contract." }, { status: 400 });

  const job = startJob(
    owner,
    async () => {
      try {
        if (documentId) files = [(await fetchCatalogDocument(documentId)).file];
        const result = await parseUpload(files, role, documentId ? catalogHint(documentId) : undefined);
        if (documentId) {
          const n = result.items.length;
          recordRead(documentId, { status: n ? "read" : "failed", items: n, supplier: result.header.supplier_name ?? "", message: n ? `${n} priced row${n === 1 ? "" : "s"} found` : "No priced rows found" });
        }
        return result;
      } catch (err) {
        if (documentId) recordRead(documentId, { status: "failed", items: 0, supplier: "", message: err instanceof ParseError || err instanceof ActionError ? err.message : "Could not read this document." });
        throw err;
      } finally {
        // The request that started this has already been answered, so the change is saved from here.
        saveSoon();
      }
    },
    failure,
  );
  return NextResponse.json({ job }, { status: 202 });
}, { account: "upload a contract" });

export const GET = withSession(
  async (req: Request) => {
    const job = readJob(new URL(req.url).searchParams.get("job") ?? "", currentScope()?.user?.id ?? "");
    if (!job) return NextResponse.json({ error: "That upload is no longer on file. Upload the contract again." }, { status: 404 });
    if (job.status === "working") return NextResponse.json({ status: "working" });
    if (job.status === "failed") return NextResponse.json({ error: job.error }, { status: job.code ?? 500 });
    return NextResponse.json({ status: "done", result: job.result });
  },
  { account: "upload a contract", readOnly: true },
);
