// A contract's key sections: the outline of its main document, read from the table of
// contents it prints ("SECTION 2: HOW TO USE THE CONTRACT ....... 8") or, without one,
// from its numbered headings. Rule-based and quick: it reads only text Loci already
// holds (seed/catalog/doctext) or has stored (lib/doc-store.ts), never the publisher.
// The headings are the document's own words; nothing here is summarized.

import { catalogDocumentsFor, catalogIndex } from "./catalog";
import { docRole, type DocRole } from "./contract-family";
import { heldPages, type Page } from "./docs";
import { storedPages } from "./doc-store";
import { hasDatabase } from "./pg";
import type { Db } from "./types";

export type Topic = "ordering" | "eligibility" | "pricing" | "payment" | "term" | "scope" | "delivery" | "warranty" | "insurance" | "termination";

export const TOPIC_LABEL: Record<Topic, string> = {
  ordering: "How to order",
  eligibility: "Who may use it",
  pricing: "Pricing",
  payment: "Invoices and payment",
  term: "Term and renewal",
  scope: "What it covers",
  delivery: "Delivery",
  warranty: "Warranty",
  insurance: "Insurance",
  termination: "Termination",
};

const TOPICS: [Topic, RegExp][] = [
  ["ordering", /how to use|procurement instructions|ordering|purchase orders?\b|how to (order|buy)|placing orders/i],
  ["eligibility", /authorized users|eligib|participat|cooperative purchas|non-state agenc|political subdivision/i],
  ["payment", /invoic|payment|billing/i],
  ["pricing", /pric|cost|(?<!wage )rates?\b|discount|\bfees?\b/i],
  ["term", /contract (term|period)\b|\bterm of\b|renewal|extension|duration/i],
  ["scope", /scope|specification|statement of work|products? (and|&) services|description of (work|services)/i],
  ["delivery", /deliver|shipping|freight|installation/i],
  ["warranty", /warrant|returns?\b/i],
  ["insurance", /insurance|indemn/i],
  ["termination", /terminat|cancell?ation/i],
];
const topicOf = (title: string): Topic | null => TOPICS.find(([, r]) => r.test(title))?.[0] ?? null;

export interface OutlineSection {
  /** The number the document gives it: "2", "2.1", "IV". */
  num: string | null;
  title: string;
  /** The page the document says it starts on. */
  page: number | null;
  level: 1 | 2;
  topic: Topic | null;
}
export interface Outline {
  document: string;
  url: string;
  pages: number;
  /** "contents" when read from the printed table of contents, "headings" when from the body. */
  from: "contents" | "headings";
  sections: OutlineSection[];
}

const tidy = (s: string) =>
  s
    .replace(/\s+/g, " ")
    .replace(/\s*[.·…]{2,}.*$/, "")
    .replace(/[:\-–\s]+$/, "")
    .trim();
const title = (s: string) => {
  const t = tidy(s);
  // Headings set in capitals read better in sentence case: "HOW TO USE THE CONTRACT" → "How to use the contract".
  return t === t.toUpperCase() && /[A-Z]{3}/.test(t) ? t.charAt(0) + t.slice(1).toLowerCase() : t;
};
const levelOf = (num: string): 1 | 2 => (/^\d+$|^[IVX]+$/i.test(num) ? 1 : 2);

/** Entries from a printed table of contents: a number, a title and a page number after a dot leader. */
function fromContents(pages: Page[]): OutlineSection[] {
  const lines = pages
    .slice(0, 10)
    .flatMap((p) => p.text.split("\n"))
    .map((l) => l.replace(/\s+$/, ""));
  // Join a title that wraps onto the next line before its dot leader.
  const joined: string[] = [];
  for (const l of lines) {
    const prev = joined[joined.length - 1];
    if (
      prev &&
      !/\.{3,}\s*\d+\s*$/.test(prev) &&
      /^\s*(?:section|article|part)?\s*[\dIVX]+(?:\.\d+)*[:.]?\s+\S/i.test(prev) &&
      !/^\s*(?:section|article|part)?\s*\d+(?:\.\d+)*[:.]?\s+\S/i.test(l) &&
      /\.{3,}\s*\d+\s*$/.test(l)
    )
      joined[joined.length - 1] = `${prev} ${l.trim()}`;
    else joined.push(l);
  }
  const out: OutlineSection[] = [];
  const entry = /^\s*(?:(?:SECTION|ARTICLE|PART)\s+([0-9]+|[IVX]+)[:.\-–\s]+|(\d{1,2}(?:\.\d{1,2}){0,2})\.?\s+)(.+?)\s*\.{3,}\s*(\d{1,4})\s*$/i;
  for (const l of joined) {
    const m = l.match(entry);
    if (!m) continue;
    const num = m[1] ?? m[2];
    const t = title(m[3]);
    if (t.length < 3 || t.length > 140) continue;
    out.push({
      num,
      title: t,
      page: Number(m[4]),
      level: m[1] ? 1 : levelOf(num),
      topic: topicOf(t),
    });
  }
  return out;
}

/** Numbered headings in the body, when there's no table of contents: "SECTION 3: PRICING", "4. TERM OF CONTRACT". */
function fromHeadings(pages: Page[]): OutlineSection[] {
  const out: OutlineSection[] = [];
  const seen = new Set<string>();
  const heading = /^\s*(?:(?:SECTION|ARTICLE|PART)\s+([0-9]+|[IVX]+)[:.\-–\s]+([A-Z][A-Za-z ,&/'()-]{2,80})|(\d{1,2})\.\s+([A-Z][A-Z ,&/'()-]{3,70}))\s*$/;
  for (const p of pages)
    for (const l of p.text.split("\n")) {
      const m = l.match(heading);
      if (!m) continue;
      const num = m[1] ?? m[3];
      if (seen.has(num)) continue;
      seen.add(num);
      const t = title(m[2] ?? m[4]);
      out.push({ num, title: t, page: p.num, level: 1, topic: topicOf(t) });
    }
  return out;
}

export function outlineOf(pages: Page[]): { from: Outline["from"]; sections: OutlineSection[] } | null {
  const contents = fromContents(pages);
  if (contents.length >= 3) return { from: "contents", sections: contents.slice(0, 120) };
  const headings = fromHeadings(pages);
  if (headings.length >= 3) return { from: "headings", sections: headings.slice(0, 60) };
  return null;
}

const ORDER: DocRole[] = ["agreement", "addendum", "guidance", "amendment", "solicitation", "other", "exhibit"];

/** The outline of a contract's main document, from text Loci already holds or has stored. Null when there's none. */
export async function contractOutline(db: Db, id: string): Promise<Outline | null> {
  const own = db.contracts.find((c) => c.id === id);
  const catId = own?.catalog_id ?? (catalogIndex().contractById.has(id) ? id : null);
  const docs: { label: string; url: string }[] = [...(own?.documents ?? []), ...(catId ? catalogDocumentsFor(catId) : [])];
  const ranked = docs
    .map((d) => ({ ...d, role: docRole(d.label, d.url) }))
    .filter((d) => ORDER.includes(d.role) && !/\.(xlsx?|csv)(\?|$)/i.test(d.url))
    .sort((a, b) => ORDER.indexOf(a.role) - ORDER.indexOf(b.role));
  let tried = 0;
  for (const d of ranked) {
    const pages = heldPages(d.url) ?? (hasDatabase() && tried < 8 ? (tried++, await storedPages(d.url)) : null);
    if (!pages?.length || pages.length < 2) continue;
    const o = outlineOf(pages);
    if (o) return { document: d.label, url: d.url, pages: pages.length, ...o };
  }
  return null;
}
