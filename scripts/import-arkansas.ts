// Arkansas: the Office of State Procurement's statewide contracts, a TRX state (lib/trx.ts).
// The OSP directory lists 97 contracts, but a listing often groups several vendors and outline
// agreements ("Ariens, Deere & Company, Kubota, The Toro Company"), with commas inside legal names
// too, so splitting them is a review step, as Hawaii's lists are.
//
//   npm run import:arkansas -- --read <folder>     a fresh OSP download (the unzipped collection, all
//                                                  parts in one folder): copy the directory into the
//                                                  committed source and write review shards to
//                                                  seed/cleanup/shards/arkansas-NN.json
//   (review agents split each listing into supplier contracts: seed/cleanup/out/arkansas-NN.json)
//   npm run import:arkansas -- --collect <folder>  keep only vendors, agreement numbers, co-op links and
//                                                  quotes found in the listing's own text:
//                                                  seed/catalog/source/arkansas/extracted.json
//   npm run import:arkansas                        build records.json.gz; then npm run import:catalog-coops
//
// Who may buy: Arkansas's participating addenda treat "each state agency and political subdivision"
// as a participating entity, so a listing is open to Arkansas cities, counties and school districts
// unless its own text limits it to state agencies. The detail pages name state buyers and vendor
// contacts with phone numbers; neither is committed.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "seed/catalog/source/arkansas");
const SHARDS = join(ROOT, "seed/cleanup/shards");
const ANSWERS = join(ROOT, "seed/cleanup/out");
const COOP = "Arkansas OSP";
const SOURCE = "https://sas.arkansas.gov/procurement/state-contracts/";

interface Listing {
  post_id: string;
  commodity: string;
  tracking: string;
  outline: string;
  expires: string | null;
  vendors: string;
  description: string;
  mandatory: boolean;
  coop: string;
  url: string;
  documents: { label: string; url: string }[];
  links: { label: string; url: string }[];
}
const iso = (s: string) => {
  const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  return m ? `${m[3]}-${m[1]}-${m[2]}` : null;
};

const mode = process.argv[2];
const dir = process.argv[3] ? resolve(process.argv[3]) : "";

// ------------------------------------------------------------------ 1. read a download and shard it

if (mode === "--read") {
  const raw = JSON.parse(readFileSync(join(dir, "contracts.json"), "utf8")) as { directory_record: Record<string, string>; links: Record<string, string>[]; detail_text: string; detail_fields?: Record<string, string[]> }[];
  // Some directory fields are only in the parsed detail table ("Co-Op").
  for (const r of raw) {
    const f = r.detail_fields ?? {};
    for (const k of ["contract_tracking_number", "outline_agreement_numbers", "expiration_date_published", "vendor_names_published", "additional_description", "mandatory", "cooperative_source_published", "contract_url", "commodity", "retrieved_date"]) r.directory_record[k] ??= "";
    if (!r.directory_record.cooperative_source_published) r.directory_record.cooperative_source_published = (f["Co-Op"] ?? [""]).join(", ");
  }
  const docs = JSON.parse(readFileSync(join(dir, "documents.json"), "utf8")) as Record<string, string>[];
  const retrieved = raw[0]?.directory_record.retrieved_date ?? "";
  // The directory without the buyer's name.
  const listings: Listing[] = raw.map((r) => {
    const d = r.directory_record;
    return {
      post_id: d.source_post_id,
      commodity: d.commodity.trim(),
      tracking: d.contract_tracking_number.trim(),
      outline: d.outline_agreement_numbers.trim(),
      expires: iso(d.expiration_date_published),
      vendors: d.vendor_names_published.trim(),
      description: d.additional_description.trim(),
      mandatory: d.mandatory === "Yes",
      coop: d.cooperative_source_published.trim(),
      url: d.contract_url,
      documents: docs.filter((x) => x.source_post_id === d.source_post_id).map((x) => ({ label: x.link_name, url: x.url })),
      links: r.links.filter((l) => l.link_type === "Reference page").map((l) => ({ label: l.link_name, url: l.url })),
    };
  });
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "directory.json"), JSON.stringify({ source: SOURCE, retrieved, listings }, null, 1) + "\n");

  // Shards: each listing with its page text and its documents' text paths, for the reviewers only.
  const N = 2;
  mkdirSync(SHARDS, { recursive: true });
  const items = raw.map((r) => ({
    post_id: r.directory_record.source_post_id,
    commodity: r.directory_record.commodity,
    vendors_published: r.directory_record.vendor_names_published,
    outline_published: r.directory_record.outline_agreement_numbers,
    coop_published: r.directory_record.cooperative_source_published,
    page_text: r.detail_text,
    links: r.links.filter((l) => l.link_type === "Reference page").map((l) => ({ label: l.link_name, url: l.url })),
    documents: docs
      .filter((x) => x.source_post_id === r.directory_record.source_post_id)
      .map((x) => ({ label: x.link_name, text: x.text_file && existsSync(join(dir, x.text_file)) ? join(dir, x.text_file) : null })),
  }));
  for (let i = 0; i < N; i++)
    writeFileSync(join(SHARDS, `arkansas-${String(i + 1).padStart(2, "0")}.json`), JSON.stringify(items.filter((_, j) => j % N === i), null, 1));
  console.log(`Read ${listings.length} listings (retrieved ${retrieved}); ${N} shards.`);
  process.exit(0);
}

