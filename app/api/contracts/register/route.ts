// Contract register upload: a CSV or XLSX of the agency's own contracts, one per
// row. Multipart { file }, or JSON { sample: true } for the demo register.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { NextResponse } from "next/server";
import { withSession } from "@/lib/session";
import { ActionError, importRegister } from "@/lib/actions";
import { extractFile, ParseError, type InputFile } from "@/lib/parser";
import { RegisterError } from "@/lib/register";

export const dynamic = "force-dynamic";

const SAMPLE_REGISTER = "harmon-lake-contract-register.csv";

export const POST = withSession(async (req: Request) => {
  try {
    let file: InputFile | null = null;
    if (req.headers.get("content-type")?.includes("application/json")) {
      const body = await req.json();
      if (!body.sample) return NextResponse.json({ error: "Choose a file or the sample register." }, { status: 400 });
      file = { filename: SAMPLE_REGISTER, buffer: readFileSync(join(process.cwd(), "public", "test-contracts", SAMPLE_REGISTER)) };
    } else {
      const entry = (await req.formData()).get("file");
      if (entry instanceof File) file = { filename: entry.name, buffer: Buffer.from(await entry.arrayBuffer()) };
    }
    if (!file) return NextResponse.json({ error: "Choose a CSV or XLSX file." }, { status: 400 });
    if (!/\.(csv|xlsx|xls)$/i.test(file.filename)) return NextResponse.json({ error: "The register needs to be a CSV or XLSX spreadsheet, one contract per row." }, { status: 422 });
    const extracted = await extractFile(file);
    return NextResponse.json({ result: importRegister(extracted.rows ?? [], file.filename) });
  } catch (err) {
    if (err instanceof ParseError || err instanceof ActionError || err instanceof RegisterError) return NextResponse.json({ error: err.message }, { status: 422 });
    console.error(err);
    return NextResponse.json({ error: "Could not read that file." }, { status: 500 });
  }
}, { account: "upload a contract register" });
