"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { Role } from "@/lib/types";
import { BuyerPicker } from "./BuyerPicker";
import { Menu } from "./icons";
import { useStore } from "./store";
import { compact } from "./ui";

const ROLES: { id: Role; label: string; person: string; initials: string; home: string }[] = [
  { id: "buyer", label: "Buyer", person: "Agency staff searching for what they need", initials: "B", home: "/" },
  { id: "procurement", label: "Procurement", person: "Marcus Reyes, City of Riverbend purchasing", initials: "MR", home: "/procurement" },
  { id: "supplier", label: "Supplier", person: "Ana Ruiz, Riverside Office Supply", initials: "AR", home: "/supplier" },
];

const NAV: Record<Role, { href: string; label: string }[]> = {
  buyer: [
    { href: "/", label: "Search" },
    { href: "/browse", label: "Browse" },
    { href: "/storefronts", label: "Storefronts" },
    { href: "/vehicles", label: "Contracts" },
    { href: "/requests", label: "Requests" },
  ],
  procurement: [
    { href: "/procurement", label: "Approvals" },
    { href: "/procurement/spend", label: "Spend" },
    { href: "/solicitations", label: "Solicitations" },
    { href: "/vehicles", label: "Contracts" },
  ],
  supplier: [
    { href: "/supplier", label: "Profile" },
    { href: "/supplier?tab=contracts", label: "Contracts" },
    { href: "/contracts/upload?as=supplier", label: "Upload" },
  ],
};

export function Header() {
  const { db, role, setRole, setLedgerOpen, fresh } = useStore();
  const router = useRouter();
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const [picking, setPicking] = useState(false);
  const buyer = db?.session.buyer;
  const menu = useRef<HTMLDivElement>(null);
  const total = db?.revenue.reduce((n, e) => n + e.amount, 0) ?? 0;
  const current = ROLES.find((r) => r.id === role)!;
  const isActive = (href: string) => {
    const base = href.split("?")[0];
    return base === "/" ? path === "/" : path === base && !href.includes("?");
  };

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => menu.current && !menu.current.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  return (
    <header className="sticky top-0 z-30 border-b border-line bg-white/90 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-3 px-4 sm:gap-8">
        <Link href={current.home} className="flex items-center gap-2" aria-label="Agora home">
          <span className="grid h-9 w-9 place-items-center rounded-[10px] bg-navy text-lg font-semibold text-white">α</span>
          <span className="hidden text-[22px] font-bold tracking-[-0.04em] text-navy sm:block">
            ago<span className="text-maroon">ra</span>
          </span>
        </Link>

        <nav className="flex min-w-0 items-center gap-0.5 overflow-x-auto text-sm sm:gap-1">
          {NAV[role].map((n) => (
            <Link
              key={n.href}
              href={n.href}
              className={`shrink-0 rounded-md px-2 py-1.5 transition-colors sm:px-3 ${isActive(n.href) ? "bg-[#EDF1F7] font-semibold text-navy" : "text-slate hover:text-navy"}`}
            >
              {n.label}
            </Link>
          ))}
        </nav>

        <div ref={menu} className="relative ml-auto shrink-0">
          <button
            onClick={() => setOpen(!open)}
            aria-expanded={open}
            aria-haspopup="menu"
            className="flex items-center gap-2 rounded-full border border-line py-1 pl-1 pr-2.5 text-sm text-navy hover:border-navy/30"
          >
            <span className="relative grid h-7 w-7 place-items-center rounded-full bg-maroon text-[11px] font-semibold text-white">
              {current.initials}
              {fresh > 0 && <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full border-2 border-white bg-rose" aria-label={`${fresh} new revenue events`} />}
            </span>
            <span className="hidden sm:inline">{current.label}</span>
            <Menu className="h-4 w-4 text-slate" />
          </button>

          {open && (
            <div role="menu" className="absolute right-0 mt-2 w-72 overflow-hidden rounded-xl border border-line bg-white shadow-[0_12px_32px_-12px_rgba(20,33,61,0.25)]">
              <div className="px-4 pb-2 pt-3 text-xs text-slate">View the demo as</div>
              {ROLES.map((r) => (
                <button
                  key={r.id}
                  role="menuitemradio"
                  aria-checked={role === r.id}
                  onClick={() => {
                    setRole(r.id);
                    setOpen(false);
                    router.push(r.home);
                  }}
                  className={`flex w-full items-center gap-3 px-4 py-2 text-left hover:bg-page ${role === r.id ? "bg-page" : ""}`}
                >
                  <span className={`grid h-7 w-7 place-items-center rounded-full text-[11px] font-semibold ${role === r.id ? "bg-maroon text-white" : "bg-[#EDF1F7] text-navy"}`}>
                    {r.initials}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold text-navy">{r.label}</span>
                    <span className="block truncate text-xs text-slate">{r.person}</span>
                  </span>
                </button>
              ))}
              <div className="mt-2 border-t border-line py-1">
                <button
                  role="menuitem"
                  onClick={() => {
                    setOpen(false);
                    setPicking(true);
                  }}
                  className="flex w-full items-center justify-between gap-3 px-4 py-2 text-left text-sm text-navy hover:bg-page"
                >
                  Your agency
                  <span className="truncate text-xs text-slate">{buyer ? `${buyer.name}, ${buyer.state}` : "Any agency"}</span>
                </button>
                <button
                  role="menuitem"
                  onClick={() => {
                    setOpen(false);
                    setLedgerOpen(true);
                  }}
                  className="flex w-full items-center justify-between px-4 py-2 text-sm text-navy hover:bg-page"
                >
                  Sovra revenue
                  <span className="font-semibold tabular-nums">{compact(total)}</span>
                </button>
                <Link role="menuitem" href="/model" onClick={() => setOpen(false)} className="block px-4 py-2 text-sm text-navy hover:bg-page">
                  How the storefront earns
                </Link>
              </div>
            </div>
          )}
        </div>
      </div>
      {picking && (
        <div className="border-t border-line bg-page py-4">
          <div className="mx-auto max-w-6xl px-4">
            <BuyerPicker onDone={() => setPicking(false)} onClose={() => setPicking(false)} />
          </div>
        </div>
      )}
    </header>
  );
}
