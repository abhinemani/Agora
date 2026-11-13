// Builds Agora's co-op directory from the public cooperative purchasing workbook
// (seed/coops/source/coop-memberships-2026-11-13.xlsx) and CISA's .gov registry
// (seed/coops/source/dotgov-domains-2026-11-13.csv, federal domains removed).
//
//   npm run import:coops
//
// Writes three files:
//   seed/coops/directory.json.gz   one record per government: its co-ops, the evidence
//                                  for each, its .gov domain and its Texas DIR spend.
//                                  Server-only (lib/directory.ts); never sent to the browser.
//   seed/coops/insights.json       the numbers behind the /data page.
//   seed/catalogs/naspo-contract-access.json
//                                  NASPO ValuePoint Parks and Recreation awards with their
//                                  participating states, and local governments that signed
//                                  their own addendum.
//
// Matching uses entityKey (lib/coops.ts), the same function the live matcher uses, so
// the directory and Agora's member-list matching can't disagree.

import { gzipSync } from "node:zlib";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as XLSX from "xlsx";
import { entityKey, normalizeDomain } from "../lib/coops";
import type { EntityType, MembershipEvidence } from "../lib/types";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const WORKBOOK = join(ROOT, "seed/coops/source/coop-memberships-2026-11-13.xlsx");
const DOTGOV = join(ROOT, "seed/coops/source/dotgov-domains-2026-11-13.csv");
const RETRIEVED = "2026-11-13";

// ------------------------------------------------------------------ programs

/** Co-ops Agora tracks, keyed by how the workbook names them. */
const COOPS: Record<string, string> = {
  Sourcewell: "coop_sourcewell",
  HGACBuy: "coop_hgacbuy",
  "BuyBoard National": "coop_buyboard_national",
  "BuyBoard Texas": "coop_buyboard",
  Mohave: "coop_mohave",
  "E&I": "coop_eandi",
  COSTARS: "coop_costars",
  TIPS: "coop_tips",
  "OMNIA Partners": "coop_omnia",
  "Equalis Group": "coop_equalis",
  "1GPA": "coop_1gpa",
  "Choice Partners": "coop_choice",
  PACE: "coop_pace",
  "Purchasing Cooperative of America": "coop_pca",
  "Keystone Purchasing Network": "coop_kpn",
  NPPGov: "coop_nppgov",
  PEPPM: "coop_peppm",
  "MMCAP Infuse": "coop_mmcap",
  "NASPO ValuePoint": "coop_naspo",
};
/** Contract routes that aren't co-ops (federal schedules, state programs). Kept as routes, not memberships. */
const ROUTES = ["GSA", "Texas DIR", "TXMAS", "California CMAS", "New York OGS"];

function coopFor(program: string, state: string): string | null {
  const p = program.trim();
  if (p === "BuyBoard") return state === "TX" ? "coop_buyboard" : "coop_buyboard_national";
  if (/^NASPO/i.test(p)) return "coop_naspo";
  return COOPS[p] ?? null;
}
const routeFor = (program: string) => ROUTES.find((r) => r.toLowerCase() === program.trim().toLowerCase()) ?? null;

const RANK: Record<MembershipEvidence, number> = { list: 0, roster: 1, agency: 2, purchase: 3 };

// ------------------------------------------------------------------ reading

const wb = XLSX.readFile(WORKBOOK, { cellDates: true });

/** A tab as objects, starting at the row whose first cell is `firstHeader`. */
function table(sheet: string, firstHeader: string): Record<string, unknown>[] {
  const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[sheet], { header: 1, raw: true, defval: null });
  const h = rows.findIndex((r) => String(r?.[0] ?? "").trim() === firstHeader);
  if (h < 0) throw new Error(`${sheet}: no header row starting "${firstHeader}"`);
  const head = rows[h].map((c) => String(c ?? "").trim());
  return rows
    .slice(h + 1)
    .filter((r) => r && r.some((c) => c !== null && String(c).trim() !== ""))
    .map((r) => Object.fromEntries(head.map((k, i) => [k, r[i]])));
}
const str = (v: unknown) => (v == null ? "" : v instanceof Date ? v.toISOString().slice(0, 10) : String(v).trim());
const num = (v: unknown) => (typeof v === "number" ? v : Number(String(v ?? "").replace(/[$,]/g, "")) || 0);

