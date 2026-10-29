"use client";

import Link from "next/link";
import type { Source, Supplier } from "@/lib/types";

export const money = (n: number, cents = true) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: cents ? 2 : 0, maximumFractionDigits: cents ? 2 : 0 });

export const compact = (n: number) =>
  n >= 1_000_000 ? `$${(n / 1_000_000).toFixed(2)}M` : n >= 1000 ? `$${Math.round(n / 1000)}K` : money(n, false);

const SOURCE_STYLE: Record<Source, { label: string; cls: string }> = {
  own_contract: { label: "Riverbend contract", cls: "bg-navy text-white" },
  state_contract: { label: "State contract", cls: "bg-steel/25 text-navy" },
  coop_contract: { label: "Co-op contract", cls: "bg-maroon-50 text-maroon" },
  reseller: { label: "Reseller", cls: "bg-tint text-navy border border-steel/40" },
  gsa: { label: "GSA schedule", cls: "bg-navy-50 text-navy-600" },
  no_approval: { label: "No approval needed", cls: "bg-emerald-50 text-emerald-800" },
};

export function SourcePill({ source }: { source: Source }) {
  const s = SOURCE_STYLE[source];
  return <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${s.cls}`}>{s.label}</span>;
}

export const sourceLabel = (s: Source) => SOURCE_STYLE[s].label;

export function Badge({ children, tone = "neutral" }: { children: React.ReactNode; tone?: "neutral" | "maroon" | "navy" | "green" | "amber" }) {
  const cls = {
    neutral: "bg-tint text-slate",
    maroon: "bg-maroon-50 text-maroon",
    navy: "bg-navy-50 text-navy",
    green: "bg-emerald-50 text-emerald-800",
    amber: "bg-amber-50 text-amber-800",
  }[tone];
  return <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-semibold ${cls}`}>{children}</span>;
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

export function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`rounded-lg border border-navy/10 bg-white shadow-card ${className}`}>{children}</div>;
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
    secondary: "border border-navy/20 bg-white text-navy hover:bg-tint disabled:text-steel",
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
    secondary: "border border-navy/20 bg-white text-navy hover:bg-tint",
  }[variant];
  return (
    <Link href={href} className={`inline-flex items-center justify-center gap-1.5 rounded-md px-3.5 py-2 text-sm font-semibold transition-colors ${cls} ${className}`}>
      {children}
    </Link>
  );
}

export function PageTitle({ eyebrow, title, children }: { eyebrow?: string; title: string; children?: React.ReactNode }) {
  return (
    <div className="mb-6">
      {eyebrow && <div className="text-xs font-semibold uppercase tracking-wider text-maroon">{eyebrow}</div>}
      <h1 className="mt-1 text-2xl font-bold text-navy">{title}</h1>
      {children && <div className="mt-1 max-w-3xl text-sm text-slate">{children}</div>}
    </div>
  );
}

export function IconCircle({ children }: { children: React.ReactNode }) {
  return <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-maroon text-sm font-bold text-white">{children}</span>;
}

export function Loading({ label = "Loading" }: { label?: string }) {
  return <div className="py-16 text-center text-sm text-slate">{label}…</div>;
}

export function ErrorNote({ message }: { message: string | null }) {
  if (!message) return null;
  return <div className="rounded-md border border-maroon/30 bg-maroon-50 px-3 py-2 text-sm text-maroon">{message}</div>;
}
