"use client";

// The supplier's own editor for its service listing: services, where it works, past public work (each
// government matched against Agora's directory) and certifications (checked live where Agora can).

import Link from "next/link";
import { useEffect, useState } from "react";
import { CertificationLine } from "@/components/ServiceListing";
import { useStore } from "@/components/store";
import { Badge, Button, Card, ErrorNote } from "@/components/ui";
import { CERTIFICATION_KINDS, REGIONS } from "@/lib/service-listing";
import type { CertificationKind, DirectoryGovernment, Supplier, SupplierService } from "@/lib/types";
import { STATES } from "@/lib/vehicles";

type Draft = { id?: string; name: string; detail: string; aliases: string; amount: string; unit: string };
const toDraft = (s: SupplierService): Draft => ({ id: s.id, name: s.name, detail: s.detail ?? "", aliases: (s.aliases ?? []).join(", "), amount: s.price ? String(s.price.amount) : "", unit: s.price?.unit ?? "" });
const blank: Draft = { name: "", detail: "", aliases: "", amount: "", unit: "" };

export function ServiceListingEditor({ s }: { s: Supplier }) {
  const { act } = useStore();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const run = async (key: string, action: string, args: Record<string, unknown>) => {
    setBusy(key);
    setError(null);
    try {
      await act(action, { supplierId: s.id, ...args });
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-6">
      <p className="max-w-3xl text-sm text-slate">
        A service listing puts {s.name} in front of agencies searching for a service where it works. It appears on the{" "}
        <Link href={`/storefronts/${s.id}`} className="font-semibold text-maroon hover:underline">
          storefront
        </Link>{" "}
        and in search results. It's free for every claimed storefront for now.
      </p>
      <ErrorNote message={error} />
      <ServicesAndArea s={s} busy={busy} run={run} />
      <PastWorkEditor s={s} busy={busy} run={run} />
      <CertificationsEditor s={s} busy={busy} run={run} />
    </div>
  );
}

type Props = { s: Supplier; busy: string | null; run: (key: string, action: string, args: Record<string, unknown>) => Promise<boolean> };

function ServicesAndArea({ s, busy, run }: Props) {
  const [rows, setRows] = useState<Draft[]>(s.services?.length ? s.services.map(toDraft) : [blank]);
  const [state, setState] = useState(s.service_area?.state ?? (s.state || "TX"));
  const [picked, setPicked] = useState<Set<string>>(new Set(s.service_area?.counties ?? []));
  const [counties, setCounties] = useState<string[]>([]);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    let live = true;
    fetch(`/api/directory?counties=${state}`)
      .then((r) => r.json())
      .then((j) => live && setCounties(j.counties ?? []))
      .catch(() => live && setCounties([]));
    return () => {
      live = false;
    };
  }, [state]);
  const region = REGIONS.find((r) => r.state === state);
  const set = (i: number, k: keyof Draft, v: string) => {
    setSaved(false);
    setRows(rows.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  };
  const toggle = (c: string) => {
    setSaved(false);
    const next = new Set(picked);
    next.has(c) ? next.delete(c) : next.add(c);
    setPicked(next);
  };
  const save = async () => {
    const ok = await run("services", "updateServiceListing", {
      services: rows.map((r) => ({ id: r.id, name: r.name, detail: r.detail, aliases: r.aliases.split(",").map((a) => a.trim()).filter(Boolean), price: r.amount ? { amount: Number(r.amount), unit: r.unit } : null })),
      service_area: picked.size ? { state, counties: [...picked] } : null,
    });
    setSaved(ok);
  };
  return (
    <Card className="p-5">
      <h3 className="text-lg font-bold text-navy">Services and where you work</h3>
      <p className="mt-1 text-sm text-slate">Name each service the way agencies ask for it, and add the other words they use. Leave the price blank to be priced by quote.</p>
      <div className="mt-4 space-y-3">
        {rows.map((r, i) => (
          <div key={i} className="grid gap-2 rounded-lg border border-base-lighter p-3 sm:grid-cols-2">
            <label className="text-xs font-semibold text-slate">
              Service
              <input value={r.name} onChange={(e) => set(i, "name", e.target.value)} placeholder="Commercial window cleaning" className="mt-1 w-full" />
            </label>
            <label className="text-xs font-semibold text-slate">
              Also called (commas between)
              <input value={r.aliases} onChange={(e) => set(i, "aliases", e.target.value)} placeholder="window washing, glass cleaning" className="mt-1 w-full" />
            </label>
            <label className="text-xs font-semibold text-slate sm:col-span-2">
              What it covers
              <input value={r.detail} onChange={(e) => set(i, "detail", e.target.value)} placeholder="Interior and exterior glass, on a schedule or one visit" className="mt-1 w-full" />
            </label>
            <div className="flex flex-wrap items-end gap-2 sm:col-span-2">
              <label className="text-xs font-semibold text-slate">
                Package price (optional)
                <input value={r.amount} onChange={(e) => set(i, "amount", e.target.value.replace(/[^0-9.]/g, ""))} inputMode="decimal" placeholder="$" className="mt-1 w-28" />
              </label>
              <label className="text-xs font-semibold text-slate">
                per
                <input value={r.unit} onChange={(e) => set(i, "unit", e.target.value)} placeholder="visit" className="mt-1 w-28" />
              </label>
              {rows.length > 1 && (
                <button type="button" onClick={() => setRows(rows.filter((_, j) => j !== i))} className="ml-auto text-xs font-semibold text-maroon hover:underline">
                  Remove
                </button>
              )}
            </div>
          </div>
        ))}
        <button type="button" onClick={() => setRows([...rows, blank])} className="text-sm font-semibold text-maroon hover:underline">
          Add a service
        </button>
      </div>

      <div className="mt-6">
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-xs font-semibold text-slate">
            State
            <select
              value={state}
              onChange={(e) => {
                setState(e.target.value);
                setPicked(new Set());
                setSaved(false);
              }}
              className="mt-1 block"
            >
              {STATES.map(([c, n]) => (
                <option key={c} value={c}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          {region && (
            <button
              type="button"
              onClick={() => {
                setPicked(new Set([...picked, ...region.counties]));
                setSaved(false);
              }}
              className="text-sm font-semibold text-maroon hover:underline"
            >
              Add {region.name}'s {region.counties.length} counties
            </button>
          )}
          <span className="text-xs text-slate">{picked.size} chosen</span>
        </div>
        <div className="mt-3 grid max-h-64 grid-cols-2 gap-x-3 gap-y-1 overflow-y-auto rounded-lg border border-base-lighter p-3 sm:grid-cols-4">
          {[...counties.filter((c) => picked.has(c)), ...counties.filter((c) => !picked.has(c))].map((c) => (
            <label key={c} className="flex items-center gap-2 text-xs text-navy">
              <input type="checkbox" checked={picked.has(c)} onChange={() => toggle(c)} />
              {c}
            </label>
          ))}
          {!counties.length && <span className="text-xs text-slate">Loading counties…</span>}
        </div>
      </div>
      <div className="mt-4 flex items-center gap-3">
        <Button onClick={save} disabled={busy === "services"}>
          {busy === "services" ? "Saving…" : "Save services and area"}
        </Button>
        {saved && <span className="text-sm text-success-darker">Saved.</span>}
      </div>
    </Card>
  );
}

function PastWorkEditor({ s, busy, run }: Props) {
  const [state, setState] = useState(s.service_area?.state ?? (s.state || "TX"));
  const [agency, setAgency] = useState("");
  const [pick, setPick] = useState<DirectoryGovernment | null>(null);
  const [options, setOptions] = useState<DirectoryGovernment[]>([]);
  const [what, setWhat] = useState("");
  const [year, setYear] = useState("");
  const [url, setUrl] = useState("");
  useEffect(() => {
    if (pick || agency.trim().length < 2) {
      setOptions([]);
      return;
    }
    const t = setTimeout(() => {
      fetch(`/api/directory?q=${encodeURIComponent(agency.trim())}&state=${state}&limit=6`)
        .then((r) => r.json())
        .then((j) => setOptions(j.results ?? []))
        .catch(() => setOptions([]));
    }, 200);
    return () => clearTimeout(t);
  }, [agency, state, pick]);
  const add = async () => {
    const ok = await run("work", "addPastWork", { agency, directoryId: pick?.id, state, what, year: year ? Number(year) : null, url });
    if (ok) {
      setAgency("");
      setPick(null);
      setWhat("");
      setYear("");
      setUrl("");
    }
  };
  const work = s.past_work ?? [];
  return (
    <Card className="p-5">
      <h3 className="text-lg font-bold text-navy">Past public work</h3>
      <p className="mt-1 text-sm text-slate">
        Contracts and purchases for governments. Choose the government from Agora's directory so the match is exact; one typed by hand is matched by name, and shows as not found when it isn't
        in the directory. A link to the award (an agenda item, an award notice) helps an agency confirm it.
      </p>
      <div className="mt-4 grid gap-2 sm:grid-cols-[6rem_1fr]">
        <label className="text-xs font-semibold text-slate">
          State
          <select
            value={state}
            onChange={(e) => {
              setState(e.target.value);
              setPick(null);
            }}
            className="mt-1 block w-full"
          >
            {STATES.map(([c]) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        <div className="relative">
          <label className="text-xs font-semibold text-slate">
            Government
            <input
              value={pick ? pick.name : agency}
              onChange={(e) => {
                setPick(null);
                setAgency(e.target.value);
              }}
              placeholder="City of Arlington"
              className="mt-1 w-full"
              aria-autocomplete="list"
            />
          </label>
          {options.length > 0 && (
            <ul className="absolute z-10 mt-1 w-full divide-y divide-base-lighter rounded-lg border-2 border-base-lighter bg-white shadow-2">
              {options.map((o) => (
                <li key={o.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setPick(o);
                      setOptions([]);
                    }}
                    className="block w-full px-3 py-2 text-left text-sm hover:bg-base-lightest"
                  >
                    <span className="font-semibold text-navy">{o.name}</span>
                    <span className="text-xs text-slate"> · {[o.city, o.county ? `${o.county} County` : null].filter(Boolean).join(", ")}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {pick && <span className="mt-1 block text-xs text-success-darker">Chosen from the directory.</span>}
        </div>
        <label className="text-xs font-semibold text-slate sm:col-span-2">
          What the work was
          <input value={what} onChange={(e) => setWhat(e.target.value)} placeholder="Exterior window cleaning, central library" className="mt-1 w-full" />
        </label>
        <label className="text-xs font-semibold text-slate">
          Year
          <input value={year} onChange={(e) => setYear(e.target.value.replace(/\D/g, "").slice(0, 4))} inputMode="numeric" placeholder="2025" className="mt-1 w-full" />
        </label>
        <label className="text-xs font-semibold text-slate">
          Link to the award (optional)
          <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" className="mt-1 w-full" />
        </label>
      </div>
      <Button className="mt-3" onClick={add} disabled={busy === "work" || !(pick || agency.trim()) || !what.trim()}>
        {busy === "work" ? "Adding…" : "Add past work"}
      </Button>
      {work.length > 0 && (
        <ul className="mt-5 divide-y divide-base-lighter border-y border-base-lighter">
          {work.map((w) => (
            <li key={w.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
              <span className="min-w-0 flex-1 text-sm text-navy">
                <span className="font-semibold">{w.agency}</span>, {w.state}
                {w.year ? ` · ${w.year}` : ""} · {w.what}
              </span>
              {w.match ? <Badge tone="green">In directory{w.match.how === "name" ? ", by name" : ""}</Badge> : <Badge tone="amber">Not found in directory</Badge>}
              <button type="button" onClick={() => run(`rm-${w.id}`, "removePastWork", { id: w.id })} disabled={busy === `rm-${w.id}`} className="text-xs font-semibold text-maroon hover:underline">
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function CertificationsEditor({ s, busy, run }: Props) {
  const [kind, setKind] = useState<CertificationKind>("tx_cmbl_small_business");
  const [label, setLabel] = useState("");
  const [issuer, setIssuer] = useState("");
  const claims = s.certification_claims ?? [];
  return (
    <Card className="p-5">
      <h3 className="text-lg font-bold text-navy">Certifications</h3>
      <p className="mt-1 text-sm text-slate">
        Agora checks Texas's CMBL small business flag and VetHUB certification live against the Comptroller's directory, under the storefront's company name ({s.name}). Other
        certifications are listed as self-reported.
      </p>
      <div className="mt-4 flex flex-wrap items-end gap-2">
        <label className="text-xs font-semibold text-slate">
          Certification
          <select value={kind} onChange={(e) => setKind(e.target.value as CertificationKind)} className="mt-1 block">
            {(Object.keys(CERTIFICATION_KINDS) as CertificationKind[]).map((k) => (
              <option key={k} value={k}>
                {CERTIFICATION_KINDS[k].label}
              </option>
            ))}
          </select>
        </label>
        {kind === "other" && (
          <>
            <label className="text-xs font-semibold text-slate">
              Name
              <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="NCTRCA SBE" className="mt-1 block" />
            </label>
            <label className="text-xs font-semibold text-slate">
              Issued by
              <input value={issuer} onChange={(e) => setIssuer(e.target.value)} placeholder="North Central Texas Regional Certification Agency" className="mt-1 block" />
            </label>
          </>
        )}
        <Button
          onClick={async () => {
            if (await run("cert", "addCertification", { kind, label, issuer })) {
              setLabel("");
              setIssuer("");
            }
          }}
          disabled={busy === "cert"}
        >
          {busy === "cert" ? (CERTIFICATION_KINDS[kind].checkable ? "Checking the registry…" : "Adding…") : "Add certification"}
        </Button>
      </div>
      <p className="mt-2 text-xs text-slate">{CERTIFICATION_KINDS[kind].note}</p>
      {claims.length > 0 && (
        <ul className="mt-5 grid gap-2 md:grid-cols-2">
          {claims.map((c) => (
            <li key={c.id} className="rounded-xl border border-line bg-white p-4">
              <CertificationLine c={c} />
              <div className="mt-3 flex gap-4">
                {CERTIFICATION_KINDS[c.kind].checkable && (
                  <button type="button" onClick={() => run(`chk-${c.id}`, "checkCertification", { id: c.id })} disabled={busy === `chk-${c.id}`} className="text-xs font-semibold text-maroon hover:underline disabled:opacity-60">
                    {busy === `chk-${c.id}` ? "Checking…" : c.check ? "Check again" : "Check now"}
                  </button>
                )}
                <button type="button" onClick={() => run(`rmc-${c.id}`, "removeCertification", { id: c.id })} className="text-xs font-semibold text-maroon hover:underline">
                  Remove
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
