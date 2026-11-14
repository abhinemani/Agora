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
}
interface Stored extends User {
  password_hash: string;
}

export class AuthError extends Error {}

export const SESSION_COOKIE = "agora_session";
const SESSION_DAYS = 30;
const ROLES: AccountRole[] = ["buyer", "procurement", "supplier"];

const mem = ((globalThis as unknown as { __agoraAuth?: { users: Map<string, Stored>; sessions: Map<string, { user_id: string; expires: number }> } }).__agoraAuth ??= { users: new Map(), sessions: new Map() });

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
  const r = await p.query("select id, email, name, role, password_hash, agency from users where email = $1", [email]);
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
  const user: Stored = { id: `usr_${randomBytes(9).toString("hex")}`, email, name, role, agency: args.agency, password_hash: await hashPassword(password) };
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
  const r = await p.query("select u.id, u.email, u.name, u.role, u.agency from sessions s join users u on u.id = s.user_id where s.token_hash = $1 and s.expires_at > now()", [sha(token)]);
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
