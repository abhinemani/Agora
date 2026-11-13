/** Agora's mark: a serif "A" inside four corner ticks, the same registration marks that
 * frame the home page's search box. Agora frames what you need. */
export function Logo({ withName = true }: { withName?: boolean }) {
  return (
    <span className="flex items-center gap-2.5 text-primary">
      <svg viewBox="0 0 32 32" className="h-9 w-9 shrink-0" aria-hidden>
        <path d="M3.5 10 V3.5 H10 M22 3.5 H28.5 V10 M28.5 22 V28.5 H22 M10 28.5 H3.5 V22" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="square" />
        <text x="16" y="22.6" textAnchor="middle" fontFamily="Merriweather, Georgia, serif" fontWeight="900" fontSize="17" fill="currentColor">
          A
        </text>
      </svg>
      {withName && <span className="font-ui text-[1.4rem] font-bold leading-none tracking-[-0.01em] text-ink">Agora</span>}
    </span>
  );
}
