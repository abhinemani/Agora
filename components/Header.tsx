"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { Role } from "@/lib/types";
import { useStore } from "./store";
import { compact } from "./ui";

const ROLES: { id: Role; label: string; who: string; home: string }[] = [
  { id: "buyer", label: "Buyer", who: "Dana · Parks and Recreation", home: "/" },
  { id: "procurement", label: "Procurement", who: "Marcus · Purchasing Manager", home: "/procurement" },
  { id: "supplier", label: "Supplier", who: "Riverside Office Supply", home: "/supplier" },
];

const NAV: Record<Role, { href: string; label: string }[]> = {
  buyer: [
    { href: "/", label: "Storefront" },
    { href: "/requests", label: "My requests" },
    { href: "/solicitations", label: "Solicitations" },
  ],
  procurement: [
    { href: "/procurement", label: "Home" },
    { href: "/procurement/spend", label: "Spend intelligence" },
    { href: "/solicitations", label: "Solicitations" },
    { href: "/contracts/upload?as=procurement", label: "Add a contract" },
  ],
  supplier: [
    { href: "/supplier", label: "Profile" },
    { href: "/supplier?tab=contracts", label: "Contracts" },
    { href: "/contracts/upload?as=supplier", label: "Upload a contract" },
  ],
};

export function Header() {
  const { db, role, setRole, setLedgerOpen, fresh, llm } = useStore();
  const router = useRouter();
  const path = usePathname();
  const total = db?.revenue.reduce((n, e) => n + e.amount, 0) ?? 0;
  const current = ROLES.find((r) => r.id === role)!;

  return (
    <header className="sticky top-0 z-30 border-b border-navy/10 bg-navy text-white">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
        <Link href={current.home} className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-maroon text-sm font-bold">R</span>
          <span className="leading-tight">
            <span className="block text-sm font-bold">Riverbend Storefront</span>
            <span className="block text-[11px] text-steel">City of Riverbend · pop. 85,000</span>
          </span>
        </Link>

        <nav className="flex flex-wrap items-center gap-1 text-sm">
          {NAV[role].map((n) => {
            const active = n.href === path || (n.href !== "/" && path.startsWith(n.href.split("?")[0]) && !n.href.includes("?"));
            return (
              <Link key={n.href} href={n.href} className={`rounded px-2.5 py-1.5 ${active ? "bg-white/10 text-white" : "text-steel hover:text-white"}`}>
                {n.label}
              </Link>
            );
          })}
        </nav>

        <div className="ml-auto flex items-center gap-3">
          {!llm && (
            <span className="hidden rounded border border-steel/40 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-steel md:inline" title="No ANTHROPIC_API_KEY set: request and contract parsing use offline heuristics">
              Offline parsing
            </span>
          )}
          <div className="flex items-center rounded-md bg-white/10 p-0.5" role="group" aria-label="Switch role">
            {ROLES.map((r) => (
              <button
                key={r.id}
                onClick={() => {
                  setRole(r.id);
                  router.push(r.home);
                }}
                title={r.who}
                className={`rounded px-2.5 py-1 text-xs font-semibold ${role === r.id ? "bg-white text-navy" : "text-steel hover:text-white"}`}
              >
                {r.label}
              </button>
            ))}
          </div>
          <button
            onClick={() => setLedgerOpen(true)}
            className="relative flex items-center gap-2 rounded-md border border-rose/60 px-3 py-1.5 text-xs font-semibold text-white hover:bg-white/10"
          >
            <span className="text-rose">Sovra revenue (demo)</span>
            <span>{compact(total)}</span>
            {fresh > 0 && (
              <span className="absolute -right-2 -top-2 flex h-5 min-w-5 items-center justify-center rounded-full bg-rose px-1 text-[10px] text-white">+{fresh}</span>
            )}
          </button>
        </div>
      </div>
      <div className="border-t border-white/5 bg-navy-600/60">
        <div className="mx-auto max-w-6xl px-4 py-1 text-[11px] text-steel">Signed in as {current.who}</div>
      </div>
    </header>
  );
}
