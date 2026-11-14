# Agora (Marketplace 2.0 prototype)

A clickable prototype of a centralized procurement marketplace: any city, county or school district searches state and cooperative contracts in one place, sees which ones it may use, and buys. Searching it is free. Two products are sold on top of it: a **city marketplace** for an agency (a white-labeled Agora with its own contracts and rules) and a **storefront** for a supplier (its own page listing its catalog). The supplier side and Sovra's revenue mechanics are visible on screen too. It's built for leadership demos, not production: seeded data, no real integrations, and one live city marketplace (the fictional City of Riverbend).

## The marketplace, city marketplaces and storefronts

Three names, kept distinct everywhere in the app:

| Name | What it is | Who pays | Where |
| --- | --- | --- | --- |
| **Agora** | The shared marketplace anyone can search | Free to search | `/` |
| **City marketplace** | A white-labeled Agora for one city, county or district: its contracts, rules, approvals and brand, for its own staff | The agency, by subscription (option 1) | `/marketplaces`, `/marketplaces/riverbend` |
| **Storefront** | A supplier's own page: its catalog, the contracts it sells through, certifications and reviews | The supplier: a basic page is free, the featured storefront comes with Edge Position (option 6) | `/storefronts`, `/storefronts/[supplier]` |

A supplier can also pay to list its piggybackable contracts in more cities' marketplaces (option 4, Supplier → City marketplaces). Supplier names on result cards and product pages link to their storefronts.

The home page (`/`) is the marketplace. It asks one question, "What are you looking to buy?", and searches every contract in Agora without needing an agency. Setting an agency (account menu → **Your agency**, or **Set your agency** on any results page) hides the contracts that agency can't use; leaving it blank shows who each contract is open to.

**For cities** (`/marketplaces`) lists the city marketplaces. Riverbend's (`/marketplaces/riverbend`) is live: searching there searches as Riverbend, with its own contracts, local-vendor preference, $10K quick-buy limit, renewals coming due and reorders. The others on the list are shown as available to sell. **Storefronts** (`/storefronts`) lists every supplier; each storefront has the supplier's contracts, a searchable catalog and agency reviews.

## Running it

```bash
npm install
npm run dev        # http://localhost:3000
```

Everything works offline. To have Claude (`claude-sonnet-5-5`) parse requests and structure uploaded contracts, copy `.env.example` to `.env` and set `ANTHROPIC_API_KEY`. Without a key, a keyword matcher and a regex-and-table contract parser take over, and the header shows an "Offline parsing" tag. Any API failure falls back the same way.

State lives in memory on the server. **Reset demo** (in the revenue ledger) reseeds everything with stable IDs, so the demo script below is repeatable.

## How it earns

The **How it earns** page (in the header for every role) turns the Marketplace 2.0 deck into live diagrams: the three kinds of purchase, the buyer value chain, the supplier loop, the flywheel, the five-way revenue equation and the ten-option table. Revenue badges fill in as options fire during the demo, and every option links to the place in the app that triggers it. The numbered maroon badges also appear on result cards, checkout and the supplier journey; switch them off with **Show how Sovra earns** under the header for a buyer-only view.

Proactive buying is live too: the expiring custodial contract on Riverbend's city marketplace starts an early renewal solicitation drafted from the past custodial bid.

## Buyers, eligibility and ways to buy

No agency is set by default, so search covers every contract. An agency (name, state, type and optional population) can be set or cleared at any time, because contracts are open to different buyers. Every contract carries eligibility rules, a pricing basis and a verification level, and results show only the routes that buyer can use. Matches on closed contracts are summarized instead of hidden, and each product page lists every way to buy it side by side.

| Vehicle | Number | Open to | Pricing | Verification |
| --- | --- | --- | --- | --- |
| NASPO ValuePoint, Tyler Technologies | AR3764 (lead state Utah, Citizen Engagement Platforms) | Public entities in the 15 states with a participating addendum | Published prices: 203 of the 100 featured products' 204 price rows, from the September 2026 catalog | Source document |
| NJSTART, Tyler Technologies | 26-TELE-114629, New Jersey's participating addendum M4027 to AR3764 | New Jersey public entities | Same prices as AR3764 (one row exists only here) | Source document |
| NASPO ValuePoint, eight more Citizen Engagement Platforms suppliers and Maximus | AR3751–AR3762 | Public entities in each award's participating states | Quote only; price files not loaded | Source document (terms); two awards expired September 14, 2026 |
| NJSTART, Maximus US Services | 26-TELE-115813, adopted from NASPO ValuePoint AR3758 | New Jersey public entities | 14 published rates | Source document, checked line by line against the scanned Attachment C |
| Sourcewell, Tyler Technologies | 060624-TTI | Members nationwide | Discount off list; quote required | Research lead |
| Carahsoft (Iowa / NASPO AR2472, CoreTrust) | 2024-BUS-0226, 24COR-018GR | Adopting states, CoreTrust members | Quote only; no price files loaded | Research lead |
| Riverbend, ORCPP, WSPC, GSA, reseller | various | as stated | Published prices | Demo data |

