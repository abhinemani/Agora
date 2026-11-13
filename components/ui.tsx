"use client";

import Link from "next/link";
import { EDGE_TIER, REVENUE_OPTIONS } from "@/lib/revenue_rules";
import { isTrx, TRX_STATES } from "@/lib/trx";
import type { Source, Supplier } from "@/lib/types";
import us from "@/lib/uswds-theme.json";
import { useStore } from "./store";
import { VerifyBadge } from "./Verification";

export const money = (n: number, cents = true) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: cents ? 2 : 0, maximumFractionDigits: cents ? 2 : 0 });

export const compact = (n: number) =>
  n >= 1_000_000 ? `$${(n / 1_000_000).toFixed(2)}M` : n >= 1000 ? `$${Math.round(n / 1000)}K` : money(n, false);

const SOURCE_STYLE: Record<Source, { label: string; cls: string; dot: string }> = {
  own_contract: { label: "Agency contract", cls: "bg-src-own-lighter text-src-own-darker", dot: "bg-src-own" },
  state_contract: { label: "State contract", cls: "bg-src-state-lighter text-src-state-darker", dot: "bg-src-state" },
  coop_contract: { label: "Co-op contract", cls: "bg-src-coop-lighter text-src-coop-darker", dot: "bg-src-coop" },
  reseller: { label: "Reseller", cls: "bg-src-other-lighter text-src-other-darker", dot: "bg-src-other" },
  gsa: { label: "GSA schedule", cls: "bg-src-other-lighter text-src-other-darker", dot: "bg-src-other" },
  no_approval: { label: "No approval needed", cls: "bg-src-small-lighter text-src-small-darker", dot: "bg-src-small" },
};

/** The route colors (USWDS system colors), for the route strip. */
export const SOURCE_HEX: Record<Source, string> = {
  own_contract: us.color.routes["src-own"].DEFAULT,
  state_contract: us.color.routes["src-state"].DEFAULT,
  coop_contract: us.color.routes["src-coop"].DEFAULT,
  reseller: us.color.routes["src-other"].DEFAULT,
  gsa: us.color.routes["src-other"].DEFAULT,
  no_approval: us.color.routes["src-small"].DEFAULT,
};

/** Where a listing is bought, as a USWDS tag in that route's color. State contracts in TRX states get their label. */
export function SourcePill({ source, contractId }: { source: Source; contractId?: string | null }) {
  const s = SOURCE_STYLE[source];
  const { db } = useStore();
  const trx = source === "state_contract" && contractId ? isTrx(db?.contracts.find((c) => c.id === contractId)) : false;
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-sm px-2 py-0.5 text-ui-3xs font-bold ${s.cls}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} aria-hidden />
      {s.label}
      {trx && (
        <span className="-mr-1 rounded-sm bg-white/70 px-1 text-ui-3xs font-bold" title={`A state contract on the TRX program (${TRX_STATES.join(", ")}), which Sovra supports`}>
          TRX
        </span>
      )}
    </span>
  );
}

export const sourceLabel = (s: Source) => SOURCE_STYLE[s].label;

/** A USWDS tag. Neutral is base-lighter; tones pair a "lighter" background with "darker" text. */
export function Badge({ children, tone = "neutral" }: { children: React.ReactNode; tone?: "neutral" | "maroon" | "navy" | "green" | "amber" }) {
  const cls = {
    neutral: "bg-base-lighter text-ink",
    maroon: "bg-primary-lighter text-primary-darker",
    navy: "bg-base-lighter text-base-darker",
    green: "bg-success-lighter text-success-darker",
    amber: "bg-warning-lighter text-ink",
  }[tone];
  return <span className={`inline-flex items-center rounded-sm px-2 py-0.5 text-ui-3xs font-bold ${cls}`}>{children}</span>;
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

/** USWDS card container, in Agora's theme: a hairline base-lighter border, square corners. */
export function Card({ children, className = "", accent }: { children: React.ReactNode; className?: string; accent?: "rose" | "steel" | "navy" | "maroon" }) {
  void accent; // kept in the signature for callers
  return <div className={`rounded-lg border border-base-lighter bg-white ${className}`}>{children}</div>;
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
          className={`inline-flex items-center justify-center rounded-full bg-primary-darker px-1 text-ui-3xs font-bold text-white ring-2 ring-white ${dim}`}
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

/** USWDS buttons (usa-button): primary is the default; "secondary" and "tonal" are
 * usa-button--outline; "ghost" is usa-button--unstyled. Medium (4px) corners, bold UI
 * type, darker on hover and darker still when pressed. */
const BUTTON: Record<ButtonVariant, string> = {
  primary: "bg-primary px-5 py-3 text-white hover:bg-base-darker active:bg-primary-dark disabled:bg-disabled-lighter disabled:text-disabled-dark",
  maroon: "bg-primary px-5 py-3 text-white hover:bg-base-darker active:bg-primary-dark disabled:bg-disabled-lighter disabled:text-disabled-dark",
  tonal: "bg-white px-5 py-3 text-primary shadow-[inset_0_0_0_1px_theme(colors.primary.DEFAULT)] hover:text-primary-dark hover:bg-base-lightest active:text-primary-darker disabled:text-disabled disabled:shadow-[inset_0_0_0_2px_theme(colors.disabled.lighter)]",
  secondary: "bg-white px-5 py-3 text-primary shadow-[inset_0_0_0_1px_theme(colors.primary.DEFAULT)] hover:text-primary-dark hover:bg-base-lightest active:text-primary-darker disabled:text-disabled disabled:shadow-[inset_0_0_0_2px_theme(colors.disabled.lighter)]",
  ghost: "p-0 text-primary underline hover:text-primary-dark active:text-primary-darker disabled:text-disabled",
};
const BUTTON_BASE = "inline-flex items-center justify-center gap-2 rounded-md text-ui-xs font-bold leading-none transition-colors disabled:cursor-not-allowed";

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
    <Link href={href} className={`${BUTTON_BASE} ${BUTTON[variant]} no-underline ${className}`}>
      {children}
    </Link>
  );
}

