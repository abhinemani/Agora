// The text of every TRX program's contract documents, in Postgres with a full-text index, so search can
// find a contract by what its documents say and "Ask a contract" can read all of them without fetching.
// lib/doc-ingest.ts fills it on the server. Without DATABASE_URL every function here is a no-op.
//
// Tables (created on first use):
//   doc_text   one row per distinct text (keyed by its hash): many contracts share an attachment, and many
//              attachments repeat the same standard terms, so identical text is stored once
//   doc_pages  that text by page (and part, for long pages), with a tsvector and a GIN index
//   doc_urls   each document URL Agora has tried: its text's hash, or why it couldn't be read
//   doc_links  which contract each URL belongs to, with its label, program and state
// Contact details printed in the documents are kept, at the product owner's instruction. Server-only.

import { createHash } from "node:crypto";
import { pool } from "./pg";

export interface StoredPage { num: number; text: string }
export type DocStatus = "text" | "scan" | "unsupported" | "too_large" | "failed";

/** Long pages (a whole spreadsheet, a Word file) are stored in parts of this many characters. */
const PART = 30_000;
const g = globalThis as unknown as { __agoraDocSchema?: Promise<boolean> };

/** Create the tables once per process. False when there is no database or it can't be reached. */
export function docSchema(): Promise<boolean> {
  const p = pool();
  if (!p) return Promise.resolve(false);
  return (g.__agoraDocSchema ??= p
    .query(
      `create table if not exists doc_text (
         hash text primary key,
         page_count int not null,
         chars int not null,
         created_at timestamptz not null default now()
       );
       create table if not exists doc_pages (
         hash text not null references doc_text(hash) on delete cascade,
         num int not null,
         part int not null default 0,
         text text not null,
         tsv tsvector generated always as (to_tsvector('english', left(text, ${PART + 2000}))) stored,
         primary key (hash, num, part)
       );
       create index if not exists doc_pages_tsv on doc_pages using gin (tsv);
       create table if not exists doc_urls (
         url text primary key,
         hash text references doc_text(hash),
         status text not null,
         detail text,
         filename text,
         bytes int,
         tries int not null default 1,
         checked_at timestamptz not null default now()
       );
       create table if not exists doc_links (
         url text not null,
         contract_id text not null,
         program text not null,
         state text,
         label text not null,
         primary key (url, contract_id)
       );
       create index if not exists doc_links_contract on doc_links(contract_id);
       alter table doc_urls add column if not exists via text not null default 'file';
       alter table doc_urls add column if not exists ocr_tries int not null default 0;
       create index if not exists doc_urls_scan on doc_urls(status) where status = 'scan';`,
    )
    .then(() => true)
    .catch((e) => {
      console.error("[docs] couldn't create the document tables:", (e as Error).message);
      g.__agoraDocSchema = undefined;
      return false;
    }));
}

const clean = (s: string) => s.replace(/\u0000/g, "").replace(/[ \t]{3,}/g, "   ").replace(/\n{3,}/g, "\n\n");

