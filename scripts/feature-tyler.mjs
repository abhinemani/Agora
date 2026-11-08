// Picks the 100 Tyler products a local government is most likely to buy and
// marks their rows `featured` in the catalog JSON. Every row stays in the file,
// so the cut can be widened by changing the quotas below and rerunning.
//   node scripts/feature-tyler.mjs [--preview]

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const FILE = join(dirname(fileURLToPath(import.meta.url)), "..", "seed", "catalogs", "tyler-technologies-2025-03.json");
const TOTAL = 100;

/** Products per product line, so the cut covers every kind of purchase. */
const QUOTA = {
  "Enterprise Public Safety": 16,
  "Data & Insights": 15,
  "Application Platform": 9,
  "Resident Engagement": 8,
  "Enterprise Payments": 8,
  "Enterprise Records Management": 8,
  "Enforcement Mobile": 6,
  "Enterprise Supervision": 4,
  "Civil Process": 4,
  "Fire Prevention Mobile Platform": 4,
  "Enterprise Jury Manager": 4,
  "Enterprise Permitting & Licensing (EP&L)": 3,
  "Assessment & Tax Pro": 3,
  "Enterprise Assessment & Tax": 2,
};

// What a city, county or school district buys outright: core software.
const CORE_PATH = /subscription software|core application|licensed software|software license|payments platform|disbursements|cashiering|resident engagement platform|application platform & modules|1 year term|perpetual|flip to saas/i;
const CORE_TITLE = /platform|suite|foundation|manager|portal|open (budget|data|checkbook|payroll)|records|permit|licens|cashier|payment|engagement|gov2go|appointment|jury|supervision|civil process|content manager|budget|cad|dispatch|mobile|citation|inspection|evidence|insights|checkbook|payroll/i;
// Fine print: add-ons, services, hardware, and offerings for states or federal agencies.
const NOISE_PATH = /third party|training|implementation services|professional services|other services|hardware|hosting add-ons|add on|setup|state regulatory|state agencies|software maintenance|value add/i;
const NOISE_TITLE = /\bfed\b|federal|\bstate\b|interface|connector|add[- ]?on|additional|language pack|expansion pack|read only|travel|training|implementation|conversion|migration|cable|stand|drawer|scanner|printer|hardware|text messaging|postcard|per piece|maintenance|api\b|sandbox|test environment|storage|certification|data load/i;

const fitsLocal = (rows) => {
  const banded = rows.filter((r) => r.band);
  if (!banded.length) return true;
  // Some tier must fit a local government of 10,000 to 500,000 people.
  return banded.some((r) => r.band.min <= 500_000 && (r.band.max === null || r.band.max >= 10_000));
};

function scoreFamily(rows) {
  const r = rows[0];
  const title = r.title;
  let s = 0;
  if (CORE_PATH.test(r.path)) s += 3;
  if (CORE_TITLE.test(title)) s += 2;
  if (NOISE_PATH.test(r.path)) s -= 4;
  if (NOISE_TITLE.test(title)) s -= 4;
  const units = new Set(rows.map((x) => x.unit));
  if (units.has("yr") || units.has("mo") || units.has("user/yr")) s += 2;
  else if (units.has("ea") || units.has("one-time")) s += 0.5;
  else if (units.has("hr")) s -= 1;
  else s -= 2; // per-text, per-postcard and other usage fees
  if (rows.length > 1) s += 0.5; // tiered pricing usually means a headline product
  // State- and enterprise-scale offerings are not what a local government buys.
  const cheapest = Math.min(...rows.map((x) => x.unit_price));
  if (/^(yr|mo)$/.test(r.unit) && cheapest * (r.unit === "mo" ? 12 : 1) > 400_000) s -= 3;
  s -= Math.max(0, title.split(/\s+/).length - 6) * 0.15; // long names are usually fine print
  return s;
}

const data = JSON.parse(readFileSync(FILE, "utf8"));
const families = new Map();
for (const item of data.items) {
  if (!families.has(item.family)) families.set(item.family, []);
  families.get(item.family).push(item);
}

const scored = [...families.entries()]
  .filter(([, rows]) => fitsLocal(rows))
  .map(([family, rows]) => ({ family, rows, line: rows[0].path.split(" › ")[0], score: scoreFamily(rows) }))
  .filter((f) => f.score > 0)
  .sort((a, b) => b.score - a.score || a.rows[0].title.localeCompare(b.rows[0].title));

/** A product's name without tier qualifiers or plurals, so "CAD Data Mart" and
 * "CAD Data Mart Includes 2 users", or "Perspective" and "Perspectives", match. */
const productName = (title) =>
  title
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/includes\s+[\d+\-\s]+users?/g, " ")
    .replace(/[<>]\s*[\d,]+\s*users?/g, " ")
    .replace(/#\s*recorded documents\/yr.*$/, " ")
    .replace(/^\d+\s+/, "")
    .replace(/[^a-z0-9 ]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => (w.length > 3 && w.endsWith("s") ? w.slice(0, -1) : w))
    .join(" ");

// Distinct names only: two SKUs with the same name read as duplicates.
const chosen = [];
const names = new Set();
const perLine = {};
const cap = (line) => (QUOTA[line] ?? 2) + 4;
const take = (f) => {
  const name = productName(f.rows[0].title);
  if (names.has(name) || chosen.includes(f)) return false;
  names.add(name);
  chosen.push(f);
  perLine[f.line] = (perLine[f.line] ?? 0) + 1;
  return true;
};
// Quota picks need a real score: no padding a line with gift cards.
for (const [line, n] of Object.entries(QUOTA)) {
  let got = 0;
  for (const f of scored) if (got < n && f.line === line && f.score >= 2 && take(f)) got++;
}
// Fill the rest by rotating across lines, best remaining product from each in turn.
const lines = [...new Set(scored.map((f) => f.line))];
let progress = true;
while (chosen.length < TOTAL && progress) {
  progress = false;
  for (const line of lines) {
    if (chosen.length >= TOTAL) break;
    if ((perLine[line] ?? 0) >= cap(line)) continue;
    const next = scored.find((f) => f.line === line && f.score >= 2 && !chosen.includes(f) && !names.has(productName(f.rows[0].title)));
    if (next && take(next)) progress = true;
  }
}

// Lines short of good products leave room: fill it from the best overall.
for (const f of scored) if (chosen.length < TOTAL && f.score >= 2) take(f);

const picked = new Set(chosen.map((f) => f.family));
for (const item of data.items) item.featured = picked.has(item.family);
data.featured_products = chosen.length;
data.featured_rows = data.items.filter((i) => i.featured).length;

if (process.argv.includes("--preview")) {
  const byLine = {};
  for (const f of chosen) (byLine[f.line] ??= []).push(f);
  for (const [line, fs] of Object.entries(byLine)) {
    console.log(`\n${line} (${fs.length})`);
    for (const f of fs) console.log(`  ${f.score.toFixed(1).padStart(5)}  ${f.rows[0].title.slice(0, 70)}  [${f.rows.length} tier${f.rows.length > 1 ? "s" : ""}, $${f.rows[0].unit_price.toLocaleString()} / ${f.rows[0].unit}]`);
  }
} else {
  writeFileSync(FILE, JSON.stringify(data, null, 1));
}
console.log(`\nFeatured ${chosen.length} products (${data.featured_rows} price rows) of ${families.size}.`);
