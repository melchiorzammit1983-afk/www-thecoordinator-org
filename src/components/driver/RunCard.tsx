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
 * Two rendering modes:
 *  - Same-location run (all jobs share pickup AND dropoff): collapse to a
 *    single-trip card (one Navigate button, pax total, one status action that
 *    fans out to every job). This is the common "same shuttle, multiple pax"
 *    case.
 *  - Multi-stop run: numbered chips, chain-reflow legs, per-stop advance.
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

const norm = (s?: string | null) => (s ?? "").trim().toLowerCase();

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

  // Same-location detection: every job shares pickup AND dropoff.
  const sameLocation = useMemo(() => {
    if (jobs.length < 2) return false;
    const pickKey = (j: Job) => norm(j.from_location) || norm(j.pickup_display_name);
    const dropKey = (j: Job) => norm(j.to_location) || norm(j.dropoff_display_name);
    const p0 = pickKey(jobs[0]);
    const d0 = dropKey(jobs[0]);
    if (!p0 || !d0) return false;
    return jobs.every((j) => pickKey(j) === p0 && dropKey(j) === d0);
  }, [jobs]);

  const totalPax = useMemo(
    () => jobs.reduce((n, j) => n + (j.pax?.length ?? 0), 0),
    [jobs],
  );

  const passengerNames = useMemo(
    () =>
      jobs
        .map((j) => [j.name, j.surname].filter(Boolean).join(" ").trim())
        .filter(Boolean)
        .join(", "),
    [jobs],
  );

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

  // Fan out a status change to every job whose current status is in `fromStatuses`.
  const fanOut = async (
    fromStatuses: Array<string | null | undefined>,
    nextStatus: "en_route" | "arrived" | "in_progress" | "completed",
  ) => {
    const targets = jobs.filter((j) => fromStatuses.includes(j.status ?? null));
    if (!targets.length) return;
    await Promise.all(
      targets.map((j) =>
        statusFn({ data: { token, job_id: j.id, status: nextStatus } }),
      ),
    );
  };

  // ── Fan-out mutations (used by same-location + the "On the way" button) ──
  const onTheWayMut = useMutation({
    mutationFn: async () => {
      // Anything not already progressing → en_route.
      await fanOut(
        [null, undefined, "pending", "assigned", "accepted", "acknowledged"],
        "en_route",
      );
    },
    onSuccess: () => {
      toast.success(sameLocation ? "On the way" : "Run started — all stops on the way");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const runArrivedMut = useMutation({
    mutationFn: async () => { await fanOut(["en_route"], "arrived"); },
    onSuccess: () => { toast.success("Arrived at pickup"); invalidate(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const runStartMut = useMutation({
    mutationFn: async () => { await fanOut(["arrived", "en_route"], "in_progress"); },
    onSuccess: () => { toast.success("Trip started"); invalidate(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const runCompleteMut = useMutation({
    mutationFn: async () => { await fanOut(["in_progress", "arrived"], "completed"); },
    onSuccess: () => { toast.success("Trip complete 🎉"); invalidate(); },
    onError: (e: Error) => toast.error(e.message),
  });

  // Per-stop advance (multi-stop path only): only touches the current leg.
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

  const railColor =
    runStatus === "completed" ? "bg-slate-400"
    : runStatus === "in_progress" ? "bg-blue-500"
    : runStatus === "en_route" ? "bg-emerald-500"
    : "bg-amber-500";

  // ═══════════════════════════════════════════════════════════════════════
  // SAME-LOCATION RUN → single-trip card
  // ═══════════════════════════════════════════════════════════════════════
  if (sameLocation) {
    const sharedFrom = displayLocation(jobs[0].from_location, jobs[0].pickup_display_name);
    const sharedTo = displayLocation(jobs[0].to_location, jobs[0].dropoff_display_name);
    const earliestPickup = jobs
      .map((j) => j.pickup_at)
      .filter(Boolean)
      .sort()[0] as string | undefined;

    // Nav destination flips at in_progress, same as a normal JobCard.
    const navTarget =
      runStatus === "in_progress"
        ? (jobs[0].to_location ?? sharedTo)
        : (jobs[0].from_location ?? sharedFrom);
    const navHref = navTarget
      ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(navTarget)}&travelmode=driving`
      : null;

    // Which single action button to show — driven by the run's overall status.
    const actionButton = (() => {
      if (runStatus === "pending") {
        return (
          <Button
            className="flex-1 h-11"
            disabled={onTheWayMut.isPending}
            onClick={() => onTheWayMut.mutate()}
          >
            On the way
          </Button>
        );
      }
      // en_route: if every job is already arrived, show Start; else Arrived.
      if (runStatus === "en_route") {
        const allArrived = jobs.every((j) => j.status === "arrived" || j.status === "in_progress" || j.status === "completed");
        if (allArrived) {
          return (
            <Button
              className="flex-1 h-11"
              disabled={runStartMut.isPending}
              onClick={() => runStartMut.mutate()}
            >
              Start trip
            </Button>
          );
        }
        return (
          <Button
            className="flex-1 h-11"
            disabled={runArrivedMut.isPending}
            onClick={() => runArrivedMut.mutate()}
          >
            <MapPin className="h-4 w-4 mr-1.5" /> Arrived
          </Button>
        );
      }
      if (runStatus === "in_progress") {
        return (
          <Button
            className="flex-1 h-11 bg-emerald-600 hover:bg-emerald-700"
            disabled={runCompleteMut.isPending}
            onClick={() => runCompleteMut.mutate()}
          >
            <Check className="h-4 w-4 mr-1.5" /> Complete trip
          </Button>
        );
      }
      return null;
    })();

    // Safety-mode variant: big buttons, essentials only.
    if (isSafetyMode) {
      return (
        <div className="rounded-2xl border-2 border-blue-500/60 bg-blue-500/5 shadow-lg overflow-hidden">
          <div className={`h-1.5 ${railColor}`} />
          <div className="p-4 space-y-3">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-blue-700 dark:text-blue-300">
              Shared trip · {totalPax} pax
            </div>
            <div className="text-lg font-bold truncate">
              {runStatus === "in_progress" ? sharedTo : sharedFrom}
            </div>
            <div className="flex gap-2">
              {navHref && (
                <Button asChild className="flex-1 h-14 text-base">
                  <a href={navHref} target="_blank" rel="noopener noreferrer">
                    <Navigation className="h-5 w-5 mr-2" /> Navigate
                  </a>
                </Button>
              )}
              {actionButton && (
                <div className="flex-1 h-14 flex">{actionButton}</div>
              )}
            </div>
          </div>
        </div>
      );
    }

    return (
      <div className="rounded-2xl border-2 border-blue-500/60 bg-card shadow-lg overflow-hidden">
        <div className={`h-1.5 ${railColor}`} />
        <div className="px-4 pt-3 pb-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <Badge className="bg-blue-600 hover:bg-blue-600 gap-1">
                <RouteIcon className="h-3 w-3" /> Run
              </Badge>
              <span className="text-xs text-muted-foreground truncate">
                {run.jobs[0]?.group_name ?? "Shared trip"} · {totalPax} pax
              </span>
            </div>
            <Badge variant="outline" className="h-6 gap-1 text-[10px]">
              <Users className="h-3 w-3" /> {totalPax}
            </Badge>
          </div>

          <div className="mt-2 min-h-[3.25rem] flex flex-col justify-center">
            {earliestPickup && (
              <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground tabular-nums flex items-center gap-1">
                <Clock className="h-3 w-3" /> {formatMaltaTime(earliestPickup)}
              </div>
            )}
            <div className="mt-0.5 flex items-center gap-1.5 text-sm font-semibold truncate">
              <span className="truncate">{sharedFrom}</span>
              <span className="text-muted-foreground">→</span>
              <span className="truncate">{sharedTo}</span>
            </div>
          </div>

          <div className="mt-2 flex gap-2 flex-wrap">
            {navHref && (
              <Button asChild size="sm" className="h-11 flex-1 min-w-[8rem]">
                <a href={navHref} target="_blank" rel="noopener noreferrer">
                  <Navigation className="h-4 w-4 mr-1.5" /> Navigate
                </a>
              </Button>
            )}
            {actionButton}
          </div>

          {passengerNames && (
            <div className="mt-3 pt-3 border-t text-xs">
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">
                Passengers ({totalPax})
              </div>
              <div className="text-foreground/80">{passengerNames}</div>
            </div>
          )}

          {/* Tap-through: let driver open any underlying job for full details. */}
          <div className="mt-2 flex flex-wrap gap-1">
            {jobs.map((j, i) => (
              <button
                key={j.id}
                type="button"
                onClick={() => onOpenJob(j)}
                className="text-[10px] px-2 py-0.5 rounded-full border hover:bg-muted transition"
              >
                Details #{i + 1}
              </button>
            ))}
          </div>
        </div>
        <span data-run-group={groupId} className="hidden" />
      </div>
    );
  }

  // ═══════════════════════════════════════════════════════════════════════
  // MULTI-STOP RUN → original numbered-stop UI
  // ═══════════════════════════════════════════════════════════════════════

  const currentLeg = currentIndex >= 0 ? legs[currentIndex] : null;
  const currentPax = currentJob?.pax?.length ?? 0;

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
      <span data-run-group={groupId} className="hidden" />
    </div>
  );
}
