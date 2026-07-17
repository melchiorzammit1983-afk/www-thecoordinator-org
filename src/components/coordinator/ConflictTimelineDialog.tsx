import { AlertTriangle, ArrowDown, Check, Clock } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { ConflictPair, ConflictSeverity } from "@/lib/scheduling.functions";

function fmtHM(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function sevBadge(s: ConflictSeverity) {
  if (s === "conflict")
    return { cls: "bg-red-500/15 text-red-700 dark:text-red-300 border-red-500/30", label: "Conflict" };
  if (s === "tight")
    return { cls: "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30", label: "Tight" };
  return { cls: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30", label: "Free" };
}

function Row({
  time,
  title,
  detail,
  tone,
  icon,
}: {
  time: string;
  title: string;
  detail?: string;
  tone?: "muted" | "warn" | "bad" | "ok";
  icon?: React.ReactNode;
}) {
  const toneCls =
    tone === "bad"
      ? "text-red-700 dark:text-red-300"
      : tone === "warn"
        ? "text-amber-700 dark:text-amber-300"
        : tone === "ok"
          ? "text-emerald-700 dark:text-emerald-300"
          : "text-foreground";
  return (
    <div className="flex items-start gap-3">
      <div className="w-14 shrink-0 text-right font-mono text-xs tabular-nums text-muted-foreground pt-0.5">
        {time}
      </div>
      <div className="w-4 shrink-0 flex justify-center pt-1">
        <div className="h-2 w-2 rounded-full bg-border ring-2 ring-background" />
      </div>
      <div className="flex-1 min-w-0">
        <div className={`text-sm font-medium flex items-center gap-1.5 ${toneCls}`}>
          {icon}
          {title}
        </div>
        {detail && <div className="text-xs text-muted-foreground">{detail}</div>}
      </div>
    </div>
  );
}

/**
 * Renders the full "why did this collide?" timeline for one or more
 * ConflictPair rows: previous trip end → drop-off buffer → handover drive →
 * must-leave-by vs next pickup, with slack math surfaced.
 */
export function ConflictTimelineDialog({
  open,
  onOpenChange,
  pairs,
  driverName,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  pairs: ConflictPair[];
  driverName?: string | null;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Schedule collision breakdown</DialogTitle>
          <DialogDescription>
            {driverName ? `Timing math for ${driverName}. ` : ""}
            Each step shows the exact moment we predict — drop-off buffer is
            10&nbsp;min, tight threshold is 5&nbsp;min.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 max-h-[65vh] overflow-y-auto pr-1">
          {pairs.length === 0 && (
            <div className="text-sm text-muted-foreground">No conflict data to show.</div>
          )}
          {pairs.map((p, i) => {
            const badge = sevBadge(p.severity);
            const transitMin = p.transit_sec != null ? Math.round(p.transit_sec / 60) : null;
            const prevDurMin =
              p.prev_duration_sec != null ? Math.round(p.prev_duration_sec / 60) : null;
            const isBad = p.severity === "conflict";
            const isTight = p.severity === "tight";
            return (
              <div key={i} className="rounded-lg border p-3 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-xs text-muted-foreground">
                    Pair {i + 1} of {pairs.length}
                  </div>
                  <span
                    className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${badge.cls}`}
                  >
                    {isBad ? <AlertTriangle className="h-3 w-3" /> : isTight ? <Clock className="h-3 w-3" /> : <Check className="h-3 w-3" />}
                    {badge.label}
                  </span>
                </div>

                <div className="space-y-2">
                  <Row
                    time={fmtHM(p.prev_pickup_at)}
                    title="Previous trip starts"
                    detail={
                      p.prev_from_label && p.prev_to_label
                        ? `${p.prev_from_label} → ${p.prev_to_label}`
                        : undefined
                    }
                  />
                  <Row
                    time={fmtHM(p.prev_end_iso)}
                    title={`Previous trip ends${prevDurMin != null ? ` (~${prevDurMin} min drive)` : ""}`}
                    tone="muted"
                    icon={<ArrowDown className="h-3.5 w-3.5" />}
                  />
                  <Row
                    time="+10 min"
                    title="Passenger drop-off buffer"
                    detail="Unload luggage, farewell, ready to depart."
                    tone="muted"
                  />
                  <Row
                    time={transitMin != null ? `+${transitMin} min` : "+?"}
                    title="Drive to next pickup"
                    detail={
                      p.prev_to_label && p.next_from_label
                        ? `${p.prev_to_label} → ${p.next_from_label} (traffic-aware)`
                        : "Traffic-aware routing"
                    }
                    tone="muted"
                  />
                  <Row
                    time={fmtHM(p.must_leave_by_iso)}
                    title="Must leave prev drop-off by"
                    tone={isBad ? "bad" : isTight ? "warn" : "ok"}
                    icon={isBad || isTight ? <AlertTriangle className="h-3.5 w-3.5" /> : undefined}
                  />
                  <Row
                    time={fmtHM(p.next_pickup_at)}
                    title="Next pickup scheduled"
                    detail={
                      p.next_from_label && p.next_to_label
                        ? `${p.next_from_label} → ${p.next_to_label}`
                        : undefined
                    }
                    tone={isBad ? "bad" : isTight ? "warn" : "ok"}
                  />
                </div>

                <div
                  className={`rounded-md px-2.5 py-1.5 text-xs font-medium ${
                    isBad
                      ? "bg-red-500/10 text-red-800 dark:text-red-200"
                      : isTight
                        ? "bg-amber-500/10 text-amber-800 dark:text-amber-200"
                        : "bg-emerald-500/10 text-emerald-800 dark:text-emerald-200"
                  }`}
                >
                  {isBad
                    ? `Late by ${Math.abs(p.slack_min)} min.`
                    : isTight
                      ? `Only ${p.slack_min} min slack.`
                      : `${p.slack_min} min slack.`}
                </div>
              </div>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}
