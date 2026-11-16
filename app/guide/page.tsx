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

/** The state programs, in the order their states were loaded. */
const ci = catalogInsights;
const STATE_PROGRAMS = [
  { name: "NJSTART", who: "New Jersey's state contracts", d: ci.njstart },
  { name: "Hawaii SPO", who: "Hawaii State Procurement Office price and vendor lists", d: ci.hawaii },
  { name: "Arkansas OSP", who: "Arkansas Office of State Procurement statewide contracts", d: ci.arkansas },
  { name: "NYS OGS", who: "New York Office of General Services centralized contracts", d: ci.new_york },
  { name: "Empire Procure Connect", who: "New York counties' cooperative", d: ci.epc },
  { name: "OregonBuys", who: "Oregon DAS statewide price agreements", d: ci.oregon },
];
const STATE_NAMES = new Set([...STATE_PROGRAMS.map((p) => p.name), "NY Preferred Source"]);
const coops = ci.per_coop.filter((p) => !STATE_NAMES.has(p.coop) && p.contracts > 0).sort((a, b) => b.contracts - a.contracts);
const coopContracts = coops.reduce((s, p) => s + p.contracts, 0);
const programCount = ci.per_coop.filter((p) => p.contracts > 0).length;
/** A program's page. The catalog id settles on the page's own slug. */
const programHref = (name: string) => `/programs/${ci.per_coop.find((p) => p.coop === name)?.coop_id ?? ""}`;
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
        Type it on the <Link href="/" className={link}>home page</Link> the way it would be said aloud: {EXAMPLES.slice(0, 3).map((e) => `“${e}”`).join(", ")}. Searching is free and needs
        no account.
      </>,
    ],
    [
      "Answer a few questions",
      <>
        For a product, Loci asks who is buying, how many, and then what separates the products it found: a price band, a maker, a spec such as “Which cab?”. Each answer narrows the
        shortlist, and what the request already says is read into filters that can be removed: “{EXAMPLES.find((e) => /\bno\b/i.test(e)) ?? "crew cab pickups, no diesel"}” rules diesel
        out. Software, services and construction skip this and go straight to results. Naming the agency is optional, but without one Loci shows who each contract is open to and marks
        eligibility “Not checked”.
      </>,
    ],
    [
      "Check how Loci read it",
      <>
        A “Read as” line says what Loci took the request to mean. A few seconds after the shortlist appears, each of the leading products is marked Fits, Partly fits or Doesn&apos;t fit,
        with a short reason, and the ones that don&apos;t fit are set aside under a line that opens to show why. What the agency can buy today comes first, then the product that is the
        thing asked for, then the agency&apos;s own state contract ahead of a co-op&apos;s.
      </>,
    ],
    [
      "Read the recommended route",
      <>
        The results page opens with the request as fields, then one recommended route: the supplier, the contract it is bought under, the price, whether the agency may use it, how it is
        paid for, and the lead time. A “Not known” line says what the data does not hold.
      </>,
    ],
    [
      "Compare the other options",
      <>
        Every priced option is in one table below the recommendation, in ranked order. Further down, folded to a row each, are co-op contracts, contracts that cover the purchase but have
        no prices on file, other states&apos; contracts, and contracts not open to the agency. A request for a service also lists the suppliers that say they offer it where the agency is.
      </>,
    ],
    [
      "Buy, or send it on",
      <>
        Anyone can fill a cart. Under the agency&apos;s quick-buy limit an order checks out on a P-card. At or over it, the cart goes to purchasing for approval as a purchase order. A cart can also be handed to
        someone who is allowed to buy. A co-op contract is ordered on the co-op&apos;s own site, which Loci links to. When nothing fits, Loci offers a quote under a contract the agency
        can already use, quotes from a few suppliers, or a solicitation, in that order. Checking out asks for an account, and the cart carries over to it.
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
        intro={<p>A purchase takes six steps, and most of the work is in the first. The clearer the request, the fewer options there are to weigh.</p>}
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
          There are other ways in. <Link href="/browse" className={link}>Browse</Link> lists the catalog by category. <Link href="/programs" className={link}>Programs</Link> has a page
          for each of the {programCount} purchasing programs Loci holds, state programs first. <Link href="/contracts" className={link}>Contracts</Link> searches every contract, each with
          its own page: who can use it, how to buy under it, and what its documents say. <Link href="/storefronts" className={link}>Storefronts</Link> lists every supplier. Under Shopper,{" "}
          <Link href="/quote-check" className={link}>Check a quote</Link> compares a vendor&apos;s quote line by line with the prices on file, and{" "}
          <Link href="/ask" className={link}>Ask a contract</Link> answers a question from a contract&apos;s own documents.
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
                A contract a state awarded and opened to its local governments. Loci holds the state contracts of {trxStates}, and shows them first to buyers in those states.
              </>,
            ],
            [
              "Co-op contract",
              "A contract awarded by a purchasing cooperative, such as Sourcewell or NASPO ValuePoint, for its members to share. The co-op ran the competition, so a member can buy without bidding again where its state allows.",
            ],
            [
              "TRX",
              "The label on state contracts in the states above. They are the route Loci prefers: the state has already competed them for its local governments.",
            ],
            [
              "Participating addendum",
              "The agreement by which a state adopts a NASPO ValuePoint contract. An agency uses a NASPO contract through its state's addendum, so a contract with none for that state reads “Needs a state addendum”.",
            ],
            ["GSA schedule", "A federal contract. State and local governments may use one only for the categories GSA opens to them."],
            ["Reseller", "A vendor authorized to sell under a master agreement someone else holds. Reseller options are listed last, after agency, state and co-op routes."],
            ["No approval needed", "A supplier with no contract, for purchases small enough that the agency's rules ask for none."],
            ["Piggybacking", "Buying on a contract another government awarded. It is allowed only when that contract says so and the buyer's state permits it."],
            ["Solicitation", "A new competition (a bid or an RFP), run when nothing on contract fits. It is the slowest route and is offered last."],
            [
              "Program",
              <>
                Whoever awarded a shared contract: a state&apos;s purchasing office or a co-op. Each of the {programCount} in Loci has a <Link href="/programs" className={link}>page</Link>{" "}
                built from its contracts. Nobody claims or pays for one.
              </>,
            ],
            ["City marketplace", "Loci set up for one agency's staff, with its own contracts, rules and approvals. Riverbend's is the one shown, and Riverbend is fictional."],
            [
              "Storefront",
              "A supplier's page: its catalog, the contracts it sells through, its certifications and reviews. Loci builds one from public contracts, and the supplier can claim it with a work email on the company's own domain; any other email waits for review.",
            ],
            [
              "Service listing",
              "What a supplier adds to a claimed storefront so it can be found without a catalog or a co-op contract: the services it offers, the counties it works in, the public work it has done and the certifications it claims. It is free for now.",
            ],
          ]}
        />
        <Terms
          title="Eligibility and paying"
          note="These appear in the Eligibility and Requirement columns of the options table."
          terms={[
            ["Eligible", "The agency may use the contract: it is the agency's own, its state's, or a co-op's that the agency is on."],
            ["Membership required", "The contract belongs to a co-op the agency is not known to be on. Loci can send purchasing a request to join. Elsewhere this reads “Join to use”."],
            [
              "Detected membership",
              "A co-op membership Loci found by matching the agency to a co-op's member list. It counts right away, and purchasing can confirm it, remove it or add one by hand.",
            ],
            ["Not checked", "No agency is selected, so Loci cannot say who may use the contract."],
            ["Quick-buy limit", "The amount under which the agency lets staff buy without a purchase order. Each agency sets its own; where Loci does not know it, a typical one is used."],
            ["P-card", "A purchasing card: the agency's credit card, used for orders under the quick-buy limit."],
            ["Purchase order", "The agency's formal order to a supplier, approved by purchasing. Orders over the quick-buy limit need one."],
            ["Co-op order", "An order placed on the co-op's own site. Loci does not sell through a co-op's contracts unless the co-op has agreed to it; it links to the contract there."],
            ["By quote", "The contract covers the purchase but publishes no price, so the supplier quotes one under the contract."],
            ["Purchase file", "The record of a request, kept beside the results: what was asked for, the options considered, the route chosen and why, and what is outstanding. It downloads as a text file."],
          ]}
        />
        <Terms
          title="Prices"
          note="Every price Loci shows was read from a published line, and is labelled with what kind of price it is. Loci never estimates one."
          terms={[
            ["Awarded bid", "The price a supplier bid and a government accepted. On vehicles it is a base price: the base model, which options add to."],
            ["Contract price", "A price stated in the contract or its price sheet. A contract net price is the price after the contract's discount, as the document prints it."],
            ["Not-to-exceed rate", "A ceiling. The supplier may charge less, never more."],
            ["List price", "The supplier's catalog price before the contract's discount. It is a ceiling, shown as a list price and never as what a buyer pays. Loci does not show discount percentages."],
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
            [
              "Read as",
              "Loci's one-line reading of a request, in the catalog's own terms. It lets a request find products that share no word with it: “something for kids to climb on at the park” finds climbers.",
            ],
            [
              "Fits, Partly fits, Doesn't fit",
              "A model's judgment of whether a product is the thing asked for, with a reason. It is made from the product's name, kind, maker, unit and specs, never its price. Products that don't fit are set aside, one click away, not removed.",
            ],
            [
              "Specs",
              "A product's attributes as its own record prints them: fuel, cab, seats, size, capacity, material and so on. A fuel or drivetrain worked out from an engine or model name is marked “from the model name”. Many products print none.",
            ],
            [
              "Fit score",
              "How much of the request an option covers, from 0 to 100. Words in its name count most, and rarer words weigh more. A priced option has to share a word for the thing asked for, not only for the kind of work. Sponsorship never changes it.",
            ],
            ["Research lead", "A real contract whose current terms Loci has not confirmed against a source document. It is shown as a lead to follow up, not as a checked record."],
            ["NIGP code", "The commodity code governments use to classify what they buy. Loci uses it to match a request to contracts."],
            [
              "Verified",
              "A supplier whose checks were all run and passed: SAM.gov registration and exclusions, Section 889, insurance and each certification. Only the fictional demo suppliers carry results, marked as demo. Real companies show every check as not checked yet.",
            ],
            [
              "Self-reported, Confirmed",
              "On a supplier's certification. Every one starts as the supplier's own claim. Texas's small business flag and VetHUB certification can be checked against the Comptroller's directory, and read Confirmed, Not on the registry, Company not found or Registry not reached, with the date. Only a confirmed one counts toward badges and ranking.",
            ],
            [
              "Past public work",
              "Work a supplier says it did for a government. Loci matches the government's name to its directory, which shows the government exists, not that the work happened. One it cannot match reads “Not found in Loci's directory”.",
            ],
            [
              "Sponsored",
              "A listing its supplier paid to place. It is always labelled. It can move a listing up among contracts of its own kind, and never changes a fit score or who may use a contract. Co-ops cannot buy placement.",
            ],
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
          and link to {n(ci.documents.total)} contract documents. Each program has its own page, linked below: how a local government buys through it, what is on contract, and
          every contract, searchable.
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
                    <Link href={programHref(p.name)} className={link}>
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
          {n(coopContracts)} contracts from {coops.length} co-ops, read from the contract lists each publishes:{" "}
          {coops.map((c, i) => (
            <span key={c.coop}>
              {i > 0 && (i === coops.length - 1 ? " and " : ", ")}
              <Link href={programHref(c.coop)} className={link}>
                {c.coop}
              </Link>{" "}
              ({n(c.contracts)})
            </span>
          ))}
          . Where a co-op&apos;s site bars automated readers, its files come in only when a person downloads them.
        </p>

        <h3 className="mt-8 text-ui-md font-bold text-ink">Products and prices</h3>
        <p className="mt-1 max-w-[72ex] text-ui-xs text-base-darker">
          Loci read {n(ci.stash.before.products)} products from those contracts&apos; price files and line items, and serves {n(ci.products.products)} of them. A product is served when it
          has a price, a name that says what it is, and is bought by the unit. The other {n(ci.stash.products)} are held back: items with no published price, parts and accessories, and
          hourly or monthly rates. A service sold as a fixed package counts as a product. Served products were also read for what kind of thing each is and for their specs, with a value
          kept only when the product&apos;s own record prints it.
        </p>

        <h3 className="mt-8 text-ui-md font-bold text-ink">Suppliers</h3>
        <p className="mt-1 max-w-[72ex] text-ui-xs text-base-darker">
          A supplier's storefront is built from the public contracts it holds. What a supplier adds after claiming it, a description, a service listing, its
          certifications, is the supplier&apos;s own statement unless a registry confirms it.
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
          Riverbend, Cedar Bend and Harmon Lake are fictional agencies, with fictional contracts, suppliers, orders and spending, so the buying steps can be shown end to end. So is
          Bluebonnet Pane Window Care, the supplier that shows a service listing. They are labelled as demo wherever they appear.
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
          <Question q="Is an account needed?">
            <p>
              Not to search, set an agency, use the Shopper tools, draft paperwork or fill a cart. The cart is kept in the browser until checkout, which asks for an account and moves the
              cart to it. An account is needed for anything that keeps a record for a person or an agency: orders, quote requests, asking purchasing about a co-op, solicitations, uploads,
              and the purchasing and supplier pages.
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
          <Question q="Why is a product marked “Doesn’t fit”, or set aside?">
            <p>
              Matching by words alone brings in near misses: a sedan when a police SUV was asked for. A model reads the leading products against the request and says
              which are the thing asked for, with a reason. It does not see prices, so a verdict is never about cost. Products it sets aside stay one click away, and each verdict has a
              thumbs up and down for when it is wrong.
            </p>
          </Question>
          <Question q="How does a small supplier get found?">
            <p>
              By claiming its storefront and adding a service listing: the services it offers, the counties it works in, its past public work and its certifications. A request for that
              service from an agency in those counties, or one that names the region, then lists the supplier on the results page. Suppliers with registry-confirmed certifications and
              matched past work nearby come first. The listing is free for now.
            </p>
          </Question>
          <Question q="Where does AI come in?">
            <p>
              A model reads a request into fields and into the catalog&apos;s terms, judges whether each leading product fits, words the buying plan, answers questions about a purchase or
              a contract, reads quotes and scanned documents, and reviews data judgments too fuzzy for rules, such as whether a line is a product or a part. Prices, eligibility and the
              route come from rules and published data, and the model cannot take an action.
              Each answer is checked before it is shown: one that states a figure the data does not hold, or misquotes a contract, is discarded. Text a model wrote has a thumbs up and
              down under it, and the <Link href="/quality" className={link}>AI quality page</Link> counts what was kept and what was thrown away.
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
          <Question q="What does Loci cost?">
            <p>
              Searching is free. An agency pays a subscription for its own city marketplace, and a supplier pays for a fuller storefront or a sponsored placement.{" "}
              <Link href="/model" className={link}>How Loci earns</Link> sets out each one.
            </p>
          </Question>
        </div>
      </Section>
    </div>
  );
}
