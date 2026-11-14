// A record of what the model wrote and what became of it. Every model call
// ends one of four ways: its output was kept, kept in part (some lines or
// quotes failed their check), discarded by a check, or the call itself failed.
// People can then mark an answer right or wrong. `/quality` reads this to say
// how often each prompt's output survives, and `npm run eval` uses the same
// records to grade the fixed test set.
//
// The log is not part of the Db, so it is never sent to the browser with
// `/api/state` and a demo reset doesn't clear it. It lives in memory, and in
// Postgres as well when DATABASE_URL is set. Server-only.

import { createHash, randomBytes } from "node:crypto";
import { pool, schema } from "./pg";

export const TASKS = {
  request_parse: "Reading a request",
  shopper_brief: "Writing the buying plan",
  shopper_answer: "Answering about a purchase",
  dive_read: "Reading a product-dive message",
  dive_verdict: "Comparing products",
  paperwork: "Wording paperwork",
  quote_read: "Reading a quote",
  contract_answer: "Answering from a contract",
  contract_brief: "Briefing a contract",
  contract_parse: "Reading an uploaded contract",
} as const;
export type Task = keyof typeof TASKS;

export type Outcome = "kept" | "partial" | "discarded" | "failed";
export type Vote = "up" | "down";

export interface AiRecord {
  id: string;
  at: string;
  task: Task;
  /** A fingerprint of the model and system prompt, so results can be compared across prompt changes. */
  prompt: string;
  outcome: Outcome;
  /** Why it was discarded, kept only in part, or failed. */
  reason: string | null;
  /** Kept, but the model said the data doesn't hold the answer. */
  declined?: boolean;
  /** For output checked piece by piece (quote lines, quotes, brief fields): how many pieces passed. */
  kept?: number;
  of?: number;
  ms: number;
  /** What was asked, cut short. Never a whole document. */
  input: string;
  /** What the model wrote, cut short. */
  output: string;
  /** One vote per browser, so changing your mind replaces your vote. */
  votes: Record<string, Vote>;
  notes: { at: string; text: string }[];
}

const KEEP = 5000;
const g = globalThis as unknown as { __agoraAiLog?: { records: AiRecord[]; loaded?: Promise<void> } };
const log = (g.__agoraAiLog ??= { records: [] });

export const fingerprint = (model: string, system: string) => createHash("sha256").update(`${model}\n${system}`).digest("hex").slice(0, 8);
const short = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);

function save(r: AiRecord) {
  const p = pool();
  if (!p) return;
  schema()
    .then(() => p.query("insert into ai_log (id, made_at, data) values ($1, $2, $3) on conflict (id) do update set data = excluded.data", [r.id, r.at, JSON.stringify(r)]))
    .catch((e) => console.error("[ai-log] couldn't save:", (e as Error).message));
}

/** Load the saved log once per process. */
export function loadAiLog(): Promise<void> {
  const p = pool();
  if (!p) return Promise.resolve();
  return (log.loaded ??= schema()
    .then(() => p.query("select data from ai_log order by made_at desc limit $1", [KEEP]))
    .then((res) => {
      const have = new Set(log.records.map((r) => r.id));
      const saved = (res.rows as { data: AiRecord }[]).map((r) => r.data).filter((r) => !have.has(r.id));
      log.records = [...log.records, ...saved].sort((a, b) => b.at.localeCompare(a.at)).slice(0, KEEP);
    })
    .catch((e) => {
      console.error("[ai-log] couldn't load:", (e as Error).message);
      log.loaded = undefined;
    }));
}

export function record(entry: Pick<AiRecord, "task" | "prompt" | "outcome" | "ms"> & Partial<Pick<AiRecord, "reason" | "declined" | "kept" | "of" | "input" | "output">>): string {
  const r: AiRecord = {
    id: `ai_${randomBytes(8).toString("hex")}`,
    at: new Date().toISOString(),
    task: entry.task,
    prompt: entry.prompt,
    outcome: entry.outcome,
    reason: entry.reason ? short(entry.reason, 300) : null,
    ...(entry.declined ? { declined: true } : {}),
    ...(entry.of !== undefined ? { kept: entry.kept ?? 0, of: entry.of } : {}),
    ms: entry.ms,
    input: short(entry.input ?? "", 300),
    output: short(entry.output ?? "", 1500),
    votes: {},
    notes: [],
  };
  log.records.unshift(r);
  if (log.records.length > KEEP) log.records.length = KEEP;
  save(r);
  return r.id;
}

