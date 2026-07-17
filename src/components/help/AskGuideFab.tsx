"use client";
import { Sparkles } from "lucide-react";
import { useAskGuide } from "./AskGuideProvider";

export function AskGuideFab() {
  const { open, isOpen } = useAskGuide();
  if (isOpen) return null;
  return (
    <button
      onClick={() => open()}
      className="fixed bottom-4 right-4 z-40 flex items-center gap-2 rounded-full bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground shadow-lg transition-transform hover:scale-105 hover:bg-primary/90 sm:bottom-6 sm:right-6"
      aria-label="Ask the Guide"
    >
      <Sparkles className="h-4 w-4" />
      <span className="hidden sm:inline">Ask the Guide</span>
    </button>
  );
}