// ------------------------------------------------------------------ is it a government?

const PRIVATE_RE =
  /\b(church|baptist|methodist|lutheran|catholic|episcopal|presbyterian|ministr(y|ies)|christian|jewish|temple|synagogue|diocese|parish church|ymca|ywca|boys (and|&) girls|orchestra|symphony|museum|club|homeowners|hoa|apartments?|foundation|association|society|league|inc|llc|corp|corporation|company|l\.?p\.?|pllc|ltd|private|montessori|prep(aratory)? school|day school)\b/i;
const GOV_RE =
  /\b(city|town|township|village|borough|county|parish|state of|commonwealth|isd|cisd|usd|csd|school district|public schools?|schools|school|district|authority|commission|department|board|college|university|library|fire|police|sheriff|utilit(y|ies)|water|sewer|sanitation|sanitary|mud|sud|wcid|esd|fwsd|pud|fpd|transit|transportation|port|airport|housing|hospital district|parks?|recreation|metropolitan|metro|regional|council of governments|cog|tribe|tribal|nation|pueblo|rancheria|municipal|court|appraisal|emergency|911|conservation|drainage|irrigation|levee|cemetery|service center|education service|intermediate unit|boces|government|consolidated|unified|community services)\b/i;

type Status = "public" | "inferred";
/** "public": the source classifies it as a government. "inferred": the source doesn't say, but the name reads as one. */
function classify(label: string, name: string): Status | null {
  const l = label.toLowerCase();
  if (/name-derived/.test(l)) return PRIVATE_RE.test(name) ? null : "inferred";
  const unknown = /not verified|unverified|unclassified/.test(l);
  const privateLabel = /non-?profit|501|private/.test(l) && !/public school district|public k-12|public college/.test(l);
  if (!unknown && !privateLabel) return "public";
  if (PRIVATE_RE.test(name)) return null;
  return GOV_RE.test(name) ? "inferred" : null;
}

function entityType(label: string, name: string): EntityType {
  const l = label.toLowerCase();
  const n = name.toLowerCase();
  if (/tribal|tribe|\bnation\b|pueblo|rancheria|band of|native (village|community)/.test(`${l} ${n}`)) return "tribal";
  if (/college|university|institute of technology/.test(n) && !/school district|isd\b/.test(n)) return "higher_education";
  if (/k-12|school district|^isds/.test(l) || /\b(isd|cisd|usd|csd)\b|school district|public schools|\bschools?\b|board of education|intermediate unit|boces|education service|charter/.test(n))
    return "school_district";
  if (/^state of|^commonwealth of|\bstate (agency|department)\b/.test(n) || /state agency/.test(l)) return "state_agency";
  const district = /district|authority|commission|board|library|fire|police|sheriff|appraisal|utility|water|sewer|transit|port|housing|hospital|esd|mud|sud|fpd|court|clerk/.test(n);
  if (district) return "special_district";
  // The source's own label decides first; the name only when the label doesn't say.
  if (/city|municipal|township|borough|town|village/.test(l)) return "municipality";
  if (/county|parish|burough/.test(l)) return "county";
  if (/^(city|town|village|borough|township) of\b|\b(township|borough|village)$/.test(n)) return "municipality";
  if (/\b(county|parish)$|^(county|parish) of/.test(n)) return "county";
  return "special_district";
}

// ------------------------------------------------------------------ the directory

