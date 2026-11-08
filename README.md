# Riverbend Storefront (Marketplace 2.0 prototype)

A clickable prototype of one local government's storefront for everything it's allowed to buy, plus the supplier side of that storefront, with Sovra's revenue mechanics visible on screen. It's built for leadership demos, not production. There's one city (the fictional City of Riverbend), seeded data, and no real integrations.

## Running it

```bash
npm install
npm run dev        # http://localhost:3000
```

Everything works offline. To have Claude (`claude-sonnet-5-5`) parse requests and structure uploaded contracts, copy `.env.example` to `.env` and set `ANTHROPIC_API_KEY`. Without a key, a keyword matcher and a regex-and-table contract parser take over, and the header shows an "Offline parsing" tag. Any API failure falls back the same way.

State lives in memory on the server. **Reset demo** (in the revenue ledger) reseeds everything with stable IDs, so the demo script below is repeatable.

## How it earns

The **How it earns** page (in the header for every role) turns the Marketplace 2.0 deck into live diagrams: the three kinds of purchase, the buyer value chain, the supplier loop, the flywheel, the five-way revenue equation and the ten-option table. Revenue badges fill in as options fire during the demo, and every option links to the place in the app that triggers it. The numbered maroon badges also appear on result cards, checkout and the supplier journey; switch them off with **Show how Sovra earns** under the header for a buyer-only view.

Proactive buying is live too: the expiring custodial contract on the buyer home starts an early renewal solicitation drafted from the past custodial bid.

## Buyers, eligibility and ways to buy

The buyer defaults to the City of Riverbend and can be changed at any time (agency, state, type and optional population), because contracts are open to different buyers. Every contract carries eligibility rules, a pricing basis and a verification level, and results show only the routes that buyer can use. Matches on closed contracts are summarized instead of hidden, and each product page lists every way to buy it side by side.

| Vehicle | Number | Open to | Pricing | Verification |
| --- | --- | --- | --- | --- |
| NJSTART, Tyler Technologies | 26-TELE-114629 | New Jersey public entities | Published prices: 100 featured products of 1,073 | Source document |
| NJSTART, Maximus US Services | 26-TELE-115813, adopted from NASPO ValuePoint AR3758 | New Jersey public entities | 14 published rates | Source document, checked line by line against the scanned Attachment C |
| Sourcewell, Tyler Technologies | 060624-TTI | Members nationwide | Discount off list; quote required | Research lead |
| Carahsoft (Iowa / NASPO AR2472, CoreTrust) | 2024-BUS-0226, 24COR-018GR | Adopting states, CoreTrust members | Quote only; no price files loaded | Research lead |
| Riverbend, ORCPP, WSPC, GSA, reseller | various | as stated | Published prices | Demo data |

When a product sits on a contract the buyer can't use but the same supplier has an open co-op award, it is offered by quote through that award, with the closed contract's price shown only as a reference. Sourcewell discount percentages from the research seed appear only as labeled, unverified notes, never as prices. The three buyer presets are the City of Riverbend (Oregon), Harmon Lake Township (a fictional New Jersey municipality) and a New Jersey state department.

## Vendor price catalog

Riverbend's storefront also carries Tyler Technologies' March 2025 price catalog (`seed/catalogs/tyler-technologies-price-catalog-2025-03.xlsx`), so buyers can ask for software and services such as "jury management", "open data portal" or "an implementation consultant". `npm run import:catalog` turns the spreadsheet into `seed/catalogs/tyler-technologies-2025-03.json`, which the seed loads on every reset.

The catalog keeps each price inside the product description, so the importer reads only the price line and lists a row only when it holds one clear price. Of 1,672 rows, 1,350 import cleanly; the other 322 are skipped with a reason recorded in the JSON (no price, a price range or "up to" ceiling, tiers or a minimum spread over several lines, or a price with a percentage or second component). Products priced in tiers (by population or volume) show as one product with a tier picker, preset to the tier that fits the buyer's population. The storefront carries the 100 Tyler products a city, county or school district is most likely to buy (210 price rows across their tiers). `scripts/feature-tyler.mjs` picks them: core subscriptions and platforms score up; third-party add-ons, training and implementation hours, hardware, usage fees, and state-, federal- or enterprise-scale offerings score down; and each product line has a quota so payments, permitting, records, public safety, open data and the rest are all represented. The other rows stay in the JSON, so widening the cut means changing the quotas and running `npm run import:catalog`.

It is New Jersey's state contract on NJSTART, 26-TELE-114629, so it is open to New Jersey public entities only. Tyler has no seeded reviews or ratings.

## Putting it online

