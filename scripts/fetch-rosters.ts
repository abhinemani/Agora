// Downloads co-op member rosters that are published in the open, beyond the ones in the
// membership workbook, into seed/coops/source/rosters/ as CSVs in the workbook's own
// columns, so the importer reads them the same way as the workbook's roster tabs.
//
//   npm run fetch:rosters        (needs www.choicepartners.org)
//
// Choice Partners: the public "View Members" table (name, type, state, region).
// Only names, types and states are kept.
//
// 1GPA: its published membership workbook (dated August 28, 2023) can't be fetched from
// here, because Dropbox serves it from a one-time host. Save the .xlsx as
// seed/coops/source/rosters/1gpa-members-2023-08-28.xlsx and this script converts it.

import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as XLSX from "xlsx";
import { STATES } from "../lib/vehicles";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIR = join(ROOT, "seed/coops/source/rosters");
mkdirSync(DIR, { recursive: true });

const HEAD = ["Organization as published", "Entity type", "City", "State", "Program", "Source", "As of"];
const csvCell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
const stateCode = (v: string) => {
  const s = v.trim();
  return STATES.find(([c, n]) => c === s.toUpperCase() || n.toLowerCase() === s.toLowerCase())?.[0] ?? "";
};
const decode = (s: string) =>
  s
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
function write(file: string, rows: string[][]) {
  writeFileSync(join(DIR, file), [HEAD, ...rows].map((r) => r.map(csvCell).join(",")).join("\n") + "\n");
  console.log(`${file}: ${rows.length} members`);
}

/** Labels that don't say whether the member is a government; the importer then decides by name. */
const unverified = (label: string) => (!label || /^other$/i.test(label) ? "Unverified" : label);

async function choicePartners() {
  const url = "https://www.choicepartners.org/view-members/";
  const res = await fetch(url, { headers: { "user-agent": "AgoraDirectory/0.1 (public procurement research)" } });
  if (!res.ok) throw new Error(`Choice Partners: HTTP ${res.status}`);
  const html = await res.text();
  const rows: string[][] = [];
  for (const tr of html.match(/<tr\b[\s\S]*?<\/tr>/gi) ?? []) {
    const cells = (tr.match(/<td\b[\s\S]*?<\/td>/gi) ?? []).map(decode);
    if (cells.length !== 4) continue;
    const [name, type, state] = cells;
    const code = stateCode(state);
    if (!name || !code) continue;
    rows.push([name, unverified(type), "", code, "Choice Partners", url, new Date().toISOString().slice(0, 10)]);
  }
  if (rows.length < 1000) throw new Error(`Choice Partners: only ${rows.length} rows; the page layout may have changed`);
  write("choice-partners-members.csv", rows);
}

function oneGpa() {
  const file = readdirSync(DIR).find((f) => /^1gpa.*\.xlsx$/i.test(f));
  if (!file) return console.log("1GPA: no workbook saved yet (see the note at the top of this script)");
  const wb = XLSX.readFile(join(DIR, file));
  const rows: string[][] = [];
  for (const sheet of wb.SheetNames) {
    const table = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[sheet], { header: 1, defval: "" });
    const h = table.findIndex((r) => r.some((c) => /entity|member|name/i.test(String(c))) && r.some((c) => /state/i.test(String(c))));
    if (h < 0) continue;
    const head = table[h].map((c) => String(c).toLowerCase());
    const col = (re: RegExp) => head.findIndex((c) => re.test(c));
    const cName = col(/entity|member|name/), cCity = col(/city/), cState = col(/state/), cType = col(/type/);
    for (const r of table.slice(h + 1)) {
      const name = String(r[cName] ?? "").trim();
      const code = stateCode(String(r[cState] ?? ""));
      if (!name || !code) continue;
      rows.push([name, unverified(cType >= 0 ? String(r[cType]).trim() : ""), cCity >= 0 ? String(r[cCity]).trim() : "", code, "1GPA", "1GPA published membership list", "2023-08-28"]);
    }
  }
  write("1gpa-members.csv", rows);
}

(async () => {
  await choicePartners();
  if (existsSync(DIR)) oneGpa();
})();
