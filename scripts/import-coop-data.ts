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

import { gunzipSync, gzipSync } from "node:zlib";
import { existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
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
  /** Permanent federal IDs: Census of Governments, NCES district, IPEDS college. */
  fed: { census?: FedUnit; nces?: FedUnit; ipeds?: FedUnit };
  /** Websites from the federal registries, domain → source. */
  webs: Map<string, "census" | "nces" | "ipeds">;
  /** IPEDS says it's a private college: set aside. */
  private: boolean;
  /** A county office (sheriff, district attorney, clerk) that is part of its county's government. */
  parent?: Entity;
  /** Set when this entity was folded into another. */
  mergedInto?: Entity;
}

/** One record in a federal registry. */
interface FedUnit {
  kind: "census" | "nces" | "ipeds";
  id: string;
  name: string;
  state: string;
  type: EntityType;
  domain: string;
  city: string;
  county: string;
  population?: number;
  enrollment?: number;
  public: boolean;
  /** Census sheet or NCES/IPEDS category, for reporting. */
  detail: string;
}

const entities = new Map<string, Entity>();
/** Keys of entities merged into another (by a shared federal ID), pointing at the survivor. */
const aliases = new Map<string, Entity>();
function lookup(k: string): Entity | undefined {
  let e = entities.get(k) ?? aliases.get(k);
  while (e?.mergedInto) e = e.mergedInto;
  return e;
}
const live = (e: Entity) => {
  while (e.mergedInto) e = e.mergedInto;
  return e;
};
const ROSTER_SOURCES = new Set(["Sourcewell", "HGACBuy", "BuyBoard National", "BuyBoard Texas", "Mohave", "E&I", "COSTARS", "Choice Partners", "1GPA"]);
const slug = (s: string) => s.replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);

