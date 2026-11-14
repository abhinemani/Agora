import { NextResponse } from "next/server";
import { withSession } from "@/lib/session";
import { getDb, hasApiKey } from "@/lib/db";

export const dynamic = "force-dynamic";

export const GET = withSession(() => {
  const db = getDb();
  // An agency's contract register is private to that agency: other agencies' rows never leave the server.
  const me = db.session.buyer?.name;
  const contracts = db.contracts.filter((c) => !c.register_of || c.register_of === me);
  return NextResponse.json({ db: { ...db, contracts }, llm: hasApiKey() });
});
