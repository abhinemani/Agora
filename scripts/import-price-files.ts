// Reads co-op price files that list real item prices (seed/catalog/source/price-files/)
// into seed/catalog/price-rows.json, which scripts/import-catalog.ts attaches to the
// matching catalog contracts as priced offerings.
//
//   npx tsx scripts/import-price-files.ts       (PDFs need pdftotext, from poppler-utils)
//
// Every row keeps its file, page, the line it was read from and the price's vintage. A
// price is kept only when its figure appears in that line, and an award report's rows
// only when the award column says Yes. Nothing here is a checkout price: award prices
// and price-book figures are the contract's terms on the date shown.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as XLSX from "xlsx";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIR = join(ROOT, "seed/catalog/source/price-files");

export interface PriceRow {
  coop: string;
  number: string;
  supplier: string;
  product: string;
  maker: string | null;
  price: number;
  unit: string;
  /** What the figure is: an awarded bid, or a base price in a price schedule. */
  basis: "awarded_bid" | "base_price" | "list_price" | "net_price";
  /** The list price, when the file also gives a contract (net) price. */
  list?: number;
  sku?: string;
  vintage: string;
  file: string;
  source_url: string;
  page: number;
  line: string;
}

const money = (s: string) => Number(s.replace(/[$,]/g, ""));
const pdfPages = (file: string) => execFileSync("pdftotext", ["-layout", join(DIR, file), "-"], { maxBuffer: 1 << 28 }).toString("utf8").split("\f");

/** BuyBoard's catalog award reports: numbered items, then one row per bidder with price and award. */
function buyboardAwardReport(file: string, number: string, sourceUrl: string, vintage: string): PriceRow[] {
  const out: PriceRow[] = [];
  const seen = new Set<string>();
  let item = "";
  let itemNo = "";
  pdfPages(file).forEach((text, i) => {
    const lines = text.split("\n");
    for (let j = 0; j < lines.length; j++) {
      const l = lines[j];
      const head = l.match(/^(\d+)\.\s+(.*)$/);
      if (head) {
        itemNo = head[1];
        item = head[2].trim();
        continue;
      }
      // Only base model prices are item prices; the discount, labor-rate and delivery items are terms.
      if (!/^Base Model Price for /i.test(item)) continue;
      const m = l.match(/^\s*(\S.*?)\s{2,}(\S.*?)\s{2,}\$([\d,]+\.\d{2})\s+(Yes|No)\s*$/);
      if (!m || m[4] !== "Yes") continue;
      const [, vendor, model, amount] = m;
      const key = `${itemNo}|${vendor}`;
      if (seen.has(key)) continue;
      seen.add(key);
      // "Chevrolet Trailblazer Sport Utility – LS base model, complete with …" → the model and trim.
      const trim = item.replace(/^Base Model Price for /i, "").split(/\s+[–-]\s+/)[1]?.replace(/,? complete with.*$/i, "").replace(/\s*base model\s*$/i, "").trim();
      out.push({
        coop: "BuyBoard",
        number,
        supplier: vendor.trim(),
        product: trim ? `${model.trim()}, ${trim}` : model.trim(),
        maker: model.trim().split(/\s+/)[0],
        price: money(amount),
        unit: "vehicle",
        basis: "awarded_bid",
        vintage,
        file,
        source_url: sourceUrl,
        page: i + 1,
        line: l.trim().replace(/\s{2,}/g, "  "),
      });
    }
  });
  return out;
}

