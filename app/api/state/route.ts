import { NextResponse } from "next/server";
import { getDb, hasApiKey } from "@/lib/db";

export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json({ db: getDb(), llm: hasApiKey() });
}
