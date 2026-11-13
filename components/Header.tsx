"use client";

import Link from "next/link";
import { cartAgency, draftCart } from "@/lib/orders";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { Role } from "@/lib/types";
import { BuyerPicker } from "./BuyerPicker";
import { Menu, Cart } from "./icons";
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
    { href: "/marketplaces", label: "For cities" },
  ],
  procurement: [
    { href: "/procurement", label: "Approvals" },
    { href: "/procurement/orders", label: "Orders" },
    { href: "/procurement/setup", label: "Setup" },
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
  // A light shadow under the header once content scrolls beneath it.
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 4);
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);
  const buyer = db?.session.buyer;
  const menu = useRef<HTMLDivElement>(null);
  const total = db?.revenue.reduce((n, e) => n + e.amount, 0) ?? 0;
  const cart = db ? draftCart(db) : undefined;
  const cartCount = cart?.lines.reduce((n, l) => n + 1, 0) ?? 0;
  const cartWaiting = db ? db.carts.filter((c) => c.agency === cartAgency(db) && c.status === "pending").length : 0;
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
    <header className={`sticky top-0 z-30 border-b border-base-lighter bg-white ${scrolled ? "shadow-1" : ""}`}>
      <div className="mx-auto flex h-16 max-w-6xl items-stretch gap-3 px-4 sm:gap-8">
        <Link href={current.home} className="flex items-center gap-2 no-underline" aria-label="Agora home">
          <span className="grid h-9 w-9 place-items-center rounded-md bg-primary-darker font-heading text-heading-md font-bold text-white">α</span>
          <span className="hidden font-heading text-heading-md font-bold text-ink sm:block">Agora</span>
        </Link>

        <nav className="flex min-w-0 items-stretch gap-1 overflow-x-auto">
          {NAV[role].map((n) => (
            <Link
              key={n.href}
              href={n.href}
              aria-current={isActive(n.href) ? "page" : undefined}
              className={`flex shrink-0 items-center border-b-4 px-2 pt-1 text-ui-xs font-bold no-underline hover:text-primary sm:px-3 ${isActive(n.href) ? "border-primary text-primary" : "border-transparent text-base-dark"}`}
            >
              {n.label}
            </Link>
          ))}
        </nav>

        <Link
          href="/cart"
          className="relative ml-auto flex shrink-0 items-center gap-2 px-2 text-ui-xs font-bold text-base-dark no-underline hover:text-primary"
          aria-label={`Cart, ${cartCount} item${cartCount === 1 ? "" : "s"}${cartWaiting ? `, ${cartWaiting} waiting on approval` : ""}`}
        >
          <span className="relative">
            <Cart className="h-6 w-6" />
            {cartCount > 0 && (
              <span key={cartCount} className="cart-bump absolute -right-2 -top-1.5 grid h-4 min-w-4 place-items-center rounded-full bg-secondary px-1 text-ui-3xs font-bold tabular-nums text-white">
                {cartCount}
              </span>
            )}
            {cartWaiting > 0 && !cartCount && <span className="absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full bg-secondary" aria-hidden />}
          </span>
          <span className="hidden sm:inline">Cart</span>
        </Link>

        <div ref={menu} className="relative flex shrink-0 items-center">
          <button
            onClick={() => setOpen(!open)}
            aria-expanded={open}
            aria-haspopup="menu"
            className="flex h-10 items-center gap-2 rounded-md py-1 pl-1 pr-2 text-ui-xs font-bold text-ink shadow-[inset_0_0_0_1px_theme(colors.base.light)] hover:shadow-[inset_0_0_0_1px_theme(colors.base.dark)]"
          >
            <span className="relative grid h-8 w-8 place-items-center rounded-sm bg-primary-lighter text-ui-2xs font-bold text-primary-darker">
              {current.initials}
              {fresh > 0 && <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full border-2 border-white bg-secondary" aria-label={`${fresh} new revenue events`} />}
            </span>
            <span className="hidden sm:inline">{current.label}</span>
            <Menu className="h-5 w-5 text-base-dark" />
          </button>

          {open && (
            <div role="menu" className="absolute right-0 top-full mt-1 w-72 overflow-hidden bg-primary-darker py-2 text-white shadow-3">
              <div className="px-4 pb-1 pt-2 text-ui-3xs font-bold text-primary-light">View the demo as</div>
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
                  className={`flex min-h-12 w-full items-center gap-3 px-4 py-2 text-left hover:bg-primary-dark ${role === r.id ? "bg-primary-dark" : ""}`}
                >
                  <span className={`grid h-8 w-8 place-items-center rounded-sm text-ui-2xs font-bold ${role === r.id ? "bg-white text-primary-darker" : "bg-primary-lighter text-primary-darker"}`}>
                    {r.initials}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-ui-xs font-bold">{r.label}</span>
                    <span className="block truncate text-ui-3xs text-base-lighter">{r.person}</span>
                  </span>
                </button>
              ))}
              <div className="mt-2 border-t border-primary-dark pt-2">
                <button
                  role="menuitem"
                  onClick={() => {
                    setOpen(false);
                    setPicking(true);
                  }}
                  className="flex min-h-12 w-full items-center justify-between gap-3 px-4 py-2 text-left text-ui-xs font-bold text-white hover:bg-primary-dark"
                >
                  Your agency
                  <span className="truncate text-ui-3xs text-base-lighter">{buyer ? `${buyer.name}, ${buyer.state}` : "Any agency"}</span>
                </button>
                <button
                  role="menuitem"
                  onClick={() => {
                    setOpen(false);
                    setLedgerOpen(true);
                  }}
                  className="flex min-h-12 w-full items-center justify-between px-4 py-2 text-ui-xs font-bold text-white hover:bg-primary-dark"
                >
                  Sovra revenue
                  <span className="tabular-nums text-base-lighter">{compact(total)}</span>
                </button>
                <Link role="menuitem" href="/model" onClick={() => setOpen(false)} className="flex min-h-12 items-center px-4 text-ui-xs font-bold text-white no-underline hover:bg-primary-dark">
                  How Agora earns
                </Link>
                <Link role="menuitem" href="/coops" onClick={() => setOpen(false)} className="flex min-h-12 items-center px-4 text-ui-xs font-bold text-white no-underline hover:bg-primary-dark">
                  Co-op member lists
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
