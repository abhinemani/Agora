// Program pages: one page per purchasing program in the co-op catalog (a co-op such as
// Sourcewell, or a state program such as NJSTART), built like a storefront from the
// program's own contracts, suppliers and prices. Server-only: it reads lib/catalog.ts.

import { catalogAccess, catalogIndex, catalogStateRetrieved, catalogRetrieved, type CatalogContract } from "./catalog";
import { isMember } from "./coops";
import { offeringNote } from "./contracts";
import { NY_PREFERRED_STEPS, TRX_PROGRAM, TRX_PROGRAM_BY_NAME, isTrxState, stateLabel } from "./trx";
import type { Db } from "./types";
import { stateName } from "./vehicles";

export type ProgramKind = "state" | "coop";

/** How each program describes itself, in a line, with its site. Everything else on the page is counted from the catalog. */
const ABOUT: Record<string, { tagline: string; website: string }> = {
  state_nj: { tagline: "New Jersey's eProcurement system, where the state's active contracts are posted.", website: "https://www.njstart.gov" },
  state_ny: { tagline: "Centralized contracts that New York's Office of General Services manages for state agencies, local governments, school districts, colleges and other authorized users.", website: "https://ogs.ny.gov/procurement" },
  state_ny_ps: {
    tagline: "New York's preferred sources: Corcraft, NYSID (New York State Industries for the Disabled) and NIBNY (National Industries for the Blind New York). Public buyers must buy from them first when an offering meets the need in form, function and utility.",
    website: "https://ogs.ny.gov/procurement/preferred-sources",
  },
  trx_epc: { tagline: "The marketplace of the Empire State Cooperative Procurement Alliance, where New York counties let cooperative contracts other governments may use.", website: "https://empireprocureconnect.info/empire-procure-connect-home" },
  state_or: { tagline: "Oregon's eProcurement system, where the state's open bids and its active price agreements, called blankets, are posted.", website: "https://oregonbuys.gov" },
  state_hi: { tagline: "The Hawaii State Procurement Office's price & vendor list contracts, for executive agencies and the jurisdictions that commit to take part.", website: "https://spo.hawaii.gov" },
  state_ar: { tagline: "Statewide contracts listed by Arkansas's Department of Shared Administrative Services, many of them adopted from national co-op awards.", website: "https://sas.arkansas.gov/procurement/state-contracts/" },
  coop_sourcewell: { tagline: "A Minnesota service cooperative that bids national contracts for public agencies.", website: "https://www.sourcewell-mn.gov" },
  coop_tips: { tagline: "The Interlocal Purchasing System, a purchasing cooperative run by Region 8 Education Service Center in Texas.", website: "https://www.tips-usa.com" },
  coop_buyboard: { tagline: "The Local Government Purchasing Cooperative, administered by the Texas Association of School Boards.", website: "https://www.buyboard.com" },
  coop_hgacbuy: { tagline: "The cooperative purchasing program of the Houston-Galveston Area Council, a Texas regional council of governments.", website: "https://www.hgacbuy.org" },
  coop_choice: { tagline: "The purchasing cooperative of the Harris County Department of Education in Texas.", website: "https://www.choicepartners.org" },
  coop_omnia: { tagline: "A national cooperative purchasing organization for public agencies.", website: "https://www.omniapartners.com" },
  coop_peppm: { tagline: "A national technology purchasing program run by the Central Susquehanna Intermediate Unit, a Pennsylvania education service agency.", website: "https://www.peppm.org" },
  coop_1gpa: { tagline: "1 Governmental Procurement Alliance, a nonprofit cooperative based in Phoenix, Arizona, whose contracts are let by lead public agencies.", website: "https://1gpa.org" },
  coop_naspo: {
    tagline: "The cooperative arm of the National Association of State Procurement Officials: a lead state bids each contract, and other states join by signing a participating addendum.",
    website: "https://www.naspovaluepoint.org",
  },
  coop_equalis: { tagline: "A national purchasing cooperative for schools, local governments and other public agencies, with Region 10 Education Service Center in Texas among its lead agencies.", website: "https://equalisgroup.org" },
  coop_eandi: { tagline: "A member-owned, nonprofit purchasing cooperative that serves only education: colleges, universities and K-12 schools.", website: "https://www.eandi.org" },
  coop_nppgov: { tagline: "The government division of National Purchasing Partners: a free cooperative for public agencies, with programs for fire and law enforcement.", website: "https://nppgov.com" },
};

