// Pieces shared by the contract explorer, the contract page and the result cards
// that link to them. No hooks and no server-only imports, so any page can use them.

import type { AccessStatus } from "@/lib/contracts";

export const contractHref = (id: string) => `/contracts/${encodeURIComponent(id)}`;

export const shortDate = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

const ACCESS: Record<AccessStatus, { label: string; cls: string; title: string }> = {
  open: { label: "You can use this", cls: "bg-success-lighter text-success-darker", title: "Open to your agency today" },
  check: { label: "Needs a state addendum", cls: "bg-warning-lighter text-ink", title: "Open once your state signs a participating addendum" },
  join: { label: "Join to use", cls: "bg-primary-lighter text-primary-darker", title: "On a co-op your agency isn't on yet" },
  closed: { label: "Not open to you", cls: "bg-error-lighter text-error-dark", title: "Your agency can't use this contract" },
  unknown: { label: "Set your agency", cls: "bg-base-lighter text-base-darker", title: "Set your agency to see whether you can use it" },
};

/** Whether the buyer's agency can use a contract, as a tag. */
export function AccessTag({ access }: { access: AccessStatus }) {
  const a = ACCESS[access];
  return (
    <span className={`inline-flex shrink-0 items-center whitespace-nowrap rounded-sm px-2 py-0.5 text-ui-3xs font-bold ${a.cls}`} title={a.title}>
      {a.label}
    </span>
  );
}
