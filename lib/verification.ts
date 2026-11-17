// The checks behind a supplier's "Verified" badge. Demo suppliers carry demo
// results; every other supplier shows each check as not run yet, because Agora
// doesn't hold real SAM.gov or insurance results for real companies.

import type { Supplier, VerificationCheck } from "./types";

const UNCHECKED: Omit<VerificationCheck, "status" | "detail" | "checked_at">[] = [
  { id: "sam_registration", label: "SAM.gov registration", source: "SAM.gov entity registration" },
  { id: "sam_exclusions", label: "Not excluded from federal awards", source: "SAM.gov exclusions list" },
  { id: "section_889", label: "Section 889 certification", source: "Supplier's signed certification" },
  { id: "insurance", label: "Certificate of insurance", source: "Certificate on file" },
  { id: "bond", label: "Performance bond", source: "Bond on file" },
];

export function checksFor(s: Supplier): VerificationCheck[] {
  if (s.checks?.length) return s.checks;
  return UNCHECKED.map((c) => ({ ...c, status: "not_checked", detail: "Not checked yet", checked_at: null }));
}

export function verificationSummary(s: Supplier) {
  const checks = checksFor(s);
  return {
    checks,
    passed: checks.filter((c) => c.status === "pass").length,
    problems: checks.filter((c) => c.status === "fail" || c.status === "expiring").length,
    unchecked: checks.every((c) => c.status === "not_checked"),
  };
}

const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

/** Demo results for the fictional seeded suppliers. */
export function demoChecks(s: Supplier, opts: { samRenewsIn: number; certExpiresIn?: number }): VerificationCheck[] {
  const checked = day(-3);
  const checks: VerificationCheck[] = [
    {
      id: "sam_registration",
      label: "SAM.gov registration",
      status: opts.samRenewsIn < 30 ? "expiring" : "pass",
      detail: opts.samRenewsIn < 30 ? `Active, but expires ${day(opts.samRenewsIn)}` : `Active through ${day(opts.samRenewsIn)}`,
      source: "SAM.gov entity registration (demo data)",
      checked_at: checked,
    },
    { id: "sam_exclusions", label: "Not excluded from federal awards", status: "pass", detail: "No active exclusions", source: "SAM.gov exclusions list (demo data)", checked_at: checked },
    { id: "section_889", label: "Section 889 certification", status: "pass", detail: "Certifies no covered telecommunications equipment", source: "Signed certification (demo data)", checked_at: checked },
    {
      id: "insurance",
      label: "Certificate of insurance",
      status: s.verified.insurance ? "pass" : "fail",
      detail: s.verified.insurance ? "General liability, $2M aggregate" : "No current certificate on file",
      source: "Certificate on file (demo data)",
      checked_at: checked,
    },
    {
      id: "bond",
      label: "Performance bond",
      status: s.verified.bond ? "pass" : "not_checked",
      detail: s.verified.bond ? "On file" : "None on file; needed only for larger construction and service contracts",
      source: "Bond on file (demo data)",
      checked_at: s.verified.bond ? checked : null,
    },
  ];
  for (const cert of s.certifications)
    checks.push({
      id: "certification",
      label: `${cert} certification`,
      status: opts.certExpiresIn !== undefined && opts.certExpiresIn < 60 ? "expiring" : "pass",
      detail: opts.certExpiresIn !== undefined && opts.certExpiresIn < 60 ? `Expires ${day(opts.certExpiresIn)}` : `Current through ${day(opts.certExpiresIn ?? 400)}`,
      source: "State certification registry (demo data)",
      checked_at: checked,
    });
  return checks;
}
