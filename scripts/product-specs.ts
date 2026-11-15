// What each served product's specs are, read once through the AI review loop (scripts/cleanup, task "product-specs").
//
// A reviewer reads a product's name and record and fills in the specs it states, from a fixed list of keys, so specs can
// be compared across sources: a pickup's cab and drivetrain, a swing's age range, a chair's back height, a trash bag's
// capacity and pack. collect.ts keeps a value only when it is grounded: every figure in it appears in the product's own
// record, and its words do too, except a fuel or drivetrain read from an engine or model name ("5.7L Hemi V8" is
// gasoline), which is kept as inferred and said to be so wherever it is shown.
//
// The catalog importer attaches the specs to products. The dive's fit judge reads them (lib/dive-ai.ts), the product
// cards show them, and the dive asks questions from them ("Which cab?").

import { tokens } from "../lib/assistant";

export { SPEC_KEYS, type SpecKey, type SpecValue, type Specs } from "../lib/specs";
import { SPEC_KEYS, type SpecKey, type Specs } from "../lib/specs";

/** Keys whose value may be read from what an engine or model name implies, not only from the words printed. */
const INFERABLE = new Set<SpecKey>(["fuel", "drivetrain"]);

/** Fixed-choice values and the ways a line prints them: "armless" is arms none, "medium back" is back mid, "B&W" is mono. */
const PRINTED_AS: Partial<Record<SpecKey, Record<string, RegExp>>> = {
  arms: { none: /\barmless\b|\bno arms?\b|\bwithout arms\b/i, fixed: /\bfixed\b/i, adjustable: /\badjustable\b|\badj\.? arms?\b|multi-?adjustable/i },
  back: { high: /\bhigh[- ]?back|\bhighback/i, mid: /\bmid[- ]?back|\bmedium[- ]back|\bmidback/i, low: /\blow[- ]?back|\blowback/i },
  print: { color: /\bcolou?r\b/i, mono: /\bmono(chrome)?\b|\bb&w\b|\bblack (and|&) white\b/i },
  cab: { crew: /\bcrew\b|\bsupercrew\b|\bcrewmax\b/i, extended: /\bextended\b|\bext\.? cab\b/i, regular: /\bregular\b|\breg\.? cab\b/i, "super cab": /\bsuper ?cab\b/i, double: /\bdouble\b/i, mega: /\bmega\b/i },
};

/** One way to write each unit, so 8' and 8ft are one size and 1/2-ton is 1/2 ton. Applied after the grounding check:
 * the figures are the printed ones, only the unit's spelling changes. */
function units(v: string): string {
  return v
    .replace(/[”″]/g, '"')
    .replace(/[’′]/g, "'")
    .replace(/(\d)\s*(?:'|ft\.?|feet|foot)(?![a-z])/g, "$1 ft")
    .replace(/(\d)\s*(?:"|in\.?|inch(?:es)?)(?![a-z])/g, "$1 in")
    .replace(/(\d)\s*(?:gal\.?|gallons?)(?![a-z])/g, "$1 gal")
    .replace(/(\d)\s*(?:lbs?\.?|pounds?)(?![a-z])/g, "$1 lb")
    .replace(/(\d)\s*(?:oz\.?|ounces?)(?![a-z])/g, "$1 oz")
    .replace(/(\d)-ton\b/g, "$1 ton")
    .replace(/\s+/g, " ")
    .trim();
}

const figures = (t: string) => t.match(/\d+(?:[./]\d+)?/g) ?? [];

/** Check a reviewer's specs against the product's record. Returns the specs to keep (possibly none). */
/** One spelling per value, so specs compare across sources: "b&w" is mono, "supercrew" is crew, "4x4" is 4wd. */
const STANDARD: Partial<Record<SpecKey, Record<string, string>>> = {
  print: { "b&w": "mono", "black and white": "mono", "black & white": "mono", monochrome: "mono", colour: "color" },
  cab: { supercrew: "crew", crewmax: "crew", "crew cab": "crew", "regular cab": "regular", "extended cab": "extended", supercab: "super cab" },
  drivetrain: { "4x4": "4wd", "4x2": "2wd", "all-wheel drive": "awd", "four-wheel drive": "4wd" },
  back: { highback: "high", "high-back": "high", midback: "mid", "mid-back": "mid", medium: "mid", lowback: "low" },
  arms: { armless: "none", "no arms": "none" },
  fuel: { gas: "gasoline", unleaded: "gasoline", ev: "electric", "battery electric": "electric" },
};

export function checkSpecs(item: { name: string; maker?: string; contract?: string; section?: string }, raw: unknown): Specs {
  if (!raw || typeof raw !== "object") return {};
  const record = `${item.name} ${item.maker ?? ""} ${item.section ?? ""}`;
  const words = new Set(tokens(record));
  const nums = new Set(figures(record));
  const out: Specs = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!(k in SPEC_KEYS)) continue;
    const key = k as SpecKey;
    const said = String(v ?? "").toLowerCase().trim().replace(/\s+/g, " ");
    const value = STANDARD[key]?.[said] ?? said;
    if (!value || value.length > 30 || !/^[a-z0-9]/.test(value)) continue;
    // Every figure must be printed in the record: "45 ppm" needs a 45 there.
    if (!figures(value).every((f) => nums.has(f))) continue;
    const vw = tokens(value).filter((w) => !/^\d/.test(w));
    // Printed when its words are in the record, or the reviewer's own spelling is ("b&w" for mono), or a standard
    // spelling of a fixed-choice value is ("armless" for arms none).
    const printed = vw.every((w) => words.has(w)) || (said !== value && tokens(said).filter((w) => !/^\d/.test(w)).every((w) => words.has(w)) && /[a-z]/.test(said)) || Boolean(PRINTED_AS[key]?.[value]?.test(record));
    if (printed) out[key] = { value: units(value) };
    else if (INFERABLE.has(key) && !figures(value).length) out[key] = { value, inferred: true };
  }
  return out;
}

export { specsLine } from "../lib/specs";
