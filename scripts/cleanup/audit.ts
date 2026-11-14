// Prints a random sample of each task's applied decisions (high and medium confidence)
// next to the item it answers, for a person to check before shipping.
//
//   npx tsx scripts/cleanup/audit.ts [per-task sample size, default 12]

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const N = Number(process.argv[2] ?? 12);
const items = new Map<string, Record<string, any>>();
for (const f of readdirSync(join(ROOT, "seed/cleanup/shards")).filter((f) => f.endsWith(".jsonl")))
  for (const l of readFileSync(join(ROOT, "seed/cleanup/shards", f), "utf8").split("\n").filter(Boolean)) {
    const x = JSON.parse(l);
    items.set(`${f.replace(/-\d+\.jsonl$/, "")}|${x.id}`, x);
  }

// A fixed, evenly spaced sample, so two runs of the audit show the same rows.
const sample = <T,>(xs: T[], n: number) => (xs.length <= n ? xs : Array.from({ length: n }, (_, i) => xs[Math.floor((i * xs.length) / n)]));

for (const task of ["gov-match", "school-pairs", "supplier-merge", "category", "canon-rows", "product-name"]) {
  let d: Record<string, any> = {};
  try {
    d = JSON.parse(readFileSync(join(ROOT, "seed/cleanup/decisions", `${task}.json`), "utf8"));
  } catch {
    continue;
  }
  const applied = Object.entries(d).filter(([, v]) => v.confidence !== "low" && (v.pick || v.merge?.length || v.price != null));
  const nulls = Object.entries(d).filter(([, v]) => v.pick === null);
  console.log(`\n=== ${task}: ${applied.length} applied, ${nulls.length} answered "none"`);
  for (const [id, v] of sample(applied, N)) {
    const it = items.get(`${task}|${id}`) ?? {};
    if (task === "gov-match") {
      const c = it.candidates?.find((x: any) => x.id === v.pick);
      console.log(`  ${it.names?.[0]} (${it.state}, ${it.type})  →  ${c?.name} (${c?.type})  [${v.confidence}] ${v.reason}`);
    } else if (task === "school-pairs") {
      const c = it.candidates?.find((x: any) => x.id === v.pick);
      console.log(`  ${it.census?.name} (${it.census?.state})  →  ${c?.name}  [${v.confidence}] ${v.reason}`);
    } else if (task === "supplier-merge") {
      const names = new Map((it.suppliers ?? []).map((s: any) => [s.id, s.name]));
      console.log(`  ${v.merge.map((set: string[]) => set.map((x) => names.get(x)).join(" = ")).join(" | ")}  [${v.confidence}] ${v.reason}`);
    } else if (task === "category") console.log(`  ${it.title?.slice(0, 70)}  →  ${v.pick}  [${v.confidence}]`);
    else if (task === "canon-rows") console.log(`  ${it.line?.slice(0, 80)}  →  ${v.name} | ${v.price} ${v.unit ?? ""}  [${v.confidence}]`);
    else console.log(`  ${it.variants?.slice(0, 2).join(" / ").slice(0, 80)}  →  ${v.pick}  [${v.confidence}]`);
  }
  if (task === "gov-match" || task === "school-pairs")
    for (const [id, v] of sample(nulls, 4)) {
      const it = items.get(`${task}|${id}`) ?? {};
      console.log(`  NONE: ${it.names?.[0] ?? it.census?.name}  vs  ${it.candidates?.[0]?.name}  — ${v.reason}`);
    }
}
