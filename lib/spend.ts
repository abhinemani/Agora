// Seeded spend intelligence for Riverbend, fiscal year to date. Live orders from
// the demo are added on top by the dashboard.

import type { Source } from "./types";

export const SPEND_BY_SOURCE: { key: Source | "solicitation"; label: string; amount: number }[] = [
  { key: "solicitation", label: "Own solicitations", amount: 6_200_000 },
  { key: "own_contract", label: "Riverbend contracts", amount: 4_820_000 },
  { key: "state_contract", label: "State contracts", amount: 2_310_000 },
  { key: "coop_contract", label: "Co-op contracts", amount: 1_640_000 },
  { key: "reseller", label: "Resellers", amount: 980_000 },
  { key: "gsa", label: "GSA schedules", amount: 410_000 },
  { key: "no_approval", label: "No approval (small purchases)", amount: 370_000 },
];

export const OFF_CONTRACT_TOTAL = 1_120_000;

export const NO_CONTRACT_CATEGORIES = [
  { category: "Facilities and MRO", amount: 318_000, note: "Lighting parts, HVAC filters, plumbing" },
  { category: "Fleet and parts", amount: 264_000, note: "Brakes, tires, plow blades" },
  { category: "Professional services", amount: 211_000, note: "Inspections, small engineering tasks" },
  { category: "Public works materials", amount: 176_000, note: "Cold patch, signage blanks" },
  { category: "Software and services", amount: 98_000, note: "Departmental SaaS on P-cards" },
];

export const PRICE_CHECKS = [
  { item: "Copy paper, letter, 10-ream case", supplier: "Riverside Office Supply", contract: 46.8, paid: 49.8, invoices: 14 },
  { item: "Trash liners, 40-45 gal, case of 250", supplier: "CleanLine Janitorial Supply", contract: 38.5, paid: 41.2, invoices: 9 },
  { item: "Stacking chair, poly shell", supplier: "Riverside Office Supply", contract: 48, paid: 48, invoices: 3 },
  { item: "Safety vest, hi-vis, Class 2", supplier: "Patriot Safety & Uniform", contract: 9.8, paid: 9.8, invoices: 5 },
  { item: "Monitor, 24 in", supplier: "TechSource Government Solutions", contract: 159, paid: 159, invoices: 7 },
  { item: "Multi-surface cleaner, 1 gal", supplier: "CleanLine Janitorial Supply", contract: 21.75, paid: 21.75, invoices: 11 },
];

export const PEER_PRICES = [
  { item: "Copy paper, letter, 10-ream case", ours: 46.8, peers: [{ agency: "Town of Millbrook", price: 44.1 }, { agency: "Harper County", price: 45.25 }, { agency: "City of Ashford", price: 47.9 }] },
  { item: "Folding table, 6 ft", ours: 264, peers: [{ agency: "Harper County", price: 279 }, { agency: "Town of Millbrook", price: 248 }, { agency: "Lakeview School District", price: 255 }] },
  { item: "Trash liners, 40-45 gal, case of 250", ours: 38.5, peers: [{ agency: "City of Ashford", price: 34.9 }, { agency: "Harper County", price: 36.75 }, { agency: "Town of Millbrook", price: 39.1 }] },
];