export interface ProgramSummary {
  /** The address's slug: "njstart", "sourcewell". */
  slug: string;
  coop_id: string;
  name: string;
  kind: ProgramKind;
  /** A state program in a TRX state: the route Agora prefers for that state's buyers. */
  trx: boolean;
  state: string | null;
  tagline: string;
  website: string | null;
  contracts: number;
  suppliers: number;
  /** Products with a price or a labelled list price on file. */
  products: number;
  /** Contracts open to local governments (state programs), or to public agencies anywhere (co-ops). */
  open_locals: number;
}

export interface ProgramPage extends ProgramSummary {
  retrieved: string;
  /** What /contracts?coop= takes for this program. */
  explorer_id: string;
  data_anchor: string | null;
  /** How a local government buys through it, in order. */
  steps: string[];
  /** Where the visitor's agency stands, when one is set. */
  buyer: { name: string; status: "member" | "open" | "join" | "closed"; text: string; open: number } | null;
  /** Governments Agora places on the co-op, with how it knows (a published roster, or agencies' own pages). */
  roster: { count: number; note: string } | null;
  /** What's on contract, by Agora's categories or, where the program's contracts lack them, by the program's own headings. */
  categories: { name: string; count: number }[];
  group_by: "category" | "heading";
  uncategorized: number;
  top_suppliers: { id: string; name: string; contracts: number; products: number }[];
  products_sample: { product_id: string; name: string; maker: string | null; price: number | null; list: number | null; unit: string | null; note: string; supplier: string; contract_id: string; contract_number: string }[];
  expiring: number;
  priced_contracts: number;
}

export interface ProgramContractRow {
  id: string;
  number: string;
  title: string;
  supplier: string;
  supplier_id: string;
  category: string | null;
  end: string | null;
  priced: number;
  eligible: boolean;
  member: boolean;
  reason: string;
}

const slugify = (name: string) =>
  name
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
const today = () => new Date().toISOString().slice(0, 10);
const current = (c: CatalogContract) => !c.end || c.end >= today();
const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

interface Built {
  summaries: ProgramSummary[];
  bySlug: Map<string, { summary: ProgramSummary; contracts: CatalogContract[] }>;
}

function build(): Built {
  const g = globalThis as unknown as { __agoraPrograms?: Built };
  if (g.__agoraPrograms) return g.__agoraPrograms;
  const idx = catalogIndex();
  const groups = new Map<string, CatalogContract[]>();
  for (const c of idx.contracts) {
    if (!current(c)) continue;
    groups.set(c.coop_id, [...(groups.get(c.coop_id) ?? []), c]);
  }
  const bySlug: Built["bySlug"] = new Map();
  for (const [coopId, contracts] of groups) {
    const name = contracts[0].coop;
    const state = contracts[0].state_contract?.state ?? null;
    const products = new Set<string>();
    for (const c of contracts) for (const o of idx.offeringsByContract.get(c.id) ?? []) if (o.price != null || o.list != null) products.add(o.product);
    const summary: ProgramSummary = {
      slug: slugify(name),
      coop_id: coopId,
      name,
      kind: state ? "state" : "coop",
      trx: isTrxState(state),
      state,
      tagline: ABOUT[coopId]?.tagline ?? (state ? `State contracts from ${stateLabel(state)}.` : "A cooperative purchasing program for public agencies."),
      website: ABOUT[coopId]?.website ?? null,
      contracts: contracts.length,
      suppliers: new Set(contracts.map((c) => c.supplier)).size,
      products: products.size,
      open_locals: contracts.filter((c) => (c.state_contract ? c.state_contract.locals : true)).length,
    };
    bySlug.set(summary.slug, { summary, contracts });
  }
  const summaries = [...bySlug.values()].map((x) => x.summary).sort((a, b) => Number(b.trx) - Number(a.trx) || b.contracts - a.contracts);
  return (g.__agoraPrograms = { summaries, bySlug });
}

export const programSummaries = (): ProgramSummary[] => build().summaries;

/** The slug of a program's page, by its catalog id or name. */
export function programSlug(idOrName: string): string | null {
  const b = build();
  for (const s of b.summaries) if (s.coop_id === idOrName || s.name === idOrName || s.slug === idOrName) return s.slug;
  return null;
}

/** Group a program's contracts by Agora's category when most carry one, else by the first heading the program prints. */
const groupMode = (contracts: CatalogContract[]): "category" | "heading" => (contracts.filter((c) => c.category).length >= contracts.length * 0.3 ? "category" : "heading");
const groupOf = (c: CatalogContract, mode: "category" | "heading"): string | null => {
  if (mode === "category") return c.category ?? null;
  const h = c.categories[0]?.trim();
  return h && h.length <= 60 ? h : null;
};

function find(slug: string) {
  const b = build();
  return b.bySlug.get(slug) ?? [...b.bySlug.values()].find((x) => x.summary.coop_id === slug) ?? null;
}

