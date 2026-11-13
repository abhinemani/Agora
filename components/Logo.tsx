/** Agora's mark: two sets of corner ticks closing in on one solid square. Every contract
 * on the outside, the one that fits in the middle. The ticks are the same registration
 * marks that frame the home page's search box. Colors follow the theme, so dark mode works. */
export function Logo({ withName = true }: { withName?: boolean }) {
  return (
    <span className="flex items-center gap-2.5">
      <svg viewBox="0 0 32 32" className="h-9 w-9 shrink-0" aria-hidden>
        <path d="M2.5 9V2.5H9M23 2.5H29.5V9M29.5 23V29.5H23M9 29.5H2.5V23" fill="none" className="stroke-primary-light/60" strokeWidth="1.6" strokeLinecap="square" />
        <path d="M8 13V8H13M19 8H24V13M24 19V24H19M13 24H8V19" fill="none" className="stroke-primary-light" strokeWidth="2" strokeLinecap="square" />
        <rect x="13" y="13" width="6" height="6" className="fill-primary-darker" />
      </svg>
      {withName && <span className="font-ui text-[1.4rem] font-bold leading-none tracking-[-0.01em] text-ink">Agora</span>}
    </span>
  );
}
