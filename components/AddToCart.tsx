"use client";

import { useState } from "react";
import { useStore } from "./store";

/** Adds a listing to the agency's open cart. Confirms in place, so the buyer can keep shopping. */
export function AddToCart({ listingId, quantity, requestId, size = "sm" }: { listingId: string; quantity: number; requestId?: string | null; size?: "sm" | "md" }) {
  const { act } = useStore();
  const [state, setState] = useState<"idle" | "busy" | "added">("idle");
  const [error, setError] = useState<string | null>(null);
  const pad = size === "md" ? "h-10 px-6" : "h-9 px-4";
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
        className={`state-layer rounded-full text-label-l transition-colors ${pad} ${state === "added" ? "bg-success-container text-success-on-container" : "bg-secondary-container text-on-secondary-container"}`}
      >
        {state === "added" ? "✓ Added" : "Add to cart"}
      </button>
      {error && <span className="mt-1 max-w-[14rem] text-right text-[11px] text-red-700">{error}</span>}
    </span>
  );
}
