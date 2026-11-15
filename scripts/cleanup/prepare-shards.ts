// Splits the AI review tasks into shards for the review agents. Inputs come from the
// importers (seed/cleanup/tasks/*.jsonl) and the co-op catalog; every item carries the
// real candidates a reviewer chooses among, so a model picks, it never invents.
//
//   npx tsx scripts/cleanup/prepare-shards.ts            every task
//   npx tsx scripts/cleanup/prepare-shards.ts nigp       only the named tasks; other shards are kept
//
// Writes seed/cleanup/shards/<task>-NN.jsonl (not committed). Reviewers write
// seed/cleanup/out/<task>-NN.json, and scripts/cleanup/collect.ts merges them into
// seed/cleanup/decisions/<task>.json, which the importers apply.

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import { CATEGORIES } from "../../lib/types";
import { productKindKey } from "../product-kind";

type Item = Record<string, any>;

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const OUT = join(ROOT, "seed/cleanup/shards");
const ONLY = new Set(process.argv.slice(2));
const wanted = (task: string) => !ONLY.size || ONLY.has(task);
if (!ONLY.size) rmSync(OUT, { recursive: true, force: true }); // every task, product-kind's earlier batches included
mkdirSync(OUT, { recursive: true });
// product-kind is incremental: its answers are numbered by line within each shard, so earlier shards stay as they are.
for (const f of existsSync(OUT) ? readdirSync(OUT) : []) if (ONLY.size && [...ONLY].some((t) => t !== "product-kind" && f.startsWith(`${t}-`))) rmSync(join(OUT, f));