When a product sits on a contract the buyer can't use but the same supplier has an open co-op award, it is offered by quote through that award, with the closed contract's price shown only as a reference. Sourcewell discount percentages from the research seed appear only as labeled, unverified notes, never as prices. The four buyer presets are the City of Riverbend (Oregon), Harmon Lake Township (a fictional New Jersey municipality), the City of Cedar Bend (a fictional Iowa city, which reaches Tyler through NASPO) and a New Jersey state department. Contracts past their end date are shown as expired and can't be bought from.

## Co-op contracts link out

Agora doesn't sell through a co-op's contracts. A result on a co-op contract shows **Buy on NASPO ↗** (or Sourcewell, and so on), which opens that contract's own page through a tracked redirect, `/go/[contract]`. Each click is logged with the agency, contract, co-op and request, so Sovra can show every co-op the traffic it sends. This follows the partnerships plan: send traffic first, show co-ops the lift, and only then talk about a share. It also keeps Agora from sitting between a co-op and its members as a reseller would.

A co-op that has agreed can let its members buy inside Agora. Each co-op (`lib/coops.ts`) carries a `buy_in_agora` setting, off by default. In the seed, NASPO ValuePoint and Sourcewell are off because they're real co-ops with no agreement. The fictional WSPC is on, so demo step 1's National Furniture listing can still be bought in Agora. Checkout and quote requests refuse a link-out contract on the server as well as in the UI. Open **Sovra revenue (demo) → Co-op traffic** to see clicks per co-op, whether each co-op shares its member list, any contracts missing a contract-level link, and the switch for each co-op.

## Co-op memberships and fit scores

Results now have a **Co-op contracts for this** section, split into the co-ops an agency is on and the ones it could join. That split is the core of the partnerships spec: "when I'm looking for a laptop in Crested Butte, I need to see the co-ops I'm a member of and the ones I'm not."

Agora learns an agency's memberships without staff having to know them. Each agency has a website domain, and setting the agency runs a reverse lookup against the member lists Agora holds (`Coop.members` in `lib/coops.ts`). Matches come in as **detected** memberships, which count right away. Purchasing can confirm them, remove them or add a co-op by hand from the strip at the top of the section. NASPO ValuePoint works differently: agencies use it through their state's participating addendum, so a NASPO contract that lists the buyer's state counts as one the agency is on.

Every product card and co-op contract carries a **fit score** from 0 to 100: how much of the request it covers. Words in its name count fully, words only in its wider scope count 70%, and rarer words weigh more (`fitScore` in `lib/assistant.ts`). Sponsorship never changes a fit score. When a co-op the agency isn't on fits at least 10 points better than anything on its own co-ops, an amber flag says so. The comparison is by scope only, since price files aren't loaded for these contracts. A non-member contract offers **Ask purchasing to get us on this**, which logs a referral for that co-op and shows up on the Procurement home page as a join request.

Each co-op contract shown in results is logged as an impression, once per search. The ledger's **Co-op traffic** tab shows impressions, clicks and join requests per co-op, plus how many agencies matched its member list.

