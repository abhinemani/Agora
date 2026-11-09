"use client";

import Link from "next/link";
import { EDGE_TIER, REVENUE_OPTIONS } from "@/lib/revenue_rules";
import type { Source, Supplier } from "@/lib/types";
import { useStore } from "./store";

export const money = (n: number, cents = true) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: cents ? 2 : 0, maximumFractionDigits: cents ? 2 : 0 });

export const compact = (n: number) =>
  n >= 1_000_000 ? `$${(n / 1_000_000).toFixed(2)}M` : n >= 1000 ? `$${Math.round(n / 1000)}K` : money(n, false);

const SOURCE_STYLE: Record<Source, { label: string; cls: string }> = {
  own_contract: { label: "Agency contract", cls: "bg-navy" },
  state_contract: { label: "State contract", cls: "bg-steel" },
  coop_contract: { label: "Co-op contract", cls: "bg-maroon" },
  reseller: { label: "Reseller", cls: "bg-slate" },
  gsa: { label: "GSA schedule", cls: "bg-navy-600" },
  no_approval: { label: "No approval needed", cls: "bg-emerald-600" },
};

export function SourcePill({ source }: { source: Source }) {
  const s = SOURCE_STYLE[source];
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-slate">
      <span className={`h-1.5 w-1.5 rounded-full ${s.cls}`} aria-hidden />
      {s.label}
    </span>
  );
}

export const sourceLabel = (s: Source) => SOURCE_STYLE[s].label;

export function Badge({ children, tone = "neutral" }: { children: React.ReactNode; tone?: "neutral" | "maroon" | "navy" | "green" | "amber" }) {
  const cls = {
    neutral: "text-slate",
    maroon: "text-maroon",
    navy: "text-navy",
    green: "text-emerald-700",
    amber: "text-amber-700",
  }[tone];
  return <span className={`inline-flex items-center rounded border border-line bg-white px-1.5 py-px text-[11px] font-semibold ${cls}`}>{children}</span>;
}

export function Stars({ rating, count }: { rating: number; count?: number }) {
  if (!rating) return <span className="text-xs text-slate">No reviews yet</span>;
  return (
    <span className="inline-flex items-center gap-1 text-xs text-slate">
      <span className="text-maroon" aria-hidden>
        ★
      </span>
      <span className="font-semibold text-navy">{rating.toFixed(1)}</span>
      {count !== undefined && <span>({count} reviews)</span>}
    </span>
  );
}

export function SupplierBadges({ supplier }: { supplier: Supplier }) {
  return (
    <span className="flex flex-wrap items-center gap-1">
      {supplier.is_local && <Badge tone="navy">Local</Badge>}
      {supplier.certifications.map((c) => (
        <Badge key={c} tone="maroon">
          {c}
        </Badge>
      ))}
      {supplier.verified.insurance && supplier.verified.bond && <Badge tone="green">Verified</Badge>}
    </span>
  );
}

export function Card({ children, className = "", accent }: { children: React.ReactNode; className?: string; accent?: "rose" | "steel" | "navy" | "maroon" }) {
  const top = accent ? { rose: "border-t-[3px] border-t-rose", steel: "border-t-[3px] border-t-steel", navy: "border-t-[3px] border-t-navy", maroon: "border-t-[3px] border-t-maroon" }[accent] : "";
  void top; // accents retired in the lighter design; kept in the signature for callers
  return <div className={`rounded-lg border border-line bg-white ${className}`}>{children}</div>;
}

