// A live check of a Texas certification against the Comptroller's CMBL/VetHUB directory
// (mycpa.cpa.state.tx.us/tpasscmblsearch). The host publishes no robots.txt; Loci asks one
// question at a time, only when a supplier or an admin asks for a check, as a plain request
// that names itself. Server only.
//
// The directory answers with contacts and a vendor ID; Loci keeps only the company's name, city
// and status flags. A Texas vendor ID can be built from a sole proprietor's Social Security
// number, so it is never stored or shown.

import { CMBL_SEARCH_URL } from "./service-listing";
import type { CertificationCheck, CertificationKind } from "./types";

const BASE = "https://mycpa.cpa.state.tx.us/tpasscmblsearch";
const AGENT = "Loci certification check (agora.ethoslabs.us)";
const SOURCE = "Texas Comptroller, CMBL/VetHUB directory";

interface Row {
  name: string;
  city: string | null;
  small_business: boolean | null;
  cmbl: string | null;
  vethub: string | null;
}

/** "Hartmann Window Cleaning, LLC" → "hartmann window cleaning": legal suffixes and punctuation dropped. */
export const companyKey = (n: string) =>
  n
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\b(llc|l l c|inc|incorporated|corp|corporation|co|company|ltd|lp|llp|pllc|dba)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const text = (s: string) =>
  s
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** The results table: the columns asked for, by their headings. */
export function parseResults(html: string): { rows: Row[]; summary: string | null } {
  // "Search found 8 vendors, …" over a result list; "Sorry, No vendors found …" when nothing matched.
  const summary = html.match(/Search found[^<]*/)?.[0]?.trim() ?? (/No vendors found/i.test(html) ? "No vendors found" : null);
  for (const table of html.match(/<table[\s\S]*?<\/table>/gi) ?? []) {
    const trs = table.match(/<tr[\s\S]*?<\/tr>/gi) ?? [];
    if (!trs.length) continue;
    const cells = (tr: string) => [...tr.matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi)].map((m) => text(m[1]));
    const head = cells(trs[0]!).map((h) => h.toLowerCase());
    const col = (re: RegExp) => head.findIndex((h) => re.test(h));
    const name = col(/company name/);
    if (name < 0) continue;
    const city = col(/^city$/), small = col(/small business/), cmbl = col(/cmbl status/), vet = col(/vethub status/);
    const rows = trs.slice(1).map((tr) => {
      const c = cells(tr);
      const yes = small >= 0 ? c[small]?.toLowerCase() : "";
      return {
        name: c[name] ?? "",
        city: city >= 0 ? c[city] || null : null,
        small_business: yes === "yes" ? true : yes === "no" ? false : null,
        cmbl: cmbl >= 0 ? c[cmbl] || null : null,
        vethub: vet >= 0 ? c[vet] || null : null,
      };
    });
    return { rows: rows.filter((r) => r.name), summary };
  }
  return { rows: [], summary };
}

const active = (status: string | null) => Boolean(status && /^(a-)?active\b/i.test(status));

/** Look a company up by name and judge the claim against what the directory lists. */
export async function checkTexasCertification(kind: Extract<CertificationKind, "tx_cmbl_small_business" | "tx_vethub">, company: string): Promise<CertificationCheck> {
  const checked_at = new Date().toISOString();
  const base = { checked_at, source: SOURCE, source_url: CMBL_SEARCH_URL };
  const key = companyKey(company);
  if (!key) return { ...base, status: "not_found", note: "No company name to look up." };
  // The form takes 20 characters of a name; the first words are enough to find it.
  const query = key.split(" ").reduce((q, w) => (`${q} ${w}`.trim().length <= 20 ? `${q} ${w}`.trim() : q), "");
  const form = new URLSearchParams({
    searchType: "All Vendors",
    vendorId: "",
    vendorNumber: "",
    vndrNameCond: "contains",
    vendorName: query,
    _inclInactiveVndrs: "on",
    category: "",
    countyName: "",
    cityCond: "begins with",
    cityName: "",
    zipCond: "exact",
    zip: "",
    nonSolDistricts: "",
    outputAs: "OUTPUT_AS_DETAIL_LIST",
    sortBy: "SORT_BY_VNDR_NAME",
    search: "search",
  });
  for (let i = 0; i < 3; i++) for (const f of ["secNIGPClassCd", "items", "highwayDist"]) form.set(`${f}[${i}]`, "");
  for (const c of ["companyName", "city", "smallBusiness"]) form.append("selectedColumns", c);
  try {
    const signal = AbortSignal.timeout(25_000);
    const first = await fetch(`${BASE}/index.jsp`, { headers: { "user-agent": AGENT }, signal });
    const cookie = (first.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
    const res = await fetch(`${BASE}/tpasscmblsearch.do`, {
      method: "POST",
      headers: { "user-agent": AGENT, "content-type": "application/x-www-form-urlencoded", ...(cookie ? { cookie } : {}) },
      body: form.toString(),
      signal,
    });
    if (!res.ok) return { ...base, status: "unreachable", note: `The directory answered ${res.status}.` };
    const { rows, summary } = parseResults(await res.text());
    if (!summary) return { ...base, status: "unreachable", note: "The directory didn't return a result list." };
    const same = rows.filter((r) => companyKey(r.name) === key);
    if (!same.length) return { ...base, status: "not_found", note: rows.length ? `${rows.length} listed name${rows.length === 1 ? "" : "s"} begin the same way, none is this company.` : "No company by this name is on the directory." };
    // Prefer a record that's active on the list.
    const r = same.find((x) => active(x.cmbl) || active(x.vethub)) ?? same[0];
    const listed = { name: r.name, city: r.city, small_business: r.small_business, cmbl: r.cmbl, vethub: r.vethub };
    const holds = kind === "tx_vethub" ? active(r.vethub) : r.small_business === true && active(r.cmbl);
    return {
      ...base,
      status: holds ? "confirmed" : "not_listed",
      listed,
      ...(same.length > 1 ? { matches: same.length } : {}),
      note: holds
        ? undefined
        : kind === "tx_vethub"
          ? `Listed, with VetHUB status ${r.vethub ?? "not shown"}.`
          : `Listed${r.small_business === false ? " without the small business flag" : ""}${active(r.cmbl) ? "" : `, CMBL status ${r.cmbl ?? "not shown"}`}.`,
    };
  } catch (e) {
    return { ...base, status: "unreachable", note: (e as Error).name === "TimeoutError" ? "The directory didn't answer in 25 seconds." : "The directory couldn't be reached." };
  }
}
