// Contracts as records in their own right. Most of what Agora can surface for a
// request is a contract a buyer may use, not a priced item, so every contract
// gets a page (contractDetail) and all of them can be searched (exploreContracts):
// the co-op catalog's contracts plus the ones Agora holds itself (state contracts,
// agency registers, demo contracts). Server only: it reads the co-op catalog.
//
// Nothing here invents a term. What a contract covers, who may use it and how it
// is priced come from the catalog record, the listings and the price rows; what
// the documents say comes from lib/docs.ts, quoted.

import { fitScoreSets, requestTokens, SAME_AS, tokens } from "./assistant";
import { catalogAccess, catalogIndex, isTrxContract, type CatalogContract, type CatalogOffering } from "./catalog";
import { coopOf, goHref, isContractLevelUrl, onCoopContract } from "./coops";
import { readableCatalogDocument, readableDocuments } from "./docs";
import { stateRuleFor, type BuyerStateRule } from "./state-rules";
import { isTrx, TRX_PROGRAM } from "./trx";
import type { Buyer, Contract, Db } from "./types";
import { checkEligibility } from "./vehicles";

export type ContractKind = "coop" | "federal" | "state" | "agency" | "reseller";
/** open: usable today. check: a state addendum decides. join: on a co-op the agency isn't on. closed: not open to it. unknown: no agency set. */
export type AccessStatus = "open" | "check" | "join" | "closed" | "unknown";

export const KIND_LABEL: Record<ContractKind, string> = {
  coop: "Co-op contract",
  federal: "Federal schedule",
  state: "State contract",
  agency: "Agency contract",
  reseller: "Reseller agreement",
};

export interface ContractRow {
  id: string;
  kind: ContractKind;
  program: string;
  number: string;
  title: string;
  supplier: string;
  supplier_id: string;
  category: string | null;
  end: string | null;
  access: AccessStatus;
  reason: string;
  /** Items listed under the contract, and how many carry a price the buyer would pay. */
  items: number;
  priced: number;
  /** Documents on file, and whether Agora can read at least one. */
  documents: number;
  readable: boolean;
  /** Prices are loaded and buyable in Agora, rather than on the co-op's site. */
  in_agora: boolean;
  fit: number | null;
  /** A state contract in a TRX state (lib/trx.ts), the route Agora prefers for that state's buyers. */
  trx: boolean;
}

const today = () => new Date().toISOString().slice(0, 10);
const ACCESS_RANK: Record<AccessStatus, number> = { open: 0, check: 1, unknown: 2, join: 3, closed: 4 };

function catalogStatus(buyer: Buyer | null, c: CatalogContract, a: { member: boolean; eligible: boolean }): AccessStatus {
  if (!a.eligible) return "closed";
  // A state contract needs no membership: open to the buyers the state allows, once an agency is set.
  if (c.state_contract) return !buyer ? "unknown" : a.member ? "open" : "closed";
  if (c.coop_id === "gsa_mas") return "open";
  if (!buyer) return "unknown";
  if (a.member) return "open";
  return c.coop_id === "coop_naspo" ? "check" : "join";
}

const catalogKind = (c: CatalogContract): ContractKind => (c.state_contract ? "state" : c.coop_id === "gsa_mas" ? "federal" : "coop");

function agoraKind(c: Contract): ContractKind {
  return c.source === "state_contract" ? "state" : c.source === "gsa" ? "federal" : c.source === "reseller" ? "reseller" : c.source === "own_contract" ? "agency" : "coop";
}

function agoraStatus(db: Db, buyer: Buyer | null, c: Contract): { access: AccessStatus; reason: string } {
  const e = checkEligibility(c, buyer);
  if (!e.eligible) return { access: "closed", reason: e.reason };
  if (!buyer) return { access: "unknown", reason: e.reason || (c.eligibility ? `Open to ${c.eligibility.note}` : "") };
  const coop = coopOf(db, c);
  if (coop && !onCoopContract(db, buyer, c)) return { access: coop.access === "state_addendum" ? "check" : "join", reason: e.reason };
  return { access: "open", reason: e.reason };
}

/** A payable price: an awarded bid, a net price or a published price. A list price doesn't count. */
const payable = (o: CatalogOffering) => o.price != null;

// ------------------------------------------------------------------ the explorer

