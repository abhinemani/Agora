// Guide: how to use Loci, what its terms mean, where its data comes from, and the
// questions people ask first. Written for a buyer, not a researcher: /data has the
// full account. Every count is read from the data files, never typed in.

import type { Metadata } from "next";
import Link from "next/link";
import { EXAMPLES } from "@/lib/front-door";
import { allStateRules, STATE_RULES_RESEARCHED } from "@/lib/state-rules";
import { TRX_STATES, stateLabel } from "@/lib/trx";
import insights from "@/seed/coops/insights.json";
import catalogInsights from "@/seed/catalog/insights.json";

export const metadata: Metadata = {
  title: "Guide · Loci",
  description: "How to use Loci, what its terms mean, where its contracts and prices come from, and answers to common questions.",
};

const n = (x: number) => x.toLocaleString("en-US");
const date = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
const list = (xs: string[]) => (xs.length <= 2 ? xs.join(" and ") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);

/** The state programs, in the order their states were loaded. `anchor` is the section of /data that describes each. */
const ci = catalogInsights;
const STATE_PROGRAMS = [
  { name: "NJSTART", who: "New Jersey's state contracts", anchor: "njstart", d: ci.njstart },
  { name: "Hawaii SPO", who: "Hawaii State Procurement Office price and vendor lists", anchor: "hawaii", d: ci.hawaii },
  { name: "Arkansas OSP", who: "Arkansas Office of State Procurement statewide contracts", anchor: "arkansas", d: ci.arkansas },
  { name: "NYS OGS", who: "New York Office of General Services centralized contracts", anchor: "new-york", d: ci.new_york },
  { name: "Empire Procure Connect", who: "New York counties' cooperative", anchor: "empire-procure-connect", d: ci.epc },
  { name: "OregonBuys", who: "Oregon DAS statewide price agreements", anchor: "oregon", d: ci.oregon },
];
const STATE_NAMES = new Set([...STATE_PROGRAMS.map((p) => p.name), "NY Preferred Source"]);
const coops = ci.per_coop.filter((p) => !STATE_NAMES.has(p.coop) && p.contracts > 0).sort((a, b) => b.contracts - a.contracts);
const coopContracts = coops.reduce((s, p) => s + p.contracts, 0);
const stateContracts = ci.per_coop.filter((p) => STATE_NAMES.has(p.coop)).reduce((s, p) => s + p.contracts, 0);

function Section({ id, title, intro, children }: { id: string; title: string; intro: React.ReactNode; children?: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-24 border-t border-base-lighter pt-10">
      <h2 className="font-heading text-heading-md font-bold text-ink">{title}</h2>
      <div className="mt-3 max-w-[72ex] space-y-3 text-body-sm text-base-darker">{intro}</div>
      {children && <div className="mt-6">{children}</div>}
    </section>
  );
}

