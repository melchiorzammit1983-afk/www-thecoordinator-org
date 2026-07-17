import { AlertTriangle, Clock } from "lucide-react";
import { useDriverConflicts } from "@/hooks/use-driver-conflicts";

/**
 * Red / amber banner surfaced above the trip actions when the assigned driver
 * has a schedule collision that involves this trip. Explains the math in
 * plain language so the coordinator can decide to reassign or override.
 */
export function ScheduleConflictBanner({
  jobId,
  driverId,
  date,
}: {
  jobId: string;
  driverId: string | null | undefined;
  date: string | null | undefined;
}) {
  const q = useDriverConflicts(driverId, date ?? null);
  if (!driverId || !date) return null;
  const info = q.data?.perJob?.[jobId];
  if (!info || info.severity === "free") return null;
  const isHard = info.severity === "conflict";
  const cls = isHard
    ? "border-red-500/40 bg-red-500/10 text-red-900 dark:text-red-200"
    : "border-amber-500/40 bg-amber-500/10 text-amber-900 dark:text-amber-200";
  const icon = isHard ? (
    <AlertTriangle className="h-4 w-4" />
  ) : (
    <Clock className="h-4 w-4" />
  );

  return (
    <div className={`rounded-md border px-3 py-2 text-xs ${cls}`}>
      <div className="flex items-start gap-2">
        <div className="mt-0.5 shrink-0">{icon}</div>
        <div className="flex-1 min-w-0 space-y-1">
          <div className="font-semibold">
            {isHard ? "Schedule conflict for this driver" : "Tight handover"}
          </div>
          {info.pairs.map((p, i) => (
            <div key={i} className="text-[11px] leading-snug opacity-90">
              {p.reason}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
