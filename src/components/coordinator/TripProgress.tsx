import { Check } from "lucide-react";

export const TRIP_STAGES: Array<{ value: string; short: string; label: string }> = [
  { value: "en_route", short: "On way", label: "On the way to pickup" },
  { value: "arrived", short: "Arrived", label: "Arrived at pickup" },
  { value: "in_progress", short: "On board", label: "Passengers on board" },
  { value: "completed", short: "Finished", label: "Trip finished" },
];

export function currentStageIndex(status: string | null | undefined): number {
  if (!status) return -1;
  if (status === "pending" || status === "active") return -1;
  if (status === "cancelled") return -1;
  const i = TRIP_STAGES.findIndex((s) => s.value === status);
  return i;
}

export function TripProgress({
  status,
  compact = false,
  className = "",
}: { status: string | null | undefined; compact?: boolean; className?: string }) {
  const idx = currentStageIndex(status);
  if (status === "cancelled") {
    return (
      <div className={`text-[10px] font-medium text-destructive uppercase tracking-wide ${className}`}>
        Cancelled
      </div>
    );
  }
  return (
    <div className={`flex items-center gap-1 ${className}`}>
      {TRIP_STAGES.map((s, i) => {
        const done = i < idx;
        const active = i === idx;
        return (
          <div key={s.value} className="flex items-center gap-1 min-w-0">
            <span
              className={`flex items-center justify-center rounded-full transition-colors shrink-0 ${
                done
                  ? "bg-emerald-500 text-white"
                  : active
                  ? "bg-primary text-primary-foreground ring-2 ring-primary/30"
                  : "bg-muted text-muted-foreground"
              } ${compact ? "h-3 w-3 text-[8px]" : "h-4 w-4 text-[9px]"}`}
              aria-label={s.label}
            >
              {done ? <Check className={compact ? "h-2 w-2" : "h-2.5 w-2.5"} /> : i + 1}
            </span>
            {!compact && (
              <span className={`text-[10px] ${active ? "font-semibold text-foreground" : "text-muted-foreground"} truncate`}>
                {s.short}
              </span>
            )}
            {i < TRIP_STAGES.length - 1 && (
              <span className={`h-px w-2 ${done ? "bg-emerald-500" : "bg-border"}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}
