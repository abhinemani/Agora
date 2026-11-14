import { allStateRules, STATE_RULES_RESEARCHED } from "@/lib/state-rules";
import { Flagged, tierTone } from "./StateRuleBits";

/** The report's own light markdown: **bold** and [label](url), nothing else. */
function Prose({ text }: { text: string }) {
  const out: React.ReactNode[] = [];
  const re = /\*\*(.+?)\*\*|\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    out.push(
      m[1] ? (
        <strong key={m.index}>{m[1]}</strong>
      ) : (
        <a key={m.index} href={m[3]} target="_blank" rel="noopener noreferrer" className="text-primary underline">
          {m[2]}
        </a>
      ),
    );
    last = m.index + m[0].length;
  }
  out.push(text.slice(last));
  return <>{out}</>;
}

/** Every state's rule on one page: the summary row, and the report's section with its statute links underneath. */
export function StateRulesTable() {
  const rules = allStateRules();
  const byTier = [5, 4, 3, 2, 1].map((t) => ({ t, n: rules.filter((r) => r.tier === t).length, label: rules.find((r) => r.tier === t)?.tier_label ?? "" }));
  return (
    <div>
      <div className="flex flex-wrap gap-2 text-ui-xs">
        {byTier.map(({ t, n, label }) => (
          <span key={t} className={`rounded-full px-2.5 py-0.5 font-bold ${tierTone(t)}`}>
            {t}/5 · {label.split(":")[0]}: {n} states
          </span>
        ))}
      </div>
      <div className="mt-4 divide-y divide-base-lighter overflow-hidden rounded-lg border-2 border-base-lighter bg-white">
        {rules.map((r) => (
          <details key={r.code} id={`state-${r.code}`} className="group scroll-mt-24 px-3 py-2 text-ui-xs">
            <summary className="flex cursor-pointer list-none flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className="w-28 font-bold text-ink">{r.state}</span>
              <span className={`rounded-full px-2 py-px text-[11px] font-bold ${tierTone(r.tier)}`}>{r.tier}/5</span>
              <span className="min-w-[14rem] flex-1 text-base-darker">
                <Flagged text={r.local} />
              </span>
              <span className="text-base-dark">Formal bid: <Flagged text={r.formal_bid.length > 70 ? r.formal_bid.slice(0, 68) + "…" : r.formal_bid} /></span>
            </summary>
            <div className="mt-2 grid gap-x-4 gap-y-1 pb-2 text-base-darker sm:grid-cols-[10rem_1fr]">
              <span className="text-base-dark">School districts</span>
              <span><Flagged text={r.schools} /></span>
              <span className="text-base-dark">State list or approval</span>
              <span><Flagged text={r.state_list} /></span>
              <span className="text-base-dark">Agreement or board action</span>
              <span><Flagged text={r.agreement} /></span>
              <span className="text-base-dark">Lead-contract test</span>
              <span><Flagged text={r.lead_test} /></span>
              <span className="text-base-dark">Excluded or restricted</span>
              <span><Flagged text={r.excluded} /></span>
              <span className="text-base-dark">Thresholds</span>
              <span>
                <Flagged text={`None needed: ${r.no_competition}. Quotes: ${r.quotes}. Formal bid: ${r.formal_bid}. (${r.threshold_source})`} />
              </span>
            </div>
            <div className="max-w-[80ex] space-y-2 pb-2 leading-relaxed text-base-darker">
              {r.detail.split(/\n\s*\n/).map((p, i) => (
                <p key={i}>
                  <Prose text={p} />
                </p>
              ))}
            </div>
          </details>
        ))}
      </div>
      <p className="mt-2 text-ui-3xs text-base-dark">
        Research of {STATE_RULES_RESEARCHED}. Flags: [mirror] read on a third-party site, [secondary] from a league, firm or vendor source, [unverified] not confirmed,
        [currency unconfirmed] may have been amended. Not legal advice.
      </p>
    </div>
  );
}
