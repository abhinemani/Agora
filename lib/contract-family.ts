// How contracts nest. Most programs award one solicitation to many suppliers, so a
// buyer sees the same long title once per supplier: New York's IT umbrella award is
// 182 contracts with one title. Some contracts are a state's addendum to another
// program's master agreement. And a contract's own documents are a pile of a master
// agreement, amendments, price sheets and exhibits. This module says which contracts
// share an award, which master an addendum adopts, and what role each document plays,
// all from the catalog records and document labels. Server only: it reads the catalog.

import { catalogIndex, type CatalogContract } from "./catalog";

const today = () => new Date().toISOString().slice(0, 10);
const current = (c: CatalogContract) => !(c.end && c.end < today());
const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

// ------------------------------------------------------------------ awards

/** One award (a solicitation, or a co-op contract number) and the supplier contracts on it. */
export interface Award {
  key: string;
  /** How the program names it: "Award 22802", "Solicitation T2466", "Contract 790-26". */
  label: string;
  /** The title its contracts share (the most common one). */
  title: string;
  program: string;
  program_id: string;
  lead: string | null;
  /** Current contracts on the award, in supplier order. */
  members: string[];
}

/** A solicitation that names an award, not an owner or another program ("County of Chemung", "Sourcewell 040924-URI"). */
const COOP_REF = /^(sourcewell|omnia|naspo|e&i|tips|buyboard|hgac|equalis|1gpa|choice partners|peppm|nppgov|mmcap|gsa)\b/i;
function solicitationOf(c: CatalogContract): string | null {
  const s = c.state_contract?.solicitation?.trim();
  if (!s || s === c.number) return null;
  if (c.coop === "Empire Procure Connect" || c.coop === "NY Preferred Source") return null;
  if (COOP_REF.test(s) || /^use the\b/i.test(s) || s.length > 40 || s.split(/\s+/).length > 4) return null;
  return s;
}
const solicitationLabel = (s: string) => (/^(award|rfp|rfq|ifb|itb|bid|solicitation)\b/i.test(s) ? s : `Solicitation ${s}`);

/** A co-op number's root: "121923-CEN" → "121923", "20-00000-21-00021-AB" → "20-00000-21-00021". */
const rootOf = (n: string) => {
  const m = n.match(/^(.{4,}?)[-/ ]([A-Z0-9]{1,3})$/i);
  return m ? m[1] : null;
};

interface FamilyIndex {
  awardOf: Map<string, string>;
  awards: Map<string, Award>;
  /** An addendum's master: the program and number it names, and the master contract when the catalog holds it. */
  masterOf: Map<string, Master>;
  /** A master's addenda in the catalog. */
  addendaOf: Map<string, string[]>;
}

export interface Master {
  program: string;
  number: string | null;
  /** The master contract's page, when the catalog holds it. */
  id: string | null;
  /** How Loci knows: the addendum names it, or Loci matched it by supplier. */
  basis: "named" | "matched" | "program_only";
}

const g = globalThis as unknown as { __agoraFamily?: FamilyIndex };

