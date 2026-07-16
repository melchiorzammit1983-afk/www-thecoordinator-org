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
  live_eta_updated_at?: string | null;
};

const STALE_MS = 30 * 60_000;
const LIVE_STALE_MS = 90_000;
const DEBOUNCE_MS = 60_000;
const POLL_MS = 60_000;

export function useEnrichVisibleJobs(jobs: EnrichableJob[] | null | undefined, invalidateKeys: readonly unknown[][]) {
  const fn = useServerFn(backfillJobEnrichment);
  const qc = useQueryClient();
  const lastSentRef = useRef<Map<string, number>>(new Map());
  const jobsRef = useRef<EnrichableJob[] | null | undefined>(jobs);
  jobsRef.current = jobs;

  useEffect(() => {
    if (!jobs?.length) return;

    const runOnce = () => {
      const current = jobsRef.current;
      if (!current?.length) return;
      const now = Date.now();
      const needsWork = current
        .filter((j) => {
          if (!j?.id) return false;
          const missingName =
            (!j.pickup_display_name && !!j.from_location) ||
            (!j.dropoff_display_name && !!j.to_location);
          const missingRoute =
            !!j.from_location && !!j.to_location &&
            (!j.route_duration_sec ||
              !j.route_computed_at ||
              now - new Date(j.route_computed_at).getTime() > STALE_MS);
          const staleLiveEta =
            !!j.from_location && !!j.to_location &&
            (!j.live_eta_updated_at ||
              now - new Date(j.live_eta_updated_at).getTime() > LIVE_STALE_MS);
          if (!missingName && !missingRoute && !staleLiveEta) return false;
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
    };

    // Initial pass on job-list change.
    runOnce();

    let intervalId: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (intervalId != null) return;
      intervalId = setInterval(runOnce, POLL_MS);
    };
    const stop = () => {
      if (intervalId == null) return;
      clearInterval(intervalId);
      intervalId = null;
    };

    const onVisibility = () => {
      if (typeof document === "undefined") return;
      if (document.visibilityState === "hidden") {
        stop();
      } else {
        runOnce();
        start();
      }
    };

    if (typeof document === "undefined" || document.visibilityState !== "hidden") {
      start();
    }
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", onVisibility);
    }

    return () => {
      stop();
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", onVisibility);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobs?.map((j) => j.id).join(",")]);
}

