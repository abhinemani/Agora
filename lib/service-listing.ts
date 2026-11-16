// Service listings: a supplier's services, where it works, the public work it has done and the
// certifications it holds, for buyers searching for a service ("Metroplex window washing").
// Pure functions, safe on client and server. The listing is free for now; it could become part
// of a paid storefront plan (lib/revenue_rules.ts) once the product decision is made.

import type { CertificationKind, Supplier, SupplierService } from "./types";

/** Places buyers name that span several counties, with the counties they mean. */
export const REGIONS: { state: string; name: string; words: RegExp; counties: string[]; source: string }[] = [
  {
    state: "TX",
    name: "the Dallas–Fort Worth Metroplex",
    words: /\b(metroplex|dfw|dallas[\s-]+fort[\s-]+worth|north texas)\b/i,
    // The Dallas–Fort Worth–Arlington metropolitan statistical area, as OMB delineates it.
    counties: ["Collin", "Dallas", "Denton", "Ellis", "Hunt", "Kaufman", "Rockwall", "Johnson", "Parker", "Tarrant", "Wise"],
    source: "the Dallas–Fort Worth–Arlington metropolitan area's 11 counties (OMB)",
  },
];

/** The region a request names, if any. */
export const regionIn = (text: string) => REGIONS.find((r) => r.words.test(text)) ?? null;

/** Words that say where or how, not what: left out when matching a request to a service. */
const NOT_THE_SERVICE = new Set(["service", "services", "company", "companies", "vendor", "vendors", "contractor", "contractors", "provider", "providers", "local", "near", "area", "needed", "need", "for", "the", "and", "our", "city", "county", "town", "metroplex", "dfw", "dallas", "fort", "worth", "north", "texas", "quote", "quotes"]);
// "washing" and "cleaning" are the same job for windows, pressure washing and the like.
const STEMS: [RegExp, string][] = [
  [/^(wash|washing|washes|clean|cleaning|cleans|cleaner|cleaners)$/, "clean"],
  [/^windows?$/, "window"],
  [/^(mow|mowing|lawns?|landscap\w*)$/, "lawn"],
];
const stem = (w: string) => STEMS.find(([re]) => re.test(w))?.[1] ?? w.replace(/(ing|es|s)$/, "");

/** A request's or a service's words, as the matcher compares them. */
export function serviceWords(text: string): string[] {
  return [
    ...new Set(
      text
        .toLowerCase()
        .replace(/[^a-z0-9 ]/g, " ")
        .split(/\s+/)
        .filter((w) => w.length > 2 && !NOT_THE_SERVICE.has(w))
        .map(stem),
    ),
  ];
}

/** How well a supplier's services cover a request, 0 to 1, and the service that covers it best. */
export function serviceFit(services: SupplierService[] | undefined, request: string): { fit: number; service: SupplierService | null } {
  const asked = serviceWords(request);
  if (!asked.length || !services?.length) return { fit: 0, service: null };
  let best = { fit: 0, service: null as SupplierService | null };
  for (const s of services) {
    const has = new Set(serviceWords([s.name, s.detail ?? "", ...(s.aliases ?? [])].join(" ")));
    const fit = asked.filter((w) => has.has(w)).length / asked.length;
    if (fit > best.fit) best = { fit, service: s };
  }
  return best;
}

/** Whether a supplier works in any of these counties (a directory county field can name two: "Collin/Denton"). */
export function servesCounties(s: Pick<Supplier, "service_area">, state: string, counties: string[]): boolean {
  if (!s.service_area || s.service_area.state !== state) return false;
  const mine = new Set(s.service_area.counties.map(countyKey));
  return counties.some((c) => mine.has(countyKey(c)));
}

/** "Johnson County", "JOHNSON" and "Johnson" are one county; "Mclennan" and "McLennan" too. */
export const countyKey = (c: string) => c.toLowerCase().replace(/\s+county$/, "").replace(/\s+/g, " ").trim();

export const splitCounties = (field: string | undefined | null) => (field ? field.split("/").map((c) => c.trim()).filter(Boolean) : []);

/** The certifications Loci knows how to check, and the ones it can only record. */
export const CERTIFICATION_KINDS: Record<CertificationKind, { label: string; issuer: string; checkable: boolean; note: string }> = {
  tx_cmbl_small_business: {
    label: "Texas small business (CMBL)",
    issuer: "Texas Comptroller, Centralized Master Bidders List",
    checkable: true,
    note: "The Comptroller's bidders list records whether a registered vendor is a small business.",
  },
  tx_vethub: {
    label: "Texas VetHUB",
    issuer: "Texas Comptroller, VetHUB program",
    checkable: true,
    note: "Texas's historically underutilized business (HUB) certification, now VetHUB: for businesses at least 51 percent owned by Texas service-disabled veterans (34 TAC ch. 20, effective May 12, 2026).",
  },
  other: {
    label: "Other certification",
    issuer: "",
    checkable: false,
    note: "Loci has no live check for this registry, so it stays self-reported.",
  },
};

export const CMBL_SEARCH_URL = "https://mycpa.cpa.state.tx.us/tpasscmblsearch/index.jsp";

/** Whether a claim stands confirmed by its registry. */
export const certConfirmed = (c: { check?: { status: string } }) => c.check?.status === "confirmed";

/** A supplier on the results page for a service request: who offers it, where, and what Loci has checked. */
export interface LocalSupplierHit {
  supplier_id: string;
  name: string;
  city: string;
  state: string;
  service: { name: string; detail?: string; price: { amount: number; unit: string } | null };
  /** The counties it works in, and whether they include the place asked about. */
  area: { state: string; counties: string[]; covers: boolean } | null;
  certifications: { label: string; status: "confirmed" | "not_listed" | "not_found" | "unreachable" | "self_reported"; checked_at: string | null }[];
  past_work: { total: number; matched: number; nearby: number };
  claimed: boolean;
}
