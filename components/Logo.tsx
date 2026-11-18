import { Mark } from "./blueprint";

/** Agora's logo: the mark (two sets of corner ticks closing in on the one that fits) beside the name.
 * Newsreader's line box carries extra room below the letters, so a centered row sits them 0.15em
 * high; the nudge puts the letters' middle on the mark's center line. */
export function Logo({ withName = true }: { withName?: boolean }) {
  return (
    <span className="flex items-center gap-2.5">
      <Mark />
      {withName && <span className="relative top-[0.15em] font-logo text-[1.6rem] font-semibold leading-none tracking-[-0.015em] text-ink">Agora</span>}
    </span>
  );
}
