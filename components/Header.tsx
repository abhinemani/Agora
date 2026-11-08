"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import type { Role } from "@/lib/types";
import { BuyerPicker } from "./BuyerPicker";
import { useStore } from "./store";
import { compact } from "./ui";

const ROLES: { id: Role; label: string; who: string; home: string }[] = [
  { id: "buyer", label: "Buyer", who: "Dana Whitfield, Parks and Recreation", home: "/" },
  { id: "procurement", label: "Procurement", who: "Marcus Reyes, Purchasing Manager", home: "/procurement" },
  { id: "supplier", label: "Supplier", who: "Ana Ruiz, Riverside Office Supply", home: "/supplier" },
];

const NAV: Record<Role, { href: string; label: string }[]> = {
  buyer: [
    { href: "/", label: "Storefront" },
    { href: "/browse", label: "Browse" },
    { href: "/requests", label: "My requests" },
    { href: "/vehicles", label: "Contracts" },
  ],
  procurement: [
    { href: "/procurement", label: "Home" },
    { href: "/procurement/spend", label: "Spend" },
    { href: "/solicitations", label: "Solicitations" },
    { href: "/vehicles", label: "Contracts" },
    { href: "/contracts/upload?as=procurement", label: "Add contract" },
  ],
  supplier: [
    { href: "/supplier", label: "Profile" },
    { href: "/supplier?tab=contracts", label: "Contracts" },
    { href: "/contracts/upload?as=supplier", label: "Upload a contract" },
  ],
};

export function Header() {
  const { db, role, setRole, setLedgerOpen, fresh } = useStore();
  const router = useRouter();
  const path = usePathname();
  const [picking, setPicking] = useState(false);
  const total = db?.revenue.reduce((n, e) => n + e.amount, 0) ?? 0;
  const current = ROLES.find((r) => r.id === role)!;
  const buyer = db?.session.buyer;
  const isActive = (href: string) => {
    const base = href.split("?")[0];
    return base === "/" ? path === "/" : path === base && !href.includes("?");
  };

  return (
    <header className="sticky top-0 z-30 border-b border-line bg-white/95 backdrop-blur">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
        <Link href={current.home} className="flex items-center gap-2.5">
          <span className="flex h-7 w-7 items-center justify-center rounded-md bg-navy text-xs font-bold text-white">R</span>
          <span className="text-[15px] font-semibold text-navy">Riverbend Storefront</span>
        </Link>

        <nav className="flex flex-wrap items-center gap-4 text-sm">
          {[...NAV[role], { href: "/model", label: "How it earns" }].map((n) => (
            <Link
              key={n.href}
              href={n.href}
              className={`border-b-2 py-1 transition-colors ${isActive(n.href) ? "border-maroon font-semibold text-navy" : "border-transparent text-slate hover:text-navy"}`}
            >
              {n.label}
            </Link>
          ))}
        </nav>

        <div className="flex w-full flex-wrap items-center gap-3 whitespace-nowrap text-sm sm:ml-auto sm:w-auto">
          {role !== "supplier" && (
            <button onClick={() => setPicking(!picking)} className="text-slate hover:text-navy" title="Who's buying decides which contracts you can use">
              {buyer ? (
                <span className="inline-block max-w-[10rem] truncate align-bottom font-semibold text-navy">{buyer.name}</span>
              ) : (
                "Choose who's buying"
              )}
              <span className="ml-1 text-xs">▾</span>
            </button>
          )}
          <div className="flex rounded-md bg-tint p-0.5" role="group" aria-label="Switch role">
            {ROLES.map((r) => (
              <button
                key={r.id}
                onClick={() => {
                  setRole(r.id);
                  router.push(r.home);
                }}
                title={`Signed in as ${r.who}`}
                className={`rounded px-2 py-1 text-xs font-semibold transition-colors ${role === r.id ? "bg-white text-navy shadow-sm" : "text-slate hover:text-navy"}`}
              >
                {r.label}
              </button>
            ))}
          </div>
          <button onClick={() => setLedgerOpen(true)} className="relative text-xs text-slate hover:text-navy" title="Sovra revenue (demo)">
            Revenue <span className="font-semibold tabular-nums text-navy">{compact(total)}</span>
            {fresh > 0 && <span className="absolute -right-3 -top-1.5 h-2 w-2 rounded-full bg-rose" aria-label={`${fresh} new revenue events`} />}
          </button>
        </div>
      </div>
      {picking && (
        <div className="border-t border-line bg-page py-4">
          <div className="mx-auto max-w-6xl px-4">
            <BuyerPicker onDone={() => setPicking(false)} />
          </div>
        </div>
      )}
    </header>
  );
}