interface Evidence {
  /** Co-op id. */
  c: string;
  /** Evidence level. */
  e: MembershipEvidence;
  /** Member ID, as published. */
  m?: string;
  /** Source URL, for agency-published and purchase evidence. */
  u?: string;
}
interface Purchase {
  date: string;
  route: string;
  supplier: string;
  category: string;
  contract: string;
  amount: number | null;
  status: string;
  note: string;
  url: string;
}
interface Entity {
  id: string;
  key: string;
  state: string;
  names: Map<string, number>;
  city: string;
  county: string;
  types: Map<EntityType, number>;
  labels: Set<string>;
  status: Status;
  domain: string;
  domains: string[];
  coops: Map<string, Evidence>;
  routes: Map<string, MembershipEvidence>;
  dir: { sales: number; lines: number; first: string; last: string; type: string } | null;
  purchases: Purchase[];
  from: Set<string>;
}

const entities = new Map<string, Entity>();
const ROSTER_SOURCES = new Set(["Sourcewell", "HGACBuy", "BuyBoard National", "BuyBoard Texas", "Mohave", "E&I", "COSTARS"]);
const slug = (s: string) => s.replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);

function entityFor(name: string, state: string, from: string, label = "", status: Status = "public"): Entity | null {
  const key = entityKey(name);
  if (!key || !/^[A-Z]{2}$/.test(state)) return null;
  const k = `${state}|${key}`;
  let e = entities.get(k);
  if (!e) {
    e = {
      id: `gov_${state.toLowerCase()}_${slug(key)}`,
      key,
      state,
      names: new Map(),
      city: "",
      county: "",
      types: new Map(),
      labels: new Set(),
      status,
      domain: "",
      domains: [],
      coops: new Map(),
      routes: new Map(),
      dir: null,
      purchases: [],
      from: new Set(),
    };
    entities.set(k, e);
  }
  if (status === "public") e.status = "public";
  // Roster names outrank the shorthand agencies and DIR use ("Lawrence" for City of Lawrence);
  // inverted or annotated names ("Douglas, City of", "… (AL)") rank last.
  const weight = (from === "Sourcewell" ? 3 : ROSTER_SOURCES.has(from) ? 2 : 0.05) - (/[(,]/.test(name) ? 1.5 : 0);
  e.names.set(name, (e.names.get(name) ?? 0) + weight);
  // A type vote needs a source label, unless nothing better has voted yet.
  if (label || !e.types.size) {
    const t = entityType(label, name);
    e.types.set(t, (e.types.get(t) ?? 0) + (label ? 2 : 1));
  }
  if (label) e.labels.add(label);
  e.from.add(from);
  return e;
}

function addCoop(e: Entity, ev: Evidence) {
  const have = e.coops.get(ev.c);
  if (!have || RANK[ev.e] > RANK[have.e]) e.coops.set(ev.c, { ...have, ...ev, m: ev.m ?? have?.m });
  else if (ev.m && !have.m) have.m = ev.m;
}
function addRoute(e: Entity, route: string, ev: MembershipEvidence) {
  const have = e.routes.get(route);
  if (!have || RANK[ev] > RANK[have]) e.routes.set(route, ev);
}

// 1. Published rosters ------------------------------------------------------

const ROSTER_TABS = ["Memberships", "BuyBoard Texas", "E&I", "COSTARS"];
const programStats: Record<string, { raw: number; kept: number; inferred: number; dropped: number; states: Set<string> }> = {};
let rawRows = 0;
const conservativeKeys = new Map<string, Set<string>>();
const rosterIds = new Map<string, Map<string, string>>(); // entity id → coop id → account id

for (const tab of ROSTER_TABS) {
  for (const r of table(tab, "Organization as published")) {
    const name = str(r["Organization as published"]);
    const state = str(r["State"]).toUpperCase();
    const program = str(r["Program"]);
    const label = str(r["Entity type"]);
    if (!name || !program) continue;
    rawRows++;
    const st = (programStats[program] ??= { raw: 0, kept: 0, inferred: 0, dropped: 0, states: new Set() });
    st.raw++;
    const ck = str(r["Conservative name key"]);
    if (ck) (conservativeKeys.get(ck) ?? conservativeKeys.set(ck, new Set()).get(ck)!).add(program);
    const status = classify(label, name);
    if (!status) {
      st.dropped++;
      continue;
    }
    const coop = coopFor(program, state);
    const e = coop && entityFor(name, state, program, label, status);
    if (!e || !coop) {
      st.dropped++;
      continue;
    }
    st.kept++;
    if (status === "inferred") st.inferred++;
    st.states.add(state);
    if (!e.city) e.city = str(r["City"]);
    if (!e.county) e.county = str(r["County"]);
    const account = str(r["Program account ID"]);
    addCoop(e, { c: coop, e: "roster", m: account || undefined });
    if (account) (rosterIds.get(e.id) ?? rosterIds.set(e.id, new Map()).get(e.id)!).set(coop, account);
  }
}
const rosterEntityCount = entities.size;

// 2. What agencies publish about themselves ----------------------------------

const relationships = table("Agency Relationships", "Agency");
const idChecks: { agency: string; state: string; coop: string; published: string; roster: string | null; agrees: boolean | null }[] = [];
for (const r of relationships) {
  const agency = str(r["Agency"]);
  const state = str(r["State"]).toUpperCase();
  const program = str(r["Program"]);
  const e = entityFor(agency, state, "Agency Relationships");
  if (!e) continue;
  const memberId = str(r["Published member ID"]) || undefined;
  const url = str(r["Source URL"]) || undefined;
  const coop = coopFor(program, state);
  if (coop) {
    addCoop(e, { c: coop, e: "agency", m: memberId, u: url });
    if (memberId) {
      const roster = rosterIds.get(e.id)?.get(coop) ?? null;
      idChecks.push({ agency, state, coop, published: memberId, roster, agrees: roster === null ? null : roster === memberId });
    }
  } else if (routeFor(program)) addRoute(e, routeFor(program)!, "agency");
}

// 3. Documented purchases -----------------------------------------------------

const purchases = table("Purchase Evidence", "Government");
for (const r of purchases) {
  const gov = str(r["Government"]);
  const state = str(r["State"]).toUpperCase();
  const route = str(r["Contract route"]);
  const e = entityFor(gov, state, "Purchase Evidence");
  if (!e) continue;
  const p: Purchase = {
    date: str(r["Evidence date"]),
    route,
    supplier: str(r["Supplier"]),
    category: str(r["Purchase category"]),
    contract: str(r["Contract identifier"]),
    amount: r["Amount (USD)"] == null || str(r["Amount (USD)"]) === "" ? null : num(r["Amount (USD)"]),
    status: str(r["Evidence status"]),
    note: str(r["Interpretation"]),
    url: str(r["Source URL"]),
  };
  e.purchases.push(p);
  // Only an approval or award counts as purchase evidence; a proposal or recommendation stays "agency".
  const approved = /approved|award|authorization approved|historical approved/i.test(p.status) && !/proposed|recommended/i.test(p.status);
  const coop = /multiple/i.test(route) ? null : coopFor(route.replace(/ via .*$/, ""), state);
  if (coop) addCoop(e, { c: coop, e: approved ? "purchase" : "agency", u: p.url || undefined });
  else if (routeFor(route)) addRoute(e, routeFor(route)!, approved ? "purchase" : "agency");
}

// 4. Texas DIR reported sales ---------------------------------------------------

const dirRows = table("DIR Buyers", "Customer as reported");
const DIR_GOV = new Set(["Local Government", "K-12 School", "Higher Education", "State Agency"]);
const dirMerged = new Map<string, { name: string; state: string; type: string; sales: number; lines: number; first: string; last: string; parts: number; blank: number }>();
for (const r of dirRows) {
  const name = str(r["Customer as reported"]);
  const type = str(r["DIR customer type"]);
  let state = str(r["State"]).toUpperCase();
  const blank = !state;
  // DIR is Texas's program: a buyer reported without a state is a Texas buyer unless DIR calls it out of state.
  if (blank) {
    if (type === "Out of State") continue;
    state = "TX";
  }
  const k = `${state}|${entityKey(name)}`;
  const m = dirMerged.get(k) ?? { name, state, type, sales: 0, lines: 0, first: "", last: "", parts: 0, blank: 0 };
  m.sales += num(r["Reported net sales (USD)"]);
  m.lines += num(r["Reported line items"]);
  const first = str(r["First report month"]);
  const last = str(r["Last report month"]);
  if (first && (!m.first || first < m.first)) m.first = first;
  if (last && last > m.last) m.last = last;
  m.parts++;
  if (blank) m.blank++;
  dirMerged.set(k, m);
}
let dirMatchedRoster = 0;
for (const m of dirMerged.values()) {
  const existing = entities.get(`${m.state}|${entityKey(m.name)}`);
  if (existing && existing.coops.size) dirMatchedRoster++;
  const e = existing ?? (DIR_GOV.has(m.type) ? entityFor(m.name, m.state, "Texas DIR", m.type === "K-12 School" ? "K-12" : m.type) : null);
  if (!e) continue;
  if (existing) existing.from.add("Texas DIR");
  e.dir = { sales: Math.round(m.sales * 100) / 100, lines: m.lines, first: m.first.slice(0, 7), last: m.last.slice(0, 7), type: m.type };
  addRoute(e, "Texas DIR", "purchase");
}

// 5. .gov domains -----------------------------------------------------------------

const DOTGOV_TYPE: Record<string, string> = {
  City: "City",
  County: "County",
  "Special district": "Special district",
  Tribal: "Tribal",
  "School district": "School district",
  "State or territory": "State Agency",
  Interstate: "Authority",
};
const csv = readFileSync(DOTGOV, "utf8").trim().split(/\r?\n/);
const parseCsv = (line: string) => {
  const out: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"' && line[i + 1] === '"') (cur += '"'), i++;
      else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") out.push(cur), (cur = "");
    else cur += ch;
  }
  out.push(cur);
  return out;
};
let dotgovRows = 0;
let dotgovMatched = 0;
let dotgovAdded = 0;
const candidates = new Map<string, string[]>();
for (const line of csv.slice(1)) {
  const [domain, type, org, suborg, , state] = parseCsv(line);
  const label = DOTGOV_TYPE[type];
  if (!label || !/^[A-Z]{2}$/.test(state)) continue;
  dotgovRows++;
  // State domains are registered to "State of X"; the agency is the suborganization.
  const name = type === "State or territory" ? suborg || org : org;
  const k = `${state}|${entityKey(name)}`;
  const existed = entities.has(k);
  const e = existed ? entities.get(k)! : entityFor(name, state, ".gov registry", label);
  if (!e) continue;
  e.from.add(".gov registry");
  if (existed) {
    if (!candidates.has(e.id)) dotgovMatched++;
  } else dotgovAdded++;
  (candidates.get(e.id) ?? candidates.set(e.id, []).get(e.id)!).push(normalizeDomain(domain));
}
const byId = new Map([...entities.values()].map((e) => [e.id, e]));
for (const [id, list] of candidates) {
  const e = byId.get(id)!;
  // The shortest domain is almost always the main site ("austintexas.gov" over "austintexaspolice.gov").
  const sorted = [...new Set(list)].sort((a, b) => a.length - b.length || a.localeCompare(b));
  e.domain = sorted[0];
  e.domains = sorted.slice(1, 8);
}

