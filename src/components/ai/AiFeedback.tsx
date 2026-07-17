"use client";
import { useState } from "react";
import { ThumbsUp, ThumbsDown, Check, Loader2 } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { submitFeedback } from "@/lib/ai-lessons.functions";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

/**
 * Compact thumbs up/down + correction under any AI output.
 * On 👎 opens an inline "what should it have said?" box.
 */
export function AiFeedback({
  surface,
  question,
  answer,
  route,
  className,
}: {
  surface: "guide" | "extract" | "suggestion" | "other";
  question?: string;
  answer?: string;
  route?: string;
  className?: string;
}) {
  const send = useServerFn(submitFeedback);
  const [state, setState] = useState<"idle" | "up" | "down" | "sent">("idle");
  const [correction, setCorrection] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (vote: "up" | "down", withCorrection = false) => {
    setBusy(true);
    try {
      await send({ data: {
        surface, vote,
        question: question?.slice(0, 4000),
        answer: answer?.slice(0, 8000),
        correction: withCorrection ? correction.slice(0, 2000) : undefined,
        route,
      } });
      setState("sent");
      toast.success("Thanks — the AI will learn from this.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Feedback failed");
    } finally { setBusy(false); }
  };

  if (state === "sent") {
    return (
      <div className={cn("flex items-center gap-1.5 text-[11px] text-muted-foreground", className)}>
        <Check className="h-3 w-3 text-green-600" /> Feedback recorded. Verify before acting.
      </div>
    );
  }
  if (state === "down") {
    return (
      <div className={cn("space-y-1.5 rounded-md border border-border bg-muted/30 p-2", className)}>
        <div className="text-[11px] text-muted-foreground">What should it have said? (personal data will be stripped)</div>
        <Textarea rows={2} value={correction} onChange={(e) => setCorrection(e.target.value)} placeholder="Optional correction…" className="text-xs" />
        <div className="flex justify-end gap-1.5">
          <Button size="sm" variant="ghost" onClick={() => setState("idle")}>Cancel</Button>
          <Button size="sm" disabled={busy} onClick={() => submit("down", true)}>
            {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : "Send"}
          </Button>
        </div>
      </div>
    );
  }
  return (
    <div className={cn("flex items-center gap-1 text-muted-foreground", className)}>
      <span className="text-[11px]">Was this helpful?</span>
      <button
        title="Yes"
        disabled={busy}
        onClick={() => submit("up")}
        className="grid h-6 w-6 place-items-center rounded hover:bg-green-500/10 hover:text-green-600 disabled:opacity-50"
      >
        <ThumbsUp className="h-3 w-3" />
      </button>
      <button
        title="No — teach the AI"
        disabled={busy}
        onClick={() => setState("down")}
        className="grid h-6 w-6 place-items-center rounded hover:bg-red-500/10 hover:text-red-600 disabled:opacity-50"
      >
        <ThumbsDown className="h-3 w-3" />
      </button>
    </div>
  );
}
