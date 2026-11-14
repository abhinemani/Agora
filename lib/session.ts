// The visitor's agency lives in their browser, in a cookie, not on the server.
// Every route that reads or changes the store goes through withSession(): it
// reads the cookie, binds that agency to the request (lib/db.ts), and writes
// the cookie back when the request changed it. Two people using the site at
// once each see their own agency. Server-only.

import { setBuyer } from "./actions";
import { getDb, inScope } from "./db";
import type { Buyer, Db } from "./types";
import { STATES } from "./vehicles";

const COOKIE = "agora_agency";
const YEAR = 60 * 60 * 24 * 365;

/** The agency in the request's cookie, if it's there and well formed. It's a claim, as it is when typed into the picker. */
function fromCookie(req: Request): Buyer | null {
  const raw = (req.headers.get("cookie") ?? "").split(/;\s*/).find((c) => c.startsWith(`${COOKIE}=`));
  if (!raw) return null;
  try {
    const b = JSON.parse(decodeURIComponent(raw.slice(COOKIE.length + 1)));
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

/** Wrap a route handler so `db.session.buyer` is the visitor's own agency for the whole request. */
export function withSession<A extends unknown[]>(handler: (req: Request, ...rest: A) => Response | Promise<Response>) {
  return (req: Request, ...rest: A): Promise<Response> =>
    inScope(fromCookie(req), async (s) => {
      const before = serialize(s.buyer);
      if (s.buyer) {
        const db = getDb();
        const seen = known.get(db) ?? known.set(db, new Set()).get(db)!;
        if (!seen.has(before)) {
          try {
            setBuyer(s.buyer);
            seen.add(serialize(s.buyer));
          } catch {
            s.buyer = null;
          }
        }
      }
      const res = await handler(req, ...rest);
      const after = serialize(s.buyer);
      if (after !== before || (!after && req.headers.get("cookie")?.includes(`${COOKIE}=`))) {
        const cookie = after ? `${COOKIE}=${encodeURIComponent(after)}; Path=/; Max-Age=${YEAR}; SameSite=Lax; HttpOnly` : `${COOKIE}=; Path=/; Max-Age=0; SameSite=Lax; HttpOnly`;
        try {
          res.headers.append("set-cookie", cookie);
        } catch {
          // A response with locked headers (some redirects) keeps the cookie as it was.
        }
        if (after) known.get(getDb())?.add(after);
      }
      return res;
    });
}
