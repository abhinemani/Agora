import { NextResponse } from "next/server";
import { withSession } from "@/lib/session";
import { currentScope, getDb, hasApiKey } from "@/lib/db";
import type { Db, OpsSummary } from "@/lib/types";
import { isAdmin } from "@/lib/admin";
import { cartOwner } from "@/lib/orders";

export const dynamic = "force-dynamic";

/** Sovra ops traffic per co-op, as counts: the raw clicks, impressions and referrals name the agency behind each search. */
function opsSummary(db: Db, home: string): OpsSummary {
  const by_coop: OpsSummary["by_coop"] = {};
  const of = (coop: string | null) => (coop ? (by_coop[coop] ??= { clicks: 0, shown: 0, referred: 0 }) : null);
  for (const k of db.clicks) { const c = of(k.coop_id); if (c) c.clicks++; }
  for (const i of db.impressions) { const c = of(i.coop_id); if (c) c.shown++; }
  for (const r of db.referrals) { const c = of(r.coop_id); if (c) c.referred++; }
  const recent_clicks = db.clicks.slice(0, 20).map((k) => ({ ...k, buyer_name: k.buyer_name && k.buyer_name !== home ? "Another agency" : k.buyer_name }));
  return { by_coop, recent_clicks };
}

export const GET = withSession(
  () => {
  const db = getDb();
  // An agency's contract register is private to that agency: other agencies' rows never leave the server.
  const me = db.session.buyer?.name;
  const contracts = db.contracts.filter((c) => !c.register_of || c.register_of === me);
  // A person's searches are theirs: an account sees its own, a browser without one sees what it made.
  const s = currentScope();
  const mine = new Set([s?.user?.id, s?.visitor ? `v:${s.visitor}` : undefined].filter(Boolean));
  const requests = db.requests.filter((r) => !r.owner || mine.has(r.owner));
  // An agency's buying activity is its own. A visitor who hasn't picked an agency is in the demo agency, Riverbend,
  // which is also where seed records without an agency belong (lib/orders.ts cartAgency falls back the same way).
  const home = me ?? db.agency.name;
  const admin = isAdmin(s?.user);
  const ours = (agency: string | null | undefined) => (agency ?? db.agency.name) === home;
  const scoped: Partial<Db> = {
    invites: db.invites.filter((i) => ours(i.agency)),
    // A draft cart is its owner's alone. Submitted carts are the agency's, for its signed-in people.
    carts: db.carts.filter((c) => (c.status === "draft" ? mine.has(cartOwner(c)) : Boolean(s?.user) && ours(c.agency))),
    orders: db.orders.filter((o) => ours(o.agency)),
    quotes: db.quotes.filter((q) => ours(q.buyer?.name)),
    handoffs: db.handoffs.filter((h) => ours(h.agency)),
    referrals: db.referrals.filter((r) => ours(r.agency)),
    // A claimant's email is theirs and Sovra's: other visitors see the claim without it.
    suppliers: db.suppliers.map((x) => (x.claim && !(admin || (s?.user && x.claim.user_id === s.user.id)) ? { ...x, claim: { ...x.claim, email: "" } } : x)),
    // Counted in `ops` instead.
    clicks: [],
    impressions: [],
  };
  const user = s?.user ? { id: s.user.id, name: s.user.name, email: s.user.email, role: s.user.role, verified: s.user.verified, admin } : null;
  return NextResponse.json({ db: { ...db, contracts, requests, ...scoped }, ops: opsSummary(db, home), llm: hasApiKey(), user });
  },
  { readOnly: true },
);
