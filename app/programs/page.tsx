"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ProgramKindTag, ProgramMark } from "@/components/ProgramBits";
import { ErrorNote, Loading } from "@/components/ui";
import type { ProgramSummary } from "@/lib/programs";

/** Every purchasing program in the catalog: the state programs Loci prefers, then the co-ops. */
export default function Programs() {
  const [programs, setPrograms] = useState<ProgramSummary[] | null | undefined>(undefined);
  useEffect(() => {
    fetch("/api/catalog/programs")
      .then((r) => r.json())
      .then((j) => setPrograms(j.programs ?? null))
      .catch(() => setPrograms(null));
  }, []);
  if (programs === undefined) return <Loading />;
  if (!programs) return <ErrorNote message="The programs couldn't be loaded. Try again in a moment." />;
  const states = programs.filter((p) => p.kind === "state");
  const coops = programs.filter((p) => p.kind === "coop");
  const total = programs.reduce((n, p) => n + p.contracts, 0);

  return (
    <div className="space-y-12 pb-8">
      <div className="max-w-2xl pt-6">
        <div className="text-[11px] font-extrabold uppercase text-maroon/80">Programs</div>
        <h1 className="mt-3 text-[clamp(2rem,4vw,2.8rem)] font-extrabold leading-[1.1] text-navy">Every program, and what it has under contract.</h1>
        <p className="mt-3 text-base leading-relaxed text-slate">
          A program is where a contract comes from: a state's purchasing office or a cooperative. Loci holds {total.toLocaleString()} current contracts from {programs.length} of them. Each page
          shows what the program covers, who holds its contracts, the prices on file and how a local government buys through it.
        </p>
      </div>

      <Group title="State programs" note="Contracts a state let and opened to its local governments. In TRX states they lead results for that state's buyers." programs={states} />
      <Group title="Cooperatives" note="Purchasing cooperatives that bid contracts once for many public agencies, from their public contract directories." programs={coops} />

      <p className="text-xs text-slate">
        Looking for a company rather than a program?{" "}
        <Link href="/storefronts" className="font-semibold text-maroon hover:underline">
          See storefronts
        </Link>
        .
      </p>
    </div>
  );
}

function Group({ title, note, programs }: { title: string; note: string; programs: ProgramSummary[] }) {
  return (
    <section>
      <h2 className="text-xl font-extrabold tracking-tight text-navy">{title}</h2>
      <p className="mt-1 max-w-2xl text-sm text-slate">{note}</p>
      <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {programs.map((p) => (
          <Link key={p.slug} href={`/programs/${p.slug}`} className="flex min-h-[220px] flex-col rounded-2xl border border-line bg-white p-5 no-underline transition hover:border-base-dark hover:shadow-2">
            <div className="flex items-start justify-between gap-3">
              <ProgramMark p={p} />
              <ProgramKindTag p={p} />
            </div>
            <div className="mt-4 text-lg font-bold tracking-tight text-navy">{p.name}</div>
            <p className="mt-1 line-clamp-3 text-xs leading-relaxed text-slate">{p.tagline}</p>
            <div className="mt-auto border-t border-base-lighter pt-3 text-xs text-slate">
              <span className="font-semibold text-navy">{p.contracts.toLocaleString()}</span> contract{p.contracts === 1 ? "" : "s"} ·{" "}
              <span className="font-semibold text-navy">{p.suppliers.toLocaleString()}</span> supplier{p.suppliers === 1 ? "" : "s"}
              {p.products > 0 && (
                <>
                  {" "}
                  · <span className="font-semibold text-navy">{p.products.toLocaleString()}</span> priced
                </>
              )}
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}