// ------------------------------------------------------------------ write the directory

const display = (e: Entity) => [...e.names.entries()].sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)[0][0].replace(/\s*\([A-Z]{2}\)$/, "");
const topType = (e: Entity) => [...e.types.entries()].sort((a, b) => b[1] - a[1])[0][0];

const rows = [...entities.values()].map((e) => {
  const names = [...e.names.keys()];
  const name = display(e);
  return {
    i: e.id,
    n: name,
    a: names.filter((x) => x !== name).slice(0, 4),
    s: e.state,
    c: e.city || undefined,
    k: e.county || undefined,
    t: topType(e),
    st: e.status,
    d: e.domain || undefined,
    ds: e.domains.length ? e.domains : undefined,
    p: [...e.coops.values()],
    r: e.routes.size ? Object.fromEntries(e.routes) : undefined,
    x: e.dir ?? undefined,
    b: e.purchases.length ? e.purchases : undefined,
    f: [...e.from],
  };
});
rows.sort((a, b) => a.s.localeCompare(b.s) || a.n.localeCompare(b.n));

const coopIds = [...new Set(Object.values(COOPS))];
const directory = { version: 1, retrieved: RETRIEVED, sources: ["coop-memberships-2026-11-13.xlsx", "dotgov-domains-2026-11-13.csv"], coops: coopIds, routes: ROUTES, rows };
mkdirSync(join(ROOT, "seed/coops"), { recursive: true });
writeFileSync(join(ROOT, "seed/coops/directory.json.gz"), gzipSync(JSON.stringify(directory), { level: 9 }));

