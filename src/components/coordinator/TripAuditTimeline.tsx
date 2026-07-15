import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ShieldCheck, ShieldAlert, MapPin, Clock } from "lucide-react";
import { listTripAudit } from "@/lib/audit.functions";
import { formatMaltaDateTime } from "@/lib/time";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const EVENT_ICON: Record<string, string> = {
  arrival_verified: "📍",
  arrival_manual: "📌",
  wait_started: "⏳",
  wait_ended: "⏱️",
  wait_charge_changed: "💶",
  boarding_started: "🚪",
  boarding_completed: "✅",
  boarding_approved: "🟢",
  pax_no_show: "🚫",
  pax_cancelled: "❌",
  override_arrived: "⚠️",
  override_on_board: "⚠️",
  override_en_route: "⚠️",
  override_drop_off: "⚠️",
  override_complete: "⚠️",
  safety_concern: "🛑",
  breakdown: "🔧",
  status_change: "🔁",
  stop_reordered: "🔀",
  stop_reorder_requested: "⏸️",
  stop_reorder_decided: "▶️",
  stop_split: "✂️",
  stop_merged: "🧩",
};

const APPROVAL_TONE: Record<string, string> = {
  approved: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30",
  rejected: "bg-red-500/15 text-red-700 dark:text-red-300 border-red-500/30",
  pending: "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30",
  overridden: "bg-blue-500/15 text-blue-700 dark:text-blue-300 border-blue-500/30",
  not_required: "bg-muted text-muted-foreground border-border",
};

export function TripAuditTimeline({ jobId }: { jobId: string }) {
  const fn = useServerFn(listTripAudit);
  const { data, isLoading } = useQuery({
    queryKey: ["trip-audit", jobId],
    queryFn: () => fn({ data: { job_id: jobId } }),
    staleTime: 15_000,
  });

  if (isLoading) return <div className="text-xs text-muted-foreground">Loading audit…</div>;
  if (!data || data.rows.length === 0)
    return <div className="text-xs text-muted-foreground">No audit events yet.</div>;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium">
          Audit trail · {data.rows.length} events
        </div>
        {data.chain_ok ? (
          <Badge variant="outline" className="gap-1 border-emerald-500/40 text-emerald-700 dark:text-emerald-300">
            <ShieldCheck className="h-3 w-3" /> Chain verified
          </Badge>
        ) : (
          <Badge variant="outline" className="gap-1 border-red-500/40 text-red-700 dark:text-red-300">
            <ShieldAlert className="h-3 w-3" /> Chain broken
          </Badge>
        )}
      </div>
      <ul className="space-y-1.5">
        {data.rows.map((r) => {
          const drift =
            r.device_time && r.server_time
              ? Math.abs(
                  (new Date(r.device_time).getTime() - new Date(r.server_time).getTime()) / 1000,
                )
              : null;
          return (
            <li
              key={r.id}
              className={cn(
                "rounded-md border bg-card px-2 py-1.5 text-xs",
                !r.chain_ok && "border-red-500/50 bg-red-500/5",
              )}
            >
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm leading-none">{EVENT_ICON[r.event_type] ?? "•"}</span>
                <span className="font-medium capitalize">{r.event_type.replace(/_/g, " ")}</span>
                <Badge
                  variant="outline"
                  className={cn("h-4 px-1.5 text-[9px] uppercase", APPROVAL_TONE[r.approval_status] ?? "")}
                >
                  {r.approval_status.replace("_", " ")}
                </Badge>
                {r.actor_label && (
                  <span className="text-[10px] text-muted-foreground">by {r.actor_label}</span>
                )}
                <span className="ml-auto text-[10px] text-muted-foreground inline-flex items-center gap-1">
                  <Clock className="h-3 w-3" /> {formatMaltaDateTime(r.server_time)}
                </span>
              </div>
              {r.notes && <div className="mt-1 text-[11px] text-foreground/80">{r.notes}</div>}
              {(r.gps_lat != null || r.street_address) && (
                <div className="mt-1 flex items-center gap-1 text-[10px] text-muted-foreground">
                  <MapPin className="h-3 w-3" />
                  {r.street_address ??
                    (r.gps_lat != null && r.gps_lng != null
                      ? `${Number(r.gps_lat).toFixed(5)}, ${Number(r.gps_lng).toFixed(5)}`
                      : null)}
                  {r.gps_accuracy_m != null && ` · ±${Math.round(Number(r.gps_accuracy_m))}m`}
                </div>
              )}
              {drift != null && drift > 60 && (
                <div className="mt-1 text-[10px] text-amber-600">
                  Device clock off by {Math.round(drift)}s
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
