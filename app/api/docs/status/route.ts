// How far the document store has got: counts only, no document text and nothing anyone typed.
import { NextResponse } from "next/server";
import { ingestState } from "@/lib/doc-ingest";
import { docStoreStatus } from "@/lib/doc-store";

export const dynamic = "force-dynamic";

export async function GET() {
  const store = await docStoreStatus().catch((e) => ({ error: (e as Error).message }));
  return NextResponse.json({ store: store ?? { database: false }, ingest: ingestState() });
}