// ------------------------------------------------------------------ NASPO contract access

const access = table("Contract Access", "Entity");
const parks = new Map<string, { supplier: string; master_agreement: string; pa_states: Set<string>; addenda: { state: string; url: string }[] }>();
const adopters: { portfolio: string; name: string; state: string; url: string }[] = [];
const citizenStates = new Map<string, Set<string>>();
for (const r of access) {
  if (str(r["Program"]) !== "NASPO ValuePoint") continue;
  const portfolio = str(r["Portfolio"]);
  const entity = str(r["Entity"]);
  const state = str(r["State"]).toUpperCase();
  const supplier = str(r["Supplier"]);
  const ma = str(r["Master agreement"]);
  const status = str(r["Listing status"]);
  const doc = str(r["Document URL"]);
  const isState = /^(state|commonwealth|commomwealth) of/i.test(entity);
  if (!isState) {
    adopters.push({ portfolio, name: entity, state, url: doc || str(r["Portfolio/source URL"]) });
    continue;
  }
  if (/historical/i.test(status)) continue;
  if (portfolio === "Citizen engagement" && ma) (citizenStates.get(ma) ?? citizenStates.set(ma, new Set()).get(ma)!).add(state);
  if (portfolio !== "Parks and recreation" || !supplier) continue;
  const p = parks.get(supplier) ?? { supplier, master_agreement: "", pa_states: new Set<string>(), addenda: [] };
  // The column sometimes holds a description ("State Government - Central Procurement Office"); keep only real numbers.
  if (/^PO-?\d/.test(ma) && !p.master_agreement) p.master_agreement = ma.replace(/^PO(\d)/, "PO-$1");
  p.pa_states.add(state);
  if (doc) p.addenda.push({ state, url: doc });
  parks.set(supplier, p);
}
const naspoAccess = {
  source: "https://www.naspovaluepoint.org/portfolios/parks-recreation-equipment-installation/",
  retrieved: RETRIEVED,
  note: "From the Contract Access tab of the co-op workbook. Agreement numbers are as listed on NASPO ValuePoint's portfolio page; confirm the current term before ordering.",
  parks: {
    portfolio: "Parks and Recreation Equipment and Installation",
    awards: [...parks.values()]
      .map((p) => ({ supplier: p.supplier, master_agreement: p.master_agreement, pa_states: [...p.pa_states].sort(), addenda: p.addenda.sort((a, b) => a.state.localeCompare(b.state)) }))
      .sort((a, b) => a.supplier.localeCompare(b.supplier)),
  },
  adopters,
};
writeFileSync(join(ROOT, "seed/catalogs/naspo-contract-access.json"), JSON.stringify(naspoAccess, null, 1) + "\n");