// ------------------------------------------------------------------ 2. check the answers

interface Answer {
  post_id: string;
  kind: "contract" | "qualified_vendor_list" | "catalog";
  vendors: { name: string; outline: string | null; coop_ref: string | null; coop_url: string | null }[];
  locals: "open" | "state_agencies_only" | "unstated";
  locals_quote: string | null;
}
const norm = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();
const PERSONAL = /@|\(\d{3}\)\s*\d{3}-\d{4}|\b\d{3}-\d{3}-\d{4}\b/;

if (mode === "--collect") {
  const kept: Answer[] = [];
  const stats = { listings: 0, answered: 0, vendors: 0, vendors_dropped: 0, outlines_dropped: 0, coop_links_dropped: 0, quotes_dropped: 0 };
  for (const f of readdirSync(SHARDS).filter((f) => /^arkansas-\d+\.json$/.test(f))) {
    const items = JSON.parse(readFileSync(join(SHARDS, f), "utf8")) as { post_id: string; vendors_published: string; outline_published: string; page_text: string; links: { url: string }[]; documents: { text: string | null }[] }[];
    const answers = existsSync(join(ANSWERS, f)) ? (JSON.parse(readFileSync(join(ANSWERS, f), "utf8")) as Record<string, Answer>) : {};
    for (const it of items) {
      stats.listings++;
      const a = answers[it.post_id];
      if (!a) continue;
      stats.answered++;
      const page = norm(`${it.page_text} ${it.vendors_published} ${it.outline_published}`);
      const docsText = norm(it.documents.map((d) => (d.text && existsSync(d.text) ? readFileSync(d.text, "utf8") : "")).join(" "));
      const urls = new Set(it.links.map((l) => l.url));
      const vendors = (a.vendors ?? []).flatMap((v) => {
        if (!v.name || PERSONAL.test(v.name) || !page.includes(norm(v.name))) return (stats.vendors_dropped++, []);
        stats.vendors++;
        const outline = v.outline && page.includes(norm(v.outline)) ? v.outline : null;
        if (v.outline && !outline) stats.outlines_dropped++;
        const coop_url = v.coop_url && urls.has(v.coop_url) ? v.coop_url : null;
        if (v.coop_url && !coop_url) stats.coop_links_dropped++;
        return [{ name: v.name.trim(), outline, coop_ref: v.coop_ref && !PERSONAL.test(v.coop_ref) ? v.coop_ref.slice(0, 80) : null, coop_url }];
      });
      // A limit to state agencies counts only with a quote from the listing's page or documents.
      const quoteOk = Boolean(a.locals_quote && !PERSONAL.test(a.locals_quote) && (page.includes(norm(a.locals_quote)) || docsText.includes(norm(a.locals_quote))));
      if (a.locals_quote && !quoteOk) stats.quotes_dropped++;
      kept.push({ post_id: it.post_id, kind: a.kind, vendors, locals: a.locals === "state_agencies_only" && !quoteOk ? "unstated" : a.locals, locals_quote: quoteOk ? a.locals_quote : null });
    }
  }
  writeFileSync(join(OUT, "extracted.json"), JSON.stringify({ checked: stats, listings: kept.sort((a, b) => Number(a.post_id) - Number(b.post_id)) }, null, 1) + "\n");
  console.log(stats);
  process.exit(0);
}

