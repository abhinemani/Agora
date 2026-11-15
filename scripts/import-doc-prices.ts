// Brings the item prices read from the state programs' price sheets (lib/price-sheets.ts, on the server) into the
// repository: pages through /api/docs/prices on the live site (or the address given) and writes
// seed/catalog/source/doc-prices/rows.json.gz. Then npm run import:catalog-coops folds them into the catalog.
//
//   npm run import:doc-prices                     # from https://agora.ethoslabs.us
//   npm run import:doc-prices -- http://localhost:3000
//   npm run import:doc-prices -- --db             # straight from DATABASE_URL (a local copy of the store)

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";

type Row = {
  url: string;
  contract_id: string;
  program: string;
  label: string;
  n: number;
  item: string;
  sku: string | null;
  unit: string | null;
  price: number;
  basis: string;
  note: string | null;
  line: string;
  read_on: string;
};

async function main() {
  const arg = process.argv[2] ?? "https://agora.ethoslabs.us";
  const rows: Row[] = [];
  if (arg === "--db") {
    const { exportPrices } = await import("../lib/price-sheets");
    for (let offset = 0; ; ) {
      const page = await exportPrices(offset);
      rows.push(...(page.rows as Row[]));
      offset += page.rows.length;
      if (!page.rows.length || offset >= page.total) break;
    }
  } else {
    for (let offset = 0; ; ) {
      const res = await fetch(
        `${arg.replace(/\/$/, "")}/api/docs/prices?offset=${offset}`,
      );
      if (!res.ok) throw new Error(`${res.status} from ${arg}`);
      const page = (await res.json()) as { total: number; rows: Row[] };
      rows.push(...page.rows);
      offset += page.rows.length;
      process.stdout.write(`\r${offset} of ${page.total}`);
      if (!page.rows.length || offset >= page.total) break;
    }
    process.stdout.write("\n");
  }
  // Only what the catalog needs: no model name, nothing beyond the row and where it came from.
  const keep = rows.map(
    ({
      url,
      contract_id,
      program,
      label,
      n,
      item,
      sku,
      unit,
      price,
      basis,
      note,
      line,
      read_on,
    }) => ({
      url,
      contract_id,
      program,
      label,
      n,
      item,
      sku,
      unit,
      price,
      basis,
      note,
      line,
      read_on,
    }),
  );
  const dir = join(process.cwd(), "seed/catalog/source/doc-prices");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "rows.json.gz"),
    gzipSync(
      JSON.stringify({
        retrieved: new Date().toISOString().slice(0, 10),
        rows: keep,
      }),
    ),
  );
  const by = keep.reduce<Record<string, number>>(
    (m, r) => ((m[r.program] = (m[r.program] ?? 0) + 1), m),
    {},
  );
  console.log(
    `${keep.length} rows from ${new Set(keep.map((r) => r.url)).size} price sheets`,
    by,
  );
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
