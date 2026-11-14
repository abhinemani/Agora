// Accounts: email and password, with a session cookie. Passwords are stored
// only as salted scrypt hashes, and session tokens only as SHA-256 hashes, so
// neither can be read back out of the database. Users and sessions live in
// Postgres when DATABASE_URL is set, and in memory otherwise. Server-only.

import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { pool, schema } from "./pg";
import type { Buyer } from "./types";

export type AccountRole = "buyer" | "procurement" | "supplier";

export interface User {
  id: string;
  email: string;
  name: string;
  role: AccountRole;
  /** The agency this person buys for, saved with the account. */
  agency: Buyer | null;
  /** They opened a link sent to this address, so it is theirs. Notices go only to confirmed addresses. */
  verified: boolean;
  /** Another admin made them one in the admin pages (lib/admin.ts also counts AGORA_ADMIN_EMAILS). */
  granted_admin: boolean;
  /** An admin suspended the account: it can't sign in, and its sessions no longer count. */
  disabled: boolean;
}
interface Stored extends User {
  password_hash: string;
  created_at?: string;
  last_seen_at?: string | null;
}

export class AuthError extends Error {}

export const SESSION_COOKIE = "agora_session";
const SESSION_DAYS = 30;
const ROLES: AccountRole[] = ["buyer", "procurement", "supplier"];

interface Memory {
  users: Map<string, Stored>;
  sessions: Map<string, { user_id: string; expires: number }>;
  tokens: Map<string, { user_id: string; kind: TokenKind; expires: number }>;
}
const mem = ((globalThis as unknown as { __agoraAuth?: Memory }).__agoraAuth ??= { users: new Map(), sessions: new Map(), tokens: new Map() });
mem.tokens ??= new Map();

export type TokenKind = "verify" | "reset";
const TOKEN_MINUTES: Record<TokenKind, number> = { verify: 60 * 24 * 3, reset: 60 };
const COLUMNS = "id, email, name, role, agency, email_verified_at is not null as verified, is_admin as granted_admin, disabled_at is not null as disabled";
const U_COLUMNS = "u.id, u.email, u.name, u.role, u.agency, u.email_verified_at is not null as verified, u.is_admin as granted_admin, u.disabled_at is not null as disabled";

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const publicUser = (u: Stored): User => ({ id: u.id, email: u.email, name: u.name, role: u.role, agency: u.agency, verified: u.verified, granted_admin: Boolean(u.granted_admin), disabled: Boolean(u.disabled) });

