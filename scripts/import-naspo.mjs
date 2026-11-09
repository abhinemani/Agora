// Reads one NASPO ValuePoint portfolio from naspovaluepoint.org and writes its
// supplier awards to seed/catalogs/naspo-<portfolio>.json: master agreement
// number, award and expiration dates, the states with a participating
// addendum, and links to the source documents. Prices are not read here; see
// import-price-catalog.mjs for a supplier's price file.
//
//   node scripts/import-naspo.mjs [portfolio-slug]   (default: citizen-engagement-platforms)
//
// Needs network access to www.naspovaluepoint.org.

import { writeFileSync } from "node:fs";

const SITE = "https://www.naspovaluepoint.org";
const slug = process.argv[2] ?? "citizen-engagement-platforms";

const STATES = {
  Alabama: "AL", Alaska: "AK", Arizona: "AZ", Arkansas: "AR", California: "CA", Colorado: "CO", Connecticut: "CT", Delaware: "DE", "District of Columbia": "DC",
  Florida: "FL", Georgia: "GA", Guam: "GU", Hawaii: "HI", Idaho: "ID", Illinois: "IL", Indiana: "IN", Iowa: "IA", Kansas: "KS", Kentucky: "KY", Louisiana: "LA",
  Maine: "ME", Maryland: "MD", Massachusetts: "MA", Michigan: "MI", Minnesota: "MN", Mississippi: "MS", Missouri: "MO", Montana: "MT", Nebraska: "NE", Nevada: "NV",
  "New Hampshire": "NH", "New Jersey": "NJ", "New Mexico": "NM", "New York": "NY", "North Carolina": "NC", "North Dakota": "ND", Ohio: "OH", Oklahoma: "OK",
  Oregon: "OR", Pennsylvania: "PA", "Puerto Rico": "PR", "Rhode Island": "RI", "South Carolina": "SC", "South Dakota": "SD", Tennessee: "TN", Texas: "TX",
  Utah: "UT", Vermont: "VT", Virginia: "VA", Washington: "WA", "West Virginia": "WV", Wisconsin: "WI", Wyoming: "WY",
};

const get = async (url) => {
  const r = await fetch(url, { headers: { "user-agent": "agora-prototype-importer" } });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r;
};

const decode = (s) =>
  s
    .replace(/&amp;/g, "&")
    .replace(/&#8211;/g, "–")
    .replace(/&#8217;/g, "’")
    .replace(/&#038;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&nbsp;/g, " ");

/** Page text as trimmed lines, scripts and markup removed. */
const lines = (html) =>
  decode(html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<svg[\s\S]*?<\/svg>/g, "").replace(/<[^>]+>/g, "\n"))
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

const after = (L, label) => {
  const i = L.indexOf(label);
  return i >= 0 ? L[i + 1] : null;
};
const iso = (d) => (d ? new Date(`${d} 12:00 UTC`).toISOString().slice(0, 10) : null);

const portfolios = await (await get(`${SITE}/wp-json/wp/v2/portfolio?slug=${slug}`)).json();
const portfolio = portfolios[0] ?? (() => { throw new Error(`No portfolio "${slug}"`); })();
const suppliers = await (await get(`${SITE}/wp-json/wp/v2/supplier?supplier_tax=${portfolio.supplier_tax.join(",")}&per_page=100`)).json();

const awards = [];
let lead = null;
let solicitation = null;
for (const s of suppliers) {
  const html = await (await get(s.link)).text();
  const L = lines(html);
  const ma = L.find((l) => /^MA #/.test(l))?.slice(4) ?? null;
  // Participating addenda: the state list between the second picker label and "Don't See Your State?".
  const pick = L.map((l, i) => (l === "Select a State or Territory" ? i : -1)).filter((i) => i >= 0);
  const end = L.indexOf("Don't See Your State?");
  const paStates = pick.length > 1 && end > pick[1] ? L.slice(pick[1] + 1, end).filter((n) => STATES[n]).map((n) => STATES[n]) : [];
  const leadIdx = L.indexOf("Contact the Lead State:");
  if (leadIdx >= 0) lead ??= L[leadIdx + 1];
  solicitation ??= (html.match(/\(([A-Z]{2}\d{2}-\d+)\)/) ?? [])[1] ?? null;
  const docs = [...html.matchAll(/href="(https:\/\/s3[^"]+\.(?:pdf|xlsx|xls|docx))"/g)].map((m) => m[1]);
  const masterDoc = docs.find((d) => /Master%20Agreement\.pdf$|Master%20Agreement[^/]*\.pdf$/i.test(d) && !/Amendment/i.test(d)) ?? null;
  const priceDocs = docs.filter((d) => /Catalog|Price|Cost%20Sheet|Pricing/i.test(d));
  const scope = L.filter((l) => /^Category \d+:/.test(l));
  const website = L.find((l, i) => i > L.indexOf("Contact the Supplier:") && /^[a-z0-9.-]+\.(com|org|io|net|gov|co)$/i.test(l)) ?? null;
  awards.push({
    supplier: decode(s.title.rendered),
    naspo_url: s.link,
    website,
    master_agreement: ma,
    awarded: iso(after(L, "Awarded")),
    expires: iso(after(L, "Expiration")),
    renewal_limit: iso(after(L, "Renewal Limit")),
    scope,
    pa_states: [...new Set(paStates)].sort(),
    documents: { master_agreement: masterDoc, price_files: priceDocs },
  });
  console.log(`${awards.at(-1).supplier}: ${ma}, ${awards.at(-1).pa_states.length} states`);
}

const out = {
  source: `${SITE}/portfolios/${slug}/`,
  retrieved: new Date().toISOString().slice(0, 10),
  portfolio: decode(portfolio.title.rendered),
  lead_state: lead,
  solicitation,
  awards: awards.sort((a, b) => a.supplier.localeCompare(b.supplier)),
};
const file = new URL(`../seed/catalogs/naspo-${slug}.json`, import.meta.url);
writeFileSync(file, JSON.stringify(out, null, 1) + "\n");
console.log(`Wrote ${awards.length} awards to ${file.pathname}`);
