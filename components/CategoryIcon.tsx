import type { Category } from "@/lib/types";
import { Box, Briefcase, Chair, Cloud, Cone, Laptop, Paper, Shield, Spray, Truck, Wrench } from "./icons";

/** Each category has its own hue: a soft tint behind a saturated icon, at
 * matched lightness so they sit together next to the navy and maroon. */
const HUE: Record<Category, string> = {
  "Office supplies": "#B36B00",
  Furniture: "#1D7A69",
  Janitorial: "#1E6FA8",
  "IT hardware": "#4A44B5",
  "Software and services": "#7B3BB9",
  "Facilities and MRO": "#C0501A",
  "Fleet and parts": "#36507E",
  "Public works materials": "#8A7410",
  "Safety and uniforms": "#B3243F",
  "Professional services": "#2E7A3D",
  Other: "#14213D",
};
/** Each category's hue mixed into the page surface: a soft tint on white, a deep tone in dark mode. */
const mix = (hue: string, pct: number, onto: string) => `color-mix(in srgb, ${hue} ${pct}%, rgb(var(--us-${onto})))`;
export const CATEGORY_TONE: Record<Category, { bg: string; fg: string; deep: string }> = Object.fromEntries(
  (Object.keys(HUE) as Category[]).map((c) => [c, { bg: mix(HUE[c], 14, "white"), fg: mix(HUE[c], 78, "base-ink"), deep: mix(HUE[c], 32, "white") }]),
) as Record<Category, { bg: string; fg: string; deep: string }>;

const ICON: Record<Category, (p: { className?: string }) => React.ReactElement> = {
  "Office supplies": Paper,
  Furniture: Chair,
  Janitorial: Spray,
  "IT hardware": Laptop,
  "Software and services": Cloud,
  "Facilities and MRO": Wrench,
  "Fleet and parts": Truck,
  "Public works materials": Cone,
  "Safety and uniforms": Shield,
  "Professional services": Briefcase,
  Other: Box,
};

/** A tile that stands in for a product photo: tinted by category, or neutral warm gray for product grids. */
export function CategoryIcon({ category, size = "md", neutral = false }: { category: Category; size?: "sm" | "md" | "lg" | "xl"; neutral?: boolean }) {
  const Icon = ICON[category] ?? Box;
  const tone = CATEGORY_TONE[category] ?? CATEGORY_TONE.Other;
  const dim = {
    sm: "h-9 w-9 rounded-lg [&>svg]:h-4 [&>svg]:w-4",
    md: "h-12 w-12 rounded-xl [&>svg]:h-5 [&>svg]:w-5",
    lg: "h-14 w-14 rounded-xl [&>svg]:h-6 [&>svg]:w-6",
    xl: "h-full w-full [&>svg]:h-12 [&>svg]:w-12",
  }[size];
  return (
    <span
      className={`flex shrink-0 items-center justify-center ${dim} ${neutral ? "bg-base-lightest text-base-darker [&>svg]:stroke-[1.25]" : ""}`}
      style={neutral ? undefined : { background: tone.bg, color: tone.fg }}
    >
      <Icon />
    </span>
  );
}
