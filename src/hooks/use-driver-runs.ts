import { useMemo } from "react";

/**
 * Buckets a driver's jobs into "runs" (grouped multi-stop trips) and standalone jobs.
 *
 * A run is a set of jobs sharing the same `group_id`. A run is considered
 * "active" (renderable as a single Run Card) only once every job in the group
 * has been accepted by the driver. Partially-accepted groups fall back to
 * individual JobCards so the driver can accept the remaining trips.
 *
 * Stops inside a run are ordered by `pickup_at` ascending — this reflects the
 * chain reflow (leg 1 → leg 2 → leg 3) that the coordinator already sees.
 */
export type RunJobLike = {
  id: string;
  status?: string | null;
  pickup_at?: string | null;
  group_id?: string | null;
  driver_accepted_at?: string | null;
  deletion_requested_at?: string | null;
};

export type DriverRun<T extends RunJobLike> = {
  groupId: string;
  jobs: T[];
  acceptedCount: number;
  totalCount: number;
  fullyAccepted: boolean;
  currentIndex: number; // index of the first non-completed leg (-1 if all done)
  currentJob: T | null;
};

export function useDriverRuns<T extends RunJobLike>(jobs: T[] | undefined) {
  return useMemo(() => {
    const list = jobs ?? [];
    const groupMap = new Map<string, T[]>();
    const standalone: T[] = [];

    for (const j of list) {
      if (j.group_id) {
        const arr = groupMap.get(j.group_id) ?? [];
        arr.push(j);
        groupMap.set(j.group_id, arr);
      } else {
        standalone.push(j);
      }
    }

    const runs: DriverRun<T>[] = [];
    const partialGroupJobs: T[] = [];

    for (const [groupId, members] of groupMap.entries()) {
      const sorted = [...members].sort((a, b) => {
        const ta = a.pickup_at ? new Date(a.pickup_at).getTime() : Infinity;
        const tb = b.pickup_at ? new Date(b.pickup_at).getTime() : Infinity;
        return ta - tb;
      });
      const acceptedCount = sorted.filter((j) => !!j.driver_accepted_at).length;
      const fullyAccepted = acceptedCount === sorted.length && sorted.length >= 2;
      if (!fullyAccepted) {
        // Group not fully accepted yet → show as individual cards.
        for (const j of sorted) partialGroupJobs.push(j);
        continue;
      }
      const currentIndex = sorted.findIndex((j) => j.status !== "completed" && j.status !== "cancelled");
      runs.push({
        groupId,
        jobs: sorted,
        acceptedCount,
        totalCount: sorted.length,
        fullyAccepted,
        currentIndex,
        currentJob: currentIndex >= 0 ? sorted[currentIndex] : null,
      });
    }

    // Sort runs by their earliest pickup_at so they interleave naturally with standalone jobs.
    runs.sort((a, b) => {
      const ta = a.jobs[0]?.pickup_at ? new Date(a.jobs[0].pickup_at!).getTime() : Infinity;
      const tb = b.jobs[0]?.pickup_at ? new Date(b.jobs[0].pickup_at!).getTime() : Infinity;
      return ta - tb;
    });

    return { runs, standaloneJobs: [...standalone, ...partialGroupJobs] };
  }, [jobs]);
}

/**
 * Given the same jobs list, returns the set of group_ids that are mid-run
 * (fully accepted, some legs completed, some not). Used to suppress the
 * "Auto Next Job" sheet while the driver is still working through a run.
 */
export function midRunGroupIds(jobs: RunJobLike[] | undefined): Set<string> {
  const set = new Set<string>();
  if (!jobs) return set;
  const byGroup = new Map<string, RunJobLike[]>();
  for (const j of jobs) if (j.group_id) {
    const arr = byGroup.get(j.group_id) ?? [];
    arr.push(j);
    byGroup.set(j.group_id, arr);
  }
  for (const [gid, members] of byGroup.entries()) {
    const accepted = members.every((m) => !!m.driver_accepted_at);
    if (!accepted || members.length < 2) continue;
    const done = members.every((m) => m.status === "completed" || m.status === "cancelled");
    if (!done) set.add(gid);
  }
  return set;
}
