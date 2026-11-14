# Agora: notes for Claude

Agora is a procurement marketplace prototype for local governments. A buyer describes what they need, and Agora shows options across their own contracts, state contracts, co-op contracts and suppliers. It also knows which co-ops each government belongs to, what those co-ops have under contract, and what the buyer's state law allows. The README is the full product and data reference. This file covers how to work in the repo; `HANDOFF.md` covers where things stand.

## Commands

```bash
npm install
npm run dev            # http://localhost:3000
npm run typecheck      # tsc --noEmit
npm run build
npm run rehearse       # 16-step demo walkthrough in Playwright; needs a server on :3000. It resets the demo: never run it against the live site
npm run smoke          # read-only check of search and the shopper tools; safe on the live site (npm run smoke -- <url>)
npm run eval           # the fixed test set for the prompts and their checks (evals/cases.ts)
```

Run `rehearse` against a production build: `npm run build`, then `npx next start -p 3000`, then `npm run rehearse`. All 16 steps must pass, with no page errors, before anything merges. To stop the server, run `pkill -f next-server` (`pkill -f "next start"` doesn't stop it).

## How the app is built

- Next.js 15 App Router. State is an in-memory `Db` (`lib/db.ts`, seeded by `lib/seed.ts`), changed only through `lib/actions.ts` via `/api/act`. With `DATABASE_URL` set it is saved to Postgres after each change (`lib/persist.ts`); without it, nothing is saved.
- Every route that reads or changes the store is wrapped in `withSession()` (`lib/session.ts`), which binds the visitor's agency and account to the request. A new action is account-only unless it is added to `OPEN` in `app/api/act/route.ts`.
- `/api/state` sends the whole `Db` to the browser. Large datasets therefore stay server-only and are read lazily: the co-op directory (`lib/directory.ts`), the co-op catalog (`lib/catalog.ts`) and state rules (`lib/state-rules.ts`). Results carry only the slice a page needs. Never import those modules or their JSON into a `"use client"` component.
- The results page (`app/request/[id]/page.tsx`) reads as a record: the request as fields, one recommended route (`components/Shopper.tsx`), every priced option in one table (`components/results/OptionsTable.tsx`), then the other sources folded (`components/results/Fold.tsx`). Its copy is formal and third-person: no "your shopper", no "I". Keep new text on it that way.
- Contract uploads are read in the background: `/api/contracts/parse` answers with a job id and the page polls for the result (`lib/parse-jobs.ts`).
- A helper used by both a server page and a client component can't live in a `"use client"` file (see `components/StateRuleBits.tsx`).
- TRX state contracts (`lib/trx.ts`) are the preferred route: NJSTART, Hawaii SPO, Arkansas OSP, NYS OGS (with New York's preferred sources) and Empire Procure Connect contracts lead results for their own state's buyers. Keep that preference when changing search or ranking.
- The UI uses USWDS-based Tailwind tokens (`tailwind.config.ts`). The theme has `error-*`, `warning-*` and `success-*` colors, plus emerald and amber; it has no `red-*`.

## Changing a prompt or a check

Every model call goes through `structured()` in `lib/llm.ts` with a `task` name, and its caller reports what became of the output with `kept()`, `partly()`, `discarded()` or `pieces()`. That is what `/quality` counts, so a new call site needs both. Text the model wrote carries a `log_id` to the page, which shows `<Feedback id={...} />` under it.

Before changing a prompt, a schema or a check, run `npm run eval` with `ANTHROPIC_API_KEY` set, make the change, and run it again. Nothing that passed before may fail. Add a case to `evals/cases.ts` for whatever the change was meant to fix, then save the new baseline with `npm run eval -- --save` and commit `evals/baseline.json`. Without a key only the guard cases run: they test the checks, not the prompts.

The log holds what people typed. Keep it server-only, and keep the recent-calls list on `/quality` behind a signed-in account.

## The data pipeline

Generated data is committed so builds need no network. Re-run the importers after changing a source file or a review decision, in this order:

1. `npm run fetch:federal`, `fetch:gsa`, `fetch:rosters` download sources (these need network access to their hosts).
2. `npm run import:coops` builds the co-op directory (`seed/coops/directory.json.gz`, `insights.json`).
3. `npm run import:price-files` reads item price files into `seed/catalog/price-rows.json`. PDFs need `pdftotext` (poppler-utils). SitOnIt's 43 MB book is downloaded into a gitignored cache when missing.
4. `npm run import:njstart` rebuilds NJSTART's records from `seed/catalog/source/njstart/` (pass the unzipped folder of a new NJSTART export to read it in first).
   `npm run import:hawaii` rebuilds Hawaii's records from `seed/catalog/source/hawaii/` (a new download goes through `--read`, a review, then `--collect`; see the README).
   `npm run import:arkansas` rebuilds Arkansas's records from `seed/catalog/source/arkansas/` (a new download goes through `--read`, a review, `--collect` and `--prices`; see the README).
   `npm run import:epc` rebuilds Empire Procure Connect's records from `seed/catalog/source/epc/` (a new download goes through `--read`).
   `npm run import:ny` rebuilds New York's records from `seed/catalog/source/ny/` (a new download goes through `--read`).
5. `npm run import:catalog-coops` builds the co-op catalog (`seed/catalog/catalog.json.gz`) and attaches the price rows.
6. `npm run import:state-rules` builds `lib/state-rules.json` from `seed/states/source/`.

**AI review.** Judgments too fuzzy for rules go through a review loop:

1. The importers write tasks to `seed/cleanup/tasks/`, each with real candidates.
2. `scripts/cleanup/prepare-shards.ts` splits them into batches.
3. Review agents write answers to `seed/cleanup/out/`.
4. `scripts/cleanup/collect.ts` checks every answer and writes `seed/cleanup/decisions/`, which is committed.
5. `scripts/cleanup/audit.ts` prints a sample for a person to check.

The importers apply only high- and medium-confidence decisions.

## Data rules

- Never invent a price. Every price must appear in the line it was read from (the importers enforce this). Keep each price's vintage, and label what it is: awarded bid, base price or list price. A list price is never shown as a contract price.
- Keep discounts out until the product decision is made (see `HANDOFF.md`).
- Drop personal contact details (officials' names, phone numbers, emails, street addresses) from every public dataset.
- Respect each site's robots rules and bot walls. OMNIA Partners' robots.txt disallows ClaudeBot. TIPS sits behind a Cloudflare challenge. GSA Advantage disallows `/advantage/rs/`. Files from those sites come in only when a person downloads them.
- Real data and demo data stay labelled: Riverbend, Cedar Bend and Harmon Lake are fictional, and the demo suppliers' verification results are marked as demo.
- State rules are research findings with source flags (`[mirror]`, `[secondary]`, …), not legal advice. Keep the flags visible.

## Shipping

- The site runs on Railway, which auto-deploys `main` (at `agora.ethoslabs.us`; Railway's own address is `riverbend-storefront-production.up.railway.app`). Check deploys with the Railway tools; the deployment's status should read SUCCESS.
- Each shipped batch: typecheck, build and rehearse, update the README (and `/data` when numbers change), commit, open a PR, merge, confirm the deploy, and run `npm run smoke -- https://agora.ethoslabs.us`.
- Don't put model names or IDs in commits, PRs or code.
- In cloud sessions, outbound hosts are allowlisted per environment. A refused connection usually means the host needs adding.

## Writing

Copy and docs are plain and direct, in prose, with numbers that come from the data files rather than being typed by hand where the page can read them.
