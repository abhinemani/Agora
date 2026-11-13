import { Mark } from "./blueprint";

/** Agora's logo: the mark (two sets of corner ticks closing in on the one that fits) beside the name. */
export function Logo({ withName = true }: { withName?: boolean }) {
  return (
    <span className="flex items-center gap-2.5">
      <Mark />
      {withName && <span className="font-ui text-[1.4rem] font-bold leading-none tracking-[-0.01em] text-ink">Agora</span>}
    </span>
  );
}
