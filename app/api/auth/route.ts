// Accounts: POST { op: "signup" | "signin" | "signout" | "verify" | "resend" | "forgot" | "reset" | "delete", ... }. The session travels in an HttpOnly cookie.

import { NextResponse } from "next/server";
import { AuthError, deleteUser, endSession, resetPassword, SESSION_COOKIE, sessionCookie, signIn, signUp, startSession, userByEmail, verifyEmail, type User } from "@/lib/auth";
import { sendReset, sendVerification } from "@/lib/notify";
import { currentScope, getDb } from "@/lib/db";
import { forgetAccount } from "@/lib/actions";
import { cookie, withSession } from "@/lib/session";

export const dynamic = "force-dynamic";

const view = (u: User) => ({ id: u.id, name: u.name, email: u.email, role: u.role, verified: u.verified });

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
    if (body.op === "delete") {
      // Deleting an account needs its password again. Searches nothing refers to and unpublished contract reads go with it.
      if (!s.user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
      await deleteUser({ userId: s.user.id, email: s.user.email, password: body.password });
      const removed = forgetAccount(s.user.id);
      s.user = null;
      const res = NextResponse.json({ result: { user: null, removed } });
      res.headers.append("set-cookie", sessionCookie(null));
      return res;
    }
    if (body.op === "forgot") {
      // The same answer whether or not there's an account, so the form doesn't reveal who has one.
      await sendReset(await userByEmail(body.email), req);
      return NextResponse.json({ result: { ok: true } });
    }
    if (body.op === "resend") {
      if (!s.user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
      return NextResponse.json({ result: { sent: await sendVerification(s.user, req) } });
    }
    if (body.op === "verify") {
      const user = await verifyEmail(body.token);
      if (s.user?.id === user.id) s.user = user;
      return NextResponse.json({ result: { user: view(user) } });
    }
    if (body.op !== "signup" && body.op !== "signin" && body.op !== "reset") return NextResponse.json({ error: "Unknown request." }, { status: 400 });
    // A new account starts with the agency already chosen in this browser, if there is one.
    const user = body.op === "signup" ? await signUp({ ...body, agency: s.buyer }) : body.op === "reset" ? await resetPassword(body.token, body.password) : await signIn(body);
    s.user = user;
    const emailed = body.op === "signup" ? await sendVerification(user, req) : false;
    if (!s.buyer && user.agency) s.buyer = user.agency;
    // Searches made in this browser before signing in now belong to the account.
    for (const r of getDb().requests) if (r.owner === `v:${s.visitor}`) r.owner = user.id;
    const res = NextResponse.json({ result: { user: view(user), emailed } });
    res.headers.append("set-cookie", sessionCookie(await startSession(user.id)));
    return res;
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: 400 });
    console.error(err);
    return NextResponse.json({ error: "Something went wrong. Try again." }, { status: 500 });
  }
});