function Terms({ title, note, terms }: { title: string; note: string; terms: [string, React.ReactNode][] }) {
  return (
    <div className="mt-8 first:mt-0">
      <h3 className="text-ui-md font-bold text-ink">{title}</h3>
      <p className="mt-1 max-w-[72ex] text-ui-xs text-base-dark">{note}</p>
      <dl className="mt-3 border border-base-light bg-white">
        {terms.map(([term, means]) => (
          <div key={term} className="grid gap-x-6 gap-y-1 border-b border-base-lighter px-4 py-3 last:border-b-0 sm:grid-cols-[200px_minmax(0,1fr)]">
            <dt className="text-ui-xs font-bold text-ink">{term}</dt>
            <dd className="max-w-[68ex] text-ui-xs leading-relaxed text-base-darker">{means}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function Question({ q, children }: { q: string; children: React.ReactNode }) {
  return (
    <details className="group border-b border-base-lighter last:border-b-0">
      <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-4 px-4 py-3 text-body-sm font-bold text-ink hover:bg-base-lightest [&::-webkit-details-marker]:hidden">
        {q}
        <span aria-hidden className="shrink-0 font-mono text-base-dark group-open:hidden">+</span>
        <span aria-hidden className="hidden shrink-0 font-mono text-base-dark group-open:inline">−</span>
      </summary>
      <div className="max-w-[72ex] space-y-3 px-4 pb-4 text-body-sm text-base-darker">{children}</div>
    </details>
  );
}

const link = "font-bold text-primary";

export default function GuidePage() {
  const rules = allStateRules();
  const tiers = [5, 4, 3, 2, 1].map((t) => ({ t, count: rules.filter((r) => r.tier === t).length, label: rules.find((r) => r.tier === t)?.tier_label ?? "" }));
  const trxStates = list(TRX_STATES.map(stateLabel).sort());
  const steps: [string, React.ReactNode][] = [
    [
      "Say what the agency needs",
      <>
        Type it on the <Link href="/" className={link}>home page</Link> the way it would be said aloud: {EXAMPLES.slice(0, 3).map((e) => `“${e}”`).join(", ")}. For a product, Loci asks a few
        questions to narrow it down before searching. Software, services and construction go straight to results.
      </>,
    ],
    [
      "Choose the agency",
      <>
        Pick it under <strong>Your agency</strong> in the menu, or when the results ask. Loci needs it to check which co-ops the agency is on and what its state allows. Without one, eligibility
        reads “Not checked”.
      </>,
    ],
    [
      "Read the recommended route",
      <>
        The results page opens with the request as Loci understood it, then one recommended route: the contract to buy on, the price, whether the agency may use it, and how the purchase is
        paid for.
      </>,
    ],
    [
      "Compare the other options",
      <>
        Every priced option is in one table below the recommendation, in ranked order. Further down, folded, are contracts that cover the purchase but publish no price, other states&apos;
        contracts, and co-ops the agency would have to join.
      </>,
    ],
    [
      "Buy, or send it on",
      <>
        Under the agency&apos;s quick-buy limit an order checks out on a P-card. Over it, Loci starts a purchase order for purchasing to approve. A co-op order is placed on the co-op&apos;s
        own site, and a contract with no price on file starts with a quote request. The purchase file on the results page records what was considered and why.
      </>,
    ],
  ];

  return (
    <div className="mx-auto max-w-4xl space-y-10">
      <div>
        <h1 className="font-heading text-heading-xl font-bold text-ink">Guide</h1>
        <div className="mt-3 max-w-[68ex] space-y-3 text-body-md text-base-darker">
          <p>
            Loci answers one question for a local government: what is the easiest lawful way to buy this? It searches the agency&apos;s own contracts, its state&apos;s contracts and the
            national co-ops together, and says which of them the agency may use.
          </p>
          <p>
            This page explains how to use it, what its words mean, where its contracts and prices come from, and what it does not know. Loci is a prototype, so the last part matters.
          </p>
        </div>
        <nav className="mt-5 flex flex-wrap gap-x-4 gap-y-1 text-ui-xs" aria-label="On this page">
          {[
            ["#how", "How to use Loci"],
            ["#terms", "What the terms mean"],
            ["#sources", "Where the data comes from"],
            ["#questions", "Questions"],
          ].map(([href, label]) => (
            <a key={href} href={href} className={link}>
              {label}
            </a>
          ))}
        </nav>
      </div>

      <Section
        id="how"
        title="How to use Loci"
        intro={<p>A purchase takes five steps, and most of the work is in the first. The clearer the request, the fewer options there are to weigh.</p>}
      >
        <ol className="border border-base-light bg-white">
          {steps.map(([title, body], i) => (
            <li key={title} className="grid grid-cols-[2.5rem_minmax(0,1fr)] gap-x-3 border-b border-base-lighter px-4 py-4 last:border-b-0">
              <span className="font-mono text-ui-xs font-bold text-primary">{String(i + 1).padStart(2, "0")}</span>
              <div>
                <div className="text-body-sm font-bold text-ink">{title}</div>
                <p className="mt-1 max-w-[68ex] text-ui-xs leading-relaxed text-base-darker">{body}</p>
              </div>
            </li>
          ))}
        </ol>
        <p className="mt-4 max-w-[72ex] text-ui-xs text-base-dark">
          There are other ways in. <Link href="/browse" className={link}>Browse</Link> lists products by category, <Link href="/contracts" className={link}>Contracts</Link> is the register of
          every contract Loci holds, and <Link href="/quote-check" className={link}>Quote check</Link> compares a vendor&apos;s quote with prices on contract.
        </p>
      </Section>

      <Section
        id="terms"
        title="What the terms mean"
        intro={
          <p>
            Public purchasing has its own vocabulary, and Loci adds a little of its own. The terms are grouped by where they appear: the routes a purchase can take, whether an agency may use
            one, what a price is, and how sure Loci is of what it says.
          </p>
        }
      >
        <Terms
          title="Routes"
          note="A route is the way a purchase is made: whose contract it rides on. Each option in the results is labelled with one."
          terms={[
            ["Agency contract", "A contract the agency awarded itself. It is the simplest route, since the agency already competed it."],
            [
              "State contract",
              <>
                A contract a state awarded and opened to its local governments. For buyers in {trxStates}, Loci holds the state&apos;s own contracts and shows them ahead of co-op contracts.
              </>,
            ],
            [
              "Co-op contract",
              "A contract awarded by a purchasing cooperative, such as Sourcewell or NASPO ValuePoint, for its members to share. The co-op ran the competition, so a member can buy without bidding again where its state allows.",
            ],
            ["GSA schedule", "A federal contract. State and local governments may use one only for the categories GSA opens to them."],
            ["Reseller", "A vendor authorized to sell under a larger master agreement held by someone else."],
            ["No approval needed", "A purchase small enough that the agency's rules ask for no contract at all."],
            ["Piggybacking", "Buying on a contract another government awarded. It is allowed only when that contract says so and the buyer's state permits it."],
            ["Solicitation", "A new competition (a bid or an RFP), run when nothing on contract fits. It is the slowest route and is offered last."],
          ]}
        />
        <Terms
          title="Eligibility and paying"
          note="These appear in the Eligibility and Requirement columns of the options table."
          terms={[
            ["Eligible", "The agency may use the contract: it is the agency's own, its state's, or a co-op's that the agency is on."],
            ["Membership required", "The contract belongs to a co-op the agency is not known to be on. Joining most co-ops is free, but it is a step purchasing has to take."],
            ["Not checked", "No agency is selected, so Loci cannot say who may use the contract."],
            ["Quick-buy limit", "The amount under which the agency lets staff buy without a purchase order. Each agency sets its own."],
            ["P-card", "A purchasing card: the agency's credit card, used for orders under the quick-buy limit."],
            ["Purchase order", "The agency's formal order to a supplier, approved by purchasing. Orders over the quick-buy limit need one."],
            ["Co-op order", "An order placed on the co-op's own site, not in Loci. Loci links to the contract there."],
            ["By quote", "The contract covers the purchase but publishes no price, so the supplier quotes one under the contract."],
          ]}
        />
        <Terms
          title="Prices"
          note="Every price Loci shows was read from a published line, and is labelled with what kind of price it is. Loci never estimates one."
          terms={[
            ["Awarded bid", "The price a supplier bid and a government accepted. It is what a buyer on that contract pays."],
            ["Contract price", "A price stated in the contract or its price sheet. A contract net price is the price after the contract's discount, as the document prints it."],
            ["Not-to-exceed rate", "A ceiling. The supplier may charge less, never more."],
            ["List price", "The supplier's catalog price before any contract discount. It is shown as a list price and never as what a buyer pays."],
            ["Reference price", "A price shown for comparison on a route that buys by quote. The quote sets the real one."],
            ["Vintage", "When and where a price was published: the price file or contract it was read from, and its date."],
          ]}
        />
        <Terms
          title="How sure Loci is"
          note="Loci labels what it knows by how it knows it."
          terms={[
            [
              "Membership evidence",
              "What a co-op membership rests on, weakest to strongest: the agency is on the co-op's published roster; the agency's own procurement page names the co-op; a published purchase shows the agency bought through it. Purchasing confirming a membership by hand overrides all three.",
            ],
            [
              "State rule tier",
              <>
                How freely a state lets its local governments use co-op contracts, from 1 to 5: {tiers.map((t) => `${t.t}, ${t.label.charAt(0).toLowerCase()}${t.label.slice(1)} (${t.count} states)`).join("; ")}.
              </>,
            ],
            [
              "[mirror], [secondary], [unverified]",
              "Flags on a state rule that say how well it was sourced: read on a third-party site and not the official code; taken from a league, law firm or vendor; or not confirmed in anything read. “Currency unconfirmed” means the text may have been amended since.",
            ],
            ["NIGP code", "The commodity code governments use to classify what they buy. Loci uses it to match a request to contracts."],
            ["Verified", "A supplier whose registration and certifications were checked. In this prototype the demo suppliers' checks are simulated and marked as demo."],
            ["Sponsored", "A listing its supplier paid to place. It is always labelled."],
          ]}
        />
      </Section>

      <Section
        id="sources"
        title="Where the data comes from"
        intro={
          <>
            <p>
              Everything real in Loci was published by a government or a co-op, and was collected between {date(insights.retrieved)} and {date(ci.oregon.retrieved)}. There are four bodies
              of it: state contracts, co-op contracts, co-op member lists, and state law. The <Link href="/data" className={link}>co-op data page</Link> gives the full account of each, with
              its gaps.
            </p>
          </>
        }
      >
        <h3 className="text-ui-md font-bold text-ink">State contracts</h3>
        <p className="mt-1 max-w-[72ex] text-ui-xs text-base-darker">
          {n(stateContracts)} contracts from the programs below, read from each state&apos;s own site. They carry {n(STATE_PROGRAMS.reduce((s, p) => s + p.d.priced_lines, 0))} priced lines
          and link to {n(ci.documents.total)} contract documents.
        </p>
        <div className="mt-3 overflow-x-auto border border-base-light bg-white">
          <table className="w-full min-w-[560px] text-left text-ui-xs">
            <thead className="bg-base-lightest text-ui-3xs uppercase tracking-label text-base-dark">
              <tr>
                <th className="px-3 py-2 font-bold">Program</th>
                <th className="px-3 py-2 text-right font-bold">Contracts</th>
                <th className="px-3 py-2 text-right font-bold">Priced lines</th>
                <th className="px-3 py-2 font-bold">Read on</th>
              </tr>
            </thead>
            <tbody>
              {STATE_PROGRAMS.map((p) => (
                <tr key={p.name} className="border-t border-base-lighter align-top">
                  <td className="px-3 py-2">
                    <Link href={`/data#${p.anchor}`} className={link}>
                      {p.name}
                    </Link>
                    <div className="text-ui-3xs text-base-dark">{p.who}</div>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-ink">{n(p.d.contracts)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-ink">{p.d.priced_lines ? n(p.d.priced_lines) : "None published"}</td>
                  <td className="px-3 py-2 text-base-darker">{date(p.d.retrieved)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <h3 className="mt-8 text-ui-md font-bold text-ink">Co-op contracts</h3>
        <p className="mt-1 max-w-[72ex] text-ui-xs text-base-darker">
          {n(coopContracts)} contracts from {coops.length} co-ops, read from the contract lists each publishes: {list(coops.map((c) => `${c.coop} (${n(c.contracts)})`))}. Where a co-op&apos;s
          site bars automated readers, its files come in only when a person downloads them.
        </p>

        <h3 className="mt-8 text-ui-md font-bold text-ink">Products and prices</h3>
        <p className="mt-1 max-w-[72ex] text-ui-xs text-base-darker">
          Loci read {n(ci.stash.before.products)} products from those contracts&apos; price files and line items, and serves {n(ci.products.products)} of them. A product is served when it
          has a price, a name that says what it is, and is bought by the unit. The other {n(ci.stash.products)} are held back: items with no published price, parts and accessories, and
          hourly or monthly rates.
        </p>

        <h3 className="mt-8 text-ui-md font-bold text-ink">Who is on which co-op</h3>
        <p className="mt-1 max-w-[72ex] text-ui-xs text-base-darker">
          {n(insights.workbook.roster_rows)} membership listings from the co-ops&apos; published rosters, joined to the Census of Governments and the federal school and college registries.
          The result is a directory of {n(insights.directory.governments)} governments, {n(insights.directory.on_a_roster)} of them on at least one roster. This is how Loci knows an
          agency&apos;s co-ops without asking.
        </p>

        <h3 className="mt-8 text-ui-md font-bold text-ink">What state law allows</h3>
        <p className="mt-1 max-w-[72ex] text-ui-xs text-base-darker">
          A reading of all {rules.length} states&apos; cooperative purchasing statutes and bid thresholds, researched {date(STATE_RULES_RESEARCHED)}. These are research findings with their
          source flags left on, not legal advice. The <Link href="/data#states" className={link}>full table</Link> is on the co-op data page.
        </p>

        <h3 className="mt-8 text-ui-md font-bold text-ink">What is not real</h3>
        <p className="mt-1 max-w-[72ex] text-ui-xs text-base-darker">
          Riverbend, Cedar Bend and Harmon Lake are fictional agencies, with fictional contracts, suppliers, orders and spending, so the buying steps can be shown end to end. They are
          labelled as demo wherever they appear.
        </p>
      </Section>

      <Section
        id="questions"
        title="Questions"
        intro={<p>The ones that come up first. Most have the same answer underneath: Loci shows what was published and says so when nothing was.</p>}
      >
        <div className="border border-base-light bg-white">
          <Question q="Can orders really be placed here?">
            <p>
              Not yet. Loci is a prototype. The contracts, prices, member lists and state rules are real public records, but the cart, checkout and approvals run against fictional demo
              agencies, and no order reaches a supplier.
            </p>
          </Question>
          <Question q="Does “Eligible” mean the agency is cleared to buy?">
            <p>
              It means Loci found no barrier: the contract is open to the agency, and the agency is on the co-op where one is involved. The agency&apos;s own purchasing rules and its
              state&apos;s law still apply, and the state rule note on the results page says what that law asks. Purchasing has the final word.
            </p>
          </Question>
          <Question q="How does Loci know which co-ops an agency is on?">
            <p>
              From the rosters co-ops publish, agencies&apos; own procurement pages, and published purchases. Each membership shows the strongest evidence behind it. A roster listing shows
              the agency registered, not that it buys that way, and a co-op with no public roster cannot be detected at all. Purchasing can confirm or correct memberships.
            </p>
          </Question>
          <Question q="Why does a contract show no price?">
            <p>
              Because none was published. Many co-op and state contracts print a discount, a placeholder or nothing, and keep prices in a quote. Loci never fills the gap with an estimate. It
              lists the contract as covering the purchase and offers a quote request.
            </p>
          </Question>
          <Question q="How current are the prices?">
            <p>
              Each price carries its vintage: the file or contract it was read from and the date. The state programs were last read on {date(ci.njstart.retrieved)}. Prices are not refreshed
              live, so a supplier&apos;s current price may differ; the linked contract or price sheet is the authority.
            </p>
          </Question>
          <Question q="Why are some co-ops thin, or missing?">
            <p>
              Loci follows each site&apos;s rules for automated readers. Some co-ops bar them or sit behind a challenge page, so their files are added only when a person downloads them.
              Others publish contract lists but keep prices behind a member login. GSA&apos;s schedule contracts are held but not served.
            </p>
          </Question>
          <Question q="Why does a state contract come first?">
            <p>
              For buyers in {trxStates}, the state&apos;s own contracts lead when they fit the request about as well as the best co-op contract. The state already competed them for its local
              governments, and using one takes the fewest steps. Every other option is still in the table.
            </p>
          </Question>
          <Question q="Where does AI come in?">
            <p>
              A model reads the request into fields, reads scanned contract documents, answers questions about a contract, and reviews data judgments too fuzzy for rules, such as whether a
              line is a product or a part. It never sets a price or decides eligibility; rules and published data do. Text a model wrote has a thumbs up and down under it, and the{" "}
              <Link href="/quality" className={link}>AI quality page</Link> counts how often its output is kept.
            </p>
          </Question>
          <Question q="Is the state rule note legal advice?">
            <p>
              No. It is a research summary of each state&apos;s statutes, with flags showing where a finding rests on a secondary source or could not be confirmed. An agency&apos;s attorney
              or purchasing officer should confirm anything a purchase depends on.
            </p>
          </Question>
          <Question q="Does Loci publish people's contact details?">
            <p>
              Officials&apos; names, phone numbers, emails and addresses are removed from the member lists and contract records. The one exception is the text of contract documents
              themselves, which keeps the contacts it prints so a buyer can reach the contract manager.
            </p>
          </Question>
          <Question q="How does Loci make money?">
            <p>
              Through subscriptions, supplier fees and fees on spend. Sponsored listings are labelled. <Link href="/model" className={link}>How Loci earns</Link> sets out each one.
            </p>
          </Question>
        </div>
      </Section>
    </div>
  );
}
