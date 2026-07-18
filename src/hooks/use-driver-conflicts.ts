import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { checkDriverConflicts, previewAssignmentConflicts } from "@/lib/scheduling.functions";

/**
 * Returns schedule-collision info for every trip a driver has on a given day.
 * Refreshes every 60s AND immediately whenever the ["jobs"] cache is
 * invalidated (any trip create / edit / driver (re)assignment — manual form,
 * AI assistant, or TripDetailsSheet — all invalidate ["jobs"]).
 */
export function useDriverConflicts(driver_id: string | null | undefined, date: string | null) {
  const fn = useServerFn(checkDriverConflicts);
  const qc = useQueryClient();

  // Bridge ["jobs"] invalidations to ["driver-conflicts"] so the passive
  // conflict badge on trip cards refreshes without every mutation call
  // site remembering to invalidate two keys.
  useEffect(() => {
    const cache = qc.getQueryCache();
    const unsub = cache.subscribe((event) => {
      if (event.type !== "updated") return;
      const key = event.query.queryKey as unknown[] | undefined;
      if (!Array.isArray(key) || key[0] !== "jobs") return;
      // Only react to invalidation events, not every fetch tick.
      const action = (event as unknown as { action?: { type?: string } }).action;
      if (action?.type !== "invalidate") return;
      qc.invalidateQueries({ queryKey: ["driver-conflicts"] });
    });
    return () => unsub();
  }, [qc]);

  return useQuery({
    queryKey: ["driver-conflicts", driver_id, date],
    enabled: !!driver_id && !!date,
    staleTime: 60_000,
    gcTime: 5 * 60_000,
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: false,
    queryFn: () => fn({ data: { driver_id: driver_id!, date: date! } }),
  });
}

/**
 * Preview: "if I assign this driver to this trip, will they collide?"
 * Used in the driver picker as the coordinator scrolls through candidates.
 */
export function useAssignmentPreview(
  driver_id: string | null,
  job_id: string | null,
  enabled = true,
) {
  const fn = useServerFn(previewAssignmentConflicts);
  return useQuery({
    queryKey: ["assignment-preview", driver_id, job_id],
    enabled: enabled && !!driver_id && !!job_id,
    staleTime: 60_000,
    gcTime: 5 * 60_000,
    refetchOnWindowFocus: false,
    queryFn: () => fn({ data: { driver_id: driver_id!, job_id: job_id! } }),
  });
}