/** Save a document's text (or why it has none) under its URL. Identical text is stored once. */
export async function storeDocument(url: string, result: { pages: StoredPage[]; filename?: string | null; bytes?: number | null; via?: "file" | "scan" } | { status: Exclude<DocStatus, "text">; detail: string; filename?: string | null; bytes?: number | null }): Promise<void> {
  const p = pool();
  if (!p || !(await docSchema())) return;
  if ("status" in result) {
    await p.query(
      `insert into doc_urls (url, status, detail, filename, bytes) values ($1, $2, $3, $4, $5)
       on conflict (url) do update set status = excluded.status, detail = excluded.detail, filename = coalesce(excluded.filename, doc_urls.filename), bytes = coalesce(excluded.bytes, doc_urls.bytes), tries = doc_urls.tries + 1, checked_at = now()`,
      [url, result.status, result.detail.slice(0, 300), result.filename ?? null, result.bytes ?? null],
    );
    return;
  }
  const pages = result.pages.map((pg) => ({ num: pg.num, text: clean(pg.text) })).filter((pg) => pg.text.trim());
  const hash = createHash("sha256").update(pages.map((pg) => `${pg.num}\u0001${pg.text}`).join("\u0002")).digest("hex").slice(0, 32);
  const client = await p.connect();
  try {
    await client.query("begin");
    const fresh = await client.query(`insert into doc_text (hash, page_count, chars) values ($1, $2, $3) on conflict (hash) do nothing`, [hash, pages.length, pages.reduce((n, pg) => n + pg.text.length, 0)]);
    if (fresh.rowCount) {
      const rows: [string, number, number, string][] = [];
      for (const pg of pages) for (let i = 0, part = 0; i < pg.text.length; i += PART, part++) rows.push([hash, pg.num, part, pg.text.slice(i, i + PART)]);
      for (let i = 0; i < rows.length; i += 200) {
        const batch = rows.slice(i, i + 200);
        await client.query(`insert into doc_pages (hash, num, part, text) values ${batch.map((_, j) => `($${j * 4 + 1}, $${j * 4 + 2}, $${j * 4 + 3}, $${j * 4 + 4})`).join(", ")} on conflict do nothing`, batch.flat());
      }
    }
    await client.query(
      `insert into doc_urls (url, hash, status, detail, filename, bytes, via) values ($1, $2, 'text', null, $3, $4, $5)
       on conflict (url) do update set hash = excluded.hash, status = 'text', detail = null, filename = coalesce(excluded.filename, doc_urls.filename), bytes = coalesce(excluded.bytes, doc_urls.bytes), via = excluded.via, checked_at = now()`,
      [url, hash, result.filename ?? null, result.bytes ?? null, result.via ?? "file"],
    );
    await client.query("commit");
  } catch (e) {
    await client.query("rollback").catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}

/** Record which contracts link to which documents. */
export async function linkDocuments(links: { url: string; contract_id: string; program: string; state: string | null; label: string }[]): Promise<void> {
  const p = pool();
  if (!p || !links.length || !(await docSchema())) return;
  for (let i = 0; i < links.length; i += 500) {
    const b = links.slice(i, i + 500);
    await p.query(
      `insert into doc_links (url, contract_id, program, state, label) values ${b.map((_, j) => `($${j * 5 + 1}, $${j * 5 + 2}, $${j * 5 + 3}, $${j * 5 + 4}, $${j * 5 + 5})`).join(", ")}
       on conflict (url, contract_id) do update set label = excluded.label, program = excluded.program, state = excluded.state`,
      b.flatMap((l) => [l.url, l.contract_id, l.program, l.state, l.label.slice(0, 300)]),
    );
  }
}

/** A document's stored pages, parts joined back together. Null when it isn't stored. */
export async function storedPages(url: string): Promise<StoredPage[] | null> {
  const p = pool();
  if (!p || !(await docSchema())) return null;
  try {
    const r = await p.query<{ num: number; text: string }>(`select d.num, string_agg(d.text, '' order by d.part) as text from doc_urls u join doc_pages d on d.hash = u.hash where u.url = $1 and u.status = 'text' group by d.num order by d.num`, [url]);
    return r.rows.length ? r.rows : null;
  } catch {
    return null;
  }
}

/** URLs already settled: stored, or tried and not worth trying again yet (failures are retried after a day, three times
 * at most). Old Word files and files over 15 MB, which earlier versions couldn't take, get another try. */
export async function settledUrls(): Promise<Set<string>> {
  const p = pool();
  if (!p || !(await docSchema())) return new Set();
  const r = await p.query<{ url: string }>(
    `select url from doc_urls
     where not (status = 'unsupported' and detail like '%DOC files%' and tries < 3)
       and not (status = 'too_large' and detail like '%15 MB%' and tries < 3)
       and (status <> 'failed' or tries >= 3 or checked_at > now() - interval '1 day')`,
  );
  return new Set(r.rows.map((x) => x.url));
}

/** Scanned documents waiting to be read by Claude, oldest first, with a label from a contract that links them. */
export async function scansToRead(limit: number): Promise<{ url: string; label: string }[]> {
  const p = pool();
  if (!p || !(await docSchema())) return [];
  const r = await p.query<{ url: string; label: string }>(
    `select u.url, coalesce((select l.label from doc_links l where l.url = u.url limit 1), u.filename, 'Scanned document') as label
     from doc_urls u where u.status = 'scan' and u.ocr_tries < 3 order by u.checked_at limit $1`,
    [limit],
  );
  return r.rows;
}

/** A scan Claude couldn't read this time: counted, so it is tried three times at most. */
export async function scanNotRead(url: string, detail: string): Promise<void> {
  const p = pool();
  if (!p) return;
  await p.query(`update doc_urls set ocr_tries = ocr_tries + 1, detail = $2, checked_at = now() where url = $1`, [url, detail.slice(0, 300)]);
}

/** Pages read from scans so far, for the spending cap. */
export async function scanPagesRead(): Promise<number> {
  const p = pool();
  if (!p || !(await docSchema())) return 0;
  const r = await p.query<{ n: string | null }>(`select sum(t.page_count) n from doc_text t where exists (select 1 from doc_urls u where u.hash = t.hash and u.via = 'scan')`);
  return Number(r.rows[0].n ?? 0);
}

/** Words from a request or question as a tsquery: every word ("all"), or any of them ("any"). */
function tsquery(text: string, mode: "all" | "any"): string | null {
  const words = [...new Set((text.toLowerCase().match(/[a-z][a-z0-9]{2,}/g) ?? []).filter((w) => !STOP.has(w)))].slice(0, 12);
  if (!words.length) return null;
  return words.map((w) => `'${w}':*`).join(mode === "all" ? " & " : " | ");
}
const STOP = new Set("the and for are does did this that with from have has any can will what when where which who how its not but you your our their there about into under contract contracts agreement need needs want please".split(" "));

export interface DocumentHit {
  contract_id: string;
  label: string;
  url: string;
  page: number;
  rank: number;
  snippet: string;
}

/** Contracts whose documents contain every word of the request, best first, one hit per contract: the page that
 * matches best, with a few words around the match. `contracts` limits it to those ids. */
export async function searchDocuments(text: string, opts: { limit?: number; contracts?: string[]; programs?: string[] } = {}): Promise<DocumentHit[]> {
  const p = pool();
  const q = tsquery(text, "all");
  if (!p || !q || !(await docSchema())) return [];
  try {
    const r = await p.query<DocumentHit>(
      `with q as (select to_tsquery('english', $1) as q),
       hits as (
         select d.hash, d.num, d.part, ts_rank_cd(d.tsv, q.q) as rank
         from doc_pages d, q where d.tsv @@ q.q
         order by rank desc limit 2000
       ),
       best as (
         select distinct on (l.contract_id) l.contract_id, l.label, l.url, h.hash, h.num, h.part, h.rank
         from hits h join doc_urls u on u.hash = h.hash and u.status = 'text' join doc_links l on l.url = u.url
         where ($2::text[] is null or l.contract_id = any($2)) and ($3::text[] is null or l.program = any($3))
         order by l.contract_id, h.rank desc
       )
       select b.contract_id, b.label, b.url, b.num as page, b.rank,
              ts_headline('english', left(d.text, 20000), q.q, 'MaxWords=28, MinWords=10, MaxFragments=1, StartSel=@@b, StopSel=@@e') as snippet
       from best b join doc_pages d on d.hash = b.hash and d.num = b.num and d.part = b.part, q
       order by b.rank desc limit $4`,
      [q, opts.contracts ?? null, opts.programs ?? null, opts.limit ?? 60],
    );
    return r.rows.map((x) => ({ ...x, rank: Number(x.rank), snippet: x.snippet.replace(/@@[be]/g, "").replace(/\s+/g, " ").trim() }));
  } catch (e) {
    console.error("[docs] search failed:", (e as Error).message);
    return [];
  }
}

/** The pages of one contract's stored documents that best match a question (any of its words), for "Ask a contract". */
export async function contractPages(contractId: string, question: string, limit = 12): Promise<{ label: string; url: string; num: number; text: string }[]> {
  const p = pool();
  const q = tsquery(question, "any");
  if (!p || !q || !(await docSchema())) return [];
  try {
    const r = await p.query<{ label: string; url: string; num: number; text: string }>(
      `with q as (select to_tsquery('english', $2) as q)
       select l.label, l.url, d.num, d.text
       from doc_links l join doc_urls u on u.url = l.url and u.status = 'text' join doc_pages d on d.hash = u.hash, q
       where l.contract_id = $1 and d.tsv @@ q.q
       order by ts_rank_cd(d.tsv, q.q) desc limit $3`,
      [contractId, q, limit],
    );
    return r.rows;
  } catch {
    return [];
  }
}

/** How far the store has got, for /api/docs/status and the logs. */
export async function docStoreStatus(): Promise<{ database: boolean; urls: Record<string, number>; read_from_scans: number; scans_waiting: number; linked_urls: number; contracts: number; texts: number; pages: number; database_mb: number | null; by_program: Record<string, { linked: number; text: number }> } | null> {
  const p = pool();
  if (!p || !(await docSchema())) return null;
  const [urls, linked, texts, size, prog, scans] = await Promise.all([
    p.query<{ status: string; n: string }>(`select status, count(*) n from doc_urls group by status`),
    p.query<{ urls: string; contracts: string }>(`select count(distinct url) urls, count(distinct contract_id) contracts from doc_links`),
    p.query<{ texts: string; pages: string }>(`select (select count(*) from doc_text) texts, (select count(*) from doc_pages) pages`),
    p.query<{ mb: string }>(`select round(pg_database_size(current_database()) / 1048576.0) mb`),
    p.query<{ program: string; linked: string; text: string }>(`select l.program, count(distinct l.url) linked, count(distinct l.url) filter (where u.status = 'text') text from doc_links l left join doc_urls u on u.url = l.url group by l.program`),
    p.query<{ read: string; waiting: string }>(`select count(*) filter (where via = 'scan' and status = 'text') read, count(*) filter (where status = 'scan' and ocr_tries < 3) waiting from doc_urls`),
  ]);
  return {
    database: true,
    urls: Object.fromEntries(urls.rows.map((r) => [r.status, Number(r.n)])),
    read_from_scans: Number(scans.rows[0].read),
    scans_waiting: Number(scans.rows[0].waiting),
    linked_urls: Number(linked.rows[0].urls),
    contracts: Number(linked.rows[0].contracts),
    texts: Number(texts.rows[0].texts),
    pages: Number(texts.rows[0].pages),
    database_mb: Number(size.rows[0].mb),
    by_program: Object.fromEntries(prog.rows.map((r) => [r.program, { linked: Number(r.linked), text: Number(r.text) }])),
  };
}

/** The database's size in MB, to stop filling it before the volume runs out. */
export async function databaseMb(): Promise<number | null> {
  const p = pool();
  if (!p) return null;
  const r = await p.query<{ mb: string }>(`select round(pg_database_size(current_database()) / 1048576.0) mb`);
  return Number(r.rows[0].mb);
}
