"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Mark } from "./blueprint";
import { useAuthPrompt, useStore } from "./store";
import { ErrorNote, Loading } from "./ui";

const ROLE_CHOICES = [
  { id: "buyer", label: "I buy things for my agency" },
  { id: "procurement", label: "I work in purchasing" },
  { id: "supplier", label: "I'm a supplier" },
] as const;

const field = "mt-1 w-full text-sm";
const primaryBtn = "inline-flex min-h-[44px] items-center justify-center rounded-md bg-primary px-5 text-ui-xs font-bold text-white hover:bg-primary-dark disabled:opacity-60";

/** Sign in or create an account. Opens when a step needs one, and from the header. */
export function AuthDialog() {
  const { prompt, finish } = useAuthPrompt();
  const { db, setRole } = useStore();
  const [mode, setMode] = useState<"signin" | "signup" | "forgot">("signin");
  const [form, setForm] = useState({ name: "", email: "", password: "", role: "buyer" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // What to say after a step that ends in "check your email".
  const [notice, setNotice] = useState<{ text: string; signedIn: boolean } | null>(null);
  const first = useRef<HTMLInputElement>(null);
  // Closing the "check your email" note after signing up still counts as signed in.
  const signedIn = useRef(false);
  signedIn.current = Boolean(notice?.signedIn);
  const dismiss = () => void finish(signedIn.current);

  useEffect(() => {
    if (!prompt) return;
    setError(null);
    setNotice(null);
    setMode((m) => (m === "forgot" ? "signin" : m));
    setForm((f) => ({ ...f, password: "" }));
    first.current?.focus();
    const esc = (e: KeyboardEvent) => e.key === "Escape" && void finish(signedIn.current);
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  }, [prompt, finish]);

  if (!prompt) return null;
  const agency = db?.session.buyer;

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ op: mode, ...form }) });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Something went wrong");
      if (mode === "forgot") {
        setNotice({ text: `If there's an Agora account for ${form.email}, we've sent it a link to choose a new password. The link lasts one hour.`, signedIn: false });
        return;
      }
      // Open on the side of Agora the person signed up for.
      if (mode === "signup") {
        setRole(json.result.user.role);
        if (json.result.emailed) {
          setNotice({ text: `Your account is ready. We've sent a link to ${form.email} to confirm it's yours; you can carry on in the meantime.`, signedIn: true });
          return;
        }
      }
      await finish(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-[rgba(15,30,56,0.55)] p-4" onMouseDown={(e) => e.target === e.currentTarget && dismiss()}>
      <div role="dialog" aria-modal="true" aria-labelledby="auth-title" className="w-full max-w-md border border-primary-darker bg-white shadow-3">
        <div className="flex items-center gap-3 bg-[#0F3D73] px-5 py-4">
          <Mark className="h-8 w-8" onDark working={busy} />
          <h2 id="auth-title" className="font-heading text-lg font-bold text-white">
            {notice ? "Check your email" : mode === "signin" ? "Sign in to Agora" : mode === "signup" ? "Create your Agora account" : "Reset your password"}
          </h2>
        </div>
        {notice && (
          <div className="space-y-4 px-5 py-5">
            <p className="text-sm text-ink">{notice.text}</p>
            <button type="button" onClick={() => void finish(notice.signedIn)} className={primaryBtn}>
              {notice.signedIn ? "Continue" : "Close"}
            </button>
          </div>
        )}
        <form
          hidden={Boolean(notice)}
          className="space-y-3.5 px-5 py-5"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          {prompt.reason && mode !== "forgot" && <p className="text-sm text-ink">{prompt.reason}</p>}
          <p className="text-ui-2xs text-base-dark">{mode === "forgot" ? "Enter the email you signed up with and we'll send a link to choose a new password." : "Searching, the buying plan and the shopper's tools stay free to use without an account."}</p>
          {mode === "signup" && (
            <label className="block text-sm font-bold text-ink">
              Your name
              <input ref={first} className={field} value={form.name} autoComplete="name" required maxLength={120} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </label>
          )}
          <label className="block text-sm font-bold text-ink">
            Work email
            <input ref={mode === "signin" ? first : undefined} className={field} type="email" value={form.email} autoComplete="email" required onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </label>
          <label className="block text-sm font-bold text-ink" hidden={mode === "forgot"}>
            Password
            <input
              disabled={mode === "forgot"}
              className={field}
              type="password"
              value={form.password}
              autoComplete={mode === "signin" ? "current-password" : "new-password"}
              required
              minLength={mode === "signup" ? 10 : undefined}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
            />
            {mode === "signup" && <span className="mt-1 block text-ui-3xs font-normal text-base-dark">At least 10 characters.</span>}
          </label>
          {mode === "signup" && (
            <fieldset>
              <legend className="text-sm font-bold text-ink">What do you do?</legend>
              <div className="mt-1 space-y-1">
                {ROLE_CHOICES.map((r) => (
                  <label key={r.id} className="flex min-h-[36px] cursor-pointer items-center gap-2.5 text-sm text-ink">
                    <input type="radio" name="account-role" checked={form.role === r.id} onChange={() => setForm({ ...form, role: r.id })} className="h-4 w-4 accent-[#162E51]" />
                    {r.label}
                  </label>
                ))}
              </div>
            </fieldset>
          )}
          {mode === "signup" && <p className="text-ui-2xs text-base-dark">{agency ? `Your account will start with ${agency.name}, ${agency.state} as its agency. You can change it any time.` : "You can set your agency after you sign up."}</p>}
          <ErrorNote message={error} />
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 pt-1">
            <button type="submit" disabled={busy} className={primaryBtn}>
              {mode === "signin" ? "Sign in" : mode === "signup" ? "Create account" : "Send the link"}
            </button>
            <button type="button" onClick={() => void finish(false)} className="min-h-[44px] text-ui-xs font-bold text-primary hover:text-primary-dark">
              Not now
            </button>
            {mode === "signin" && (
              <button type="button" onClick={() => (setMode("forgot"), setError(null))} className="min-h-[44px] text-ui-xs font-bold text-primary hover:text-primary-dark">
                Forgot your password?
              </button>
            )}
          </div>
          <p className="border-t border-base-lighter pt-3 text-sm text-ink">
            {mode === "signin" ? "New to Agora?" : "Already have an account?"}{" "}
            <button type="button" onClick={() => (setMode(mode === "signin" ? "signup" : "signin"), setError(null))} className="font-bold text-primary hover:text-primary-dark">
              {mode === "signin" ? "Create a free account" : "Sign in"}
            </button>
          </p>
        </form>
      </div>
    </div>
  );
}