function hashPassword(password: string, salt = randomBytes(16).toString("hex")): Promise<string> {
  return new Promise((resolve, reject) => scrypt(password, salt, 64, (err, key) => (err ? reject(err) : resolve(`scrypt$${salt}$${key.toString("hex")}`))));
}
async function passwordMatches(password: string, stored: string) {
  const [, salt, hex] = stored.split("$");
  if (!salt || !hex) return false;
  const [, , again] = (await hashPassword(password, salt)).split("$");
  const a = Buffer.from(again, "hex");
  const b = Buffer.from(hex, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

async function byEmail(email: string): Promise<Stored | null> {
  const p = pool();
  if (!p) return [...mem.users.values()].find((u) => u.email === email) ?? null;
  await schema();
  const r = await p.query(`select ${COLUMNS}, password_hash from users where email = $1`, [email]);
  return (r.rows[0] as Stored | undefined) ?? null;
}

// Five wrong passwords for one email in ten minutes pauses sign-in for that email.
const failures = new Map<string, number[]>();
function throttled(email: string) {
  const recent = (failures.get(email) ?? []).filter((t) => Date.now() - t < 10 * 60_000);
  failures.set(email, recent);
  return recent.length >= 5;
}

const cleanEmail = (email: unknown) => String(email ?? "").trim().toLowerCase();

export async function signUp(args: { email: unknown; password: unknown; name: unknown; role: unknown; agency: Buyer | null }): Promise<User> {
  const email = cleanEmail(args.email);
  const name = String(args.name ?? "").trim().slice(0, 120);
  const password = String(args.password ?? "");
  const role = ROLES.includes(args.role as AccountRole) ? (args.role as AccountRole) : "buyer";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || email.length > 200) throw new AuthError("Enter a valid email address.");
  if (!name) throw new AuthError("Enter your name.");
  if (password.length < 10) throw new AuthError("Use a password of at least 10 characters.");
  if (password.length > 200) throw new AuthError("That password is too long.");
  if (await byEmail(email)) throw new AuthError("There's already an account for that email. Sign in instead.");
  const user: Stored = { id: `usr_${randomBytes(9).toString("hex")}`, email, name, role, agency: args.agency, verified: false, granted_admin: false, disabled: false, password_hash: await hashPassword(password), created_at: new Date().toISOString(), last_seen_at: null };
  const p = pool();
  if (!p) mem.users.set(user.id, user);
  else {
    try {
      await p.query("insert into users (id, email, name, role, password_hash, agency) values ($1, $2, $3, $4, $5, $6)", [user.id, email, name, role, user.password_hash, user.agency ? JSON.stringify(user.agency) : null]);
    } catch (e) {
      if ((e as { code?: string }).code === "23505") throw new AuthError("There's already an account for that email. Sign in instead.");
      throw e;
    }
  }
  return publicUser(user);
}

export async function signIn(args: { email: unknown; password: unknown }): Promise<User> {
  const email = cleanEmail(args.email);
  if (throttled(email)) throw new AuthError("Too many tries for that email. Wait ten minutes and try again.");
  const user = await byEmail(email);
  // The same message either way, so the form doesn't reveal which emails have accounts.
  if (!user || !(await passwordMatches(String(args.password ?? ""), user.password_hash))) {
    failures.set(email, [...(failures.get(email) ?? []), Date.now()]);
    throw new AuthError("That email and password don't match an account.");
  }
  failures.delete(email);
  if (user.disabled) throw new AuthError("This account has been suspended. Write to the Agora team if you think that's a mistake.");
  return publicUser(user);
}

/** Start a session and return the token for the cookie. Only its hash is stored. */
export async function startSession(userId: string): Promise<string> {
  const token = randomBytes(32).toString("hex");
  const expires = Date.now() + SESSION_DAYS * 86_400_000;
  const p = pool();
  if (!p) mem.sessions.set(sha(token), { user_id: userId, expires });
  else await p.query("insert into sessions (token_hash, user_id, expires_at) values ($1, $2, $3)", [sha(token), userId, new Date(expires)]);
  return token;
}

/** Remove an account for good, with its sessions and email links. The person must have just given their password. */
export async function deleteUser(args: { userId: string; email: string; password: unknown }) {
  const stored = await byEmail(cleanEmail(args.email));
  if (!stored || stored.id !== args.userId || !(await passwordMatches(String(args.password ?? ""), stored.password_hash))) throw new AuthError("That password isn't right.");
  const p = pool();
  if (!p) {
    mem.users.delete(args.userId);
    for (const [k, v] of mem.sessions) if (v.user_id === args.userId) mem.sessions.delete(k);
    for (const [k, v] of mem.tokens) if (v.user_id === args.userId) mem.tokens.delete(k);
  } else await p.query("delete from users where id = $1", [args.userId]); // sessions and email links go with it
}

export async function endSession(token: string | null) {
  if (!token) return;
  const p = pool();
  if (!p) mem.sessions.delete(sha(token));
  else await p.query("delete from sessions where token_hash = $1", [sha(token)]);
}

export async function userForToken(token: string | null): Promise<User | null> {
  if (!token || !/^[0-9a-f]{64}$/.test(token)) return null;
  const p = pool();
  if (!p) {
    const s = mem.sessions.get(sha(token));
    if (!s || s.expires < Date.now()) return null;
    const u = mem.users.get(s.user_id);
    if (!u || u.disabled) return null;
    u.last_seen_at = new Date().toISOString();
    return publicUser(u);
  }
  await schema();
  const r = await p.query(`select ${U_COLUMNS} from sessions s join users u on u.id = s.user_id where s.token_hash = $1 and s.expires_at > now() and u.disabled_at is null`, [sha(token)]);
  const user = (r.rows[0] as User | undefined) ?? null;
  // When each person was last here, for the admin pages. Written at most every five minutes, and never in the request's way.
  if (user) void p.query("update users set last_seen_at = now() where id = $1 and (last_seen_at is null or last_seen_at < now() - interval '5 minutes')", [user.id]).catch(() => undefined);
  return user;
}

/** Save the agency a signed-in person chose, so it follows them to other browsers. */
export async function saveAgency(userId: string, agency: Buyer | null) {
  const p = pool();
  if (!p) {
    const u = mem.users.get(userId);
    if (u) u.agency = agency;
  } else await p.query("update users set agency = $2 where id = $1", [userId, agency ? JSON.stringify(agency) : null]);
}

export const sessionCookie = (token: string | null) =>
  token ? `${SESSION_COOKIE}=${token}; Path=/; Max-Age=${SESSION_DAYS * 86_400}; SameSite=Lax; HttpOnly${process.env.NODE_ENV === "production" && process.env.RAILWAY_ENVIRONMENT ? "; Secure" : ""}` : `${SESSION_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax; HttpOnly`;

// ---------------------------------------------------------------- links sent by email

/** A one-use link token for confirming an address or resetting a password. Only its hash is stored. */
export async function issueToken(userId: string, kind: TokenKind): Promise<string> {
  const token = randomBytes(32).toString("hex");
  const expires = Date.now() + TOKEN_MINUTES[kind] * 60_000;
  const p = pool();
  if (!p) {
    for (const [k, t] of mem.tokens) if (t.user_id === userId && t.kind === kind) mem.tokens.delete(k);
    mem.tokens.set(sha(token), { user_id: userId, kind, expires });
  } else {
    // A new link replaces any earlier one of the same kind.
    await p.query("delete from email_tokens where user_id = $1 and kind = $2", [userId, kind]);
    await p.query("insert into email_tokens (token_hash, user_id, kind, expires_at) values ($1, $2, $3, $4)", [sha(token), userId, kind, new Date(expires)]);
  }
  return token;
}

/** Use up a link token and return whose it was, or null if it's unknown, used or expired. */
async function redeem(token: unknown, kind: TokenKind): Promise<string | null> {
  if (typeof token !== "string" || !/^[0-9a-f]{64}$/.test(token)) return null;
  const p = pool();
  if (!p) {
    const t = mem.tokens.get(sha(token));
    if (!t || t.kind !== kind) return null;
    mem.tokens.delete(sha(token));
    return t.expires > Date.now() ? t.user_id : null;
  }
  const r = await p.query("delete from email_tokens where token_hash = $1 and kind = $2 returning user_id, expires_at > now() as live", [sha(token), kind]);
  return r.rows[0]?.live ? (r.rows[0].user_id as string) : null;
}

async function markVerified(userId: string) {
  const p = pool();
  if (!p) {
    const u = mem.users.get(userId);
    if (u) u.verified = true;
  } else await p.query("update users set email_verified_at = coalesce(email_verified_at, now()) where id = $1", [userId]);
}

export async function userById(id: string): Promise<User | null> {
  const p = pool();
  if (!p) {
    const u = mem.users.get(id);
    return u ? publicUser(u) : null;
  }
  const r = await p.query(`select ${COLUMNS} from users where id = $1`, [id]);
  return (r.rows[0] as User | undefined) ?? null;
}

/** The account for an email, without its password hash. For sending a reset link. */
export async function userByEmail(email: unknown): Promise<User | null> {
  const u = await byEmail(cleanEmail(email));
  return u ? publicUser(u) : null;
}

/** Confirm an address from its emailed link. */
export async function verifyEmail(token: unknown): Promise<User> {
  const id = await redeem(token, "verify");
  if (!id) throw new AuthError("That link has expired or was already used. Sign in and ask for a new one.");
  await markVerified(id);
  return (await userById(id)) ?? Promise.reject(new AuthError("That account no longer exists."));
}

/** Set a new password from an emailed link. Signs the person out everywhere else, and confirms the address, since they just proved it's theirs. */
export async function resetPassword(token: unknown, password: unknown): Promise<User> {
  const pw = String(password ?? "");
  if (pw.length < 10) throw new AuthError("Use a password of at least 10 characters.");
  if (pw.length > 200) throw new AuthError("That password is too long.");
  const id = await redeem(token, "reset");
  if (!id) throw new AuthError("That link has expired or was already used. Ask for a new one.");
  const hash = await hashPassword(pw);
  const p = pool();
  if (!p) {
    const u = mem.users.get(id);
    if (u) u.password_hash = hash;
    for (const [k, v] of mem.sessions) if (v.user_id === id) mem.sessions.delete(k);
  } else {
    await p.query("update users set password_hash = $2 where id = $1", [id, hash]);
    await p.query("delete from sessions where user_id = $1", [id]);
  }
  await markVerified(id);
  return (await userById(id)) ?? Promise.reject(new AuthError("That account no longer exists."));
}

/** People with confirmed addresses at an agency, by what they do. For approval notices. */
export async function staffAt(agency: string, role: AccountRole): Promise<User[]> {
  const p = pool();
  if (!p) return [...mem.users.values()].filter((u) => u.role === role && u.verified && !u.disabled && u.agency?.name === agency).map(publicUser);
  const r = await p.query(`select ${COLUMNS} from users where role = $1 and email_verified_at is not null and disabled_at is null and agency->>'name' = $2 limit 25`, [role, agency]);
  return r.rows as User[];
}

// At most three link emails per address per hour, so the form can't be used to flood someone's inbox.
const sent = new Map<string, number[]>();
export function mayEmail(email: string) {
  const recent = (sent.get(email) ?? []).filter((t) => Date.now() - t < 60 * 60_000);
  if (recent.length >= 3) return false;
  sent.set(email, [...recent, Date.now()]);
  return true;
}

// ---------------------------------------------------------------- the admin pages

export interface AccountRow extends User {
  created_at: string | null;
  last_seen_at: string | null;
  /** Browsers signed in to the account now. */
  sessions: number;
}

export interface AccountCounts {
  total: number;
  verified: number;
  granted_admin: number;
  disabled: number;
  new_7d: number;
  seen_7d: number;
  by_role: Record<string, number>;
}

const WEEK = 7 * 86_400_000;

/** Every account, newest first, matched on name, email or agency. For admins only: the caller checks. */
export async function listAccounts(opts: { q?: string; limit?: number; offset?: number } = {}): Promise<{ rows: AccountRow[]; total: number }> {
  const q = String(opts.q ?? "").trim().toLowerCase().slice(0, 120);
  const limit = Math.min(Math.max(Number(opts.limit) || 50, 1), 200);
  const offset = Math.max(Number(opts.offset) || 0, 0);
  const p = pool();
  if (!p) {
    const live = new Map<string, number>();
    for (const s of mem.sessions.values()) if (s.expires > Date.now()) live.set(s.user_id, (live.get(s.user_id) ?? 0) + 1);
    const all = [...mem.users.values()]
      .filter((u) => !q || [u.email, u.name, u.agency?.name ?? ""].some((f) => f.toLowerCase().includes(q)))
      .sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""));
    return { total: all.length, rows: all.slice(offset, offset + limit).map((u) => ({ ...publicUser(u), created_at: u.created_at ?? null, last_seen_at: u.last_seen_at ?? null, sessions: live.get(u.id) ?? 0 })) };
  }
  await schema();
  const where = q ? "where lower(email) like $1 or lower(name) like $1 or lower(coalesce(agency->>'name', '')) like $1" : "";
  const args = q ? [`%${q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`] : [];
  const [rows, total] = await Promise.all([
    p.query(
      `select ${COLUMNS}, created_at, last_seen_at, (select count(*)::int from sessions s where s.user_id = users.id and s.expires_at > now()) sessions
         from users ${where} order by created_at desc limit ${limit} offset ${offset}`,
      args,
    ),
    p.query<{ n: string }>(`select count(*) n from users ${where}`, args),
  ]);
  return {
    total: Number(total.rows[0].n),
    rows: rows.rows.map((r) => ({ ...r, created_at: r.created_at ? new Date(r.created_at).toISOString() : null, last_seen_at: r.last_seen_at ? new Date(r.last_seen_at).toISOString() : null })) as AccountRow[],
  };
}

