// Downloads the federal registries that give every government a permanent ID, and
// keeps only the columns Agora uses. Personal and contact fields (officials' names
// and titles, phone numbers, street addresses) are dropped.
//
//   npm run fetch:federal
//
// Needs network access to www2.census.gov and nces.ed.gov. Writes gzipped CSVs to
// seed/coops/source/, which scripts/import-coop-data.ts reads:
//   census-gov-units-2026.csv.gz  Census Bureau Government Units List 2026: counties,
//                                 municipalities, townships, special districts and
//                                 school districts, each with a CENSUS_ID_PID6
//   nces-ccd-lea-2024-25.csv.gz   NCES Common Core of Data, local education agency
//                                 directory 2024-25, each with an LEAID
//   ipeds-hd-2024.csv.gz          IPEDS institutional characteristics 2024, each
//                                 college with a UNITID and public/private control

import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import * as XLSX from "xlsx";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "seed/coops/source");
const SOURCES = {
  census: "https://www2.census.gov/programs-surveys/gus/datasets/2026/gov_units_2026.zip",
  ccd: "https://nces.ed.gov/ccd/Data/zip/ccd_lea_029_2425_w_0a_051425.zip",
  ipeds: "https://nces.ed.gov/ipeds/datacenter/data/HD2024.zip",
};

const work = mkdtempSync(join(tmpdir(), "federal-ids-"));

async function download(url: string, name: string) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  const path = join(work, name);
  writeFileSync(path, Buffer.from(await res.arrayBuffer()));
  return path;
}
/** One member of a zip archive, by a pattern on its name. */
function unzipMember(zip: string, pattern: RegExp): Buffer {
  const names = execFileSync("unzip", ["-Z1", zip], { encoding: "utf8" }).split("\n").filter(Boolean);
  const name = names.find((n) => pattern.test(n));
  if (!name) throw new Error(`${zip}: no member matching ${pattern} (has ${names.join(", ")})`);
  return execFileSync("unzip", ["-p", zip, name], { maxBuffer: 1 << 30 });
}

const csvCell = (v: unknown) => {
  const s = v == null ? "" : String(v).trim();
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
function writeCsv(file: string, head: string[], rows: unknown[][]) {
  const text = [head, ...rows].map((r) => r.map(csvCell).join(",")).join("\n") + "\n";
  writeFileSync(join(OUT, file), gzipSync(text, { level: 9 }));
  console.log(`${file}: ${rows.length.toLocaleString()} rows`);
}
/** A CSV file as objects (the NCES files are plain, quoted CSV). */
function readCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') (cur += '"'), i++;
      else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") row.push(cur), (cur = "");
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cur);
      rows.push(row);
      row = [];
      cur = "";
    } else cur += ch;
  }
  if (cur || row.length) row.push(cur), rows.push(row);
  const head = rows[0].map((h) => h.replace(/^﻿/, "").trim());
  return rows.slice(1).filter((r) => r.length > 1).map((r) => Object.fromEntries(head.map((h, i) => [h, (r[i] ?? "").trim()])));
}

async function main() {
// ------------------------------------------------------------ Census of Governments

{
  const zip = await download(SOURCES.census, "census.zip");
  const wb = XLSX.read(unzipMember(zip, /\.xlsx$/i), { type: "buffer" });
  // Public pension systems aren't buyers; the other four sheets are.
  const SHEETS: Record<string, string> = { "General Purpose": "general", "Special District": "special", "School District": "school", "DEP School Dist": "dependent_school" };
  const head = ["census_id", "name", "sheet", "unit_type", "function", "city", "state", "zip", "website", "population", "enrollment", "fips_state", "fips_county", "fips_place", "county", "active", "parent_census_id"];
  const rows: unknown[][] = [];
  for (const [sheet, kind] of Object.entries(SHEETS)) {
    const ws = wb.Sheets[sheet];
    if (!ws) throw new Error(`Census file: no sheet "${sheet}"`);
    for (const r of XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: "" })) {
      rows.push([
        r.CENSUS_ID_PID6,
        r.UNIT_NAME,
        kind,
        r.UNIT_TYPE,
        r.FUNCTION_NAME ?? "",
        r.CITY,
        r.STATE,
        String(r.ZIP ?? "").slice(0, 5),
        r.WEB_ADDRESS,
        String(r.POPULATION ?? "").replace(/,/g, ""),
        String(r.SCHOOL_ENROLLMENT ?? "").replace(/,/g, ""),
        r.FIPS_STATE,
        r.FIPS_COUNTY,
        r.FIPS_PLACE ?? "",
        r.COUNTY_AREA_NAME,
        r.ACTIVE,
        r.PARENT_CENSUS_ID_PID6 ?? "",
      ]);
    }
  }
  writeCsv("census-gov-units-2026.csv.gz", head, rows);
}

// ------------------------------------------------------------ NCES Common Core of Data

{
  const zip = await download(SOURCES.ccd, "ccd.zip");
  const rows = readCsv(unzipMember(zip, /\.csv$/i).toString("latin1"));
  const head = ["leaid", "name", "state", "state_leaid", "city", "website", "status", "lea_type", "lea_type_text", "charter", "operational_schools"];
  writeCsv(
    "nces-ccd-lea-2024-25.csv.gz",
    head,
    rows.map((r) => [r.LEAID, r.LEA_NAME, r.ST, r.ST_LEAID, r.LCITY || r.MCITY, r.WEBSITE, r.SY_STATUS_TEXT, r.LEA_TYPE, r.LEA_TYPE_TEXT, r.CHARTER_LEA, r.OPERATIONAL_SCHOOLS]),
  );
}

// ------------------------------------------------------------ IPEDS

{
  const zip = await download(SOURCES.ipeds, "ipeds.zip");
  const rows = readCsv(unzipMember(zip, /\.csv$/i).toString("latin1"));
  // CONTROL: 1 public, 2 private nonprofit, 3 private for-profit. CYACTIVE: 1 active this year.
  const head = ["unitid", "name", "alias", "city", "state", "website", "control", "sector", "level", "active", "county", "system"];
  writeCsv(
    "ipeds-hd-2024.csv.gz",
    head,
    rows.map((r) => [r.UNITID, r.INSTNM, r.IALIAS, r.CITY, r.STABBR, r.WEBADDR, r.CONTROL, r.SECTOR, r.ICLEVEL, r.CYACTIVE, r.COUNTYNM, r.F1SYSNAM === "-2" ? "" : r.F1SYSNAM]),
  );
}

  console.log(`Sources: ${Object.values(SOURCES).join(", ")}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