/** Numbered maroon badges naming the revenue options an action triggers, as in the deck. */
export function RevenueTags({ options, size = "sm", force }: { options: readonly number[]; size?: "sm" | "md"; force?: boolean }) {
  const { showEarn } = useStore();
  if ((!showEarn && !force) || !options.length) return null;
  const dim = size === "md" ? "h-7 min-w-7 text-xs" : "h-5 min-w-5 text-[10px]";
  return (
    <span className="inline-flex items-center gap-0.5 align-middle">
      {options.map((o) => (
        <span
          key={o}
          title={`Revenue option ${o}: ${REVENUE_OPTIONS[o].name}${EDGE_TIER[o] ? ` (Edge ${EDGE_TIER[o]})` : ""}`}
          className={`inline-flex items-center justify-center rounded-full bg-maroon px-1 font-bold text-white ring-2 ring-white ${dim}`}
        >
          {o}
        </span>
      ))}
    </span>
  );
}

export function Eyebrow({ children, tone = "maroon" }: { children: React.ReactNode; tone?: "maroon" | "rose" | "slate" | "steel" }) {
  void tone;
  return <div className="text-sm text-slate">{children}</div>;
}

export function Button({
  children,
  variant = "primary",
  className = "",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "ghost" | "maroon" }) {
  const cls = {
    primary: "bg-navy text-white hover:bg-navy-600 disabled:bg-steel",
    maroon: "bg-maroon text-white hover:bg-maroon/90 disabled:bg-steel",
    secondary: "border border-line bg-white text-navy hover:border-navy/30 disabled:text-steel",
    ghost: "text-navy hover:bg-tint disabled:text-steel",
  }[variant];
  return (
    <button
      {...props}
      className={`inline-flex items-center justify-center gap-1.5 rounded-md px-3.5 py-2 text-sm font-semibold transition-colors disabled:cursor-not-allowed ${cls} ${className}`}
    >
      {children}
    </button>
  );
}

export function LinkButton({ href, children, variant = "primary", className = "" }: { href: string; children: React.ReactNode; variant?: "primary" | "secondary" | "maroon"; className?: string }) {
  const cls = {
    primary: "bg-navy text-white hover:bg-navy-600",
    maroon: "bg-maroon text-white hover:bg-maroon/90",
    secondary: "border border-line bg-white text-navy hover:border-navy/30",
  }[variant];
  return (
    <Link href={href} className={`inline-flex items-center justify-center gap-1.5 rounded-md px-3.5 py-2 text-sm font-semibold transition-colors ${cls} ${className}`}>
      {children}
    </Link>
  );
}

export function PageTitle({ eyebrow, title, children }: { eyebrow?: string; title: string; children?: React.ReactNode }) {
  return (
    <div className="mb-8">
      <h1 className="text-2xl font-semibold tracking-tight text-navy">{title}</h1>
      {children && <div className="mt-1.5 max-w-2xl text-[15px] leading-relaxed text-slate">{children}</div>}
    </div>
  );
}

export function IconCircle({ children, size = "md" }: { children: React.ReactNode; size?: "md" | "lg" }) {
  const d = size === "lg" ? "h-11 w-11 [&>svg]:h-5 [&>svg]:w-5" : "h-8 w-8 [&>svg]:h-4 [&>svg]:w-4";
  return <span className={`flex shrink-0 items-center justify-center rounded-full bg-tint text-sm font-semibold text-navy ${d}`}>{children}</span>;
}

export function SectionLabel({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-3">
      <h2 className="text-base font-semibold text-navy">{children}</h2>
      {right}
    </div>
  );
}

export function Loading({ label = "Loading" }: { label?: string }) {
  return <div className="py-16 text-center text-sm text-slate">{label}…</div>;
}

export function ErrorNote({ message }: { message: string | null }) {
  if (!message) return null;
  return <div className="rounded-md border border-maroon/30 bg-maroon-50 px-3 py-2 text-sm text-maroon">{message}</div>;
}

const SUPPLIER_COLORS = ["#315BD0", "#167757", "#B45309", "#7C3AED", "#BE185D", "#0E7490", "#4D7C0F", "#9333EA", "#C2410C"];
/** A steady color per supplier, for storefront avatars. */
export function supplierColor(id: string) {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return SUPPLIER_COLORS[h % SUPPLIER_COLORS.length];
}
