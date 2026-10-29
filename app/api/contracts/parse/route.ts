// Contract upload: multipart files, or JSON { sample } to use a seeded contract.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { NextResponse } from "next/server";
import { ActionError, parseUpload } from "@/lib/actions";
import { ParseError, type InputFile } from "@/lib/parser";
import { SAMPLE_CONTRACTS } from "@/lib/samples";
import type { Role } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(req: Request) {
  try {
    let files: InputFile[] = [];
    let role: Role = "supplier";
    if (req.headers.get("content-type")?.includes("application/json")) {
      const body = await req.json();
      role = body.role ?? role;
      const sample = SAMPLE_CONTRACTS.find((s) => s.id === body.sample);
      if (!sample) return NextResponse.json({ error: "Unknown sample" }, { status: 400 });
      files = sample.files.map((f) => ({ filename: f, buffer: readFileSync(join(process.cwd(), "seed", "contracts", f)) }));
    } else {
      const form = await req.formData();
      role = (form.get("role") as Role) ?? role;
      for (const entry of form.getAll("files")) {
        if (entry instanceof File) files.push({ filename: entry.name, buffer: Buffer.from(await entry.arrayBuffer()) });
      }
    }
    if (!files.length) return NextResponse.json({ error: "Choose a file or a sample contract." }, { status: 400 });
    return NextResponse.json({ result: await parseUpload(files, role) });
  } catch (err) {
    if (err instanceof ParseError || err instanceof ActionError) return NextResponse.json({ error: err.message }, { status: 422 });
    console.error(err);
    return NextResponse.json({ error: "Could not read that file." }, { status: 500 });
  }
}
