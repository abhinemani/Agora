# Products, stashed

Loci serves 8,141 catalog products and keeps 51,195 out. The catalog had 59,336, and most could not show what Loci is for, which is search and fit analysis: 37,411 of its 69,502 offerings had no price, and thousands more were rate lines or component parts that crowded every search.

A product stays live when it has a price a buyer could act on (or a labelled list price), a name that says what it is, and is something bought by the unit. The rule is `scripts/product-stash.ts`; the catalog importer applies it and writes `summary.json` here on every run. The numbers below are from that file as of the last run.

| Stashed | Products |
|---|---|
| PEPPM items: no price (behind the member login), a sample of each contract, many named only by a category or a part number | 21,413 |
| HGACBuy items: no price (a discount with no list price to apply it to, or by quote) | 9,611 |
| Items with no price of any kind | 531 |
| Burke playground components the review did not code (by part-number family: everything but 550 to 599) | 8,841 |
| Items on New York's crash-mitigation award the review did not code | 76 |
| Canon licences, service plans and accessories the review did not code | 1,634 |
| Rate lines, not products: hourly and monthly rates, fares, per-minute calls, rentals, fees and multi-year service prices | 3,292 |
| Parts and accessories, by the AI review: a component or an add-on of something else (a swing hanger, a copier finisher, a vehicle option) | 4,538 |
| Rates and services, by the AI review: hourly and per-unit rates, installation, training, a study | 288 |
| Service lines that are not a fixed package, by the packaged-service review: time-based rates, goods mixed with labor, and one agency's own project line items | 419 |
| Products the AI review thought, without confidence, were a part, an accessory, a rate or a service (doubt keeps a product out; it never lets one in) | 552 |

| Program | Served | Stashed |
|---|---|---|
| NJSTART | 2,251 | 3,020 |
| OMNIA Partners | 1,422 | 10,034 |
| Sourcewell | 1,140 | 2,455 |
| NY Preferred Source | 946 | 728 |
| Hawaii SPO | 857 | 599 |
| NYS OGS | 696 | 3,006 |
| NASPO ValuePoint | 324 | 31 |
| OregonBuys | 282 | 298 |
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