The easiest host is **Render**, using the `render.yaml` blueprint in this repo. Go to [dashboard.render.com](https://dashboard.render.com), choose **New → Blueprint**, connect this GitHub repo, and accept the defaults. Render will ask for `ANTHROPIC_API_KEY`; leave it blank to run offline. You'll get a public `https://riverbend-storefront.onrender.com`-style URL in a few minutes, and every push to `main` redeploys.

Pick a host that runs one long-lived Node server (Render, Railway, Fly.io). The demo keeps its state in memory, so serverless hosts like Vercel or Netlify can split a single click-through across instances that don't share state. On Render's free plan the service sleeps after about 15 minutes idle. The first visit afterward takes roughly a minute to wake, and the demo comes back freshly reset. Open the URL a minute before you present, or use a paid instance to keep it warm.

## The demo path

The prototype supports section 8 of the spec end to end. Switch roles with the Buyer / Procurement / Supplier control in the header, and open **Sovra revenue (demo)** at any point to watch the ledger fill up.

1. **Buyer:** ask for "40 folding tables for the Eastside rec center, delivered before March" and answer **Yes** to the local/MBE question. Riverside Office Supply (own contract, Local + MBE) ranks first, then the state contract, a sponsored National Furniture co-op listing, and a Harper County peer pick.
2. **Buy from Riverside.** The order is over $10K, so it routes to a PO and **Send for approval** (options 3 and 2, plus a credit toward option 1).
3. **Procurement:** approve the PO, then open Spend intelligence.
4. **Buyer:** "a box of pencils for the front desk" returns a single no-approval option. The P-card checkout fires option 9.
5. **Buyer:** "LED retrofit for the ice rink" matches nothing, so the solicitation path appears. **Publish** fires option 8.
6. **Supplier:** go to Upload a contract and pick **State office supplies**. Fix the flagged two-price row, merge the duplicate binder-clip row, **Accept all above 90%**, then publish. The result is 38 items listed and 4 needing attention (option 2). The new items are immediately searchable as a buyer.
7. **Supplier:** Insights shows the LED request as unmet demand. Storefronts → **Add storefront** for Harper County fires option 4. Apps → PO financing → **Get started** fires option 10. Responding to a review fires option 6.
8. **Ledger → Totals** shows all ten options, broken out by option and by payer.

## Where things live

| Path | What it does |
| --- | --- |
| `lib/revenue_rules.ts` | The ten revenue options, amounts and firing rules, all in one file for tuning |
| `lib/seed.ts` | Agency, 8 suppliers, 40 listings across all six sources, solicitations, peers, reviews |
| `lib/assistant.ts` | Request parsing, matching, ranking, threshold and payment rules, "Why this order?" |
| `lib/parser.ts` | Contract extraction (PDF / DOCX / XLSX / CSV), LLM structuring, offline heuristic, dedupe |
| `lib/actions.ts` | Every state change, which is also where revenue events fire |
| `seed/contracts/` | Three real sample contracts (PDFs and an XLSX), regenerated by `npm run seed:contracts` |
| `app/` | Next.js App Router pages and the `/api/state`, `/api/act`, `/api/contracts/parse` routes |

## Contract parsing

There are two sets of contract files. The **samples** in `seed/contracts/` are the one-click cards on the upload screen; nothing is imported until someone picks one, so the demo always shows a live parse. The **test files** in `public/test-contracts/` are for trying a real upload: download one from the upload screen (or grab it from the repo) and drag it into the drop zone.

| Test file | What it exercises |
| --- | --- |
| `techsource-it-peripherals.docx` | A Word table, a reseller source, and a SKU already in the storefront at a new price |
| `evergreen-public-works-materials.pdf` | No piggyback clause, so other storefronts stay locked; a price range lands in Unresolved |
| `fleet-parts-price-list.csv` | A bare price list with no contract terms; type a supplier name before publishing |
| `scanned-custodial-contract.pdf` | An image-only scan, which shows the no-OCR message |

`npm run seed:contracts` regenerates both sets.

Uploads are stored under `uploads/` keyed by file hash, and parse results are cached per hash, so re-opening is instant. The parser never invents a price. Ranges, "contact for quote", TBD and "per attached schedule" all land in **Unresolved** with the source text quoted. When Claude does the structuring, every price it returns is checked against the document text, and any price that can't be found there is moved to Unresolved. Scanned PDFs and contracts over 60 pages get a clear message rather than a silent failure.

## Deliberate deviations from the spec

- **Folding tables cost about $260, not $64.** At $64, 40 tables come to $2,560, which wouldn't trigger the PO and approval steps the demo script calls for. Riverside is $264 and the state contract is $259, so 40 tables just clear $10K.
- **National Furniture Co. is on Edge Win, not Discover.** The spec allows sponsored placement only for Win and Position, but the demo script needs National's listing to be sponsored.
- **Option 2 also fires on a contract's first order** if the contract predates the storefront. This is how step 3's "options 3 and 2 (if first time)" is realized.
- **Co-op and reseller orders carry listing fees only**, with no transaction fee (the default from open question 12.1). This is noted in the ledger.
