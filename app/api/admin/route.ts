// The admin pages' data and operations. Only admins (lib/admin.ts) get past the first line.
//
//   GET  ?view=overview              counts, configuration, claims waiting, document store, recent admin actions
//   GET  ?view=accounts&q=&offset=   accounts, newest first
//   POST { op, ... }                 one change; each is written to the admin log (lib/admin-log.ts)

import { NextResponse } from "next/server";
import * as A from "@/lib/actions";
import { isAdmin, isRootAdmin, rootAdminCount, savesState } from "@/lib/admin";
import { logAdmin, recentAdminLog } from "@/lib/admin-log";
import { accountCounts, AuthError, changeAccount, endAllSessions, listAccounts, removeAccount, userById, type AccountRole, type User } from "@/lib/auth";
import { currentScope, getDb, hasApiKey } from "@/lib/db";
import { ingestState } from "@/lib/doc-ingest";
import { docStoreStatus } from "@/lib/doc-store";
import { canSendEmail } from "@/lib/email";
import { sendReset, sendVerification } from "@/lib/notify";
import { withSession } from "@/lib/session";

export const dynamic = "force-dynamic";

const ROLE_LABEL: Record<AccountRole, string> = { buyer: "Buyer", procurement: "Purchasing", supplier: "Supplier" };

const forbidden = () => NextResponse.json({ error: "Only an Agora admin can open this page." }, { status: 403 });
const me = () => currentScope()?.user ?? null;

async function overview() {
  const db = getDb();
  const [accounts, docs, log] = await Promise.all([accountCounts(), docStoreStatus().catch(() => null), recentAdminLog(25)]);
  const claimed = db.suppliers.filter((s) => s.claim);
  return {
    accounts,
    config: {
      database: savesState(),
      ai: hasApiKey(),
      email: canSendEmail(),
      root_admins: rootAdminCount(),
    },
    site: {
      requests: db.requests.length,
      orders: db.orders.length,
      carts: db.carts.length,
      quotes: db.quotes.length,
      suppliers: db.suppliers.length,
      claimed: claimed.filter((s) => s.claim!.status === "verified").length,
    },
    claims: claimed
      .filter((s) => s.claim!.status === "pending")
      .map((s) => ({ supplier_id: s.id, supplier: s.name, website: s.website ?? null, name: s.claim!.name, email: s.claim!.email, at: s.claim!.at }))
      .sort((a, b) => a.at.localeCompare(b.at)),
    docs: docs ? { ...docs, ingest: ingestState() } : null,
    log,
  };
}

async function accounts(url: URL) {
  const { rows, total } = await listAccounts({ q: url.searchParams.get("q") ?? "", offset: Number(url.searchParams.get("offset") ?? 0), limit: 50 });
  const self = me()?.id;
  return { total, rows: rows.map((r) => ({ ...r, root: isRootAdmin(r), admin: isAdmin(r), self: r.id === self })) };
}

export const GET = withSession(
  async (req: Request) => {
    if (!isAdmin(me())) return forbidden();
    const url = new URL(req.url);
    try {
      return NextResponse.json({ result: url.searchParams.get("view") === "accounts" ? await accounts(url) : await overview() });
    } catch (e) {
      console.error("[admin]", e);
      return NextResponse.json({ error: "The admin data couldn't be read. Try again." }, { status: 500 });
    }
  },
  { readOnly: true },
);

class Refused extends Error {}
const refuse = (msg: string): never => {
  throw new Refused(msg);
};

/** The account an operation is about, with the rules that keep an admin from locking the site out. */
async function target(id: unknown, op: string): Promise<User> {
  const u = typeof id === "string" ? await userById(id) : null;
  if (!u) refuse("That account no longer exists.");
  const self = u!.id === me()?.id;
  const lockout = op === "setAdmin" || op === "setDisabled" || op === "delete";
  if (lockout && self) refuse("You can't do that to your own account. Ask another admin.");
  if (lockout && isRootAdmin(u)) refuse(`${u!.email} is named in AGORA_ADMIN_EMAILS on the server. Take it off that list first.`);
  return u!;
}

