"use client";
import { Sparkles } from "lucide-react";
import { useAskGuide, type AskGuideContext } from "./AskGuideProvider";
import { cn } from "@/lib/utils";

/**
 * Contextual "why?" button. Drop next to any signal (red glow, ETA chip,
 * override dialog, etc.) with a prefill question + optional live context
 * so the AI can answer immediately.
 */
export function ExplainThis({
  prefill,
  systemContext,
  label = "Why?",
  className,
}: AskGuideContext & { label?: string; className?: string }) {
  const { open } = useAskGuide();
  return (
    <button
      onClick={() => open({ prefill, systemContext })}
      className={cn(
        "inline-flex items-center gap-1 rounded-full border border-primary/30 bg-primary/5 px-2 py-0.5 text-[11px] font-medium text-primary hover:bg-primary/15",
        className,
      )}
      title="Ask the AI Guide"
    >
      <Sparkles className="h-3 w-3" />
      {label}
    </button>
  );
}
