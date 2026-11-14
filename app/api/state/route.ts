import { NextResponse } from "next/server";
import { withSession } from "@/lib/session";
import { currentScope, getDb, hasApiKey } from "@/lib/db";

export const dynamic = "force-dynamic";

export const GET = withSession(
  () => {
  const db = getDb();
  // An agency's contract register is private to that agency: other agencies' rows never leave the server.
  const me = db.session.buyer?.name;
  const contracts = db.contracts.filter((c) => !c.register_of || c.register_of === me);
  // A person's searches are theirs: an account sees its own, a browser without one sees what it made.
  const s = currentScope();
  const mine = new Set([s?.user?.id, s?.visitor ? `v:${s.visitor}` : undefined].filter(Boolean));
  const requests = db.requests.filter((r) => !r.owner || mine.has(r.owner));
  const user = s?.user ? { id: s.user.id, name: s.user.name, email: s.user.email, role: s.user.role, verified: s.user.verified } : null;
  return NextResponse.json({ db: { ...db, contracts, requests }, llm: hasApiKey(), user });
  },
  { readOnly: true },
);