function stepsFor(s: ProgramSummary): string[] {
  if (s.coop_id === "state_ny_ps") return NY_PREFERRED_STEPS({ supplier: "the preferred source", approval: "approved" });
  if (s.coop_id === "state_hi")
    return [
      "Each price list names its participating jurisdictions. A county or other body that signed the SPO's cooperative agreement and is on a list may order under it, with no further solicitation. Each contract page shows its list.",
      "Order from the contractor under the SPO contract number, by purchasing card or purchase order, as the price list's agency instructions set out.",
    ];
  const trx = TRX_PROGRAM_BY_NAME[s.name] ?? (s.state ? TRX_PROGRAM[s.state] : undefined);
  // The contract page's steps, worded for the program as a whole: "under NJSTART {n}" → "under the NJSTART contract number".
  if (trx)
    return trx
      .steps({ supplier: "", number: "{n}", solicitation: null })
      .map((x) => x.replace(/\b(NJSTART|OregonBuys|SPO|contract)(?: contract)? \{n\}/g, (_, p) => (p === "contract" ? "the contract number" : `the ${p} contract number`)).replace(/\{n\}/g, "the contract number"));
  if (s.coop_id === "coop_naspo")
    return [
      "NASPO ValuePoint contracts reach local governments through their state: a state signs a participating addendum for each award, and its public entities may then buy under it, usually without a bid of their own. Each contract page shows which states have signed.",
      "Read the state's addendum for any limits, then order from the supplier under the master agreement and addendum numbers on your own purchase order.",
    ];
  return [
    `Check that your agency is a member of ${s.name}, or register with it. Most cooperatives let any public agency join; the co-op's site has the terms.`,
    `Confirm that your state's law allows the purchase (Agora shows a State law note beside co-op contracts), read the contract's documents, then order from the supplier under the ${s.name} contract number.`,
  ];
}

