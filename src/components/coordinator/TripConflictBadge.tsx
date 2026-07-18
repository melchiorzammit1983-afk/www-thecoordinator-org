import { AlertTriangle, Clock } from "lucide-react";
import { useDriverConflicts } from "@/hooks/use-driver-conflicts";

/**
 * Passive advisory shown on a trip card when the assigned driver has a
 * schedule collision involving this trip. Advisory only — never blocks.
 *
 * Rendered on the LATER trip of a conflicting pair (that's the one at risk
 * of starting late). The upstream `evaluatePairs` records both trip ids in
 * `perJob`, so we filter to pairs where this trip is the `next_job_id`.
 */
export function TripConflictBadge({
  jobId,
  driverId,
  date,
  className,
}: {
  jobId: string;
  driverId: string | null | undefined;
  date: string | null | undefined;
  className?: string;
}) {
  const q = useDriverConflicts(driverId, date ?? null);
  if (!driverId || !date) return null;
  const info = q.data?.perJob?.[jobId];
  if (!info) return null;
  // Only surface a warning if THIS trip is the one that would start late
  // (i.e. it's the "next" in the conflicting pair).
  const latePairs = info.pairs.filter((p) => p.next_job_id === jobId && p.severity !== "free");
  if (latePairs.length === 0) return null;
  // Worst severity across pairs where this trip is the "next".
  const worst = latePairs.reduce(
    (acc, p) => (p.severity === "conflict" ? "conflict" : acc),
    "tight" as "tight" | "conflict",
  );
  const isHard = worst === "conflict";
  const minSlack = Math.min(...latePairs.map((p) => p.slack_min));
  const label = isHard
    ? `Possible delay: ~${Math.abs(minSlack)} min late (previous trip ends nearby)`
    : `Tight handover: only ${minSlack} min slack from previous trip`;
  const cls = isHard
    ? "border-red-500/50 bg-red-500/10 text-red-800 dark:text-red-200"
    : "border-amber-500/50 bg-amber-500/10 text-amber-800 dark:text-amber-200";
  return (
    <div
      className={`mt-1 inline-flex items-start gap-1.5 rounded-md border px-2 py-1 text-[11px] font-medium ${cls} ${className ?? ""}`}
      title="Advisory — trip was not blocked. Open trip for full timeline."
    >
      {isHard ? <AlertTriangle className="h-3 w-3 mt-[1px]" /> : <Clock className="h-3 w-3 mt-[1px]" />}
      <span className="leading-snug">{label}</span>
    </div>
  );
}