export interface ExploreOptions {
  q?: string;
  coop?: string;
  category?: string;
  kind?: ContractKind | "";
  /** Only contracts the agency can use today. */
  usable?: boolean;
  /** Only contracts with item prices loaded. */
  priced?: boolean;
  /** Only contracts with a document Agora can read. */
  readable?: boolean;
  offset?: number;
  limit?: number;
}
export interface ExploreResult {
  total: number;
  rows: ContractRow[];
  programs: { id: string; name: string; count: number }[];
  categories: { name: string; count: number }[];
  kinds: { id: ContractKind; count: number }[];
  /** Every contract that can be searched, before any filter. */
  universe: number;
  retrieved: string;
  buyer: string | null;
}

interface Scan {
  rows: (ContractRow & { program_id: string })[];
  universe: number;
}

/** Every current contract as a row, for one buyer and one query. */
function scan(db: Db, buyer: Buyer | null, q: string): Scan {
  const idx = catalogIndex();
  const now = today();
  const query = q.trim().toLowerCase();
  const words = requestTokens(query);
  const numberLike = /\d/.test(query) ? query.replace(/\s+/g, "") : "";
  const seeded = new Set(db.contracts.map((c) => c.catalog_id).filter(Boolean));
  const rows: Scan["rows"] = [];

  // Which catalog contracts to look at: all of them, or the ones sharing a word (or number) with the query.
  let wanted: Iterable<number>;
  if (!query) wanted = idx.contracts.keys();
  else {
    const set = new Set<number>();
    for (const w of words) for (const x of [w, ...(SAME_AS[w] ?? [])]) for (const i of idx.cIndex.get(x) ?? []) set.add(i);
    if (numberLike.length >= 3) idx.contracts.forEach((c, i) => c.number.toLowerCase().replace(/\s+/g, "").includes(numberLike) && set.add(i));
    wanted = set;
  }
  const accessCache = new Map<string, ReturnType<typeof catalogAccess>>();
  for (const i of wanted) {
    const c = idx.contracts[i];
    if (seeded.has(c.id) || (c.end && c.end < now)) continue;
    let fit: number | null = null;
    if (query) {
      const byNumber = numberLike.length >= 3 && c.number.toLowerCase().replace(/\s+/g, "").includes(numberLike);
      fit = byNumber ? 100 : words.length ? fitScoreSets(words, idx.cTitle[i], idx.cScope[i], idx.cWeights) : 0;
      if (fit < 50) continue;
    }
    const k = `${c.coop_id}|${c.states === "any" ? "*" : c.states.join(",")}|${(c.coop_sins ?? []).map((x) => x.code).join(",")}|${c.state_contract?.locals ?? ""}`;
    let a = accessCache.get(k);
    if (!a) accessCache.set(k, (a = catalogAccess(db, buyer, c)));
    const offers = idx.offeringsByContract.get(c.id) ?? [];
    const docs = idx.documentsByContract.get(c.id) ?? [];
    rows.push({
      id: c.id,
      kind: catalogKind(c),
      trx: isTrxContract(c),
      program: db.coops.find((x) => x.id === c.coop_id)?.name ?? c.coop,
      // A state program is keyed by its name, so the catalog's NJSTART and Agora's own NJSTART contracts are one program.
      program_id: c.state_contract ? c.coop : c.coop_id || c.coop,
      number: c.number,
      title: c.title,
      supplier: idx.supplierById.get(c.supplier)?.name ?? "",
      supplier_id: c.supplier,
      category: c.category ?? null,
      end: c.end,
      access: catalogStatus(buyer, c, a),
      reason: a.reason,
      items: offers.length,
      priced: offers.filter(payable).length,
      documents: docs.length,
      readable: docs.some(readableCatalogDocument),
      in_agora: false,
      fit,
    });
  }

  // Contracts Agora holds itself. A register contract is visible only to its own agency.
  const texts = db.contracts.map((c) => `${c.title} ${c.scope ?? ""} ${c.vehicle ?? ""} ${c.owner} ${db.suppliers.find((s) => s.id === c.supplier_id)?.name ?? ""}`);
  db.contracts.forEach((c, i) => {
    if ((c.register_of && c.register_of !== buyer?.name) || (c.end && c.end < now)) return;
    let fit: number | null = null;
    if (query) {
      const have = new Set(tokens(texts[i]));
      const hit = words.filter((w) => have.has(w) || (SAME_AS[w] ?? []).some((x) => have.has(x))).length;
      const byNumber = numberLike.length >= 3 && c.contract_number.toLowerCase().replace(/\s+/g, "").includes(numberLike);
      fit = byNumber ? 100 : words.length ? Math.round((100 * hit) / words.length) : 0;
      if (fit < 50) return;
    }
    const listings = db.listings.filter((l) => l.contract_id === c.id);
    const coop = coopOf(db, c);
    const s = agoraStatus(db, buyer, c);
    const docs = c.documents ?? [];
    rows.push({
      id: c.id,
      kind: agoraKind(c),
      trx: isTrx(c),
      program: coop?.name ?? c.vehicle ?? c.owner,
      program_id: coop?.id ?? c.vehicle ?? c.owner,
      number: c.contract_number,
      title: c.title,
      supplier: db.suppliers.find((x) => x.id === c.supplier_id)?.name ?? "",
      supplier_id: c.supplier_id,
      category: listings[0]?.category ?? null,
      end: c.end || null,
      ...s,
      items: listings.length,
      priced: listings.length,
      documents: docs.length,
      readable: readableDocuments(db, c.id).length > 0,
      in_agora: listings.length > 0 && !(coop && !coop.buy_in_agora),
      fit,
    });
  });
  return { rows, universe: idx.contracts.length + db.contracts.filter((c) => !c.catalog_id).length };
}

