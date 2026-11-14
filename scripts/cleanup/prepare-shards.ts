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

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const OUT = join(ROOT, "seed/cleanup/shards");
const ONLY = new Set(process.argv.slice(2));
const wanted = (task: string) => !ONLY.size || ONLY.has(task);
if (!ONLY.size) rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
for (const f of existsSync(OUT) ? readdirSync(OUT) : []) if (ONLY.size && [...ONLY].some((t) => f.startsWith(`${t}-`))) rmSync(join(OUT, f));

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
const sins = JSON.parse(readFileSync(join(ROOT, "seed/catalog/source/gsa-sins.json"), "utf8")).sins as Record<string, { title: string; description: string }>;
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
  const sinsAll = JSON.parse(readFileSync(join(ROOT, "seed/catalog/source/gsa-sins.json"), "utf8")).sins as Record<string, { title: string; description: string }>;
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
shard(
  "canon-rows",
  (validation.canon_unparsed_price_rows as { page: number; line: string }[]).map((r, i) => ({ id: `canon-${i + 1}`, page: r.page, line: r.line })),
  300,
);

// 6. Products whose sources name them differently: pick the clearest name among the variants.
const rawProducts = gz(join(ROOT, "seed/catalog/source/products.jsonl.gz")).split("\n").filter(Boolean).map((l) => JSON.parse(l));
shard(
  "product-name",
  rawProducts.filter((p) => p.title_conflict_requires_review).map((p) => ({ id: p.product_id, maker: p.manufacturer, mpn: p.manufacturer_sku, variants: p.product_name_variants.slice(0, 6) })),
  400,
);

if (!ONLY.size) writeFileSync(join(OUT, "index.json"), JSON.stringify({ categories: CATEGORIES, counts }, null, 1));
console.log(counts);