function entityFor(name: string, state: string, from: string, label = "", status: Status = "public"): Entity | null {
  const key = entityKey(name);
  if (!key || !/^[A-Z]{2}$/.test(state)) return null;
  const k = `${state}|${key}`;
  let e = lookup(k);
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
      fed: {},
      webs: new Map(),
      private: false,
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

/** Fold entity b into a: they turned out to be one government (they share a federal ID). */
function mergeInto(a: Entity, b: Entity) {
  if (a === b) return;
  for (const [n, w] of b.names) a.names.set(n, (a.names.get(n) ?? 0) + w);
  for (const [t, w] of b.types) a.types.set(t, (a.types.get(t) ?? 0) + w);
  for (const l of b.labels) a.labels.add(l);
  if (b.status === "public") a.status = "public";
  if (!a.city) a.city = b.city;
  if (!a.county) a.county = b.county;
  for (const ev of b.coops.values()) addCoop(a, ev);
  for (const [r, ev] of b.routes) addRoute(a, r, ev);
  // Two DIR rows for one government are two ways it was reported: keep the larger, don't add.
  if (b.dir && (!a.dir || b.dir.sales > a.dir.sales)) a.dir = b.dir;
  a.purchases.push(...b.purchases);
  for (const f of b.from) a.from.add(f);
  for (const [k, u] of Object.entries(b.fed) as [keyof Entity["fed"], FedUnit][]) if (!a.fed[k]) a.fed[k] = u;
  for (const [d, src] of b.webs) if (!a.webs.has(d)) a.webs.set(d, src);
  const kb = `${b.state}|${b.key}`;
  entities.delete(kb);
  aliases.set(kb, a);
  b.mergedInto = a;
}

// 1. Published rosters ------------------------------------------------------

const ROSTER_TABS = ["Memberships", "BuyBoard Texas", "E&I", "COSTARS"];
const programStats: Record<string, { raw: number; kept: number; inferred: number; dropped: number; states: Set<string> }> = {};
let rawRows = 0;
const conservativeKeys = new Map<string, Set<string>>();
const rosterIds = new Map<string, Map<string, string>>(); // entity id → coop id → account id

/** Rosters published in the open beyond the workbook (scripts/fetch-rosters.ts), in the workbook's columns. */
const ROSTER_CSV_DIR = join(ROOT, "seed/coops/source/rosters");
const extraRosters: Record<string, unknown>[] = [];
if (existsSync(ROSTER_CSV_DIR))
  for (const f of readdirSync(ROSTER_CSV_DIR).filter((f) => f.endsWith(".csv")).sort()) {
    const wbx = XLSX.read(readFileSync(join(ROSTER_CSV_DIR, f), "utf8"), { type: "string", raw: true });
    extraRosters.push(...XLSX.utils.sheet_to_json<Record<string, unknown>>(wbx.Sheets[wbx.SheetNames[0]], { defval: "" }));
  }
const publishedRosterRows = [...ROSTER_TABS.flatMap((tab) => table(tab, "Organization as published")), ...extraRosters];

{
  for (const r of publishedRosterRows) {
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
  const existing = lookup(`${m.state}|${entityKey(m.name)}`);
  if (existing && existing.coops.size) dirMatchedRoster++;
  const e = existing ?? (DIR_GOV.has(m.type) ? entityFor(m.name, m.state, "Texas DIR", m.type === "K-12 School" ? "K-12" : m.type) : null);
  if (!e) continue;
  if (existing) existing.from.add("Texas DIR");
  e.dir = { sales: Math.round(m.sales * 100) / 100, lines: m.lines, first: m.first.slice(0, 7), last: m.last.slice(0, 7), type: m.type };
  addRoute(e, "Texas DIR", "purchase");
}

// 5. Federal IDs --------------------------------------------------------------------
//
// The Census of Governments gives every county, municipality, township, special district
// and school district a permanent ID; NCES does the same for school districts (LEAID) and
// IPEDS for colleges (UNITID). Each directory entry is matched to one, and entries that
// match the same ID are one government, whatever their names. Fetched by
// scripts/fetch-federal-ids.ts.

// AI-reviewed decisions (seed/cleanup/decisions, written by scripts/cleanup): a model picked
// among real candidates, with a confidence and a reason. Only high and medium confidence apply.
interface Decision {
  pick: string | null;
  confidence: "high" | "medium" | "low";
  reason: string;
}
function decisions(name: string): Record<string, Decision> {
  const path = join(ROOT, "seed/cleanup/decisions", `${name}.json`);
  if (!existsSync(path)) return {};
  const all = JSON.parse(readFileSync(path, "utf8")) as Record<string, Decision>;
  return Object.fromEntries(Object.entries(all).filter(([, d]) => d.pick && d.confidence !== "low"));
}
const schoolDecisions = decisions("school-pairs");
const govDecisions = decisions("gov-match");
const cleanupTasks: Record<string, unknown[]> = { "school-pairs": [], "gov-match": [] };
/** Words two names share, for ranking candidates the model then chooses among. */
const nameWords = (n: string) => new Set(entityKey(n).split(" ").filter((w) => w.length > 1 && !/^(of|and|the|city|town|village|county|township|borough|district|school|schools|public|isd|usd|csd|sd)$/.test(w)));
function similarity(a: string[], b: string[]): number {
  const A = new Set(a.flatMap((n) => [...nameWords(n)]));
  const B = new Set(b.flatMap((n) => [...nameWords(n)]));
  if (!A.size || !B.size) return 0;
  const both = [...A].filter((w) => B.has(w)).length;
  return both / (A.size + B.size - both);
}

/** A whole CSV file, quoted fields and embedded newlines included. */
function parseCsvText(text: string): Record<string, string>[] {
  const out: string[][] = [];
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
    else if (ch === "\n") row.push(cur), out.push(row), (row = []), (cur = "");
    else if (ch !== "\r") cur += ch;
  }
  if (cur || row.length) row.push(cur), out.push(row);
  const head = out[0];
  return out.slice(1).map((r) => Object.fromEntries(head.map((h, i) => [h, (r[i] ?? "").trim()])));
}
const gzCsv = (file: string) => parseCsvText(gunzipSync(readFileSync(join(ROOT, "seed/coops/source", file))).toString("utf8"));

/** The Census Bureau abbreviates names ("Ada Exempted Sch Dist", "Abc Unif School Dist",
 * "Adirondack Comm College"); NCES and the co-ops spell them out. */
const CENSUS_ABBREV: [RegExp, string][] = [
  [/\bSCH DIST\b/g, "SCHOOL DISTRICT"],
  [/\bSCHOOL DIST\b/g, "SCHOOL DISTRICT"],
  [/\bSCH\b/g, "SCHOOL"],
  [/\bDIST\b/g, "DISTRICT"],
  [/\bUNIF\b/g, "UNIFIED"],
  [/\bELEM\b/g, "ELEMENTARY"],
  [/\bEX VLG\b/g, "EXEMPTED VILLAGE"],
  [/\bVLG\b/g, "VILLAGE"],
  [/\bCOMM\b/g, "COMMUNITY"],
  [/\bCONS\b/g, "CONSOLIDATED"],
  [/\bCENT\b/g, "CENTRAL"],
  [/\bJT\b/g, "JOINT"],
  [/\bREG\b/g, "REGIONAL"],
  [/\bTWP\b/g, "TOWNSHIP"],
  [/\bAUTH\b/g, "AUTHORITY"],
  [/\bIND\b/g, "INDEPENDENT"],
  [/\bCTL\b/g, "CENTRAL"],
  [/\bUF\b/g, "UNION FREE"],
  [/\bDT\b/g, "DISTRICT"],
  [/\bCO\b/g, "COUNTY"],
  [/\bCNTY\b/g, "COUNTY"],
  [/\bSPL\b/g, "SPECIAL"],
  [/\bSCHS\b/g, "SCHOOLS"],
  [/\bU F\b/g, "UNION FREE"],
  [/\bVAL\b/g, "VALLEY"],
  [/\bCOLL\b/g, "COLLEGE"],
];
const expandCensus = (name: string) => CENSUS_ABBREV.reduce((n, [re, to]) => n.replace(re, to), name.toUpperCase());

/** "COUNTY OF AUTAUGA" → "County of Autauga"; keeps ISD, CISD, USD, MUD and the like in capitals. */
const KEEP_UPPER = new Set(["isd", "cisd", "usd", "csd", "sd", "mud", "sud", "esd", "fwsd", "wcid", "pud", "fpd", "rfpd", "boces", "ufsd", "ii", "iii", "iv", "vi", "vii", "viii", "ix", "xi", "xii", "dc", "us", "mvsd", "msd"]);
const LOWER = new Set(["of", "and", "the", "for", "in", "at", "on", "de", "la", "del"]);
function titleCase(s: string): string {
  if (/[a-z]/.test(s)) return s; // already mixed case (IPEDS)
  return s
    .toLowerCase()
    .split(/(\s+|-|\/)/)
    .map((w, i) => {
      if (KEEP_UPPER.has(w) || /^r-?\d+[a-z]?$/.test(w)) return w.toUpperCase();
      if (i > 0 && LOWER.has(w)) return w;
      return w.replace(/^([a-z])/, (c) => c.toUpperCase()).replace(/(mc)([a-z])/, (_, a, b) => a.replace("mc", "Mc") + b.toUpperCase());
    })
    .join("");
}

/** Extra keys a name may be published under: "Franklin Borough" for "Borough of Franklin". */
function keysFor(name: string): string[] {
  const k = entityKey(name);
  const keys = [k];
  // "Township of Fairfield, Washington County" → "Township of Fairfield"; the county is used to pick among same-named ones.
  const noCounty = name.replace(/,\s*[^,]+ (county|parish)\s*$/i, "");
  if (noCounty !== name) keys.push(entityKey(noCounty));
  const bare = k.replace(/ (borough|village|town|charter township)$/, "");
  if (bare !== k && bare) keys.push(bare);
  // "de Ruyter" and "DeRuyter", "La Grange" and "LaGrange".
  for (const x of [...keys]) keys.push(`~${x.replace(/ /g, "")}`);
  return keys;
}
/** A school district's name reduced to its place, for pairing "Autauga County Schools" with "Autauga County School District". */
function schoolCore(name: string, state: string): string {
  let k = entityKey(name)
    .replace(/\bexempted village\b/g, "exempted")
    .replace(/\b(school district|school dist|public schools?|school system|board of education|schools?|isd|cisd|usd|csd|ufsd|ccsd|cusd|chsd|hsd|sd|unified|consolidated|independent|community|unit|district|public|union free|central)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  // The Census adds a county code to Texas districts ("Abbott Ind School District 901").
  if (state === "TX") k = k.replace(/ \d{3}$/, "");
  return k;
}
/** The same, without district numbers, for a last-resort pairing when both sides are unique. */
const schoolCoreNoNumber = (name: string, state: string) => schoolCore(name, state).replace(/\b\d+[a-z]?\b/g, " ").replace(/\s+/g, " ").trim();

const CENSUS_TYPE = (sheet: string, unitType: string, name = ""): EntityType =>
  (sheet === "school" || sheet === "dependent_school") && /\b(college|university)\b/i.test(name) ? "higher_education" :
  sheet === "school" || sheet === "dependent_school" ? "school_district" : sheet === "special" ? "special_district" : /^1 /.test(unitType) ? "county" : "municipality";
const intOr = (v: string) => (v && /^\d+$/.test(v) ? Number(v) : undefined);

const census: FedUnit[] = gzCsv("census-gov-units-2026.csv.gz")
  .filter((r) => r.active === "Y" && /^[A-Z]{2}$/.test(r.state))
  .map((r) => ({
    kind: "census" as const,
    id: r.census_id,
    name: titleCase(expandCensus(r.name)),
    state: r.state,
    type: CENSUS_TYPE(r.sheet, r.unit_type, expandCensus(r.name)),
    domain: normalizeDomain(r.website),
    city: titleCase(r.city),
    county: titleCase(r.county),
    population: intOr(r.population),
    enrollment: intOr(r.enrollment),
    public: true,
    detail: r.sheet,
  }));
// Open districts of every public kind except federally operated ones.
const NCES_OPEN = new Set(["Open", "New", "Added", "Changed Boundary/Agency", "Reopened"]);
const nces: FedUnit[] = gzCsv("nces-ccd-lea-2024-25.csv.gz")
  .filter((r) => NCES_OPEN.has(r.status) && r.lea_type !== "6" && /^[A-Z]{2}$/.test(r.state))
  .map((r) => ({
    kind: "nces" as const,
    id: r.leaid,
    name: titleCase(r.name),
    state: r.state,
    type: "school_district" as EntityType,
    domain: normalizeDomain(r.website),
    city: titleCase(r.city),
    county: "",
    public: true,
    detail: r.lea_type === "7" ? "charter" : r.lea_type_text,
  }));
const ipeds: FedUnit[] = gzCsv("ipeds-hd-2024.csv.gz")
  .filter((r) => r.active === "1" && /^[A-Z]{2}$/.test(r.state))
  .map((r) => ({
    kind: "ipeds" as const,
    id: r.unitid,
    name: r.name,
    state: r.state,
    type: "higher_education" as EntityType,
    domain: normalizeDomain(r.website),
    city: r.city,
    county: r.county.replace(/ County$/, ""),
    public: r.control === "1",
    detail: r.control === "1" ? "public" : r.control === "2" ? "private nonprofit" : "private for-profit",
  }));

// A website identifies a government only if no other government in the same registry
// lists it: 80 list sites.google.com, and 65 Missouri soil districts share one state page.
const holders = new Map<string, Map<FedUnit["kind"], number>>();
for (const u of [...census, ...nces, ...ipeds]) {
  if (!u.domain || !u.domain.includes(".")) continue;
  const m = holders.get(u.domain) ?? holders.set(u.domain, new Map()).get(u.domain)!;
  m.set(u.kind, (m.get(u.kind) ?? 0) + 1);
}
const PLATFORM = /(^|\.)(google\.com|facebook\.com|wix(site)?\.com|squarespace\.com|weebly\.com|wordpress\.com|blogspot\.com|godaddysites\.com|municode\.com|edlio\.com|finalsite\.net|schoolwires\.net|k12\.[a-z]{2}\.us\/?$)/;
const usableDomain = (d: string) => Boolean(d && d.includes(".") && !PLATFORM.test(d) && [...(holders.get(d)?.values() ?? [])].every((n) => n === 1));

// Pair each Census school district with its NCES record: same website, else same name, else same place.
interface Group {
  units: FedUnit[];
  type: EntityType;
  state: string;
}
const groups: Group[] = [];
const index = <T,>(items: T[], keys: (t: T) => string[]) => {
  const m = new Map<string, T[]>();
  for (const t of items) for (const k of new Set(keys(t))) if (k) (m.get(k) ?? m.set(k, []).get(k)!).push(t);
  return m;
};
const ncesByDomain = index(nces, (u) => (usableDomain(u.domain) ? [u.domain] : []));
const ncesByKey = index(nces, (u) => keysFor(u.name).map((k) => `${u.state}|${k}`));
const ncesByCore = index(nces, (u) => [`${u.state}|${schoolCore(u.name, u.state)}`]);
const ncesByCoreNoNumber = index(nces, (u) => [`${u.state}|${schoolCoreNoNumber(u.name, u.state)}`]);
const censusSchools = census.filter((u) => u.type === "school_district");
const censusByCoreNoNumber = index(censusSchools, (u) => [`${u.state}|${schoolCoreNoNumber(u.name, u.state)}`]);
const pairedNces = new Set<FedUnit>();
const only = <T,>(xs: T[] | undefined, taken: Set<T>) => {
  const free = (xs ?? []).filter((x) => !taken.has(x));
  return free.length === 1 ? free[0] : undefined;
};
let pairedByDomain = 0;
let pairedByName = 0;
for (const u of census) {
  if (u.type !== "school_district") {
    groups.push({ units: [u], type: u.type, state: u.state });
    continue;
  }
  const byDomain = usableDomain(u.domain) ? only(ncesByDomain.get(u.domain), pairedNces) : undefined;
  let twin = byDomain?.state === u.state ? byDomain : undefined;
  if (twin) pairedByDomain++;
  else {
    twin =
      keysFor(u.name).map((k) => only(ncesByKey.get(`${u.state}|${k}`), pairedNces)).find(Boolean) ??
      only(ncesByCore.get(`${u.state}|${schoolCore(u.name, u.state)}`), pairedNces);
    if (!twin) {
      // Without numbers, both sides must be the only district with that name in the state.
      const loose = `${u.state}|${schoolCoreNoNumber(u.name, u.state)}`;
      if ((censusByCoreNoNumber.get(loose) ?? []).length === 1) twin = only(ncesByCoreNoNumber.get(loose), pairedNces);
    }
    if (twin) pairedByName++;
  }
  if (twin) pairedNces.add(twin);
  groups.push({ units: twin ? [u, twin] : [u], type: "school_district", state: u.state });
}
// Census districts the rules couldn't pair: apply reviewed pairings, then list what's left for review.
const ncesById = new Map(nces.map((u) => [u.id, u]));
let pairedByReview = 0;
for (const g of groups) {
  if (g.type !== "school_district" || g.units.length !== 1 || g.units[0].kind !== "census") continue;
  const pick = schoolDecisions[g.units[0].id]?.pick;
  const twin = pick ? ncesById.get(pick.replace(/^nces:/, "")) : undefined;
  if (twin && !pairedNces.has(twin) && twin.state === g.state) {
    g.units.push(twin);
    pairedNces.add(twin);
    pairedByReview++;
  }
}
{
  const freeByState = new Map<string, FedUnit[]>();
  for (const u of nces) if (!pairedNces.has(u) && !/charter/i.test(u.detail)) (freeByState.get(u.state) ?? freeByState.set(u.state, []).get(u.state)!).push(u);
  for (const g of groups) {
    if (g.type !== "school_district" || g.units.length !== 1 || g.units[0].kind !== "census") continue;
    const u = g.units[0];
    const cands = (freeByState.get(u.state) ?? [])
      .map((n) => ({ n, s: similarity([u.name], [n.name]) + (n.city && n.city === u.city ? 0.2 : 0) }))
      .filter((x) => x.s >= 0.25)
      .sort((a, b) => b.s - a.s)
      .slice(0, 4);
    if (cands.length)
      cleanupTasks["school-pairs"].push({
        id: u.id,
        census: { name: u.name, state: u.state, city: u.city, county: u.county, enrollment: u.enrollment ?? null, website: u.domain || null },
        candidates: cands.map(({ n }) => ({ id: `nces:${n.id}`, name: n.name, city: n.city, website: n.domain || null, kind: n.detail })),
      });
  }
}
for (const u of nces) if (!pairedNces.has(u)) groups.push({ units: [u], type: "school_district", state: u.state });

// Community-college districts are in the Census school sheet; pair each with its public IPEDS college.
const collegeCore = (name: string) =>
  entityKey(name).replace(/\b(community college district|college district|district|joint|community|college|junior|technical|county)\b/g, " ").replace(/\s+/g, " ").trim();
const publicIpedsByCore = index(ipeds.filter((u) => u.public), (u) => [`${u.state}|${collegeCore(u.name)}`]);
const pairedIpeds = new Set<FedUnit>();
let collegePairs = 0;
for (const g of groups) {
  if (g.type !== "higher_education") continue;
  const twin = only(publicIpedsByCore.get(`${g.state}|${collegeCore(g.units[0].name)}`), pairedIpeds);
  if (twin) (g.units.push(twin), pairedIpeds.add(twin), collegePairs++);
}
for (const u of ipeds) if (!pairedIpeds.has(u)) groups.push({ units: [u], type: "higher_education", state: u.state });

const groupsByKey = index(groups, (g) => g.units.flatMap((u) => keysFor(u.name).map((k) => `${g.state}|${k}`)));
const groupsByCore = index(
  groups.filter((g) => g.type === "school_district"),
  (g) => g.units.map((u) => `${g.state}|${schoolCore(u.name, g.state)}`),
);

const typeOf = (e: Entity) => [...e.types.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
const compatible = (e: Entity, g: Group) => {
  const t = typeOf(e);
  return t === g.type || (t === "special_district" && g.type !== "higher_education" && g.type !== "school_district");
};

/** "City", "Town", "Village", "Borough" or "Township", when a name says which. New York's
 * Town of DeRuyter and Village of DeRuyter are two governments. */
const MUN_WORD = /\b(city|town|village|borough|township)\b/;
const munWords = (names: Iterable<string>) => new Set([...names].map((n) => n.toLowerCase().match(MUN_WORD)?.[1]).filter(Boolean) as string[]);
function sameKindOfPlace(e: Entity, g: Group): boolean {
  const mine = munWords(e.names.keys());
  const theirs = munWords(g.units.filter((u) => u.kind === "census").map((u) => u.name));
  return !mine.size || !theirs.size || [...mine].some((w) => theirs.has(w));
}

/** The one federal group this entry names, if exactly one fits. */
function groupFor(e: Entity): Group | undefined {
  const names = [...e.names.keys()];
  const all = new Set(names.flatMap((n) => keysFor(n).flatMap((k) => groupsByKey.get(`${e.state}|${k}`) ?? [])));
  // One candidate is that government, whatever it's called ("Town" on the roster, "City" in the Census).
  // Several share the name: "Town" or "Village" decides.
  const byName = all.size > 1 ? new Set([...all].filter((g) => sameKindOfPlace(e, g))) : all;
  if (byName.size === 1) return [...byName][0];
  if (byName.size > 1) {
    const fit = [...byName].filter((g) => compatible(e, g));
    if (fit.length === 1) return fit[0];
    // Same-named townships and districts: the county tells them apart.
    const county = countyOf(e);
    if (county) {
      const inCounty = (fit.length ? fit : [...byName]).filter((g) => g.units.some((u) => countyKey(u.county) === county));
      if (inCounty.length === 1) return inCounty[0];
    }
    return undefined;
  }
  if (typeOf(e) === "school_district") {
    const byCore = new Set(names.flatMap((n) => groupsByCore.get(`${e.state}|${schoolCore(n, e.state)}`) ?? []));
    if (byCore.size === 1) return [...byCore][0];
  }
  return undefined;
}

const countyKey = (c: string) => c.toLowerCase().replace(/\b(county|parish|borough)\b/g, "").replace(/[^a-z]/g, "");
/** The entry's county: from its roster row, or from a ", Washington County" suffix on its name. */
function countyOf(e: Entity): string {
  if (e.county) return countyKey(e.county.split("/")[0]);
  for (const n of e.names.keys()) {
    const m = n.match(/,\s*([^,]+?) (county|parish)\s*$/i);
    if (m) return countyKey(m[1]);
  }
  return "";
}

function attach(e: Entity, g: Group) {
  for (const u of g.units) {
    e.fed[u.kind] = u;
    if (usableDomain(u.domain)) e.webs.set(u.domain, u.kind);
    if (!e.city && u.city) e.city = u.city;
    if (!e.county && u.county) e.county = u.county;
  }
  // The registry's classification is authoritative.
  e.types.set(g.type, (e.types.get(g.type) ?? 0) + 100);
  if (g.units.some((u) => u.public)) e.status = "public";
  if (g.units.some((u) => u.kind === "ipeds" && !u.public)) e.private = true;
  e.from.add(g.units.map((u) => FED_SOURCE[u.kind]).join(" + "));
}
const FED_SOURCE = { census: "Census of Governments", nces: "NCES", ipeds: "IPEDS" } as const;

const owner = new Map<Group, Entity>();
let fedMatched = 0;
let fedMerged = 0;
const idMerges: { name: string; state: string; merged: string[]; id: string }[] = [];
const wasInferred = new Set<Entity>([...entities.values()].filter((e) => e.status === "inferred"));
const groupById = new Map<string, Group>();
for (const g of groups) for (const u of g.units) groupById.set(`${u.kind}:${u.id}`, g);
let matchedByReview = 0;
for (const e of [...entities.values()]) {
  if (e.mergedInto) continue;
  const reviewed = govDecisions[e.id]?.pick ? groupById.get(govDecisions[e.id].pick!) : undefined;
  const g = groupFor(e) ?? reviewed;
  if (!g) continue;
  if (reviewed === g && !groupFor(e)) matchedByReview++;
  const have = owner.get(g);
  if (have) {
    const a = live(have);
    if (idMerges.length < 2000) idMerges.push({ name: [...a.names.keys()][0], state: a.state, merged: [...e.names.keys()].slice(0, 2), id: `${g.units[0].kind} ${g.units[0].id}` });
    mergeInto(a, e);
    fedMerged++;
    continue;
  }
  owner.set(g, e);
  attach(e, g);
  fedMatched++;
}
const confirmedPublic = [...wasInferred].filter((e) => !e.mergedInto && e.status === "public").length;

// Governments no roster names: in the directory from the registries alone.
let fedAdded = 0;
for (const g of groups) {
  if (owner.has(g)) continue;
  if (g.units.every((u) => u.kind === "ipeds" && !u.public)) continue;
  // NCES spells school districts out ("Ada Exempted Village"); the Census names everything else best.
  const primary = (g.type === "school_district" ? g.units.find((u) => u.kind === "nces") : undefined) ?? g.units.find((u) => u.kind === "census") ?? g.units[0];
  const key = entityKey(primary.name);
  if (!key) continue;
  // Another government already holds this name in this state: keep them apart by ID.
  const k = lookup(`${g.state}|${key}`) ? `${key} ${primary.kind} ${primary.id}` : key;
  const e = entityFor(k === key ? primary.name : `${primary.name} ${primary.kind} ${primary.id}`, g.state, FED_SOURCE[primary.kind], "", "public");
  if (!e) continue;
  if (k !== key) {
    e.names.clear();
    e.names.set(primary.name, 1);
  }
  e.types.clear();
  for (const u of g.units.slice(1)) e.names.set(u.name, (e.names.get(u.name) ?? 0) + 0.5);
  owner.set(g, e);
  attach(e, g);
  fedAdded++;
}

/** Each usable federal website, and the government that holds it. */
const domainOwner = new Map<string, Entity>();
for (const [g, e] of owner) for (const u of g.units) if (usableDomain(u.domain)) domainOwner.set(u.domain, live(e));

// County offices -----------------------------------------------------------------
//
// Rosters list a county's sheriff, district attorney or clerk as members in their own right,
// but they're departments of the county government, not separate governments the Census
// counts. Point each at its county, which carries the federal ID.

const COUNTY_OFFICE =
  /^(?:the\s+)?(.+?\s(?:county|parish))\b[\s,'-]*(?:'s\s+)?(sheriff(?:'?s)?(?: office| department)?|district attorney(?:'?s)?(?: office)?|state'?s attorney(?:'?s)?(?: office)?|prosecut(?:or|ing attorney)(?:'?s)?(?: office)?|public defender(?:'?s)?(?: office)?|clerk(?: of courts?)?(?:'?s)?(?: office)?|probation(?: department)?|adult probation(?: department)?|juvenile (?:probation|justice|court|detention)(?: department| center)?|treasurer(?:'?s)?(?: office)?|assessor(?:'?s)?(?: office)?|auditor(?:'?s)?(?: office)?|recorder(?:'?s)?(?: office)?|coroner(?:'?s)?(?: office)?|medical examiner(?:'?s)?(?: office)?|jail|detention center|corrections(?: department)?|health department|public health(?: department)?|emergency management(?: agency| department)?|board of (?:county )?commissioners|commission(?:ers)?|fiscal court|board of supervisors|road (?:department|commission)|highway department|engineer(?:'?s)? office|parks(?: and recreation)?(?: department)?|elections?(?: office| board| commission)?|board of elections|human services|social services|department of [a-z ]+|ems|fleet services|information technology|it department|facilities|purchasing(?: department)?)\s*$/i;
let countyOffices = 0;
let countyGoverning = 0;
for (const e of [...entities.values()]) {
  if (e.mergedInto || e.fed.census || e.fed.nces || e.fed.ipeds) continue;
  for (const n of e.names.keys()) {
    const m = n.trim().match(COUNTY_OFFICE);
    if (!m) continue;
    const county = lookup(`${e.state}|${entityKey(m[1])}`);
    if (county && county !== e && county.fed.census) {
      // The commission or board of supervisors is the county government itself: one record, not two.
      if (/commission|board of (county )?commissioners|board of supervisors|fiscal court/i.test(m[2])) {
        mergeInto(live(county), e);
        countyGoverning++;
      } else {
        e.parent = live(county);
        e.types.set("county", (e.types.get("county") ?? 0) + 50);
        countyOffices++;
      }
      break;
    }
  }
}

// Roster governments still without a federal ID: their best federal candidates, for review.
{
  const ownerOf = new Map<Group, Entity>();
  for (const [g, e] of owner) ownerOf.set(g, live(e));
  const byWord = new Map<string, Group[]>();
  for (const g of groups)
    for (const w of new Set(g.units.flatMap((u) => [...nameWords(u.name)]))) {
      const k = `${g.state}|${w}`;
      (byWord.get(k) ?? byWord.set(k, []).get(k)!).push(g);
    }
  for (const e of entities.values()) {
    if (e.mergedInto || e.parent || e.fed.census || e.fed.nces || e.fed.ipeds || !e.coops.size) continue;
    const names = [...e.names.keys()];
    const words = new Set(names.flatMap((n) => [...nameWords(n)]));
    // Candidates share at least one word that isn't common in the state.
    const pool = new Set<Group>();
    for (const w of words) {
      const hit = byWord.get(`${e.state}|${w}`) ?? [];
      if (hit.length <= 400) for (const g of hit) pool.add(g);
    }
    const county = countyOf(e);
    const cands = [...pool]
      .map((g) => ({
        g,
        s:
          similarity(names, g.units.map((u) => u.name)) +
          (county && g.units.some((u) => countyKey(u.county) === county) ? 0.15 : 0) +
          (e.city && g.units.some((u) => u.city.toLowerCase() === e.city.toLowerCase()) ? 0.1 : 0) +
          (compatible(e, g) ? 0.05 : 0),
      }))
      .filter((x) => x.s >= 0.35)
      .sort((a, b) => b.s - a.s)
      .slice(0, 4);
    if (!cands.length) continue;
    // Certain "none" answers aren't worth a review: no registry covers tribes, and a single campus isn't a district.
    const all = names.join(" ");
    if (typeOf(e) === "tribal") continue;
    if (/\b(elementary|middle|high|junior high|intermediate|primary|academy|montessori|preschool|early learning|campus)\b/i.test(all) && !/district|schools|board|isd|usd/i.test(all)) continue;
    // Special districts only when the best candidate is close: many are volunteer fire companies or nonprofits.
    if (typeOf(e) === "special_district" && cands[0].s < 0.7) continue;
    cleanupTasks["gov-match"].push({
      id: e.id,
      score: Math.round(cands[0].s * 100) / 100,
      entry: { names: names.slice(0, 4), state: e.state, city: e.city || null, county: e.county || null, type: typeOf(e), source_labels: [...e.labels].slice(0, 2), coops: e.coops.size },
      candidates: cands.map(({ g }) => {
        const u = g.units.find((x) => x.kind === "census") ?? g.units[0];
        const held = ownerOf.get(g);
        return {
          id: `${u.kind}:${u.id}`,
          name: u.name,
          type: g.type,
          city: u.city || null,
          county: u.county || null,
          also: g.units.filter((x) => x !== u).map((x) => `${x.kind}: ${x.name}`),
          already_in_directory_as: held ? [...held.names.entries()].sort((a, b) => b[1] - a[1])[0][0] : null,
        };
      }),
    });
  }
}
mkdirSync(join(ROOT, "seed/cleanup/tasks"), { recursive: true });
for (const [name, rows] of Object.entries(cleanupTasks)) writeFileSync(join(ROOT, "seed/cleanup/tasks", `${name}.jsonl`), rows.map((r) => JSON.stringify(r)).join("\n") + "\n");

// 6. .gov domains -----------------------------------------------------------------

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
  // A registered domain that a federal registry already gives one government is that government.
  const owner = lookup(k) ?? domainOwner.get(normalizeDomain(domain));
  const existed = Boolean(owner);
  const e = owner ?? entityFor(name, state, ".gov registry", label);
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
// No .gov domain: the website a federal registry lists, if no other government claims it.
const WEB_RANK = { census: 0, nces: 1, ipeds: 2 } as const;
const webSource = new Map<Entity, "gov" | "census" | "nces" | "ipeds">();
for (const e of entities.values()) {
  if (e.domain) {
    webSource.set(e, "gov");
    for (const d of e.webs.keys()) if (d !== e.domain && !e.domains.includes(d) && e.domains.length < 8) e.domains.push(d);
    continue;
  }
  const webs = [...e.webs.entries()].sort((a, b) => WEB_RANK[a[1]] - WEB_RANK[b[1]] || a[0].length - b[0].length);
  if (!webs.length) continue;
  e.domain = webs[0][0];
  e.domains = webs.slice(1, 8).map(([d]) => d);
  webSource.set(e, webs[0][1]);
}

// ------------------------------------------------------------------ write the directory

const display = (e: Entity) => [...e.names.entries()].sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)[0][0].replace(/\s*\([A-Z]{2}\)$/, "");
const topType = (e: Entity) => [...e.types.entries()].sort((a, b) => b[1] - a[1])[0][0];

const privateSetAside = [...entities.values()].filter((e) => e.private);
const rows = [...entities.values()].filter((e) => !e.private).map((e) => {
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
    w: webSource.get(e),
    g:
      e.fed.census || e.fed.nces || e.fed.ipeds
        ? { c: e.fed.census?.id, n: e.fed.nces?.id, u: e.fed.ipeds?.id }
        : undefined,
    pt: e.parent ? { i: live(e.parent).id, n: display(live(e.parent)) } : undefined,
    pop: e.fed.census?.population,
    enr: e.fed.census?.enrollment,
    p: [...e.coops.values()],
    r: e.routes.size ? Object.fromEntries(e.routes) : undefined,
    x: e.dir ?? undefined,
    b: e.purchases.length ? e.purchases : undefined,
    f: [...e.from],
  };
});
rows.sort((a, b) => a.s.localeCompare(b.s) || a.n.localeCompare(b.n));

