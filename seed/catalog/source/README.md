# Agora cooperative catalog collection

Collected November 13, 2026. This is an import staging package, not a complete inventory of every product on every cooperative.

## What is included

24,094 conservatively normalized supplier-name records; 31,930 supplier/contract scope records; 34,510 product or line-item identities; 39,394 supplier/contract/product offerings. 3,492 offerings carry parsed public fixed prices. Broad contract titles are not included in the product import.

| Cooperative/program | Supplier records | Contract scopes | Product offerings |
|---|---:|---:|---:|
| 1GPA | 464 | 535 | 0 |
| BuyBoard | 2,019 | 2,451 | 0 |
| Choice Partners | 671 | 836 | 0 |
| E&I | 259 | 263 | 0 |
| Equalis Group | 330 | 376 | 0 |
| GSA MAS | 12,157 | 12,473 | 0 |
| HGACBuy | 1,275 | 1,367 | 9,611 |
| NASPO ValuePoint | 440 | 519 | 0 |
| NPPGov | 254 | 254 | 0 |
| OMNIA Partners | 657 | 695 | 0 |
| PEPPM | 216 | 628 | 26,291 |
| Sourcewell | 964 | 1,099 | 3,492 |
| TIPS | 6,332 | 10,434 | 0 |

Supplier counts overlap across programs. Names are source display names, not verified legal entity IDs. NPPGov cards can include marketing/product wording. BuyBoard exports include designated dealers. GSA is limited to MAS rows carrying the published cooperative-purchasing participation flag; this flag alone does not establish SIN or buyer eligibility.

## Files and joins

- `manifest.json`: counts, joins, source date and program-by-program totals.
- `suppliers.jsonl`: one supplier-name identity, source aliases, websites and observed cooperative relationships.
- `contracts.jsonl`: a supplier-specific contract, source scope, published dates, regions, categories and source metadata. Multiple suppliers can share a contract number. Contract scopes are discovery records, not products.
- `products.jsonl`: named SKUs, models, bundles, services or options. Manufacturer/MPN groups retain conflicting titles for review.
- `offerings.jsonl`: supplier + product + contract, with the exact observed price/discount context and provenance.
- `marketplace_import.jsonl`: flat adapter using the earlier Agora seed's `vendor`, `product`, `contract_vehicle`, `contract_number`, `pricing_model`, `discount_percent`, `fixed_price`, `source_url` and `price_status` fields, plus stable IDs. This is an adapter dataset, not a tested deployment into an existing Agora app.
- `documents.jsonl`: public catalog or contract-document URLs discovered. Most document bundles are indexed, not downloaded or parsed. OMNIA public document metadata remains within the contract record; no public URLs are invented from blob paths.
- `coverage.json`: exact collection scope and completeness claims for each source.
- `peppm_product_backlog.json`: reported product counts, retrieved rows and next-page URLs per PEPPM contract.
- `supplier_match_review.json`: similar legal-name candidates that were not automatically merged.
- `validation.json`: mismatched TIPS source counts, unparsed Canon price rows and SKU title conflicts.
- `load_sqlite.py`: optional standard-library loader and example queries.

Join suppliers, contracts, products and offerings using their named ID fields. JSONL contains one JSON object per line. No pandas or spreadsheet library is needed to read it.

## How to add this to Agora

1. Load suppliers and contracts, then products and offerings. Treat product/contract/supplier IDs as upsert keys. Use `marketplace_import.jsonl` if the app expects the earlier flat seed structure.
2. Show contract scopes in supplier/contract discovery; show product rows in product search. Keep supplier and contract choices under the product when reliable manufacturer + MPN agrees.
3. Use request-quote behavior. `ready_for_checkout` is false. A discount is not a fixed price. Blank prices are unknown, not zero. Published prices can exclude configuration, freight, installation or other charges.
4. Before publication, review expired/not-yet-effective dates, SKU title conflicts, source display names and legal eligibility. Do not infer an agency can buy every listed contract. Do not display sources as official partners without agreement.

## How this was collected

Public spreadsheet exports, publicly rendered tables, and read-only search/report endpoints used by the public websites. The pass covered Sourcewell, OMNIA Partners, TIPS, BuyBoard, HGACBuy, NASPO ValuePoint, Equalis, 1GPA, Choice Partners, E&I, PEPPM, NPPGov and cooperative-flagged GSA MAS listings. Each record retains its source. No outreach, member registration, restricted account access or member-only pricing was used. Frontend placeholder vendors were excluded.

## What remains incomplete

Product-level extraction is concentrated in HGACBuy's public product tables, PEPPM contract product pages and Canon's 171-page Sourcewell pricing PDF. This does not mean the other programs lack products. Their catalogs frequently sit in separate vendor documents or authenticated marketplaces.

PEPPM's unfiltered page reported 3,907,199 items. This pass retrieved page one for each of its 628 listed contract/product-line entries. 160 contract result sets fit on that page and were fully captured; the remainder are explicitly incomplete. Prices on those pages require member login and remain blank.

Canon prices are from the April 2026 document, retrieved November 13, 2026, not a guarantee of today's quote. Rows that failed the strict SKU/MSRP/discount/price parser are listed for review. Repeated SKUs are linked to separate observed price contexts when needed.

TIPS public category counts disagree with the awarded-vendor reports for 12 categories. Both published primary directory associations and award-report associations were retained, and count discrepancies remain visible. No claim is made that these inconsistent source counts reconcile.

GSA Advantage product inventories, OMNIA OPUS product enrichment, member-only catalogs and all supplier document price lists were not exhaustively collected. The public supplier/contract collection is much broader than the product collection. See `coverage.json` for source-specific controls.

## Validation

All IDs are unique within each table; offering references resolve to suppliers, products and contracts; numeric prices are finite/nonnegative; percentage discounts are bounded; supplier offers keep their source cooperative; member-only PEPPM prices were not extracted. Out-of-range source discounts are retained in raw metadata but withheld from the normalized percentage field. Supplier and SKU ambiguity is retained, not hidden. Counts describe source snapshots rather than unique legal companies or all purchasable products.
