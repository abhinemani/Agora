import type { Category } from "@/lib/types";
import { Box, Briefcase, Chair, Cloud, Cone, Laptop, Paper, Shield, Spray, Truck, Wrench } from "./icons";

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

/** A tile that stands in for a product photo. Every category shares one blueprint tint, so the
 * only strong color on a page is contract eligibility; product grids use the neutral gray. */
export function CategoryIcon({ category, size = "md", neutral = false }: { category: Category; size?: "sm" | "md" | "lg" | "xl"; neutral?: boolean }) {
  const Icon = ICON[category] ?? Box;
  const dim = {
    sm: "h-9 w-9 [&>svg]:h-4 [&>svg]:w-4",
    md: "h-12 w-12 [&>svg]:h-5 [&>svg]:w-5",
    lg: "h-14 w-14 [&>svg]:h-6 [&>svg]:w-6",
    xl: "h-full w-full [&>svg]:h-12 [&>svg]:w-12",
  }[size];
  return (
    <span
      className={`flex shrink-0 items-center justify-center ${dim} ${neutral ? "bg-base-lightest text-base-darker [&>svg]:stroke-[1.25]" : "border border-primary-lighter bg-primary-lighter/40 text-primary-dark [&>svg]:stroke-[1.5]"}`}
    >
      <Icon />
    </span>
  );
}
