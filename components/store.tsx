"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import type { Db, Role } from "@/lib/types";

interface Store {
  db: Db | null;
  llm: boolean;
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

const Ctx = createContext<Store | null>(null);

export async function post<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error ?? "Something went wrong");
  return json.result as T;
}

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const [db, setDb] = useState<Db | null>(null);
  const [llm, setLlm] = useState(false);
  const [role, setRoleState] = useState<Role>("buyer");
  const [ledgerOpen, setLedgerOpenState] = useState(false);
  const [seen, setSeen] = useState<number | null>(null);
  const [showEarn, setShowEarnState] = useState(true);

  const refresh = useCallback(async () => {
    const res = await fetch("/api/state", { cache: "no-store" });
    const json = await res.json();
    setDb(json.db);
    setLlm(json.llm);
    setSeen((s) => (s === null ? json.db.revenue.length : s));
  }, []);

  useEffect(() => {
    refresh();
    try {
      const r = localStorage.getItem("role") as Role | null;
      if (r) setRoleState(r);
      if (localStorage.getItem("showEarn") === "0") setShowEarnState(false);
    } catch {}
  }, [refresh]);

  const setRole = (r: Role) => {
    setRoleState(r);
    try {
      localStorage.setItem("role", r);
    } catch {}
  };

  const act = useCallback(
    async <T,>(action: string, args: Record<string, unknown> = {}) => {
      const result = await post<T>("/api/act", { action, ...args });
      await refresh();
      return result;
    },
    [refresh],
  );

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
    <Ctx.Provider value={{ db, llm, role, setRole, refresh, act, ledgerOpen, setLedgerOpen, fresh, showEarn, setShowEarn }}>{children}</Ctx.Provider>
  );
}

export function useStore() {
  const s = useContext(Ctx);
  if (!s) throw new Error("useStore outside StoreProvider");
  return s;
}
