/** Agora's app mark: a rounded tile with a geometric "A", next to the name in plain bold type. */
export function Logo({ withName = true }: { withName?: boolean }) {
  return (
    <span className="flex items-center gap-2.5">
      <svg viewBox="0 0 32 32" className="h-9 w-9 shrink-0" aria-hidden>
        <rect width="32" height="32" rx="8" className="fill-primary" />
        <path d="M9 24 L16 8 L23 24" fill="none" className="stroke-white" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M11.6 18.4 H20.4" fill="none" className="stroke-white" strokeWidth="3.2" strokeLinecap="round" />
      </svg>
      {withName && <span className="font-ui text-[1.4rem] font-bold leading-none text-ink">Agora</span>}
    </span>
  );
}