const KIND_RANK: Record<ContractKind, number> = { agency: 0, state: 1, coop: 2, reseller: 3, federal: 4 };

/** Search and filter every contract. The agency's own contracts come first, then state, then co-op, as a buyer would check them. */
export function exploreContracts(db: Db, opts: ExploreOptions = {}): ExploreResult {
  const buyer = db.session.buyer;
  const { rows, universe } = scan(db, buyer, (opts.q ?? "").slice(0, 120));
  const toggled = rows.filter((r) => (!opts.usable || r.access === "open") && (!opts.priced || r.priced > 0) && (!opts.readable || r.readable));
  const byKind = toggled.filter((r) => !opts.kind || r.kind === opts.kind);
  const count = <T,>(list: T[], key: (r: T) => string) => list.reduce<Map<string, number>>((m, r) => m.set(key(r), (m.get(key(r)) ?? 0) + 1), new Map());

  const names = new Map(byKind.map((r) => [r.program_id, r.program]));
  const programs = [...count(byKind.filter((r) => !opts.category || r.category === opts.category), (r) => r.program_id)].map(([id, n]) => ({ id, name: names.get(id) ?? id, count: n })).sort((a, b) => b.count - a.count);
  const categories = [...count(byKind.filter((r) => (!opts.coop || r.program_id === opts.coop) && r.category), (r) => r.category!)].map(([name, n]) => ({ name, count: n })).sort((a, b) => b.count - a.count);
  const kinds = [...count(toggled, (r) => r.kind)].map(([id, n]) => ({ id: id as ContractKind, count: n })).sort((a, b) => KIND_RANK[a.id] - KIND_RANK[b.id]);

  const matched = byKind.filter((r) => (!opts.coop || r.program_id === opts.coop) && (!opts.category || r.category === opts.category));
  // With a query, the closest scope first; either way, what the agency can use, then what has prices and documents.
  // Without an agency nothing is known to be usable, so only contracts closed to local governments drop down.
  const rank = (r: ContractRow) => (buyer ? ACCESS_RANK[r.access] : r.access === "closed" ? 1 : 0);
  matched.sort(
    (a, b) =>
      Math.round((b.fit ?? 0) / 10) - Math.round((a.fit ?? 0) / 10) ||
      rank(a) - rank(b) ||
      KIND_RANK[a.kind] - KIND_RANK[b.kind] ||
      Number(b.priced > 0) - Number(a.priced > 0) ||
      Number(b.readable) - Number(a.readable) ||
      (b.fit ?? 0) - (a.fit ?? 0) ||
      a.program.localeCompare(b.program) ||
      a.supplier.localeCompare(b.supplier),
  );
  const offset = Math.max(0, opts.offset ?? 0);
  return {
    total: matched.length,
    rows: matched.slice(offset, offset + Math.min(50, opts.limit ?? 25)).map(({ program_id: _p, ...r }) => r),
    programs,
    categories,
    kinds,
    universe,
    retrieved: catalogIndex().retrieved,
    buyer: buyer?.name ?? null,
  };
}

