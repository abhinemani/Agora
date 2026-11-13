// Generates Agora's U.S. Web Design System theme from the official @uswds/uswds
// package: reads USWDS's own SCSS (system color tokens, default theme color
// settings, type scale, typeface cap heights, line heights), applies Agora's
// theme settings (AGORA_THEME, below) the way a USWDS project customizes its
// theme, and writes lib/uswds-theme.json, which tailwind.config.ts reads. Every
// value is a USWDS system token.
// Run: node scripts/uswds-theme.mjs

import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const CORE = new URL("../node_modules/@uswds/uswds/packages/uswds-core/src/styles/", import.meta.url).pathname;
const read = (p) => readFileSync(join(CORE, p), "utf8");

// ---- System colors: "blue-60v" → #005ea2, "gray-cool-10" → #dfe1e2
const system = {};
for (const f of readdirSync(join(CORE, "tokens/color")).filter((f) => /^_[a-z-]+\.scss$/.test(f) && !/index|global|transparent/.test(f))) {
  const src = read(`tokens/color/${f}`);
  const family = src.match(/\(\s*"([a-z-]+)":\s*\(/)?.[1];
  if (!family) continue;
  const [regular, vivid = ""] = src.split(/"vivid":/);
  for (const [, grade, hex] of regular.matchAll(/(\d+):\s*(#[0-9a-f]{6})/gi)) system[`${family}-${grade}`] = hex.toLowerCase();
  for (const [, grade, hex] of vivid.matchAll(/(\d+):\s*(#[0-9a-f]{6})/gi)) system[`${family}-${grade}v`] = hex.toLowerCase();
}
system["white"] = "#ffffff";
system["black"] = "#000000";
const hex = (token) => system[token] ?? (() => { throw new Error(`No USWDS system color ${token}`); })();

// ---- Agora's theme settings, layered over USWDS's defaults the way a project's
// _uswds-theme.scss does. A warm, retail look: ink calls to action on white,
// warm-gray neutrals, light sans headings, square corners. Status colors and
// the focus color stay USWDS defaults.
const AGORA_THEME = {
  color: {
    "base-lightest": "gray-warm-5",
    "base-lighter": "gray-warm-10",
    "base-light": "gray-warm-30",
    base: "gray-warm-50",
    "base-dark": "gray-warm-60",
    "base-darker": "gray-warm-70",
    "base-darkest": "gray-90",
    "base-ink": "gray-90",
    "primary-lighter": "gray-warm-5",
    "primary-light": "gray-warm-30",
    primary: "gray-90",
    "primary-vivid": "gray-90",
    "primary-dark": "black",
    "primary-darker": "black",
  },
  font: { "font-role-heading": "sans" },
  shape: { button: "0", card: "0", tag: "0", input: "0" },
  weights: { heading: 300 },
};

// ---- Theme colors: USWDS's default theme settings, then Agora's overrides, resolved to hex
const settings = read("settings/_settings-color.scss");
const theme = {};
for (const [, name, token] of settings.matchAll(/^\$theme-color-([a-z-]+):\s*"([a-z0-9-]+)"\s*!default;/gm)) {
  if (name.endsWith("-family")) continue;
  theme[name] = hex(AGORA_THEME.color[name] ?? token);
}

// Tailwind steps → USWDS grades, so existing classes like "emerald-50" land on
// a USWDS grade of the success, warning or error family.
const STEPS = { 50: 5, 100: 10, 200: 20, 300: 30, 400: 40, 500: 50, 600: 60, 700: 70, 800: 80, 900: 90 };
const ramp = (family) => Object.fromEntries(Object.entries(STEPS).map(([k, g]) => [k, system[`${family}-${g}`] ?? system[`${family}-${g}v`]]));

// ---- Agora's project colors: where a purchase is made. Each uses a USWDS system
// color at grade 60, vivid where the family has it (text-safe on white: USWDS's "magic number" is a grade
// difference of 50+ for AA), grade 10 for light backgrounds, and grade 80 for
// text on those backgrounds.
const pick = (family, g) => system[`${family}-${g}`] ?? system[`${family}-${g}v`];
const vividFirst = (family, g) => system[`${family}-${g}v`] ?? system[`${family}-${g}`];
const project = (family) => ({ DEFAULT: vividFirst(family, 60), lighter: pick(family, 10), darker: pick(family, 80) });
const routes = {
  "src-own": { family: "green-cool", ...project("green-cool") },
  "src-state": { family: "gold", ...project("gold") },
  "src-coop": { family: "violet-warm", ...project("violet-warm") },
  "src-other": { family: "gray-cool", ...project("gray-cool") },
  "src-small": { family: "cyan", ...project("cyan") },
};

// ---- Type: USWDS theme type scale, normalized per typeface by cap height
const typeSettings = read("settings/_settings-typography.scss");
const scale = Object.fromEntries([...read("tokens/font/type-scale.scss").matchAll(/^\s*"?([a-z0-9]+)"?:\s*(\d+)px/gm)].map(([, k, v]) => [k, Number(v)]));
const baseCap = Number(read("tokens/font/base-cap-height.scss").match(/\$system-base-cap-height:\s*(\d+)px/)[1]);
const typefaces = read("tokens/font/typefaces.scss");
const capHeight = (token) => Number(typefaces.match(new RegExp(`"${token}":\\s*\\(\\s*display-name:[^,]*,\\s*cap-height:\\s*(\\d+)px`))[1]);
const setting = (name) => AGORA_THEME.font[name] ?? typeSettings.match(new RegExp(`^\\$theme-${name}:\\s*"?([a-z0-9-]+)"?\\s*!default;`, "m"))[1];
const SIZES = ["3xs", "2xs", "xs", "sm", "md", "lg", "xl", "2xl", "3xl"];
const fonts = { sans: setting("font-type-sans"), serif: setting("font-type-serif"), mono: setting("font-type-mono") };
const roles = { heading: setting("font-role-heading"), body: setting("font-role-body"), ui: setting("font-role-ui") };
const normalized = (face) =>
  Object.fromEntries(SIZES.map((s) => [s, `${+((baseCap * scale[setting(`type-scale-${s}`)]) / capHeight(face) / 16).toFixed(4)}rem`]));
const lineHeights = Object.fromEntries([...read("tokens/font/line-height.scss").matchAll(/^\s*(\d):\s*([\d.]+),/gm)].map(([, k, v]) => [k, Number(v)]));

// Steady per-supplier avatar colors: USWDS system colors at vivid grade 60.
const avatars = ["blue", "green-cool", "violet-warm", "cyan", "magenta", "orange-warm", "indigo", "mint-cool", "gold"].map((f) => vividFirst(f, 60));

const out = {
  source: "@uswds/uswds 3.13.0, default theme with Agora's theme settings",
  overrides: AGORA_THEME,
  shape: AGORA_THEME.shape,
  color: { theme, routes, avatars, ramps: { success: ramp("green-cool"), warning: ramp("gold"), error: ramp("red-warm"), base: ramp("gray-cool"), primary: ramp("blue") }, focus: hex(read("settings/_settings-general.scss").match(/^\$theme-focus-color:\s*"([a-z0-9-]+)"/m)[1]) },
  font: {
    families: { sans: "Source Sans 3", serif: "Merriweather", mono: "Roboto Mono" },
    tokens: fonts,
    roles,
    sizes: { heading: normalized(fonts[roles.heading]), body: normalized(fonts[roles.body]), ui: normalized(fonts[roles.ui]) },
    headings: { h1: setting("h1-font-size"), h2: setting("h2-font-size"), h3: setting("h3-font-size") },
    lineHeights,
    bodyLineHeight: lineHeights[setting("body-line-height")],
    headingLineHeight: lineHeights[setting("heading-line-height")],
    headingWeight: AGORA_THEME.weights.heading,
  },
};
writeFileSync(new URL("../lib/uswds-theme.json", import.meta.url), JSON.stringify(out, null, 2) + "\n");
console.log("primary", out.color.theme.primary, "primary-dark", out.color.theme["primary-dark"], "base-lighter", out.color.theme["base-lighter"], "focus", out.color.focus);
console.log("body sizes", JSON.stringify(out.font.sizes.body));
console.log("heading sizes", JSON.stringify(out.font.sizes.heading));
console.log("routes", JSON.stringify(Object.fromEntries(Object.entries(routes).map(([k, v]) => [k, [v.DEFAULT, v.lighter, v.darker]]))));
