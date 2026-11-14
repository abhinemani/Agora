// "Check this quote": compare a vendor's quote, line by line, with the prices
// Agora holds for the same part numbers. Matching is by part number only, and
// every comparison cites the line of the price file it came from. The model
// may help read the quote's lines, but a line is kept only if its part number
// and price both appear in the quote's own text. Server-only.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import * as z from "zod/v4";
import { structured } from "./llm";
import type { Db } from "./types";

interface PriceRow {
  coop: string;
  number: string;
  supplier: string;
  product: string;
  price: number;
  list?: number;
  sku?: string;
  unit: string;
  basis: "net_price" | "list_price" | "awarded_bid" | "base_price" | "published_price";
  vintage: string;
  file: string;
  source_url?: string;
  page?: number;
  line?: string;
}

export interface QuoteLine {
  part_number: string | null;
  description: string;
  quantity: number;
  unit_price: number;
}

export type QuoteStatus = "over" | "under" | "match" | "over_list" | "under_list" | "not_found";

export interface CheckedLine extends QuoteLine {
  status: QuoteStatus;
  /** The price Agora holds, and what kind of price it is. */
  reference: number | null;
  reference_kind: string | null;
  product: string | null;
  /** Quoted minus reference, per unit and for the line. */
  diff: number | null;
  pct: number | null;
  line_diff: number | null;
  note: string;
  source: { contract: string; supplier: string; vintage: string; file: string | null; page: number | null; line: string | null; url: string | null } | null;
}

export interface QuoteReport {
  read_by: "llm" | "rules";
  lines: CheckedLine[];
  /** Lines the reader found but couldn't keep, with the reason. */
  dropped: string[];
  quoted_total: number;
  checked: number;
  over: number;
  over_amount: number;
  not_found: number;
  headline: string;
  summary: string;
}

const norm = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");
const round2 = (n: number) => Math.round(n * 100) / 100;
const usd = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const g = globalThis as unknown as { __agoraPriceRows?: Map<string, PriceRow[]> };
function fileRows(): Map<string, PriceRow[]> {
  if (g.__agoraPriceRows) return g.__agoraPriceRows;
  const path = join(process.cwd(), "seed/catalog/price-rows.json");
  const rows: PriceRow[] = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : [];
  const index = new Map<string, PriceRow[]>();
  for (const r of rows) {
    if (!r.sku) continue;
    const k = norm(r.sku);
    if (k.length < 3) continue;
    (index.get(k) ?? index.set(k, []).get(k)!).push(r);
  }
  g.__agoraPriceRows = index;
  return index;
}

/** Every price Agora holds for a part number: price-file rows, then Agora's own listings. */
function pricesFor(db: Db, part: string): PriceRow[] {
  const k = norm(part);
  const out = [...(fileRows().get(k) ?? [])];
  for (const l of db.listings) {
    if (norm(l.sku) !== k) continue;
    const c = db.contracts.find((x) => x.id === l.contract_id);
    out.push({ coop: c?.vehicle ?? c?.owner ?? "No contract", number: c?.contract_number ?? "", supplier: db.suppliers.find((s) => s.id === l.supplier_id)?.name ?? "", product: l.title, price: l.unit_price, sku: l.sku, unit: l.unit, basis: "published_price", vintage: "Listing in Agora", file: "" });
  }
  return out;
}
const known = (db: Db, token: string) => norm(token).length >= 3 && pricesFor(db, token).length > 0;

const MONEY = /\$?\s?(\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d+\.\d{2})(?![\d%])/g;
const amounts = (line: string) => [...line.matchAll(MONEY)].map((m) => Number(m[1].replace(/,/g, "")));

