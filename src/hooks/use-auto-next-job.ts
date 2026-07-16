import { useEffect, useRef, useState } from "react";
import { midRunGroupIds } from "@/hooks/use-driver-runs";

const SNOOZE_KEY = "auto-next-job-snooze-until";

/**
 * Watches a manifest for a job transitioning into `completed`.
 * Returns the *next assigned upcoming* job to surface + a dismiss callback.
 *
 * Client-side only. No new server contract; reads existing manifest data.
 */
export function useAutoNextJob<
  T extends { id: string; status?: string | null; pickup_at?: string | null; date?: string | null },
>(jobs: T[] | undefined, opts?: { enabled?: boolean }): {
  nextJob: T | null;
  dismiss: () => void;
} {
  const enabled = opts?.enabled ?? true;
  const prevStatuses = useRef<Record<string, string>>({});
  const [nextJob, setNextJob] = useState<T | null>(null);

  useEffect(() => {
    if (!enabled || !jobs) return;
    const snoozeUntil = Number(localStorage.getItem(SNOOZE_KEY) ?? "0");
    if (snoozeUntil && snoozeUntil > Date.now()) return;

    let triggered = false;
    for (const j of jobs) {
      const prev = prevStatuses.current[j.id];
      if (prev && prev !== "completed" && j.status === "completed") {
        triggered = true;
        break;
      }
    }

    // Update mirror after check
    const nextMirror: Record<string, string> = {};
    for (const j of jobs) nextMirror[j.id] = j.status ?? "";
    prevStatuses.current = nextMirror;

    if (!triggered) return;

    // Find next assigned upcoming job (soonest pickup > now)
    const now = Date.now();
    const upcoming = jobs
      .filter(
        (j) =>
          j.status !== "completed" &&
          j.status !== "cancelled" &&
          j.pickup_at &&
          new Date(j.pickup_at).getTime() > now,
      )
      .sort(
        (a, b) => new Date(a.pickup_at!).getTime() - new Date(b.pickup_at!).getTime(),
      );

    if (upcoming.length > 0) setNextJob(upcoming[0]);
  }, [jobs, enabled]);

  const dismiss = () => {
    setNextJob(null);
    // Snooze for 15 minutes to avoid re-popping on the same manifest tick
    localStorage.setItem(SNOOZE_KEY, String(Date.now() + 15 * 60_000));
  };

  return { nextJob, dismiss };
}
