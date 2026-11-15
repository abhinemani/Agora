// What each catalog product is, coded once through the AI review loop (scripts/cleanup, task "product-kind").
//
// A reviewer answers three things about a product: its kind, the short noun phrase a buyer would use for it ("pickup
// truck", "swing", "toner cartridge"); its role (a whole item, a part of something else, a consumable, a rate); and up
// to four other names buyers use for it ("can liner" for a trash bag). collect.ts keeps an answer only when every word
// of the kind appears in the product's own record (its name, maker, contract or price-sheet section), so the kind is
// named from the data, never invented. Aliases are synonyms, not facts, and are kept short.
//
// The catalog importer attaches the decisions to products, and lib/catalog.ts and lib/dive.ts rank a product that is
// the kind asked for above one whose name only mentions it.

import { tokens } from "../lib/assistant";

export const KIND_ROLES = ["item", "part", "accessory", "consumable", "rate", "service"] as const;
export type KindRole = (typeof KIND_ROLES)[number];

/** The review item key: one per distinct product name. */
export const productKindKey = (name: string) => name.toLowerCase().replace(/\s+/g, " ").trim().slice(0, 160);

const PHRASE = /^[a-z0-9][a-z0-9 '\-/&.]{0,40}$/;

export interface KindAnswer {
  kind: string;
  role: KindRole;
  aliases: string[];
  confidence: "high" | "medium" | "low";
  reason?: string;
}

/** Check a reviewer's answer against its item. Returns the decision to keep, or null. */
export function checkKindAnswer(item: { name: string; maker?: string; contract?: string; section?: string }, a: Record<string, unknown>): KindAnswer | null {
  const kind = String(a.kind ?? "").toLowerCase().trim().replace(/\s+/g, " ");
  if (!PHRASE.test(kind) || kind.split(" ").length > 4) return null;
  const role = String(a.role ?? "") as KindRole;
  if (!KIND_ROLES.includes(role)) return null;
  // Every word of the kind is in the product's own record.
  const record = new Set(tokens(`${item.name} ${item.maker ?? ""} ${item.contract ?? ""} ${item.section ?? ""}`));
  const words = tokens(kind);
  if (!words.length || !words.every((w) => record.has(w))) return null;
  const aliases = (Array.isArray(a.aliases) ? a.aliases : [])
    .map((x) => String(x).toLowerCase().trim().replace(/\s+/g, " "))
    .filter((x) => PHRASE.test(x) && x.split(" ").length <= 3 && x !== kind);
  return {
    kind,
    role,
    aliases: [...new Set(aliases)].slice(0, 4),
    confidence: a.confidence as KindAnswer["confidence"],
    reason: String(a.reason ?? "").slice(0, 80) || undefined,
  };
}