const coopIds = [...new Set(Object.values(COOPS))];
const directory = { version: 1, retrieved: RETRIEVED, sources: ["coop-memberships-2026-11-13.xlsx", "dotgov-domains-2026-11-13.csv", "census-gov-units-2026.csv.gz", "nces-ccd-lea-2024-25.csv.gz", "ipeds-hd-2024.csv.gz"], coops: coopIds, routes: ROUTES, rows };
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
// Rosters fetched after the workbook was made replace their program's "selected relationships" line.
const EXTRA_ROSTER_NOTES: Record<string, { evidence: string; next: string; url: string }> = {
  "Choice Partners": {
    evidence: "Public member table: name, entity type and state",
    next: "Non-profits and private schools set aside; members whose type isn't given are kept only when the name reads as government.",
    url: "https://www.choicepartners.org/view-members/",
  },
  "1GPA": {
    evidence: "Published membership workbook, last modified August 16, 2023",
    next: "A historical snapshot: a listed member may have left since. Ask 1GPA for a current list.",
    url: "https://www.1gpa.org",
  },
};
for (const [program, note] of Object.entries(EXTRA_ROSTER_NOTES)) {
  const st = programStats[program];
  if (!st) continue;
  const line = { program, status: "Roster imported", records: st.raw, ...note };
  const i = coverage.findIndex((c) => c.program === program);
  if (i >= 0) coverage[i] = line;
  else coverage.push(line);
}