// ------------------------------------------------------------------ one contract

export interface ContractItem {
  id: string;
  name: string;
  maker: string | null;
  sku: string | null;
  /** A price the buyer would pay. */
  price: number | null;
  /** A list price before the contract discount; never shown as the contract price. */
  list: number | null;
  note: string;
  unit: string | null;
  /** Where the item can be opened: a product page in Agora, or the co-op's page through the tracked link. */
  href: string;
  external: boolean;
}

export interface ContractDetail {
  id: string;
  kind: ContractKind;
  /** A state contract in a TRX state (lib/trx.ts). */
  trx: boolean;
  /** The state solicitation it was awarded under, e.g. T2187, shared by every supplier on the award. */
  solicitation: string | null;
  kind_label: string;
  program: string;
  number: string;
  title: string;
  supplier: string;
  supplier_id: string;
  category: string | null;
  expired: boolean;
  /** Scope lines beyond the title: the co-op's categories, GSA's SIN descriptions, Agora's scope note. */
  covers: string[];
  sins: { code: string; title: string; open: boolean }[];
  term: { start: string | null; end: string | null; renewal: string | null };
  lead: string | null;
  states: string[] | "any";
  access: AccessStatus;
  reason: string;
  requires: string | null;
  state_rule: BuyerStateRule | null;
  pricing: { headline: string; detail: string; vintages: string[]; items: number; priced: number; list: number };
  items: ContractItem[];
  items_total: number;
  documents: { label: string; url: string; host: string; readable: boolean }[];
  /** Documents Agora can read for the brief and for questions. */
  readable: { label: string; held: boolean }[];
  /** The contract on its owner's site (tracked), or the directory to look it up in. */
  link: { href: string; label: string; tracked: boolean } | null;
  steps: string[];
  provenance: string;
  /** Other current contracts the same supplier holds. */
  related: { id: string; program: string; number: string; title: string }[];
  /** The same contract with prices loaded in Agora, when this is the catalog's copy. */
  agora_copy: string | null;
  buyer: string | null;
}

const host = (url: string) => {
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch {
    return "";
  }
};
const possessive = (name: string) => (/s$/i.test(name) ? `${name}'` : `${name}'s`);
const longDate = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });

/** What an offering's number is, in plain words, by the vintage the importer gave it. */
function offeringNote(o: CatalogOffering): string {
  if (o.price != null && /^NJSTART/.test(o.vintage ?? "")) return "Awarded state contract price";
  if (o.price != null) return /award/i.test(o.vintage ?? "") ? "Awarded bid, base model" : /net price/i.test(o.vintage ?? "") ? "Contract net price" : /base vehicle|cost sheet/i.test(o.vintage ?? "") ? "Base price, before options and delivery" : "Published price";
  if (o.list != null) return "List price, before the contract discount";
  if (o.status === "member_login") return "Price behind the co-op's member login";
  if (o.status === "published_discount") return "Discount off list; no item price published";
  return "Price by quote";
}

