import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  Navigation, MapPin, Check, Users, ChevronDown, ChevronUp, Clock, Route as RouteIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { updateJobStatus } from "@/lib/coordinator-public.functions";
import { displayLocation } from "@/lib/trip-display";
import { formatMaltaTime } from "@/lib/time";
import type { DriverRun } from "@/hooks/use-driver-runs";

/**
 * A "Run Card" for grouped multi-stop trips. Shows one merged card for jobs
 * sharing a group_id after every job in the group has been accepted.
 *
 * Behavior:
 *  - "On the way" → fans out en_route to every job in the run.
 *  - "Arrived" / "Start trip" / "Complete stop" → advances the *current* stop
 *    only; the next non-completed leg becomes the new current stop.
 *  - Stop list: done rows are muted, current row is highlighted, upcoming
 *    rows are compact — tap to preview the underlying job.
 */

type Job = {
  id: string;
  status?: string | null;
  pickup_at?: string | null;
  from_location?: string | null;
  to_location?: string | null;
  pickup_display_name?: string | null;
  dropoff_display_name?: string | null;
  name?: string | null;
  surname?: string | null;
  pax?: Array<{ id: string }> | null;
  group_id?: string | null;
  group_name?: string | null;
};

// Numbered stop chip palette (matches coordinator side).
const CHIP_COLORS = ["#0EA5E9", "#22C55E", "#F59E0B", "#A855F7", "#EF4444", "#14B8A6"];

