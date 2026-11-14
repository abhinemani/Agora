// The model's part of the product dive: reading what the buyer typed into
// filters the shortlist already supports, and wording the comparison. It can
// only pick from words and makers that are in the matching products, and any
// number it uses must be in what the buyer wrote or in the product data.

import * as z from "zod/v4";
import { discarded, kept, pieces, structured } from "./llm";
import { ungrounded, type ShopperText } from "./shopper-ai";
import type { DiveFilter, DiveItem, DiveState, DiveVerdict } from "./dive";

const ReadSchema = z.object({
  include_words: z.array(z.string()).describe("Words from WORDS the product must have."),
  exclude_words: z.array(z.string()).describe("Words from WORDS the product must not have."),
  maker: z.string().nullable().describe("One of MAKERS, or null."),
  max_price: z.number().nullable().describe("A price ceiling the person stated, or null."),
  min_price: z.number().nullable().describe("A price floor the person stated, or null."),
  only_buyable_today: z.boolean().describe("True if they asked for only what their agency can buy now."),
  reply: z.string().describe("One short sentence saying what you narrowed by, or that nothing in the shortlist matches what they asked."),
});

const numbersIn = (text: string) => [...text.matchAll(/([\d,]+(?:\.\d+)?)\s*(k|thousand)?/gi)].map((m) => Number(m[1].replace(/,/g, "")) * (m[2] ? 1000 : 1));

/** What the buyer typed, as filters. Null when the model is unavailable; the caller falls back to offline rules. */
export async function readDiveMessage(text: string, state: DiveState): Promise<{ filters: DiveFilter[]; reply: string } | null> {
  const out = await structured({
    task: "dive_read",
    about: text,
    system:
      `You help a government employee narrow a shortlist of products. They typed a message. Turn it into filters.\n` +
      `Only use words from WORDS and makers from MAKERS, spelled exactly as given; these are the only things the shortlist can be narrowed by. ` +
      `If they ask for something that isn't in WORDS or MAKERS, leave it out and say so in the reply. Only set a price if they stated a number. Never invent products or prices.`,
    user: `NEED: ${state.query}\nSHORTLIST: ${state.matched} products${state.price_range ? `, priced from $${state.price_range.min} to $${state.price_range.max}` : ""}\nWORDS: ${state.vocabulary.words.join(", ")}\nMAKERS: ${state.vocabulary.makers.slice(0, 30).join(", ")}\n\nMESSAGE: ${text}`,
    schema: ReadSchema,
    maxTokens: 800,
    timeoutMs: 20_000,
  });
  if (!out) return null;
  const said = numbersIn(text);
  const stated = (n: number | null) => (n !== null && n > 0 && said.some((s) => Math.abs(s - n) < 0.5) ? n : undefined);
  const filters: DiveFilter[] = [];
  const [min, max] = [stated(out.min_price), stated(out.max_price)];
  if (min !== undefined || max !== undefined) filters.push({ kind: "price", min, max });
  for (const w of out.include_words.map((x) => x.toLowerCase())) if (state.vocabulary.words.includes(w)) filters.push({ kind: "word", value: w });
  for (const w of out.exclude_words.map((x) => x.toLowerCase())) if (state.vocabulary.words.includes(w)) filters.push({ kind: "not_word", value: w });
  const maker = state.vocabulary.makers.find((m) => m.toLowerCase() === (out.maker ?? "").toLowerCase());
  if (maker) filters.push({ kind: "maker", value: maker });
  if (out.only_buyable_today) filters.push({ kind: "usable" });
  const reply = out.reply.trim();
  // The reply is shown as written, so it gets the same check: no figure that isn't in the message or the shortlist.
  const bad = ungrounded(reply, [], { message_numbers: said, range: state.price_range, matched: state.matched }, []);
  // Everything the model asked for, against what survived: words and makers not on the shortlist, prices the buyer didn't state, a reply with a stray figure.
  const asked = out.include_words.length + out.exclude_words.length + (out.maker ? 1 : 0) + (out.min_price !== null ? 1 : 0) + (out.max_price !== null ? 1 : 0) + (reply ? 1 : 0);
  const passed = filters.reduce((n, f) => n + (f.kind === "usable" ? 0 : f.kind === "price" ? (f.min !== undefined ? 1 : 0) + (f.max !== undefined ? 1 : 0) : 1), 0) + (reply && !bad ? 1 : 0);
  pieces(out, JSON.stringify(out), passed, asked, bad ?? "Asked for a word, maker or price that isn't on the shortlist or in the message");
  return { filters, reply: bad ? "" : reply };
}

const VerdictSchema = z.object({
  headline: z.string().describe("One sentence: which of these to buy, or that none can be bought yet. At most 16 words."),
  paragraphs: z.array(z.string()).describe("One or two short paragraphs: why, and the one caveat that matters most."),
});

/** The comparison in the model's words, or null to keep the rule-based read. */
export async function writeVerdict(need: string, items: DiveItem[], verdict: DiveVerdict): Promise<ShopperText | null> {
  const facts = {
    need,
    products: items.map((i) => ({
      name: i.name,
      maker: i.maker,
      part_number: i.sku,
      price_you_would_pay: i.price,
      list_price_before_discount: i.list,
      what_the_price_is: i.price_note,
      price_source: i.vintage,
      unit: i.unit,
      supplier: i.supplier,
      contract: `${i.program} ${i.contract_number ?? ""}`.trim(),
      agency_can_buy_today: i.usable,
      access: i.access,
    })),
    rule_based_read: { headline: verdict.headline, points: verdict.points.map((p) => p.replace(/\*\*/g, "")) },
  };
  const out = await structured({
    task: "dive_verdict",
    about: `${need}: ${items.map((i) => i.name).join(" / ")}`,
    system:
      `You are "your personal shopper" in Agora, a procurement marketplace for local governments. A government employee is comparing products. Work only from the FACTS.\n` +
      `- Never recommend a product the agency can't buy today over one it can, and never decide eligibility yourself: it is in the facts.\n` +
      `- Never state a price that isn't in the facts and never do arithmetic to make a new one. A list price is not what the agency pays; say so if you mention one.\n` +
      `- When the prices are different kinds (awarded bid, net price, list price), say they can't be compared directly.\n` +
      `- You know only what the names and prices say. Don't claim features, quality or suitability that aren't in a product's name.\n` +
      `- Short sentences, plain words, no lists. Put the single most important fact in **double asterisks**.`,
    user: `FACTS\n${JSON.stringify(facts)}`,
    schema: VerdictSchema,
    maxTokens: 1200,
    timeoutMs: 25_000,
  });
  if (!out) return null;
  const paragraphs = out.paragraphs.map((p) => p.trim()).filter(Boolean).slice(0, 2);
  const text = [out.headline, ...paragraphs].join("\n");
  const why = ungrounded(text, [], facts, []);
  if (why || !paragraphs.length || !out.headline.trim()) {
    discarded(out, why ?? "The answer was empty", text);
    return null;
  }
  return { headline: out.headline.trim(), paragraphs, refs: [], log_id: kept(out, text) };
}
