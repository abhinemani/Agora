"use client";

import Link from "next/link";
import { useState } from "react";
import type { Supplier } from "@/lib/types";
import { useStore } from "./store";
import { Alert, Button, ErrorNote } from "./ui";

/** "Is this your company?" Claim a storefront; a work email on the company's domain verifies at once. */
export function ClaimStorefront({ s }: { s: Supplier }) {
  const { act, setRole } = useStore();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", email: "" });
  const [error, setError] = useState<string | null>(null);
  const run = async (action: string, body: Record<string, unknown>) => {
    setError(null);
    try {
      await act(action, body);
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    }
  };

  if (s.claim?.status === "verified")
    return (
      <p className="text-ui-3xs text-base-dark">
        Claimed by {s.name}.{" "}
        <Link href="/supplier?tab=plans" onClick={() => setRole("supplier")} className="text-ink underline">
          Manage this storefront
        </Link>
      </p>
    );

  if (s.claim?.status === "pending")
    return (
      <Alert
        type="info"
        heading="Claim waiting for review"
        action={
          <Button variant="secondary" onClick={() => run("approveClaim", { supplierId: s.id })}>
            Approve claim (Sovra ops, demo)
          </Button>
        }
      >
        {s.claim.name} ({s.claim.email}) asked to manage this storefront. The email isn't on {s.website ?? "the company's website domain"}, so Sovra checks it by hand.
      </Alert>
    );

  return (
    <div className="border-y border-base-lighter py-4">
      {!open ? (
        <p className="text-ui-xs text-ink">
          Is this your company?{" "}
          <button onClick={() => setOpen(true)} className="underline">
            Claim this storefront
          </button>{" "}
          <span className="text-base-dark">to set your description, choose a plan and run placements.</span>
        </p>
      ) : (
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={async (e) => {
            e.preventDefault();
            if (await run("claimStorefront", { supplierId: s.id, ...form })) setOpen(false);
          }}
        >
          <label className="block text-ui-2xs font-bold text-ink">
            Your name
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="mt-1 block w-56" />
          </label>
          <label className="block text-ui-2xs font-bold text-ink">
            Work email
            <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder={s.website ? `you@${s.website.replace(/^https?:\/\/(www\.)?/, "")}` : "you@company.com"} className="mt-1 block w-72" />
          </label>
          <Button type="submit">Claim storefront</Button>
          <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <p className="w-full text-ui-3xs text-base-dark">
            An email on {s.website ? s.website.replace(/^https?:\/\/(www\.)?/, "") : "your company's domain"} verifies you right away. Anything else goes to Sovra for review.
          </p>
        </form>
      )}
      <ErrorNote message={error} />
    </div>
  );
}
