"use client";

import { useState } from "react";
import { ThumbDown, ThumbUp } from "./icons";
import { post } from "./store";

type Vote = "up" | "down";

/** "Was this right?" under something the model wrote. The vote is recorded against the model call it came
 * from (lib/ai-log.ts); a thumbs down can say what was wrong. Renders nothing for rule-based text. */
export function Feedback({ id, className = "" }: { id?: string | null; className?: string }) {
  const [vote, setVote] = useState<Vote | null>(null);
  const [note, setNote] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState(false);
  if (!id) return null;

  const send = async (next: Vote | null, text?: string) => {
    const was = vote;
    setVote(next);
    setError(false);
    if (next !== "down") setSent(false);
    try {
      await post("/api/act", { action: "rateAnswer", id, vote: next, note: text });
      if (text) setSent(true);
    } catch {
      setVote(was);
      setError(true);
    }
  };
  const btn = (on: boolean) =>
    `inline-flex h-8 w-8 items-center justify-center rounded-md shadow-[inset_0_0_0_1px_theme(colors.base.light)] hover:shadow-[inset_0_0_0_2px_theme(colors.primary.DEFAULT)] ${on ? "bg-primary text-white" : "bg-white text-base-darker"}`;

  return (
    <div className={`space-y-2 ${className}`} data-testid="feedback">
      <div className="flex flex-wrap items-center gap-2 text-ui-2xs text-base-dark">
        <span>{vote ? "Thanks. That's recorded." : "Was this right?"}</span>
        <button type="button" aria-label="Yes, this was right" aria-pressed={vote === "up"} onClick={() => send(vote === "up" ? null : "up")} className={btn(vote === "up")}>
          <ThumbUp />
        </button>
        <button type="button" aria-label="No, something was wrong" aria-pressed={vote === "down"} onClick={() => send(vote === "down" ? null : "down")} className={btn(vote === "down")}>
          <ThumbDown />
        </button>
        {error && <span className="text-error-dark">Couldn't record that. Try again.</span>}
      </div>
      {vote === "down" && !sent && (
        <form
          className="flex max-w-xl flex-wrap gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (note.trim()) void send("down", note.trim());
          }}
        >
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={300}
            aria-label="What was wrong?"
            placeholder="What was wrong? (optional)"
            className="min-h-[36px] min-w-0 flex-1 rounded-md border border-base-light bg-white px-3 text-ui-2xs text-ink"
          />
          <button type="submit" disabled={!note.trim()} className="min-h-[36px] rounded-md bg-white px-3 text-ui-2xs font-bold text-primary shadow-[inset_0_0_0_1px_theme(colors.base.light)] disabled:opacity-60">
            Send
          </button>
        </form>
      )}
    </div>
  );
}
