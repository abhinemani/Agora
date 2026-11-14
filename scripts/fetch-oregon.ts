// Oregon's statewide price agreements, from OregonBuys (the state's Periscope portal, the same software as
// NJSTART). DAS Procurement Services runs the agreements; members of OrCPP, Oregon's cooperative purchasing
// program, may buy from the ones whose page says "Cooperative Purchasing Allowed: Yes".
//
//   npm run fetch:oregon                 all three steps
//   npm run fetch:oregon -- list         export DAS Procurement Services' active blankets (CSV, via a browser:
//                                        the portal's export is a JSF form post)
//   npm run fetch:oregon -- pages        each blanket's public summary page, one at a time, resumable
//                                        (add --reverse to run a second pass from the end of the list)
//   npm run fetch:oregon -- members      DAS's OrCPP membership list (names, member numbers, types)
//
// Writes seed/catalog/source/oregon/cache/ (gitignored); npm run import:oregon -- --read reads it.
// Robots rules, checked November 14, 2026: oregonbuys.gov redirects robots.txt to its vendor's, which bars only
// /craft; www.oregon.gov bars admin, search and some agency paths, not /das/Procurement.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CACHE = join(ROOT, "seed/catalog/source/oregon/cache");
const PORTAL = "https://oregonbuys.gov/bso";
const SEARCH = `${PORTAL}/view/search/external/advancedSearchContractBlanket.xhtml`;
const DAS = "10700";
const PROCUREMENT_SERVICES = "107090";
// DAS's OrCPP membership pages (Orcppmember.aspx and one per member type) fill their tables from this public
// SharePoint list; only each member's name, OrCPP number and type are kept.
const MEMBERS = "https://www.oregon.gov/das/Procurement/_api/web/GetList('/das/Procurement/Lists/OrCPPMembers2')/items?$top=5000&$select=Agency,Agency_x0020__x0023_,Code";
const UA = "Mozilla/5.0 (compatible; AgoraProcurementResearch/1.0)";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const step = process.argv[2];
mkdirSync(join(CACHE, "pages"), { recursive: true });

function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = "";
  let q = false;
  const s = text.replace(/^﻿/, "");
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (q) {
      if (ch === '"' && s[i + 1] === '"') (cur += '"'), i++;
      else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") row.push(cur), (cur = "");
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && s[i + 1] === "\n") i++;
      row.push(cur), rows.push(row), (row = []), (cur = "");
    } else cur += ch;
  }
  if (cur || row.length) row.push(cur), rows.push(row);
  const [head, ...body] = rows.filter((r) => r.length > 1 || r[0]);
  return body.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ""])));
}

async function list() {
  // Playwright is preinstalled where the rehearsal runs, not a dependency of the app, so it's loaded untyped.
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any
  const { chromium } = require("playwright") as { chromium: any };
  const proxy = process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY } : undefined;
  const browser = await chromium.launch({ proxy });
  const ctx = await browser.newContext({ acceptDownloads: true, userAgent: UA });
  const page = await ctx.newPage();
  await page.goto(SEARCH, { waitUntil: "networkidle", timeout: 120_000 });
  await page.selectOption("#contractBlanketSearchForm\\:organization", DAS);
  await page.waitForFunction((v: string) => !!document.querySelector(`#contractBlanketSearchForm\\:departmentPrefix option[value="${v}"]`), PROCUREMENT_SERVICES, { timeout: 30_000 });
  await page.selectOption("#contractBlanketSearchForm\\:departmentPrefix", PROCUREMENT_SERVICES);
  await page.click("#contractBlanketSearchForm\\:btnPoSearch");
  await page.waitForLoadState("networkidle");
  await page.waitForSelector('a[title="Export to CSV File"]', { state: "attached", timeout: 60_000 });
  const count = (await page.innerText("body")).match(/\d[\d,]*\s*-\s*\d[\d,]*\s+of\s+(\d[\d,]*)/)?.[1];
  const [dl] = await Promise.all([
    page.waitForEvent("download", { timeout: 300_000 }),
    page.evaluate(() => (document.querySelector('a[title="Export to CSV File"]') as HTMLAnchorElement).click()),
  ]);
  await dl.saveAs(join(CACHE, "list.csv"));
  await browser.close();
  const rows = parseCsv(readFileSync(join(CACHE, "list.csv"), "utf8"));
  writeFileSync(join(CACHE, "list.json"), JSON.stringify({ source_url: SEARCH, organization: "Department of Administrative Services", department: "107090 - Procurement Services", retrieved: new Date().toISOString().slice(0, 10), listed: Number(count?.replace(/,/g, "") ?? rows.length), exported: rows.length }, null, 1) + "\n");
  console.log(`Exported ${rows.length} active DAS Procurement Services blankets (the portal lists ${count}).`);
}

export const pageUrl = (id: string) => `${PORTAL}/external/purchaseorder/poSummary.sda?docId=${encodeURIComponent(id)}&releaseNbr=0&external=true&parentUrl=close`;
/** Scripts, styles and the JSF view state are noise; the page's text and links are what the importer reads. */
const slim = (html: string) =>
  html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<input[^>]*type="hidden"[^>]*>/gi, "")
    .replace(/\n\s*\n+/g, "\n");

async function get(url: string): Promise<string> {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(60_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (e) {
      if (attempt >= 4) throw e;
      await sleep(5000 * attempt);
    }
  }
}

async function pages() {
  const rows = parseCsv(readFileSync(join(CACHE, "list.csv"), "utf8"));
  let fetched = 0;
  const failed: string[] = [];
  // --reverse walks the list from the end, so a second run can share the work; each skips pages already saved.
  const reverse = process.argv.includes("--reverse");
  for (const [i, r] of (reverse ? [...rows].reverse() : rows).entries()) {
    const id = r["Blanket #"];
    const file = join(CACHE, "pages", `${id.replace(/[^A-Za-z0-9._-]/g, "_")}.html`);
    if (existsSync(file)) continue;
    try {
      const html = await get(pageUrl(id));
      if (!/Header Information/.test(html)) throw new Error("no contract header on the page");
      writeFileSync(file, slim(html));
      fetched++;
    } catch (e) {
      failed.push(`${id}: ${(e as Error).message}`);
    }
    if ((i + 1) % 50 === 0) console.log(`${i + 1} of ${rows.length}`);
    await sleep(1500);
  }
  writeFileSync(join(CACHE, reverse ? "pages-failed-reverse.json" : "pages-failed.json"), JSON.stringify(failed, null, 1) + "\n");
  console.log(`Fetched ${fetched} pages; ${failed.length} failed.`);
}

async function members() {
  const res = await fetch(MEMBERS, { headers: { "user-agent": UA, accept: "application/json;odata=nometadata" }, signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`OrCPP member list: HTTP ${res.status}`);
  const rows = ((await res.json()) as { value: { Agency: string; Agency_x0020__x0023_: string | null; Code: string[] | null }[] }).value;
  const members = rows.map((r) => ({ name: r.Agency.replace(/\s+/g, " ").trim(), number: r.Agency_x0020__x0023_?.trim() || null, type: r.Code?.[0] ?? null }));
  writeFileSync(join(CACHE, "members.json"), JSON.stringify({ source_url: "https://www.oregon.gov/das/Procurement/Pages/Orcppmember.aspx", retrieved: new Date().toISOString().slice(0, 10), members }, null, 1) + "\n");
  console.log(`Read ${members.length} OrCPP members.`);
}

(async () => {
  if (!step || step === "list") await list();
  if (!step || step === "members") await members();
  if (!step || step === "pages") await pages();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
