// Co-op data: what the public cooperative purchasing workbook holds, how Agora
// uses it, what to be careful about and what's still missing. Every number here
// comes from seed/coops/insights.json, written by scripts/import-coop-data.ts.

import { StateRulesTable } from "@/components/StateRulesTable";
import type { Metadata } from "next";
import Link from "next/link";
import { DataLookup } from "@/components/DataLookup";
import { Card } from "@/components/ui";
import { SEED_COOPS } from "@/lib/coops";
import { TRX_MARGIN } from "@/lib/trx";
import { ENTITY_LABEL } from "@/lib/vehicles";
import type { EntityType } from "@/lib/types";
import insights from "@/seed/coops/insights.json";
import catalogInsights from "@/seed/catalog/insights.json";
import catalogReconcile from "@/seed/catalog/reconcile.json";
import reviewSummary from "@/seed/cleanup/decisions/summary.json";

export const metadata: Metadata = {
  title: "Co-op data · Agora",
  description: "How Agora uses published co-op rosters, agency procurement pages, Texas DIR sales and the .gov registry to tell every agency which co-ops it's on.",
};

const n = (x: number) => x.toLocaleString("en-US");
const usd = (x: number) =>
  x >= 1e9 ? `$${(x / 1e9).toFixed(1)}B` : x >= 1e6 ? `$${Math.round(x / 1e6).toLocaleString()}M` : `$${Math.round(x).toLocaleString()}`;
const pct = (a: number, b: number) => `${Math.round((100 * a) / Math.max(1, b))}%`;
const coopName = (id: string) => SEED_COOPS.find((c) => c.id === id)?.name ?? id;
const date = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });

function Section({ id, title, intro, children }: { id: string; title: string; intro: React.ReactNode; children?: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-24 border-t border-base-lighter pt-10">
      <h2 className="font-heading text-heading-md font-bold text-ink">{title}</h2>
      <div className="mt-3 max-w-[72ex] space-y-3 text-body-sm text-base-darker">{intro}</div>
      {children && <div className="mt-6">{children}</div>}
    </section>
  );
}

function Stat({ value, label, note }: { value: string; label: string; note?: string }) {
  return (
    <Card className="p-4">
      <div className="font-heading text-heading-lg font-bold text-ink">{value}</div>
      <div className="mt-1 text-ui-xs font-bold text-navy">{label}</div>
      {note && <div className="mt-1 text-ui-3xs text-base-dark">{note}</div>}
    </Card>
  );
}

