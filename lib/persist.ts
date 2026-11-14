// Keeps the app's state in Postgres, so a redeploy doesn't lose it.
//
// The store is still the in-memory Db that every action mutates (lib/db.ts).
// What goes to the database is the difference between that Db and a fresh
// seed: new and changed records, removed ids, and their order. On start, the
// seed is built as usual and the saved difference is applied on top. So a
// change to the seed (a new contract, a corrected price) still reaches the
// site, except where someone has since edited that same record.
//
// With no DATABASE_URL this does nothing and the state stays in memory.

import { getDb, seedSnapshot } from "./db";
import { pool, schema } from "./pg";
import type { Db } from "./types";

type Saved = { kind: "items"; upsert: { id: string }[]; remove: string[]; order: string[] } | { kind: "value"; value: unknown };

interface Persist {
  ready?: Promise<void>;
  written: Map<string, string>;
  timer?: NodeJS.Timeout;
  saving?: Promise<void>;
}
const g = globalThis as unknown as { __agoraPersist?: Persist };
const state: Persist = (g.__agoraPersist ??= { written: new Map<string, string>() });

const hasIds = (v: unknown): v is { id: string }[] => Array.isArray(v) && v.every((x) => x && typeof x === "object" && typeof (x as { id?: unknown }).id === "string");
/** The session without the visitor's agency, which lives in their browser. */
const plain = (key: string, v: unknown) => (key === "session" ? { ...(v as object), buyer: null } : v);

/** Each collection as seeded in this process, to compare the live store against. */
const baseline = () => seedSnapshot();

function diff(key: string, current: unknown): Saved | null {
  const base = baseline().get(key);
  const now = JSON.stringify(plain(key, current));
  if (now === base) return null;
  const before: unknown = base === undefined ? undefined : JSON.parse(base);
  if (hasIds(current) && (before === undefined || hasIds(before))) {
    const was = new Map(((before as { id: string }[] | undefined) ?? []).map((x) => [x.id, JSON.stringify(x)]));
    const ids = new Set(current.map((x) => x.id));
    return { kind: "items", upsert: current.filter((x) => was.get(x.id) !== JSON.stringify(x)), remove: [...was.keys()].filter((id) => !ids.has(id)), order: current.map((x) => x.id) };
  }
  return { kind: "value", value: plain(key, current) };
}

function apply(db: Db, key: string, saved: Saved) {
  const store = db as unknown as Record<string, unknown>;
  if (saved.kind === "value") {
    if (key === "session") Object.assign(db.session, { ...(saved.value as object), buyer: db.session.buyer });
    else store[key] = saved.value;
    return;
  }
  const byId = new Map(((store[key] as { id: string }[] | undefined) ?? []).map((x) => [x.id, x]));
  for (const id of saved.remove) byId.delete(id);
  for (const item of saved.upsert) byId.set(item.id, item);
  // Saved order first; records the seed has gained since then go on the end.
  const ordered = saved.order.map((id) => byId.get(id)).filter((x): x is { id: string } => Boolean(x));
  const placed = new Set(ordered.map((x) => x.id));
  store[key] = [...ordered, ...[...byId.values()].filter((x) => !placed.has(x.id))];
}

/** Load the saved state once per process. Routes wait for this before touching the store. */
export function ready(): Promise<void> {
  const p = pool();
  if (!p) return Promise.resolve();
  return (state.ready ??= (async () => {
    await schema();
    baseline();
    const db = getDb();
    const rows = await p.query("select key, value from app_state");
    for (const r of rows.rows as { key: string; value: Saved }[]) {
      try {
        apply(db, r.key, r.value);
        state.written.set(r.key, JSON.stringify(r.value));
      } catch (e) {
        console.error(`[persist] couldn't apply saved ${r.key}:`, (e as Error).message);
      }
    }
    console.log(`[persist] loaded ${rows.rowCount} saved collection${rows.rowCount === 1 ? "" : "s"} from Postgres`);
  })().catch((e) => {
    // A database that can't be reached shouldn't take the site down: run from the seed, and try again on the next request.
    console.error("[persist] couldn't load saved state:", (e as Error).message);
    state.ready = undefined;
  }));
}

async function write() {
  const p = pool();
  if (!p) return;
  const db = getDb() as unknown as Record<string, unknown>;
  for (const key of Object.keys(db)) {
    const d = diff(key, db[key]);
    const text = d ? JSON.stringify(d) : "";
    if ((state.written.get(key) ?? "") === text) continue;
    if (d) await p.query("insert into app_state (key, value, updated_at) values ($1, $2, now()) on conflict (key) do update set value = excluded.value, updated_at = now()", [key, text]);
    else await p.query("delete from app_state where key = $1", [key]);
    state.written.set(key, text);
  }
}

/** Save soon. Calls made while a save is pending or running fold into one more save after it. */
export function saveSoon() {
  if (!pool() || state.timer) return;
  state.timer = setTimeout(() => {
    state.timer = undefined;
    state.saving = (state.saving ?? Promise.resolve()).then(write).catch((e) => console.error("[persist] save failed:", (e as Error).message));
  }, 400);
}

/** Save now, for tests and shutdown. */
export async function flush() {
  if (state.timer) clearTimeout(state.timer);
  state.timer = undefined;
  await (state.saving = (state.saving ?? Promise.resolve()).then(write));
}

if (pool() && !(globalThis as unknown as { __agoraFlushHook?: boolean }).__agoraFlushHook) {
  (globalThis as unknown as { __agoraFlushHook?: boolean }).__agoraFlushHook = true;
  process.once("SIGTERM", () => void flush().catch(() => {}).finally(() => process.exit(0)));
}
