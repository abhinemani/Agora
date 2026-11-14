// In-memory store. One demo, one process: a module-level singleton kept on
// globalThis so Next's dev-mode hot reloads don't wipe the demo mid-click.
//
// One thing is not shared: the agency a visitor is buying for. It is kept in
// that visitor's browser (lib/session.ts) and bound to each request here, so
// `db.session.buyer` reads the agency of whoever made the request.

import { AsyncLocalStorage } from "node:async_hooks";
import { seed } from "./seed";
import type { Buyer, Db } from "./types";

export interface Scope {
  buyer: Buyer | null;
  /** The signed-in account, if any (lib/auth.ts). */
  user: import("./auth").User | null;
  /** An id for this browser, so searches made before signing in stay with whoever made them. */
  visitor: string | null;
}

const g = globalThis as unknown as { __agoraDb?: Db; __agoraScope?: AsyncLocalStorage<Scope>; __agoraSeed?: Map<string, string> };
const scope = (g.__agoraScope ??= new AsyncLocalStorage<Scope>());

/** Make `session.buyer` read and write the current request's agency. Outside a request it falls back to one shared value. */
function perVisitor(db: Db): Db {
  let shared = db.session.buyer;
  Object.defineProperty(db.session, "buyer", {
    enumerable: true,
    configurable: true,
    get: () => {
      const s = scope.getStore();
      return s ? s.buyer : shared;
    },
    set: (b: Buyer | null) => {
      const s = scope.getStore();
      if (s) s.buyer = b;
      else shared = b;
    },
  });
  return db;
}

/** A fresh seed, with a copy of each collection as seeded so lib/persist.ts can tell what has changed since. */
function fresh(): Db {
  const db = seed();
  g.__agoraSeed = new Map(Object.entries(db).map(([k, v]) => [k, JSON.stringify(k === "session" ? { ...v, buyer: null } : v)]));
  return perVisitor(db);
}

export function getDb(): Db {
  if (!g.__agoraDb) g.__agoraDb = fresh();
  return g.__agoraDb;
}

export function resetDb(): Db {
  g.__agoraDb = fresh();
  return g.__agoraDb;
}

/** Each collection as it was seeded, serialized. */
export function seedSnapshot(): Map<string, string> {
  getDb();
  return g.__agoraSeed!;
}

/** The current request's account and browser id; both null outside a request. */
export const currentScope = (): Scope | undefined => scope.getStore();

/** Run a request with its visitor's agency bound to `db.session.buyer`. */
export function inScope<T>(start: Scope, fn: (s: Scope) => T): T {
  const s: Scope = { ...start };
  return scope.run(s, () => fn(s));
}

export function nextId(db: Db, kind: string, prefix: string, pad = 3): string {
  db.counters[kind] = (db.counters[kind] ?? 0) + 1;
  return `${prefix}_${String(db.counters[kind]).padStart(pad, "0")}`;
}

export const hasApiKey = () => Boolean(process.env.ANTHROPIC_API_KEY);