/** NASPO ValuePoint transit vehicle cost sheets: one tab per vehicle class, base price under "BASE VEHICLE INFORMATION". */
function naspoTransitCostSheets(file: string, number: string, supplier: string, sourceUrl: string, vintage: string): PriceRow[] {
  const wb = XLSX.read(readFileSync(join(DIR, file)));
  const out: PriceRow[] = [];
  wb.SheetNames.forEach((name, i) => {
    const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[name], { header: 1, defval: null });
    const h = rows.findIndex((r) => (r ?? []).some((c) => /^BASE PRICE$/i.test(String(c ?? "").trim())));
    if (h < 0) return;
    const cells = (rows[h + 1] ?? []).filter((c) => c !== null && String(c).trim() !== "");
    const [desc, model, price] = cells;
    if (typeof price !== "number" || !model) return;
    // The sheet's category title says what kind of bus it is ("CATEGORY 3.1 - LIGHT DUTY CUTAWAY").
    const title = String(rows.find((r) => /CATEGORY\s+[\d.]+\s*-/i.test(String(r?.[0] ?? "")))?.[0] ?? "");
    const kind = title.replace(/^.*CATEGORY\s+[\d.]+\s*-\s*/i, "").trim().toLowerCase();
    const cls = String(desc).replace(/^[\d.A-Z-]+:\s*/, "").replace(/\s+/g, " ").trim();
    out.push({
      coop: "NASPO ValuePoint",
      number,
      supplier,
      product: `${String(model).trim()} ${kind} transit bus: ${cls}`,
      maker: supplier.split(/[ ,]/)[0],
      price,
      unit: "vehicle",
      basis: "base_price",
      vintage,
      file,
      source_url: sourceUrl,
      page: i + 1,
      line: cells.map(String).join("  "),
    });
  });
  return out;
}

/** A large price file kept out of git: fetched into seed/catalog/source/price-files/cache/ when missing. */
function cached(file: string, url: string) {
  const dir = join(DIR, "cache");
  mkdirSync(dir, { recursive: true });
  if (!existsSync(join(dir, file))) execFileSync("curl", ["-sSfL", "-m", "300", "-o", join(dir, file), url]);
  return `cache/${file}`;
}

const titleCase = (s: string) => s.toLowerCase().replace(/\b([a-z])/g, (c) => c.toUpperCase());

/**
 * SitOnIt's price book: each chair family opens with featured models, each a complete
 * configuration with one list price ("GOOD :: $747" over a column of description). Columns are
 * read by position, since labels and descriptions wrap within their column.
 */
function sitonitFeatured(file: string, number: string, supplier: string, sourceUrl: string, vintage: string): PriceRow[] {
  const out: PriceRow[] = [];
  pdfPages(file).forEach((text, i) => {
    const lines = text.split("\n");
    const at = lines.findIndex((l) => /^\s*Featured Models\s*$/.test(l));
    if (at < 0) return;
    const [family, kind] = lines.filter((l) => l.trim() && !/Docusign Envelope/.test(l)).slice(0, 2).map((l) => l.trim());
    const block: string[] = [];
    for (const l of lines.slice(at + 1)) {
      if (/\|\s*November 2024 Price List/.test(l)) break;
      if (l.trim()) block.push(l);
    }
    if (!block.length) return;
    const starts = [...block[0].matchAll(/\S.*?(?=\s{3,}|$)/g)].map((m) => m.index!);
    const cols = starts.map(() => [] as string[]);
    for (const l of block)
      starts.forEach((s, c) => {
        const to = c + 1 < starts.length ? starts[c + 1] - 3 : l.length;
        const part = l.slice(Math.max(0, s - 3), to).trim();
        if (part) cols[c].push(part);
      });
    for (const col of cols) {
      const m = col.join(" ").replace(/\s+/g, " ").match(/^(.*?)\s*::\s*\$([\d,]+)\s*(.*)$/);
      if (!m) continue;
      const [, label, amount, desc] = m;
      out.push({
        coop: "NASPO ValuePoint",
        number,
        supplier,
        product: `SitOnIt ${family} ${kind.toLowerCase()}, ${titleCase(label)} model: ${desc.trim()}`,
        maker: "SitOnIt Seating",
        price: money(amount),
        unit: "each",
        basis: "list_price",
        vintage,
        file,
        source_url: sourceUrl,
        page: i + 1,
        line: block.find((l) => l.includes(`$${amount}`))?.trim().replace(/\s{2,}/g, "  ") ?? "",
      });
    }
  });
  return out;
}