// ------------------------------------------------------------------ insights for /data

const seededCitizen = JSON.parse(readFileSync(join(ROOT, "seed/catalogs/naspo-citizen-engagement-platforms.json"), "utf8")) as { awards: { supplier: string; master_agreement: string; pa_states: string[] }[] };
const addendumDiffs = seededCitizen.awards
  .map((a) => {
    const listed = citizenStates.get(a.master_agreement) ?? new Set<string>();
    const seeded = new Set(a.pa_states);
    return { supplier: a.supplier, master_agreement: a.master_agreement, only_in_workbook: [...listed].filter((s) => !seeded.has(s)).sort(), only_in_agora: [...seeded].filter((s) => !listed.has(s)).sort() };
  })
  .filter((d) => d.only_in_workbook.length || d.only_in_agora.length);

const rosterRows = rows.filter((r) => r.p.some((p) => p.e === "roster"));
const coopCount = (r: (typeof rows)[number]) => r.p.length;
const overlap: Record<string, number> = {};
for (const r of rosterRows) {
  const n = r.p.filter((p) => p.e === "roster").length;
  const k = n >= 4 ? "4+" : String(n);
  overlap[k] = (overlap[k] ?? 0) + 1;
}
const conservativeMulti = [...conservativeKeys.values()].filter((s) => s.size > 1).length;
const ourMulti = rosterRows.filter((r) => r.p.filter((p) => p.e === "roster").length > 1).length;

