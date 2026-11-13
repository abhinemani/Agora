"use client";

import Link from "next/link";
import { EDGE_TIER, REVENUE_OPTIONS } from "@/lib/revenue_rules";
import { isTrx, TRX_STATES } from "@/lib/trx";
import type { Source, Supplier } from "@/lib/types";
import m3 from "@/lib/m3-theme.json";
import { useStore } from "./store";
import { VerifyBadge } from "./Verification";

export const money = (n: number, cents = true) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: cents ? 2 : 0, maximumFractionDigits: cents ? 2 : 0 });

export const compact = (n: number) =>
  n >= 1_000_000 ? `$${(n / 1_000_000).toFixed(2)}M` : n >= 1000 ? `$${Math.round(n / 1000)}K` : money(n, false);

const SOURCE_STYLE: Record<Source, { label: string; cls: string; dot: string }> = {
  own_contract: { label: "Agency contract", cls: "bg-src-own-container text-src-own-on-container", dot: "bg-src-own" },
  state_contract: { label: "State contract", cls: "bg-src-state-container text-src-state-on-container", dot: "bg-src-state" },
  coop_contract: { label: "Co-op contract", cls: "bg-src-coop-container text-src-coop-on-container", dot: "bg-src-coop" },
  reseller: { label: "Reseller", cls: "bg-src-other-container text-src-other-on-container", dot: "bg-src-other" },
  gsa: { label: "GSA schedule", cls: "bg-src-other-container text-src-other-on-container", dot: "bg-src-other" },
  no_approval: { label: "No approval needed", cls: "bg-src-small-container text-src-small-on-container", dot: "bg-src-small" },
};

/** The source colors (M3 custom colors, harmonized with the seed), for the route strip. */
export const SOURCE_HEX: Record<Source, string> = {
  own_contract: m3.custom["src-own"].DEFAULT,
  state_contract: m3.custom["src-state"].DEFAULT,
  coop_contract: m3.custom["src-coop"].DEFAULT,
  reseller: m3.custom["src-other"].DEFAULT,
  gsa: m3.custom["src-other"].DEFAULT,
  no_approval: m3.custom["src-small"].DEFAULT,
};

