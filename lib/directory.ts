// Agora's co-op directory: every government the public co-op rosters, agency
// procurement pages, documented purchases, Texas DIR and the .gov registry name,
// one record each. Built by scripts/import-coop-data.ts into
// seed/coops/directory.json.gz. Server only: 72,000 records stay here and the
// browser asks /api/directory for the few it needs.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { entityKey, normalizeDomain } from "./coops";
import type { Buyer, DirectoryGovernment, EntityType, MembershipEvidence } from "./types";

interface Row {
  i: string;
  n: string;
  a: string[];
  s: string;
  c?: string;
  k?: string;
  t: EntityType;
  st: "public" | "inferred";
  d?: string;
  /** The government's other .gov domains. */
  ds?: string[];
  p: { c: string; e: MembershipEvidence; m?: string; u?: string }[];
  r?: Record<string, MembershipEvidence>;
  x?: { sales: number; lines: number; first: string; last: string };
  b?: DirectoryGovernment["purchases"];
  f: string[];
}

interface Index {
  retrieved: string;
  rows: Row[];
  byId: Map<string, Row>;
  byKey: Map<string, Row>;
  byDomain: Map<string, Row>;
  /** Lowercased names and aliases, for search. */
  text: string[];
}

const g = globalThis as unknown as { __agoraDirectory?: Index };

function load(): Index {
  if (g.__agoraDirectory) return g.__agoraDirectory;
  const raw = JSON.parse(gunzipSync(readFileSync(join(process.cwd(), "seed/coops/directory.json.gz"))).toString("utf8")) as { retrieved: string; rows: Row[] };
  const idx: Index = { retrieved: raw.retrieved, rows: raw.rows, byId: new Map(), byKey: new Map(), byDomain: new Map(), text: [] };
  for (const r of raw.rows) {
    idx.byId.set(r.i, r);
    for (const n of [r.n, ...r.a]) {
      const k = `${r.s}|${entityKey(n)}`;
      if (!idx.byKey.has(k)) idx.byKey.set(k, r);
    }
    for (const d of [r.d, ...(r.ds ?? [])]) if (d && !idx.byDomain.has(d)) idx.byDomain.set(d, r);
    idx.text.push([r.n, ...r.a].join(" | ").toLowerCase());
  }
  g.__agoraDirectory = idx;
  return idx;
}

const RANK: Record<MembershipEvidence, number> = { list: 0, roster: 1, agency: 2, purchase: 3 };

function toGovernment(r: Row): DirectoryGovernment {
  return {
    id: r.i,
    name: r.n,
    aliases: r.a,
    state: r.s,
    city: r.c,
    county: r.k,
    entity_type: r.t,
    status: r.st,
    domain: r.d,
    coops: r.p.map((p) => ({ coop_id: p.c, evidence: p.e, member_id: p.m, source_url: p.u })).sort((a, b) => RANK[b.evidence] - RANK[a.evidence]),
    routes: r.r ?? {},
    dir: r.x,
    purchases: r.b,
    sources: r.f,
  };
}

export const directoryRetrieved = () => load().retrieved;
export const directorySize = () => load().rows.length;

export function getGovernment(id: string | undefined | null): DirectoryGovernment | null {
  const r = id ? load().byId.get(id) : undefined;
  return r ? toGovernment(r) : null;
}

/** The directory's record for this agency: by its directory id, then its website, then its name within its state. */
export function findGovernment(buyer: Pick<Buyer, "name" | "state" | "domain" | "directory_id">): DirectoryGovernment | null {
  const idx = load();
  const byId = buyer.directory_id ? idx.byId.get(buyer.directory_id) : undefined;
  if (byId) return toGovernment(byId);
  const domain = normalizeDomain(buyer.domain);
  const byDomain = domain ? idx.byDomain.get(domain) : undefined;
  if (byDomain && byDomain.s === buyer.state) return toGovernment(byDomain);
  const byKey = idx.byKey.get(`${buyer.state}|${entityKey(buyer.name)}`);
  return byKey ? toGovernment(byKey) : null;
}

/** Typeahead over names and aliases. Exact key matches first, then names that start
 * with the query, then names containing it; governments a source classifies as public,
 * and those on more co-ops, break ties. */
export function searchDirectory(q: string, opts: { state?: string; limit?: number } = {}): DirectoryGovernment[] {
  const idx = load();
  const query = q.trim().toLowerCase();
  if (query.length < 2) return [];
  const key = entityKey(q);
  const words = query.split(/\s+/).filter(Boolean);
  const scored: { r: Row; score: number }[] = [];
  for (let i = 0; i < idx.rows.length; i++) {
    const r = idx.rows[i];
    if (opts.state && r.s !== opts.state) continue;
    const text = idx.text[i];
    if (!words.every((w) => text.includes(w))) continue;
    const keys = [r.n, ...r.a].map(entityKey);
    let score = keys.includes(key) ? 100 : keys.some((k) => k.startsWith(key)) ? 60 : text.startsWith(query) ? 50 : 20;
    score += r.st === "public" ? 8 : 0;
    score += Math.min(r.p.length, 6) * 2 + (r.d ? 3 : 0) + (r.x ? 2 : 0);
    scored.push({ r, score });
  }
  return scored
    .sort((a, b) => b.score - a.score || a.r.n.length - b.r.n.length)
    .slice(0, opts.limit ?? 8)
    .map((s) => toGovernment(s.r));
}
