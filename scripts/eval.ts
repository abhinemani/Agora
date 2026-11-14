// Runs the fixed test set in evals/cases.ts and compares it with the last
// saved baseline. Run it before changing a prompt, and again after.
//
//   npm run eval                  every case (live cases need ANTHROPIC_API_KEY, or
//                                 AGORA_ANTHROPIC_API_KEY in a Claude Code cloud session)
//   npm run eval -- --guards      only the cases that need no key
//   npm run eval -- --only brief  cases whose id or task contains "brief"
//   npm run eval -- --runs 3      each live case three times; it passes only if all three do,
//                                 and its pass rate (2/3) is printed and saved with --save
//   npm run eval -- --save        save this run as the baseline (evals/baseline.json)
//
// It exits with an error if any case fails that isn't already recorded as
// failing in the baseline.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { aiRecords, TASKS, type Task } from "../lib/ai-log";
import { apiKey } from "../lib/api-key";
import { MODEL, promptsSeen, stubModel } from "../lib/llm";
import { CASES, fixtures, type Case } from "../evals/cases";

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i < 0 ? null : (process.argv[i + 1] ?? "");
};
const has = (name: string) => process.argv.includes(`--${name}`);

interface Baseline {
  saved: string;
  model: string;
  /** Each task's prompt fingerprint when the baseline was saved. */
  prompts: Partial<Record<Task, string>>;
  cases: Record<string, "pass" | "fail">;
  /** Live cases' pass rates ("2/3") from the last save made with --runs above 1. */
  rates?: Record<string, string>;
}
const BASELINE = join(process.cwd(), "evals/baseline.json");
const LAST = join(process.cwd(), "evals/last-run.json");

interface Result {
  id: string;
  task: Task;
  kind: "guard" | "live";
  title: string;
  pass: boolean;
  /** Why it failed, one line per run that failed. */
  problems: string[];
  outcome: string | null;
  output: string | null;
  /** Set when the API itself failed (bad key, rate limit, outage), so the model was never tested. */
  unrun?: string;
  /** Live cases: how many runs passed, of how many. */
  passed?: number;
  of?: number;
}

/** An API failure rather than a model answer: such a case says nothing about the prompt. */
const apiFailure = (reason: string | null | undefined) => (reason?.startsWith("API error:") ? reason : null);
const authFailure = (reason: string) => /\b(401|403)\b|authentication_error|permission_error/.test(reason);

async function runOnce(c: Case, fx: Awaited<ReturnType<typeof fixtures>>): Promise<{ problems: string[]; outcome: string | null; output: string | null; unrun?: string }> {
  // A contract brief is cached per contract; each case needs its own reading.
  (globalThis as unknown as { __agoraBriefs?: Map<string, unknown> }).__agoraBriefs?.clear();
  const before = aiRecords().length;
  stubModel(c.canned === undefined ? null : (call) => (typeof c.canned === "function" ? (c.canned as (call: unknown, fx: unknown) => unknown)(call, fx) : c.canned));
  try {
    const result = await c.run(fx);
    const record = aiRecords()
      .slice(0, aiRecords().length - before)
      .find((r) => r.task === c.task);
    const problems = c.expect.map((check) => check({ result, record })).filter((p): p is string => p !== null);
    return { problems, outcome: record?.outcome ?? null, output: record?.output ?? null, unrun: apiFailure(record?.reason) ?? undefined };
  } catch (e) {
    return { problems: [`threw: ${(e as Error).message}`], outcome: null, output: null };
  } finally {
    stubModel(null);
  }
}

