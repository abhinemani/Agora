// Turns a vendor price catalog spreadsheet into storefront listings JSON that
// lib/seed.ts loads on every reset. Prices are read only from the price line at
// the end of each description; rows without one readable price are skipped and
// reported, never guessed.
//   node scripts/import-price-catalog.mjs

import * as XLSX from "xlsx";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "seed", "catalogs");
const SRC = join(DIR, "tyler-technologies-price-catalog-2025-03.xlsx");
const OUT = join(DIR, "tyler-technologies-2025-03.json");

const AMOUNT = /\$\s?[\d,]+(?:\.\d+)?|(?<![\w.$])[\d,]{1,12}\.\d{2}(?![\d%])/g;
const money = (s) => parseFloat(s.replace(/[$,\s]/g, ""));
const clean = (s) => String(s ?? "").replace(/\s+/g, " ").trim();

function unitOf(after) {
  const raw = clean(after.match(/^\s*(?:\/|per\b)\s*([^\r\n]*)/i)?.[1] ?? "")
    .toLowerCase()
    .replace(/^per\s+/, "");
  if (/^\s*one[\s-]*time/i.test(after)) return "one-time";
  if (!raw) return "ea";
  if (/^(year|yr)\b.*per user/.test(raw)) return "user/yr";
  if (/^(year|yr)\b.*per workstation/.test(raw)) return "workstation/yr";
  if (/^(year|yr)\b/.test(raw)) return "yr";
  if (/^(hour|hr)\b/.test(raw)) return "hr";
  if (/^(mo|month)\b/.test(raw)) return "mo";
  if (/^(each|ea)\b/.test(raw)) return "ea";
  if (/one\s*time/.test(raw)) return "one-time";
  return raw.replace(/\/year\b/, "/yr").replace(/\/per\s+/g, "/").split(/\s+[(+,;]|\s+per\b/)[0].trim().split(/\s+/).slice(0, 2).join(" ");
}

/** The single price on the description's last priced line, or why not. */
function priceOf(desc) {
  const lines = String(desc).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const pricedLines = lines.filter((l) => [...l.matchAll(AMOUNT)].length > 0);
  const priced = pricedLines[pricedLines.length - 1];
  if (!priced) return { reason: /%/.test(desc) ? "Priced as a percentage of another item" : "No price in the description" };
  // Tiers or a per-unit price with a minimum, spread over several lines.
  const allValues = new Set(pricedLines.flatMap((l) => [...l.matchAll(AMOUNT)].map((h) => money(h[0]))));
  if (allValues.size > 1) return { reason: `Several prices in the description (tiers or minimums): "${pricedLines.join(" / ").slice(0, 80)}"` };
  if (/^\s*[<>]|^\s*[\d,]+\s*(-|to)\s*[\d,]+\s+\w+\s*:/i.test(priced)) return { reason: `Price applies only to one tier: "${priced.slice(0, 80)}"` };
  if (/\+|%/.test(priced)) return { reason: `Price has more than one part: "${priced.slice(0, 80)}"` };
  if (/\b(up to|starting at|starts at|as low as|minimum|min\.|from \$)/i.test(priced))
    return { reason: `Price is a ceiling or starting point: "${priced.slice(0, 80)}"` };
  const hits = [...priced.matchAll(AMOUNT)];
  const values = [...new Set(hits.map((h) => money(h[0])))];
  if (values.length !== 1) return { reason: `Several prices on one line: "${priced.slice(0, 80)}"` };
  const h = hits[hits.length - 1];
  return { price: values[0], unit: unitOf(priced.slice(h.index + h[0].length)), line: priced };
}

/** Population band in a product name, e.g. "(50k - 150k)", "(<250k)", "(Under 25k)",
 * or "(Tier B - population 80,001-160,000)". */
function bandOf(name) {
  const tier = name.match(/population\s*(>|<)?\s*([\d,]+)\s*(?:-|–|to)?\s*([\d,]+)?/i);
  if (tier) {
    const a = parseInt(tier[2].replace(/,/g, ""), 10);
    const b = tier[3] ? parseInt(tier[3].replace(/,/g, ""), 10) : null;
    const label = clean(tier[0]);
    if (tier[1] === ">") return { min: a, max: Infinity, label };
    if (tier[1] === "<") return { min: 0, max: a, label };
    if (b !== null) return { min: a, max: b, label };
  }
  const plus = name.match(/\((\d+(?:\.\d+)?)\s*([kKmM])\s*\+\)/);
  if (plus) return { min: parseFloat(plus[1]) * (/m/i.test(plus[2]) ? 1_000_000 : 1_000), max: Infinity, label: clean(plus[0].slice(1, -1)) };
  const paren = [...name.matchAll(/\(([^)]*\d[^)]*)\)/g)].map((m) => m[1]).find((p) => /\d\s*[kKmM]\b/.test(p));
  if (!paren) return null;
  const n = (s) => parseFloat(s) * (/m/i.test(s) ? 1_000_000 : 1_000);
  const nums = [...paren.matchAll(/(\d+(?:\.\d+)?)\s*([kKmM])/g)].map((m) => n(m[1] + m[2]));
  if (!nums.length) return null;
  if (/^\s*(<|under)/i.test(paren)) return { min: 0, max: nums[0], label: clean(paren) };
  if (/^\s*>/.test(paren)) return { min: nums[0], max: Infinity, label: clean(paren) };
  if (nums.length >= 2) return { min: Math.min(...nums), max: Math.max(...nums), label: clean(paren) };
  return null;
}

