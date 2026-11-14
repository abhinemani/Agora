// Builds lib/state-rules.json from the 50-state cooperative purchasing research
// (seed/states/source/): the summary workbook's four tables, plus each state's section of
// the report (prose with statute links), keyed by state code.
//
//   npx tsx scripts/import-state-rules.ts
//
// Flags in the research ([mirror], [secondary], [unverified], [currency unconfirmed]) are
// kept in the text so the app can show them. Not legal advice.

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as XLSX from "xlsx";
import { STATES } from "../lib/vehicles";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "seed/states/source");
const WORKBOOK = "state-cooperative-purchasing-tables-2026-11-13.xlsx";
const REPORT = "state-cooperative-purchasing-rules-2026-11-13.md";

const wb = XLSX.read(readFileSync(join(SRC, WORKBOOK)));
const sheet = (name: string) => XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[name], { defval: "" });
const s = (v: unknown) => String(v ?? "").trim();

const report = readFileSync(join(SRC, REPORT), "utf8");
const sections = new Map<string, string>();
for (const part of report.split(/\n### /).slice(1)) {
  const [head, ...rest] = part.split("\n");
  // A state's section runs to the next heading of any level.
  sections.set(head.trim(), rest.join("\n").split(/\n#{2,3} /)[0].trim());
}

const rules: Record<string, unknown> = {};
const auth = new Map(sheet("Authority").map((r) => [s(r["State code"]), r]));
const cond = new Map(sheet("Conditions").map((r) => [s(r["State code"]), r]));
const thr = new Map(sheet("Thresholds").map((r) => [s(r["State code"]), r]));
for (const [code, name] of STATES) {
  if (code === "DC") continue;
  const a = auth.get(code), c = cond.get(code), t = thr.get(code);
  const detail = sections.get(name);
  if (!a || !c || !t || !detail) throw new Error(`${code}: missing from the research (${[!a && "authority", !c && "conditions", !t && "thresholds", !detail && "report section"].filter(Boolean).join(", ")})`);
  rules[code] = {
    state: name,
    tier: Number(a["Openness tier (1-5)"]),
    tier_label: s(a["Tier description"]),
    local: s(a["Local governments"]),
    schools: s(a["School districts"]),
    state_list: s(a["State list or approval"]),
    agreement: s(c["Agreement or board action"]),
    lead_test: s(c["Lead-contract test"]),
    excluded: s(c["Excluded or restricted"]),
    no_competition: s(t["No competition required"]),
    quotes: s(t["Quotes"]),
    formal_bid: s(t["Formal bid"]),
    threshold_source: s(t["Statute or source"]),
    detail,
  };
}

writeFileSync(
  join(ROOT, "lib/state-rules.json"),
  JSON.stringify({ researched: "2026-11-13", source: `seed/states/source/${REPORT}`, rules }, null, 1) + "\n",
);
const tiers = Object.values(rules).reduce<Record<number, number>>((m, r: any) => ((m[r.tier] = (m[r.tier] ?? 0) + 1), m), {});
console.log(`${Object.keys(rules).length} states; by openness tier:`, tiers);
