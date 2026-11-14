// What admins have done: every change made from /admin, and the demo resets and claim approvals made elsewhere.
// In Postgres when DATABASE_URL is set, and in memory (the last 500) otherwise. Holds account emails, so it is
// shown only to admins. Server-only.

import { pool, schema } from "./pg";
import type { User } from "./auth";

export interface AdminEntry {
  id: string;
  made_at: string;
  actor_email: string;
  action: string;
  /** Whom or what it was done to: an account's email, a supplier's name. */
  target: string | null;
  detail: string | null;
}

const mem = ((globalThis as unknown as { __agoraAdminLog?: AdminEntry[] }).__agoraAdminLog ??= []);
let seq = 0;

/** Record one admin action. Never throws: a failure to log mustn't undo the action. */
export async function logAdmin(actor: Pick<User, "id" | "email"> | null | undefined, action: string, target?: string | null, detail?: string | null) {
  const entry = { actor_email: actor?.email ?? "(unknown)", action, target: target ?? null, detail: detail ?? null };
  const p = pool();
  if (!p) {
    mem.unshift({ id: `m${++seq}`, made_at: new Date().toISOString(), ...entry });
    mem.length = Math.min(mem.length, 500);
    return;
  }
  try {
    await schema();
    await p.query("insert into admin_log (actor_id, actor_email, action, target, detail) values ($1, $2, $3, $4, $5)", [actor?.id ?? null, entry.actor_email, action, entry.target, entry.detail]);
  } catch (e) {
    console.error("[admin-log] couldn't record:", (e as Error).message);
  }
}

export async function recentAdminLog(limit = 50): Promise<AdminEntry[]> {
  const n = Math.min(Math.max(limit, 1), 200);
  const p = pool();
  if (!p) return mem.slice(0, n);
  await schema();
  const r = await p.query(`select id::text, made_at, actor_email, action, target, detail from admin_log order by made_at desc limit ${n}`);
  return r.rows.map((x) => ({ ...x, made_at: new Date(x.made_at).toISOString() }));
}
