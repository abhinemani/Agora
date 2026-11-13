"use client";

import { useEffect, useRef, useState } from "react";
import type { DirectoryGovernment } from "@/lib/types";
import { ENTITY_LABEL } from "@/lib/vehicles";

/** Typeahead over Agora's co-op directory: 130,000 governments from the Census of Governments, NCES, IPEDS, co-op rosters, agency pages, Texas DIR and the .gov registry. */
export function DirectorySearch({
  onPick,
  placeholder = "Start typing your agency's name",
  state,
  autoFocus,
  label = "Find your agency",
}: {
  onPick: (g: DirectoryGovernment) => void;
  placeholder?: string;
  state?: string;
  autoFocus?: boolean;
  label?: string;
}) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<DirectoryGovernment[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [loading, setLoading] = useState(false);
  const seq = useRef(0);
  /** The name just picked: putting it in the box shouldn't search again. */
  const picked = useRef<string | null>(null);

  useEffect(() => {
    const query = q.trim();
    if (picked.current !== null && q === picked.current) return;
    picked.current = null;
    if (query.length < 2) {
      setResults([]);
      return;
    }
    const n = ++seq.current;
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/directory?q=${encodeURIComponent(query)}${state ? `&state=${state}` : ""}`);
        const json = await res.json();
        if (n === seq.current) {
          setResults(json.results ?? []);
          setActive(0);
          setOpen(true);
        }
      } finally {
        if (n === seq.current) setLoading(false);
      }
    }, 180);
    return () => clearTimeout(t);
  }, [q, state]);

  const pick = (g: DirectoryGovernment) => {
    seq.current++;
    picked.current = g.name;
    setQ(g.name);
    setOpen(false);
    onPick(g);
  };

  return (
    <div className="relative">
      <label className="block text-xs font-semibold text-slate">
        {label}
        <input
          value={q}
          autoFocus={autoFocus}
          onChange={(e) => setQ(e.target.value)}
          onFocus={() => results.length && setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={(e) => {
            if (!open || !results.length) return;
            if (e.key === "ArrowDown") (e.preventDefault(), setActive((a) => Math.min(a + 1, results.length - 1)));
            else if (e.key === "ArrowUp") (e.preventDefault(), setActive((a) => Math.max(a - 1, 0)));
            else if (e.key === "Enter") (e.preventDefault(), pick(results[active]));
            else if (e.key === "Escape") setOpen(false);
          }}
          placeholder={placeholder}
          role="combobox"
          aria-expanded={open}
          aria-controls="directory-results"
          aria-autocomplete="list"
          className="mt-1 w-full"
        />
      </label>
      {open && q.trim().length >= 2 && (
        <ul id="directory-results" role="listbox" className="absolute z-30 mt-1 max-h-80 w-full overflow-auto rounded-md border border-base-lighter bg-white shadow-card">
          {!results.length && <li className="px-3 py-2 text-sm text-slate">{loading ? "Searching…" : "Not in the directory. Enter it by hand below."}</li>}
          {results.map((g, i) => (
            <li
              key={g.id}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => (e.preventDefault(), pick(g))}
              onMouseEnter={() => setActive(i)}
              className={`cursor-pointer px-3 py-2 ${i === active ? "bg-primary-lighter" : ""}`}
            >
              <div className="text-sm font-semibold text-navy">
                {g.name}, {g.state}
              </div>
              <div className="text-[11px] text-slate">
                {ENTITY_LABEL[g.entity_type]}
                {g.city && g.city !== g.name ? ` · ${g.city}` : ""}
                {` · ${g.coops.length ? `${g.coops.length} co-op${g.coops.length === 1 ? "" : "s"} on file` : "no co-ops on file"}`}
                {g.domain ? ` · ${g.domain}` : ""}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
