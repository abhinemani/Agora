// Co-op member list upload (Sovra ops): multipart { file, coopId, mode }, or
// JSON { sample: true, coopId, mode } for the demo list.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { NextResponse } from "next/server";
import { withSession } from "@/lib/session";
import { ActionError, importMembers } from "@/lib/actions";
import { MemberListError } from "@/lib/members";
import { extractFile, ParseError, type InputFile } from "@/lib/parser";

export const dynamic = "force-dynamic";

const SAMPLE = "sourcewell-member-list-sample.csv";

export const POST = withSession(async (req: Request) => {
  try {
    let file: InputFile | null = null;
    let coopId = "";
    let mode: "replace" | "merge" = "merge";
    if (req.headers.get("content-type")?.includes("application/json")) {
      const body = await req.json();
      coopId = body.coopId ?? "";
      mode = body.mode === "replace" ? "replace" : "merge";
      if (body.sample) file = { filename: SAMPLE, buffer: readFileSync(join(process.cwd(), "public", "test-contracts", SAMPLE)) };
    } else {
      const form = await req.formData();
      coopId = String(form.get("coopId") ?? "");
      mode = form.get("mode") === "replace" ? "replace" : "merge";
      const entry = form.get("file");
      if (entry instanceof File) file = { filename: entry.name, buffer: Buffer.from(await entry.arrayBuffer()) };
    }
    if (!file) return NextResponse.json({ error: "Choose a CSV or XLSX file." }, { status: 400 });
    if (!/\.(csv|xlsx|xls)$/i.test(file.filename)) return NextResponse.json({ error: "The member list needs to be a CSV or XLSX spreadsheet, one government per row." }, { status: 422 });
    const extracted = await extractFile(file);
    return NextResponse.json({ result: importMembers({ coopId, table: extracted.rows ?? [], mode, filename: file.filename }) });
  } catch (err) {
    if (err instanceof ParseError || err instanceof ActionError || err instanceof MemberListError) return NextResponse.json({ error: err.message }, { status: 422 });
    console.error(err);
    return NextResponse.json({ error: "Could not read that file." }, { status: 500 });
  }
}, { account: "upload a member list" });
