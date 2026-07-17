import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { checkDriverConflicts, previewAssignmentConflicts } from "@/lib/scheduling.functions";

/**
 * Returns schedule-collision info for every trip a driver has on a given day.
 * Refreshes every 60s and whenever `queryClient.invalidateQueries(['driver-conflicts'])`
 * is called (mutations that assign / reassign / change pickup time should do this).
 *
 * Perf notes:
 * - `staleTime` matches the poll interval so mounting a second consumer of the
 *   same driver/date doesn't trigger an immediate extra request.
 * - `refetchOnWindowFocus: false` prevents a burst of Routes API calls when the
 *   dispatcher tabs back into the browser; the 60s interval is sufficient.
 * - Background polling is paused when the tab is hidden.
 */
export function useDriverConflicts(driver_id: string | null | undefined, date: string | null) {
  const fn = useServerFn(checkDriverConflicts);
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
 *
 * Perf notes:
 * - `staleTime` is generous (60s) so opening/closing the picker or flipping
 *   between candidates re-uses cached previews. The server-side transit-leg
 *   cache absorbs the rest.
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