The laptop contracts behind the demo are real master agreements, carried as research leads because their current terms aren't confirmed. NASPO ValuePoint's Computer Equipment portfolio (lead state Minnesota) includes Dell 23004, HP 23011, Lenovo 23013 and Apple 23003. They were first taken from Dell's posted agreement and a Hawaii SPO vendor list; the co-op catalog (below) corrected Dell's number (Dell's own document says 23026) and added each award's dates and participating states. Sourcewell's technology portfolio includes 121923-CDW, whose August 2026 rate card lists 5% off notebooks, and 121923-IDL. Memberships for real agencies now come from the co-op directory (below). WSPC, and the Sourcewell memberships of the fictional Riverbend and Cedar Bend, are **demo lists for illustration**.

## Agency setup, plans and the free tier

**Procurement → Setup** (`/procurement/setup`) is where a purchasing admin configures an agency once, so staff never have to. It shows a three-step checklist (state, the agency's own contracts, co-op memberships), the membership strip, the contract register and the plan.

**Contract register.** The admin uploads a CSV or XLSX with one contract per row. `lib/register.ts` finds the header row by common column names ("Contract Name", "Vendor", "Contract #", "End Date", "Not to Exceed" and so on) and validates every row. A row with no title, no vendor, an unreadable date or a ceiling that isn't a single amount is not imported, and the report names the row and the reason. An expired row is imported but hidden from search. Re-uploading updates rows by contract number instead of duplicating them. Register contracts belong to that agency alone: `/api/state` strips other agencies' rows before anything reaches the browser, and search never shows them to anyone else. When a request matches one, results open with **"Your agency already has a contract for this."** **Try the sample register** loads `public/test-contracts/harmon-lake-contract-register.csv`: eight rows, with three broken on purpose and one expired.

**Free tier.** Search is always free. The free plan includes 5 published RFPs a year (`FREE_RFP_LIMIT` in `lib/agency.ts`), and the counter resets each year. At the limit, RFP Lite asks the agency to upgrade, while search and handoffs keep working. Harmon Lake Township is seeded with 4 of 5 used, and Riverbend, a city marketplace customer, is on the paid plan. The free plan shows sponsored placements, marked as sponsored. A paid agency can turn them off for its staff, which drops both the label and the ranking nudge.

**When nothing fits,** results offer three next steps: **RFP Lite** (free, counted against the plan), **Sovra's full RFP tool** (paid) and a handoff to the agency's own tool (Euna, OpenGov or Bonfire). Handoffs are recorded but don't call any outside system.

**Setup questions route to purchasing.** If a requester searches before setup is done, a one-line banner says what's missing and what that means for the results, and offers **Invite purchasing**. The invite shows up on the setup page. No email is sent in the demo.

Results also hide expired contracts by default, behind a one-line "N expired contracts also matched" with a **Show** link. State contracts in TRX states (New Jersey, Oregon, Arkansas, Hawaii and New York; `TRX_STATES` in `lib/trx.ts`) carry a **TRX** label everywhere they appear, and the ledger books a TRX fee only on those. Other state contracts show an ordinary transaction fee.

## The co-op directory and the Co-op data page

Agora's co-op memberships for real agencies come from a public cooperative purchasing workbook, collected November 13, 2026 (`seed/coops/source/coop-memberships-2026-11-13.xlsx`). It has 90,469 published roster listings from Sourcewell, HGACBuy, BuyBoard (Texas and National), Mohave, E&I and COSTARS, plus Texas DIR sales by buyer, NASPO and OMNIA contract-access listings, agencies' own published co-op relationships and documented purchases. CISA's .gov registry (`seed/coops/source/dotgov-domains-2026-11-13.csv`, federal domains and contact emails removed) adds domains.

`npm run import:coops` (`scripts/import-coop-data.ts`) builds three files from them:

- `seed/coops/directory.json.gz`: about 121,000 governments, one record each, with their federal IDs, co-ops, the evidence for each, websites, population or enrollment and DIR spend. Churches, private schools and nonprofits are set aside. A government whose source doesn't classify it is kept only when its name reads as government, and it's marked "inferred".
- `seed/coops/insights.json`: the numbers behind the **Co-op data** page.
- `seed/catalogs/naspo-contract-access.json`: NASPO ValuePoint's Parks and Recreation awards with their participating states, and local governments that signed their own addendum.

**Permanent IDs.** `npm run fetch:federal` (`scripts/fetch-federal-ids.ts`, needs www2.census.gov and nces.ed.gov) downloads the Census Bureau's Government Units List 2026, the NCES Common Core of Data district directory for 2024-25 and IPEDS 2024 into `seed/coops/source/` as gzipped CSVs. It keeps IDs, names, places, websites and sizes, and leaves out officials' names, phone numbers and street addresses. The importer matches every directory entry to one federal record (Census `CENSUS_ID_PID6`, NCES `LEAID`, IPEDS `UNITID`) and merges entries that share an ID. Census school districts are paired with their NCES records by website or expanded name, and same-named townships are told apart by county. A name that says Town never matches a record that says Village when both exist. Every government in the registries joins the directory, roster or not, which brings it to about 121,000 governments, 100,000 of them with an ID and 47,000 with a website. IPEDS also sets aside the private colleges on the E&I and BuyBoard rosters. `/api/directory?id=census:210967` (or `nces:` / `ipeds:`) finds a record by federal ID.

Listings without an ID are joined by `entityKey` in `lib/coops.ts`, the same function the live matcher uses. It lines up "Plano ISD" with "Plano Independent School District" and "Lawrence, City of" with "City of Lawrence", but keeps City of Plano and Plano ISD apart. The directory is server-only (`lib/directory.ts`), so it never reaches the browser; `/api/directory?q=` serves the agency typeahead and `?id=` serves one record.

**What it changes in the app.** "Your agency" now offers a search over every government in the directory. Picking one, or setting an agency the directory recognizes by website or by name and state, brings in its co-ops as detected memberships. Each carries its **evidence**: on a published roster, named on the agency's own procurement pages, or bought through it (an approved award or DIR sales). The membership strip in results shows the evidence and the member ID where one was published. Agora now tracks 19 real co-ops, up from two. An uploaded member list can't remove a membership that rests on stronger evidence. Ten NASPO Parks and Recreation awards are in search as quote-only research leads, and `Eligibility.adopters` lets a local government with its own addendum (San Joaquin County, City of Albany) use a portfolio its state hasn't signed.

**Co-op data** (`/data`, in the account menu) explains all of this for leadership. It covers what's in the workbook, the five ways Agora uses it, a live agency lookup, the evidence ladder, documented purchases, a prospect list (the largest DIR buyers already on several co-ops), cautions (including six NASPO awards whose addendum states disagree with Agora's seed) and the data still needed, led by a government ID spine.

## The co-op catalog

The membership directory says which co-ops each agency is on; the co-op catalog says what those co-ops have under contract. It's a capture of 13 co-ops' public contract directories, supplier lists, product tables and price files, retrieved November 13, 2026 (`seed/catalog/source/`, with its own README, coverage and validation notes): 31,930 supplier contracts, 34,619 products in 39,503 offerings and 12,602 price-document links, from Sourcewell, OMNIA Partners, TIPS, BuyBoard, HGACBuy, NASPO ValuePoint, Equalis, 1GPA, Choice Partners, E&I, PEPPM, NPPGov and cooperative-flagged GSA MAS listings.

`npm run import:catalog-coops` (`scripts/import-catalog.ts`) builds `seed/catalog/catalog.json.gz`, `insights.json` and `reconcile.json`. The capture listed suppliers by exact name, so the importer merges records whose names match once legal suffixes are dropped, or that share a company website: 24,094 records become 22,778 companies (seven more merged by the review below). Links that every contract shares (TIPS, BuyBoard and 1GPA point all their contracts at one directory page) are kept as directory pages, not contract pages. The catalog lives on the server (`lib/catalog.ts`), with a word index so a search over it takes milliseconds.

**Search and the co-op section.** Results add the best-fitting catalog contracts to **Co-op contracts for this**, scored with the same fit formula, split by the agency's memberships (NASPO contracts count when they list the agency's state), at most 8 per side with a count of the rest, and one card per supplier per co-op. Expired contracts are hidden; contracts without a published end date say so. GSA MAS listings get their own lane with a SIN caveat, since GSA's cooperative-purchasing flag doesn't settle which schedules a city may use. Contracts Agora already seeds are skipped. Clicks go through the tracked `/go/[contract]` redirect; a contract with only a directory page links to that page with its number to look up. **Ask purchasing to get us on this** works on catalog contracts and keeps the number and supplier on the referral.