/** Counts for the admin overview. */
export async function accountCounts(): Promise<AccountCounts> {
  const p = pool();
  if (!p) {
    const all = [...mem.users.values()];
    const since = Date.now() - WEEK;
    const by_role: Record<string, number> = {};
    for (const u of all) by_role[u.role] = (by_role[u.role] ?? 0) + 1;
    return {
      total: all.length,
      verified: all.filter((u) => u.verified).length,
      granted_admin: all.filter((u) => u.granted_admin).length,
      disabled: all.filter((u) => u.disabled).length,
      new_7d: all.filter((u) => u.created_at && Date.parse(u.created_at) > since).length,
      seen_7d: all.filter((u) => u.last_seen_at && Date.parse(u.last_seen_at) > since).length,
      by_role,
    };
  }
  await schema();
  const [c, roles] = await Promise.all([
    p.query(
      `select count(*)::int total, count(email_verified_at)::int verified, count(*) filter (where is_admin)::int granted_admin, count(disabled_at)::int disabled,
              count(*) filter (where created_at > now() - interval '7 days')::int new_7d, count(*) filter (where last_seen_at > now() - interval '7 days')::int seen_7d
         from users`,
    ),
    p.query<{ role: string; n: number }>(`select role, count(*)::int n from users group by role`),
  ]);
  return { ...(c.rows[0] as Omit<AccountCounts, "by_role">), by_role: Object.fromEntries(roles.rows.map((r) => [r.role, r.n])) };
}

