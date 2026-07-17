import { ShieldAlert } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Persistent safety notice shown on every AI surface.
 * Reminds users AI can be wrong and personal data is never shared
 * between companies.
 */
export function SafetyBanner({ compact = false, className }: { compact?: boolean; className?: string }) {
  return (
    <div
      className={cn(
        "flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 text-amber-900 dark:text-amber-100",
        compact ? "px-2 py-1.5 text-[11px]" : "px-3 py-2 text-xs",
        className,
      )}
      role="note"
    >
      <ShieldAlert className={cn("mt-0.5 flex-shrink-0 text-amber-600", compact ? "h-3.5 w-3.5" : "h-4 w-4")} />
      <div className="leading-snug">
        <span className="font-semibold">Always verify AI answers</span> before acting on payments, driver assignments, or passenger info.
        Personal data (names, phones, addresses) is never shared between companies.
      </div>
    </div>
  );
}