**Products.** **Products on co-op contracts** shows catalog items matching the request, each with every contract that sells it: Canon's Sourcewell prices (April 2026, with list price and discount), HGACBuy's published discounts (no base price, so shown as a discount, never a price) and PEPPM's technology items (price behind the member login). Items listed under several SKUs collapse to one card. **View on …** goes through `/go` to the exact item page.

**Storefronts.** Every catalog company has a storefront at `/storefronts/cat_…`, built from its contracts, with the agency's own co-ops first. **Claim this storefront** brings it into Agora as a supplier, so the usual claim flow (a work email on the company's website domain verifies at once) applies. Agora's own suppliers show an **On co-op contracts** section from their catalog record, and `/storefronts` searches all 22,778 companies.

**Price-list queue.** Account menu → **Price-list queue** (`/coops/price-lists`) lists the 12,602 linked documents by co-op and kind: 11,892 GSA Advantage catalog pages, 709 HGACBuy document bundles and Canon's Sourcewell price PDF. **Read it** opens the contract upload page with `?document=…`; the server fetches only documents in the catalog (15 MB and 25 seconds at most), reads it with the contract reader, which now reads HTML price tables as rows, and fills any header it can't find (supplier, contract number, co-op, dates) from the catalog. Each read's outcome shows in the queue. Nothing publishes until the rows are reviewed.

**AI data review.** Some judgments are too fuzzy for rules and too many for a person: is "Weld County Government" the Census record "County of Weld"? Is "Ventura" the city or the county? The importers write each one as a task with its real candidates (`seed/cleanup/tasks/`). `scripts/cleanup/prepare-shards.ts` splits them into batches, review agents answer them in batches, and `scripts/cleanup/collect.ts` checks every answer before keeping it. A pick must be one of the candidates offered, a category must be one of Agora's, a merge must stay within its group, and every Canon price must appear in its source line. The result is one file per task in `seed/cleanup/decisions/`, committed so builds are repeatable. The importers apply only high- and medium-confidence answers. The first pass covered 17,767 items: 6,059 governments matched to their federal record, 2,839 Census school districts paired with NCES, seven supplier merges, 30,860 contracts given an Agora category, 223 cleaner product names, and 109 Canon price rows the parser had missed. Rows priced at $0.00 (a rounded fraction of a cent) are left out. `scripts/cleanup/audit.ts` prints a fixed sample of each task for a person to check. `/data#cleanup` shows the counts.

**Reconciliation.** `seed()` applies what the catalog confirms about the 26 seeded co-op contracts it found: 47 fixes, including end dates for Sourcewell's CDW, Ideal and Tyler contracts, NASPO's participating states, start and end dates and own pages for the computer and Parks awards, and Dell's NASPO number (23004 in NASPO's index, not the 23026 on Dell's document). Where the catalog disagrees with a list Agora read from NASPO directly, Agora keeps its own and flags the difference. All of it is listed on **Co-op data** (`/data#catalog`).

## Co-op member lists

**Co-op member lists** (account menu, or **Ledger → Co-op traffic**, at `/coops`) is where Sovra ops keeps each co-op's list of member governments. Upload a CSV or XLSX with one government per row. `lib/members.ts` finds the name, website, email and state columns by their usual headings. A website, or failing that the domain of a contact email, is what Agora matches on. A row with neither still matches by name within the same state. Rows with no name, an unknown state or nothing to match on are skipped and reported. **Add to list** merges the upload into the existing list; **Replace list** swaps the list out entirely.

