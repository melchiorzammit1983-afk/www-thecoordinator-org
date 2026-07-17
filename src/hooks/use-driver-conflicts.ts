import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { checkDriverConflicts, previewAssignmentConflicts } from "@/lib/scheduling.functions";

/**
 * Returns schedule-collision info for every trip a driver has on a given day.
 * Refreshes every 60s and whenever `queryClient.invalidateQueries(['driver-conflicts'])`
 * is called (mutations that assign / reassign / change pickup time should do this).
 */
export function useDriverConflicts(driver_id: string | null | undefined, date: string | null) {
  const fn = useServerFn(checkDriverConflicts);
  return useQuery({
    queryKey: ["driver-conflicts", driver_id, date],
    enabled: !!driver_id && !!date,
    staleTime: 30_000,
    refetchInterval: 60_000,
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
    staleTime: 30_000,
    queryFn: () => fn({ data: { driver_id: driver_id!, job_id: job_id! } }),
  });
}