function steps(c: { program: string; number: string; supplier: string; kind: ContractKind; access: AccessStatus; priced: number; in_agora: boolean; hasLink: boolean; state?: { name: string; coop_program: string; solicitation: string | null; locals: boolean } }): string[] {
  const out: string[] = [];
  if (c.access === "closed") return ["This contract isn't open to your agency. Look for the same supplier on another contract below, or ask purchasing whether an addendum or membership would open it."];
  if (c.state && !c.in_agora) {
    // A New Jersey state contract (NJSTART), bought by a local through the state's cooperative purchasing program.
    const award = c.state.solicitation ? ` (awarded under ${c.state.solicitation})` : "";
    if (c.state.locals) out.push(`If your agency hasn't already, register once with the ${c.state.coop_program}. Purchasing will know; there's no per-contract membership.`);
    out.push(`Buy from ${c.supplier || "the supplier"} under ${c.state.name} ${c.number}${award}. The state already bid it, so a local unit doesn't advertise for bids of its own (New Jersey's Local Public Contracts Law allows purchases on state contracts).`);
    out.push(c.priced > 0 ? "Check the supplier's quote against the awarded prices below. They're the state's line items; anything not listed is priced from the contract's price sheet." : "Ask the supplier for a quote at the contract's prices; its price sheet is among the documents below.");
    out.push(`Keep the contract number on the purchase order, and follow the method of operation in the contract's documents for how to place the order.`);
    return out;
  }
  if (c.access === "join") out.push(`Get on ${c.program} first. Ask purchasing: most co-ops take a short membership form, and some states want a board resolution or an interlocal agreement before the first order.`);
  if (c.access === "check") out.push(`Confirm your state has a participating addendum to ${c.number}. Without one, your state's purchasing office decides whether you may use it.`);
  if (c.kind === "federal") out.push("Order only under the SINs marked open to state and local governments. The rest of the schedule is for federal buyers.");
  if (c.in_agora) out.push("Prices are loaded in Agora: add the items below to a cart and check out under this contract.");
  else out.push(`Ask ${c.supplier || "the supplier"} for a quote that cites ${c.program} ${c.number}, so the contract's pricing and terms apply.`);
  if (!c.in_agora) out.push(c.priced > 0 ? "Check the quote against the prices on file with Agora's quote check before you order." : "No item prices are on file for this contract, so compare the quote with the contract's own price list or discount schedule.");
  if (!c.in_agora) out.push(c.hasLink ? `Place the order the way ${c.program} sets out on the contract's page, and keep the contract number on the purchase order.` : `Place the order the way ${c.program} sets out, and keep the contract number on the purchase order.`);
  return out;
}

