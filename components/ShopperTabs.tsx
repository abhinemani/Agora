import Link from "next/link";
import { Mark } from "./blueprint";

const TABS = [
  { id: "dive", href: "/dive", label: "Find a product" },
  { id: "quote", href: "/quote-check", label: "Check a quote" },
  { id: "ask", href: "/ask", label: "Ask a contract" },
] as const;

/** The header shared by the shopper's three tools. */
export function ShopperTabs({ active, title, lead, working = false }: { active: (typeof TABS)[number]["id"]; title: string; lead: string; working?: boolean }) {
  return (
    <div className="border border-primary-darker bg-white">
      <div className="flex flex-wrap items-center gap-3 bg-[#0F3D73] px-5 py-4 [background-image:linear-gradient(rgba(255,255,255,0.06)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.06)_1px,transparent_1px)] [background-size:16px_16px]">
        <Mark className="h-8 w-8" onDark working={working} />
        <div className="min-w-0 flex-1">
          <div className="font-mono text-[11px] uppercase tracking-[0.14em] text-[#BFD5EE]">Your personal shopper</div>
          <h1 className="font-heading text-xl font-bold text-white">{title}</h1>
        </div>
      </div>
      <nav aria-label="Shopper tools" className="flex flex-wrap border-b border-base-lighter">
        {TABS.map((t) => (
          <Link
            key={t.id}
            href={t.href}
            aria-current={t.id === active ? "page" : undefined}
            className={`flex min-h-[44px] items-center border-b-2 px-5 text-ui-xs font-bold no-underline ${t.id === active ? "border-primary text-primary" : "border-transparent text-base-darker hover:text-primary"}`}
          >
            {t.label}
          </Link>
        ))}
      </nav>
      <p className="max-w-[80ch] px-5 py-3 text-sm text-base-darker">{lead}</p>
    </div>
  );
}