// ------------------------------------------------------------------ 3. build the records

const directory = JSON.parse(readFileSync(join(OUT, "directory.json"), "utf8")) as { retrieved: string; listings: Listing[] };
const extracted = JSON.parse(readFileSync(join(OUT, "extracted.json"), "utf8")) as { checked: Record<string, number>; listings: Answer[] };
const retrieved = directory.retrieved;
const hash = (s: string, n = 16) => createHash("sha1").update(s).digest("hex").slice(0, n);
const answerFor = new Map(extracted.listings.map((a) => [a.post_id, a]));

const suppliers = new Map<string, Record<string, unknown>>();
const supplierFor = (name: string) => {
  const clean = name.replace(/\s+/g, " ").trim();
  const id = `sup_ar_${hash(clean.toLowerCase())}`;
  if (!suppliers.has(id)) suppliers.set(id, { supplier_id: id, name: clean, name_variants: [clean], cooperatives: [COOP] });
  return id;
};
const contracts: Record<string, unknown>[] = [];
const documents: Record<string, unknown>[] = [];
const stats = { listings: directory.listings.length, contracts: 0, open_to_locals: 0, state_only: 0, qualified_vendor_lists: 0, mandatory: 0, coop_adopted: 0, documents: 0 };

for (const l of directory.listings) {
  const a = answerFor.get(l.post_id);
  if (!a || !a.vendors.length) continue;
  if (a.kind === "qualified_vendor_list") stats.qualified_vendor_lists++;
  const locals = a.locals !== "state_agencies_only";
  const coop = l.coop && !/^n\/?a$/i.test(l.coop) ? l.coop : null;
  for (const v of a.vendors) {
    const id = `con_ar_${hash(`${l.post_id}|${v.name.toLowerCase()}`, 12)}`;
    stats.contracts++;
    locals ? stats.open_to_locals++ : stats.state_only++;
    if (l.mandatory) stats.mandatory++;
    if (coop) stats.coop_adopted++;
    contracts.push({
      contract_id: id,
      cooperative: COOP,
      contract_number: v.outline ?? (l.tracking || `OSP ${l.post_id}`),
      supplier_id: supplierFor(v.name),
      supplier_name: v.name,
      title: l.commodity,
      start_date: null,
      end_date: l.expires,
      category_labels: [l.description.slice(0, 400), ...(coop ? [`${coop} participating addendum`] : [])].filter(Boolean),
      regions_as_published: ["Arkansas"],
      contract_url: l.url,
      lead_agency: coop ? `State of Arkansas participating addendum to ${coop}` : "State of Arkansas, Office of State Procurement",
      source_metadata: {
        state_contract: {
          state: "AR",
          locals,
          solicitation: v.coop_ref ?? coop ?? (l.tracking || null),
          type_code: a.kind === "qualified_vendor_list" ? "Qualified vendor list" : l.mandatory ? "Mandatory for state agencies" : null,
          group: coop ? "Cooperative participating addendum" : "OSP statewide contract",
        },
        locals_quote: a.locals_quote,
        tracking: l.tracking || null,
        mandatory: l.mandatory,
        coop_url: v.coop_url,
        line_items_paginated: false,
      },
    });
    for (const d of l.documents) {
      documents.push({ document_id: `doc_ar_${hash(`${id}|${d.url}`)}`, cooperative: COOP, url: d.url, label: d.label, contract_id: id });
      stats.documents++;
    }
  }
}

const records = { retrieved, suppliers: [...suppliers.values()], contracts, products: [], offerings: [], documents };
writeFileSync(join(OUT, "records.json.gz"), gzipSync(JSON.stringify(records), { level: 9 }));
const summary = { source: SOURCE, retrieved, checked: extracted.checked, ...stats, suppliers: suppliers.size, priced_lines: 0 };
writeFileSync(join(OUT, "summary.json"), JSON.stringify(summary, null, 1) + "\n");
console.log(JSON.stringify(summary, null, 1));
