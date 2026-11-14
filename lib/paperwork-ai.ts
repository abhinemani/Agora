// The model's part of the paperwork: tidying a template's wording. Server-only.

import * as z from "zod/v4";
import { structured } from "./llm";
import type { Paperwork } from "./paperwork";
import { ungrounded } from "./shopper-ai";

const Schema = z.object({ text: z.string().describe("The full document, plain text, ready to send.") });

/** The model's tidier wording of a draft, or the template itself when the model is unavailable or changed a fact. */
export async function polish(draft: Paperwork, facts: unknown, validRefs: number[]): Promise<Paperwork> {
  const out = await structured({
    system:
      `You tidy a draft document written for a local government employee. Keep it plain text with the same header lines (To, From, Date, Subject) and the same sections.\n` +
      `- Keep every fact, figure, contract number, part number and reference number exactly as given. Add no new facts, prices, dates, names or claims.\n` +
      `- Keep the text in [square brackets] as it is: those are blanks the person fills in.\n` +
      `- Keep every caveat about what isn't known or isn't verified.\n` +
      `- Make the sentences read naturally and remove repetition. Plain words, no flourish, no markdown.`,
    user: `DRAFT\n${draft.text}`,
    schema: Schema,
    maxTokens: 3000,
    timeoutMs: 30_000,
  });
  const text = out?.text.trim();
  if (!text) return draft;
  // Every contract number, part number and bracketed blank in the template must survive, and no new figure may appear.
  const mustKeep = [...new Set(draft.text.match(/\[[^\]]+\]|\b[A-Z0-9]{2,}-[A-Z0-9-]{2,}\b/g) ?? [])];
  const lost = mustKeep.find((m) => !text.includes(m));
  const why = lost ? `dropped ${lost}` : ungrounded(text, [], { facts, draft: draft.text }, validRefs);
  if (why) {
    console.warn("[paperwork] polished draft discarded:", why);
    return draft;
  }
  return { ...draft, text, written_by: "llm" };
}