// Same government, different names across co-ops: the merges the conservative key missed.
const merges = rosterRows
  .filter((r) => r.a.length && r.p.length > 1 && r.t !== "special_district")
  .map((r) => ({ name: r.n, state: r.s, also: r.a.slice(0, 2), coops: r.p.length }))
  .filter((m) => m.also.some((a) => a.replace(/[^a-z]/gi, "").toLowerCase() !== m.name.replace(/[^a-z]/gi, "").toLowerCase()));

const dirTotal = [...dirMerged.values()].reduce((s, m) => s + m.sales, 0);
const dirByType: Record<string, number> = {};
for (const m of dirMerged.values()) dirByType[m.type] = (dirByType[m.type] ?? 0) + m.sales;
const blankMerges = [...dirMerged.values()].filter((m) => m.blank && m.parts > 1).sort((a, b) => b.sales - a.sales);

const prospects = rows
  .filter((r) => r.x && r.t !== "state_agency" && r.p.length >= 2)
  .sort((a, b) => b.x!.sales - a.x!.sales)
  .slice(0, 40)
  .map((r) => ({ id: r.i, name: r.n, state: r.s, type: r.t, dir_sales: Math.round(r.x!.sales), coops: r.p.map((p) => p.c), strongest: r.p.reduce((m, p) => (RANK[p.e] > RANK[m] ? p.e : m), "list" as MembershipEvidence) }));
const heavyUsers = rows.filter((r) => coopCount(r) >= 3).length;

const coverage = table("Program Coverage", "Program").map((r) => ({
  program: str(r["Program"]),
  status: str(r["Collection status"]),
  records: r["Imported records"] == null || str(r["Imported records"]) === "" ? null : num(r["Imported records"]),
  evidence: str(r["Available public evidence"]),
  next: str(r["Scope and next public step"]),
  url: str(r["Primary source URL"]),
}));

