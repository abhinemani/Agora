// The three seeded sample contracts offered in the upload drop zone, so the demo
// never depends on the viewer having a file. Files live in seed/contracts/.

export const SAMPLE_CONTRACTS = [
  {
    id: "state",
    label: "State office supplies",
    owner: "State of Oregon DAS · PA-5508-OP",
    blurb: "Price agreement PDF with the price list attached as an XLSX exhibit.",
    files: ["state-office-supplies-contract.pdf", "state-office-supplies-exhibit-b.xlsx"],
  },
  {
    id: "city",
    label: "City furniture",
    owner: "City of Riverbend · RB-2026-031",
    blurb: "City contract PDF with a price schedule table, including tiered pricing.",
    files: ["riverbend-furniture-contract.pdf"],
  },
  {
    id: "coop",
    label: "Co-op janitorial",
    owner: "Western States Purchasing Cooperative · WSPC-JN-1125",
    blurb: "Prices written in prose plus a messy, wrapped table.",
    files: ["coop-janitorial-contract.pdf"],
  },
] as const;

export type SampleId = (typeof SAMPLE_CONTRACTS)[number]["id"];

/** Downloadable files in public/test-contracts/ for trying a real upload. Each
 * covers a format or edge case the one-click samples don't. */
export const TEST_FILES = [
  {
    file: "techsource-it-peripherals.docx",
    format: "DOCX",
    title: "IT peripherals reseller addendum",
    tests: "A Word table, a reseller source, and a SKU already in the storefront at a new price.",
  },
  {
    file: "evergreen-public-works-materials.pdf",
    format: "PDF",
    title: "Riverbend public works materials",
    tests: "No piggyback clause, so other storefronts stay locked. A price range lands in Unresolved.",
  },
  {
    file: "fleet-parts-price-list.csv",
    format: "CSV",
    title: "Fleet parts price list",
    tests: "A bare price list with no contract terms. Type in a supplier name before publishing.",
  },
  {
    file: "scanned-custodial-contract.pdf",
    format: "PDF",
    title: "Scanned custodial contract",
    tests: "An image-only scan. Shows the clear no-OCR message instead of failing silently.",
  },
] as const;
