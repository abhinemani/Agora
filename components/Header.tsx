"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { Role } from "@/lib/types";
import { useStore } from "./store";
import { compact } from "./ui";

const ROLES: { id: Role; label: string; who: string; initials: string; home: string }[] = [
  { id: "buyer", label: "Buyer", who: "Dana Whitfield · Parks and Recreation", initials: "DW", home: "/" },
  { id: "procurement", label: "Procurement", who: "Marcus Reyes · Purchasing Manager", initials: "MR", home: "/procurement" },
  { id: "supplier", label: "Supplier", who: "Ana Ruiz · Riverside Office Supply", initials: "AR", home: "/supplier" },
];

const NAV: Record<Role, { href: string; label: string }[]> = {
  buyer: [
    { href: "/", label: "Storefront" },
    { href: "/browse", label: "Browse" },
    { href: "/requests", label: "My requests" },
    { href: "/solicitations", label: "Solicitations" },
  ],
  procurement: [
    { href: "/procurement", label: "Home" },
    { href: "/procurement/spend", label: "Spend" },
    { href: "/solicitations", label: "Solicitations" },
    { href: "/contracts/upload?as=procurement", label: "Add contract" },
  ],
  supplier: [
    { href: "/supplier", label: "Profile" },
    { href: "/supplier?tab=contracts", label: "Contracts" },
    { href: "/contracts/upload?as=supplier", label: "Upload a contract" },
  ],
};

export function Header() {
  const { db, role, setRole, setLedgerOpen, fresh, llm, showEarn, setShowEarn } = useStore();
  const router = useRouter();
  const path = usePathname();
  const total = db?.revenue.reduce((n, e) => n + e.amount, 0) ?? 0;
  const current = ROLES.find((r) => r.id === role)!;
  const isActive = (href: string) => {
    const base = href.split("?")[0];
    return base === "/" ? path === "/" : path === base && !href.includes("?");
  };

  return (
    <header className="sticky top-0 z-30 bg-navy text-white shadow-[0_1px_0_rgba(255,255,255,0.06)]">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
        <Link href={current.home} className="flex items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-maroon text-sm font-bold ring-2 ring-white/10">R</span>
          <span className="leading-tight">
            <span className="block text-[15px] font-semibold tracking-tight">Riverbend Storefront</span>
            <span className="block text-[10px] font-semibold uppercase tracking-[0.18em] text-rose">Powered by Sovra</span>
          </span>
        </Link>

        <nav className="flex flex-wrap items-center gap-0.5 text-sm">
          {NAV[role].map((n) => (
            <Link key={n.href} href={n.href} className={`rounded-md px-3 py-1.5 transition-colors ${isActive(n.href) ? "bg-white/10 text-white" : "text-steel hover:text-white"}`}>
              {n.label}
            </Link>
          ))}
          <Link href="/model" className={`rounded-md px-3 py-1.5 transition-colors ${path === "/model" ? "bg-white/10 text-white" : "text-rose hover:text-white"}`}>
            How it earns
          </Link>
        </nav>

        <div className="ml-auto flex items-center gap-3">
          <div className="flex items-center rounded-lg bg-white/[0.07] p-0.5" role="group" aria-label="Switch role">
            {ROLES.map((r) => (
              <button
                key={r.id}
                onClick={() => {
                  setRole(r.id);
                  router.push(r.home);
                }}
                title={r.who}
                className={`rounded-md px-3 py-1 text-xs font-semibold transition-colors ${role === r.id ? "bg-white text-navy" : "text-steel hover:text-white"}`}
              >
                {r.label}
              </button>
            ))}
          </div>
          <button
            onClick={() => setLedgerOpen(true)}
            className="relative flex items-center gap-2 rounded-lg border border-rose/50 bg-white/[0.03] px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-white/10"
          >
            <span className="text-rose">Sovra revenue</span>
            <span className="tabular-nums">{compact(total)}</span>
            {fresh > 0 && (
              <span className="absolute -right-2 -top-2 flex h-5 min-w-5 animate-pulse items-center justify-center rounded-full bg-rose px-1 text-[10px] text-white">+{fresh}</span>
            )}
          </button>
        </div>
      </div>
      <div className="border-t border-white/[0.06] bg-[#0f1a31]">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-4 gap-y-1 px-4 py-1.5 text-[11px] text-steel">
          <span className="flex items-center gap-2">
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-steel/25 text-[9px] font-bold text-white">{current.initials}</span>
            Signed in as {current.who}
          </span>
          <span className="ml-auto flex items-center gap-4">
            {!llm && (
              <span title="No ANTHROPIC_API_KEY set: request and contract parsing use offline heuristics" className="uppercase tracking-wider">
                Offline parsing
              </span>
            )}
            <label className="flex cursor-pointer items-center gap-2">
              <span className="flex h-4 w-4 items-center justify-center rounded-full bg-maroon text-[8px] font-bold text-white">3</span>
              Show how Sovra earns
              <button
                role="switch"
                aria-checked={showEarn}
                onClick={() => setShowEarn(!showEarn)}
                className={`relative h-4 w-7 rounded-full transition ${showEarn ? "bg-rose" : "bg-steel/40"}`}
              >
                <span className={`absolute top-0.5 h-3 w-3 rounded-full bg-white transition-all ${showEarn ? "left-3.5" : "left-0.5"}`} />
              </button>
            </label>
          </span>
        </div>
      </div>
    </header>
  );
}
