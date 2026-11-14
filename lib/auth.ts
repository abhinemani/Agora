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
}
interface Stored extends User {
  password_hash: string;
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
const COLUMNS = "id, email, name, role, agency, email_verified_at is not null as verified";

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const publicUser = ({ password_hash: _hash, ...u }: Stored): User => u;

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
  const user: Stored = { id: `usr_${randomBytes(9).toString("hex")}`, email, name, role, agency: args.agency, verified: false, password_hash: await hashPassword(password) };
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
    return u ? publicUser(u) : null;
  }
  await schema();
  const r = await p.query(`select ${COLUMNS.replace(/\b(id|email|name|role|agency|email_verified_at)\b/g, "u.$1")} from sessions s join users u on u.id = s.user_id where s.token_hash = $1 and s.expires_at > now()`, [sha(token)]);
  return (r.rows[0] as User | undefined) ?? null;
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
  if (!p) return [...mem.users.values()].filter((u) => u.role === role && u.verified && u.agency?.name === agency).map(publicUser);
  const r = await p.query(`select ${COLUMNS} from users where role = $1 and email_verified_at is not null and agency->>'name' = $2 limit 25`, [role, agency]);
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
