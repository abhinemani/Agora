// The co-op directory, a few records at a time: ?q=plano&state=TX for the agency
// typeahead, ?id=gov_tx_plano for one government. The full directory stays on the server.

import { NextResponse } from "next/server";
import { getGovernment, searchDirectory } from "@/lib/directory";

export const dynamic = "force-dynamic";

export function GET(req: Request) {
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (id) {
    const government = getGovernment(id);
    return government ? NextResponse.json({ government }) : NextResponse.json({ error: "Not in the directory" }, { status: 404 });
  }
  const q = (url.searchParams.get("q") ?? "").slice(0, 80);
  const state = url.searchParams.get("state")?.toUpperCase() || undefined;
  const limit = Math.min(20, Math.max(1, Number(url.searchParams.get("limit")) || 8));
  return NextResponse.json({ results: searchDirectory(q, { state, limit }) });
}
