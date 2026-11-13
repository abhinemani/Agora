"use client";

import { useState } from "react";
import { useStore } from "./store";

/** Adds a listing to the agency's open cart. Confirms in place, so the buyer can keep shopping. */
export function AddToCart({ listingId, quantity, requestId, size = "sm" }: { listingId: string; quantity: number; requestId?: string | null; size?: "sm" | "md" }) {
  const { act } = useStore();
  const [state, setState] = useState<"idle" | "busy" | "added">("idle");
  const [error, setError] = useState<string | null>(null);
  const pad = size === "md" ? "px-5 py-3" : "px-4 py-2.5";
  return (
    <span className="inline-flex flex-col items-stretch">
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
        className={`w-full rounded-md text-ui-xs font-bold leading-none transition-colors ${pad} ${state === "added" ? "bg-success-lighter text-success-darker shadow-[inset_0_0_0_2px_theme(colors.success.DEFAULT)]" : "bg-white text-primary shadow-[inset_0_0_0_1px_theme(colors.primary.DEFAULT)] hover:text-primary-dark hover:bg-base-lightest"}`}
      >
        {state === "added" ? "✓ Added" : "Add to cart"}
      </button>
      {error && <span className="mt-1 max-w-[14rem] text-right text-[11px] text-red-700">{error}</span>}
    </span>
  );
}