/**
 * BCI Burke's OMNIA price list: part number, description, list price and net (contract) price
 * on one line. The contract's net is list less 7%, and a row is kept only when its two prices
 * agree with that, which drops the rows where the PDF's text layer pairs a list price with
 * another row's net.
 */
function burkePriceList(file: string, number: string, supplier: string, sourceUrl: string, vintage: string, discount: number): PriceRow[] {
  const out: PriceRow[] = [];
  const row = /^\s*(\S+)\s{2,}(.+?)\s{2,}\$\s*([\d,]+\.\d{2})\s+\$\s*([\d,]+\.\d{2})(?:\s+\S.*?)?\s*$/;
  let skipped = 0;
  pdfPages(file).forEach((text, i) => {
    for (const l of text.split("\n")) {
      const m = l.match(row);
      if (!m) continue;
      const [, part, desc, listS, netS] = m;
      const list = money(listS), net = money(netS);
      if (Math.abs(net - Math.round(list * (100 - discount)) / 100) > 0.011) {
        skipped++;
        continue;
      }
      out.push({
        coop: "OMNIA Partners",
        number,
        supplier,
        product: `Burke ${titleCase(desc.trim().replace(/\s+/g, " "))} (part ${part})`,
        maker: "BCI Burke",
        price: net,
        list,
        sku: part,
        unit: "each",
        basis: "net_price",
        vintage,
        file,
        source_url: sourceUrl,
        page: i + 1,
        line: l.trim().replace(/\s{2,}/g, "  "),
      });
    }
  });
  console.log(`Burke: ${out.length} parts kept; ${skipped} left out because their list and net don't agree`);
  return out;
}

const SITONIT_URL = "https://s3.us-east-1.amazonaws.com/nvp/Master%20Agreements/Exemplis%2C%20LLC/November_2024_Price_List.pdf";

const BURKE_URL = "https://www.omniapartners.com/api/document-download?contract=149002&filename=2027+Burke+Equipment+Price+List_OMNIA+Partners.pdf";

const rows: PriceRow[] = [
  ...burkePriceList("omnia-r220201-burke-2027-price-list.pdf", "R220201", "BCI Burke", BURKE_URL, "Burke 2027 price list (OMNIA net prices)", 7),
  ...sitonitFeatured(
    cached("naspo-ma3964-sitonit-price-list-2024-11.pdf", SITONIT_URL),
    "MA3964",
    "Exemplis, LLC",
    SITONIT_URL,
    "SitOnIt November 4, 2024 list",
  ),
  ...buyboardAwardReport(
    "buyboard-724-23-award-report.pdf",
    "724-23",
    "https://assets-us-01.kc-usercontent.com/37044744-256f-009a-8039-e00bdaabaf39/ad829974-90b4-42a9-956c-9c92d6a17e80/724-23-Award-Tabulation-Report.pdf",
    "December 2023 award (Dec. 2023 to Nov. 2024 period)",
  ),
  ...naspoTransitCostSheets(
    "naspo-204521-endera-attachment-d.xlsx",
    "204521",
    "Endera Motors, LLC",
    "https://s3.us-east-1.amazonaws.com/nvp/Master%20Agreements/Endera%20Motors%2C%20LLC/1778178313_Attachment%20D%20Pricing.xlsx",
    "Attachment D cost sheets (base vehicle, before options and delivery)",
  ),
];

// The trust check: every price must be printed in the line it came from.
const bad = rows.filter((r) => !r.line.replace(/[$,]/g, "").includes(String(r.price)) && !r.line.includes(r.price.toFixed(2)));
if (bad.length) throw new Error(`${bad.length} prices not found in their source line, e.g. ${JSON.stringify(bad[0])}`);

writeFileSync(join(ROOT, "seed/catalog/price-rows.json"), JSON.stringify(rows, null, 1) + "\n");
const by = rows.reduce<Record<string, number>>((m, r) => ((m[`${r.coop} ${r.number}`] = (m[`${r.coop} ${r.number}`] ?? 0) + 1), m), {});
console.log(`${rows.length} priced rows:`, by);