// How far the federal IDs reach, for the /data page.
const withId = rows.filter((r) => r.g);
const rosterWithId = rows.filter((r) => r.g && r.p.some((p) => p.e === "roster"));
const rosterAll = rows.filter((r) => r.p.some((p) => p.e === "roster"));
const idByType: Record<string, { all: number; with_id: number }> = {};
for (const r of rosterAll) {
  const t = (idByType[r.t] ??= { all: 0, with_id: 0 });
  t.all++;
  if (r.g) t.with_id++;
}
const sample = <T,>(xs: T[], n: number) => xs.filter((_, i) => i % Math.max(1, Math.floor(xs.length / n)) === 0).slice(0, n);
const federal = {
  sources: [
    { id: "census", name: "Census Bureau, Government Units List 2026", url: "https://www2.census.gov/programs-surveys/gus/datasets/2026/", records: census.length, note: "Counties, municipalities, townships, special districts and school districts, each with a CENSUS_ID_PID6" },
    { id: "nces", name: "NCES Common Core of Data, district directory 2024-25", url: "https://nces.ed.gov/ccd/files.asp", records: nces.length, note: "Open public school districts, charter districts and service agencies, each with an LEAID" },
    { id: "ipeds", name: "IPEDS institutional characteristics 2024", url: "https://nces.ed.gov/ipeds/datacenter/DataFiles.aspx", records: ipeds.length, note: `Active colleges with a UNITID; ${ipeds.filter((u) => u.public).length.toLocaleString()} public` },
  ],
  census_by_type: census.reduce<Record<string, number>>((m, u) => ((m[u.type] = (m[u.type] ?? 0) + 1), m), {}),
  college_pairs: collegePairs,
  school_pairs: { by_website: pairedByDomain, by_name: pairedByName, census_only: census.filter((u) => u.type === "school_district").length - pairedByDomain - pairedByName, nces_only: nces.length - pairedNces.size },
  matched: fedMatched,
  merged_by_id: fedMerged,
  county_offices: countyOffices,
  reviewed_school_pairs: pairedByReview,
  reviewed_matches: matchedByReview,
  review_tasks: Object.fromEntries(Object.entries(cleanupTasks).map(([k, v]) => [k, v.length])),
  county_governing_bodies_merged: countyGoverning,
  added: fedAdded,
  confirmed_public: confirmedPublic,
  private_set_aside: privateSetAside.length,
  private_examples: sample(privateSetAside.filter((e) => e.coops.size), 6).map((e) => ({ name: display(e), state: e.state, coops: [...e.coops.keys()] })),
  governments_with_id: withId.length,
  roster_governments: rosterAll.length,
  roster_with_id: rosterWithId.length,
  roster_by_type: idByType,
  unmatched_examples: sample(rosterAll.filter((r) => !r.g && r.st === "public" && r.t !== "state_agency"), 8).map((r) => ({ name: r.n, state: r.s, type: r.t })),
  merge_examples: sample(
    idMerges.filter((m) => m.merged.some((n) => entityKey(n) !== entityKey(m.name))),
    8,
  ),
  websites: {
    total: rows.filter((r) => r.d).length,
    by_source: rows.reduce<Record<string, number>>((m, r) => (r.w ? ((m[r.w] = (m[r.w] ?? 0) + 1), m) : m), {}),
    roster_with_website: rosterAll.filter((r) => r.d).length,
  },
};

