# GSA, stashed

GSA's Multiple Award Schedule contracts are kept out of the live catalog. They added 12,473 contracts and no products (GSA Advantage's item pages are off limits to automated readers), which made search noisier for local buyers without giving them anything to buy from.

Nothing was deleted:

- `gsa-sins.json` and `gsa-mas-contracts.csv.gz` (from `npm run fetch:gsa`) are here.
- GSA's rows in the shared catalog source files (`seed/catalog/source/*.jsonl.gz`, cooperative `GSA MAS`) are still there; the catalog importer filters them out.
- The app still knows how to show GSA: its own lane on the results page, the explorer's "Federal (GSA)" filter, SIN-level access on contract pages.

To bring GSA back:

```bash
AGORA_INCLUDE_GSA=1 npm run import:catalog-coops
```

then commit `seed/catalog/catalog.json.gz` and `seed/catalog/insights.json`. The AI review decisions for GSA SINs (`seed/cleanup/decisions/`) are kept and apply again.
