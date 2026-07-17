import { AlertTriangle, Clock } from "lucide-react";
import type { ConflictSeverity } from "@/lib/scheduling.functions";

/**
 * Compact status chip for the driver picker: shows whether assigning this
 * driver to the current trip will create a schedule collision.
 */
export function ConflictChip({
  severity,
  compact,
}: {
  severity: ConflictSeverity | undefined | null;
  compact?: boolean;
}) {
  if (!severity) return null;
  const cfg =
    severity === "conflict"
      ? {
          cls: "bg-red-500/15 text-red-700 dark:text-red-300 border-red-500/30",
          icon: <AlertTriangle className="h-3 w-3" />,
          label: "Conflict",
        }
      : severity === "tight"
        ? {
            cls: "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30",
            icon: <Clock className="h-3 w-3" />,
            label: "Tight",
          }
        : {
            cls: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30",
            icon: null,
            label: "Free",
          };
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-medium ${cfg.cls}`}
    >
      {cfg.icon}
      {!compact && cfg.label}
    </span>
  );
}