export function RunCard({
  run,
  token,
  isSafetyMode,
  onOpenJob,
}: {
  run: DriverRun<Job>;
  token: string;
  isSafetyMode: boolean;
  onOpenJob: (job: Job) => void;
}) {
  const qc = useQueryClient();
  const statusFn = useServerFn(updateJobStatus);
  const [expanded, setExpanded] = useState(true);

  const { jobs, currentIndex, currentJob, totalCount, groupId } = run;

  // Chain reflow: leg N goes from stop N-1's drop-off (or the very first pickup) to stop N's drop-off.
  const legs = useMemo(() => {
    return jobs.map((j, i) => {
      const from =
        i === 0
          ? displayLocation(j.from_location, j.pickup_display_name)
          : displayLocation(jobs[i - 1].to_location, jobs[i - 1].dropoff_display_name);
      const to = displayLocation(j.to_location, j.dropoff_display_name);
      return { from, to };
    });
  }, [jobs]);

  const runStatus: "pending" | "en_route" | "in_progress" | "completed" = useMemo(() => {
    if (jobs.every((j) => j.status === "completed")) return "completed";
    if (jobs.some((j) => j.status === "in_progress")) return "in_progress";
    if (jobs.some((j) => j.status === "en_route" || j.status === "arrived")) return "en_route";
    return "pending";
  }, [jobs]);

  const invalidate = () => qc.invalidateQueries({ queryKey: ["driver-manifest"] });

  // Fan-out: put every leg on the way at once.
  const onTheWayMut = useMutation({
    mutationFn: async () => {
      const targets = jobs.filter(
        (j) => j.status !== "en_route" && j.status !== "arrived"
          && j.status !== "in_progress" && j.status !== "completed" && j.status !== "cancelled",
      );
      await Promise.all(
        targets.map((j) =>
          statusFn({ data: { token, job_id: j.id, status: "en_route" as const } }),
        ),
      );
    },
    onSuccess: () => {
      toast.success("Run started — all stops on the way");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Per-stop advance: only touches the current leg.
  const advanceMut = useMutation({
    mutationFn: async (nextStatus: "arrived" | "in_progress" | "completed") => {
      if (!currentJob) throw new Error("No current stop");
      await statusFn({ data: { token, job_id: currentJob.id, status: nextStatus } });
    },
    onSuccess: (_r, nextStatus) => {
      if (nextStatus === "completed" && currentIndex === totalCount - 1) {
        toast.success("Run complete 🎉");
      } else if (nextStatus === "completed") {
        toast.success(`Stop ${currentIndex + 1} done — next stop ready`);
      }
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const currentLeg = currentIndex >= 0 ? legs[currentIndex] : null;
  const currentPax = currentJob?.pax?.length ?? 0;

  // Header route label (never flashes → tabular-nums + fixed heights).
  const headerFrom = currentLeg?.from ?? legs[0]?.from ?? "—";
  const headerTo = currentLeg?.to ?? legs[legs.length - 1]?.to ?? "—";
  const headerPickupAt = currentJob?.pickup_at
    ? formatMaltaTime(currentJob.pickup_at)
    : null;

  const navHref = currentLeg?.from
    ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(
        runStatus === "in_progress"
          ? (currentJob?.to_location ?? currentLeg.to)
          : (currentJob?.from_location ?? currentLeg.from),
      )}&travelmode=driving`
    : null;

  const railColor =
    runStatus === "completed" ? "bg-slate-400"
    : runStatus === "in_progress" ? "bg-blue-500"
    : runStatus === "en_route" ? "bg-emerald-500"
    : "bg-amber-500";

  // ── Safety mode: collapsed, essentials only ─────────────────────────────
  if (isSafetyMode && currentJob) {
    return (
      <div className="rounded-2xl border-2 border-blue-500/60 bg-blue-500/5 shadow-lg overflow-hidden">
        <div className={`h-1.5 ${railColor}`} />
        <div className="p-4 space-y-3">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-blue-700 dark:text-blue-300">
            Run · Stop {currentIndex + 1} of {totalCount}
          </div>
          <div className="text-lg font-bold truncate">{headerTo}</div>
          <div className="flex gap-2">
            {navHref && (
              <Button asChild className="flex-1 h-14 text-base">
                <a href={navHref} target="_blank" rel="noopener noreferrer">
                  <Navigation className="h-5 w-5 mr-2" /> Navigate
                </a>
              </Button>
            )}
            {runStatus === "pending" && (
              <Button
                className="flex-1 h-14 text-base"
                disabled={onTheWayMut.isPending}
                onClick={() => onTheWayMut.mutate()}
              >
                On the way
              </Button>
            )}
            {(currentJob.status === "en_route") && (
              <Button
                className="flex-1 h-14 text-base"
                disabled={advanceMut.isPending}
                onClick={() => advanceMut.mutate("arrived")}
              >
                Arrived
              </Button>
            )}
            {currentJob.status === "arrived" && (
              <Button
                className="flex-1 h-14 text-base"
                disabled={advanceMut.isPending}
                onClick={() => advanceMut.mutate("in_progress")}
              >
                Start
              </Button>
            )}
            {currentJob.status === "in_progress" && (
              <Button
                className="flex-1 h-14 text-base bg-emerald-600 hover:bg-emerald-700"
                disabled={advanceMut.isPending}
                onClick={() => advanceMut.mutate("completed")}
              >
                <Check className="h-5 w-5 mr-1" /> Done
              </Button>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border-2 border-blue-500/60 bg-card shadow-lg overflow-hidden">
      <div className={`h-1.5 ${railColor}`} />

      {/* Header */}
      <div className="px-4 pt-3 pb-2">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <Badge className="bg-blue-600 hover:bg-blue-600 gap-1">
              <RouteIcon className="h-3 w-3" /> Run
            </Badge>
            <span className="text-xs text-muted-foreground truncate">
              {run.jobs[0]?.group_name ?? "Grouped run"} · {totalCount} stops
            </span>
          </div>
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="p-1 rounded hover:bg-muted"
            aria-label={expanded ? "Collapse" : "Expand"}
          >
            {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>
        </div>

        {/* Stable stop pointer (tabular-nums, reserved height) */}
        <div className="mt-2 min-h-[3.25rem] flex flex-col justify-center">
          {currentJob ? (
            <>
              <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground tabular-nums">
                Stop {currentIndex + 1} of {totalCount}
                {headerPickupAt && (
                  <span className="ml-2 inline-flex items-center gap-1 normal-case text-muted-foreground">
                    <Clock className="h-3 w-3" /> {headerPickupAt}
                  </span>
                )}
              </div>
              <div className="mt-0.5 flex items-center gap-1.5 text-sm font-semibold truncate">
                <span className="truncate">{headerFrom}</span>
                <span className="text-muted-foreground">→</span>
                <span className="truncate">{headerTo}</span>
              </div>
            </>
          ) : (
            <div className="text-sm font-medium text-emerald-700 dark:text-emerald-400 flex items-center gap-1.5">
              <Check className="h-4 w-4" /> Run complete
            </div>
          )}
        </div>

        {/* Run-level primary action row */}
        {currentJob && (
          <div className="mt-2 flex gap-2 flex-wrap">
            {navHref && (
              <Button asChild size="sm" variant="outline" className="h-9">
                <a href={navHref} target="_blank" rel="noopener noreferrer">
                  <Navigation className="h-4 w-4 mr-1.5" /> Navigate
                </a>
              </Button>
            )}
            {runStatus === "pending" && (
              <Button
                size="sm"
                className="h-9"
                disabled={onTheWayMut.isPending}
                onClick={() => onTheWayMut.mutate()}
              >
                On the way (all {totalCount})
              </Button>
            )}
            {currentJob.status === "en_route" && (
              <Button
                size="sm"
                className="h-9"
                disabled={advanceMut.isPending}
                onClick={() => advanceMut.mutate("arrived")}
              >
                <MapPin className="h-4 w-4 mr-1.5" /> Arrived at stop {currentIndex + 1}
              </Button>
            )}
            {currentJob.status === "arrived" && (
              <Button
                size="sm"
                className="h-9"
                disabled={advanceMut.isPending}
                onClick={() => advanceMut.mutate("in_progress")}
              >
                Start trip
              </Button>
            )}
            {currentJob.status === "in_progress" && (
              <Button
                size="sm"
                className="h-9 bg-emerald-600 hover:bg-emerald-700"
                disabled={advanceMut.isPending}
                onClick={() => advanceMut.mutate("completed")}
              >
                <Check className="h-4 w-4 mr-1.5" /> Complete stop {currentIndex + 1}
              </Button>
            )}
            {currentPax > 0 && (
              <Badge variant="outline" className="h-6 gap-1 text-[10px]">
                <Users className="h-3 w-3" /> {currentPax} pax
              </Badge>
            )}
          </div>
        )}
      </div>

      {/* Stop list */}
      {expanded && (
        <ol className="border-t divide-y">
          {jobs.map((j, i) => {
            const isDone = j.status === "completed";
            const isCurrent = i === currentIndex;
            const chip = CHIP_COLORS[i % CHIP_COLORS.length];
            const label = displayLocation(j.to_location, j.dropoff_display_name);
            const pax = j.pax?.length ?? 0;
            return (
              <li key={j.id}>
                <button
                  type="button"
                  onClick={() => onOpenJob(j)}
                  className={`w-full text-left px-4 py-2.5 flex items-center gap-3 hover:bg-muted/40 transition ${
                    isCurrent ? "bg-blue-500/5" : isDone ? "opacity-60" : ""
                  }`}
                >
                  <span
                    className="h-7 w-7 rounded-full grid place-items-center text-[11px] font-bold text-white shrink-0"
                    style={{ background: isDone ? "#64748B" : chip }}
                  >
                    {isDone ? <Check className="h-3.5 w-3.5" /> : i + 1}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className={`text-sm truncate ${isCurrent ? "font-semibold" : "font-medium"}`}>
                      {label}
                    </div>
                    <div className="text-[10px] text-muted-foreground flex gap-2 flex-wrap tabular-nums">
                      {j.pickup_at && <span>{formatMaltaTime(j.pickup_at)}</span>}
                      {pax > 0 && <span>{pax} pax</span>}
                      {(j.name || j.surname) && (
                        <span className="truncate">
                          {j.name} {j.surname}
                        </span>
                      )}
                      {isCurrent && !isDone && (
                        <span className="text-blue-600 dark:text-blue-400 font-semibold uppercase">
                          Current
                        </span>
                      )}
                      {isDone && <span className="text-emerald-600">Done</span>}
                    </div>
                  </div>
                </button>
              </li>
            );
          })}
        </ol>
      )}

      <div className="px-4 py-2 border-t text-[10px] text-muted-foreground bg-muted/20">
        Reorder stops from the coordinator side. Tap any stop above for full trip details.
      </div>
      {/* groupId kept for future per-run controls */}
      <span data-run-group={groupId} className="hidden" />
    </div>
  );
}
