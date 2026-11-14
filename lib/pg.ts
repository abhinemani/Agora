// The Postgres connection. With DATABASE_URL set, accounts, sessions and the
// app's state are stored there. Without it (local runs, the rehearsal) the app
// keeps everything in memory, as it always has. Server-only.

import { Pool } from "pg";

const g = globalThis as unknown as { __agoraPool?: Pool | null; __agoraSchema?: Promise<void> };

export const hasDatabase = () => Boolean(process.env.DATABASE_URL);

export function pool(): Pool | null {
  if (g.__agoraPool !== undefined) return g.__agoraPool;
  const url = process.env.DATABASE_URL;
  if (!url) return (g.__agoraPool = null);
  // Railway's private network and local databases don't use TLS; anything else must.
  const local = /@(localhost|127\.0\.0\.1|\[::1\]|[^/@]*\.railway\.internal)[:/]/.test(url) || /sslmode=disable/.test(url);
  g.__agoraPool = new Pool({ connectionString: url, max: 5, ssl: local ? false : { rejectUnauthorized: process.env.PGSSLMODE !== "no-verify" } });
  g.__agoraPool.on("error", (e) => console.error("[pg] idle client error:", e.message));
  return g.__agoraPool;
}

/** Create the tables once per process. */
export function schema(): Promise<void> {
  const p = pool();
  if (!p) return Promise.resolve();
  return (g.__agoraSchema ??= p
    .query(
      `create table if not exists users (
         id text primary key,
         email text not null unique,
         name text not null,
         role text not null,
         password_hash text not null,
         agency jsonb,
         created_at timestamptz not null default now()
       );
       create table if not exists sessions (
         token_hash text primary key,
         user_id text not null references users(id) on delete cascade,
         expires_at timestamptz not null
       );
       create index if not exists sessions_user on sessions(user_id);
       create table if not exists app_state (
         key text primary key,
         value jsonb not null,
         updated_at timestamptz not null default now()
       );`,
    )
    .then(() => undefined));
}
