// Check a vendor's quote against the prices Agora holds: multipart { file }, or JSON { text } or { sample: true }.

import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { extractFile, ParseError } from "@/lib/parser";
import { checkQuote, sampleQuote } from "@/lib/quote-check";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(req: Request) {
  try {
    let text = "";
    if (req.headers.get("content-type")?.includes("application/json")) {
      const body = await req.json();
      text = body.sample ? sampleQuote() : String(body.text ?? "");
    } else {
      const file = (await req.formData()).get("file");
      if (!(file instanceof File)) return NextResponse.json({ error: "Choose a file." }, { status: 400 });
      if (file.size > 15 * 1024 * 1024) return NextResponse.json({ error: "That file is over 15 MB." }, { status: 413 });
      if (/\.(txt|text)$/i.test(file.name)) text = await file.text();
      else {
        const doc = await extractFile({ filename: file.name, buffer: Buffer.from(await file.arrayBuffer()) });
        text = doc.rows?.length ? doc.rows.map((r) => r.map((c) => (typeof c === "number" && !Number.isInteger(c) ? c.toFixed(2) : String(c ?? ""))).join("  ")).join("\n") : doc.pages.map((p) => p.text).join("\n");
      }
    }
    if (!text.trim()) return NextResponse.json({ error: "There's no text to check. Paste the quote or choose a file." }, { status: 400 });
    return NextResponse.json({ result: { report: await checkQuote(getDb(), text), text: text.slice(0, 20_000) } });
  } catch (err) {
    if (err instanceof ParseError) return NextResponse.json({ error: err.message }, { status: 422 });
    console.error(err);
    return NextResponse.json({ error: "Could not read that quote." }, { status: 500 });
  }
}
