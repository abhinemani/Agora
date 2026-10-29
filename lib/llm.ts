// Thin wrapper over the Anthropic SDK. Every caller has an offline fallback, so
// this returns null on any problem instead of throwing.

import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type * as z from "zod/v4";

export const MODEL = "claude-sonnet-5-5";

let client: Anthropic | null = null;
function getClient() {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  client ??= new Anthropic({ maxRetries: 1 });
  return client;
}

export async function structured<T extends z.ZodType>(opts: {
  system: string;
  user: string;
  schema: T;
  maxTokens?: number;
  timeoutMs?: number;
  effort?: "low" | "medium" | "high";
}): Promise<z.infer<T> | null> {
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
    if (res.stop_reason === "refusal" || res.stop_reason === "max_tokens") return null;
    return (res.parsed_output as z.infer<T> | null) ?? null;
  } catch (err) {
    console.warn("[llm] falling back to offline parsing:", err instanceof Error ? err.message : err);
    return null;
  }
}
