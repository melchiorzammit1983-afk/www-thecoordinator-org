import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { AlertTriangle, Bell, BellOff, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { listPendingRouteOptimizations } from "@/lib/route-optimization.functions";

/**
 * Persistent alert banner + browser push + red-dot count for pending route
 * optimizations that require coordinator approval. Plays a subtle chime on
 * newly discovered pending items.
 */
export function useRouteOptimizationAlerts() {
  const qc = useQueryClient();
  const fn = useServerFn(listPendingRouteOptimizations);
  const q = useQuery({
    queryKey: ["route-opt-pending"],
    queryFn: () => fn() as Promise<any[]>,
    refetchInterval: 30_000,
    staleTime: 15_000,
  });

  // Realtime: any change to the table refreshes the list immediately.
  useEffect(() => {
    const ch = supabase
      .channel("route-opt-alerts")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "group_route_optimizations" },
        () => qc.invalidateQueries({ queryKey: ["route-opt-pending"] }),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [qc]);

  const rows = q.data ?? [];
  const count = rows.length;
  const seenRef = useRef<Set<string>>(new Set());
  const firstLoadRef = useRef(true);

  // Toast + chime for newly-seen pending items (skips initial snapshot).
  useEffect(() => {
    if (firstLoadRef.current) {
      rows.forEach((r) => seenRef.current.add(r.id));
      firstLoadRef.current = false;
      return;
    }
    const fresh = rows.filter((r) => !seenRef.current.has(r.id));
    if (fresh.length > 0) {
      fresh.forEach((r) => seenRef.current.add(r.id));
      toast.warning(`${fresh.length} new route suggestion${fresh.length > 1 ? "s" : ""} awaiting approval`, {
        duration: 8000,
      });
      playChime();
      if (typeof window !== "undefined" && "Notification" in window && Notification.permission === "granted") {
        try {
          new Notification("Route suggestion pending", {
            body: `${fresh.length} new AI route suggestion${fresh.length > 1 ? "s" : ""} need your review.`,
            tag: "route-optimization",
          });
        } catch {
          /* noop */
        }
      }
    }
  }, [rows]);

  return { count, rows };
}

function playChime() {
  if (typeof window === "undefined") return;
  try {
    const AudioCtx = (window as any).AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = "sine";
    o.frequency.setValueAtTime(880, ctx.currentTime);
    o.frequency.exponentialRampToValueAtTime(1320, ctx.currentTime + 0.2);
    g.gain.setValueAtTime(0.12, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.4);
    o.connect(g).connect(ctx.destination);
    o.start();
    o.stop(ctx.currentTime + 0.42);
  } catch {
    /* noop */
  }
}

export function RouteOptimizationAlertBanner() {
  const { count } = useRouteOptimizationAlerts();
  const [dismissedForCount, setDismissedForCount] = useState<number>(0);
  const [pushState, setPushState] = useState<NotificationPermission | "unsupported">(() =>
    typeof window === "undefined" || !("Notification" in window) ? "unsupported" : Notification.permission,
  );

  const visible = count > 0 && count !== dismissedForCount;
  const wantsPushCta = useMemo(
    () => visible && pushState === "default",
    [visible, pushState],
  );

  if (!visible) return null;

  return (
    <div
      role="alert"
      className="rounded-md border-2 border-amber-500 bg-amber-50 dark:bg-amber-950/40 px-3 py-2 flex items-center gap-2 shadow-sm"
    >
      <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0" />
      <div className="text-sm font-medium text-amber-900 dark:text-amber-100 flex-1 min-w-0">
        {count} AI route suggestion{count > 1 ? "s" : ""} pending your approval.
        <span className="text-xs font-normal text-amber-800/80 dark:text-amber-200/80 ml-2 hidden sm:inline">
          Open the trip · Group stops → Route optimization.
        </span>
      </div>
      {wantsPushCta && (
        <Button
          size="sm"
          variant="outline"
          className="h-7 gap-1"
          onClick={async () => {
            try {
              const p = await Notification.requestPermission();
              setPushState(p);
            } catch {
              setPushState("denied");
            }
          }}
        >
          <Bell className="h-3.5 w-3.5" />
          Enable alerts
        </Button>
      )}
      {pushState === "denied" && (
        <span className="hidden sm:inline-flex items-center gap-1 text-[11px] text-amber-800/70">
          <BellOff className="h-3 w-3" /> push blocked
        </span>
      )}
      <button
        type="button"
        aria-label="Dismiss"
        onClick={() => setDismissedForCount(count)}
        className="rounded p-1 hover:bg-amber-100 dark:hover:bg-amber-900/40 text-amber-700"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
