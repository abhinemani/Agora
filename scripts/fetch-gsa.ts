// Downloads GSA's Multiple Award Schedule data from the GSA eLibrary, and keeps what
// Agora needs to describe and date GSA contracts:
//
//   npm run fetch:gsa
//
// Needs network access to www.gsaelibrary.gsa.gov and gsaelibrary.gsa.gov. Writes:
//   seed/catalog/source/gsa-sins.json             every MAS Special Item Number (SIN): its
//                                                 title, description, and whether state and
//                                                 local governments may buy it through GSA
//                                                 cooperative purchasing
//   seed/catalog/source/gsa-mas-contracts.csv.gz  one row per contract and SIN: contract
//                                                 number, vendor, SIN, subcategory, end dates,
//                                                 company website and SAM UEI
//
// Contact names, phone numbers, emails and street addresses in GSA's file are left out.

import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "seed/catalog/source");
const SUMMARY = "https://www.gsaelibrary.gsa.gov/ElibMain/scheduleSummary.do?scheduleNumber=MAS";
const CONTRACTS = "https://gsaelibrary.gsa.gov/elib_contracts/schedule_MAS.csv";

const text = async (url: string, encoding: BufferEncoding = "utf8") => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer()).toString(encoding);
};
const unescape = (s: string) =>
  s
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();

/** A CSV file as rows of cells, with quoted fields and embedded newlines. */
function csvRows(src: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (q) {
      if (ch === '"' && src[i + 1] === '"') (cur += '"'), i++;
      else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") row.push(cur), (cur = "");
    else if (ch === "\n") row.push(cur), rows.push(row), (row = []), (cur = "");
    else if (ch !== "\r") cur += ch;
  }
  if (cur || row.length) row.push(cur), rows.push(row);
  return rows;
}
const cell = (v: unknown) => {
  const s = v == null ? "" : String(v).trim();
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
/** "Jul 31, 2044" → "2044-07-31". */
function isoDate(s: string): string {
  const d = new Date(`${s.trim()} 12:00 UTC`);
  return s.trim() && !Number.isNaN(d.getTime()) ? d.toISOString().slice(0, 10) : "";
}

async function main() {
  // Every SIN on the schedule: "SIN | Title - Description [NOTE: Subject to Cooperative Purchasing]".
  const html = await text(SUMMARY, "latin1");
  const sins: Record<string, { title: string; description: string; cooperative: boolean }> = {};
  for (const tr of html.match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) ?? []) {
    const cells = (tr.match(/<td[^>]*>[\s\S]*?<\/td>/gi) ?? []).map(unescape);
    const code = cells.find((c) => /^[0-9A-Z]{3,12}$/.test(c));
    if (!code || code === "MAS") continue;
    const body = cells[cells.indexOf(code) + 1] ?? "";
    if (!body || sins[code]) continue;
    const dash = body.indexOf(" - ");
    sins[code] = {
      title: (dash > 0 ? body.slice(0, dash) : body).trim(),
      description: (dash > 0 ? body.slice(dash + 3) : "").replace(/\s*NOTE:.*$/i, "").trim(),
      cooperative: /subject to cooperative purchasing/i.test(body),
    };
  }
  writeFileSync(join(OUT, "gsa-sins.json"), JSON.stringify({ source: SUMMARY, retrieved: new Date().toISOString().slice(0, 10), sins }, null, 1) + "\n");
  console.log(`gsa-sins.json: ${Object.keys(sins).length} SINs, ${Object.values(sins).filter((s) => s.cooperative).length} open to cooperative purchasing`);

  // One row per contract and SIN.
  const rows = csvRows(await text(CONTRACTS, "latin1"));
  const head = rows[0].map((h) => h.replace(/\s+/g, " ").trim());
  const at = (name: RegExp) => head.findIndex((h) => name.test(h));
  const col = {
    large: at(/^Large Category$/),
    sub: at(/^Sub Category$/),
    sin: at(/^Category$/),
    vendor: at(/^Vendor$/),
    contract: at(/^Contract #$/),
    url: at(/^URL$/),
    option: at(/^Current Option Period End Date$/),
    ultimate: at(/^Ultimate Contract End Date$/),
    uei: at(/^SAM UEI$/),
    coop: at(/Coop/i),
    catalog: at(/^View Catalog$/),
  };
  for (const [k, i] of Object.entries(col)) if (i < 0) throw new Error(`GSA contract file: no "${k}" column`);
  const out = [["contract", "vendor", "sin", "large_category", "sub_category", "website", "option_end", "ultimate_end", "uei", "coop_terms", "catalog_url"]];
  for (const r of rows.slice(1)) {
    if (!r[col.contract]) continue;
    out.push([r[col.contract], r[col.vendor], r[col.sin], r[col.large], r[col.sub], r[col.url], isoDate(r[col.option] ?? ""), isoDate(r[col.ultimate] ?? ""), r[col.uei], r[col.coop], r[col.catalog]]);
  }
  writeFileSync(join(OUT, "gsa-mas-contracts.csv.gz"), gzipSync(out.map((r) => r.map(cell).join(",")).join("\n") + "\n", { level: 9 }));
  console.log(`gsa-mas-contracts.csv.gz: ${(out.length - 1).toLocaleString()} contract/SIN rows, ${new Set(out.slice(1).map((r) => r[0])).size.toLocaleString()} contracts`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
