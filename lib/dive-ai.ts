// The model's part of the product dive: reading what the buyer typed into
// filters the shortlist already supports, and wording the comparison. It can
// only pick from words and makers that are in the matching products, and any
// number it uses must be in what the buyer wrote or in the product data.

import * as z from "zod/v4";
import { fingerprint } from "./ai-log";
import { discarded, kept, MODEL, pieces, structured } from "./llm";
import { specsLine, type Specs } from "./specs";
import { ungrounded, type ShopperText } from "./shopper-ai";
import type { DiveFilter, DiveItem, DiveState, DiveVerdict, FitVerdict } from "./dive";

/** The request reader's instructions (task dive_understand). */
const UNDERSTAND_SYSTEM =
  `You read what a government buyer typed into a product search, and say what they mean in the catalog's own terms. KINDS lists the kinds of product the catalog has that might match, with how many of each, other names the catalog uses for them, and one example.\n` +
      `- kinds: the kinds from KINDS that are the thing the buyer wants, not its parts, add-ons or supplies, spelled exactly as listed. At most 4. None if nothing in KINDS is what they want.\n` +
      `- search_terms: up to 3 words or short phrases a product's name in this catalog would use for what they want, when they aren't in the buyer's words: the "also called" names in KINDS show how the catalog words things, so prefer those. A buyer's own synonym the catalog doesn't use finds nothing. Empty if none.\n` +
      `- must_have: single words a product's name would contain to meet a requirement the buyer stated ("crew cab" gives "crew", "electric" gives "electric"). Only requirements they stated, and never the kind of thing itself.\n` +
      `- must_not: single words for things they ruled out ("not diesel" gives "diesel").\n` +
      `- read_as: one short sentence in the third person saying what Loci is looking for, like "Police pursuit vehicles and SUVs, diesel ruled out." No prices unless the buyer gave one.`;

/** The fit judge's instructions (task dive_fit). */
const FIT_SYSTEM =
  `You check how well each product on a shortlist fits what a government buyer asked for. You know each product's name, kind, maker and unit, and nothing else: judge from those, never from price or availability, which Loci handles elsewhere.\n` +
      `For every product give:\n` +
      `- fit: "fits" if it is the thing asked for and meets every requirement the buyer stated; "partly" if it is the right kind of thing but a stated requirement isn't met or can't be told from its name, or it is closely related (an add-on, a different size class) a buyer might still want; "no" if it isn't what was asked for.\n` +
      `- reason: at most 10 words, in the third person, naming what in the product decides it, like "A pursuit-rated Tahoe, as asked", "A swing hanger, not a swing" or "Crew cab, but diesel was ruled out". No prices, no percentages, and no figures that aren't in the product's name or the request.`;

/** Versions of the two prompts: a reading or verdict saved under one is not used under another (lib/dive-memo.ts). */
export const READ_VERSION = fingerprint(MODEL, UNDERSTAND_SYSTEM);
export const FIT_VERSION = fingerprint(MODEL, FIT_SYSTEM);

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
      `You are "your personal shopper" in Loci, a procurement marketplace for local governments. A government employee is comparing products. Work only from the FACTS.\n` +
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

// ------------------------------------------------------------------ reading a request in the catalog's terms

const UnderstandSchema = z.object({
  kinds: z.array(z.string()).describe("Kinds from KINDS that are the thing the buyer wants, spelled exactly as listed. At most 4."),
  search_terms: z.array(z.string()).describe("Up to 3 other words or short phrases a catalog might use for it, not already in the request."),
  must_have: z.array(z.string()).describe("Single words a product's name must contain to meet a requirement the buyer stated."),
  must_not: z.array(z.string()).describe("Single words for things the buyer ruled out."),
  read_as: z.string().describe("One short sentence, third person, saying what Loci is looking for."),
});
type UnderstandOut = z.infer<typeof UnderstandSchema>;

/** The kinds a request could mean, as the catalog lists them (lib/catalog.ts catalogKindCandidates). */
export type KindCandidate = { kind: string; count: number; example: string; aliases?: string[] };

/** Ask the model what a request means in the catalog's terms. The answer is checked by checkNeed once the shortlist is
 * known, so the two can run alongside the request reader. Null when the model is unavailable. */
export async function askNeed(need: string, candidates: KindCandidate[]): Promise<UnderstandOut | null> {
  return structured({
    task: "dive_understand",
    about: need,
    system: UNDERSTAND_SYSTEM,
    user: `REQUEST: ${need}\nKINDS:\n${candidates.map((c) => `${c.kind} (${c.count})${c.aliases?.length ? `, also called ${c.aliases.join(", ")}` : ""}: e.g. ${c.example.slice(0, 70)}`).join("\n") || "(none)"}`,
    schema: UnderstandSchema,
    maxTokens: 700,
    timeoutMs: 20_000,
  });
}

/** The reading after its checks: kinds the catalog lists and offered, other words that find products, and must-have and
 * ruled-out words that are in some product's name on the shortlist (a must-have that every product has narrows
 * nothing). Reports what survived to the log. */
