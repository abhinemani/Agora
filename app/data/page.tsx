// Co-op data: what the public cooperative purchasing workbook holds, how Agora
// uses it, what to be careful about and what's still missing. Every number here
// comes from seed/coops/insights.json, written by scripts/import-coop-data.ts.

import type { Metadata } from "next";
import Link from "next/link";
import { DataLookup } from "@/components/DataLookup";
import { Card } from "@/components/ui";
import { SEED_COOPS } from "@/lib/coops";
import { ENTITY_LABEL } from "@/lib/vehicles";
import type { EntityType } from "@/lib/types";
import insights from "@/seed/coops/insights.json";

export const metadata: Metadata = {
  title: "Co-op data · Agora",
  description: "How Agora uses published co-op rosters, agency procurement pages, Texas DIR sales and the .gov registry to tell every agency which co-ops it's on.",
};

const n = (x: number) => x.toLocaleString("en-US");
const usd = (x: number) =>
  x >= 1e9 ? `$${(x / 1e9).toFixed(1)}B` : x >= 1e6 ? `$${Math.round(x / 1e6).toLocaleString()}M` : `$${Math.round(x).toLocaleString()}`;
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
    body: "The Census of Governments gives every unit of government a permanent ID, and NCES and IPEDS do the same for school districts and colleges, with websites. Joining them would turn name matching into ID matching and fill in domains for the 80% of governments that don't have a .gov site.",
    status: "Next",
  },
  {
    title: "The missing rosters",
    body: "TIPS, OMNIA Partners, Equalis, Choice Partners, NPPGov and Keystone don't publish full member lists. TIPS and OMNIA are the big gaps, especially in Texas. This is the first ask of each co-op partnership: share the member list, with websites, and Agora shows you the traffic it sends.",
    status: "Partnerships",
  },
  {
    title: "What's on each co-op's contracts",
    body: "This data says who belongs to which co-op. \"Co-ops you could join\" only means something when Agora can show what those co-ops' contracts cover. That takes contract lists, scopes, end dates and price files for Sourcewell, OMNIA, TIPS and the rest. Their contract directories are public.",
    status: "Next",
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

export default function CoopDataPage() {
  const d = insights.directory;
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
            {date(insights.retrieved)}, how Agora turns those listings into a directory of {n(d.governments)} governments, what that unlocks in the product, where to be careful and
            what we still need.
          </p>
        </div>
        <nav className="mt-5 flex flex-wrap gap-x-4 gap-y-1 text-ui-xs" aria-label="On this page">
          {[
            ["#what", "What we have"],
            ["#uses", "How Agora uses it"],
            ["#lookup", "Look up an agency"],
            ["#evidence", "How we know"],
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
        <Stat value={n(o.entity_key_multi)} label="On two or more rosters" note={`${n(o.on_three_or_more)} on three or more co-ops`} />
        <Stat value={n(d.with_domain)} label="Matched to a .gov domain" note="From CISA's .gov registry" />
        <Stat value={usd(insights.dir.sales)} label="Texas DIR sales" note={`${n(insights.dir.buyers)} buyers, Sept. 2025 to Sept. 2026`} />
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
                  &quot;Your agency&quot; is now a typeahead over {n(d.governments)} governments, so staff pick their agency instead of typing it. Each record carries the
                  agency&apos;s type, its .gov domain where it has one, and its co-ops. That finishes step 3 of agency setup before anyone opens it.
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
              title: "Names, not IDs, join the sources",
              body: `The workbook's conservative key found ${n(o.conservative_key_multi)} governments on two or more rosters. Agora's matcher (entityKey in lib/coops.ts) standardizes \"ISD\", \"City of\" and \"Township of\" without dropping words that tell two governments apart, and finds ${n(o.entity_key_multi)}. It's better, but it's still name matching. A government ID spine is the real fix.`,
              examples: o.examples.slice(0, 5).map((e) => `${e.name} = ${e.also[0]} (${e.state})`),
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
              Everything on this page is generated. <code>npm run import:coops</code> reads <code>seed/coops/source/coop-memberships-2026-11-13.xlsx</code> and CISA&apos;s .gov
              registry (<code>seed/coops/source/dotgov-domains-2026-11-13.csv</code>, federal domains removed, contact emails left out). It writes the directory, these insights
              and the NASPO Parks catalog. The directory stays on the server; the browser asks for a few records at a time.
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