function build(): FamilyIndex {
  const idx = catalogIndex();
  const live = idx.contracts.filter(current);
  const programName = (c: CatalogContract) => c.coop;
  const programId = (c: CatalogContract) => (c.state_contract ? c.coop : c.coop_id || c.coop);

  // Candidate keys, then keep the ones more than one current contract share.
  const candidate = new Map<string, { key: string; label: string }>();
  const numberCount = new Map<string, number>();
  for (const c of live) if (!c.state_contract && c.number) numberCount.set(`${c.coop_id}|${c.number}`, (numberCount.get(`${c.coop_id}|${c.number}`) ?? 0) + 1);
  for (const c of live) {
    if (c.state_contract) {
      const s = solicitationOf(c);
      if (s)
        candidate.set(c.id, {
          key: `${programId(c)}|s|${norm(s)}`,
          label: solicitationLabel(s),
        });
      continue;
    }
    if (!c.number) continue;
    if ((numberCount.get(`${c.coop_id}|${c.number}`) ?? 0) > 1) {
      candidate.set(c.id, {
        key: `${c.coop_id}|n|${c.number}`,
        label: `Contract ${c.number}`,
      });
      continue;
    }
    // Numbered by award and supplier ("121923-CEN"): the same root and the same title make one award.
    const root = rootOf(c.number);
    if (root)
      candidate.set(c.id, {
        key: `${c.coop_id}|r|${root}|${norm(c.title)}`,
        label: `Contracts ${root}-…`,
      });
  }
  const members = new Map<string, CatalogContract[]>();
  for (const c of live) {
    const k = candidate.get(c.id)?.key;
    if (k) (members.get(k) ?? members.set(k, []).get(k)!).push(c);
  }
  const awardOf = new Map<string, string>();
  const awards = new Map<string, Award>();
  for (const [key, list] of members) {
    if (list.length < 2) continue;
    const titles = new Map<string, number>();
    for (const c of list) titles.set(c.title, (titles.get(c.title) ?? 0) + 1);
    const title = [...titles].sort((a, b) => b[1] - a[1] || a[0].length - b[0].length)[0][0];
    const leads = new Set(list.map((c) => c.lead).filter(Boolean));
    const supplierName = (c: CatalogContract) => idx.supplierById.get(c.supplier)?.name ?? "";
    list.sort((a, b) => supplierName(a).localeCompare(supplierName(b)) || a.number.localeCompare(b.number, undefined, { numeric: true }));
    awards.set(key, {
      key,
      label: candidate.get(list[0].id)!.label,
      title,
      program: programName(list[0]),
      program_id: programId(list[0]),
      lead: leads.size === 1 ? [...leads][0] : null,
      members: list.map((c) => c.id),
    });
    for (const c of list) awardOf.set(c.id, key);
  }

  // Addenda: Arkansas names the master ("Sourcewell 040924-URI"); Oregon's NASPO addenda say only the program.
  const masterOf = new Map<string, Master>();
  const addendaOf = new Map<string, string[]>();
  const byNumber = new Map<string, CatalogContract[]>();
  for (const c of idx.contracts) if (!c.state_contract && c.number) (byNumber.get(norm(c.number)) ?? byNumber.set(norm(c.number), []).get(norm(c.number))!).push(c);
  const words = (t: string) => new Set((t.toLowerCase().match(/[a-z]{4,}/g) ?? []).filter((w) => !/^(naspo|master|agreement|participating|addendum|services|state|oregon|contract)$/.test(w)));
  for (const c of live) {
    if (!c.state_contract) continue;
    let m: Master | null = null;
    const s = c.state_contract.solicitation ?? "";
    const named = s.match(/^(Sourcewell|OMNIA Partners|NASPO ValuePoint|E&I|TIPS|BuyBoard|HGACBuy|Equalis Group|1GPA|Choice Partners|PEPPM|NPPGov|MMCAP)\s*#?\s*([A-Z0-9][A-Z0-9-]*)?/i);
    if (named && c.coop !== named[1]) {
      const number = named[2] ?? null;
      const found = number ? (byNumber.get(norm(number)) ?? []).filter((x) => norm(x.coop) === norm(named[1])) : [];
      const pick = found.find((x) => x.supplier === c.supplier) ?? (found.length === 1 ? found[0] : null);
      m = {
        program: named[1],
        number,
        id: pick?.id ?? null,
        basis: number ? "named" : "program_only",
      };
    } else if (/NASPO/i.test(`${c.state_contract.type_code ?? ""} ${c.title}`)) {
      // The NASPO number when the state prints it ("20-11 · AR3227"), else the supplier's NASPO
      // contracts, where one that shares a word of the title is the master.
      const printed = (c.number.split(/\s*·\s*/)[1] ?? "").trim();
      const byPrinted = printed ? (byNumber.get(norm(printed)) ?? []).filter((x) => x.coop_id === "coop_naspo") : [];
      if (printed && byPrinted.length) {
        const pick = byPrinted.find((x) => x.supplier === c.supplier) ?? byPrinted[0];
        m = {
          program: "NASPO ValuePoint",
          number: pick.number,
          id: pick.id,
          basis: "named",
        };
      }
      const theirs = (idx.contractsBySupplier.get(c.supplier) ?? []).filter((x) => x.coop_id === "coop_naspo" && current(x));
      const mine = words(c.title);
      const scored = theirs
        .map((x) => ({
          x,
          n: [...words(x.title)].filter((w) => mine.has(w)).length,
        }))
        .sort((a, b) => b.n - a.n);
      const pick = theirs.length === 1 ? theirs[0] : scored[0]?.n ? scored[0].x : null;
      if (!m)
        m = pick
          ? {
              program: "NASPO ValuePoint",
              number: pick.number,
              id: pick.id,
              basis: pick.number === c.number ? "named" : "matched",
            }
          : {
              program: "NASPO ValuePoint",
              number: printed || null,
              id: null,
              basis: printed ? "named" : "program_only",
            };
    }
    if (!m) continue;
    masterOf.set(c.id, m);
    if (m.id) (addendaOf.get(m.id) ?? addendaOf.set(m.id, []).get(m.id)!).push(c.id);
  }
  return { awardOf, awards, masterOf, addendaOf };
}

const family = () => (g.__agoraFamily ??= build());

/** The award a catalog contract shares with other suppliers, if any. */
export const awardOf = (contractId: string): Award | null => {
  const f = family();
  const k = f.awardOf.get(contractId);
  return k ? (f.awards.get(k) ?? null) : null;
};
export const awardByKey = (key: string): Award | null => family().awards.get(key) ?? null;
export const masterOf = (contractId: string): Master | null => family().masterOf.get(contractId) ?? null;
export const addendaOf = (contractId: string): string[] => family().addendaOf.get(contractId) ?? [];

/** Counts for /data and the README: how many awards, and how many contracts sit on one. */
export function familyStats() {
  const f = family();
  return {
    awards: f.awards.size,
    on_awards: f.awardOf.size,
    addenda: f.masterOf.size,
    addenda_linked: [...f.masterOf.values()].filter((m) => m.id).length,
  };
}

// ------------------------------------------------------------------ documents

export type DocRole = "agreement" | "addendum" | "amendment" | "pricing" | "guidance" | "solicitation" | "exhibit" | "summary" | "other";

export const DOC_ROLES: { id: DocRole; label: string; note: string }[] = [
  {
    id: "agreement",
    label: "The agreement",
    note: "The executed contract or award: the terms everything else hangs from.",
  },
  {
    id: "addendum",
    label: "Participating addenda",
    note: "A state's or agency's terms for using a master agreement.",
  },
  {
    id: "amendment",
    label: "Amendments and updates",
    note: "Changes to the agreement, ordered by number where the labels give one. A later change overrides an earlier one.",
  },
  {
    id: "pricing",
    label: "Pricing",
    note: "Price sheets, rate tables and price adjustments.",
  },
  {
    id: "guidance",
    label: "How to use it",
    note: "Standard terms, ordering instructions, insurance and FAQs.",
  },
  {
    id: "solicitation",
    label: "The solicitation",
    note: "What was bid: the request, its specifications and the bidder's response.",
  },
  {
    id: "exhibit",
    label: "Exhibits and attachments",
    note: "Supporting documents the agreement refers to.",
  },
  {
    id: "summary",
    label: "Summary pages",
    note: "The program's own page for the contract.",
  },
  { id: "other", label: "Other documents", note: "" },
];

/** What a document is, from its label (and file name when the label is bare). */
export function docRole(label: string, url = ""): DocRole {
  const t = ` ${label.replace(/[_~]+/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2")} `.toLowerCase();
  const f = decodeURIComponent(url.split("/").pop() ?? "").toLowerCase();
  // Labels written as one word ("T1234MethodofOperation", "2Amd1"), squashed for the patterns that need it.
  const sq = t.replace(/[^a-z0-9]/g, "");
  if (/summary page|contract summary|master list|preferred.source/.test(t)) return "summary";
  if (/participating addend|\bpa\b(?! \d)/.test(t) && !/amend/.test(t)) return "addendum";
  if (/bid amendment|solicitation amendment|addendum to (the )?(rfp|ifb|bid)/.test(t)) return "solicitation";
  if (
    /amend|\bamd\b|modification|change (notice|order)|change in scope|contract updates|historical|extension|renewal|\bmod\b|(product|line item) (addition|cancellation)|vendor information change/.test(
      t,
    ) ||
    /changeinscope|\damd|amd\d/.test(sq)
  )
    return "amendment";
  if (/pric|cost|rate|fee schedule|discount|\bps final\b/.test(t)) return "pricing";
  if (
    /terms ?and ?conditions|standard ?terms|standard ?documents|how to use|method of operation|faq|insurance|ordering|placard|reseller|delivery schedule|instructions|buyers? guide|at a glance|matrix|contractor information|contact (list|information)|mailing list|checklist|state contract manager|cooperative purchase|additional distributors|buyer.?s guide|subcontractor list/.test(
      t,
    ) ||
    /methodofoperation|ataglance/.test(sq)
  )
    return "guidance";
  if (
    /award document|agreement|executed|award letter|award notice|notice of award|-noa\b|offer (and|&) acceptance|supplemental award|\baward $|\boa page|contract award|award summary|\bcontract\b/.test(
      t,
    )
  )
    return "agreement";
  if (
    /solicitation|rf[pqi]\b|\bifb\b|\bitb\b|request for|invitation|bid|specification|response|proposal|q ?(&|and) ?a\b|questions|pre-quote|disclosure|signatory|subcontracting|certificat|affidavit|data ?packet/.test(
      t,
    )
  )
    return "solicitation";
  if (/exhibit|attachment|appendix|schedule|diagram|form\b/.test(t)) return "exhibit";
  // NJSTART's bare attachment names ("a1817-3") say nothing; the file name sometimes does.
  if (f && f !== label.toLowerCase() && /\.(pdf|xlsx?|docx?)$/.test(f)) {
    const byFile = docRole(f);
    if (byFile !== "other") return byFile;
  }
  if (/^[a-z]?\d{3,}-\d+$/i.test(label.trim())) return "exhibit";
  return "other";
}

/** An amendment's number, for ordering: "Amendment 3" → 3. */
const seq = (label: string) => Number(label.match(/(?:amendment|amend\.?|mod(?:ification)?|update)\s*#?\s*(\d+)/i)?.[1] ?? NaN);

export interface DocGroup {
  role: DocRole;
  label: string;
  note: string;
  docs: { label: string; url: string; host: string; readable: boolean }[];
}

/** A contract's documents by role, in reading order. */
export function groupDocuments<T extends { label: string; url: string; host: string; readable: boolean }>(docs: T[]): DocGroup[] {
  const by = new Map<DocRole, T[]>();
  for (const d of docs) {
    const r = docRole(d.label, d.url);
    (by.get(r) ?? by.set(r, []).get(r)!).push(d);
  }
  const out: DocGroup[] = [];
  for (const r of DOC_ROLES) {
    const list = by.get(r.id);
    if (!list?.length) continue;
    list.sort((a, b) => {
      if (r.id === "amendment") {
        const x = seq(a.label);
        const y = seq(b.label);
        if (!Number.isNaN(x) || !Number.isNaN(y)) return (Number.isNaN(x) ? 999 : x) - (Number.isNaN(y) ? 999 : y);
      }
      return a.label.localeCompare(b.label, undefined, { numeric: true });
    });
    out.push({
      role: r.id,
      label: r.label,
      note: r.note,
      docs: list.map(({ label, url, host, readable }) => ({
        label,
        url,
        host,
        readable,
      })),
    });
  }
  return out;
}