export function checkNeed(
  out: UnderstandOut,
  need: string,
  ctx: { offered: string[]; finds: (term: string) => boolean; words: Map<string, number>; pool: number },
): { kinds: string[]; terms: string[]; filters: DiveFilter[]; read_as: string | null; log_id?: string } {
  const offered = new Set(ctx.offered.map((k) => k.toLowerCase()));
  const kinds = [...new Set(out.kinds.map((k) => k.toLowerCase().trim()))].filter((k) => offered.has(k)).slice(0, 4);
  const said = new Set(need.toLowerCase().match(/[a-z0-9-]+/g) ?? []);
  const terms = [...new Set(out.search_terms.map((t) => t.toLowerCase().trim()))]
    .filter((t) => /^[a-z0-9][a-z0-9 '\-]{1,40}$/.test(t) && t.split(" ").length <= 3 && !t.split(" ").every((w) => said.has(w)) && ctx.finds(t))
    .slice(0, 3);
  const word = (w: string) => w.toLowerCase().trim();
  // A must-have is a requirement beyond the thing itself: a word every chosen kind has ("folding" when the kind is
  // "folding table") isn't one, while one only some have ("electric" among "electric sport utility vehicle" and "suv")
  // is what separates them.
  const inEvery = (w: string) => kinds.length > 0 && kinds.every((k) => k.split(/[\s-]+/).includes(w));
  const must = [...new Set(out.must_have.map(word))].filter((w) => /^[a-z][a-z0-9-]{2,}$/.test(w) && !inEvery(w) && (ctx.words.get(w) ?? 0) > 0 && (ctx.words.get(w) ?? 0) < ctx.pool);
  // A ruled-out word is kept when a product on the shortlist has it, or when the buyer wrote it: "not diesel" stands as
  // the buyer's own words even where no diesel is on offer.
  const mustNot = [...new Set(out.must_not.map(word))].filter((w) => /^[a-z][a-z0-9-]{2,}$/.test(w) && ((ctx.words.get(w) ?? 0) > 0 || said.has(w)) && !must.includes(w));
  const filters: DiveFilter[] = [...must.map((value) => ({ kind: "word" as const, value })), ...mustNot.map((value) => ({ kind: "not_word" as const, value }))];
  const readAs = out.read_as.trim().slice(0, 200);
  const bad = readAs ? ungrounded(readAs, [], { need }, []) : null;
  // A search word that finds nothing is a harmless guess the check filters out, not a failure: it isn't counted. What is
  // counted is what could mislead: a kind that wasn't offered, a requirement no product has, a "read as" with a stray
  // figure. The dropped words are noted with the output.
  const missed = out.search_terms.filter((t) => !terms.includes(t.toLowerCase().trim()));
  const asked = out.kinds.length + out.must_have.length + out.must_not.length + (readAs ? 1 : 0);
  const passed = kinds.length + must.length + mustNot.length + (readAs && !bad ? 1 : 0);
  const output = JSON.stringify(out) + (missed.length ? ` (words that found nothing: ${missed.join(", ")})` : "");
  const log_id = pieces(out, output, passed, asked, bad ?? "Named a kind or a requirement the catalog doesn't have");
  return { kinds, terms, filters, read_as: readAs && !bad ? readAs : null, log_id };
}

// ------------------------------------------------------------------ judging fit

const FitSchema = z.object({
  products: z.array(
    z.object({
      n: z.number().int().describe("The product's number in PRODUCTS."),
      fit: z.enum(["fits", "partly", "no"]),
      reason: z.string().describe("At most 10 words, third person, naming what in the product decides it."),
    }),
  ),
});

/** The model's judgment of how each product fits the request, from what each product is (name, kind, maker, unit),
 * never from its price or who can buy it. A reason is kept only with no price or percentage in it and no figure that
 * isn't in the product's name or the request. Null when the model is unavailable. */
/** What the judge is told about a product: what it is, never its price or who can buy it. */
export type FitInput = Pick<DiveItem, "id" | "name" | "kind" | "maker" | "unit"> & { specs?: Specs };

/** A product as the judge reads it, one line. A saved verdict is keyed by this line, so a product whose name, kind or
 * specs change is judged again. */
export const fitInputLine = (i: FitInput) =>
  `${i.name}${i.kind ? ` | kind: ${i.kind}` : ""}${i.maker ? ` | maker: ${i.maker}` : ""}${i.unit ? ` | unit: ${i.unit}` : ""}${i.specs && specsLine(i.specs) ? ` | specs: ${specsLine(i.specs)}` : ""}`;

export async function judgeFit(need: string, readAs: string | null, items: FitInput[]): Promise<{ fits: Map<string, { fit: FitVerdict; reason: string }>; log_id?: string } | null> {
  if (!items.length) return null;
  const out = await structured({
    task: "dive_fit",
    about: `${need}: ${items.length} products`,
    system: FIT_SYSTEM,
    user: `REQUEST: ${need}${readAs ? `\nREAD AS: ${readAs}` : ""}\nPRODUCTS:\n${items.map((i, n) => `${n + 1}. ${fitInputLine(i)}`).join("\n")}`,
    schema: FitSchema,
    maxTokens: 2500,
    timeoutMs: 25_000,
  });
  if (!out) return null;
  const fits = new Map<string, { fit: FitVerdict; reason: string }>();
  const figures = (t: string): string[] => [...(t.match(/\d+(?:[.,/]\d+)*/g) ?? [])];
  let bad: string | null = null;
  for (const p of out.products) {
    const item = items[p.n - 1];
    if (!item || fits.has(item.id)) continue;
    const reason = p.reason.trim().replace(/\s+/g, " ");
    const why =
      !reason || reason.length > 140
        ? "A reason was empty or too long"
        : (ungrounded(reason, [], {}, []) ?? (figures(reason).find((f) => !figures(`${item.name} ${need}`).includes(f)) ? `A reason has a figure that isn't in the product or the request: ${reason}` : null));
    if (why) {
      bad ??= why;
      continue;
    }
    fits.set(item.id, { fit: p.fit, reason });
  }
  const log_id = pieces(out, JSON.stringify(out.products.map((p) => [p.n, p.fit, p.reason])), fits.size, items.length, bad ?? "Left a product unjudged, or judged one twice");
  return { fits, log_id };
}
