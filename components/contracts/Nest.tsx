// A tree drawn with rules and elbows (styles in app/globals.css): the program at the top,
// then the award or master agreement, the contract, and its documents. Plain nested lists,
// so a screen reader hears the nesting too.

export function Nest({ children, root, className = "", label }: { children: React.ReactNode; root?: boolean; className?: string; label?: string }) {
  return (
    <ul className={`nest ${root ? "nest-root" : ""} ${className}`} aria-label={label}>
      {children}
    </ul>
  );
}

/** One node. `path` marks the line from the top down to the contract on the page. */
export function Twig({ children, path, className = "" }: { children: React.ReactNode; path?: boolean; className?: string }) {
  return <li className={`${path ? "nest-path" : ""} ${className}`}>{children}</li>;
}

/** What a node is, in small capitals: Program, Award, This contract, Pricing. */
export function NodeTag({ children, here }: { children: React.ReactNode; here?: boolean }) {
  return <span className={`shrink-0 font-mono text-[10.5px] uppercase tracking-[0.14em] ${here ? "text-primary" : "text-base-dark"}`}>{children}</span>;
}

/** Who let an award, as a phrase: "let by New York State Office of General Services". Some leads are a description already. */
export const letBy = (lead: string) => (/addendum|adopted/i.test(lead) ? lead : `let by ${lead}`);

/** Long co-op titles are lists of categories ("Facilities & MRO; Air Filtration; …"): the first names it, the rest are scope. */
export function splitTitle(t: string): { head: string; rest: string[] } {
  const parts = t.split(/\s*;\s*/).filter(Boolean);
  return parts.length > 2 && t.length > 80 ? { head: parts[0], rest: parts.slice(1) } : { head: t, rest: [] };
}