const insights = {
  generated: RETRIEVED,
  retrieved: RETRIEVED,
  federal,
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
  `Federal IDs: ${withId.length.toLocaleString()} governments; ${rosterWithId.length.toLocaleString()} of ${rosterAll.length.toLocaleString()} roster governments (${Math.round((100 * rosterWithId.length) / rosterAll.length)}%); ${fedMerged.toLocaleString()} entries merged by ID; ${fedAdded.toLocaleString()} added from registries; ${privateSetAside.length} private colleges set aside.`,
);
console.log(`Websites: ${federal.websites.total.toLocaleString()} (${JSON.stringify(federal.websites.by_source)}); school pairs ${JSON.stringify(federal.school_pairs)}.`);
console.log(
  `Directory: ${rows.length.toLocaleString()} governments (${rosterRows.length.toLocaleString()} on a roster, ${rows.filter((r) => r.d).length.toLocaleString()} with a website).`,
);
console.log(`Roster rows ${rawRows.toLocaleString()}; kept ${Object.values(programStats).reduce((s, p) => s + p.kept, 0).toLocaleString()}; dropped ${Object.values(programStats).reduce((s, p) => s + p.dropped, 0).toLocaleString()} as non-government or unverifiable.`);
console.log(`Overlap: ${ourMulti.toLocaleString()} governments on 2+ rosters (conservative key found ${conservativeMulti.toLocaleString()}); ${heavyUsers.toLocaleString()} on 3+ co-ops.`);
console.log(`DIR: ${dirMerged.size.toLocaleString()} buyers after merging ${blankMerges.length} blank-state splits; ${dirMatchedRoster.toLocaleString()} matched to a roster.`);
console.log(`Member IDs published by agencies: ${idChecks.length}; ${idChecks.filter((c) => c.agrees).length} agree with the roster, ${idChecks.filter((c) => c.agrees === false).length} disagree.`);
console.log(`NASPO Parks: ${naspoAccess.parks.awards.length} awards; ${adopters.length} local adopters; ${addendumDiffs.length} Citizen Engagement awards whose states differ from Agora's seed.`);
