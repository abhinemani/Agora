// Generates Agora's Material 3 theme from one seed color with Google's
// material-color-utilities: the fidelity scheme's color roles (M3's scheme for
// brand colors: the primary container is the brand blue itself), the tonal
// palettes behind them, and harmonized custom colors for the buying routes and
// for success and warning states. Writes lib/m3-theme.json, which
// tailwind.config.ts reads. Run: node scripts/m3-theme.mjs

import { writeFileSync } from "node:fs";
import { Blend, Hct, MaterialDynamicColors as C, SchemeFidelity, TonalPalette, argbFromHex, hexFromArgb } from "@material/material-color-utilities";

const SEED = "#315BD0"; // Agora's blue
const seed = argbFromHex(SEED);
const scheme = new SchemeFidelity(Hct.fromInt(seed), false, 0);

const ROLES = [
  "primary", "onPrimary", "primaryContainer", "onPrimaryContainer",
  "secondary", "onSecondary", "secondaryContainer", "onSecondaryContainer",
  "tertiary", "onTertiary", "tertiaryContainer", "onTertiaryContainer",
  "error", "onError", "errorContainer", "onErrorContainer",
  "surface", "surfaceDim", "surfaceBright", "onSurface", "onSurfaceVariant",
  "surfaceContainerLowest", "surfaceContainerLow", "surfaceContainer", "surfaceContainerHigh", "surfaceContainerHighest",
  "outline", "outlineVariant", "inverseSurface", "inverseOnSurface", "inversePrimary", "scrim", "shadow",
];
const kebab = (s) => s.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
const roles = Object.fromEntries(ROLES.map((r) => [kebab(r), hexFromArgb(C[r].getArgb(scheme))]));
// One override: fidelity tints the secondary container toward the seed and puts
// its text at a mid tone (about 4.6:1). Tonal buttons and the navigation
// indicator read better with M3's baseline mapping of the same palette:
// container at tone 90, text at tone 10.
roles["secondary-container"] = hexFromArgb(scheme.secondaryPalette.tone(90));
roles["on-secondary-container"] = hexFromArgb(scheme.secondaryPalette.tone(10));

// Tailwind-style steps mapped onto M3 tones, so existing classes like
// "emerald-50" or "navy" land on the right tone of a harmonized palette.
const STEPS = { 50: 95, 100: 90, 200: 80, 300: 70, 400: 60, 500: 50, 600: 40, 700: 30, 800: 20, 900: 10 };
const ramp = (palette) => Object.fromEntries(Object.entries(STEPS).map(([k, t]) => [k, hexFromArgb(palette.tone(t))]));
const harmonized = (hex) => TonalPalette.fromInt(Blend.harmonize(argbFromHex(hex), seed));

// Custom colors, harmonized toward the seed as M3 recommends. Each gets the four
// M3 custom-color roles (color, on-color, container, on-container) and a ramp.
const CUSTOM = {
  success: "#167757",
  warning: "#B7791F",
  "src-own": "#167757",
  "src-state": "#A86B12",
  "src-coop": "#6A4BC4",
  "src-other": "#708097",
  "src-small": "#0E7C86",
};
const custom = Object.fromEntries(
  Object.entries(CUSTOM).map(([name, hex]) => {
    const p = harmonized(hex);
    return [name, { DEFAULT: hexFromArgb(p.tone(40)), on: hexFromArgb(p.tone(100)), container: hexFromArgb(p.tone(90)), "on-container": hexFromArgb(p.tone(10)), ramp: ramp(p) }];
  }),
);

const out = {
  seed: SEED,
  scheme: "fidelity, light",
  roles,
  palettes: {
    primary: ramp(scheme.primaryPalette),
    secondary: ramp(scheme.secondaryPalette),
    tertiary: ramp(scheme.tertiaryPalette),
    neutral: ramp(scheme.neutralPalette),
    "neutral-variant": ramp(scheme.neutralVariantPalette),
    error: ramp(scheme.errorPalette),
  },
  custom,
};
writeFileSync(new URL("../lib/m3-theme.json", import.meta.url), JSON.stringify(out, null, 2) + "\n");
console.log("primary", roles.primary, "surface", roles.surface, "secondary-container", roles["secondary-container"]);
