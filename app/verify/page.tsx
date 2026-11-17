"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Mark } from "@/components/blueprint";
import { useStore } from "@/components/store";

/** Where the "confirm your email" link lands. The link works once. */
export default function Verify() {
  const { refresh } = useStore();
  const [state, setState] = useState<{ status: "working" | "done" | "failed"; text: string }>({ status: "working", text: "Confirming your email." });
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    const token = new URLSearchParams(window.location.search).get("token");
    fetch("/api/auth", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ op: "verify", token }) })
      .then(async (res) => {
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? "That link didn't work.");
        setState({ status: "done", text: `${json.result.user.email} is confirmed. Agora will send approval notices there, and can help you back in if you forget your password.` });
        await refresh();
      })
      .catch((e) => setState({ status: "failed", text: (e as Error).message }));
  }, [refresh]);

  return (
    <div className="mx-auto max-w-xl border border-primary-darker bg-white">
      <div className="flex items-center gap-3 bg-[#0F3D73] px-5 py-4">
        <Mark className="h-8 w-8" onDark working={state.status === "working"} />
        <h1 className="font-heading text-lg font-bold text-white">{state.status === "done" ? "Your email is confirmed" : state.status === "failed" ? "That link didn't work" : "Confirming your email"}</h1>
      </div>
      <div className="space-y-3 px-5 py-5">
        <p className="text-sm text-ink" aria-live="polite">
          {state.text}
        </p>
        {state.status !== "working" && (
          <Link href="/" className="inline-flex min-h-[44px] items-center text-ui-xs font-bold text-primary hover:text-primary-dark">
            Go to search →
          </Link>
        )}
      </div>
    </div>
  );
}
