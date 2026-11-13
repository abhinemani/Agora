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
// _uswds-theme.scss does. Agora keeps USWDS's colors, type and component shapes
// (blue-60v primary, cool-gray neutrals, Merriweather headings, 4px buttons) and
// borrows only presentation from editorial retail (image-led product tiles,
// generous whitespace), which lives in the components, not here. Each setting
// below changes one USWDS default; leave a key out to keep the default.
const AGORA_THEME = {
  color: {},
  font: {},
  // USWDS defaults: buttons "md" (4px), cards "lg" (8px), tags "sm" (2px), square inputs.
  shape: { button: "4", card: "8", tag: "2", input: "0" },
  weights: { heading: 700 },
};

// ---- Theme colors: USWDS's default theme settings, then Agora's overrides, resolved to hex
const settings = read("settings/_settings-color.scss");
const theme = {};
const themeTokens = {};
for (const [, name, token] of settings.matchAll(/^\$theme-color-([a-z-]+):\s*"([a-z0-9-]+)"\s*!default;/gm)) {
  if (name.endsWith("-family")) continue;
  themeTokens[name] = AGORA_THEME.color[name] ?? token;
  theme[name] = hex(themeTokens[name]);
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

// ---- Dark mode. USWDS doesn't define one, so Agora mirrors each color's grade within
// its own USWDS family: light surfaces become dark ones, ink becomes light, and
// "white" and "black" swap, so text that sits on a filled color stays readable.
// Every dark value is still a USWDS system color.
const MIRROR = { 5: 80, 10: 70, 20: 60, 30: 50, 40: 40, 50: 40, 60: 30, 70: 20, 80: 10, 90: 5 };
const tokenOf = (family, g, vivid) => (vivid && system[`${family}-${g}v`] ? `${family}-${g}v` : system[`${family}-${g}`] ? `${family}-${g}` : `${family}-${g}v`);
function mirror(token) {
  if (token === "white") return "gray-90";
  if (token === "black") return "white";
  const m = token.match(/^(.+)-(\d+)(v?)$/);
  if (!m) return token;
  return tokenOf(m[1], MIRROR[Number(m[2])], m[3] === "v");
}
const rampTokens = (family) => Object.fromEntries(Object.entries(STEPS).map(([k, g]) => [k, tokenOf(family, g, false)]));
const routeTokens = (family) => ({ DEFAULT: tokenOf(family, 60, true), lighter: tokenOf(family, 10, false), darker: tokenOf(family, 80, false) });

// Every color Agora uses, as a CSS variable with a light and a dark value.
const vars = {};
const def = (name, token, darkToken = mirror(token)) => (vars[name] = { light: hex(token), dark: hex(darkToken), token, darkToken });
for (const [name, token] of Object.entries(themeTokens)) def(name, token);
def("white", "white");
def("black", "black");
const focusToken = read("settings/_settings-general.scss").match(/^\$theme-focus-color:\s*"([a-z0-9-]+)"/m)[1];
def("focus", focusToken, focusToken);
for (const [k, fam] of Object.entries({ success: "green-cool", warning: "gold", error: "red-warm" }))
  for (const [step, token] of Object.entries(rampTokens(fam))) def(`ramp-${k}-${step}`, token);
for (const [k, r] of Object.entries(routes)) {
  const t = routeTokens(r.family);
  def(k, t.DEFAULT);
  def(`${k}-lighter`, t.lighter);
  def(`${k}-darker`, t.darker);
}

// Tailwind color keys → the variable each uses. Agora's older names are aliases.
const family = (name) =>
  Object.fromEntries(Object.keys(themeTokens).filter((k) => k === name || (k.startsWith(`${name}-`) && !k.slice(name.length + 1).includes("-"))).map((k) => [k === name ? "DEFAULT" : k.slice(name.length + 1), k]));
const palette = {
  ...Object.fromEntries(["primary", "secondary", "accent-warm", "accent-cool", "error", "warning", "success", "info", "disabled"].map((f) => [f, family(f)])),
  base: { lightest: "base-lightest", lighter: "base-lighter", light: "base-light", medium: "base", dark: "base-dark", darker: "base-darker", darkest: "base-darkest" },
  ink: "base-ink",
  focus: "focus",
  white: "white",
  black: "black",
  ...Object.fromEntries(Object.keys(routes).map((k) => [k, { DEFAULT: k, lighter: `${k}-lighter`, darker: `${k}-darker` }])),
  navy: { DEFAULT: "base-ink", 600: "base-darker", 50: "primary-lighter" },
  maroon: { DEFAULT: "primary", 600: "primary-dark", 50: "primary-lighter" },
  rose: "primary-light",
  steel: "base-light",
  tint: "base-lightest",
  page: "base-lightest",
  line: "base-lighter",
  slate: { DEFAULT: "base-dark" },
  green: { DEFAULT: "success-darker", 50: "success-lighter" },
  emerald: Object.fromEntries(Object.keys(STEPS).map((k) => [k, `ramp-success-${k}`])),
  amber: Object.fromEntries(Object.keys(STEPS).map((k) => [k, `ramp-warning-${k}`])),
  red: Object.fromEntries(Object.keys(STEPS).map((k) => [k, `ramp-error-${k}`])),
};

// The stylesheet: light by default, dark when the system prefers it (unless the
// viewer chose light), or when the viewer chose dark.
const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)).join(" ");
const block = (mode) => Object.entries(vars).map(([n, v]) => `  --us-${n}: ${rgb(v[mode])};`).join("\n");
const css = `/* Generated by scripts/uswds-theme.mjs from @uswds/uswds and AGORA_THEME. Do not edit. */
:root {
  color-scheme: light;
${block("light")}
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    color-scheme: dark;
${block("dark").replace(/^/gm, "  ")}
  }
}
:root[data-theme="dark"] {
  color-scheme: dark;
${block("dark")}
}
`;
writeFileSync(new URL("../app/theme.css", import.meta.url), css);

const out = {
  source: "@uswds/uswds 3.13.0, default theme with Agora's theme settings",
  overrides: AGORA_THEME,
  palette,
  vars,
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
