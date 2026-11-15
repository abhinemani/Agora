// Whether a price sheet was read with the wrong column. Shared by the catalog importer (scripts/import-catalog.ts) and
// the server's price-sheet reader (lib/price-sheets.ts), so a misread sheet is caught where it is read and again where
// it is imported. Pure: no server modules.

const words = (t: string) => t.toLowerCase().match(/[a-z][a-z0-9]{2,}/g) ?? [];

/** Two item names that share most of their words: the same item, not a neighbouring size or zone. */
export function sameItem(a: string, b: string): boolean {
  const mine = new Set(words(a));
  const theirs = new Set(words(b));
  const both = [...mine].filter((w) => theirs.has(w)).length;
  return both / (new Set([...mine, ...theirs]).size || 1) >= 0.6;
}

/** The first row a sheet prices more than ten times above or below the same item's awarded price on the same
 * contract, or null. One such row means the sheet read the wrong column (a quantity or a square footage as the price):
 * NJSTART's "T2580 Price Schedule.xlsx" was read at $31,000 a square foot to shampoo carpet, against the award's $0.25.
 * List prices are skipped: they sit above what the contract pays by design. */
export function offColumn(
  rows: { item: string; price: number; basis?: string | null }[],
  awarded: { name: string; price: number }[],
): { item: string; price: number; awarded: number } | null {
  for (const r of rows) {
    if (r.basis === "list_price" || !(r.price > 0)) continue;
    for (const x of awarded)
      if (x.price > 0 && (r.price / x.price > 10 || x.price / r.price > 10) && sameItem(r.item, x.name)) return { item: r.item, price: r.price, awarded: x.price };
  }
  return null;
}