After every upload, Agora re-runs the lookup for every agency it knows. Newly matched agencies get a detected membership, so the co-op moves to **Co-ops you're on** in their results. A detected membership that nobody confirmed is dropped when its agency no longer appears on the list. The page also adds co-ops Agora doesn't track yet (TIPS, for example). **Try the sample** loads `public/test-contracts/sourcewell-member-list-sample.csv`: eight fictional rows, including one matched by email domain, one by name and state, and two broken on purpose.

## Carts, approvals and orders

Result cards and product pages have **Add to cart**, and the header shows the cart. The **cart** (`/cart`) splits by supplier, and each supplier's share is paid one way: P-card under the $10K quick-buy limit, a PO at or over it. Whoever built the cart can **hand it to someone who can buy**, with a division, a delivery address and notes, because the person who needs something often isn't the card holder. A cart with any PO share goes to Purchasing on **Send for approval**. Otherwise it orders right away. Purchasing approves it from the Procurement home page, which places every order with its POs already approved, or sends it back with a required reason. A sent-back cart can be revised and resubmitted. The cart page's tabs (Cart, Waiting on approval, Ordered, Sent back) keep every cart visible, and a co-op listing that links out can't be added.

Each **order** now runs to reconciled, with a timeline on its page. A P-card order goes placed → shipped → received → charge matched to the receipt. A PO order goes waiting on approval → approved → shipped → received → invoice matched (PO, receipt and invoice agree) → payment approved and the PO closed. Every step records what happened and when, and every order carries a demo GL code for its department. **Procurement → Orders** is the agency-wide table, filterable by person, department, status and payment, with each order's progress, its next step as a button and a CSV export for reconciliation. Riverbend is seeded with four earlier orders at different stages.

**Verification.** Supplier badges now open the checks behind them: SAM.gov registration, the SAM.gov exclusions list, Section 889, certificate of insurance, performance bond and each certification. Every check shows its source and the date it was last run, and expiring or failed checks show as "N checks to review." Storefronts list the checks in full. Only the eight fictional demo suppliers carry results, all labeled as demo data. Real companies (Tyler, Dell and the rest) show every check as not checked yet, because Agora holds no real SAM.gov or insurance results for them.

## Look and feel: USWDS, with retail presentation