/** Page header: a USWDS heading in Merriweather with an intro paragraph. */
export function PageTitle({ eyebrow, title, children }: { eyebrow?: string; title: string; children?: React.ReactNode }) {
  void eyebrow;
  return (
    <div className="mb-8">
      <h1 className="font-heading text-heading-xl font-light text-ink">{title}</h1>
      {children && <div className="mt-3 max-w-[68ex] text-body-md text-base-darker">{children}</div>}
    </div>
  );
}

export function IconCircle({ children, size = "md" }: { children: React.ReactNode; size?: "md" | "lg" }) {
  const d = size === "lg" ? "h-12 w-12 [&>svg]:h-6 [&>svg]:w-6" : "h-10 w-10 [&>svg]:h-5 [&>svg]:w-5";
  return <span className={`flex shrink-0 items-center justify-center rounded-full bg-primary-lighter text-primary-darker ${d}`}>{children}</span>;
}

export function SectionLabel({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-3">
      <h2 className="font-heading text-heading-md font-normal text-ink">{children}</h2>
      {right}
    </div>
  );
}

export function Loading({ label = "Loading" }: { label?: string }) {
  return (
    <div className="py-16 text-center text-ui-xs text-base-dark" role="status">
      {label}…
    </div>
  );
}

const ALERT = {
  info: "border-info bg-info-lighter",
  warning: "border-warning bg-warning-lighter",
  error: "border-error bg-error-lighter",
  success: "border-success bg-success-lighter",
};

/** USWDS alert (usa-alert): a tinted box with an 8px left bar in the status color. Slim by default. */
export function Alert({ type = "info", heading, children, action, className = "" }: { type?: keyof typeof ALERT; heading?: React.ReactNode; children?: React.ReactNode; action?: React.ReactNode; className?: string }) {
  return (
    <div role={type === "error" ? "alert" : "status"} className={`flex flex-wrap items-center justify-between gap-3 border-l-8 px-4 py-3 text-ui-xs text-ink ${ALERT[type]} ${className}`}>
      <div className="min-w-0">
        {heading && <div className="font-heading text-heading-sm font-semibold">{heading}</div>}
        {children}
      </div>
      {action}
    </div>
  );
}

export function ErrorNote({ message }: { message: string | null }) {
  if (!message) return null;
  return <Alert type="error">{message}</Alert>;
}

/** USWDS checkbox (usa-checkbox): a 20px box with a 2px ink outline; checked fills primary with a white check. */
export function Checkbox({ checked, onChange, disabled, label }: { checked: boolean; onChange: (on: boolean) => void; disabled?: boolean; label: React.ReactNode }) {
  return (
    <label className={`inline-flex items-start gap-3 text-ui-xs ${disabled ? "cursor-not-allowed text-disabled" : "cursor-pointer text-ink"}`}>
      <input type="checkbox" className="peer sr-only" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span
        aria-hidden
        className={`mt-px grid h-5 w-5 shrink-0 place-items-center rounded-sm text-ui-2xs font-bold text-white peer-focus-visible:outline peer-focus-visible:outline-4 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-focus ${
          disabled ? "bg-disabled-lighter shadow-[0_0_0_2px_theme(colors.disabled.light)]" : checked ? "bg-primary shadow-[0_0_0_2px_theme(colors.primary.DEFAULT)]" : "bg-white shadow-[0_0_0_2px_theme(colors.ink)]"
        }`}
      >
        {checked ? "✓" : ""}
      </span>
      <span>{label}</span>
    </label>
  );
}

const SUPPLIER_COLORS = us.color.avatars;
/** A steady color per supplier, for storefront avatars. */
export function supplierColor(id: string) {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return SUPPLIER_COLORS[h % SUPPLIER_COLORS.length];
}