function Table({ head, rows, right = [] }: { head: string[]; rows: React.ReactNode[][]; right?: number[] }) {
  return (
    <div className="overflow-x-auto rounded-lg border-2 border-base-lighter bg-white">
      <table className="w-full min-w-[560px] text-left text-ui-xs">
        <thead className="bg-base-lightest text-ui-3xs uppercase tracking-label text-base-dark">
          <tr>
            {head.map((h, i) => (
              <th key={h} className={`px-3 py-2 font-bold ${right.includes(i) ? "text-right" : ""}`}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-t border-base-lighter align-top">
              {r.map((c, j) => (
                <td key={j} className={`px-3 py-2 text-ink ${right.includes(j) ? "text-right tabular-nums" : ""}`}>
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const LADDER = [
  {
    level: "On a published roster",
    key: "roster",
    count: insights.evidence.roster,
    says: "The government registered with the co-op. It can buy through the co-op's contracts, but this doesn't show that it does.",
    source: "Sourcewell, HGACBuy, BuyBoard, Mohave, E&I and COSTARS rosters",
  },
  {
    level: "The agency names it",
    key: "agency",
    count: insights.evidence.agency,
    says: "The agency's own procurement page or purchasing guide lists the co-op, sometimes with its member ID. It intends to use it.",
    source: "Agency Relationships tab, plus proposed purchases",
  },
  {
    level: "Bought through it",
    key: "purchase",
    count: insights.evidence.purchase,
    says: "A published approval or award, or vendor-reported sales, shows money moved through the route. Nearly all of these are Texas DIR buyers.",
    source: "Purchase Evidence tab and Texas DIR sales",
  },
] as const;

const NEEDS = [
  {
    title: "A government ID for every agency",
    body: `Done for most: ${n(insights.federal.governments_with_id)} governments now carry a Census, NCES or IPEDS ID, and ${n(insights.federal.websites.total)} have a website. What's left are tribal governments (the Bureau of Indian Affairs list would cover them), county departments that should point at their parent county, and volunteer fire companies, which are often nonprofits.`,
    status: "Mostly done",
  },
  {
    title: "The missing rosters",
    body: "TIPS, OMNIA Partners, Equalis, Choice Partners, NPPGov and Keystone don't publish full member lists. TIPS and OMNIA are the big gaps, especially in Texas. This is the first ask of each co-op partnership: share the member list, with websites, and Agora shows you the traffic it sends.",
    status: "Partnerships",
  },
  {
    title: "What's on each co-op's contracts",
    body: `Started: the co-op catalog now brings ${catalogInsights.source_counts.contracts.toLocaleString()} contracts from 13 co-ops into search (see "The co-op catalog" above). Still missing: contract pages for TIPS, BuyBoard and 1GPA, end dates for GSA, Choice Partners, PEPPM and NPPGov, and price files for nearly every co-op but Canon on Sourcewell.`,
    status: "Started",
  },
  {
    title: "Spend by category",
    body: "DIR is summed per buyer here. The source data on data.texas.gov is line-level, with vendor, contract and category. Re-pulling it would show which categories run through co-ops, and city open-checkbook data would extend that beyond Texas.",
    status: "Next",
  },
  {
    title: "State rules on cooperative purchasing",
    body: "Each state has its own piggybacking law, bid thresholds and limits on which local agencies may use co-ops at all. That decides \"may use\" as much as membership does.",
    status: "Research",
  },
  {
    title: "A refresh schedule",
    body: `Everything here is a ${date(insights.retrieved)} snapshot, and rosters change. Agora shows each roster's retrieval date. A monthly re-pull through this importer would keep it honest.`,
    status: "Process",
  },
];

/** One line per correction, in plain words: "End date Jun 30, 2027", "34 participating states". */
function describe(c: (typeof catalogReconcile.corrections)[number]): string {
  if (c.field === "end") return `End date ${date(c.catalog)}`;
  if (c.field === "start") return `Start date ${date(c.catalog)}`;
  if (c.field === "contract_number") return `Number ${c.agora} → ${c.catalog}`;
  if (c.field === "source_url") return "Link to the co-op's page for this contract";
  const states = c.catalog.split(", ");
  return c.action === "flag" ? `States: ${c.note.replace(/ Agora keeps the list it read from NASPO directly\.$/, "")}` : `${states.length} participating states`;
}
const reconcileRows = Object.values(
  catalogReconcile.corrections.reduce<Record<string, { label: string; applied: string[]; flagged: string[] }>>((m, c) => {
    const r = (m[c.contract_id] ??= { label: c.label.replace(/^NASPO ValuePoint /, "NASPO ").replace(/ \((.+)\)$/, " · $1"), applied: [], flagged: [] });
    (c.action === "apply" ? r.applied : r.flagged).push(describe(c));
    return m;
  }, {}),
);

const REVIEW_TASK: Record<string, string> = {
  "gov-match": "Roster governments to federal records",
  "school-pairs": "Census school districts to NCES districts",
  "supplier-merge": "Look-alike supplier names",
  category: "Contract categories",
  "canon-rows": "Canon price rows",
  "product-name": "Conflicting product names",
};

export default function CoopDataPage() {
  const d = insights.directory;
  const nj = catalogInsights.njstart;
  const hi = catalogInsights.hawaii;
  const ar = catalogInsights.arkansas;
  const ny = catalogInsights.new_york;
  const f = insights.federal;
  const o = insights.overlap;
  const prospects = insights.prospects.slice(0, 15);
  const keptRows = insights.programs.reduce((s, p) => s + p.kept, 0);
  const droppedRows = insights.programs.reduce((s, p) => s + p.dropped, 0);
  const idCheck = insights.evidence.id_checks.find((c) => c.agrees);

  return (
    <div className="mx-auto max-w-4xl space-y-10">
      <div>
        <h1 className="font-heading text-heading-xl font-bold text-ink">Co-op data</h1>
        <div className="mt-3 max-w-[68ex] space-y-3 text-body-md text-base-darker">
          <p>
            The promise behind Agora&apos;s co-op section is simple: when someone in Crested Butte looks for a laptop, they should see the co-ops their town is on and the ones it
            isn&apos;t. Keeping that promise takes knowing every agency&apos;s memberships without asking its staff.
          </p>
          <p>
            This page explains the data that makes that work. It covers a workbook of {n(insights.workbook.roster_rows)} published co-op membership listings collected on{" "}
            {date(insights.retrieved)}, how Agora joins them to the Census of Governments and the federal school and college registries to build a directory of {n(d.governments)}{" "}
            governments with permanent IDs, what that unlocks in the product, where to be careful and what we still need.
          </p>
        </div>
        <nav className="mt-5 flex flex-wrap gap-x-4 gap-y-1 text-ui-xs" aria-label="On this page">
          {[
            ["#what", "What we have"],
            ["#ids", "Permanent IDs"],
            ["#uses", "How Agora uses it"],
            ["#lookup", "Look up an agency"],
            ["#evidence", "How we know"],
            ["#catalog", "Co-op catalog"],
            ["#njstart", "NJSTART"],
            ["#hawaii", "Hawaii"],
            ["#arkansas", "Arkansas"],
            ["#new-york", "New York"],
            ["#nigp", "NIGP codes"],
            ["#cleanup", "Cleanup"],
            ["#states", "State rules"],
            ["#prospects", "Prospects"],
            ["#cautions", "Cautions"],
            ["#needs", "What we still need"],
            ["#sources", "Sources"],
          ].map(([href, label]) => (
            <a key={href} href={href} className="font-bold text-primary">
              {label}
            </a>
          ))}
        </nav>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat value={n(d.governments)} label="Governments in the directory" note={`${n(d.on_a_roster)} on at least one co-op roster`} />
        <Stat value={n(f.governments_with_id)} label="With a permanent federal ID" note={`${pct(f.roster_with_id, f.roster_governments)} of roster governments`} />
        <Stat value={n(f.websites.total)} label="With a website" note={`Up from ${n(f.websites.by_source.gov ?? 0)} with .gov alone`} />
        <Stat value={n(o.entity_key_multi)} label="On two or more rosters" note={`${n(o.on_three_or_more)} on three or more co-ops`} />
      </div>

      <Section
        id="what"
        title="What we have"
        intro={
          <>
            <p>
              The workbook gathers what co-ops and agencies publish about themselves. Seven co-ops post member rosters: Sourcewell, HGACBuy, BuyBoard (Texas and National), Mohave,
              E&amp;I and COSTARS. Alongside the rosters are a year of Texas DIR sales by buyer, {n(insights.workbook.contract_access)} NASPO ValuePoint and OMNIA contract-access
              listings, {n(insights.workbook.relationships)} cases of an agency naming its own co-ops, and {n(insights.workbook.purchases)} documented purchases.
            </p>
            <p>
              Its best quality is discipline. Every tab keeps &quot;listed on a roster&quot; apart from &quot;says it uses a co-op&quot; and &quot;actually bought something.&quot;
              Agora keeps those apart too. One spot check held up:{" "}
              {idCheck ? (
                <>
                  {idCheck.agency}, {idCheck.state} publishes Sourcewell member ID {idCheck.published}, and the roster lists the same ID.
                </>
              ) : (
                "agency-published member IDs agree with the rosters."
              )}
            </p>
            <p>
              Rosters include private schools, churches and nonprofits. The importer keeps the rows a source classifies as government, plus rows whose names read as government
              (&quot;inferred&quot;), and sets aside the rest: {n(keptRows)} rows kept and {n(droppedRows)} set aside.
            </p>
          </>
        }
      >
        <Table
          head={["Roster", "Listings", "Kept", "Name-inferred", "Set aside", "States"]}
          right={[1, 2, 3, 4, 5]}
          rows={insights.programs.map((p) => [<span className="font-bold" key="p">{p.program}</span>, n(p.raw), n(p.kept), n(p.inferred), n(p.dropped), n(p.states)])}
        />
      </Section>

      <Section
        id="ids"
        title="Permanent IDs for every government"
        intro={
          <>
            <p>
              Names are a weak way to join data. &quot;Plano ISD&quot; and &quot;Plano Independent School District&quot; are one district, while New York&apos;s Town of
              DeRuyter and Village of DeRuyter are two governments. So Agora now joins every record to three federal registries that give each government a permanent ID. The
              Census Bureau&apos;s Government Units List covers counties, municipalities, townships, special districts and school districts. NCES numbers every public school
              district, and IPEDS every college.
            </p>
            <p>
              Each directory entry is matched to one federal record. Entries that land on the same ID are one government, whatever they&apos;re called, which merged{" "}
              {n(f.merged_by_id)} duplicate listings. Every government in the registries is now in the directory, roster or not: {n(f.added)} joined from the registries
              alone. Each record also brings a website. {n(f.websites.total)} governments now have one, up from {n(f.websites.by_source.gov ?? 0)} with a .gov domain.
            </p>
            <p>
              IDs also settle questions that names couldn&apos;t. {n(f.confirmed_public)} listings whose public status was only inferred from their names are now confirmed
              public. IPEDS showed that {n(f.private_set_aside)} &quot;universities&quot; on the E&amp;I and BuyBoard rosters are private, so they&apos;re set aside (
              {f.private_examples
                .slice(0, 3)
                .map((x) => x.name)
                .join(", ")}
              , and others).
            </p>
          </>
        }
      >
        <div className="grid gap-3 sm:grid-cols-3">
          {f.sources.map((src) => (
            <Card key={src.id} className="p-4">
              <div className="text-ui-md font-bold text-ink">{src.name}</div>
              <div className="mt-1 font-heading text-heading-md font-bold text-primary-darker">{n(src.records)}</div>
              <p className="mt-1 text-ui-xs text-base-darker">{src.note}</p>
              <a href={src.url} target="_blank" rel="noreferrer" className="mt-2 inline-block text-ui-3xs font-bold text-primary">
                Source ↗
              </a>
            </Card>
          ))}
        </div>

        <h3 className="mt-8 text-ui-md font-bold text-ink">How much of each roster now has an ID</h3>
        <p className="mt-1 max-w-[72ex] text-body-sm text-base-darker">
          Nearly every city, town and county on a co-op roster now matches a Census record. Special districts and school entries match less often, mostly because many listings
          aren&apos;t separate governments in the Census&apos;s eyes. They&apos;re a county&apos;s sheriff or district attorney, a volunteer fire company or a single school
          campus. Tribal governments aren&apos;t in any of the three registries.
        </p>
        <div className="mt-3">
          <Table
            head={["Kind of government", "On a roster", "With a federal ID", "Share"]}
            right={[1, 2, 3]}
            rows={Object.entries(f.roster_by_type)
              .sort((a, b) => b[1].all - a[1].all)
              .map(([t, v]) => [ENTITY_LABEL[t as EntityType] ?? t, n(v.all), n(v.with_id), pct(v.with_id, v.all)])}
          />
        </div>

        <h3 className="mt-8 text-ui-md font-bold text-ink">How the matching works</h3>
        <ul className="mt-2 max-w-[72ex] list-disc space-y-2 pl-5 text-body-sm text-base-darker">
          <li>
            A Census school district is paired with its NCES record by website ({n(f.school_pairs.by_website)} districts), and otherwise by name ({n(f.school_pairs.by_name)}).
            The Census abbreviates (&quot;Ada Exempted Sch Dist&quot;), so names are expanded before they&apos;re compared. Charter schools and service agencies are NCES
            districts that the Census doesn&apos;t count as governments, so they stay separate.
          </li>
          <li>
            A website counts only if no other government in the same registry lists it: 80 list sites.google.com, and dozens of Missouri soil districts share one state page.
          </li>
          <li>
            Same-named townships are told apart by county. Ohio and Pennsylvania each have dozens of Franklin Townships, and the roster&apos;s county picks the right one.
          </li>
          <li>
            A name that says Town never matches a record that says Village when both exist. The words only decide between candidates; a lone match counts whatever it&apos;s
            called, since the Census calls the Town of Crested Butte a city.
          </li>
          <li>
            {n(f.college_pairs)} community-college districts in the Census school list are paired with their IPEDS colleges.
          </li>
        </ul>
        <p className="mt-4 text-ui-xs text-base-dark">
          Merged by ID, for example:{" "}
          {f.merge_examples
            .slice(0, 5)
            .map((m) => `${m.name} = ${m.merged[0]} (${m.state})`)
            .join("; ")}
          .
        </p>
      </Section>

      <Section
        id="uses"
        title="How Agora uses it"
        intro={
          <p>
            The data now powers five things in the prototype. The first two are what an agency feels: it doesn&apos;t have to tell Agora its co-ops. The rest are for Sovra:
            truer eligibility, and a sharper view of who to sell to.
          </p>
        }
      >
        <ol className="space-y-4">
          {[
            {
              title: "Memberships detected for real agencies",
              body: (
                <>
                  Setting an agency looks it up in the directory and brings in every co-op it&apos;s on, so results split into &quot;Co-ops you&apos;re on&quot; and &quot;Co-ops you
                  could join&quot; from day one. The Town of Crested Butte now shows Sourcewell from Sourcewell&apos;s own roster, with its real member number, instead of a demo
                  list. Agora tracks {SEED_COOPS.length - 1} co-ops in all, up from three.
                </>
              ),
              href: "/",
              cta: "Set your agency to Crested Butte and search for laptops",
            },
            {
              title: "A directory of real agencies to pick from",
              body: (
                <>
                  &quot;Your agency&quot; is now a typeahead over {n(d.governments)} governments: every government the Census, NCES and IPEDS list, plus everyone on a
                  roster. Staff pick their agency instead of typing it. Each record carries its federal IDs, type, size, website and co-ops. That finishes step 3 of agency
                  setup before anyone opens it.
                </>
              ),
              href: "#lookup",
              cta: "Try the lookup below",
            },
            {
              title: "Memberships that say how we know",
              body: (
                <>
                  Each detected membership carries its evidence: on a roster, named by the agency or bought through. The membership strip in results shows it, with a link to the
                  source where one was published.
                </>
              ),
              href: "#evidence",
              cta: "See the evidence ladder",
            },
            {
              title: "Truer NASPO eligibility",
              body: (
                <>
                  {n(insights.naspo.parks_awards)} NASPO ValuePoint Parks and Recreation awards are now in Agora as quote-only contracts, with their {n(insights.naspo.parks_states)}{" "}
                  participating states and a link to each addendum. Local governments that signed their own addendum (
                  {insights.naspo.adopters.map((a) => `${a.name}, ${a.state}`).join("; ")}) can now use those awards even where their state hasn&apos;t signed.
                </>
              ),
              href: "/vehicles",
              cta: "Browse contracts",
            },
            {
              title: "A prospect list for city marketplaces",
              body: (
                <>
                  Joining DIR spend to co-op overlap finds the heaviest co-op users: big buyers who are already on several co-ops. They understand cooperative buying and spend real
                  money through it.
                </>
              ),
              href: "#prospects",
              cta: "See the prospects",
            },
          ].map((u, i) => (
            <li key={u.title}>
              <Card className="flex gap-4 p-5">
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-primary-lighter text-ui-xs font-bold text-primary-darker">{i + 1}</span>
                <div>
                  <div className="text-ui-md font-bold text-ink">{u.title}</div>
                  <p className="mt-1 text-body-sm text-base-darker">{u.body}</p>
                  <Link href={u.href} className="mt-2 inline-block text-ui-xs font-bold text-primary">
                    {u.cta} →
                  </Link>
                </div>
              </Card>
            </li>
          ))}
        </ol>
      </Section>

      <Section
        id="lookup"
        title="Look up an agency"
        intro={
          <p>
            Search any city, county, school district or special district to see what the directory knows about it: which co-ops list it, what it has published about its own
            purchasing and what DIR reports it spent. You can also make it your agency and search as it would.
          </p>
        }
      >
        <DataLookup />
      </Section>

      <Section
        id="evidence"
        title="How we know: the evidence ladder"
        intro={
          <>
            <p>
              A membership is only as good as its source. Agora ranks the evidence behind each one from weakest to strongest and shows the strongest it has. When purchasing
              confirms a membership by hand, that overrides all three.
            </p>
            <p>
              The counts below are the governments with at least that level of evidence for some co-op or route. Agency-published evidence covers only{" "}
              {n(insights.evidence.agency)} governments so far, which is the clearest sign of where to collect more.
            </p>
          </>
        }
      >
        <div className="grid gap-3 sm:grid-cols-3">
          {LADDER.map((l, i) => (
            <Card key={l.key} className="p-4">
              <div className="text-ui-3xs uppercase tracking-label text-base-dark">Level {i + 1}</div>
              <div className="mt-1 text-ui-md font-bold text-ink">{l.level}</div>
              <div className="mt-1 font-heading text-heading-md font-bold text-primary-darker">{n(l.count)}</div>
              <p className="mt-2 text-ui-xs text-base-darker">{l.says}</p>
              <p className="mt-2 text-ui-3xs text-base-dark">{l.source}</p>
            </Card>
          ))}
        </div>

        <h3 className="mt-8 text-ui-md font-bold text-ink">Purchases on the record</h3>
        <p className="mt-1 max-w-[72ex] text-body-sm text-base-darker">
          These {n(insights.purchases.length)} records are the strongest evidence in the workbook, and good stories for co-op conversations. Amounts are approval ceilings or award
          values, not verified spending, and proposals count as the agency naming the route, not as purchases.
        </p>
        <div className="mt-3">
          <Table
            head={["Government", "Route", "Supplier and purchase", "Status", "Amount"]}
            right={[4]}
            rows={insights.purchases.map((p) => [
              <span key="g">
                <span className="font-bold">{p.government}</span>, {p.state}
              </span>,
              p.route,
              <span key="s">
                {p.supplier ? `${p.supplier}: ` : ""}
                {p.category}
              </span>,
              p.url ? (
                <a key="u" href={p.url} target="_blank" rel="noreferrer" className="text-primary">
                  {p.status} ↗
                </a>
              ) : (
                p.status
              ),
              p.amount ? usd(p.amount) : "—",
            ])}
          />
        </div>
      </Section>

      <Section
        id="catalog"
        title="The co-op catalog: what's on each co-op's contracts"
        intro={
          <>
            <p>
              Memberships say which co-ops an agency is on. The co-op catalog says what those co-ops have under contract. It&apos;s a capture of 13 co-ops&apos; public contract
              directories, supplier lists, product tables and price files, retrieved {date(catalogInsights.retrieved)}:{" "}
              {n(catalogInsights.source_counts.contracts)} supplier contracts, {n(catalogInsights.source_counts.products)} products and{" "}
              {n(catalogInsights.source_counts.documents)} links to price documents.
            </p>
            <p>
              Agora uses it in four places. Search adds the best-fitting catalog contracts to the co-op section, split by the agency&apos;s memberships, with GSA in its own lane.
              Product search shows catalog items with every contract that sells them. Every supplier on a co-op contract gets a storefront ready to claim. And the price-list
              queue sends the linked documents through Agora&apos;s contract reader. Nothing in the catalog is buyable in Agora: orders happen on the co-op&apos;s site.
            </p>
            <p>
              The capture listed suppliers by exact name, so &quot;CDW-G&quot; and &quot;CDWG&quot; were two companies. Agora merges records whose names match once legal
              suffixes are dropped, or that share a website: {n(catalogInsights.suppliers.records)} records (NJSTART&apos;s vendors included) became {n(catalogInsights.suppliers.companies)} companies, and{" "}
              {n(catalogInsights.suppliers.on_two_or_more_coops)} of them hold contracts on two or more co-ops.
            </p>
          </>
        }
      >
        <Table
          head={["Co-op", "Contracts", "Own page", "End date", "Products"]}
          right={[1, 2, 3, 4]}
          rows={catalogInsights.per_coop
            .filter((c) => c.contracts && c.coop !== "NJSTART" && c.coop !== "Hawaii SPO" && c.coop !== "Arkansas OSP" && c.coop !== "NYS OGS" && c.coop !== "NY Preferred Source")
            .sort((a, b) => b.contracts - a.contracts)
            .map((c) => [
              <span key="c" className="font-bold">
                {c.coop}
              </span>,
              n(c.contracts),
              pct(c.with_link, c.contracts),
              pct(c.with_end, c.contracts),
              c.offerings ? n(c.offerings) : "—",
            ])}
        />
        <p className="mt-2 text-ui-xs text-base-dark">
          &quot;Own page&quot; is the share of contracts with a link to that contract on the co-op&apos;s site. TIPS, BuyBoard and 1GPA link every contract to one directory
          page, so Agora sends buyers there with the contract number to look up. Contracts without an end date can&apos;t be hidden when they expire, so their cards say the
          date isn&apos;t published.
        </p>

        <h3 className="mt-8 text-ui-md font-bold text-ink">What the catalog corrected in Agora</h3>
        <p className="mt-1 max-w-[72ex] text-body-sm text-base-darker">
          {n(catalogInsights.reconcile.confirmed)} of Agora&apos;s seeded co-op contracts turned up in the catalog. Where the co-op&apos;s own directory filled a gap, Agora
          applied it: {n(catalogInsights.reconcile.applied)} fixes, including end dates for the Sourcewell technology contracts, NASPO&apos;s participating states for the
          computer awards, and Dell&apos;s NASPO number, which is 23004 in NASPO&apos;s index, not the 23026 on Dell&apos;s posted document. Where the two disagree and Agora
          read NASPO directly, Agora keeps its own and flags the difference ({n(catalogInsights.reconcile.flagged)}).
        </p>
        <div className="mt-3">
          <Table
            head={["Contract", "Applied", "Flagged for review"]}
            rows={reconcileRows.map((r) => [
              <span key="l" className="font-bold">
                {r.label}
              </span>,
              <span key="a">{r.applied.join(" · ") || "—"}</span>,
              <span key="f" className="text-base-dark">
                {r.flagged.join(" · ") || "—"}
              </span>,
            ])}
          />
        </div>

        <h3 className="mt-8 text-ui-md font-bold text-ink">Products and prices</h3>
        <p className="mt-1 max-w-[72ex] text-body-sm text-base-darker">
          Products are concentrated in three places. Canon&apos;s Sourcewell price file gives {n(catalogInsights.products.by_status_coops.published_price ?? 0)} rows a real price
          (April 2026, with list price and discount). HGACBuy publishes {n(catalogInsights.products.by_status_coops.published_discount ?? 0)} discounts without the base prices to
          apply them to. PEPPM lists {n(catalogInsights.products.by_status.member_login ?? 0)} technology items whose prices sit behind a member login.{" "}
          {n(catalogInsights.products.multi_route)} products are sold on two or more contracts, which is where &quot;every way to buy it&quot; earns its keep. Agora shows a
          discount as a discount and a blank price as unknown, never as a price.
        </p>
        <p className="mt-3 text-ui-xs text-base-dark">
          Try it: search for <Link href="/" className="text-primary">playground equipment</Link> as the Town of Crested Butte, browse{" "}
          <Link href="/storefronts" className="text-primary">every supplier on a co-op contract</Link>, or open the{" "}
          <Link href="/coops/price-lists" className="text-primary">price-list queue</Link>.
        </p>
      </Section>

      <Section
        id="njstart"
        title="NJSTART: New Jersey's state contracts, first for New Jersey buyers"
        intro={
          <>
            <p>
              NJSTART is New Jersey&apos;s purchasing system, and its state contracts are the TRX program Sovra supports. A New Jersey town, county or school district can buy
              on any state contract the state opens to its Cooperative Purchasing Program. The state has already bid it, so the local unit doesn&apos;t advertise for bids of
              its own, and it carries the lowest fee of any shared contract. That makes it the route Agora prefers: for a New Jersey buyer, matching NJSTART contracts sit
              above every co-op in results, and NJSTART prices come first on each product.
            </p>
            <p>
              Agora holds all {n(nj.contracts)} active NJSTART contracts, read from the state&apos;s public list on {date(nj.retrieved)}. The state flags{" "}
              {n(nj.open_to_locals)} of them &quot;NJ Cooperative Purchasing&quot;, open to local governments; the other {n(nj.state_only)} are for state agencies, so Agora
              shows them only to a state agency. They come from {n(nj.suppliers)} vendors, {n(nj.suppliers_shared_with_coops)} of whom also hold co-op contracts and now
              show both on one storefront. NJSTART reports {usd(nj.spent_to_date)} spent on them to date.
            </p>
            <p>
              {n(nj.priced_lines)} awarded line-item prices on {n(nj.with_prices)} contracts are loaded, each checked against the line it was read from and labelled with its
              contract term. {n(nj.products_on_two_or_more_contracts)} products are priced on two or more contracts, so the same item can be compared across the suppliers
              on one award. Lines that aren&apos;t a price a buyer would pay stay out: {n(nj.dropped.no_price)} with no unit price (their prices are in the price sheet),{" "}
              {n(nj.dropped.index_markup)} fuel lines bid as a markup over the daily OPIS index, {n(nj.dropped.not_orderable)} marked not orderable,{" "}
              {n(nj.dropped.placeholder)} placeholders and {n(nj.dropped.discount)} with a discount, which waits on the discount decision.
            </p>
          </>
        }
      >
        <Table
          head={["Commodity group", "Contracts"]}
          right={[1]}
          rows={Object.entries(nj.groups).map(([g, c]) => [
            <span key="g" className="font-bold">
              {g}
            </span>,
            n(c as number),
          ])}
        />
        <p className="mt-2 max-w-[72ex] text-ui-xs text-base-dark">
          How the preference works: an NJSTART contract leads when it fits within {TRX_MARGIN} points of the best co-op contract, so a far closer co-op fit still wins. Line
          items are those on each contract&apos;s first summary page; contracts with more pages say so on their own page. The {n(nj.documents)} attached documents (price
          sheets, terms, methods of operation) are linked, not read yet. Hawaii, Arkansas and New York are loaded too (below); Oregon is the one TRX state not loaded yet.
        </p>
        <p className="mt-3 text-ui-xs text-base-dark">
          Try it: set your agency to Harmon Lake Township, New Jersey, and search for <Link href="/" className="text-primary">snow plow parts</Link> or road salt, or browse{" "}
          <Link href="/contracts?coop=NJSTART" className="text-primary">every NJSTART contract</Link>.
        </p>
      </Section>

      <Section
        id="hawaii"
        title="Hawaii: the State Procurement Office's price & vendor lists"
        intro={
          <>
            <p>
              Hawaii is a TRX state too. Its State Procurement Office publishes {n(hi.directory_entries)} price & vendor list documents: the state&apos;s own awards (paper,
              office supplies, envelopes, fuel, car rental, security guards) and its participating addenda to NASPO ValuePoint, Sourcewell and MMCAP contracts. Each list names
              its participating jurisdictions, and a county may buy on it only if it is named. Agora holds {n(hi.contracts)} supplier contracts from {n(hi.families)} lists,
              read {date(hi.retrieved)}; {n(hi.open_to_counties)} name at least one county, and {n(hi.state_only)} are for state bodies only. For a Hawaii buyer they lead
              results, as NJSTART does in New Jersey.
            </p>
            <p>
              Hawaii publishes no table of contracts, so review agents read each list and wrote down its contractors, participating jurisdictions, term and prices. A script
              then kept only what it found in the list&apos;s own text: all {n(hi.checked.contractors)} contractors and {n(hi.checked.jurisdictions)} jurisdiction entries,
              and {n(hi.checked.prices)} prices whose printed line carries both the price and words saying what it prices. {n(hi.checked.prices_dropped)} were dropped,
              mostly table rows that print only numbers. Prices are by island where the list says so, and rates the list sets as ceilings are labelled as ceilings.{" "}
              {n(hi.suppliers_shared_with_coops)} of the {n(hi.suppliers)} contractors also hold co-op contracts. The documents&apos; text isn&apos;t kept: it names
              procurement staff.
            </p>
          </>
        }
      />

      <Section
        id="arkansas"
        title="Arkansas: the Office of State Procurement's statewide contracts"
        intro={
          <>
            <p>
              Arkansas is the third TRX state loaded. The Office of State Procurement lists {n(ar.listings)} statewide contracts, most of them the state&apos;s participating
              addenda to NASPO ValuePoint, Sourcewell, OMNIA Partners and MMCAP contracts. A listing often groups several vendors, so review agents split each into supplier
              contracts, and a check kept only vendor names, agreement numbers, co-op links and quotes found in the listing&apos;s own text: {n(ar.checked.vendors)} vendors,
              none dropped. Two process servers who contract as individuals are left out. That leaves {n(ar.contracts)} supplier contracts from {n(ar.suppliers)} suppliers,{" "}
              {n(ar.suppliers_shared_with_coops)} of whom also hold co-op contracts.
            </p>
            <p>
              Arkansas&apos;s participating addenda treat each political subdivision as a participating entity, so a contract is open to Arkansas cities, counties and school
              districts unless its own text says otherwise. {n(ar.state_only)} does, in a quoted sentence (DocuSign&apos;s pricing is for state agencies only). The state&apos;s
              vehicle and school bus price sheets give {n(ar.priced_lines)} base prices on {n(ar.with_prices)} contracts, labelled as awarded bids for the base vehicle before
              options and delivery; two prices from a dealer not on the listing stay out.
            </p>
          </>
        }
      />

      <Section
        id="new-york"
        title="New York: the Office of General Services' centralized contracts"
        intro={
          <>
            <p>
              New York is the fourth TRX state loaded. OGS&apos;s monthly master report (dated {date(ny.master_report_date)}) lists {n(ny.contracts)} statewide supplier
              contracts under {n(ny.awards)} awards, from {n(ny.suppliers)} suppliers, {n(ny.suppliers_shared_with_coops)} of whom also hold co-op contracts. Each award&apos;s
              page says who may use it, and Agora quotes that wording on every contract: {n(ny.open_to_locals)} contracts are on awards open to political subdivisions or
              non-state agencies, and {n(ny.state_only)} are on awards for state agencies only (envelopes, legislative printing, two DOT projects, Albany-area agencies).{" "}
              {n(ny.use_unstated)} contracts sit on awards whose page doesn&apos;t say, and are treated as open, as OGS contracts generally are to authorized users.
            </p>
            <p>
              {n(ny.certified)} contracts carry a small business, minority-owned, women-owned or service-disabled veteran-owned certification, kept as published. Item
              prices aren&apos;t loaded yet: they are in the awards&apos; price files. New York&apos;s preferred sources (Corcraft, NYSID and NIBNY), which a buyer checks before a
              contract for the items they&apos;re approved to supply, are in the download but not yet in Agora.
            </p>
          </>
        }
      />

      <Section
        id="nigp"
        title="Commodity codes (NIGP)"
        intro={
          <>
            <p>
              Purchasing offices file what they buy under NIGP commodity codes, so Agora tags contracts with them too. {n(catalogInsights.nigp.published + catalogInsights.nigp.reviewed)} of{" "}
              {n(catalogInsights.nigp.contracts)} contracts carry at least one. NJSTART prints codes on its line items, so its {n(catalogInsights.nigp.published)} coded contracts
              and {n(catalogInsights.nigp.priced_offerings_coded)} prices carry the state&apos;s own codes. No co-op publishes codes, so the other{" "}
              {n(catalogInsights.nigp.reviewed)} took classes from the AI review: each co-op contract title and GSA SIN was offered the {n(nj.nigp_classes)} classes NJSTART&apos;s
              records name, with their descriptions, and the reviewer chose up to three or none. Only high- and medium-confidence answers are applied, and contract pages say
              which codes were printed and which were reviewed.
            </p>
            <p>
              Agora holds no licensed NIGP codebook, so it can name only the {n(nj.nigp_codes)} codes those public records use. Contracts whose goods fall outside those
              classes stay uncoded rather than forced into a near miss. Search the contract explorer by a code or class, such as{" "}
              <Link href="/contracts?q=765" className="text-primary">
                765
              </Link>{" "}
              (road and highway equipment).
            </p>
          </>
        }
      />

      <Section
        id="cleanup"
        title="Data cleanup: rules first, then AI review"
        intro={
          <>
            <p>
              The sources disagree, abbreviate and leave gaps, so the directory and catalog go through two cleanup passes. The first is rules over public data, which costs
              nothing and is fully repeatable. The second sends what the rules couldn&apos;t settle to an AI reviewer, with real candidates to choose among.
            </p>
            <p>
              Rules did most of the work. GSA titles every contract &quot;Multiple Award Schedule,&quot; so {n(catalogInsights.cleanup.gsa_described)} GSA contracts are now
              described by their SINs, from GSA&apos;s own SIN list. Each has its end date, and {n(catalogInsights.cleanup.gsa_open_to_cities)} carry at least one of the{" "}
              {n(catalogInsights.cleanup.gsa_cooperative_sins)} SINs GSA opens to state and local governments; the rest are marked not open. {n(catalogInsights.cleanup.names_title_cased)}{" "}
              ALL CAPS supplier names were title-cased, {n(catalogInsights.cleanup.parts_labelled)} products named only by a part number now carry their maker, and{" "}
              {n(f.county_offices ?? 0)} county offices (sheriffs, district attorneys, clerks) point at their county, while {n(f.county_governing_bodies_merged ?? 0)} county
              commissions merged into the county they govern.
            </p>
            <p>
              The AI review never invents a fact. Each item comes with the real records it could be, such as a roster entry with its top Census and NCES candidates, and the
              model picks one or says none, with a confidence and a reason. A check rejects any answer that isn&apos;t one of the options offered, and any Canon price whose
              numbers don&apos;t appear in its source line. Only high- and medium-confidence answers are applied; the rest stay in the decision files for people to review.
            </p>
          </>
        }
      >
        {Object.keys(reviewSummary).length > 0 && (
          <Table
            head={["Review task", "Items", "Applied", "Answered none", "Low confidence", "Rejected by checks"]}
            right={[1, 2, 3, 4, 5]}
            rows={Object.entries(reviewSummary as Record<string, Record<string, number>>).map(([task, x]) => [
              <span key="t" className="font-bold">
                {REVIEW_TASK[task] ?? task}
              </span>,
              n(x.items),
              n(Math.max(0, x.picked - (x.low_picked ?? 0))),
              n(Math.max(0, x.kept - x.picked)),
              n(x.low),
              n(x.invalid + x.missing),
            ])}
          />
        )}
      </Section>

      <Section
        id="states"
        title="State rules: who may use a co-op contract"
        intro={
          <>
            <p>
              Whether a city or school district may buy off a national co-op contract is a question of state law, and no two states answer it on the same terms. Agora&apos;s
              50-state research (November 13, 2026) records, for each state, the authority for local governments and for school districts, any state-approved list, the
              conditions (board action, what the lead contract must be), what&apos;s excluded, and the purchasing thresholds.
            </p>
            <p>
              Three conditions recur: a competitively bid lead contract awarded by a public agency, a written agreement or governing-body resolution, and an exclusion for
              construction. Only Alabama and Mississippi run true approval lists. Results show the buyer&apos;s own state beside the co-op contracts, and warn when a request
              looks like construction in a state that restricts it. Flags mark points read on third-party sites or secondary sources: leads to confirm, not settled law.
            </p>
          </>
        }
      >
        <StateRulesTable />
      </Section>

      <Section
        id="prospects"
        title="Prospects: the heaviest co-op users"
        intro={
          <>
            <p>
              These are the largest Texas DIR buyers that also sit on two or more co-ops. They already buy cooperatively and spend heavily through it, which makes them the strongest
              candidates for a city marketplace. They&apos;re also the agencies whose traffic matters most when Sovra shows a co-op the lift it gets.
            </p>
            <p>The list is Texas-only because DIR is Texas&apos;s program. Line-level spend from other states would extend it.</p>
          </>
        }
      >
        <Table
          head={["Agency", "Type", "DIR sales", "Co-ops"]}
          right={[2]}
          rows={prospects.map((p) => [
            <span key="n" className="font-bold">
              {p.name}
            </span>,
            ENTITY_LABEL[p.type as EntityType],
            usd(p.dir_sales),
            <span key="c" className="text-base-darker">
              {p.coops.map(coopName).join(", ")}
            </span>,
          ])}
        />
      </Section>

      <Section
        id="cautions"
        title="Cautions"
        intro={<p>The data is strong, but it&apos;s public-source data, and a few limits shape how Agora talks about it.</p>}
      >
        <div className="space-y-4">
          {[
            {
              title: "Membership isn't eligibility, and a missing row isn't proof",
              body: "A roster listing means an agency registered, not that every contract is open to it or that it buys. An agency missing from these sources may still be a member, especially of co-ops that don't publish rosters. So Agora says \"none found on the rosters Agora holds,\" never \"you're not a member.\"",
            },
            {
              title: "Some public status is inferred",
              body: `${n(d.inferred)} governments in the directory are there because their names read as government (\"Plano ISD\", \"Sabine Fire District 1\"), not because a source said so. E&I and BuyBoard don't classify their listings. Their records are marked \"inferred\", and a few private schools likely slipped through.`,
            },
            {
              title: "IDs join most of it; names still join the rest",
              body: `${pct(f.roster_with_id, f.roster_governments)} of roster governments now carry a federal ID, and records that share one are merged. The rest are still joined by name (entityKey in lib/coops.ts), which finds ${n(o.entity_key_multi)} governments on two or more rosters against ${n(o.conservative_key_multi)} for the workbook's conservative key. Name matching can still miss a spelling or, rarely, join two places. Roster entries without an ID look like these:`,
              examples: f.unmatched_examples.slice(0, 5).map((e) => `${e.name}, ${e.state}`),
            },
            {
              title: "DIR states are inconsistent",
              body: `${n(insights.dir.blank_state_merges)} DIR buyers were split between a Texas row and a blank-state row. The importer merges them. The largest, ${insights.dir.blank_state_examples[0]?.name}, was split across ${usd(insights.dir.blank_state_examples[0]?.sales ?? 0)}.`,
            },
            {
              title: "NASPO addendum lists disagree",
              body: `For ${n(insights.naspo.citizen_addendum_diffs.length)} Citizen Engagement awards, Agora's seed (read straight from naspovaluepoint.org on November 9) lists states the workbook doesn't. Agora keeps NASPO's own data and flags the gap here: ${insights.naspo.citizen_addendum_diffs.map((x) => `${x.master_agreement} ${x.only_in_agora.join(", ")}`).join("; ")}.`,
            },
            {
              title: "Check terms before showing rosters publicly",
              body: "The rosters are published, but each co-op has its own terms of use. Agora uses them to detect an agency's own memberships rather than republishing lists, and the partnership conversation is the place to agree on more.",
            },
          ].map((c) => (
            <Card key={c.title} className="p-5">
              <div className="text-ui-md font-bold text-ink">{c.title}</div>
              <p className="mt-1 text-body-sm text-base-darker">{c.body}</p>
              {"examples" in c && c.examples && (
                <ul className="mt-2 list-disc pl-5 text-ui-xs text-base-dark">
                  {c.examples.map((e) => (
                    <li key={e}>{e}</li>
                  ))}
                </ul>
              )}
            </Card>
          ))}
        </div>
      </Section>

      <Section
        id="needs"
        title="What we still need"
        intro={
          <p>
            Six kinds of data would take this from a strong prototype to something a purchasing office can rely on. The first matters most, because every other join gets easier once
            each government has a permanent ID.
          </p>
        }
      >
        <ol className="grid gap-3 sm:grid-cols-2">
          {NEEDS.map((x, i) => (
            <li key={x.title}>
              <Card className="h-full p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="text-ui-md font-bold text-ink">
                    {i + 1}. {x.title}
                  </div>
                  <span className="shrink-0 rounded-full bg-base-lightest px-2 py-0.5 text-ui-3xs font-bold text-base-dark">{x.status}</span>
                </div>
                <p className="mt-2 text-body-sm text-base-darker">{x.body}</p>
              </Card>
            </li>
          ))}
        </ol>
      </Section>

      <Section
        id="sources"
        title="Where the numbers come from"
        intro={
          <>
            <p>
              Everything on this page is generated. <code>npm run fetch:federal</code> downloads the Census Government Units List 2026, the NCES district directory for
              2024-25 and IPEDS 2024, keeping IDs, names, places, websites and sizes; officials&apos; names, phone numbers and street addresses are left out. Then{" "}
              <code>npm run import:coops</code> reads them with <code>seed/coops/source/coop-memberships-2026-11-13.xlsx</code> and CISA&apos;s .gov registry (federal
              domains removed, contact emails left out). It writes the directory, these insights and the NASPO Parks catalog. The directory stays on the server; the browser asks
              for a few records at a time.
            </p>
            <p>
              The .gov registry matched {n(d.dotgov_matched)} governments already on a roster and added {n(d.dotgov_added)} more that aren&apos;t on any. Those are agencies Agora
              can now recognize and show &quot;Co-ops you could join.&quot; The workbook&apos;s own coverage notes follow.
            </p>
          </>
        }
      >
        <Table
          head={["Program", "Collection status", "Records", "Next public step"]}
          right={[2]}
          rows={insights.coverage.map((c) => [
            <span key="p" className="font-bold">
              {c.program}
            </span>,
            c.status,
            c.records == null ? "—" : n(c.records),
            <span key="x" className="text-base-darker">
              {c.next}
            </span>,
          ])}
        />
      </Section>
    </div>
  );
}
