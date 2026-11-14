// NIGP commodity codes, as NJSTART's public contract pages print them (scripts/import-njstart.ts
// writes seed/catalog/source/njstart/nigp.json). Agora holds no licensed NIGP codebook, so it can
// name only the codes those records use: 520 item codes in 150 classes. Server only.
//
// Contracts carry their codes in CatalogContract.nigp: "published" when the contract's own records
// print them (NJSTART), "reviewed" when the AI review chose the classes from this list (co-ops, GSA).

import { readFileSync } from "node:fs";
import { join } from "node:path";

interface Codebook {
  codes: Record<string, { description: string; lines: number; contracts: number }>;
  classes: Record<string, { items: string[]; contracts: number }>;
}

const g = globalThis as unknown as { __agoraNigp?: Codebook };
function load(): Codebook {
  if (!g.__agoraNigp) g.__agoraNigp = JSON.parse(readFileSync(join(process.cwd(), "seed/catalog/source/njstart/nigp.json"), "utf8")) as Codebook;
  return g.__agoraNigp;
}

/** "490-90" → its description as NJSTART prints it. */
export const nigpCodeLabel = (code: string): string | null => load().codes[code]?.description ?? null;

/** A class has no published title here, so it's described by the item codes seen under it: "490: Testing Instruments, Laboratory; …". */
export function nigpClassLabel(cls: string, max = 2): string | null {
  const items = load().classes[cls]?.items ?? [];
  if (!items.length) return null;
  const names = items.map((x) => x.replace(/^\d{3}-\d{2}\s+/, "").replace(/,?\s*\(Not Otherwise Classified\)/i, "").trim());
  return names.slice(0, max).join("; ") + (names.length > max ? "; …" : "");
}

/** Is this text a NIGP code or class ("490", "490-90", "49090")? Returns it normalized. */
export function asNigp(q: string): string | null {
  const m = q.trim().match(/^(?:nigp\s*)?(\d{3})(?:-?(\d{2}))?$/i);
  return m ? (m[2] ? `${m[1]}-${m[2]}` : m[1]) : null;
}
