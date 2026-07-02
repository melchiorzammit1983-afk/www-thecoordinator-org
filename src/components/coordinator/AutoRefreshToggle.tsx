import { useEffect, useRef, useState, useCallback } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQueryClient } from "@tanstack/react-query";
import { RefreshCw, Zap } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { normalizeJobData, checkFlightStatus } from "@/lib/coordinator.functions";

const STORAGE_KEY = "dispatch:autoRefresh";
const INTERVAL_MS = 60_000;
const CONCURRENCY = 4;

type JobLite = {
  id: string;
  status?: string | null;
  pickup_at?: string | null;
};

async function runPool<T>(items: T[], limit: number, worker: (t: T) => Promise<void>) {
  let i = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      try { await worker(items[idx]); } catch { /* swallow per-job */ }
    }
  });
  await Promise.all(runners);
}

export function AutoRefreshToggle({ jobs }: { jobs: JobLite[] }) {
  const [on, setOn] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem(STORAGE_KEY) === "1";
  });
  const [running, setRunning] = useState(false);
  const [countdown, setCountdown] = useState(INTERVAL_MS / 1000);
  const [lastSummary, setLastSummary] = useState<string | null>(null);

  const qc = useQueryClient();
  const normalizeFn = useServerFn(normalizeJobData);
  const flightFn = useServerFn(checkFlightStatus);

  const jobsRef = useRef(jobs);
  useEffect(() => { jobsRef.current = jobs; }, [jobs]);

  const sweep = useCallback(async () => {
    if (running) return;
    setRunning(true);
    try {
      const cutoff = Date.now() - 24 * 3600_000;
      const targets = (jobsRef.current ?? []).filter((j) => {
        if (!j?.id) return false;
        if (j.status === "cancelled") return false;
        if (j.pickup_at && new Date(j.pickup_at).getTime() < cutoff) return false;
        return true;
      });

      let cleaned = 0;
      let removed = 0;
      await runPool(targets, CONCURRENCY, async (j) => {
        const r = await normalizeFn({ data: { job_id: j.id } }) as
          { changed?: number; removed?: number } | undefined;
        cleaned += r?.changed ?? 0;
        removed += r?.removed ?? 0;
      });

      let flightsRefreshed = 0;
      try {
        const fr = await flightFn() as { updated?: number } | undefined;
        flightsRefreshed = fr?.updated ?? 0;
      } catch { /* ignore */ }

      qc.invalidateQueries({ queryKey: ["jobs"] });
      qc.invalidateQueries({ queryKey: ["job-pax"] });
      qc.invalidateQueries({ queryKey: ["live-locations"] });
      qc.invalidateQueries({ queryKey: ["collab"] });
      qc.invalidateQueries({ queryKey: ["coord-unread"] });

      const time = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
      const parts: string[] = [];
      if (cleaned) parts.push(`cleaned ${cleaned}`);
      if (removed) parts.push(`removed ${removed} blank`);
      if (flightsRefreshed) parts.push(`${flightsRefreshed} flight${flightsRefreshed === 1 ? "" : "s"}`);
      setLastSummary(`${parts.length ? parts.join(" · ") : "up to date"} · ${time}`);
    } finally {
      setRunning(false);
      setCountdown(INTERVAL_MS / 1000);
    }
  }, [running, normalizeFn, flightFn, qc]);

  // Timer + visibility handling
  useEffect(() => {
    if (!on) { setCountdown(INTERVAL_MS / 1000); return; }
    let mounted = true;
    // fire immediately on enable
    sweep();
    const tick = setInterval(() => {
      if (!mounted) return;
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      setCountdown((c) => {
        if (c <= 1) { sweep(); return INTERVAL_MS / 1000; }
        return c - 1;
      });
    }, 1000);
    const onVis = () => {
      if (document.visibilityState === "visible") { setCountdown(INTERVAL_MS / 1000); sweep(); }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      mounted = false;
      clearInterval(tick);
      document.removeEventListener("visibilitychange", onVis);
    };
    // sweep intentionally excluded — it's stable enough via refs
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [on]);

  function toggle() {
    const next = !on;
    setOn(next);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
    }
    if (next) toast.success("Auto-refresh on — cleaning data & refreshing flights every minute");
    else toast("Auto-refresh off");
  }

  return (
    <div className="flex flex-col items-start gap-0.5">
      <div className="flex items-center gap-1">
        <Button
          size="sm"
          variant={on ? "default" : "outline"}
          onClick={toggle}
          className="h-8"
          title={on ? "Auto-refresh is on" : "Turn on auto-refresh"}
        >
          <Zap className={`h-3.5 w-3.5 mr-1 ${on ? "" : "opacity-70"}`} />
          {on ? (
            <span className="flex items-center gap-1.5">
              <span className="relative inline-flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-300 opacity-75 animate-ping" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
              </span>
              <span className="text-xs">Auto · {countdown}s</span>
            </span>
          ) : (
            <span className="text-xs">Auto-refresh</span>
          )}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-8 w-8 p-0"
          onClick={sweep}
          disabled={running}
          title="Refresh now"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${running ? "animate-spin" : ""}`} />
        </Button>
      </div>
      {lastSummary && (
        <div className="text-[10px] text-muted-foreground pl-1 truncate max-w-[260px]">
          {lastSummary}
        </div>
      )}
    </div>
  );
}
