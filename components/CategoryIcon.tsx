import type { Category } from "@/lib/types";
import { Box, Briefcase, Chair, Cloud, Cone, Laptop, Paper, Shield, Spray, Truck, Wrench } from "./icons";

/** Each category has its own hue: a soft tint behind a saturated icon, at
 * matched lightness so they sit together next to the navy and maroon. */
export const CATEGORY_TONE: Record<Category, { bg: string; fg: string; deep: string }> = {
  "Office supplies": { bg: "#FDF1DC", fg: "#B36B00", deep: "#F6D9A6" },
  Furniture: { bg: "#DDF3EE", fg: "#1D7A69", deep: "#B4E3D8" },
  Janitorial: { bg: "#E0F0FB", fg: "#1E6FA8", deep: "#B9DBF3" },
  "IT hardware": { bg: "#E8E7FB", fg: "#4A44B5", deep: "#CBC8F4" },
  "Software and services": { bg: "#F0E6FB", fg: "#7B3BB9", deep: "#DCC6F4" },
  "Facilities and MRO": { bg: "#FCE8DD", fg: "#C0501A", deep: "#F5C9B0" },
  "Fleet and parts": { bg: "#E3EAF5", fg: "#36507E", deep: "#C3D0E6" },
  "Public works materials": { bg: "#F4F0D6", fg: "#8A7410", deep: "#E6DCA5" },
  "Safety and uniforms": { bg: "#FBE4E8", fg: "#B3243F", deep: "#F3C0CA" },
  "Professional services": { bg: "#E2F3E5", fg: "#2E7A3D", deep: "#BCE2C3" },
  Other: { bg: "#EDF1F7", fg: "#14213D", deep: "#D6DEEA" },
};

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

/** A tinted tile that stands in for a product photo. */
export function CategoryIcon({ category, size = "md" }: { category: Category; size?: "sm" | "md" | "lg" | "xl" }) {
  const Icon = ICON[category] ?? Box;
  const tone = CATEGORY_TONE[category] ?? CATEGORY_TONE.Other;
  const dim = {
    sm: "h-9 w-9 rounded-lg [&>svg]:h-4 [&>svg]:w-4",
    md: "h-12 w-12 rounded-xl [&>svg]:h-5 [&>svg]:w-5",
    lg: "h-14 w-14 rounded-xl [&>svg]:h-6 [&>svg]:w-6",
    xl: "h-full w-full [&>svg]:h-12 [&>svg]:w-12",
  }[size];
  return (
    <span className={`flex shrink-0 items-center justify-center ${dim}`} style={{ background: tone.bg, color: tone.fg }}>
      <Icon />
    </span>
  );
}