Agora is built on the [U.S. Web Design System](https://designsystem.digital.gov/) (USWDS), and USWDS sets its colors, type and components. Editorial home-goods retail, in the spirit of Crate & Barrel, shapes only how products are presented. No retailer's name, logo, fonts or photography are used.

- **From USWDS:** USWDS's default theme, generated from the official `@uswds/uswds` package by `node scripts/uswds-theme.mjs`. That means primary blue-60v (#005ea2) for actions, with primary-dark hover and primary-darker press. It also covers cool-gray neutrals, the success, warning, error and info families, Source Sans for body and UI, bold Merriweather headings, 4px buttons, 2px outline buttons, 2px card borders with 8px corners, square text inputs, and the 0.25rem focus-blue outline. Components follow their USWDS counterparts: the basic header with a 4px current-page bar, buttons, tags, slim alerts, a summary box, checkboxes, a segmented button group, a modal, and a step indicator with a process list. USWDS token names work as classes (`bg-primary`, `text-base-dark`, `border-base-lighter`).
- **From retail:** result tiles laid out like a product grid (a large image panel, a small spaced maker name, the product name, then price and actions), generous whitespace, hairline rules between results sections, a single search field with plain underlined example searches, and a slim announcement strip.
- **The logo** is an app-style mark: a geometric "A" on a rounded blue tile, next to "Agora" in plain bold type (`components/Logo.tsx`).

`AGORA_THEME` in the script holds Agora's changes to USWDS's defaults, the equivalent of a project's `_uswds-theme.scss`; today it only sets the corner sizes. The script writes the tokens to `lib/uswds-theme.json` and the light and dark CSS variables to `app/theme.css`, which `tailwind.config.ts` reads. Agora isn't a federal site, so it doesn't use the USWDS government banner ("An official website of the United States government") or the identifier.

## Product decisions

These are settled, and the app follows them:

- **The free-plan limit counts RFP Lite only.** Handing a request to Sovra's RFP tool or to the agency's own tool (Euna, OpenGov, Bonfire) never counts toward the five free RFPs a year.
- **Only suppliers can buy placement.** Co-ops can't pay to rank higher, which keeps them neutral, since competing vendors sell through the same co-ops.
- **Resellers stay in results, last.** Reseller contracts appear under "Other ways," after the agency's own, state and co-op routes. Civic Marketplace-type channels aren't included.
- **The demo member lists stay, labeled.** WSPC's list, and the two fictional cities added to Sourcewell's, are marked as demo data. Real agencies are matched against the published rosters in the co-op directory, and lists a co-op shares are uploaded through **Co-op member lists**.

## Supplier plans, placements and listing fees

Suppliers earn Sovra money in four ways, all in the existing ledger options:

- **Claiming a storefront.** A storefront that Agora built from public contracts has a **Claim this storefront** link. A work email on the company's own website domain verifies the claim at once. Any other email waits for Sovra review, and the storefront shows a demo **Approve claim** button. Once claimed, the supplier views act as that company. A **Viewing as** picker switches between claimed storefronts.
- **Storefront plans** (option 6): Basic is free. Profile ($500/yr) adds the supplier's own tagline and description and targeted placements. Profile with catalog ($1,500/yr) adds a published catalog and featured product lines. An upgrade bills only the difference for the year.
- **Targeted placements** (option 5): a supplier picks a category and a state, or anywhere. Its listings show as Sponsored only on searches in that category, for agencies in that state. Billing is still $2.00 per results page shown. Sponsorship can move a listing up within its own kind of contract; it never changes a fit score or which contracts an agency can use. Placements need a claimed storefront and either a paid plan or Edge Win and up. In the seed, National Furniture's sponsorship is a placement for furniture, anywhere.
- **Listing fees** (option 2): a supplier with no contract at all (small purchases only, like MetroMart) pays $150 a year to appear. Its listings are hidden while the fee has lapsed.

Manage all of this under **Supplier → Plans and placements** (`components/SupplierPlans.tsx`). The rules are in `lib/suppliers.ts`.

## Verified suppliers only

Results have a **Verified suppliers only** checkbox. A supplier counts as verified when its checks have been run and every one passed; an expiring certification counts as not passed. A performance bond isn't required, since most purchases don't need one. The filter applies to both product tiles and co-op contracts, and a line says how many options it hid, with a link to show everything.

## Dark mode

The account menu has **Appearance: System, Light, Dark**. System follows the computer's setting. A saved choice is applied before the page paints, so there's no flash of the wrong theme.

USWDS doesn't define a dark theme, so `scripts/uswds-theme.mjs` builds one. It mirrors each color's grade within its own USWDS family: light surfaces become dark ones, ink becomes light, and borders, status colors and route colors move to the grade that reads on dark. Every dark value is still a USWDS system color. White and black swap too, so text on a filled button stays readable. The script writes every color as a CSS variable with light and dark values (`app/theme.css`), and Tailwind reads the variables. Category tiles mix their hue into the page surface, so they're pastel on white and deep on dark. Avatars, storefront banners, the announcement strip and modal backdrops keep fixed colors in both modes.

## Rehearsing the demo

`npm run build && npm start`, then `npm run rehearse` (or `node scripts/rehearse-demo.cjs <url>` against a deployed copy) walks the demo path below, steps 1 to 13, in a real browser. It reports PASS or FAIL for each step and saves a screenshot of any failure to `rehearsal/`. Run it before a demo.

## NASPO ValuePoint

`npm run import:naspo` (`scripts/import-naspo.mjs`) reads one NASPO ValuePoint portfolio from naspovaluepoint.org (its public WordPress API and supplier pages) and writes `seed/catalogs/naspo-citizen-engagement-platforms.json`: each award's master agreement number, award and expiration dates, the states with a participating addendum, and links to the master agreement and price files. It needs network access to www.naspovaluepoint.org and, for documents, its S3 buckets; run Node with `NODE_USE_ENV_PROXY=1` behind a proxy.

Tyler's AR3764 price catalog (September 2026, `seed/catalogs/tyler-technologies-naspo-ar3764-catalog-2026-09.xlsx`) was imported with the same importer as the NJSTART file (`node scripts/import-price-catalog.mjs tyler-technologies-naspo-ar3764-catalog-2026-09.xlsx tyler-technologies-naspo-ar3764-2026-09.json`). Its sheets are the AR3764 award categories, and 203 of the 204 featured NJSTART rows match it on SKU, name and price, so Tyler's products sit on AR3764 and NJSTART shows as New Jersey's route to the same prices. That link is read from the documents (New Jersey's executed addendum M4027 names AR3764), not stated in the NJSTART file itself.

Suppliers whose awards have no loaded prices still turn up in search: a request that matches an award's scope ("chatbot", "customer engagement") lists it under **Also on contract, by quote**, with whether the buyer's state has signed on.

## Example storefront: Tyler Technologies

`/storefronts/sup_tyler` shows what a featured storefront looks like: a tagline and about text, the 13 product lines from Tyler's catalog (each filters the catalog), six featured products, every contract with its participating states and source documents, and the full catalog. It is labeled as an example built from Tyler's public price files, not written or endorsed by Tyler. The other NASPO suppliers have basic storefronts built from their contracts alone.

## Vendor price catalog

Agora also carries Tyler Technologies' March 2025 price catalog (`seed/catalogs/tyler-technologies-price-catalog-2025-03.xlsx`), so buyers can ask for software and services such as "jury management", "open data portal" or "an implementation consultant". `npm run import:catalog` turns the spreadsheet into `seed/catalogs/tyler-technologies-2025-03.json`, which the seed loads on every reset.

