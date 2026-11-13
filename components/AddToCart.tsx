"use client";

import { useState } from "react";
import { useStore } from "./store";

/** Adds a listing to the agency's open cart. Confirms in place, so the buyer can keep shopping. */
export function AddToCart({ listingId, quantity, requestId, size = "sm" }: { listingId: string; quantity: number; requestId?: string | null; size?: "sm" | "md" }) {
  const { act } = useStore();
  const [state, setState] = useState<"idle" | "busy" | "added">("idle");
  const [error, setError] = useState<string | null>(null);
  const pad = size === "md" ? "px-4 py-2 text-sm" : "px-3 py-2 text-xs";
  return (
    <span className="inline-flex flex-col items-end">
      <button
        type="button"
        disabled={state === "busy"}
        onClick={async () => {
          setState("busy");
          setError(null);
          try {
            await act("addToCart", { listingId, quantity, requestId });
            setState("added");
            setTimeout(() => setState("idle"), 1800);
          } catch (e) {
            setError((e as Error).message);
            setState("idle");
          }
        }}
        className={`rounded-[9px] border font-bold transition-colors ${pad} ${state === "added" ? "border-emerald-300 bg-emerald-50 text-emerald-800" : "border-[#dbe4f0] bg-white text-[#385783] hover:border-[#8fa8e8]"}`}
      >
        {state === "added" ? "Added to cart" : "Add to cart"}
      </button>
      {error && <span className="mt-1 max-w-[14rem] text-right text-[11px] text-red-700">{error}</span>}
    </span>
  );
}
