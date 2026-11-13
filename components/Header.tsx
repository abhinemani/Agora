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
  // Appearance: follow the system, or a saved Light or Dark choice (applied early by the script in layout.tsx).
  const [appearance, setAppearance] = useState<"system" | "light" | "dark">("system");
  useEffect(() => {
    try {
      const t = localStorage.getItem("theme");
      if (t === "light" || t === "dark") setAppearance(t);
    } catch {}
  }, []);
  const chooseAppearance = (a: "system" | "light" | "dark") => {
    setAppearance(a);
    try {
      if (a === "system") localStorage.removeItem("theme");
      else localStorage.setItem("theme", a);
    } catch {}
    if (a === "system") delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = a;
  };
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
    <header className={`sticky top-0 z-30 bg-white ${scrolled ? "shadow-1" : ""}`}>
      <div className="border-b border-base-lighter bg-[#000] px-4 py-2 text-center text-ui-3xs text-[#fff]">
        Searching is free for every agency. <span className="hidden sm:inline">Your own contracts come first, then your state's, then your co-ops.</span>
      </div>
      <div className="mx-auto grid h-16 max-w-6xl grid-cols-[1fr_auto_1fr] items-center gap-3 px-4">
        <span aria-hidden />
        <Link href={current.home} className="font-heading text-heading-lg font-light uppercase tracking-[0.3em] text-ink no-underline" aria-label="Agora home">
          Agora
        </Link>

        <div className="flex items-center justify-end gap-3">


        <Link
          href="/cart"
          className="relative flex shrink-0 items-center gap-2 px-2 text-ui-xs text-ink no-underline hover:underline"
          aria-label={`Cart, ${cartCount} item${cartCount === 1 ? "" : "s"}${cartWaiting ? `, ${cartWaiting} waiting on approval` : ""}`}
        >
          <span className="relative">
            <Cart className="h-6 w-6" />
            {cartCount > 0 && (
              <span key={cartCount} className="cart-bump absolute -right-2 -top-1.5 grid h-4 min-w-4 place-items-center rounded-full bg-ink px-1 text-ui-3xs font-bold tabular-nums text-white">
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
            className="flex h-10 items-center gap-2 py-1 pl-1 pr-2 text-ui-xs text-ink hover:underline"
          >
            <span className="relative grid h-8 w-8 place-items-center rounded-sm bg-primary-lighter text-ui-2xs font-bold text-primary-darker">
              {current.initials}
              {fresh > 0 && <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full border-2 border-white bg-secondary" aria-label={`${fresh} new revenue events`} />}
            </span>
            <span className="hidden sm:inline">{current.label}</span>
            <Menu className="h-5 w-5 text-base-dark" />
          </button>

          {open && (
            <div role="menu" className="absolute right-0 top-full mt-1 w-72 overflow-hidden border border-base-lighter bg-white py-2 text-ink shadow-3">
              <div className="px-4 pb-1 pt-2 text-ui-3xs uppercase tracking-label text-base-dark">View the demo as</div>
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
                  className={`flex min-h-12 w-full items-center gap-3 px-4 py-2 text-left hover:bg-base-lightest ${role === r.id ? "bg-base-lightest" : ""}`}
                >
                  <span className={`grid h-8 w-8 place-items-center rounded-sm text-ui-2xs font-bold ${role === r.id ? "bg-ink text-white" : "bg-base-lighter text-ink"}`}>
                    {r.initials}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-ui-xs font-bold">{r.label}</span>
                    <span className="block truncate text-ui-3xs text-base-dark">{r.person}</span>
                  </span>
                </button>
              ))}
              <div className="mt-2 border-t border-base-lighter pt-2">
                <button
                  role="menuitem"
                  onClick={() => {
                    setOpen(false);
                    setPicking(true);
                  }}
                  className="flex min-h-12 w-full items-center justify-between gap-3 px-4 py-2 text-left text-ui-xs text-ink hover:bg-base-lightest"
                >
                  Your agency
                  <span className="truncate text-ui-3xs text-base-dark">{buyer ? `${buyer.name}, ${buyer.state}` : "Any agency"}</span>
                </button>
                <button
                  role="menuitem"
                  onClick={() => {
                    setOpen(false);
                    setLedgerOpen(true);
                  }}
                  className="flex min-h-12 w-full items-center justify-between px-4 py-2 text-ui-xs text-ink hover:bg-base-lightest"
                >
                  Sovra revenue
                  <span className="tabular-nums text-base-dark">{compact(total)}</span>
                </button>
                <Link role="menuitem" href="/model" onClick={() => setOpen(false)} className="flex min-h-12 items-center px-4 text-ui-xs text-ink no-underline hover:bg-base-lightest">
                  How Agora earns
                </Link>
                <Link role="menuitem" href="/coops" onClick={() => setOpen(false)} className="flex min-h-12 items-center px-4 text-ui-xs text-ink no-underline hover:bg-base-lightest">
                  Co-op member lists
                </Link>
                <div className="flex min-h-12 items-center justify-between gap-3 px-4 text-ui-xs text-ink">
                  <span>Appearance</span>
                  <span className="flex" role="radiogroup" aria-label="Appearance">
                    {(["system", "light", "dark"] as const).map((a, i) => (
                      <button
                        key={a}
                        role="radio"
                        aria-checked={appearance === a}
                        onClick={() => chooseAppearance(a)}
                        className={`px-2.5 py-1 text-ui-3xs capitalize ${i ? "-ml-px" : ""} border ${appearance === a ? "relative z-10 border-ink bg-ink text-white" : "border-base-light text-ink hover:bg-base-lightest"}`}
                      >
                        {a}
                      </button>
                    ))}
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>
        </div>
      </div>
      <div className="border-b border-base-lighter">
        <nav className="mx-auto flex max-w-6xl justify-center gap-2 overflow-x-auto px-4 sm:gap-6" aria-label="Main">
          {NAV[role].map((n) => (
            <Link
              key={n.href}
              href={n.href}
              aria-current={isActive(n.href) ? "page" : undefined}
              className={`shrink-0 border-b-2 px-1 py-3 text-ui-xs no-underline hover:border-ink ${isActive(n.href) ? "border-ink text-ink" : "border-transparent text-base-darker"}`}
            >
              {n.label}
            </Link>
          ))}
        </nav>
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