function catalogDetail(db: Db, c: CatalogContract, itemQuery: string): ContractDetail {
  const idx = catalogIndex();
  const buyer = db.session.buyer;
  const a = catalogAccess(db, buyer, c);
  const access = catalogStatus(buyer, c, a);
  const program = db.coops.find((x) => x.id === c.coop_id)?.name ?? c.coop;
  const supplier = idx.supplierById.get(c.supplier)?.name ?? "";
  const kind = catalogKind(c);
  const offers = idx.offeringsByContract.get(c.id) ?? [];
  const priced = offers.filter(payable);
  const listed = offers.filter((o) => o.price == null && o.list != null);
  const vintages = [...new Set(offers.map((o) => o.vintage).filter((v): v is string => Boolean(v)))];
  const notes = [...new Set(priced.map(offeringNote))];

  const n = (x: number, word: string) => `${x.toLocaleString("en-US")} ${word}${x === 1 ? "" : "s"}`;
  let headline: string;
  let detail: string;
  if (priced.length && c.state_contract) {
    headline = `${n(priced.length, "awarded price")} on file`;
    detail = `The state's awarded line items for this contract, read from ${program}${c.start && c.end ? ` (contract term ${longDate(c.start)} to ${longDate(c.end)})` : ""}. Confirm the current price and any annual adjustment with the supplier.${c.state_contract.more_items ? ` ${program} lists more items than Agora has loaded; the rest are on the contract's page.` : ""}`;
  } else if (priced.length) {
    headline = `${n(priced.length, "item")} with a price on file`;
    detail = `${notes.join("; ")}. These are prices as published${vintages.length ? ` in ${vintages.join("; ")}` : ""}, not a quote: confirm the current price, options and freight with the supplier.`;
  } else if (listed.length) {
    headline = `${n(listed.length, "list price")} on file, before the contract discount`;
    detail = "The contract price is lower than list, but the discount isn't loaded, so these aren't what your agency would pay.";
  } else if (offers.some((o) => o.status === "published_discount")) {
    headline = "Priced as a discount off list";
    detail = `The co-op lists ${n(offers.length, "product")} under this contract without item prices. The supplier quotes the price.`;
  } else if (offers.some((o) => o.status === "member_login")) {
    headline = "Prices behind the co-op's member login";
    detail = `The co-op lists ${n(offers.length, "product")} under this contract, and shows prices to signed-in members only.`;
  } else if (c.state_contract) {
    headline = "No item prices on file";
    detail = `${program} doesn't list this contract's prices as line items. They're in its price sheet, among the documents below; the supplier quotes from it.`;
  } else {
    headline = "No item prices on file";
    detail = "The program's directory names the contract and what it covers, not what each item costs. The supplier quotes under the contract.";
  }

  const q = itemQuery.trim().toLowerCase();
  const withNames = offers.map((o) => ({ o, p: idx.productById.get(o.product) })).filter((x) => x.p);
  const matching = q ? withNames.filter(({ p }) => `${p!.name} ${p!.maker ?? ""} ${p!.mpn ?? ""}`.toLowerCase().includes(q)) : withNames;
  const items: ContractItem[] = [...matching]
    .sort((x, y) => Number(payable(y.o)) - Number(payable(x.o)) || x.p!.name.localeCompare(y.p!.name))
    .slice(0, 25)
    .map(({ o, p }) => ({
      id: o.id,
      name: p!.name,
      maker: p!.maker,
      sku: o.sku ?? p!.mpn,
      price: o.price,
      list: o.price == null ? o.list : null,
      note: offeringNote(o),
      unit: o.unit,
      href: goHref(c.id, { offering: o.id }),
      external: true,
    }));

  const open = new Set((c.coop_sins ?? []).map((x) => x.code));
  const sinTitles = new Map((c.coop_sins ?? []).map((x) => [x.code, x.title]));
  const docs = idx.documentsByContract.get(c.id) ?? [];
  const agoraCopy = db.contracts.find((x) => x.catalog_id === c.id)?.id ?? null;
  const hasLink = Boolean(c.url);
  return {
    id: c.id,
    kind,
    kind_label: KIND_LABEL[kind],
    trx: isTrxContract(c),
    solicitation: c.state_contract?.solicitation ?? null,
    program,
    number: c.number,
    title: c.title,
    supplier,
    supplier_id: c.supplier,
    category: c.category ?? null,
    expired: Boolean(c.end && c.end < today()),
    covers: c.categories.filter((x) => x && x !== c.title),
    sins: c.sins.map((code) => ({ code, title: sinTitles.get(code) ?? "", open: open.has(code) })),
    term: { start: c.start, end: c.end, renewal: c.renewal && c.renewal !== c.end ? c.renewal : null },
    lead: c.lead,
    states: c.states,
    access,
    reason: a.reason,
    requires: null,
    state_rule: kind === "coop" ? stateRuleFor(buyer, c.title) : null,
    pricing: { headline, detail, vintages, items: offers.length, priced: priced.length, list: listed.length },
    items,
    items_total: matching.length,
    documents: docs.map((d) => ({ label: d.label, url: d.url, host: host(d.url), readable: readableCatalogDocument(d) })),
    readable: readableDocuments(db, c.id),
    link: c.url ? { href: goHref(c.id), label: `Open on ${program}`, tracked: true } : c.directory ? { href: c.directory, label: `Find ${c.number} in ${possessive(program)} directory`, tracked: false } : null,
    steps: steps({ program, number: c.number, supplier, kind, access, priced: priced.length, in_agora: false, hasLink, state: c.state_contract ? { name: program, coop_program: TRX_PROGRAM[c.state_contract.state]?.coop_program ?? "state's cooperative purchasing program", solicitation: c.state_contract.solicitation, locals: c.state_contract.locals } : undefined }),
    provenance: c.state_contract
      ? `From ${possessive(program)} public list of active contracts, retrieved ${longDate(idx.state_retrieved?.[c.coop] ?? idx.retrieved)}. Whether a contract is open to local governments is the state's own "NJ Cooperative Purchasing" flag on the contract.`
      : `From ${possessive(program)} public contract directory, retrieved ${longDate(idx.retrieved)}. Terms and eligibility aren't independently verified.`,
    related: (idx.contractsBySupplier.get(c.supplier) ?? [])
      .filter((x) => x.id !== c.id && !(x.end && x.end < today()))
      .slice(0, 6)
      .map((x) => ({ id: x.id, program: db.coops.find((co) => co.id === x.coop_id)?.name ?? x.coop, number: x.number, title: x.title })),
    agora_copy: agoraCopy,
    buyer: buyer?.name ?? null,
  };
}

const VERIFICATION: Record<NonNullable<Contract["verification"]>, string> = {
  source_document: "Terms and prices read from the contract's own source documents.",
  research_lead: "Located in research. Its terms still need checking against the source.",
  demo: "Demo data, invented for the Riverbend walkthrough.",
  agency_register: "From the agency's own contract register.",
};