export interface AccountChange {
  role?: AccountRole;
  verified?: boolean;
  granted_admin?: boolean;
  disabled?: boolean;
}

/** Change an account from the admin pages. Suspending it also signs it out everywhere. */
export async function changeAccount(id: string, change: AccountChange): Promise<User> {
  if (change.role !== undefined && !ROLES.includes(change.role)) throw new AuthError("That isn't a role Agora knows.");
  const p = pool();
  if (!p) {
    const u = mem.users.get(id);
    if (!u) throw new AuthError("That account no longer exists.");
    if (change.role !== undefined) u.role = change.role;
    if (change.verified !== undefined) u.verified = change.verified;
    if (change.granted_admin !== undefined) u.granted_admin = change.granted_admin;
    if (change.disabled !== undefined) u.disabled = change.disabled;
  } else {
    const sets: string[] = [];
    const args: unknown[] = [id];
    const put = (sql: string, v?: unknown) => {
      if (v !== undefined) args.push(v);
      sets.push(sql.replace("?", `$${args.length}`));
    };
    if (change.role !== undefined) put("role = ?", change.role);
    if (change.verified !== undefined) put(change.verified ? "email_verified_at = coalesce(email_verified_at, now())" : "email_verified_at = null");
    if (change.granted_admin !== undefined) put("is_admin = ?", change.granted_admin);
    if (change.disabled !== undefined) put(change.disabled ? "disabled_at = coalesce(disabled_at, now())" : "disabled_at = null");
    if (sets.length) {
      const r = await p.query(`update users set ${sets.join(", ")} where id = $1`, args);
      if (!r.rowCount) throw new AuthError("That account no longer exists.");
    }
  }
  if (change.disabled) await endAllSessions(id);
  return (await userById(id)) ?? Promise.reject(new AuthError("That account no longer exists."));
}

/** Sign an account out of every browser. Returns how many sessions ended. */
export async function endAllSessions(userId: string): Promise<number> {
  const p = pool();
  if (!p) {
    let n = 0;
    for (const [k, v] of mem.sessions) if (v.user_id === userId) n += Number(mem.sessions.delete(k));
    return n;
  }
  return (await p.query("delete from sessions where user_id = $1", [userId])).rowCount ?? 0;
}

/** Remove an account for good from the admin pages, with its sessions and email links. */
export async function removeAccount(userId: string) {
  const p = pool();
  if (!p) {
    if (!mem.users.delete(userId)) throw new AuthError("That account no longer exists.");
    await endAllSessions(userId);
    for (const [k, v] of mem.tokens) if (v.user_id === userId) mem.tokens.delete(k);
  } else {
    const r = await p.query("delete from users where id = $1", [userId]);
    if (!r.rowCount) throw new AuthError("That account no longer exists.");
  }
}