const insights = {
  generated: RETRIEVED,
  retrieved: RETRIEVED,
  workbook: {
    roster_rows: rawRows,
    tabs: wb.SheetNames,
    relationships: relationships.length,
    relationship_agencies: new Set(relationships.map((r) => `${str(r["State"])}|${entityKey(str(r["Agency"]))}`)).size,
    purchases: purchases.length,
    contract_access: access.length,
  },
  programs: Object.entries(programStats)
    .map(([program, s]) => ({ program, coop_id: coopFor(program, program === "BuyBoard Texas" ? "TX" : ""), raw: s.raw, kept: s.kept, inferred: s.inferred, dropped: s.dropped, states: s.states.size }))
    .sort((a, b) => b.raw - a.raw),
  directory: {
    governments: rows.length,
    from_rosters: rosterEntityCount,
    on_a_roster: rosterRows.length,
    by_type: rows.reduce<Record<string, number>>((m, r) => ((m[r.t] = (m[r.t] ?? 0) + 1), m), {}),
    inferred: rows.filter((r) => r.st === "inferred").length,
    with_domain: rows.filter((r) => r.d).length,
    roster_with_domain: rosterRows.filter((r) => r.d).length,
    dotgov_rows: dotgovRows,
    dotgov_matched: dotgovMatched,
    dotgov_added: dotgovAdded,
  },
  overlap: {
    by_roster_count: overlap,
    conservative_key_entities: conservativeKeys.size,
    conservative_key_multi: conservativeMulti,
    entity_key_multi: ourMulti,
    on_three_or_more: heavyUsers,
    examples: merges.slice(0, 400).filter((_, i) => i % 40 === 0).slice(0, 8),
  },
  coop_counts: rows.reduce<Record<string, Record<MembershipEvidence, number>>>((m, r) => {
    for (const p of r.p) (m[p.c] ??= { list: 0, roster: 0, agency: 0, purchase: 0 })[p.e]++;
    return m;
  }, {}),
  evidence: {
    roster: rows.filter((r) => r.p.some((p) => p.e === "roster")).length,
    agency: rows.filter((r) => r.p.some((p) => p.e === "agency")).length,
    purchase: rows.filter((r) => r.p.some((p) => p.e === "purchase") || r.r?.["Texas DIR"] === "purchase" || Object.values(r.r ?? {}).includes("purchase")).length,
    id_checks: idChecks,
  },
  dir: {
    raw_rows: dirRows.length,
    buyers: dirMerged.size,
    sales: Math.round(dirTotal),
    by_type: Object.fromEntries(Object.entries(dirByType).map(([k, v]) => [k, Math.round(v)]).sort((a, b) => (b[1] as number) - (a[1] as number))),
    matched_to_rosters: dirMatchedRoster,
    blank_state_merges: blankMerges.length,
    blank_state_examples: blankMerges.slice(0, 3).map((m) => ({ name: m.name, sales: Math.round(m.sales), parts: m.parts })),
  },
  prospects,
  purchases: purchases.map((r) => ({
    government: str(r["Government"]),
    state: str(r["State"]),
    route: str(r["Contract route"]),
    status: str(r["Evidence status"]),
    date: str(r["Evidence date"]),
    supplier: str(r["Supplier"]),
    category: str(r["Purchase category"]),
    amount: r["Amount (USD)"] == null || str(r["Amount (USD)"]) === "" ? null : num(r["Amount (USD)"]),
    note: str(r["Interpretation"]),
    url: str(r["Source URL"]),
  })),
  naspo: {
    parks_awards: naspoAccess.parks.awards.length,
    parks_states: new Set(naspoAccess.parks.awards.flatMap((a) => a.pa_states)).size,
    adopters,
    citizen_addendum_diffs: addendumDiffs,
  },
  coverage,
};
writeFileSync(join(ROOT, "seed/coops/insights.json"), JSON.stringify(insights, null, 1) + "\n");

console.log(
  `Directory: ${rows.length.toLocaleString()} governments (${rosterRows.length.toLocaleString()} on a roster, ${rows.filter((r) => r.d).length.toLocaleString()} with a .gov domain).`,
);
console.log(`Roster rows ${rawRows.toLocaleString()}; kept ${Object.values(programStats).reduce((s, p) => s + p.kept, 0).toLocaleString()}; dropped ${Object.values(programStats).reduce((s, p) => s + p.dropped, 0).toLocaleString()} as non-government or unverifiable.`);
console.log(`Overlap: ${ourMulti.toLocaleString()} governments on 2+ rosters (conservative key found ${conservativeMulti.toLocaleString()}); ${heavyUsers.toLocaleString()} on 3+ co-ops.`);
console.log(`DIR: ${dirMerged.size.toLocaleString()} buyers after merging ${blankMerges.length} blank-state splits; ${dirMatchedRoster.toLocaleString()} matched to a roster.`);
console.log(`Member IDs published by agencies: ${idChecks.length}; ${idChecks.filter((c) => c.agrees).length} agree with the roster, ${idChecks.filter((c) => c.agrees === false).length} disagree.`);
console.log(`NASPO Parks: ${naspoAccess.parks.awards.length} awards; ${adopters.length} local adopters; ${addendumDiffs.length} Citizen Engagement awards whose states differ from Agora's seed.`);