function agoraDetail(db: Db, c: Contract, itemQuery: string): ContractDetail {
  const buyer = db.session.buyer;
  const coop = coopOf(db, c);
  const kind = agoraKind(c);
  const program = coop?.name ?? c.vehicle ?? c.owner;
  const supplier = db.suppliers.find((s) => s.id === c.supplier_id)?.name ?? "";
  const s = agoraStatus(db, buyer, c);
  const listings = db.listings.filter((l) => l.contract_id === c.id);
  const inAgora = listings.length > 0 && !(coop && !coop.buy_in_agora);
  const basis = c.pricing_basis ?? (listings.length ? "published_price" : "quote");
  const q = itemQuery.trim().toLowerCase();
  const matching = q ? listings.filter((l) => `${l.title} ${l.sku ?? ""} ${l.keywords ?? ""}`.toLowerCase().includes(q)) : listings;
  const cat = c.catalog_id ? catalogIndex().contractById.get(c.catalog_id) : undefined;
  const hasLink = isContractLevelUrl(c.source_url);
  const n = listings.length.toLocaleString("en-US");
  return {
    id: c.id,
    kind,
    kind_label: KIND_LABEL[kind],
    trx: isTrx(c),
    solicitation: null,
    program,
    number: c.contract_number,
    title: c.title,
    supplier,
    supplier_id: c.supplier_id,
    category: listings[0]?.category ?? cat?.category ?? null,
    expired: Boolean(c.end && c.end < today()),
    covers: [c.scope, ...(cat?.categories ?? [])].filter((x): x is string => Boolean(x) && x !== c.title),
    sins: [],
    term: { start: c.start || null, end: c.end || null, renewal: null },
    lead: c.master_agreement ? `Adopted from ${c.master_agreement}` : c.owner !== program ? c.owner : null,
    states: c.eligibility?.states ?? "any",
    access: s.access,
    reason: s.reason || (c.eligibility ? `Open to ${c.eligibility.note}` : "Open to the agency that holds it"),
    requires: c.eligibility?.requires ?? null,
    state_rule: kind === "coop" ? stateRuleFor(buyer, c.title) : null,
    pricing: {
      headline: listings.length ? `${n} price${listings.length === 1 ? "" : "s"} loaded in Agora` : basis === "discount_from_list" ? "Priced as a discount off list" : "No item prices on file",
      detail: listings.length
        ? "Published contract prices, read from the contract's price file."
        : basis === "discount_from_list"
          ? "The supplier quotes a discount off its current list price. No item prices are loaded."
          : "The supplier quotes under the contract.",
      vintages: [],
      items: listings.length,
      priced: listings.length,
      list: 0,
    },
    items: matching.slice(0, 25).map((l) => ({ id: l.id, name: l.title, maker: null, sku: l.sku, price: l.unit_price, list: null, note: "Published contract price", unit: l.unit, href: `/product/${l.id}`, external: false })),
    items_total: matching.length,
    documents: (c.documents ?? []).map((d) => ({ label: d.label, url: d.url, host: host(d.url), readable: false })),
    readable: readableDocuments(db, c.id),
    link: c.source_url ? { href: goHref(c.id), label: hasLink ? `Open on ${program}` : `Open ${possessive(program)} site`, tracked: true } : null,
    steps: steps({ program, number: c.contract_number, supplier, kind, access: s.access, priced: listings.length, in_agora: inAgora, hasLink }),
    provenance: VERIFICATION[c.verification ?? "demo"],
    related: db.contracts
      .filter((x) => x.supplier_id === c.supplier_id && x.id !== c.id && !(x.register_of && x.register_of !== buyer?.name) && !(x.end && x.end < today()))
      .slice(0, 6)
      .map((x) => ({ id: x.id, program: coopOf(db, x)?.name ?? x.vehicle ?? x.owner, number: x.contract_number, title: x.title })),
    agora_copy: null,
    buyer: buyer?.name ?? null,
  };
}

/** Everything Agora knows about one contract, for its page. `items` narrows the item list by a word. */
export function contractDetail(db: Db, id: string, items = ""): ContractDetail | null {
  const own = db.contracts.find((c) => c.id === id);
  if (own) return own.register_of && own.register_of !== db.session.buyer?.name ? null : agoraDetail(db, own, items.slice(0, 80));
  const cat = catalogIndex().contractById.get(id);
  return cat ? catalogDetail(db, cat, items.slice(0, 80)) : null;
}
