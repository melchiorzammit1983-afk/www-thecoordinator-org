import { Badge } from "@/components/ui/badge";
import { AlertTriangle, Car, Clock } from "lucide-react";

export type TrafficInfo = {
  traffic_delay_minutes?: number | null;
  traffic_severity?: string | null; // "light" | "moderate" | "heavy" | "severe"
  leave_by_at?: string | null;
  pickup_shift_reason?: string | null;
};

const SEVERITY_STYLES: Record<string, string> = {
  light: "bg-emerald-500/15 text-emerald-700 border-emerald-500/40 dark:text-emerald-300",
  moderate: "bg-amber-500/15 text-amber-800 border-amber-500/40 dark:text-amber-300",
  heavy: "bg-orange-500/15 text-orange-800 border-orange-500/50 dark:text-orange-300",
  severe: "bg-red-500/15 text-red-700 border-red-500/50 dark:text-red-300 animate-pulse",
};

function formatLeaveBy(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}

export function TrafficBadge({
  info,
  compact = false,
  className = "",
}: { info: TrafficInfo; compact?: boolean; className?: string }) {
  const delay = info.traffic_delay_minutes ?? 0;
  const severity = info.traffic_severity ?? null;
  const leaveBy = info.leave_by_at ? formatLeaveBy(info.leave_by_at) : null;

  if (!severity && delay <= 0 && !leaveBy) return null;

  const style = SEVERITY_STYLES[severity ?? ""] ?? SEVERITY_STYLES.moderate;
  const size = compact ? "h-4 px-1.5 text-[9px]" : "h-5 px-2 text-[10px]";
  const Icon = severity === "severe" ? AlertTriangle : Car;

  return (
    <div className={`inline-flex flex-wrap items-center gap-1 ${className}`}>
      {(severity || delay > 0) && (
        <Badge variant="outline" className={`${style} ${size} gap-1 font-medium`}>
          <Icon className={compact ? "h-2.5 w-2.5" : "h-3 w-3"} />
          {delay > 0 ? `+${delay}m traffic` : (severity ?? "traffic")}
        </Badge>
      )}
      {leaveBy && (
        <Badge variant="outline" className={`${size} gap-1 border-primary/50 text-primary`}>
          <Clock className={compact ? "h-2.5 w-2.5" : "h-3 w-3"} />
          leave by {leaveBy}
        </Badge>
      )}
    </div>
  );
}
