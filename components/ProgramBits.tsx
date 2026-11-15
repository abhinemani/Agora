// Pieces shared by the program index and the program pages. No server-only imports.

import { supplierColor } from "@/components/ui";
import type { ProgramSummary } from "@/lib/programs";

/** A program's monogram: its state's code for a state office, else its initials. */
export function programMark(p: Pick<ProgramSummary, "name" | "state" | "coop_id">): string {
  if (p.coop_id === "trx_epc") return "EPC";
  if (p.coop_id === "state_ny_ps") return "PS";
  if (p.coop_id === "coop_naspo") return "NVP";
  if (p.state) return p.state;
  const words = p.name.replace(/&/g, " ").split(/\s+/).filter(Boolean);
  if (words.length === 1) return words[0].slice(0, /^\d/.test(words[0]) ? 4 : 2).toUpperCase();
  return words
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();
}

export const programColor = (p: Pick<ProgramSummary, "coop_id">) => supplierColor(p.coop_id);

export function ProgramMark({ p, size = "md" }: { p: Pick<ProgramSummary, "name" | "state" | "coop_id">; size?: "md" | "lg" }) {
  const mark = programMark(p);
  const box = size === "lg" ? "h-[72px] w-[72px] rounded-2xl border-4 border-white shadow-sm" : "h-11 w-11 rounded-xl";
  const text = size === "lg" ? (mark.length > 2 ? "text-xl" : "text-2xl") : mark.length > 2 ? "text-xs" : "text-base";
  return (
    <span className={`grid shrink-0 place-items-center font-extrabold tracking-tight text-[#fff] ${box} ${text}`} style={{ background: programColor(p) }}>
      {mark}
    </span>
  );
}

export function ProgramKindTag({ p }: { p: Pick<ProgramSummary, "kind" | "trx"> }) {
  if (p.trx)
    return (
      <span className="rounded bg-success-lighter px-1.5 py-0.5 text-[10px] font-bold text-success-darker" title="A state program on TRX, which Sovra supports. Loci lists it ahead of co-op contracts for that state's buyers.">
        State program · TRX
      </span>
    );
  return <span className="rounded bg-primary-lighter px-1.5 py-0.5 text-[10px] font-bold text-primary-darker">{p.kind === "state" ? "State program" : "Cooperative"}</span>;
}
