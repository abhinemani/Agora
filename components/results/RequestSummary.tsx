"use client";

import type { Buyer, Request } from "@/lib/types";
import { money } from "@/components/ui";

const label = "font-mono text-[10.5px] uppercase tracking-[0.12em]";

function Field({ name, value, note, missing = false, flagged = false }: { name: string; value: string; note?: string; missing?: boolean; flagged?: boolean }) {
  return (
    <div className={`flex flex-col gap-0.5 px-4 pb-3.5 pt-3 ${flagged ? "bg-warning-lighter" : "bg-white"}`}>
      <dt className={`${label} ${flagged ? "text-warning-darker" : "text-base-dark"}`}>{name}</dt>
      <dd className={`text-body-md font-bold leading-snug ${missing && !flagged ? "text-base-dark" : "text-ink"}`}>{value}</dd>
      {note && <dd className={`text-ui-3xs ${flagged ? "text-warning-darker" : "text-base-dark"}`}>{note}</dd>}
    </div>
  );
}

/** The request as a formal query: what was read from the buyer's words, field by field.
 * The words themselves sit underneath, small, as the record of what was entered. */
export function RequestSummary({ request, buyer, counts, onAgency, changing }: { request: Request; buyer: Buyer | null; counts: string | null; onAgency: () => void; changing: boolean }) {
  const p = request.parsed;
  const item = p.item ? p.item.charAt(0).toUpperCase() + p.item.slice(1) : request.raw_text;
  return (
    <div className="bg-[#162E51] px-5 pb-5 pt-4 text-white">
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
        <h1 className={`${label} text-[#A9C9EC]`}>Request</h1>
        {counts && <p className="text-ui-2xs text-[#C9DCF1]">{counts}</p>}
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-px border border-[#4A6C9B] bg-[#4A6C9B] lg:grid-cols-[repeat(auto-fit,minmax(160px,1fr))]" title={request.parse_mode === "llm" ? "Read by Claude" : "Read with offline rules"}>
        <Field name="Item" value={item} note={p.category ?? undefined} />
        <Field name="Quantity" value={String(p.quantity)} />
        <Field name="Needed by" value={p.deadline ? p.deadline.charAt(0).toUpperCase() + p.deadline.slice(1) : "Not specified"} missing={!p.deadline} />
        {p.department && <Field name="Department" value={p.department} />}
        <Field name="Estimated total" value={p.est_total ? `About ${money(p.est_total, false)}` : "Not priced"} missing={!p.est_total} note={request.preference_answer === "yes" ? "Local and MBE preference applied" : undefined} />
        <Field name="Agency" value={buyer ? buyer.name : "Not selected"} note={buyer ? buyer.state : "Required to check eligibility"} flagged={!buyer} />
      </dl>
      <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2">
        <p className="min-w-0 flex-[1_1_320px] text-ui-2xs text-[#C9DCF1]">Entered as: “{request.raw_text}”</p>
        <button type="button" onClick={onAgency} className="inline-flex min-h-[44px] items-center rounded-md border border-[#A9C9EC] px-4 text-ui-xs font-bold text-white hover:bg-white/10">
          {changing ? "Cancel" : buyer ? "Change agency" : "Select agency"}
        </button>
      </div>
    </div>
  );
}
