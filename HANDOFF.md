# Handoff

Where Agora stands as of November 14, 2026, what's waiting, and what was decided along the way. `CLAUDE.md` covers how to work in the repo, and the README is the full reference.

## What's live

Everything below is merged to `main` and deployed on Railway. Each batch passed typecheck, build and the 13-step rehearsal.

**The co-op directory.** It holds 121,810 governments, one record each. 60,227 are on at least one co-op roster, and 45,574 are tied to a permanent federal ID (Census, NCES district or IPEDS college). The rosters come from Sourcewell, HGACBuy, E&I, COSTARS, BuyBoard (Texas and National), Mohave, Choice Partners and 1GPA (an August 2023 snapshot). County offices point to their county.

**The co-op catalog.** 13 co-ops' public contract directories: 31,930 supplier contracts, 22,778 companies, 46,568 products. GSA contracts are described by their schedule categories (SINs), with a flag for whether cities may use them.

**AI data cleanup** (PR #12). 17,767 reviewed decisions, all in `seed/cleanup/decisions/`:

- 6,059 governments matched to their federal record;
- 2,839 school districts paired with their NCES record;
- 7 supplier merges;
- 30,860 contracts categorized;
- 223 product names cleaned;
- 109 Canon price rows.

**Item prices from price files.** 12,181 priced offerings:

| Source | What it is | Offerings |
|---|---|---:|
| BuyBoard 724-23 | Vehicle award report: awarded base-model prices | 376 |
| NASPO ValuePoint 204521 | Endera transit bus base prices | 6 |
| NASPO ValuePoint MA3964 | SitOnIt furniture list prices, shown as "before the contract discount" | 349 |
| OMNIA Partners R220201 | Burke 2027 playground parts and structures at the contract's net price (list less 7%) | 11,456 |

**State rules** (PR #15). The 50-state cooperative purchasing research. A **State law** note sits beside co-op contracts for the buyer's state, and turns red when a request looks like construction. All 50 states, with their sources, are at `/data#states`.

**NJSTART, preferred for New Jersey.** All 1,437 active NJSTART contracts (November 14, 2026) are in the catalog as a state program, 966 of them open to New Jersey local governments, with 5,810 awarded line-item prices on 836 contracts. They're the TRX route: for a New Jersey buyer they lead results in their own block, above every co-op, when they fit within 15 points of the best co-op contract, and their prices lead each product's routes. Fuel bid as a markup over OPIS, discount lines and placeholders stay out. README **NJSTART** and `/data#njstart` have the detail.

**Hawaii.** The second TRX state: 259 supplier contracts from the State Procurement Office's 77 price & vendor lists (November 14, 2026), 225 of them naming at least one county, with 1,911 verified prices (paper, office supplies, fuel by delivery site, car rental, guard rates, phone rates and more). Review agents read the PDF lists, and a check kept only what appears in each list's text. Access follows each list's participating jurisdictions. README **Hawaii** and `/data#hawaii`.

**Arkansas.** The third TRX state: 218 supplier contracts from the Office of State Procurement's 97 listings (November 14, 2026), split by review agents and checked against each listing's text, with 85 base vehicle and school bus prices from the state's price sheets. Open to Arkansas political subdivisions unless the listing says otherwise (one does: DocuSign). Individuals who hold a contract (two process servers) get storefronts like any contract holder. README **Arkansas** and `/data#arkansas`.

**New York.** The fourth TRX state: all 1,411 supplier contracts on OGS's monthly master list (report of November 3, 2026), 83 awards, read by rule. 1,378 are on awards whose "Use of Contracts" includes political subdivisions or non-state agencies; 33 are state-only. 5,735 prices on 132 contracts from the awards' price files (3,036 read by rule, 2,699 by review agents and checked). New York's preferred sources (Corcraft, NYSID, NIBNY: 531 offerings) are loaded with their approval categories, and approved items lead New York results ahead of OGS contracts. Corcraft's price guide adds 1,146 dock-delivered prices, 994 on the approved categories they belong to. README **New York** and `/data#new-york`.

**Empire Procure Connect.** A TRX program run by New York counties (Chemung, Rockland, Ulster): all 197 active portal records, 109 open to other governments and 88 shown only to the county that let them. They join New York's TRX lane. NIGP codes as published; no prices (placeholders on the portal). README **Empire Procure Connect** and `/data#empire-procure-connect`.

**Every TRX contract's documents are readable.** Held text for Hawaii, Arkansas, New York (awards, master list, preferred sources, Corcraft) and each NJSTART and EPC summary page (`seed/catalog/doctext/`, contacts kept at the owner's instruction), and live fetching from the state hosts for NJSTART's and EPC's attachments, after checking each host's robots rules. README **Reading the state programs' documents**. Cloud sessions need the "Agora" environment, which allows those hosts, to test live fetching.

**NIGP commodity codes.** 28,980 of 33,367 contracts carry NIGP codes: NJSTART's 1,282 as the state printed them (and 4,572 of its prices), the co-ops' and GSA's 27,698 as classes chosen by the AI review from the 150 classes NJSTART's records name. The explorer searches by code. Agora has no licensed NIGP codebook, so it can name only the 520 codes seen in those records; contracts outside them stay uncoded. A licensed codebook (NIGP is licensed through Periscope) would close that gap and allow 5-digit codes for co-op contracts; it is also what the spend check would match purchase orders against.

**Contracts as records.** `/contracts` searches all 31,942 contracts (the co-op catalog's plus Agora's own), and every contract has a page at `/contracts/<id>` with access for the buyer's agency, how to buy under it, what it covers, the pricing on file, its documents, a six-field brief and questions answered from the documents. Result cards, storefronts and the own-contract card link to it. The brief's AI path was not exercised in the build session, which had no API key; the passage fallback was.

**Measuring the AI.** Every model call is logged with what became of it (kept, kept in part, discarded, failed), each AI answer has a thumbs up or down, `/quality` reports both by job and by prompt version, and `npm run eval` runs a fixed test set of 54 cases against a saved baseline. The README's **Knowing whether the AI is right** section is the reference. The log, the thumbs and the page were checked end to end against a stand-in model server; the 29 guard cases pass.

**The personal shopper** (PRs #20 to #21). Every results page opens with a two-step panel: confirm the items, then a buying plan with routes, sources, a purchase file and paperwork drafts. **Shopper** in the header opens three tools: find a product, check a quote, ask a contract. All of it is rule-based and works with no API key; with one, Claude words the plans, reads typed messages and quote lines, and answers from contract passages, and anything it writes with a figure, part number or quote that isn't in the source is discarded.

**Accounts, saved data and email** (PRs #22, #23 and #26). Each visitor's agency lives in their own browser. People can create an account with an email and password. Search and the shopper's tools are open to everyone; anything that keeps a record needs an account. State is saved to a Postgres database on Railway, so a redeploy no longer loses it. Agora sends confirmation links, password-reset links and approval notices through Resend from `agora.ethoslabs.us`. Real delivery was not tested in the build session, which had no Resend key.

## Waiting on the user

**The live half of the test set has never run.** The build session had no API key, so `evals/baseline.json` covers only the 29 guard cases. Run `npm run eval -- --save` once with `ANTHROPIC_API_KEY` set, read any failures (a failing live case may be a wrong expectation rather than a wrong answer), and commit the baseline. Until then the prompts themselves are unmeasured. Cloud sessions tried three times and couldn't, because Claude Code's cloud runtime reserves `ANTHROPIC_API_KEY` for its own connection and drops it from the shell however the environment sets it. The app now also reads `AGORA_ANTHROPIC_API_KEY` (`lib/api-key.ts`); set the key under that name on the cloud environment and the eval will see it. That session did make the eval refuse to save a baseline when the key is rejected, and keep API failures out of the score.

Otherwise nothing. Burke's price list and 1GPA's roster arrived as manual downloads and are loaded. They're saved in the repo (`seed/catalog/source/price-files/` and `seed/coops/source/rosters/`), so rebuilds don't need them again.

## Decisions made

- **Discounts are tabled.** (See item 2 under The next big things for a proposal.) Most co-ops publish discounts off list, not item prices. Until there's a decision on how to show them, no discount data goes in. Two sources are ready for that decision:
  - Sourcewell: 881 price-file links across 867 contracts, saved in `seed/catalog/source/sourcewell-price-links.json`.
  - BuyBoard: discount award reports by brand, about 10,000 awarded rows, the best discount data found. The reports: [760-25 technology](https://assets-us-01.kc-usercontent.com/37044744-256f-009a-8039-e00bdaabaf39/46bfb6a1-97b9-4ee7-bf3e-c86f57dbaf8a/760-25.pdf), [767-25 furniture](https://assets-us-01.kc-usercontent.com/37044744-256f-009a-8039-e00bdaabaf39/33bd2f18-21c3-4c65-93a4-2c3850eb374b/767-25.pdf), [747-24 janitorial](https://assets-us-01.kc-usercontent.com/37044744-256f-009a-8039-e00bdaabaf39/05613264-1eea-4b58-aaf2-e88c01a3e8b5/747-24-Award-Tabulation-Report.pdf) and [781-25 playground](https://assets-us-01.kc-usercontent.com/37044744-256f-009a-8039-e00bdaabaf39/6b0462a9-cc45-4c59-a78d-81057662e4ff/781-25.pdf).
- **Professional services stay thin** by design. GSA's labor-rate documents and services benchmarks were deliberately not pursued.
- **The price-list queue isn't a price source.** GSA's linked "price lists" are mostly contract terms and labor rates, and HGACBuy's bundles are executed contracts. Reading them in bulk wouldn't yield item prices.
- **State rules don't change routing.** They're shown as reference, and the agency's own quick-buy limit still decides.

## The next big things

Four things, in the order worth building them. The first is what stands between the prototype and a real pilot. The second sets the ceiling on everything the shopper does. The other two build on them. A fifth, measuring the AI, was on this list and is now built (see What's live); its live test set still needs one run with a key.

### 1. Agency workspaces: verified staff and roles

Today an account is a person who typed an agency's name. Nothing checks that they work there, any signed-in person can open the purchasing and supplier pages, and two people at one agency share a cart. A pilot needs the agency to be a real workspace.

- **Verified membership.** Tie an account to its agency by email domain. The co-op directory already holds a website domain for most governments, so `dana@crestedbutte-co.gov` can be matched to the Town of Crested Butte without anyone filling in a form. A purchasing admin approves the rest. Email confirmation, which this depends on, is in place.
- **Roles that restrict.** Requesters search and fill carts; purchasing approves, confirms co-op memberships and uploads the contract register; suppliers see only their own storefront. The "View the demo as" switcher becomes a demo-only mode. Approval notices already go to "purchasing staff", which today means anyone who chose that role at an agency of the same name.
- **Records per person.** Carts, orders and purchase files belong to the person who made them, visible to their agency's purchasing staff. The supplier a visitor acts as and the local-preference answer move off the shared server state for the same reason.
- **A real schema.** The saved difference from the seed (`lib/persist.ts`) is a stopgap. Per-person records and more than one server instance need real tables, with demo data kept apart from pilot data. **Reset demo** should go or become admin-only at the same time.

Needs from the user: whether pilots run on the same site as the public demo or on their own.

### 2. Price depth: decide discounts, then load the next price files

The shopper, the dive and the quote check are only as good as the prices Agora holds. Today that is 12,181 priced offerings, 94% of them playground parts. A search for laptops finds one priced item; "pickup truck" finds 278 products and no price. This is the ceiling on the whole product, and no amount of AI raises it.

- **Make the discount decision.** It has been tabled (see Decisions made). Most co-ops publish a discount off list, not a price. The proposal: show "list price less the contract discount" as a computed contract price, labelled as computed, with both inputs and their sources shown, and never where either input is missing. The quote check already treats a list price as a ceiling, so it is ready for this.
- **Load what is already found.** Sourcewell's 881 price-file links and BuyBoard's discount award reports (about 10,000 rows across technology, furniture, janitorial and playground) are waiting on that decision.
- **Scale the reader.** Loading price files is still one importer per file. Turn the contract reader plus the review loop into a pipeline: a queue of files, Claude proposes the column mapping, every price is checked against its line as now, a person audits a sample. The target is the ten categories governments buy most, not completeness.

Needs from the user: the discount decision.

### 3. Proactive buying: spend check and renewal radar

Everything so far waits for a buyer to search. The stronger pitch to a purchasing director is Agora telling them something they didn't know. It is also the natural reason to pay for a city marketplace.

- **Spend check.** The agency uploads last year's purchase orders or P-card export. Agora matches each line to contracts the agency can already use and reports what was bought off contract, what a contract price would have been where one is loaded, and which co-op memberships the agency isn't using. The register reader and the quote checker already do most of the matching.
- **Renewal radar.** Each contract in the agency's register, as it nears its end date, is matched to co-op contracts that cover the same thing, with the purchase file and justification memo drafted. The renewal trigger exists for one demo contract; this makes it work for every register row. Email is in place to deliver it.
- **Saved searches.** "Tell me when a contract for this appears", which also turns unmet demand into a list suppliers can act on.

Gets much better with the prices from item 2.

### 4. Real product attributes for the dive

The product dive narrows by words in product names, so its questions are sometimes odd ("Gvwr", "Drw") and it can't ask what a buyer would ("crew cab or regular?", "ages 2 to 5 or 5 to 12?"). The fix is structured attributes, extracted once at import time through the same review loop that categorized 30,860 contracts.

- **Attributes by category**: cab, drivetrain and payload for trucks; age range, capacity and footprint for playground structures; back height and arms for seating.
- **Better questions and a real comparison table**, with rows per attribute instead of per price field.
- **Bundles**: a playground or a fleet order is many parts. Let the dive assemble a set and price the whole thing, which is where the quick-buy meter and the quote check meet.

Worth doing after item 2, since attributes only matter for products that have a price.

## Smaller things worth doing

0. **NJSTART depth.** 668 contracts have more line-item pages than the first one Agora read, and most prices sit in the 18,635 attached price sheets (linked, not read). Reading the remaining item pages, then the price sheets through the contract reader, is the next price-depth win for New Jersey. Oregon is the one TRX state with no state contracts loaded yet; a state with a contract table would follow `scripts/import-njstart.ts`, one that publishes PDF lists would follow `scripts/import-hawaii.ts`.

1. **BuyBoard's next vehicle award.** 724-23 ends November 30, 2026. Its replacement award report will hold current prices; load it the same way.
2. **Item-price reports elsewhere at BuyBoard.** Its tabulation sheets may include other base-price reports (trucks, buses, equipment). Scanning them needs `www.buyboard.com` allowlisted.
3. **SitOnIt options.** The book also prices each option ("+$35 multi-adjustable arms"). Configuring a chair option by option is a bigger feature than the featured models already loaded.
4. **Stricter state checks.** New York, New Jersey and others require the lead contract to be awarded by a public agency, not a nonprofit administrator. Alabama and Mississippi allow only co-ops or contracts on their approved lists. Both need data that isn't in the repo yet: which co-ops are public bodies, and the two states' lists.
5. **Leftover government matches.** About 5,200 roster governments still lack a federal ID (the reviewer answered "none" or wasn't confident). A second pass that can search the web would settle many of them.
6. **Real supplier checks.** SAM.gov's API (registrations, exclusions) needs a key, which goes through the secure credential form, never chat.

7. **More readable documents.** The contract brief reads about 11,900 contracts' documents, nearly all GSA. Sourcewell's 881 price-file links, NASPO's master agreements and HGACBuy's zip bundles would widen it; HGACBuy needs an unzip step.
8. **Compare two contracts.** The brief's six fields are the same for every contract, so a side-by-side view is a small step.
11. **Use the measurements.** Once the log has a few hundred calls, read `/quality` for the jobs with the lowest kept-whole share and the most thumbs down, and turn the worst examples into test cases before changing a prompt. The recent-calls list is open to any signed-in person; move it behind a role when roles exist. The thumbs cover only what the model wrote, not the rule-based fallbacks.
10. **A rehearsal step for contracts.** The explorer and contract page are checked by hand, not by `npm run rehearse`.

## Watch out for

- New York's piggyback statute sunsets June 30, 2027. Several state thresholds changed in 2025–26, so treat the state rules as a dated snapshot.
- Dealer and supplier names differ between price files and the catalog. The price-file matcher compares distinctive words and treats different car makes as different companies. Review its audit when adding a file.
- The contract reader caches parses by `PARSER_VERSION` (`lib/parser.ts`). Bump it when changing what the reader extracts.
- Allowlisted hosts in the cloud environment cover the sources used so far. TIPS and OMNIA are allowlisted but refuse automated access, so they can be removed.