(async () => {
  const key = Boolean(apiKey());
  const only = arg("only");
  const runs = Math.max(1, Number(arg("runs")) || 1);
  const picked = CASES.filter((c) => (!only || c.id.includes(only) || c.task.includes(only)) && (!has("guards") || c.canned !== undefined));
  const live = picked.filter((c) => c.canned === undefined);
  const skipped = key ? [] : live;

  stubModel("off");
  const fx = await fixtures();
  stubModel(null);

  const results: Result[] = [];
  /** What became of the model's output in each live run, by task: kept, partial, discarded or failed. */
  const outcomes = new Map<Task, Map<string, number>>();
  /** Live cases the API never answered. They are reported, but never scored or saved. */
  const unrunnable: Result[] = [];
  for (const c of picked) {
    const kind = c.canned === undefined ? "live" : "guard";
    if (kind === "live" && !key) continue;
    const problems: string[] = [];
    let last = { outcome: null as string | null, output: null as string | null };
    let unrun: string | undefined;
    let passed = 0;
    let of = 0;
    for (let i = 0; i < (kind === "live" ? runs : 1); i++) {
      const r = await runOnce(c, fx);
      if (r.unrun && kind === "live") {
        if (authFailure(r.unrun)) {
          console.error(`\nStopped: the API refused the key (${r.unrun}).`);
          console.error("Set ANTHROPIC_API_KEY (or AGORA_ANTHROPIC_API_KEY) to a working key and run again. Nothing was saved.");
          process.exit(2);
        }
        unrun = r.unrun;
        break;
      }
      problems.push(...r.problems.map((p) => (runs > 1 && kind === "live" ? `run ${i + 1}: ${p}` : p)));
      of++;
      if (!r.problems.length) passed++;
      if (kind === "live") {
        const m = outcomes.get(c.task) ?? new Map<string, number>();
        m.set(r.outcome ?? "none", (m.get(r.outcome ?? "none") ?? 0) + 1);
        outcomes.set(c.task, m);
      }
      last = r;
    }
    if (unrun) {
      unrunnable.push({ id: c.id, task: c.task, kind, title: c.title, pass: false, problems: [], ...last, unrun });
      console.log(` ---  ${c.id.padEnd(40)} ${c.title}\n         didn't run: ${unrun}`);
      continue;
    }
    const res: Result = { id: c.id, task: c.task, kind, title: c.title, pass: !problems.length, problems, ...last, ...(kind === "live" ? { passed, of } : {}) };
    results.push(res);
    const rate = kind === "live" && runs > 1 ? `${passed}/${of}`.padEnd(5) : "";
    console.log(`${res.pass ? "  ok  " : " FAIL "} ${c.id.padEnd(40)} ${rate}${c.title}`);
    for (const p of problems) console.log(`         ${p}`);
  }

  // ---- by task
  console.log("\nBy task");
  for (const task of Object.keys(TASKS) as Task[]) {
    const rs = results.filter((r) => r.task === task);
    if (!rs.length) continue;
    const part = (kind: "guard" | "live") => {
      const of = rs.filter((r) => r.kind === kind);
      return of.length ? `${of.filter((r) => r.pass).length}/${of.length}` : "–";
    };
    const o = outcomes.get(task);
    const total = o ? [...o.values()].reduce((a, b) => a + b, 0) : 0;
    const others: [string, string][] = [["partial", "in part"], ["discarded", "discarded"], ["failed", "failed"], ["none", "no model call"]];
    const kept = o ? `   output kept ${o.get("kept") ?? 0}/${total}${others.map(([k, label]) => (o.get(k) ? `, ${label} ${o.get(k)}` : "")).join("")}` : "";
    console.log(`  ${TASKS[task].padEnd(32)} prompt ${promptsSeen.get(task) ?? "?"}   checks ${part("guard").padEnd(6)} model ${part("live").padEnd(6)}${kept}`);
  }
  if (outcomes.size) console.log("  (output kept counts every live run: kept whole, kept in part, discarded by a check, failed at the API, or no model call made)");

  // ---- against the baseline
  const base: Baseline | null = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, "utf8")) : null;
  const failed = results.filter((r) => !r.pass);
  const regressions = failed.filter((r) => base?.cases[r.id] === "pass");
  const known = failed.filter((r) => base?.cases[r.id] === "fail");
  const fresh = failed.filter((r) => !base?.cases[r.id]);
  const fixed = results.filter((r) => r.pass && base?.cases[r.id] === "fail");
  const changed = base ? (Object.keys(TASKS) as Task[]).filter((t) => promptsSeen.get(t) && base.prompts[t] && promptsSeen.get(t) !== base.prompts[t]) : [];
  const unbaselined = results.filter((r) => r.kind === "live" && !base?.cases[r.id]);

  console.log("");
  if (!base) console.log("No baseline yet. Save one with: npm run eval -- --save");
  else {
    console.log(`Baseline saved ${base.saved.slice(0, 10)} on ${base.model}.`);
    if (base.model !== MODEL) console.log(`  The model has changed since then (${base.model} to ${MODEL}).`);
    console.log(changed.length ? `  Prompts changed since then: ${changed.map((t) => `${TASKS[t]} (${base.prompts[t]} to ${promptsSeen.get(t)})`).join("; ")}.` : "  No prompt has changed since then.");
    if (fixed.length) console.log(`  Now passing that failed before: ${fixed.map((r) => r.id).join(", ")}.`);
    if (known.length) console.log(`  Still failing, as in the baseline: ${known.map((r) => r.id).join(", ")}.`);
    if (regressions.length) console.log(`  REGRESSIONS, passed before and fail now: ${regressions.map((r) => r.id).join(", ")}.`);
    const rateOf = (r: string) => {
      const [a, b] = r.split("/").map(Number);
      return b ? a / b : 1;
    };
    const lower = results.filter((r) => r.of && runs > 1 && base.rates?.[r.id] && r.passed! / r.of < rateOf(base.rates[r.id]));
    if (lower.length) console.log(`  Lower pass rate than the baseline: ${lower.map((r) => `${r.id} (${r.passed}/${r.of}, was ${base.rates![r.id]})`).join(", ")}.`);
    if (unbaselined.length && key) console.log(`  ${unbaselined.length} model case${unbaselined.length === 1 ? " has" : "s have"} no baseline yet.`);
  }
  if (fresh.length) console.log(`  Failing, with no baseline to compare: ${fresh.map((r) => r.id).join(", ")}.`);
  if (skipped.length) console.log(`\n${skipped.length} model case${skipped.length === 1 ? " was" : "s were"} skipped: neither ANTHROPIC_API_KEY nor AGORA_ANTHROPIC_API_KEY is set. Only the checks were tested, not the prompts.`);
  if (unrunnable.length) console.log(`\n${unrunnable.length} model case${unrunnable.length === 1 ? "" : "s"} didn't run because the API failed: ${unrunnable.map((r) => r.id).join(", ")}. They keep their baseline entries; run again to test them.`);
  console.log(`\n${results.filter((r) => r.pass).length} of ${results.length} cases passed.`);

  writeFileSync(LAST, JSON.stringify({ ran: new Date().toISOString(), model: MODEL, runs, prompts: Object.fromEntries(promptsSeen), results, unrunnable }, null, 2));

  if (has("save")) {
    // Cases that didn't run this time (skipped for want of a key, filtered out, or not answered by the API) keep their old entries.
    const next: Baseline = {
      saved: new Date().toISOString(),
      model: MODEL,
      prompts: { ...base?.prompts, ...Object.fromEntries(promptsSeen) },
      cases: { ...base?.cases, ...Object.fromEntries(results.map((r) => [r.id, r.pass ? "pass" : "fail"] as const)) },
      rates: { ...base?.rates, ...(runs > 1 ? Object.fromEntries(results.filter((r) => r.of).map((r) => [r.id, `${r.passed}/${r.of}`])) : {}) },
    };
    if (runs === 1) for (const r of results) if (r.of && next.rates) delete next.rates[r.id];
    for (const id of Object.keys(next.cases)) if (!CASES.some((c) => c.id === id)) delete next.cases[id];
    for (const id of Object.keys(next.rates ?? {})) if (!CASES.some((c) => c.id === id)) delete next.rates![id];
    next.rates = Object.fromEntries(Object.entries(next.rates ?? {}).sort(([a], [b]) => a.localeCompare(b)));
    if (!Object.keys(next.rates).length) delete next.rates;
    next.cases = Object.fromEntries(Object.entries(next.cases).sort(([a], [b]) => a.localeCompare(b)));
    writeFileSync(BASELINE, `${JSON.stringify(next, null, 2)}\n`);
    console.log(`Saved the baseline: ${Object.keys(next.cases).length} cases.`);
    process.exit(0);
  }
  process.exit(regressions.length || fresh.length || unrunnable.length ? 1 : 0);
})();