/** Mark an answer right or wrong. `vote: null` takes the vote back. A note says what was wrong. */
export function rate(id: string, voter: string, vote: Vote | null, note?: string): boolean {
  const r = log.records.find((x) => x.id === id);
  if (!r) return false;
  if (vote) r.votes[voter] = vote;
  else delete r.votes[voter];
  const text = note?.trim();
  if (text && r.notes.length < 20) r.notes.push({ at: new Date().toISOString(), text: short(text, 300) });
  save(r);
  return true;
}

export const aiRecord = (id: string) => log.records.find((r) => r.id === id);
export const aiRecords = (): readonly AiRecord[] => log.records;

/** Group reasons that differ only in the figure they name ("amount $412.00 isn't in the data"). */
export function reasonKind(reason: string): string {
  if (/^amount /.test(reason)) return "Stated a dollar amount that isn't in the data";
  if (/^percentage /.test(reason)) return "Stated a percentage that isn't in the data";
  if (/^reference /.test(reason)) return "Cited a reference that doesn't exist";
  if (/^dropped /.test(reason)) return "Dropped a contract number, part number or blank from the draft";
  if (/^API error/.test(reason)) return "The call to the model failed";
  return reason;
}

interface Tally {
  calls: number;
  kept: number;
  partial: number;
  discarded: number;
  failed: number;
  declined: number;
  up: number;
  down: number;
}
const tally = (rs: AiRecord[]): Tally => {
  const t: Tally = { calls: rs.length, kept: 0, partial: 0, discarded: 0, failed: 0, declined: 0, up: 0, down: 0 };
  for (const r of rs) {
    t[r.outcome]++;
    if (r.declined) t.declined++;
    for (const v of Object.values(r.votes)) t[v]++;
  }
  return t;
};

export interface TaskQuality extends Tally {
  task: Task;
  label: string;
  /** The fingerprint of the prompt in use now: the one on this task's newest call. */
  prompt: string;
  /** Why output was discarded or trimmed under this prompt, most common first. */
  reasons: { reason: string; n: number }[];
  /** The same counts for calls made under earlier prompts, if any. */
  earlier: Tally | null;
}
export interface Quality {
  total: number;
  since: string | null;
  holds: number;
  saved: boolean;
  tasks: TaskQuality[];
  /** Recent calls worth a look: discarded, failed, kept in part, or marked wrong. Signed-in people only. */
  recent: (Omit<AiRecord, "votes"> & { label: string; up: number; down: number })[] | null;
}

export function quality(opts: { detail: boolean }): Quality {
  const all = log.records;
  const tasks: TaskQuality[] = [];
  for (const task of Object.keys(TASKS) as Task[]) {
    const rs = all.filter((r) => r.task === task);
    if (!rs.length) continue;
    const prompt = rs[0].prompt;
    const now = rs.filter((r) => r.prompt === prompt);
    const before = rs.filter((r) => r.prompt !== prompt);
    const counts = new Map<string, number>();
    for (const r of now) if (r.reason && r.outcome !== "kept") counts.set(reasonKind(r.reason), (counts.get(reasonKind(r.reason)) ?? 0) + 1);
    tasks.push({
      task,
      label: TASKS[task],
      prompt,
      ...tally(now),
      reasons: [...counts].map(([reason, n]) => ({ reason, n })).sort((a, b) => b.n - a.n).slice(0, 4),
      earlier: before.length ? tally(before) : null,
    });
  }
  const worth = (r: AiRecord) => r.outcome !== "kept" || Object.values(r.votes).includes("down");
  return {
    total: all.length,
    since: all.length ? all[all.length - 1].at : null,
    holds: KEEP,
    saved: Boolean(pool()),
    tasks,
    recent: opts.detail
      ? all
          .filter(worth)
          .slice(0, 40)
          .map(({ votes, ...r }) => ({ ...r, label: TASKS[r.task], up: Object.values(votes).filter((v) => v === "up").length, down: Object.values(votes).filter((v) => v === "down").length }))
      : null,
  };
}
