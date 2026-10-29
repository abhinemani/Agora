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