/** Read a quote's lines without the model: a line counts when it carries a part number Agora knows and a price. */
function readByRules(db: Db, text: string): { lines: QuoteLine[]; dropped: string[] } {
  const lines: QuoteLine[] = [];
  const dropped: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\t|\|/g, "  ").trim();
    if (!line || /\b(sub-?total|total|tax|freight|shipping|delivery|terms|valid|quote\s*(#|no|date)|page \d)/i.test(line)) continue;
    const money = amounts(line);
    if (!money.length) continue;
    const tokens = line.split(/[\s,;]+/).filter(Boolean);
    // A part number Agora knows, else the first token shaped like one, so the line can be reported as not found.
    const part = tokens.find((t) => known(db, t)) ?? tokens.find((t) => t.length >= 5 && /\d/.test(t) && /[A-Za-z-]/.test(t) && !/[$.]/.test(t)) ?? null;
    const unit_price = money[0];
    const ints = tokens.filter((t) => /^\d{1,5}$/.test(t)).map(Number);
    const quantity = ints.find((q) => money.length > 1 && Math.abs(q * unit_price - money[money.length - 1]) < 0.02) ?? ints.find((q) => q > 0 && String(q) !== part) ?? 1;
    const description = line.replace(MONEY, " ").replace(/\s+/g, " ").trim().slice(0, 120);
    if (!part && !/[a-z]{3}/i.test(description)) continue;
    lines.push({ part_number: part, description, quantity, unit_price });
  }
  return { lines, dropped };
}

const Schema = z.object({
  lines: z.array(
    z.object({
      part_number: z.string().nullable().describe("The part number, SKU or model code exactly as printed, or null."),
      description: z.string(),
      quantity: z.number(),
      unit_price: z.number().describe("The price for one unit, exactly as printed. Not the extended line total."),
    }),
  ),
});

async function readByModel(text: string): Promise<{ lines: QuoteLine[]; dropped: string[] } | null> {
  const out = await structured({
    system:
      "You read a vendor's price quote and list its priced line items. Copy part numbers and unit prices exactly as printed. " +
      "Skip subtotals, totals, tax and freight. Don't compute or correct anything; if a line has no unit price, leave it out.",
    user: text.slice(0, 60_000),
    schema: Schema,
    maxTokens: 8000,
    timeoutMs: 45_000,
  });
  if (!out) return null;
  // Keep a line only if its price and part number are in the quote's own text.
  const printed = new Set(amounts(text).map((n) => n.toFixed(2)));
  const flat = norm(text);
  const lines: QuoteLine[] = [];
  const dropped: string[] = [];
  for (const l of out.lines) {
    const label = `${l.part_number ?? ""} ${l.description}`.trim().slice(0, 80);
    if (!(l.unit_price > 0) || !printed.has(l.unit_price.toFixed(2))) dropped.push(`${label}: the price read (${l.unit_price}) isn't printed in the quote`);
    else if (l.part_number && !flat.includes(norm(l.part_number))) dropped.push(`${label}: the part number read isn't printed in the quote`);
    else lines.push({ part_number: l.part_number?.trim() || null, description: l.description.trim().slice(0, 120), quantity: Math.max(1, Math.round(l.quantity) || 1), unit_price: l.unit_price });
  }
  return { lines, dropped };
}

const KIND: Record<PriceRow["basis"], string> = {
  net_price: "Contract net price",
  list_price: "List price, before the contract discount",
  awarded_bid: "Awarded bid, base model",
  base_price: "Base price, before options and delivery",
  published_price: "Published contract price",
};

function check(db: Db, l: QuoteLine): CheckedLine {
  const base = { ...l, reference: null, reference_kind: null, product: null, diff: null, pct: null, line_diff: null, source: null };
  if (!l.part_number) return { ...base, status: "not_found", note: "No part number on this line, so it can't be matched. Agora matches by part number only." };
  const rows = pricesFor(db, l.part_number);
  if (!rows.length) return { ...base, status: "not_found", note: "This part number isn't in any price file Agora holds." };
  const r = rows[0];
  const diff = round2(l.unit_price - r.price);
  const pct = r.price ? Math.round((diff / r.price) * 1000) / 10 : 0;
  const line_diff = round2(diff * l.quantity);
  const source = { contract: `${r.coop} ${r.number}`.trim(), supplier: r.supplier, vintage: r.vintage, file: r.file ? r.file.split("/").pop()! : null, page: r.page ?? null, line: r.line ?? null, url: r.source_url ?? null };
  const common = { ...l, reference: r.price, reference_kind: KIND[r.basis], product: r.product, diff, pct, line_diff, source };
  if (r.basis === "list_price")
    return diff > 0.005
      ? { ...common, status: "over_list", note: `Quoted above list price. The contract gives a discount off list, so this should be lower than ${usd(r.price)}.` }
      : { ...common, status: "under_list", note: "At or below list. The contract's discount isn't loaded, so Agora can't confirm this is the full contract price." };
  if (Math.abs(diff) <= Math.max(0.01, r.price * 0.001)) return { ...common, status: "match", note: "Matches the price on file." };
  if (diff > 0)
    return {
      ...common,
      status: "over",
      note: r.basis === "awarded_bid" || r.basis === "base_price" ? `Above the ${r.basis === "awarded_bid" ? "awarded base price" : "base price"}. Options or delivery may explain it: ask for the breakdown.` : `${usd(diff)} (${pct}%) above the contract price, each.`,
    };
  return { ...common, status: "under", note: `${usd(-diff)} below the price on file, each.` };
}

/** Read a quote's text and compare every line Agora can match. */
export async function checkQuote(db: Db, text: string): Promise<QuoteReport> {
  const clean = text.replace(/ /g, " ").slice(0, 200_000);
  const model = await readByModel(clean);
  const { lines, dropped } = model ?? readByRules(db, clean);
  const checked = lines.map((l) => check(db, l));
  const matched = checked.filter((l) => l.status !== "not_found");
  const over = checked.filter((l) => l.status === "over" || l.status === "over_list");
  const over_amount = round2(over.reduce((s, l) => s + (l.line_diff ?? 0), 0));
  const not_found = checked.length - matched.length;
  const quoted_total = round2(checked.reduce((s, l) => s + l.unit_price * l.quantity, 0));
  const headline = !checked.length
    ? "I couldn't find any priced lines in this quote."
    : !matched.length
      ? "None of these part numbers is in a price file Agora holds."
      : over.length
        ? `${over.length} of ${matched.length} checked line${matched.length === 1 ? "" : "s"} ${over.length === 1 ? "is" : "are"} priced above what Agora has on file.`
        : `All ${matched.length} checked line${matched.length === 1 ? "" : "s"} ${matched.length === 1 ? "is" : "are"} at or below the price on file.`;
  const summary = [
    over.length ? `Across those lines the quote is **${usd(over_amount)} higher** than the prices on file.` : "",
    not_found ? `${not_found} line${not_found === 1 ? "" : "s"} couldn't be checked: Agora matches by part number, and ${not_found === 1 ? "it isn't" : "they aren't"} in a loaded price file.` : "",
    matched.length ? "Check each price file's date before raising it with the vendor; a newer list may be in effect." : "",
  ]
    .filter(Boolean)
    .join(" ");
  return { read_by: model ? "llm" : "rules", lines: checked, dropped, quoted_total, checked: matched.length, over: over.length, over_amount, not_found, headline, summary };
}

/** A sample quote built from real rows of a loaded price file, with one line marked up and one part Agora doesn't hold. */
export function sampleQuote(): string {
  const rows = [...fileRows().values()].map((r) => r[0]).filter((r) => r.basis === "net_price" && r.price > 40 && r.price < 4000 && r.sku);
  if (rows.length < 6) return "";
  const pick = [0.07, 0.21, 0.38, 0.55, 0.73, 0.9].map((q) => rows[Math.floor(rows.length * q)]);
  const qty = [4, 2, 12, 1, 6, 2];
  const price = (r: PriceRow, i: number) => (i === 2 ? round2(r.price * 1.08) : i === 4 ? round2(r.price + 15) : r.price);
  const name = (r: PriceRow) => r.product.replace(/\s*\(part [^)]*\)\s*$/i, "").replace(/^Burke\s+/i, "");
  const body = pick.map((r, i) => `${r.sku}  ${name(r)}  ${qty[i]}  ${usd(price(r, i))}  ${usd(round2(price(r, i) * qty[i]))}`);
  body.splice(3, 0, `PS-INSTALL-01  Site installation, per day  3  ${usd(1850)}  ${usd(5550)}`);
  return [
    "QUOTE (sample for this demo; the vendor name is made up)",
    "Northfield Play & Park Supply",
    `Contract: ${pick[0].coop} ${pick[0].number}`,
    "",
    "Part No.  Description  Qty  Unit Price  Extended",
    ...body,
    "",
    "Freight: quoted separately",
  ].join("\n");
}
