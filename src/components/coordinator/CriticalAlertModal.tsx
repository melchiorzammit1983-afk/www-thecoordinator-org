/**
 * Critical Watchtower alert modal.
 *
 * Polls the coordinator's Watchtower alerts and pops up a blocking dialog
 * for each `new` alert with severity >= 4 (Serious / Critical). Alerts
 * already seen in this browser session are suppressed via sessionStorage
 * so the modal doesn't re-open after a page reload for the same alert.
 *
 * Actions:
 *  - Review job    → navigate to the calendar filtered to the job
 *  - Acknowledge   → marks status="acknowledged", closes modal
 *  - Dismiss       → marks status="dismissed", closes modal
 */
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useNavigate } from "@tanstack/react-router";
import { AlertTriangle, ExternalLink, Check, X, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  acknowledgeWatchtowerAlert,
  listWatchtowerAlerts,
} from "@/lib/watchtower.functions";

const SEEN_KEY = "watchtower_seen_alerts_v1";

function loadSeen(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.sessionStorage.getItem(SEEN_KEY);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

function markSeen(id: string) {
  if (typeof window === "undefined") return;
  try {
    const set = loadSeen();
    set.add(id);
    window.sessionStorage.setItem(SEEN_KEY, JSON.stringify(Array.from(set)));
  } catch {
    /* ignore */
  }
}

type Alert = {
  id: string;
  title: string;
  body: string | null;
  severity: number;
  status: string;
  job_id: string | null;
  kind: string;
  created_at: string;
};

export function CriticalAlertModal() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const listAlerts = useServerFn(listWatchtowerAlerts);
  const ackAlert = useServerFn(acknowledgeWatchtowerAlert);

  const { data } = useQuery({
    queryKey: ["watchtower-alerts"],
    queryFn: () => listAlerts(),
    refetchInterval: 30_000,
  });

  const [seenTick, setSeenTick] = useState(0);
  const [busy, setBusy] = useState(false);

  const queue = useMemo<Alert[]>(() => {
    const alerts = ((data as any)?.alerts ?? []) as Alert[];
    const seen = loadSeen();
    return alerts
      .filter((a) => a.status === "new" && a.severity >= 4 && !seen.has(a.id))
      .sort((a, b) => b.severity - a.severity);
    // seenTick forces recompute after markSeen
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, seenTick]);

  const current = queue[0];
  const open = !!current;

  // When a new critical alert appears, gently nudge the tab title.
  useEffect(() => {
    if (!current || typeof document === "undefined") return;
    const original = document.title;
    document.title = `⚠ ${current.title} — ${original}`;
    return () => {
      document.title = original;
    };
  }, [current?.id]);

  if (!current) return null;

  async function handleAck(status: "acknowledged" | "dismissed") {
    if (!current || busy) return;
    setBusy(true);
    try {
      await ackAlert({ data: { id: current.id, status } });
      markSeen(current.id);
      qc.invalidateQueries({ queryKey: ["watchtower-alerts"] });
    } finally {
      setBusy(false);
      setSeenTick((t) => t + 1);
    }
  }

  function handleReview() {
    if (!current) return;
    markSeen(current.id);
    setSeenTick((t) => t + 1);
    if (current.job_id) {
      navigate({
        to: "/coordinator/calendar",
        search: { job: current.job_id } as any,
      }).catch(() => navigate({ to: "/coordinator/calendar" }));
    } else {
      navigate({ to: "/coordinator/calendar" });
    }
  }

  function handleSnooze() {
    if (!current) return;
    markSeen(current.id);
    setSeenTick((t) => t + 1);
  }

  const sevLabel = current.severity >= 5 ? "Critical" : "Serious";
  const sevClass =
    current.severity >= 5
      ? "bg-red-500/15 text-red-700 border-red-500/30"
      : "bg-amber-500/15 text-amber-700 border-amber-500/30";

  return (
    <Dialog open={open} onOpenChange={(v) => !v && handleSnooze()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <div
              className={
                current.severity >= 5
                  ? "h-9 w-9 rounded-full bg-red-500/15 text-red-600 flex items-center justify-center"
                  : "h-9 w-9 rounded-full bg-amber-500/15 text-amber-600 flex items-center justify-center"
              }
            >
              <AlertTriangle className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <DialogTitle className="text-base leading-tight">
                {current.title}
              </DialogTitle>
              <div className="mt-1 flex items-center gap-1.5">
                <Badge variant="outline" className={sevClass}>
                  {sevLabel}
                </Badge>
                <span className="text-[11px] text-muted-foreground capitalize">
                  {current.kind}
                </span>
                {queue.length > 1 && (
                  <span className="text-[11px] text-muted-foreground">
                    · +{queue.length - 1} more
                  </span>
                )}
              </div>
            </div>
          </div>
          {current.body && (
            <DialogDescription className="pt-3 text-sm text-foreground/80">
              {current.body}
            </DialogDescription>
          )}
        </DialogHeader>

        <DialogFooter className="gap-2 sm:gap-2 flex-col sm:flex-row">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleSnooze}
            disabled={busy}
            className="sm:mr-auto"
          >
            Later
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => handleAck("dismissed")}
            disabled={busy}
          >
            <X className="h-3.5 w-3.5 mr-1" />
            Dismiss
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => handleAck("acknowledged")}
            disabled={busy}
          >
            {busy ? (
              <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
            ) : (
              <Check className="h-3.5 w-3.5 mr-1" />
            )}
            Acknowledge
          </Button>
          {current.job_id && (
            <Button size="sm" onClick={handleReview} disabled={busy}>
              <ExternalLink className="h-3.5 w-3.5 mr-1" />
              Review job
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
