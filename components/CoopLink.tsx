"use client";

import { goHref } from "@/lib/coops";

/** Sends the buyer to a co-op's own contract page through the tracked redirect. */
export function CoopLink({
  contractId,
  coop,
  hasLink,
  listingId,
  requestId,
  size = "sm",
  disabled,
}: {
  contractId: string;
  coop: string;
  hasLink: boolean;
  listingId?: string | null;
  requestId?: string | null;
  size?: "sm" | "md";
  disabled?: boolean;
}) {
  const pad = size === "md" ? "px-5 py-3" : "px-4 py-2.5";
  if (!hasLink || disabled)
    return (
      <span className={`inline-flex cursor-not-allowed items-center rounded-md bg-disabled-lighter text-ui-xs font-bold leading-none text-disabled-dark ${pad}`} title={hasLink ? undefined : "No contract-level link on file yet"}>
        {hasLink ? "Not available" : "Contract link missing"}
      </span>
    );
  return (
    <a
      href={goHref(contractId, { listing: listingId, request: requestId })}
      target="_blank"
      rel="noreferrer"
      className={`inline-flex items-center rounded-md bg-primary text-ui-xs font-bold leading-none text-white no-underline hover:bg-primary-dark active:bg-primary-darker ${pad}`}
      title={`Opens this contract on ${coop}'s site`}
    >
      Buy on {shortName(coop)} ↗
    </a>
  );
}

/** Button-sized names: "NASPO ValuePoint" → "NASPO", "Western States Purchasing Cooperative" → "WSPC". */
function shortName(coop: string) {
  const first = coop.split(" ")[0];
  if (first.length > 2 && first === first.toUpperCase()) return first;
  return coop.length > 18 ? coop.replace(/\b(\w)\w*\s*/g, "$1").toUpperCase() : coop;
}
