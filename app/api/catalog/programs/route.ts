// Program pages' data: ?id=njstart for one program's page, plus &contracts=1 (with q,
// category, usable, offset) for a page of its contracts; no id lists every program.
// The catalog stays on the server (lib/catalog.ts, lib/programs.ts).

import { NextResponse } from "next/server";
import { withSession } from "@/lib/session";
import { getDb } from "@/lib/db";
import { programContracts, programPage, programSummaries } from "@/lib/programs";

export const dynamic = "force-dynamic";

export const GET = withSession((req: Request) => {
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (!id) return NextResponse.json({ programs: programSummaries() });
  const db = getDb();
  if (url.searchParams.get("contracts")) {
    const result = programContracts(db, id, {
      q: (url.searchParams.get("q") ?? "").slice(0, 80),
      category: url.searchParams.get("category") ?? undefined,
      usable: url.searchParams.get("usable") === "1",
      offset: Math.max(0, Number(url.searchParams.get("offset")) || 0),
      limit: 25,
    });
    return result ? NextResponse.json(result) : NextResponse.json({ error: "No such program" }, { status: 404 });
  }
  const program = programPage(db, id);
  return program ? NextResponse.json({ program }) : NextResponse.json({ program: null }, { status: 404 });
});
