// Accounts: POST { op: "signup" | "signin" | "signout", ... }. The session travels in an HttpOnly cookie.

import { NextResponse } from "next/server";
import { AuthError, endSession, SESSION_COOKIE, sessionCookie, signIn, signUp, startSession } from "@/lib/auth";
import { currentScope, getDb } from "@/lib/db";
import { cookie, withSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export const POST = withSession(async (req: Request) => {
  const body = await req.json().catch(() => ({}));
  const s = currentScope()!;
  try {
    if (body.op === "signout") {
      await endSession(cookie(req, SESSION_COOKIE));
      s.user = null;
      const res = NextResponse.json({ result: { user: null } });
      res.headers.append("set-cookie", sessionCookie(null));
      return res;
    }
    if (body.op !== "signup" && body.op !== "signin") return NextResponse.json({ error: "Unknown request." }, { status: 400 });
    // A new account starts with the agency already chosen in this browser, if there is one.
    const user = body.op === "signup" ? await signUp({ ...body, agency: s.buyer }) : await signIn(body);
    s.user = user;
    if (!s.buyer && user.agency) s.buyer = user.agency;
    // Searches made in this browser before signing in now belong to the account.
    for (const r of getDb().requests) if (r.owner === `v:${s.visitor}`) r.owner = user.id;
    const res = NextResponse.json({ result: { user: { id: user.id, name: user.name, email: user.email, role: user.role } } });
    res.headers.append("set-cookie", sessionCookie(await startSession(user.id)));
    return res;
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: 400 });
    console.error(err);
    return NextResponse.json({ error: "Something went wrong. Try again." }, { status: 500 });
  }
});
