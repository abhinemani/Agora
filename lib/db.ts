// In-memory store. One demo, one process: a module-level singleton kept on
// globalThis so Next's dev-mode hot reloads don't wipe the demo mid-click.

import { seed } from "./seed";
import type { Db } from "./types";

const g = globalThis as unknown as { __agoraDb?: Db };

export function getDb(): Db {
  if (!g.__agoraDb) g.__agoraDb = seed();
  return g.__agoraDb;
}

export function resetDb(): Db {
  g.__agoraDb = seed();
  return g.__agoraDb;
}

export function nextId(db: Db, kind: string, prefix: string, pad = 3): string {
  db.counters[kind] = (db.counters[kind] ?? 0) + 1;
  return `${prefix}_${String(db.counters[kind]).padStart(pad, "0")}`;
}

export const hasApiKey = () => Boolean(process.env.ANTHROPIC_API_KEY);