The catalog keeps each price inside the product description, so the importer reads only the price line and lists a row only when it holds one clear price. Of 1,672 rows, 1,350 import cleanly; the other 322 are skipped with a reason recorded in the JSON (no price, a price range or "up to" ceiling, tiers or a minimum spread over several lines, or a price with a percentage or second component). Products priced in tiers (by population or volume) show as one product with a tier picker, preset to the tier that fits the buyer's population. Agora carries the 100 Tyler products a city, county or school district is most likely to buy (204 price rows across their tiers). `scripts/feature-tyler.mjs` picks them: core subscriptions and platforms score up; third-party add-ons, training and implementation hours, hardware, usage fees, and state-, federal- or enterprise-scale offerings score down; and each product line has a quota so payments, permitting, records, public safety, open data and the rest are all represented. The other rows stay in the JSON, so widening the cut means changing the quotas and running `npm run import:catalog`.

The catalog names rows the way its price sheet does ("Flip to Saas: Tax Pro (Tier D -population >280,000)", "Task - Custom"), so `scripts/name-tyler.mjs` gives each featured product a plain name and one-line description ("Property assessment and tax software, cloud"), turns tier codes into readable sizes ("Population 80,001–160,000", "1–50 sworn officers"), and hides six rows that duplicate another tier or serve only federal buyers. The catalog's own wording stays searchable, and the product page shows where each item sits in Tyler's catalog. A product added to the featured set without a name stops the import with a list of what's missing.

It is New Jersey's state contract on NJSTART, 26-TELE-114629, so it is open to New Jersey public entities only. Tyler has no seeded reviews or ratings.

## Putting it online

