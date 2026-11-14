// What each request knows about who is asking. Three things come from the
// visitor's browser, in cookies, and are bound to the request (lib/db.ts):
//
//   - their agency, which decides the contracts they may use. Anyone can set
//     one; no account is needed.
//   - their account, if they have signed in (lib/auth.ts).
//   - an id for the browser, so searches made before signing in stay theirs.
//
// Every route that reads or changes the store goes through withSession(). It
// also waits for the saved state to load, and saves again after a change
// (lib/persist.ts). Server-only.

import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { setBuyer } from "./actions";
import { saveAgency, SESSION_COOKIE, userForToken } from "./auth";
import { getDb, inScope, type Scope } from "./db";
import { ready, saveSoon } from "./persist";
import type { Buyer, Db } from "./types";
import { STATES } from "./vehicles";

const AGENCY = "agora_agency";
const VISITOR = "agora_visitor";
const YEAR = 60 * 60 * 24 * 365;

export function cookie(req: Request, name: string): string | null {
  const raw = (req.headers.get("cookie") ?? "").split(/;\s*/).find((c) => c.startsWith(`${name}=`));
  return raw ? raw.slice(name.length + 1) : null;
}

/** The agency in the request's cookie, if it's there and well formed. It's a claim, as it is when typed into the picker. */
function agencyFromCookie(req: Request): Buyer | null {
  const raw = cookie(req, AGENCY);
  if (!raw) return null;
  try {
    const b = JSON.parse(decodeURIComponent(raw));
    if (typeof b?.name !== "string" || !b.name.trim() || b.name.length > 160) return null;
    if (!STATES.some(([c]) => c === b.state) || typeof b.entity_type !== "string") return null;
    return {
      name: b.name,
      state: b.state,
      entity_type: b.entity_type,
      population: typeof b.population === "number" ? b.population : null,
      ...(typeof b.domain === "string" ? { domain: b.domain.slice(0, 120) } : {}),
      ...(typeof b.directory_id === "string" ? { directory_id: b.directory_id.slice(0, 80) } : {}),
    };
  } catch {
    return null;
  }
}

const serialize = (b: Buyer | null) => (b ? JSON.stringify({ name: b.name, state: b.state, entity_type: b.entity_type, population: b.population, domain: b.domain, directory_id: b.directory_id }) : "");

// Agencies whose co-op memberships have been detected since this store was seeded. A cookie outlives a
// restart or a demo reset, so the first request after one runs the detection again.
const known = new WeakMap<Db, Set<string>>();

const secure = () => (process.env.NODE_ENV === "production" && process.env.RAILWAY_ENVIRONMENT ? "; Secure" : "");

/** A 401 the browser turns into a sign-in prompt, then retries. */
export const needsAccount = (what: string) => NextResponse.json({ error: `Sign in or create a free account to ${what}.`, needs_account: true }, { status: 401 });

/**
 * Wrap a route handler so the store sees this visitor's agency and account for the whole request.
 * `account` names what the route does when it needs a signed-in person ("upload a contract"); leave it out for routes open to everyone.
 */
export function withSession<A extends unknown[]>(handler: (req: Request, ...rest: A) => Response | Promise<Response>, opts: { account?: string; readOnly?: boolean } = {}) {
  return async (req: Request, ...rest: A): Promise<Response> => {
    await ready();
    const user = await userForToken(cookie(req, SESSION_COOKIE)).catch(() => null);
    const had = cookie(req, VISITOR);
    const visitor = had && /^[0-9a-f]{24}$/.test(had) ? had : randomBytes(12).toString("hex");
    const fromCookie = agencyFromCookie(req);
    // A signed-in person's saved agency follows them to a browser that has none yet.
    const start: Scope = { buyer: fromCookie ?? user?.agency ?? null, user, visitor };
    return inScope(start, async (s) => {
      const before = serialize(fromCookie);
      if (s.buyer) {
        const db = getDb();
        const seen = known.get(db) ?? known.set(db, new Set()).get(db)!;
        if (!seen.has(serialize(s.buyer))) {
          try {
            setBuyer(s.buyer);
            seen.add(serialize(s.buyer));
          } catch {
            s.buyer = null;
          }
        }
      }
      const res = opts.account && !s.user ? needsAccount(opts.account) : await handler(req, ...rest);
      const after = serialize(s.buyer);
      const set = (c: string) => {
        try {
          res.headers.append("set-cookie", c);
        } catch {
          // A response with locked headers (some redirects) keeps its cookies as they were.
        }
      };
      if (after !== before) {
        set(after ? `${AGENCY}=${encodeURIComponent(after)}; Path=/; Max-Age=${YEAR}; SameSite=Lax; HttpOnly${secure()}` : `${AGENCY}=; Path=/; Max-Age=0; SameSite=Lax; HttpOnly`);
        if (after) known.get(getDb())?.add(after);
      }
      if (s.user && after !== serialize(s.user.agency)) await saveAgency(s.user.id, s.buyer).catch((e) => console.error("[auth] couldn't save the agency:", (e as Error).message));
      if (visitor !== had) set(`${VISITOR}=${visitor}; Path=/; Max-Age=${YEAR}; SameSite=Lax; HttpOnly${secure()}`);
      if (!opts.readOnly) saveSoon();
      return res;
    });
  };
}
