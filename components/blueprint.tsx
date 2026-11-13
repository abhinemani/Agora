/** Shared pieces of Agora's blueprint system: the mark, the best-fit badge, a corner-tick
 * frame, and the mono annotation label. Colors come from theme tokens, so dark mode works. */

/** Agora's mark: two sets of corner ticks closing in on one solid square. Every contract
 * on the outside, the one that fits in the middle. `working` animates the inner ticks
 * closing in, the one motion Agora uses while it searches. */
export function Mark({ className = "h-9 w-9", working = false, onDark = false }: { className?: string; working?: boolean; onDark?: boolean }) {
  return (
    <svg viewBox="0 0 32 32" className={`shrink-0 ${className}`} aria-hidden>
      <path d="M2.5 9V2.5H9M23 2.5H29.5V9M29.5 23V29.5H23M9 29.5H2.5V23" fill="none" className={onDark ? "stroke-[rgba(255,255,255,0.35)]" : "stroke-primary-light/60"} strokeWidth="1.6" strokeLinecap="square" />
      <path
        d="M8 13V8H13M19 8H24V13M24 19V24H19M13 24H8V19"
        fill="none"
        className={`${onDark ? "stroke-[#9DC2E8]" : "stroke-primary-light"} ${working ? "mark-closing" : ""}`}
        strokeWidth="2"
        strokeLinecap="square"
      />
      <rect x="13" y="13" width="6" height="6" className={onDark ? "fill-[#fff]" : "fill-primary-darker"} />
    </svg>
  );
}

/** The badge on the top-ranked option a buyer can act on right away. */
export function BestFit({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1 bg-primary-lighter py-0.5 pl-1 pr-1.5 text-ui-3xs font-bold text-primary-darker ${className}`}>
      <Mark className="h-3.5 w-3.5" />
      Best fit
    </span>
  );
}

/** Corner registration ticks around whatever it wraps, for featured or selected things. */
export function TickFrame({ children, className = "", tone = "border-primary-light", offset = "-6px" }: { children: React.ReactNode; className?: string; tone?: string; offset?: string }) {
  const tick = `pointer-events-none absolute h-3 w-3 ${tone}`;
  return (
    <div className={`relative ${className}`}>
      <span aria-hidden className={`${tick} border-l border-t`} style={{ left: offset, top: offset }} />
      <span aria-hidden className={`${tick} border-r border-t`} style={{ right: offset, top: offset }} />
      <span aria-hidden className={`${tick} border-b border-l`} style={{ left: offset, bottom: offset }} />
      <span aria-hidden className={`${tick} border-b border-r`} style={{ right: offset, bottom: offset }} />
      {children}
    </div>
  );
}

/** A drawing-style label: "FIG. 3 · ONE REQUEST, EVERY CONTRACT". */
export function Annotation({ fig, children, className = "text-primary" }: { fig?: number; children: React.ReactNode; className?: string }) {
  return (
    <div className={`font-mono text-[11px] uppercase tracking-[0.14em] ${className}`}>
      {fig !== undefined && <>FIG. {fig} · </>}
      {children}
    </div>
  );
}
