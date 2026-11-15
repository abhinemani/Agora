// The spec keys products are read into (scripts/product-specs.ts), and how each is said on a page. Client-safe: no
// server modules, so the product cards and the dive's questions can use it.

/** The spec keys, each with what it holds. The order is the order they are shown and asked in. */
export const SPEC_KEYS = {
  fuel: "gasoline, diesel, electric, hybrid, plug-in hybrid, propane, cng or flex fuel",
  drivetrain: "2wd, 4wd, awd, fwd or rwd",
  cab: "regular, extended, crew, super cab, double or mega",
  class: "a vehicle's weight class as printed, e.g. 1/2 ton, 3/4 ton, 1 ton, class 3",
  seats: "how many people it seats, e.g. 12, 29 passenger",
  age_range: "the ages it is for, e.g. 2-5, 5-12",
  height: "a height as printed, e.g. 64-72 in deck, 8 ft",
  size: "dimensions or length as printed, e.g. 30 x 60 in, 6 ft",
  capacity: "how much it holds, e.g. 30 gal, 500 lb",
  pack: "how many come in a unit, e.g. 500/case, box of 100",
  color: "a color, e.g. black, cyan, orange",
  material: "what it is made of, e.g. steel, aluminum, polyethylene, mesh, laminate",
  back: "a seat's back height: high, mid or low",
  arms: "a seat's arms: none, fixed or adjustable",
  print: "a printer's or copier's output: color or mono",
  speed: "pages per minute, e.g. 45 ppm",
  power: "an engine or motor as printed, e.g. 3.3l v6, 5.7l hemi v8, 12v",
} as const;
export type SpecKey = keyof typeof SPEC_KEYS;

export interface SpecValue {
  value: string;
  /** Read from what the name implies, not printed in it. */
  inferred?: boolean;
}
export type Specs = Partial<Record<SpecKey, SpecValue>>;

export const isSpecKey = (k: string): k is SpecKey => k in SPEC_KEYS;

/** The question the dive asks about a key, when the shortlist differs on it. */
export const SPEC_QUESTION: Record<SpecKey, string> = {
  fuel: "Which fuel?",
  drivetrain: "Which drivetrain?",
  cab: "Which cab?",
  class: "Which weight class?",
  seats: "How many seats?",
  age_range: "For which ages?",
  height: "Which height?",
  size: "Which size?",
  capacity: "How much should it hold?",
  pack: "Which pack size?",
  color: "Which color?",
  material: "Which material?",
  back: "How high a back?",
  arms: "Which arms?",
  print: "Color or black and white?",
  speed: "How fast?",
  power: "Which engine?",
};

const up = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

/** A spec as a buyer reads it: "Crew cab", "4WD", "Ages 2-5", "High back", "No arms", "Black and white". */
export function specText(key: SpecKey, value: string): string {
  switch (key) {
    case "cab":
      return `${up(value)} cab`;
    case "drivetrain":
      return value.toUpperCase();
    case "age_range":
      return `Ages ${value}`;
    case "back":
      return `${up(value)} back`;
    case "arms":
      return value === "none" ? "No arms" : `${up(value)} arms`;
    case "print":
      return value === "mono" ? "Black and white" : "Color";
    case "seats":
      return /\d$/.test(value) ? `${value} seats` : up(value);
    case "class":
    case "size":
    case "height":
    case "capacity":
    case "pack":
    case "speed":
    case "power":
      return value;
    default:
      return up(value);
  }
}

/** A product's specs as short phrases, in the keys' order; an inferred one says so. */
export const specPhrases = (specs: Specs | undefined): string[] =>
  !specs ? [] : (Object.keys(SPEC_KEYS) as SpecKey[]).filter((k) => specs[k]).map((k) => `${specText(k, specs[k]!.value)}${specs[k]!.inferred ? " (from the model name)" : ""}`);

/** Specs as one short line for the fit judge: "cab: crew; fuel: gasoline (inferred)". */
export function specsLine(specs: Specs | undefined): string {
  if (!specs) return "";
  return (Object.keys(SPEC_KEYS) as SpecKey[])
    .filter((k) => specs[k])
    .map((k) => `${k.replace("_", " ")}: ${specs[k]!.value}${specs[k]!.inferred ? " (inferred)" : ""}`)
    .join("; ");
}
