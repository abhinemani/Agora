# Handoff

Where Agora's data work stands as of November 14, 2026, what's waiting, and what was decided along the way. `CLAUDE.md` covers how to work in the repo, and the README is the full reference.

## What's live

Everything below is merged to `main` and deployed on Railway. Each batch passed typecheck, build and the 13-step rehearsal.

**The co-op directory.** It holds 121,676 governments, one record each. 60,080 are on at least one co-op roster, and 45,564 are tied to a permanent federal ID (Census, NCES district or IPEDS college). The rosters come from Sourcewell, HGACBuy, E&I, COSTARS, BuyBoard (Texas and National), Mohave and Choice Partners, the last added in PR #13. County offices point to their county.

**The co-op catalog.** 13 co-ops' public contract directories: 31,930 supplier contracts, 22,778 companies, 35,112 products. GSA contracts are described by their schedule categories (SINs), with a flag for whether cities may use them.

**AI data cleanup** (PR #12). 17,767 reviewed decisions, all in `seed/cleanup/decisions/`:

- 6,059 governments matched to their federal record;
- 2,839 school districts paired with their NCES record;
- 7 supplier merges;
- 30,860 contracts categorized;
- 223 product names cleaned;
- 109 Canon price rows.

**Item prices from price files** (PRs #14 and #17). 725 priced offerings:

| Source | What it is | Offerings |
|---|---|---:|
| BuyBoard 724-23 | Vehicle award report: awarded base-model prices | 376 |
| NASPO ValuePoint 204521 | Endera transit bus base prices | 6 |
| NASPO ValuePoint MA3964 | SitOnIt furniture list prices, shown as "before the contract discount" | 349 |

**State rules** (PR #15). The 50-state cooperative purchasing research. A **State law** note sits beside co-op contracts for the buyer's state, and turns red when a request looks like construction. All 50 states, with their sources, are at `/data#states`.

## Waiting on the user

**Burke's 2027 playground price list.** It comes from OMNIA contract R220201, but OMNIA's robots.txt bars Claude's crawler, so a person has to download it. [Download link](https://www.omniapartners.com/api/document-download?contract=149002&filename=2027+Burke+Equipment+Price+List_OMNIA+Partners.pdf). According to the research it lists item numbers with both list and net prices. Once the file is in hand:

1. Save it in `seed/catalog/source/price-files/`.
2. Write a reader for it in `scripts/import-price-files.ts`, after looking at its layout.
3. Re-run `import:price-files`, then `import:catalog-coops`.

The prices are labelled 2027, so show that vintage.

**1GPA's membership list.** Dropbox serves the file from a one-time host that can't be allowlisted, so it also needs a manual download. [Download link](https://www.dropbox.com/s/9i5d6xhsmob7hcp/1%20-%20PUBLISHED%20Membership%20List.xlsx?dl=1). The reader is already built:

1. Save the file as `seed/coops/source/rosters/1gpa-members-2023-08-16.xlsx`.
2. Run `npm run fetch:rosters`, which converts it to CSV.
3. Run `npm run import:coops`.

It's flagged as an August 2023 snapshot.

## Decisions made

- **Discounts are tabled.** Most co-ops publish discounts off list, not item prices. Until there's a decision on how to show them, no discount data goes in. Two sources are ready for that decision:
  - Sourcewell: 881 price-file links across 867 contracts, saved in `seed/catalog/source/sourcewell-price-links.json`.
  - BuyBoard: discount award reports by brand, about 10,000 awarded rows, the best discount data found. The reports: [760-25 technology](https://assets-us-01.kc-usercontent.com/37044744-256f-009a-8039-e00bdaabaf39/46bfb6a1-97b9-4ee7-bf3e-c86f57dbaf8a/760-25.pdf), [767-25 furniture](https://assets-us-01.kc-usercontent.com/37044744-256f-009a-8039-e00bdaabaf39/33bd2f18-21c3-4c65-93a4-2c3850eb374b/767-25.pdf), [747-24 janitorial](https://assets-us-01.kc-usercontent.com/37044744-256f-009a-8039-e00bdaabaf39/05613264-1eea-4b58-aaf2-e88c01a3e8b5/747-24-Award-Tabulation-Report.pdf) and [781-25 playground](https://assets-us-01.kc-usercontent.com/37044744-256f-009a-8039-e00bdaabaf39/6b0462a9-cc45-4c59-a78d-81057662e4ff/781-25.pdf).
- **Professional services stay thin** by design. GSA's labor-rate documents and services benchmarks were deliberately not pursued.
- **The price-list queue isn't a price source.** GSA's linked "price lists" are mostly contract terms and labor rates, and HGACBuy's bundles are executed contracts. Reading them in bulk wouldn't yield item prices.
- **State rules don't change routing.** They're shown as reference, and the agency's own quick-buy limit still decides.

## Worth doing next

1. **BuyBoard's next vehicle award.** 724-23 ends November 30, 2026. Its replacement award report will hold current prices; load it the same way.
2. **Item-price reports elsewhere at BuyBoard.** Its tabulation sheets may include other base-price reports (trucks, buses, equipment). Scanning them needs `www.buyboard.com` allowlisted.
3. **SitOnIt options.** The book also prices each option ("+$35 multi-adjustable arms"). Configuring a chair option by option is a bigger feature than the featured models already loaded.
4. **Stricter state checks.** New York, New Jersey and others require the lead contract to be awarded by a public agency, not a nonprofit administrator. Alabama and Mississippi allow only co-ops or contracts on their approved lists. Both need data that isn't in the repo yet: which co-ops are public bodies, and the two states' lists.
5. **Leftover government matches.** About 5,200 roster governments still lack a federal ID (the reviewer answered "none" or wasn't confident). A second pass that can search the web would settle many of them.
6. **Persistence.** The app's state is in memory, so a redeploy resets it. A database is needed before real pilots.
7. **Real supplier checks.** SAM.gov's API (registrations, exclusions) needs a key, which goes through the secure credential form, never chat.

## Watch out for

- New York's piggyback statute sunsets June 30, 2027. Several state thresholds changed in 2025–26, so treat the state rules as a dated snapshot.
- Dealer and supplier names differ between price files and the catalog. The price-file matcher compares distinctive words and treats different car makes as different companies. Review its audit when adding a file.
- The contract reader caches parses by `PARSER_VERSION` (`lib/parser.ts`). Bump it when changing what the reader extracts.
- Allowlisted hosts in the cloud environment cover the sources used so far. TIPS and OMNIA are allowlisted but refuse automated access, so they can be removed.
