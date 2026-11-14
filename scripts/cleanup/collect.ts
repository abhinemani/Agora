// Merges the review agents' decisions (seed/cleanup/out/<task>-NN.part<K>.json) into one
// file per task (seed/cleanup/decisions/<task>.json), checking every decision against the
// item it answers: a pick must be one of the candidates offered, a category one of
// Agora's, a merge only within its group, and every Canon number must appear in its
// source line. Anything that fails a check is dropped and counted.
//
//   npx tsx scripts/cleanup/collect.ts           every task
//   npx tsx scripts/cleanup/collect.ts nigp      only the named tasks
//
// A task with no shards on disk is skipped, never written empty: the committed decisions
// stay as they are until their review is run again.

import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CATEGORIES } from "../../lib/types";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const SHARDS = join(ROOT, "seed/cleanup/shards");
const OUT = join(ROOT, "seed/cleanup/out");
const DECISIONS = join(ROOT, "seed/cleanup/decisions");

type Item = Record<string, any>;
const items = (task: string) => {
  const m = new Map<string, Item>();
  for (const f of readdirSync(SHARDS).filter((f) => f.startsWith(`${task}-`) && f.endsWith(".jsonl")))
    for (const l of readFileSync(join(SHARDS, f), "utf8").split("\n").filter(Boolean)) {
      const x = JSON.parse(l);
      m.set(String(x.id), x);
    }
  return m;
};
const answers = (task: string) => {
  const m = new Map<string, any>();
  if (!existsSync(OUT)) return m;
  for (const f of readdirSync(OUT).filter((f) => f.startsWith(`${task}-`) && f.endsWith(".json"))) {
    try {
      for (const [k, v] of Object.entries(JSON.parse(readFileSync(join(OUT, f), "utf8")))) m.set(String(k), v);
    } catch {
      console.warn(`skipped unreadable ${f}`);
    }
  }
  return m;
};

/** Every number in a line, as it could be written: "5,510.00" → 5510; "50.00%" → 50. */
const numbersIn = (line: string) => new Set((line.match(/\d[\d,]*(\.\d+)?/g) ?? []).map((n) => Number(n.replace(/,/g, ""))));
const CONF = new Set(["high", "medium", "low"]);

const ONLY = new Set(process.argv.slice(2));
const summaryFile = join(DECISIONS, "summary.json");
const summary: Record<string, Record<string, number>> = existsSync(summaryFile) ? JSON.parse(readFileSync(summaryFile, "utf8")) : {};
function collect(task: string, check: (item: Item, a: any) => any | null) {
  if (ONLY.size && !ONLY.has(task)) return;
  if (!existsSync(SHARDS)) return;
  const its = items(task);
  if (!its.size) {
    console.warn(`${task}: no shards on disk, decisions left as they are`);
    return;
  }
  const ans = answers(task);
  const out: Record<string, unknown> = {};
  const s = { items: its.size, answered: 0, kept: 0, invalid: 0, missing: 0, high: 0, medium: 0, low: 0, picked: 0, low_picked: 0 };
  for (const [id, item] of its) {
    const a = ans.get(id);
    if (!a) {
      s.missing++;
      continue;
    }
    s.answered++;
    const v = a && CONF.has(a.confidence) ? check(item, a) : null;
    if (!v) {
      s.invalid++;
      continue;
    }
    out[id] = v;
    s.kept++;
    s[v.confidence as "high"]++;
    if (v.pick || v.merge?.length || v.price != null || v.classes?.length) {
      s.picked++;
      if (v.confidence === "low") s.low_picked++;
    }
  }
  writeFileSync(join(DECISIONS, `${task}.json`), JSON.stringify(out, null, 1) + "\n");
  summary[task] = s;
}

const pickFrom = (ids: string[]) => (item: Item, a: any) =>
  a.pick === null || ids.includes(a.pick) ? { pick: a.pick ?? null, confidence: a.confidence, reason: String(a.reason ?? "").slice(0, 140) } : null;

collect("gov-match", (item, a) => pickFrom(item.candidates.map((c: Item) => c.id))(item, a));
collect("school-pairs", (item, a) => pickFrom(item.candidates.map((c: Item) => c.id))(item, a));
collect("supplier-merge", (item, a) => {
  const ids = new Set(item.suppliers.map((s: Item) => s.id));
  if (!Array.isArray(a.merge) || !a.merge.every((set: unknown) => Array.isArray(set) && set.length >= 2 && set.every((x) => ids.has(x)))) return null;
  return { merge: a.merge, confidence: a.confidence, reason: String(a.reason ?? "").slice(0, 140) };
});
collect("category", (item, a) => ((CATEGORIES as readonly string[]).includes(a.pick) ? { pick: a.pick, confidence: a.confidence, reason: String(a.reason ?? "").slice(0, 80) } : null));
collect("canon-rows", (item, a) => {
  const nums = numbersIn(item.line);
  for (const k of ["list", "discount", "price"]) if (a[k] != null && !nums.has(Number(a[k]))) return null;
  return {
    name: a.name ?? null,
    sku: a.sku && item.line.includes(a.sku) ? a.sku : null,
    list: a.list ?? null,
    discount: a.discount ?? null,
    price: a.price ?? null,
    unit: a.unit ?? null,
    issue: a.issue ?? null,
    confidence: a.confidence,
    page: item.page,
    line: item.line,
  };
});
// Up to three NIGP classes, each one of the classes offered (the ones NJSTART's records name); none is an answer.
const nigpClasses = existsSync(join(SHARDS, "nigp-classes.json")) ? new Set(Object.keys(JSON.parse(readFileSync(join(SHARDS, "nigp-classes.json"), "utf8")))) : new Set<string>();
collect("nigp", (item, a) => {
  const picks = Array.isArray(a.classes) ? [...new Set(a.classes.map((x: unknown) => String(x)))] : null;
  if (!picks || picks.length > 3 || !picks.every((x) => nigpClasses.has(x as string))) return null;
  return { classes: picks, confidence: a.confidence, reason: String(a.reason ?? "").slice(0, 100) };
});
collect("product-name", (item, a) => (a.pick === null || item.variants.includes(a.pick) ? { pick: a.pick ?? null, confidence: a.confidence, reason: String(a.reason ?? "").slice(0, 100) } : null));

writeFileSync(summaryFile, JSON.stringify(summary, null, 1) + "\n");
console.table(summary);
