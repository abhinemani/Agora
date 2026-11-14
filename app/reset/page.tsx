"use client";

import Link from "next/link";
import { useState } from "react";
import { Mark } from "@/components/blueprint";
import { useStore } from "@/components/store";
import { ErrorNote } from "@/components/ui";

/** Where the password-reset link lands: choose a new password. The link works once and lasts an hour. */
export default function Reset() {
  const { refresh } = useStore();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const token = new URLSearchParams(window.location.search).get("token");
      const res = await fetch("/api/auth", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ op: "reset", token, password }) });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Something went wrong");
      setDone(true);
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-xl border border-primary-darker bg-white">
      <div className="flex items-center gap-3 bg-[#0F3D73] px-5 py-4">
        <Mark className="h-8 w-8" onDark working={busy} />
        <h1 className="font-heading text-lg font-bold text-white">{done ? "Your password is changed" : "Choose a new password"}</h1>
      </div>
      {done ? (
        <div className="space-y-3 px-5 py-5">
          <p className="text-sm text-ink">You're signed in with your new password. Any other browsers that were signed in to this account have been signed out.</p>
          <Link href="/" className="inline-flex min-h-[44px] items-center text-ui-xs font-bold text-primary hover:text-primary-dark">
            Go to search →
          </Link>
        </div>
      ) : (
        <form
          className="space-y-3.5 px-5 py-5"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <label className="block text-sm font-bold text-ink">
            New password
            <input className="mt-1 w-full text-sm" type="password" value={password} autoComplete="new-password" required minLength={10} onChange={(e) => setPassword(e.target.value)} />
            <span className="mt-1 block text-ui-3xs font-normal text-base-dark">At least 10 characters.</span>
          </label>
          <ErrorNote message={error} />
          <button type="submit" disabled={busy} className="inline-flex min-h-[44px] items-center justify-center rounded-md bg-primary px-5 text-ui-xs font-bold text-white hover:bg-primary-dark disabled:opacity-60">
            Change my password
          </button>
        </form>
      )}
    </div>
  );
}