export const POST = withSession(async (req: Request) => {
  const actor = me();
  if (!isAdmin(actor)) return forbidden();
  const b = await req.json().catch(() => ({}));
  const op = String(b?.op ?? "");
  try {
    switch (op) {
      case "setRole": {
        const u = await target(b.id, op);
        if (!(b.role in ROLE_LABEL)) refuse("That isn't a role Agora knows.");
        await changeAccount(u.id, { role: b.role });
        await logAdmin(actor, "Changed a role", u.email, `${ROLE_LABEL[u.role]} → ${ROLE_LABEL[b.role as AccountRole]}`);
        break;
      }
      case "setVerified": {
        const u = await target(b.id, op);
        await changeAccount(u.id, { verified: Boolean(b.on) });
        await logAdmin(actor, b.on ? "Confirmed an address" : "Marked an address unconfirmed", u.email);
        break;
      }
      case "setAdmin": {
        const u = await target(b.id, op);
        if (b.on && !u.verified) refuse("Confirm the account's address first. Admins must have a confirmed address.");
        await changeAccount(u.id, { granted_admin: Boolean(b.on) });
        await logAdmin(actor, b.on ? "Made an admin" : "Removed an admin", u.email);
        break;
      }
      case "setDisabled": {
        const u = await target(b.id, op);
        await changeAccount(u.id, { disabled: Boolean(b.on) });
        await logAdmin(actor, b.on ? "Suspended an account" : "Restored an account", u.email);
        break;
      }
      case "signOut": {
        const u = await target(b.id, op);
        const n = await endAllSessions(u.id);
        await logAdmin(actor, "Signed out everywhere", u.email, `${n} session${n === 1 ? "" : "s"} ended`);
        return NextResponse.json({ result: { ended: n } });
      }
      case "sendReset": {
        const u = await target(b.id, op);
        await sendReset(u, req);
        await logAdmin(actor, "Sent a password-reset link", u.email, canSendEmail() ? null : "not sent: no email service");
        return NextResponse.json({ result: { emailed: canSendEmail() } });
      }
      case "sendVerification": {
        const u = await target(b.id, op);
        if (u.verified) refuse("That address is already confirmed.");
        const sent = await sendVerification(u, req);
        await logAdmin(actor, "Sent a confirmation link", u.email, sent ? null : "not sent");
        return NextResponse.json({ result: { emailed: sent } });
      }
      case "delete": {
        const u = await target(b.id, op);
        if (String(b.confirm ?? "").trim().toLowerCase() !== u.email.toLowerCase()) refuse("Type the account's email to confirm.");
        await removeAccount(u.id);
        const removed = A.forgetAccount(u.id);
        await logAdmin(actor, "Deleted an account", u.email, `${removed.requests} searches and ${removed.reads} contract reads removed`);
        break;
      }
      case "approveClaim":
      case "rejectClaim": {
        const name = getDb().suppliers.find((s) => s.id === b.supplierId)?.name ?? String(b.supplierId);
        const claim = op === "approveClaim" ? A.approveClaim(b.supplierId) : A.rejectClaim(b.supplierId);
        await logAdmin(actor, op === "approveClaim" ? "Approved a supplier claim" : "Rejected a supplier claim", name, `${claim.name} <${claim.email}>`);
        break;
      }
      case "resetDemo": {
        A.reset();
        A.clearBuyer();
        await logAdmin(actor, "Reset the demo");
        break;
      }
      default:
        return NextResponse.json({ error: `Unknown operation: ${op}` }, { status: 400 });
    }
    return NextResponse.json({ result: { ok: true } });
  } catch (err) {
    if (err instanceof Refused || err instanceof AuthError || err instanceof A.ActionError) return NextResponse.json({ error: err.message }, { status: 400 });
    console.error("[admin]", err);
    return NextResponse.json({ error: "That didn't work. Try again." }, { status: 500 });
  }
});