/** Parts of Agora that keep records for a person or an agency, so they need an account. Everything else is open. */
const ACCOUNT_PATHS: [RegExp, string][] = [
  [/^\/cart/, "use the cart"],
  [/^\/checkout/, "check out"],
  [/^\/orders/, "see your orders"],
  [/^\/procurement/, "use the purchasing pages"],
  [/^\/supplier/, "manage a supplier profile"],
  [/^\/contracts\/upload/, "upload a contract"],
  [/^\/solicitations/, "work on solicitations"],
  [/^\/coops/, "manage co-op member lists"],
];

/** Shows a sign-in panel in place of an account-only page. */
export function AccountGate({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const { db, user, askToSignIn } = useStore();
  const need = ACCOUNT_PATHS.find(([re]) => re.test(path));
  if (!need || user) return <>{children}</>;
  if (!db) return <Loading />;
  return (
    <div className="mx-auto max-w-xl border border-primary-darker bg-white">
      <div className="flex items-center gap-3 bg-[#0F3D73] px-5 py-4">
        <Mark className="h-8 w-8" onDark />
        <h1 className="font-heading text-lg font-bold text-white">This part of Agora needs an account</h1>
      </div>
      <div className="space-y-3 px-5 py-5">
        <p className="text-sm text-ink">Sign in or create a free account to {need[1]}. It keeps your carts, orders and paperwork with you and your agency.</p>
        <p className="text-sm text-base-darker">You don't need one to search, see your buying plan, find a product, check a quote or ask a contract.</p>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 pt-1">
          <button type="button" onClick={() => askToSignIn(need[1])} className={primaryBtn}>
            Sign in or create an account
          </button>
          <Link href="/" className="inline-flex min-h-[44px] items-center text-ui-xs font-bold text-primary hover:text-primary-dark">
            Back to search →
          </Link>
        </div>
      </div>
    </div>
  );
}