const jsonl = (path: string) => readFileSync(path, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
const gz = (path: string) => gunzipSync(readFileSync(path)).toString("utf8");
const counts: Record<string, number> = {};
function shard(task: string, items: unknown[], size: number) {
  if (!wanted(task)) return;
  counts[task] = items.length;
  for (let i = 0; i * size < items.length; i++)
    writeFileSync(join(OUT, `${task}-${String(i + 1).padStart(2, "0")}.jsonl`), items.slice(i * size, (i + 1) * size).map((x) => JSON.stringify(x)).join("\n") + "\n");
}

// 1. Governments without a federal ID, and their federal candidates.
if (wanted("gov-match")) shard(
  "gov-match",
  jsonl(join(ROOT, "seed/cleanup/tasks/gov-match.jsonl")).map((t) => ({
    id: t.id,
    names: t.entry.names,
    state: t.entry.state,
    city: t.entry.city,
    county: t.entry.county,
    type: t.entry.type,
    candidates: t.candidates.map((c: Record<string, unknown>) => ({ id: c.id, name: c.name, type: c.type, city: c.city, county: c.county, also: c.also, in_directory_as: c.already_in_directory_as })),
  })),
  600,
);

// 2. Census school districts the rules couldn't pair with an NCES district.
if (wanted("school-pairs")) shard("school-pairs", jsonl(join(ROOT, "seed/cleanup/tasks/school-pairs.jsonl")), 600);

// 3. Supplier names the capture flagged as look-alikes it didn't merge.
const catalog = JSON.parse(gz(join(ROOT, "seed/catalog/catalog.json.gz")));
const rawSuppliers = gz(join(ROOT, "seed/catalog/source/suppliers.jsonl.gz")).split("\n").filter(Boolean).map((l) => JSON.parse(l));
const rawToCat = new Map<string, string>();
{
  // The importer merged some of these already; work from the merged companies.
  const byName = new Map<string, string>();
  for (const s of catalog.suppliers) for (const n of [s.name, ...s.aliases]) byName.set(n, s.id);
  for (const r of rawSuppliers) for (const n of [r.name, ...r.name_variants]) if (byName.has(n)) rawToCat.set(r.supplier_id, byName.get(n)!);
}
const catSupplier = new Map(catalog.suppliers.map((s: { id: string }) => [s.id, s]));
const review = JSON.parse(gz(join(ROOT, "seed/catalog/source/supplier_match_review.json.gz"))) as { comparison_key: string; candidates: { supplier_id: string }[] }[];
const groups = review
  .map((g) => {
    const ids = [...new Set(g.candidates.map((c) => rawToCat.get(c.supplier_id)).filter(Boolean))] as string[];
    return {
      id: g.comparison_key,
      suppliers: ids.map((id) => {
        const s = catSupplier.get(id) as { id: string; name: string; aliases: string[]; websites: string[]; coops: string[]; contracts: number };
        return { id, name: s.name, aliases: s.aliases.slice(0, 3), websites: s.websites, coops: s.coops, contracts: s.contracts };
      }),
    };
  })
  .filter((g) => g.suppliers.length > 1);
shard("supplier-merge", groups, 400);

// 4. Contract categories: each distinct contract title, and each GSA SIN.
const titles = new Map<string, { title: string; labels: Set<string>; coops: Set<string>; n: number }>();
for (const c of catalog.contracts) {
  if (c.coop === "GSA MAS") continue;
  const k = c.title.trim().toLowerCase();
  const t = titles.get(k) ?? { title: c.title.trim(), labels: new Set<string>(), coops: new Set<string>(), n: 0 };
  for (const l of c.categories.slice(0, 3)) t.labels.add(l);
  t.coops.add(c.coop);
  t.n++;
  titles.set(k, t);
}
// GSA's SINs moved to the stash with GSA (seed/stash/gsa/).
const sinsPath = [join(ROOT, "seed/catalog/source/gsa-sins.json"), join(ROOT, "seed/stash/gsa/gsa-sins.json")].find((f) => existsSync(f));
const sins = (wanted("category") && sinsPath ? JSON.parse(readFileSync(sinsPath, "utf8")).sins : {}) as Record<string, { title: string; description: string }>;
shard(
  "category",
  [
    ...[...titles.entries()].map(([k, t]) => ({ id: `title:${k}`, title: t.title, labels: [...t.labels].slice(0, 3), coops: [...t.coops].slice(0, 3) })),
    ...Object.entries(sins).map(([code, x]) => ({ id: `sin:${code}`, title: x.title, labels: [x.description.slice(0, 200)], coops: ["GSA MAS"] })),
  ],
  1000,
);

// 7. NIGP commodity classes for every co-op contract title and GSA SIN: the same items as the
// category task, choosing up to three classes from the ones NJSTART's public records name
// (seed/catalog/source/njstart/nigp.json), or none.
{
  const nigp = JSON.parse(readFileSync(join(ROOT, "seed/catalog/source/njstart/nigp.json"), "utf8")) as { classes: Record<string, { items: string[] }> };
  // GSA's SINs moved to the stash with GSA; read them only when the NIGP review runs.
  const sinsAll = (wanted("nigp") && sinsPath ? JSON.parse(readFileSync(sinsPath, "utf8")).sins : {}) as Record<string, { title: string; description: string }>;
  const ts = new Map<string, { title: string; labels: Set<string>; coops: Set<string> }>();
  for (const c of catalog.contracts) {
    if (c.coop === "GSA MAS" || c.state_contract) continue;
    const k = c.title.trim().toLowerCase();
    const t = ts.get(k) ?? { title: c.title.trim(), labels: new Set<string>(), coops: new Set<string>() };
    for (const l of c.categories.slice(0, 3)) t.labels.add(l);
    t.coops.add(c.coop);
    ts.set(k, t);
  }
  if (wanted("nigp")) {
    writeFileSync(join(OUT, "nigp-classes.json"), JSON.stringify(Object.fromEntries(Object.entries(nigp.classes).map(([k, v]) => [k, v.items.slice(0, 8)])), null, 1));
    shard(
      "nigp",
      [
        ...[...ts.entries()].map(([k, t]) => ({ id: `title:${k}`, title: t.title, labels: [...t.labels].slice(0, 3), coops: [...t.coops].slice(0, 3) })),
        ...Object.entries(sinsAll).map(([code, x]) => ({ id: `sin:${code}`, title: x.title, labels: [x.description.slice(0, 200)], coops: ["GSA MAS"] })),
      ],
      370,
    );
  }
}

// 5. Canon price-file rows the capture's parser couldn't read.
const validation = JSON.parse(readFileSync(join(ROOT, "seed/catalog/source/validation.json"), "utf8"));
if (wanted("canon-rows")) shard(
  "canon-rows",
  (validation.canon_unparsed_price_rows as { page: number; line: string }[]).map((r, i) => ({ id: `canon-${i + 1}`, page: r.page, line: r.line })),
  300,
);

// 6. Products whose sources name them differently: pick the clearest name among the variants.
const rawProducts = gz(join(ROOT, "seed/catalog/source/products.jsonl.gz")).split("\n").filter(Boolean).map((l) => JSON.parse(l));
if (wanted("product-name")) shard(
  "product-name",
  rawProducts.filter((p) => p.title_conflict_requires_review).map((p) => ({ id: p.product_id, maker: p.manufacturer, mpn: p.manufacturer_sku, variants: p.product_name_variants.slice(0, 6) })),
  400,
);

// 8. What each product is: its kind ("pickup truck"), its role (a whole item, a part, a rate), and other names buyers
// use for it. One item per distinct name; the answer applies to every product of that name. The kind must be made of
// words the product's own record uses (collect.ts checks), so a reviewer names it, it never invents it.
// Run it on the catalog built with every product (AGORA_INCLUDE_STASHED=1 npm run import:catalog-coops), so stashed
// products are coded too and the stash can follow their role (scripts/product-stash.ts). It is incremental: names with a
// high- or medium-confidence answer already are skipped, and new shards are numbered after the existing ones. Left to
// the rules, not the review: products with no price, Burke's hardware families (part numbers under 200) and lines
// priced by the hour, day or month.
if (wanted("product-kind")) {
  const decided: Record<string, { confidence: string }> = existsSync(join(ROOT, "seed/cleanup/decisions/product-kind.json")) ? JSON.parse(readFileSync(join(ROOT, "seed/cleanup/decisions/product-kind.json"), "utf8")) : {};
  const RATE_UNIT = /^(hours?|hr|hourly|minutes?|days?|weeks?|months?|monthly|quarter|years?|annual|task|fare|miles?|trip|visit|per person|per page|kwh|btu|therm|acre)\b/i;
  const contractById = new Map<string, Item>(catalog.contracts.map((c: Item) => [c.id, c]));
  const offersByProduct = new Map<string, Item[]>();
  for (const o of catalog.offerings) (offersByProduct.get(o.product) ?? offersByProduct.set(o.product, []).get(o.product)!).push(o);
  const queued = new Set<string>();
  // Names already sent to a reviewer in an earlier batch, answered or not.
  for (const f of readdirSync(OUT).filter((f) => /^product-kind-\d+\.jsonl$/.test(f)))
    for (const l of readFileSync(join(OUT, f), "utf8").split("\n").filter(Boolean)) queued.add(String(JSON.parse(l).id));
  const fresh = new Map<string, Item>();
  for (const p of catalog.products) {
    const key = productKindKey(p.name);
    if (fresh.has(key) || (decided[key] && decided[key].confidence !== "low")) continue;
    // A low-confidence answer is asked again only when AGORA_REASK_LOW=1, and an unanswered one only with it too.
    if (decided[key] && process.env.AGORA_REASK_LOW !== "1") continue;
    const offers = offersByProduct.get(p.id) ?? [];
    if (!offers.some((o) => o.price != null || o.list != null)) continue;
    const o = offers[0];
    if (o.coop === "OMNIA Partners" && Number(String(p.mpn ?? "").split("-")[0]) < 200) continue;
    if (offers.every((x) => RATE_UNIT.test(x.unit ?? ""))) continue;
    if (queued.has(key) && !decided[key] && process.env.AGORA_REASK_LOW !== "1") continue;
    const c: Item = contractById.get(o.contract) ?? {};
    fresh.set(key, {
      id: key,
      name: p.name,
      maker: p.maker ?? undefined,
      contract: String(c.title ?? "").slice(0, 90),
      section: o.category ? String(o.category).split(":")[0].slice(0, 70) : undefined,
      unit: o.unit ?? undefined,
      price: o.price ?? o.list ?? undefined,
    });
  }
  // Number new shards after the existing ones.
  const last = Math.max(0, ...readdirSync(OUT).filter((f) => /^product-kind-\d+\.jsonl$/.test(f)).map((f) => Number(f.match(/\d+/)![0])));
  const items = [...fresh.values()];
  const size = 480;
  for (let i = 0; i * size < items.length; i++)
    writeFileSync(join(OUT, `product-kind-${String(last + i + 1).padStart(2, "0")}.jsonl`), items.slice(i * size, (i + 1) * size).map((x) => JSON.stringify(x)).join("\n") + "\n");
  counts["product-kind"] = items.length;
}

// 9. Packaged services: the product owner's rule is that a service sold as a fixed package (a 3-year service plan, an
// installation package, remediation per document) counts as a product, while hourly and other time-based rates, lines
// that mix goods with labor, and one agency's own project line items do not. The product-kind review's "service" lines,
// and state-program items whose names read like project billing, are asked which they are. Run on the catalog built with
// AGORA_INCLUDE_STASHED=1, after the product-kind review.
if (wanted("package-check")) {
  const kinds: Record<string, { role: string; confidence: string }> = existsSync(join(ROOT, "seed/cleanup/decisions/product-kind.json")) ? JSON.parse(readFileSync(join(ROOT, "seed/cleanup/decisions/product-kind.json"), "utf8")) : {};
  const RATE_UNIT = /^(hours?|hr|hourly|minutes?|days?|weeks?|months?|monthly|quarter|years?|annual|task|fare|miles?|trip|visit|per person|per page|kwh|btu|therm|acre)\b/i;
  const PROJECT = /\b(payments?|deliverables?|implementation|development|phase|project|one-time cost|bid solicitation section|rfp section)\b/i;
  const STATE = new Set(["NJSTART", "Hawaii SPO", "OregonBuys", "NYS OGS", "NY Preferred Source", "Arkansas OSP", "Empire Procure Connect"]);
  const contractById = new Map<string, Item>(catalog.contracts.map((c: Item) => [c.id, c]));
  const firstOffer = new Map<string, Item>();
  for (const o of catalog.offerings) if (!firstOffer.has(o.product) && (o.price != null || o.list != null)) firstOffer.set(o.product, o);
  const picked = new Map<string, Item>();
  for (const p of catalog.products) {
    const key = productKindKey(p.name);
    const k = kinds[key];
    const o = firstOffer.get(p.id);
    if (!k || k.confidence === "low" || !o || picked.has(key) || RATE_UNIT.test(o.unit ?? "")) continue;
    const isService = k.role === "service";
    const projectish = (k.role === "item" || k.role === "consumable") && STATE.has(o.coop) && (PROJECT.test(p.name) || (o.price ?? 0) >= 100000);
    if (!isService && !projectish) continue;
    const c: Item = contractById.get(o.contract) ?? {};
    picked.set(key, { id: key, name: p.name, contract: String(c.title ?? "").slice(0, 90), program: o.coop, unit: o.unit ?? undefined, price: o.price ?? o.list, coded_as: k.role });
  }
  shard("package-check", [...picked.values()], 450);
}

if (!ONLY.size) writeFileSync(join(OUT, "index.json"), JSON.stringify({ categories: CATEGORIES, counts }, null, 1));
console.log(counts);
