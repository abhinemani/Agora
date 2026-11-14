// Pieces shared by the state rule note (client) and the /data state table (server). No hooks, so both can use them.

/** "[mirror]" and the other research flags, set in small grey type so the finding reads first. */
export function Flagged({ text }: { text: string }) {
  const parts = text.split(/(\[[^\]]+\])/g);
  return (
    <>
      {parts.map((p, i) =>
        /^\[[^\]]+\]$/.test(p) ? (
          <span key={i} className="whitespace-nowrap text-[10px] font-semibold uppercase tracking-wide text-slate" title={FLAG_HELP[p.slice(1, -1).split(/[;,]/)[0].trim()] ?? "A note from the research"}>
            {p}
          </span>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </>
  );
}

const FLAG_HELP: Record<string, string> = {
  mirror: "Read on a third-party site (Justia, FindLaw and similar), not the official code",
  secondary: "Rests on a league, law-firm, association or vendor source, not checked against statute text",
  unverified: "Could not be confirmed in any source read",
  "currency unconfirmed": "The text read may have been amended since",
};

export function tierTone(tier: number) {
  return tier >= 4 ? "bg-emerald-50 text-emerald-800" : tier === 3 ? "bg-amber-50 text-amber-800" : "bg-error-lighter text-error-dark";
}
