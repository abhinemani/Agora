// OrCPP, the Oregon Cooperative Procurement Program: the public bodies that have joined it and may buy
// from DAS's statewide price agreements opened to cooperative purchasing. The list is DAS's own
// (seed/catalog/source/oregon/members.json, from npm run fetch:oregon): each member's name, number and type.
// Server-only, read on first use.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Buyer } from "./types";

interface Member { name: string; number: string | null; type: string | null }
const FILE = join(process.cwd(), "seed/catalog/source/oregon/members.json");
const store = ((globalThis as unknown as { __agoraOrcpp?: { loaded: boolean; byKey: Map<string, Member>; keys: string[]; count: number; retrieved: string | null } }).__agoraOrcpp ??= { loaded: false, byKey: new Map(), keys: [], count: 0, retrieved: null });

/** "Bend, City of" and "City of Bend" → "city of bend"; punctuation and "the" dropped. */
export function orcppKey(name: string): string {
  let s = name.toLowerCase().replace(/&/g, " and ").replace(/\s+/g, " ").trim();
  const inverted = s.match(/^(.+?),\s*(city|town|county|port) of$/);
  if (inverted) s = `${inverted[2]} of ${inverted[1]}`;
  return s
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\b(the)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function load() {
  if (store.loaded) return;
  store.loaded = true;
  if (!existsSync(FILE)) return;
  const data = JSON.parse(readFileSync(FILE, "utf8")) as { retrieved: string; members: Member[] };
  for (const m of data.members) store.byKey.set(orcppKey(m.name), m);
  store.keys = [...store.byKey.keys()];
  store.count = data.members.length;
  store.retrieved = data.retrieved;
}

/** The OrCPP member this buyer is, by name: the same name, or one that extends it by whole words
 * ("Beaverton School District 48J" for "Beaverton School District"). Null when DAS's list doesn't name it. */
export function orcppMember(buyer: Pick<Buyer, "name" | "state">): string | null {
  if (buyer.state !== "OR") return null;
  load();
  const key = orcppKey(buyer.name);
  if (!key) return null;
  const exact = store.byKey.get(key);
  if (exact) return exact.name;
  const near = store.keys.filter((k) => k.startsWith(`${key} `) || key.startsWith(`${k} `));
  return near.length === 1 ? store.byKey.get(near[0])!.name : null;
}

/** How many members DAS lists, and when Agora read the list. */
export function orcppInfo(): { members: number; retrieved: string | null } {
  load();
  return { members: store.count, retrieved: store.retrieved };
}