export function programPage(db: Db, slug: string): ProgramPage | null {
  const found = find(slug);
  if (!found) return null;
  const { summary, contracts } = found;
  const idx = catalogIndex();
  const buyer = db.session.buyer;

  const mode = groupMode(contracts);
  const cats = new Map<string, number>();
  let uncategorized = 0;
  for (const c of contracts) {
    const k = groupOf(c, mode);
    k ? cats.set(k, (cats.get(k) ?? 0) + 1) : uncategorized++;
  }
  // Headings are the program's own words: keep the ones that gather at least two contracts.
  const categories = [...cats.entries()]
    .filter(([, n]) => mode === "category" || n >= 2)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, mode === "category" ? 30 : 12);

  const perSupplier = new Map<string, { contracts: number; products: Set<string> }>();
  for (const c of contracts) {
    const x = perSupplier.get(c.supplier) ?? { contracts: 0, products: new Set<string>() };
    x.contracts++;
    for (const o of idx.offeringsByContract.get(c.id) ?? []) x.products.add(o.product);
    perSupplier.set(c.supplier, x);
  }
  const top_suppliers = [...perSupplier.entries()]
    .map(([id, x]) => ({ id, name: idx.supplierById.get(id)?.name ?? id, contracts: x.contracts, products: x.products.size }))
    .sort((a, b) => b.contracts - a.contracts || b.products - a.products || a.name.localeCompare(b.name))
    .slice(0, 12);

  // A sample of priced products: one per kind, the commonest kinds first, so the grid shows the range.
  const byKind = new Map<string, ProgramPage["products_sample"]>();
  const seen = new Set<string>();
  let pricedContracts = 0;
  for (const c of contracts) {
    const offers = (idx.offeringsByContract.get(c.id) ?? []).filter((o) => o.price != null || o.list != null);
    if (offers.length) pricedContracts++;
    for (const o of offers) {
      if (seen.has(o.product)) continue;
      seen.add(o.product);
      const p = idx.productById.get(o.product);
      if (!p) continue;
      const k = (p.kind ?? o.category ?? p.name.split(/\s+/).slice(0, 2).join(" ")).toLowerCase();
      const row = { product_id: p.id, name: p.name, maker: p.maker, price: o.price, list: o.price == null ? o.list : null, unit: o.unit, note: offeringNote(o), supplier: idx.supplierById.get(o.supplier)?.name ?? "", contract_id: c.id, contract_number: c.number };
      byKind.set(k, [...(byKind.get(k) ?? []), row]);
    }
  }
  const kinds = [...byKind.values()].sort((a, b) => b.length - a.length);
  const products_sample: ProgramPage["products_sample"] = [];
  for (let round = 0; products_sample.length < 9 && kinds.some((k) => k.length > round); round++)
    for (const k of kinds) if (k[round] && products_sample.length < 9) products_sample.push(k[round]);

  let buyerInfo: ProgramPage["buyer"] = null;
  if (buyer) {
    const access = contracts.map((c) => catalogAccess(db, buyer, c));
    const open = access.filter((a) => a.eligible).length;
    const member = summary.kind === "coop" && (isMember(db, buyer.name, summary.coop_id) || (summary.coop_id === "coop_buyboard" && isMember(db, buyer.name, "coop_buyboard_national")));
    const who = buyer.name;
    let status: "member" | "open" | "join" | "closed";
    let text: string;
    if (summary.kind === "state") {
      if (buyer.state !== summary.state) {
        status = "closed";
        text = `${summary.name} serves ${stateName(summary.state!)} public entities; ${who} is in ${stateName(buyer.state)}.`;
      } else {
        status = open ? "open" : "closed";
        text = open ? `${plural(open, "contract")} of ${summary.contracts.toLocaleString()} ${open === 1 ? "is" : "are"} open to ${who}.` : `None of ${summary.name}'s contracts is open to ${who}.`;
      }
    } else if (summary.coop_id === "coop_naspo") {
      status = open ? "open" : "closed";
      text = open ? `${stateName(buyer.state)} has signed participating addenda for ${plural(open, "contract")} here, so ${who} may use ${open === 1 ? "it" : "them"}.` : `${stateName(buyer.state)} hasn't signed an addendum for any contract here.`;
    } else if (member) {
      status = "member";
      text = `${who} is on ${summary.name}'s published roster. ${plural(open, "contract")} here serve ${stateName(buyer.state)}.`;
    } else {
      status = open ? "join" : "closed";
      text = open ? `Agora hasn't found ${who} on ${summary.name}'s roster. Joining would open ${plural(open, "contract")} that serve ${stateName(buyer.state)}.` : `No contract here serves ${stateName(buyer.state)}.`;
    }
    buyerInfo = { name: who, status, text, open };
  }

  const soon = new Date(Date.now() + 90 * 864e5).toISOString().slice(0, 10);
  const coop = db.coops.find((c) => c.id === summary.coop_id);
  const anchor = summary.state ? (TRX_PROGRAM_BY_NAME[summary.name]?.data_anchor ?? TRX_PROGRAM[summary.state]?.data_anchor ?? null) : "catalog";
  return {
    ...summary,
    retrieved: catalogStateRetrieved()[summary.name] ?? catalogRetrieved(),
    explorer_id: summary.kind === "state" ? summary.name : summary.coop_id,
    data_anchor: anchor,
    steps: stepsFor(summary),
    buyer: buyerInfo,
    roster: coop?.roster_count ? { count: coop.roster_count, note: coop.note } : null,
    categories,
    group_by: mode,
    uncategorized,
    top_suppliers,
    products_sample,
    expiring: contracts.filter((c) => c.end && c.end <= soon).length,
    priced_contracts: pricedContracts,
  };
}

/** A program's contracts, a page at a time, filtered by words and category; the buyer's open ones first. */
export function programContracts(db: Db, slug: string, opts: { q?: string; category?: string; usable?: boolean; offset?: number; limit?: number }): { total: number; rows: ProgramContractRow[] } | null {
  const found = find(slug);
  if (!found) return null;
  const idx = catalogIndex();
  const buyer = db.session.buyer;
  const words = (opts.q ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  const mode = groupMode(found.contracts);
  const rows: ProgramContractRow[] = [];
  for (const c of found.contracts) {
    if (opts.category && groupOf(c, mode) !== opts.category) continue;
    const supplier = idx.supplierById.get(c.supplier)?.name ?? "";
    if (words.length) {
      const text = `${c.title} ${c.number} ${supplier} ${c.categories.join(" ")}`.toLowerCase();
      if (!words.every((w) => text.includes(w))) continue;
    }
    const a = catalogAccess(db, buyer, c);
    if (opts.usable && !a.eligible) continue;
    const priced = (idx.offeringsByContract.get(c.id) ?? []).filter((o) => o.price != null || o.list != null).length;
    rows.push({ id: c.id, number: c.number, title: c.title, supplier, supplier_id: c.supplier, category: groupOf(c, mode), end: c.end, priced, ...a });
  }
  rows.sort((a, b) => Number(b.eligible) - Number(a.eligible) || Number(b.priced > 0) - Number(a.priced > 0) || b.priced - a.priced || a.title.localeCompare(b.title));
  const offset = opts.offset ?? 0;
  return { total: rows.length, rows: rows.slice(offset, offset + (opts.limit ?? 25)) };
}