/** Where a listing is bought, as an M3 tonal chip in that source's color. State contracts in TRX states get their label. */
export function SourcePill({ source, contractId }: { source: Source; contractId?: string | null }) {
  const s = SOURCE_STYLE[source];
  const { db } = useStore();
  const trx = source === "state_contract" && contractId ? isTrx(db?.contracts.find((c) => c.id === contractId)) : false;
  return (
    <span className={`inline-flex h-6 items-center gap-1.5 rounded-md px-2 text-label-m ${s.cls}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} aria-hidden />
      {s.label}
      {trx && (
        <span className="-mr-1 rounded-sm bg-surface-container-lowest/70 px-1 text-label-s" title={`A state contract on the TRX program (${TRX_STATES.join(", ")}), which Sovra supports`}>
          TRX
        </span>
      )}
    </span>
  );
}

export const sourceLabel = (s: Source) => SOURCE_STYLE[s].label;

/** A small M3 chip. Neutral is outlined; tones use their tonal container. */
export function Badge({ children, tone = "neutral" }: { children: React.ReactNode; tone?: "neutral" | "maroon" | "navy" | "green" | "amber" }) {
  const cls = {
    neutral: "border border-outline-variant text-on-surface-variant",
    maroon: "bg-primary-container/15 text-primary ring-1 ring-inset ring-primary/25",
    navy: "bg-secondary-container text-on-secondary-container",
    green: "bg-success-container text-success-on-container",
    amber: "bg-warning-container text-warning-on-container",
  }[tone];
  return <span className={`inline-flex h-6 items-center rounded-md px-2 text-label-m ${cls}`}>{children}</span>;
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
      <VerifyBadge supplier={supplier} />
    </span>
  );
}

/** M3 outlined card. */
export function Card({ children, className = "", accent }: { children: React.ReactNode; className?: string; accent?: "rose" | "steel" | "navy" | "maroon" }) {
  void accent; // kept in the signature for callers
  return <div className={`rounded-lg border border-outline-variant bg-surface-container-lowest ${className}`}>{children}</div>;
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
          className={`inline-flex items-center justify-center rounded-full bg-tertiary px-1 text-label-s text-on-tertiary ring-2 ring-surface ${dim}`}
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

type ButtonVariant = "primary" | "maroon" | "tonal" | "secondary" | "ghost";

/** M3 common buttons: filled ("primary", "maroon"), tonal, outlined ("secondary") and text ("ghost").
 * Full-round, 40px tall, label-large type, with a state layer for hover and press. */
const BUTTON: Record<ButtonVariant, string> = {
  primary: "bg-primary text-on-primary hover:shadow-elevation-1 disabled:bg-on-surface/[.12] disabled:text-on-surface/[.38] disabled:shadow-none",
  maroon: "bg-primary text-on-primary hover:shadow-elevation-1 disabled:bg-on-surface/[.12] disabled:text-on-surface/[.38] disabled:shadow-none",
  tonal: "bg-secondary-container text-on-secondary-container hover:shadow-elevation-1 disabled:bg-on-surface/[.12] disabled:text-on-surface/[.38] disabled:shadow-none",
  secondary: "border border-outline text-primary disabled:border-on-surface/[.12] disabled:text-on-surface/[.38]",
  ghost: "px-3 text-primary disabled:text-on-surface/[.38]",
};
const BUTTON_BASE = "state-layer inline-flex h-10 items-center justify-center gap-2 rounded-full px-6 text-label-l transition-shadow disabled:cursor-not-allowed";

export function Button({
  children,
  variant = "primary",
  className = "",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }) {
  return (
    <button {...props} className={`${BUTTON_BASE} ${BUTTON[variant]} ${className}`}>
      {children}
    </button>
  );
}

export function LinkButton({ href, children, variant = "primary", className = "" }: { href: string; children: React.ReactNode; variant?: ButtonVariant; className?: string }) {
  return (
    <Link href={href} className={`${BUTTON_BASE} ${BUTTON[variant]} ${className}`}>
      {children}
    </Link>
  );
}

/** Page header: M3 headline-medium with body-large supporting text. */
export function PageTitle({ eyebrow, title, children }: { eyebrow?: string; title: string; children?: React.ReactNode }) {
  void eyebrow;
  return (
    <div className="mb-8">
      <h1 className="text-headline-m text-on-surface">{title}</h1>
      {children && <div className="mt-2 max-w-2xl text-body-l text-on-surface-variant">{children}</div>}
    </div>
  );
}

export function IconCircle({ children, size = "md" }: { children: React.ReactNode; size?: "md" | "lg" }) {
  const d = size === "lg" ? "h-12 w-12 [&>svg]:h-6 [&>svg]:w-6" : "h-10 w-10 [&>svg]:h-5 [&>svg]:w-5";
  return <span className={`flex shrink-0 items-center justify-center rounded-full bg-primary-container text-on-primary-container ${d}`}>{children}</span>;
}

export function SectionLabel({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-3">
      <h2 className="text-title-m text-on-surface">{children}</h2>
      {right}
    </div>
  );
}

/** M3 linear progress, indeterminate, with its label. */
export function Loading({ label = "Loading" }: { label?: string }) {
  return (
    <div className="mx-auto max-w-xs py-16 text-center" role="status">
      <div className="h-1 overflow-hidden rounded-full bg-secondary-container">
        <div className="m3-indeterminate h-full w-1/3 rounded-full bg-primary" />
      </div>
      <div className="mt-3 text-body-m text-on-surface-variant">{label}…</div>
    </div>
  );
}

export function ErrorNote({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div role="alert" className="rounded-md bg-error-container px-4 py-3 text-body-m text-on-error-container">
      {message}
    </div>
  );
}

/** M3 switch, for settings that take effect at once. */
export function Switch({ checked, onChange, disabled, label }: { checked: boolean; onChange: (on: boolean) => void; disabled?: boolean; label: React.ReactNode }) {
  return (
    <label className={`inline-flex items-center gap-3 text-body-m ${disabled ? "cursor-not-allowed text-on-surface/[.38]" : "cursor-pointer text-on-surface"}`}>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative h-8 w-[52px] shrink-0 rounded-full border-2 transition-colors duration-200 ${checked ? "border-primary bg-primary" : "border-outline bg-surface-container-highest"} disabled:opacity-40`}
      >
        <span
          className={`absolute top-1/2 grid -translate-y-1/2 place-items-center rounded-full transition-all duration-200 ${checked ? "left-[22px] h-6 w-6 bg-on-primary text-[11px] text-primary" : "left-[6px] h-4 w-4 bg-outline"}`}
          aria-hidden
        >
          {checked ? "✓" : ""}
        </span>
      </button>
      <span>{label}</span>
    </label>
  );
}

const SUPPLIER_COLORS = ["#315BD0", "#167757", "#B45309", "#7C3AED", "#BE185D", "#0E7490", "#4D7C0F", "#9333EA", "#C2410C"];
/** A steady color per supplier, for storefront avatars. */
export function supplierColor(id: string) {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return SUPPLIER_COLORS[h % SUPPLIER_COLORS.length];
}
