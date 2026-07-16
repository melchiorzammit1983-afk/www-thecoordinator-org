import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { backfillJobEnrichment } from "@/lib/places.functions";

/**
 * Fire-and-forget enrichment for the visible trip cards.
 *
 * - Only sends job ids that are missing a display name OR a fresh ETA.
 * - Debounces to at most one call per 60s per (job id, side) pair.
 * - Invalidates the passed React Query keys after a successful backfill so
 *   the UI picks up the new pickup_display_name / route_duration_sec.
 *
 * Feature flags on the server (`address_name_resolve`, `route_eta`) still
 * gate whether we actually charge points — if disabled, the server returns
 * without writes and this hook stays silent.
 */
type EnrichableJob = {
  id: string;
  from_location?: string | null;
  to_location?: string | null;
  pickup_display_name?: string | null;
  dropoff_display_name?: string | null;
  route_duration_sec?: number | null;
  route_computed_at?: string | null;
};

const STALE_MS = 30 * 60_000;
const DEBOUNCE_MS = 60_000;

export function useEnrichVisibleJobs(jobs: EnrichableJob[] | null | undefined, invalidateKeys: readonly unknown[][]) {
  const fn = useServerFn(backfillJobEnrichment);
  const qc = useQueryClient();
  const lastSentRef = useRef<Map<string, number>>(new Map());

  useEffect(() => {
    if (!jobs?.length) return;
    const now = Date.now();
    const needsWork = jobs
      .filter((j) => {
        if (!j?.id) return false;
        const missingName =
          (!j.pickup_display_name && !!j.from_location) ||
          (!j.dropoff_display_name && !!j.to_location);
        const missingEta =
          !!j.from_location && !!j.to_location &&
          (!j.route_duration_sec ||
            !j.route_computed_at ||
            now - new Date(j.route_computed_at).getTime() > STALE_MS);
        if (!missingName && !missingEta) return false;
        const last = lastSentRef.current.get(j.id) ?? 0;
        return now - last > DEBOUNCE_MS;
      })
      .slice(0, 40);
    if (!needsWork.length) return;
    for (const j of needsWork) lastSentRef.current.set(j.id, now);
    const ids = needsWork.map((j) => j.id);
    (async () => {
      try {
        const res: any = await fn({ data: { job_ids: ids, names: true, etas: true } });
        if (res?.updated) {
          for (const key of invalidateKeys) {
            qc.invalidateQueries({ queryKey: key });
          }
        }
      } catch {
        /* enrichment is best-effort; ignore failures */
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobs?.map((j) => j.id).join(",")]);
}
