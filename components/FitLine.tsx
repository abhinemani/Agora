// The model's judgment of how a product fits the request (lib/dive-ai.ts judgeFit), shown on the front door's and
// /dive's product cards.

import type { FitVerdict } from "@/lib/dive";

const FIT_LABEL: Record<FitVerdict, string> = { fits: "Fits", partly: "Partly fits", no: "Doesn't fit" };

export function FitLine({ verdict, reason }: { verdict: FitVerdict; reason?: string }) {
  const tone = verdict === "fits" ? "bg-success-lighter text-success-darker" : verdict === "partly" ? "bg-warning-lighter text-ink" : "bg-base-lighter text-base-darker";
  return (
    <span className="flex flex-wrap items-baseline gap-x-2 text-ui-2xs text-base-darker">
      <span className={`px-1.5 py-px text-ui-3xs font-bold ${tone}`}>{FIT_LABEL[verdict]}</span>
      {reason && <span>{reason}</span>}
    </span>
  );
}

/** Products the model judged not to be what was asked for: off the shortlist, but one click away with the reasons. */
export function SetAside({ items }: { items: { id: string; name: string; fit_reason?: string }[] }) {
  if (!items.length) return null;
  return (
    <details className="border border-dashed border-base-light bg-white px-4 py-2.5 text-ui-2xs text-base-darker">
      <summary className="cursor-pointer font-bold text-ink">
        {items.length} set aside as not what was asked for
      </summary>
      <ul className="mt-2 space-y-1">
        {items.map((i) => (
          <li key={i.id}>
            <span className="text-ink">{i.name}</span>
            {i.fit_reason && <span className="text-base-dark">: {i.fit_reason}</span>}
          </li>
        ))}
      </ul>
    </details>
  );
}
