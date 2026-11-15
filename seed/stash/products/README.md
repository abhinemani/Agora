# Products, stashed

Loci serves 7,575 catalog products and keeps 51,787 out. The catalog had 59,362, and most could not show what Loci is for, which is search and fit analysis: 37,411 of its 69,528 offerings had no price, and thousands more were rate lines or component parts that crowded every search.

A product stays live when it has a price a buyer could act on (or a labelled list price), a name that says what it is, and is something bought by the unit. The rule is `scripts/product-stash.ts`; the catalog importer applies it and writes `summary.json` here on every run. The numbers below are from that file as of the last run.

| Stashed | Products |
|---|---|
| PEPPM items: no price (behind the member login), a sample of each contract, many named only by a category or a part number | 21,413 |
| HGACBuy items: no price (a discount with no list price to apply it to, or by quote) | 9,611 |
| Items with no price of any kind | 531 |
| Burke playground components and structure parts (everything but the freestanding items, part numbers 550 to 599) | 10,083 |
| New York's crash-mitigation award: replacement parts for barriers and attenuators | 2,724 |
| Canon software licences, service plans, installation and accessories | 3,022 |
| Rate lines, not products: hourly and monthly rates, fares, per-minute calls, rentals, fees and multi-year service prices | 4,042 |
| Rates and services the AI review found among the rest (installation, training, a study), which the patterns above missed | 361 |

| Program | Served | Stashed |
|---|---|---|
| NJSTART | 2,480 | 2,817 |
| OMNIA Partners | 1,373 | 10,083 |
| NY Preferred Source | 1,143 | 531 |
| Hawaii SPO | 1,008 | 448 |
| Sourcewell | 573 | 3,022 |
| NASPO ValuePoint | 355 | 0 |
| NYS OGS | 228 | 3,474 |
| OregonBuys | 192 | 388 |
| BuyBoard | 138 | 0 |
| Arkansas OSP | 85 | 0 |
| HGACBuy | 0 | 9,611 |
| PEPPM | 0 | 21,413 |

Nothing was deleted:

- The rows are still in the source files (`seed/catalog/source/`, `seed/catalog/price-rows.json`). The importer filters them out.
- Contracts are never stashed. PEPPM's and HGACBuy's contracts still appear in search as routes, and each contract page still links to its price documents.
- A product sold on several contracts stays if any one of its offerings does.

What it costs: **Check a quote** can no longer price a line against a stashed part, such as a Burke post or bolt.

To bring everything back:

```bash
AGORA_INCLUDE_STASHED=1 npm run import:catalog-coops
```

then commit `seed/catalog/catalog.json.gz` and `seed/catalog/insights.json`. To bring one group back, change its rule in `scripts/product-stash.ts` and run the importer.

The rule is a first cut made with patterns: a unit of "hour", a name with "rental", Burke's part-number families. It should be replaced once each product is coded with what kind of thing it is and whether it is a whole item, a part or a rate (see `HANDOFF.md`).
