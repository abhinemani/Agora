// A co-op's member list: one government per row, uploaded by Sovra ops as CSV
// or XLSX. Columns are found by their usual names. A website, or failing that
// an email address, gives the domain Agora matches on; a state lets a row
// without either still match by name.

import { normalizeDomain } from "./coops";
import { STATES } from "./vehicles";
import type { CoopMember } from "./types";

const HEADERS = {
  name: /^(member( name)?|government|agency( name)?|entity( name)?|organi[sz]ation( name)?|name|customer( name)?|account( name)?|jurisdiction)$/i,
  domain: /^(website|web ?site|domain|url|homepage|web address)$/i,
  email: /^(e-?mail|contact e-?mail|primary contact e-?mail|email address)$/i,
  state: /^(state|st|state code)$/i,
};

export class MemberListError extends Error {}

export interface MemberListParse {
  header_row: number;
  columns: Record<string, string>;
  members: CoopMember[];
  issues: { row: number; problem: string; text: string }[];
  /** Rows imported without a website or email: they can only match by name and state. */
  name_only: number;
}

const cell = (v: unknown) => (v == null ? "" : String(v).trim());
const stateCode = (v: string) => {
  const s = v.trim();
  if (!s) return "";
  const byCode = STATES.find(([c]) => c === s.toUpperCase());
  if (byCode) return byCode[0];
  return STATES.find(([, n]) => n.toLowerCase() === s.toLowerCase())?.[0] ?? null;
};

export function parseMemberList(table: unknown[][]): MemberListParse {
  let headerRow = -1;
  let map: Partial<Record<keyof typeof HEADERS, number>> = {};
  for (let r = 0; r < Math.min(table.length, 15); r++) {
    const found: typeof map = {};
    (table[r] ?? []).forEach((h, i) => {
      const name = cell(h).replace(/\s+/g, " ");
      for (const f of Object.keys(HEADERS) as (keyof typeof HEADERS)[]) if (found[f] === undefined && HEADERS[f].test(name)) found[f] = i;
    });
    if (found.name !== undefined) {
      headerRow = r;
      map = found;
      break;
    }
  }
  if (headerRow < 0) throw new MemberListError("Couldn't find the header row. The list needs a column naming each government, such as “Member Name” or “Agency”.");

  const columns = Object.fromEntries(Object.entries(map).map(([f, i]) => [f, cell(table[headerRow][i!])]));
  const get = (r: unknown[], f: keyof typeof HEADERS) => (map[f] === undefined ? "" : cell(r[map[f]!]));
  const members: CoopMember[] = [];
  const issues: MemberListParse["issues"] = [];
  const seen = new Set<string>();
  let nameOnly = 0;
  for (let r = headerRow + 1; r < table.length; r++) {
    const raw = table[r] ?? [];
    if (raw.every((v) => !cell(v))) continue;
    const text = raw.map(cell).filter(Boolean).join(" | ");
    const name = get(raw, "name");
    const email = get(raw, "email");
    const domain = normalizeDomain(get(raw, "domain")) || (email.includes("@") ? normalizeDomain(email.split("@").pop()) : "");
    const state = stateCode(get(raw, "state"));
    if (!name) {
      issues.push({ row: r + 1, problem: "no government name", text });
      continue;
    }
    if (state === null) {
      issues.push({ row: r + 1, problem: `“${get(raw, "state")}” isn't a state`, text });
      continue;
    }
    if (!domain && !state) {
      issues.push({ row: r + 1, problem: "no website, email or state, so it can't be matched to an agency", text });
      continue;
    }
    const key = domain || `${name.toLowerCase()}|${state}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (!domain) nameOnly++;
    members.push({ name, domain, state: state || undefined });
  }
  return { header_row: headerRow + 1, columns, members, issues, name_only: nameOnly };
}
