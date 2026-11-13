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

The laptop contracts behind the demo are real master agreements, carried as research leads because their current terms aren't confirmed. NASPO ValuePoint's Computer Equipment portfolio (lead state Minnesota) includes Dell 23026, HP 23011, Lenovo 23013 and Apple 23003, taken from Dell's posted agreement and a Hawaii SPO vendor list. Sourcewell's technology portfolio includes 121923-CDW, whose August 2026 rate card lists 5% off notebooks, and 121923-IDL. Sourcewell's and WSPC's member lists are **demo lists for illustration**, not from those co-ops.

## Agency setup, plans and the free tier

**Procurement → Setup** (`/procurement/setup`) is where a purchasing admin configures an agency once, so staff never have to. It shows a three-step checklist (state, the agency's own contracts, co-op memberships), the membership strip, the contract register and the plan.

**Contract register.** The admin uploads a CSV or XLSX with one contract per row. `lib/register.ts` finds the header row by common column names ("Contract Name", "Vendor", "Contract #", "End Date", "Not to Exceed" and so on) and validates every row. A row with no title, no vendor, an unreadable date or a ceiling that isn't a single amount is not imported, and the report names the row and the reason. An expired row is imported but hidden from search. Re-uploading updates rows by contract number instead of duplicating them. Register contracts belong to that agency alone: `/api/state` strips other agencies' rows before anything reaches the browser, and search never shows them to anyone else. When a request matches one, results open with **"Your agency already has a contract for this."** **Try the sample register** loads `public/test-contracts/harmon-lake-contract-register.csv`: eight rows, with three broken on purpose and one expired.

**Free tier.** Search is always free. The free plan includes 5 published RFPs a year (`FREE_RFP_LIMIT` in `lib/agency.ts`), and the counter resets each year. At the limit, RFP Lite asks the agency to upgrade, while search and handoffs keep working. Harmon Lake Township is seeded with 4 of 5 used, and Riverbend, a city marketplace customer, is on the paid plan. The free plan shows sponsored placements, marked as sponsored. A paid agency can turn them off for its staff, which drops both the label and the ranking nudge.

**When nothing fits,** results offer three next steps: **RFP Lite** (free, counted against the plan), **Sovra's full RFP tool** (paid) and a handoff to the agency's own tool (Euna, OpenGov or Bonfire). Handoffs are recorded but don't call any outside system.

**Setup questions route to purchasing.** If a requester searches before setup is done, a one-line banner says what's missing and what that means for the results, and offers **Invite purchasing**. The invite shows up on the setup page. No email is sent in the demo.

Results also hide expired contracts by default, behind a one-line "N expired contracts also matched" with a **Show** link. State contracts in TRX states (New Jersey, Oregon, Arkansas, Hawaii and New York; `TRX_STATES` in `lib/trx.ts`) carry a **TRX** label everywhere they appear, and the ledger books a TRX fee only on those. Other state contracts show an ordinary transaction fee.

## Co-op member lists

**Co-op member lists** (account menu, or **Ledger → Co-op traffic**, at `/coops`) is where Sovra ops keeps each co-op's list of member governments. Upload a CSV or XLSX with one government per row. `lib/members.ts` finds the name, website, email and state columns by their usual headings. A website, or failing that the domain of a contact email, is what Agora matches on. A row with neither still matches by name within the same state. Rows with no name, an unknown state or nothing to match on are skipped and reported. **Add to list** merges the upload into the existing list; **Replace list** swaps the list out entirely.

After every upload, Agora re-runs the lookup for every agency it knows. Newly matched agencies get a detected membership, so the co-op moves to **Co-ops you're on** in their results. A detected membership that nobody confirmed is dropped when its agency no longer appears on the list. The page also adds co-ops Agora doesn't track yet (TIPS, for example). **Try the sample** loads `public/test-contracts/sourcewell-member-list-sample.csv`: eight fictional rows, including one matched by email domain, one by name and state, and two broken on purpose.

## Carts, approvals and orders

Result cards and product pages have **Add to cart**, and the header shows the cart. The **cart** (`/cart`) splits by supplier, and each supplier's share is paid one way: P-card under the $10K quick-buy limit, a PO at or over it. Whoever built the cart can **hand it to someone who can buy**, with a division, a delivery address and notes, because the person who needs something often isn't the card holder. A cart with any PO share goes to Purchasing on **Send for approval**. Otherwise it orders right away. Purchasing approves it from the Procurement home page, which places every order with its POs already approved, or sends it back with a required reason. A sent-back cart can be revised and resubmitted. The cart page's tabs (Cart, Waiting on approval, Ordered, Sent back) keep every cart visible, and a co-op listing that links out can't be added.

Each **order** now runs to reconciled, with a timeline on its page. A P-card order goes placed → shipped → received → charge matched to the receipt. A PO order goes waiting on approval → approved → shipped → received → invoice matched (PO, receipt and invoice agree) → payment approved and the PO closed. Every step records what happened and when, and every order carries a demo GL code for its department. **Procurement → Orders** is the agency-wide table, filterable by person, department, status and payment, with each order's progress, its next step as a button and a CSV export for reconciliation. Riverbend is seeded with four earlier orders at different stages.

**Verification.** Supplier badges now open the checks behind them: SAM.gov registration, the SAM.gov exclusions list, Section 889, certificate of insurance, performance bond and each certification. Every check shows its source and the date it was last run, and expiring or failed checks show as "N checks to review." Storefronts list the checks in full. Only the eight fictional demo suppliers carry results, all labeled as demo data. Real companies (Tyler, Dell and the rest) show every check as not checked yet, because Agora holds no real SAM.gov or insurance results for them.

## Look and feel: USWDS with a retail theme

Agora is built on the [U.S. Web Design System](https://designsystem.digital.gov/) (USWDS), with a custom USWDS theme in a warm, editorial retail style: ink calls to action on white, warm-gray neutrals, light sans headlines, square corners and image-led product tiles. The style is inspired by home-goods retailers like Crate & Barrel, but uses none of their name, logo, fonts or photography. The tokens are generated from the official `@uswds/uswds` package, not hand-picked. `node scripts/uswds-theme.mjs` reads USWDS's own SCSS (system color tokens, theme color settings, type scale, typeface cap heights, line heights), applies Agora's theme settings (`AGORA_THEME` in the script, the equivalent of a project's `_uswds-theme.scss`), and writes `lib/uswds-theme.json`, which `tailwind.config.ts` reads. USWDS token names work as classes: `bg-primary`, `hover:bg-primary-dark`, `text-base-dark`, `border-base-lighter`, `bg-success-lighter`, `text-error-dark`. Agora's older color names map onto USWDS theme tokens, so every page follows the system.

- **Theme settings:** primary is gray-90 ink, primary-dark is black, the base neutrals come from the gray-warm family, the heading role uses the sans typeface at a light weight, and buttons, cards, tags and inputs have square corners. Focus blue and the success, warning, error and info colors stay USWDS defaults. Change `AGORA_THEME` and rerun the script to restyle everything; deleting it restores the stock USWDS look.
- **Type:** Source Sans for body, UI and headings (USWDS's default heading font, Merriweather, is switched off by the theme). Sizes come from the USWDS theme scale, normalized by each typeface's cap height the way USWDS does it (`text-heading-xl` with `font-heading`, `text-ui-xs`, `text-body-md`).
- **Color:** USWDS theme colors, as set by Agora's theme: ink primary, gray-warm base, and the USWDS success, warning, error and info families. Agora's five buying routes are project colors drawn from USWDS system colors at vivid grade 60, with grade 10 backgrounds and grade 80 text, following USWDS's "magic number" for accessible contrast.
- **Components:** these follow their USWDS counterparts.
  - Default, outline and unstyled buttons, with 4px corners and darker hover and active states.
  - Card containers with hairline base-lighter borders, and result tiles laid out like a retail product grid: a large image panel on warm gray, a small spaced maker name, the product name, then price and actions.
  - Tags, and slim alerts with the 8px left bar.
  - A summary box for "your agency already has a contract for this."
  - Text inputs, and checkboxes in place of toggle switches (USWDS has no switch).
  - A segmented button group.
  - A retail-style header: a thin ink announcement strip, a centered spaced wordmark, cart and account on the right, and centered navigation that underlines the current page.
  - A modal for supplier checks.
  - A step indicator and process list on the order page.
- **Focus:** keyboard focus uses USWDS's 0.25rem outline in focus blue (#2491ff).

Agora is not a federal government site, so it does not use the USWDS government banner ("An official website of the United States government") or the identifier. Those are for official government websites only. To pick up a newer USWDS release, update the package and rerun the script.

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
9. **Buyer, co-op match:** set your agency to **Town of Crested Butte, CO** and ask for "laptops for the town hall". Agora detected Sourcewell from the town's website, so CDW and Ideal (fit 70, broad technology scope) sit under **Co-ops you're on**. NASPO's four Computer Equipment awards (fit 100, laptops named in the title) sit under **Co-ops you could join**, and the amber flag points out the better fit. Confirm Sourcewell, then choose **Ask purchasing to get us on this** on Dell 23026. Switch to **Procurement** to see the join request, and open **Ledger → Co-op traffic** for the impressions and the referral.
10. **Procurement, setup:** open **Setup**, pick **Harmon Lake Township** and choose **Try the sample register**. Five contracts import, three rows are reported with their problems, and the expired janitorial contract is flagged. Switch to **Buyer** and ask for "bulletproof vests for patrol": the township's own body-armor contract comes first.
11. **Buyer, the free tier:** still as Harmon Lake, ask for "LED retrofit for the ice rink" and choose **RFP Lite → Build it**. Publishing uses the last of the five free RFPs. Build another and the page asks to upgrade, but **Send it over** to Euna, back on the results page, still works.
12. **Buyer, cart and approval:** as Riverbend, ask for the folding tables again and choose **Add to cart** on Riverside and on National Furniture. In the cart, Riverside's $10,560 is a PO and National's $9,960 is a P-card order. **Hand this cart to someone who can buy**, then **Send for approval**. Switch to **Procurement**: send it back with a reason, then, as the buyer, revise and resubmit, and as Purchasing, **Approve and order**. Open **Orders** and step the new PO through to reconciled.
13. **Sovra ops, member lists:** open **Co-op member lists**, choose **Try the sample** on Sourcewell, then set your agency to Harmon Lake Township. Sourcewell now shows under its co-ops, matched by the email domain on the list.

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
