"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { Db, Role } from "@/lib/types";

export interface Account {
  id: string;
  name: string;
  email: string;
  role: Role;
  /** They've confirmed their email address. */
  verified: boolean;
}

interface Store {
  db: Db | null;
  llm: boolean;
  /** The signed-in account, or null. Searching and the shopper's tools work without one. */
  user: Account | null;
  /** Open the sign-in dialog. `reason` finishes the sentence "Sign in or create a free account to ...". */
  askToSignIn: (reason?: string) => void;
  signOut: () => Promise<void>;
  role: Role;
  setRole: (r: Role) => void;
  refresh: () => Promise<void>;
  act: <T = unknown>(action: string, args?: Record<string, unknown>) => Promise<T>;
  ledgerOpen: boolean;
  setLedgerOpen: (open: boolean) => void;
  /** Revenue event ids added since the ledger was last opened, for a pulse. */
  fresh: number;
  /** Show the numbered revenue badges throughout the app. */
  showEarn: boolean;
  setShowEarn: (on: boolean) => void;
}

/** What the sign-in dialog needs: why it opened, and what to do when it closes. */
export interface AuthPrompt {
  reason: string;
  done: (signedIn: boolean) => void;
}

const Ctx = createContext<Store | null>(null);
const AuthCtx = createContext<{ prompt: AuthPrompt | null; finish: (signedIn: boolean) => Promise<void> } | null>(null);

class NeedsAccount extends Error {}

export async function post<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const json = await res.json();
  if (res.status === 401 && json.needs_account) throw new NeedsAccount(json.error);
  if (!res.ok) throw new Error(json.error ?? "Something went wrong");
  return json.result as T;
}

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const [db, setDb] = useState<Db | null>(null);
  const [llm, setLlm] = useState(false);
  const [user, setUser] = useState<Account | null>(null);
  const [prompt, setPrompt] = useState<AuthPrompt | null>(null);
  const [role, setRoleState] = useState<Role>("buyer");
  const [ledgerOpen, setLedgerOpenState] = useState(false);
  const [seen, setSeen] = useState<number | null>(null);
  const [showEarn, setShowEarnState] = useState(false);
  const promptRef = useRef<AuthPrompt | null>(null);

  const refresh = useCallback(async () => {
    const res = await fetch("/api/state", { cache: "no-store" });
    const json = await res.json();
    setDb(json.db);
    setLlm(json.llm);
    setUser(json.user ?? null);
    setSeen((s) => (s === null ? json.db.revenue.length : s));
  }, []);

  useEffect(() => {
    refresh();
    try {
      const r = localStorage.getItem("role") as Role | null;
      if (r) setRoleState(r);
      if (localStorage.getItem("showEarn") === "1") setShowEarnState(true);
    } catch {}
  }, [refresh]);

  // Co-op links open in a new tab and are logged server-side; pick them up on return.
  useEffect(() => {
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refresh]);

  const setRole = (r: Role) => {
    setRoleState(r);
    try {
      localStorage.setItem("role", r);
    } catch {}
  };

  /** Show the sign-in dialog and wait for it to close. Resolves true once the person is signed in. */
  const signInFirst = useCallback(
    (reason: string) =>
      new Promise<boolean>((resolve) => {
        // One dialog at a time: a second caller waits on the first one's answer.
        const waiting = promptRef.current;
        const next: AuthPrompt = { reason, done: (ok) => (waiting?.done(ok), resolve(ok)) };
        promptRef.current = next;
        setPrompt(next);
      }),
    [],
  );

  const finish = useCallback(
    async (signedIn: boolean) => {
      const p = promptRef.current;
      promptRef.current = null;
      setPrompt(null);
      if (signedIn) await refresh();
      p?.done(signedIn);
    },
    [refresh],
  );

  const act = useCallback(
    async <T,>(action: string, args: Record<string, unknown> = {}) => {
      let result: T;
      try {
        result = await post<T>("/api/act", { action, ...args });
      } catch (e) {
        if (!(e instanceof NeedsAccount)) throw e;
        // The step needs an account: ask, then carry on with what the person was doing.
        if (!(await signInFirst(e.message))) throw new Error(e.message);
        result = await post<T>("/api/act", { action, ...args });
      }
      await refresh();
      return result;
    },
    [refresh, signInFirst],
  );

  const askToSignIn = useCallback((reason?: string) => void signInFirst(reason ? `Sign in or create a free account to ${reason}.` : ""), [signInFirst]);

  const signOut = useCallback(async () => {
    await fetch("/api/auth", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ op: "signout" }) });
    await refresh();
  }, [refresh]);

  const setShowEarn = (on: boolean) => {
    setShowEarnState(on);
    try {
      localStorage.setItem("showEarn", on ? "1" : "0");
    } catch {}
  };

  const setLedgerOpen = (open: boolean) => {
    setLedgerOpenState(open);
    if (open && db) setSeen(db.revenue.length);
  };

  const fresh = db && seen !== null ? Math.max(0, db.revenue.length - seen) : 0;

  return (
    <Ctx.Provider value={{ db, llm, user, askToSignIn, signOut, role, setRole, refresh, act, ledgerOpen, setLedgerOpen, fresh, showEarn, setShowEarn }}>
      <AuthCtx.Provider value={{ prompt, finish }}>{children}</AuthCtx.Provider>
    </Ctx.Provider>
  );
}

export function useStore() {
  const s = useContext(Ctx);
  if (!s) throw new Error("useStore outside StoreProvider");
  return s;
}

/** For the sign-in dialog only. */
export function useAuthPrompt() {
  const s = useContext(AuthCtx);
  if (!s) throw new Error("useAuthPrompt outside StoreProvider");
  return s;
}