const wb = XLSX.read(readFileSync(SRC), { type: "buffer" });
const items = [];
const skipped = [];
for (const sheet of wb.SheetNames) {
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheet], { header: 1, blankrows: false, defval: "" });
  const head = rows[0].map((h) => clean(h).replace(/\*/g, ""));
  const col = (re) => head.findIndex((h) => re.test(h));
  const cParent = col(/^Parent/i);
  const cChild1 = col(/Level 1/i);
  const cChild2 = col(/Level 2/i);
  const cSku = col(/SKU/i);
  const cName = col(/ProductName/i);
  const cDesc = col(/ProductDescription/i);
  rows.slice(1).forEach((r, i) => {
    const sku = clean(r[cSku]);
    const name = clean(r[cName]);
    if (!name) return;
    const p = priceOf(r[cDesc]);
    const path = [r[cParent], cChild1 >= 0 ? r[cChild1] : "", cChild2 >= 0 ? r[cChild2] : ""].map(clean).filter(Boolean);
    if (p.reason) return skipped.push({ sku, name, reason: p.reason });
    const firstSentence = clean(String(r[cDesc]).split(/\r?\n/)[0]).split(/(?<=\.)\s/)[0];
    const band = bandOf(name);
    items.push({
      sku: sku || `TYL-${sheet.slice(0, 10)}-${i + 2}`,
      title: name,
      path: path.join(" › "),
      detail: firstSentence.length > 140 ? firstSentence.slice(0, 137).trimEnd() + "…" : firstSentence,
      unit: p.unit,
      unit_price: p.price,
      category: p.unit === "hr" ? "Professional services" : "Software and services",
      band: band ? { min: band.min, max: band.max === Infinity ? null : band.max, label: band.label } : null,
      source_row: `${sheet}, row ${i + 2}`,
      price_line: p.line,
    });
  });
}

writeFileSync(
  OUT,
  JSON.stringify(
    {
      source_file: "tyler-technologies-price-catalog-2025-03.xlsx",
      imported: items.length,
      skipped_count: skipped.length,
      items,
      skipped,
    },
    null,
    1,
  ),
);
console.log(`Imported ${items.length} priced rows, skipped ${skipped.length}. Wrote ${OUT}`);
const reasons = {};
for (const s of skipped) reasons[s.reason.replace(/:.*/, "")] = (reasons[s.reason.replace(/:.*/, "")] ?? 0) + 1;
console.log(reasons);