The easiest host is **Render**, using the `render.yaml` blueprint in this repo. Go to [dashboard.render.com](https://dashboard.render.com), choose **New → Blueprint**, connect this GitHub repo, and accept the defaults. Render will ask for `ANTHROPIC_API_KEY`; leave it blank to run offline. You'll get a public `https://riverbend-storefront.onrender.com`-style URL in a few minutes, and every push to `main` redeploys.

Pick a host that runs one long-lived Node server (Render, Railway, Fly.io). The demo keeps its state in memory, so serverless hosts like Vercel or Netlify can split a single click-through across instances that don't share state. On Render's free plan the service sleeps after about 15 minutes idle. The first visit afterward takes roughly a minute to wake, and the demo comes back freshly reset. Open the URL a minute before you present, or use a paid instance to keep it warm.

## The demo path

The prototype supports section 8 of the spec end to end. Switch roles with the Buyer / Procurement / Supplier control in the header, and open **Sovra revenue (demo)** at any point to watch the ledger fill up.

1. **Buyer:** open **For cities → City of Riverbend**, ask for "40 folding tables for the Eastside rec center, delivered before March" and answer **Yes** to the local/MBE question. Riverside Office Supply (own contract, Local + MBE) ranks first, then the state contract, a sponsored National Furniture co-op listing, and a Harper County peer pick.
2. **Buy from Riverside.** The order is over $10K, so it routes to a PO and **Send for approval** (options 3 and 2, plus a credit toward option 1).
3. **Procurement:** approve the PO, then open Spend intelligence.
4. **Buyer:** "a box of pencils for the front desk" returns a single no-approval option. The P-card checkout fires option 9.
5. **Buyer:** "LED retrofit for the ice rink" matches nothing, so the solicitation path appears. **Publish** fires option 8.
6. **Supplier:** go to Upload a contract and pick **State office supplies**. Fix the flagged two-price row, merge the duplicate binder-clip row, **Accept all above 90%**, then publish. The result is 38 items listed and 4 needing attention (option 2). The new items are immediately searchable as a buyer.
7. **Supplier:** Insights shows the LED request as unmet demand. City marketplaces → **List here** for Harper County fires option 4. Apps → PO financing → **Get started** fires option 10. Responding to a review fires option 6.
8. **Ledger → Totals** shows all ten options, broken out by option and by payer.
9. **Buyer, co-op match:** set your agency to **Town of Crested Butte, CO** and ask for "laptops for the town hall". Sourcewell's published roster lists the town (member 42245), and Colorado has signed NASPO's participating addendum for Dell 23004, HP 23011 and Lenovo 23013, so all of them sit under **Co-ops you're on**. Apple 23003 shows as not open, since Colorado isn't on Apple's addendum. **Co-ops you could join** lists contracts from the co-op catalog, such as Equalis Group's Acer and Lenovo awards. Confirm Sourcewell, then choose **Ask purchasing to get us on this** on an Equalis contract. Switch to **Procurement** to see the join request, and open **Ledger → Co-op traffic** for the impressions and the referral.
10. **Procurement, setup:** open **Setup**, pick **Harmon Lake Township** and choose **Try the sample register**. Five contracts import, three rows are reported with their problems, and the expired janitorial contract is flagged. Switch to **Buyer** and ask for "bulletproof vests for patrol": the township's own body-armor contract comes first.
11. **Buyer, the free tier:** still as Harmon Lake, ask for "LED retrofit for the ice rink" and choose **RFP Lite → Build it**. Publishing uses the last of the five free RFPs. Build another and the page asks to upgrade, but **Send it over** to Euna, back on the results page, still works.
12. **Buyer, cart and approval:** as Riverbend, ask for the folding tables again and choose **Add to cart** on Riverside and on National Furniture. In the cart, Riverside's $10,560 is a PO and National's $9,960 is a P-card order. **Hand this cart to someone who can buy**, then **Send for approval**. Switch to **Procurement**: send it back with a reason, then, as the buyer, revise and resubmit, and as Purchasing, **Approve and order**. Open **Orders** and step the new PO through to reconciled.
13. **Sovra ops, member lists:** open **Co-op member lists**, choose **Try the sample** on Sourcewell, then set your agency to Harmon Lake Township. Sourcewell now shows under its co-ops, matched by the email domain on the list.
14. **Supplier, claim and sell:** open **Storefronts → Dell Technologies**, choose **Claim this storefront** and use a `@dell.com` email: the claim verifies at once, and **Plans and placements** opens as Dell. Upgrade to Profile (option 6). Then switch **Viewing as** to TechSource Government Solutions and add a placement for IT hardware in Colorado. As the Town of Crested Butte, "laptops for the town hall" now shows TechSource's laptop as Sponsored. As the City of Cedar Bend (Iowa), it doesn't. (Placements mark product tiles; Dell's NASPO award is quote-only, with no products to mark.)
15. **Buyer, verified only:** as Riverbend, ask for the folding tables and tick **Verified suppliers only**. Riverside, whose MBE certification is expiring, drops out, and a line says one option is hidden.

## Where things live

| Path | What it does |
| --- | --- |
| `lib/revenue_rules.ts` | The ten revenue options, amounts and firing rules, all in one file for tuning |
| `lib/seed.ts` | Agency, 8 suppliers, 40 listings across all six sources, solicitations, peers, reviews |
| `lib/assistant.ts` | Request parsing, matching, ranking, threshold and payment rules, "How these are ranked" |
| `app/page.tsx`, `app/marketplaces/`, `app/storefronts/` | The marketplace home, the city marketplaces (Riverbend's included), and supplier storefronts |
| `lib/parser.ts` | Contract extraction (PDF / DOCX / XLSX / CSV), LLM structuring, offline heuristic, dedupe |
| `lib/actions.ts` | Every state change, which is also where revenue events fire |
| `seed/contracts/` | Three real sample contracts (PDFs and an XLSX), regenerated by `npm run seed:contracts` |
| `scripts/fetch-federal-ids.ts`, `scripts/import-coop-data.ts`, `seed/coops/` | The federal ID registries, co-op workbook and .gov registry, and the directory and insights built from them by `npm run fetch:federal` and `npm run import:coops` |
| `lib/directory.ts`, `app/api/directory/` | Server-only lookups in the co-op directory, and the API the agency typeahead calls |
| `scripts/import-catalog.ts`, `seed/catalog/`, `lib/catalog.ts` | The co-op catalog: its source capture, the importer, and server-side contract, product, supplier and document lookups |
| `lib/pricelists.ts`, `app/coops/price-lists/` | The price-list queue: fetching catalog documents for the contract reader, and the page that lists them |
| `app/data/` | The Co-op data page |
| `app/` | Next.js App Router pages and the `/api/state`, `/api/act`, `/api/contracts/parse` routes |

## Contract parsing

There are two sets of contract files. The **samples** in `seed/contracts/` are the one-click cards on the upload screen; nothing is imported until someone picks one, so the demo always shows a live parse. The **test files** in `public/test-contracts/` are for trying a real upload: download one from the upload screen (or grab it from the repo) and drag it into the drop zone.

| Test file | What it exercises |
| --- | --- |
| `techsource-it-peripherals.docx` | A Word table, a reseller source, and a SKU already in Agora at a new price |
| `evergreen-public-works-materials.pdf` | No piggyback clause, so other cities' marketplaces stay locked; a price range lands in Unresolved |
| `fleet-parts-price-list.csv` | A bare price list with no contract terms; type a supplier name before publishing |
| `scanned-custodial-contract.pdf` | An image-only scan, which shows the no-OCR message |

`npm run seed:contracts` regenerates both sets.

Uploads are stored under `uploads/` keyed by file hash, and parse results are cached per hash, so re-opening is instant. The parser never invents a price. Ranges, "contact for quote", TBD and "per attached schedule" all land in **Unresolved** with the source text quoted. When Claude does the structuring, every price it returns is checked against the document text, and any price that can't be found there is moved to Unresolved. Scanned PDFs and contracts over 60 pages get a clear message rather than a silent failure.

## Deliberate deviations from the spec

- **Folding tables cost about $260, not $64.** At $64, 40 tables come to $2,560, which wouldn't trigger the PO and approval steps the demo script calls for. Riverside is $264 and the state contract is $259, so 40 tables just clear $10K.
- **National Furniture Co. is on Edge Win, not Discover.** The spec allows sponsored placement only for Win and Position, but the demo script needs National's listing to be sponsored.
- **Option 2 also fires on a contract's first order** if the contract predates the city's marketplace. This is how step 3's "options 3 and 2 (if first time)" is realized.
- **Co-op and reseller orders carry listing fees only**, with no transaction fee (the default from open question 12.1). This is noted in the ledger.
