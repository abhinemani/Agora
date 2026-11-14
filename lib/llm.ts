// Thin wrapper over the Anthropic SDK. Every caller has an offline fallback, so
// this returns null on any problem instead of throwing.
//
// Every call names its task, and what becomes of its output is logged
// (lib/ai-log.ts). A failed call is logged here. For one that returns, the
// caller runs its own checks and then reports the verdict with kept(),
// partly() or discarded(), passing back the same object it was given.

import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type * as z from "zod/v4";
import { fingerprint, record, type Outcome, type Task } from "./ai-log";
import { apiKey } from "./api-key";

export const MODEL = "claude-sonnet-5-5";

let client: Anthropic | null = null;
function getClient() {
  const key = apiKey();
  if (!key) return null;
  client ??= new Anthropic({ apiKey: key, maxRetries: 1 });
  return client;
}

/** Stands in for the model in `npm run eval`: canned output for a call, or "off" for no model at all. */
export type Stub = ((call: { task: Task; system: string; user: string }) => unknown) | "off" | null;
let stub: Stub = null;
export const stubModel = (s: Stub) => void (stub = s);
/** Whether a model will answer: a stub when one is set, otherwise the API key. */
export const modelOn = () => (stub ? stub !== "off" : Boolean(apiKey()));

interface Pending {
  task: Task;
  prompt: string;
  ms: number;
  input: string;
}
const pending = new WeakMap<object, Pending>();
/** The system prompt each task last ran with, so the test set can tell when a prompt has changed. */
export const promptsSeen = new Map<Task, string>();

export async function structured<T extends z.ZodType>(opts: {
  task: Task;
  system: string;
  user: string;
  schema: T;
  /** What was asked, in a line, for the log. Not the whole document. */
  about?: string;
  maxTokens?: number;
  timeoutMs?: number;
  effort?: "low" | "medium" | "high";
}): Promise<z.infer<T> | null> {
  const meta = { task: opts.task, prompt: fingerprint(MODEL, opts.system), input: opts.about ?? "" };
  promptsSeen.set(opts.task, meta.prompt);
  const started = Date.now();
  const hold = (out: z.infer<T> | null) => {
    if (out && typeof out === "object") pending.set(out, { ...meta, ms: Date.now() - started });
    return out;
  };
  const fail = (reason: string) => {
    record({ ...meta, outcome: "failed", reason, ms: Date.now() - started });
    return null;
  };

  if (stub === "off") return null;
  if (stub) {
    const canned = await stub({ task: opts.task, system: opts.system, user: opts.user });
    return canned == null ? null : hold(opts.schema.parse(canned) as z.infer<T>);
  }
  const c = getClient();
  if (!c) return null;
  try {
    const res = await c.messages.parse(
      {
        model: MODEL,
        max_tokens: opts.maxTokens ?? 16000,
        system: opts.system,
        messages: [{ role: "user", content: opts.user }],
        output_config: { format: zodOutputFormat(opts.schema), effort: opts.effort ?? "low" },
      },
      { timeout: opts.timeoutMs ?? 30_000 },
    );
    if (res.stop_reason === "refusal") return fail("The model declined to answer");
    if (res.stop_reason === "max_tokens") return fail("The answer ran past its length limit");
    const out = (res.parsed_output as z.infer<T> | null) ?? null;
    return out ? hold(out) : fail("The answer didn't fit the expected shape");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn("[llm] falling back to offline parsing:", message);
    return fail(`API error: ${message}`);
  }
}

type Detail = { output?: string; reason?: string; declined?: boolean; kept?: number; of?: number };

function settle(out: object | null | undefined, outcome: Outcome, d: Detail): string | undefined {
  const p = out ? pending.get(out) : undefined;
  if (!p) return undefined;
  pending.delete(out!);
  if (outcome !== "kept" && d.reason) console.warn(`[${p.task}] ${outcome}:`, d.reason);
  return record({ ...p, outcome, ...d });
}

/** The output passed its checks and was shown. Returns the log id, which the page sends back with a thumbs up or down. */
export const kept = (out: object | null | undefined, output: string, d: Omit<Detail, "output"> = {}) => settle(out, "kept", { ...d, output });
/** Some of the output passed and was shown; the rest was dropped. */
export const partly = (out: object | null | undefined, output: string, d: Omit<Detail, "output">) => settle(out, "partial", { ...d, output });
/** The output failed a check and nothing of it was shown. */
export const discarded = (out: object | null | undefined, reason: string, output: string) => settle(out, "discarded", { reason, output });

/** Report output that was checked piece by piece: kept when every piece passed, discarded when none did. */
export function pieces(out: object | null | undefined, output: string, keptN: number, of: number, reason: string, d: Pick<Detail, "declined"> = {}) {
  if (keptN >= of) return kept(out, output, { ...d, kept: keptN, of });
  return settle(out, keptN ? "partial" : "discarded", { output, reason, kept: keptN, of });
}
