import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ChevronDown, ChevronUp, ArrowUp, ArrowDown, Check, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { listGroupStops, reorderStops } from "@/lib/groups.functions";
import { approveStopReorder } from "@/lib/audit.functions";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { displayLocation, formatMaltaTime as _t } from "@/lib/trip-display";
import { formatMaltaTime } from "@/lib/time";

export function GroupStopsPanel({ groupId, groupName }: { groupId: string; groupName?: string | null }) {
  const [open, setOpen] = useState(false);
  const qc = useQueryClient();
  const listFn = useServerFn(listGroupStops);
  const reorderFn = useServerFn(reorderStops);
  const approveFn = useServerFn(approveStopReorder);

  const { data } = useQuery({
    queryKey: ["group-stops", groupId],
    queryFn: () => listFn({ data: { group_id: groupId } }),
    enabled: open,
  });

  const reorder = useMutation({
    mutationFn: (ordered: string[]) =>
      reorderFn({ data: { group_id: groupId, ordered_stop_ids: ordered } }),
    onSuccess: () => {
      toast.success("Stops reordered");
      qc.invalidateQueries({ queryKey: ["group-stops", groupId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const decide = useMutation({
    mutationFn: (v: { request_id: string; approve: boolean }) =>
      approveFn({ data: v }),
    onSuccess: (_r, v) => {
      toast.success(v.approve ? "Reorder approved" : "Reorder rejected");
      qc.invalidateQueries({ queryKey: ["group-stops", groupId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const stops = data?.stops ?? [];
  const pending = data?.pending_reorders ?? [];

  const move = (idx: number, dir: -1 | 1) => {
    const next = idx + dir;
    if (next < 0 || next >= stops.length) return;
    const order = stops.map((s: any) => s.id);
    [order[idx], order[next]] = [order[next], order[idx]];
    reorder.mutate(order);
  };

  return (
    <div className="mt-2 rounded-md border bg-muted/30">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-3 py-2 text-sm font-medium"
      >
        <span>
          {groupName ?? "Grouped run"} · {stops.length || "…"} stops
          {pending.length > 0 && (
            <Badge variant="outline" className="ml-2 h-4 px-1.5 text-[10px] border-amber-500/40 text-amber-700">
              {pending.length} pending
            </Badge>
          )}
        </span>
        {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
      </button>
      {open && (
        <div className="px-3 pb-3 space-y-2">
          {pending.length > 0 && (
            <div className="space-y-1">
              {pending.map((p: any) => (
                <div
                  key={p.id}
                  className="rounded border border-amber-500/40 bg-amber-500/10 p-2 text-xs"
                >
                  <div className="font-medium">Driver requested reorder</div>
                  <div className="mt-1 flex gap-1.5">
                    <Button
                      size="sm"
                      className="h-7 px-2 text-[11px]"
                      disabled={decide.isPending}
                      onClick={() => decide.mutate({ request_id: p.id, approve: true })}
                    >
                      <Check className="h-3 w-3 mr-1" /> Approve
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 px-2 text-[11px]"
                      disabled={decide.isPending}
                      onClick={() => decide.mutate({ request_id: p.id, approve: false })}
                    >
                      <X className="h-3 w-3 mr-1" /> Reject
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
          {stops.length === 0 ? (
            <div className="text-[11px] text-muted-foreground">
              No detailed stops recorded yet for this group.
            </div>
          ) : (
            <ol className="space-y-1">
              {stops.map((s: any, i: number) => (
                <li
                  key={s.id}
                  className="flex items-center gap-2 rounded border bg-background px-2 py-1.5 text-xs"
                >
                  <span className="w-5 text-center font-mono text-muted-foreground">{i + 1}</span>
                  <div className="flex-1 min-w-0">
                    <div className="truncate font-medium">
                      {displayLocation(s.address, s.display_name)}
                    </div>
                    <div className="text-[10px] text-muted-foreground flex gap-2 flex-wrap">
                      {s.pax_count > 0 && <span>{s.pax_count} pax</span>}
                      {s.arrived_at && <span>arr {formatMaltaTime(s.arrived_at)}</span>}
                      {s.boarded_at && <span>brd {formatMaltaTime(s.boarded_at)}</span>}
                      {s.no_show_at && <span className="text-red-600">no-show</span>}
                      {s.charges_cents > 0 && <span>€{(s.charges_cents / 100).toFixed(2)}</span>}
                    </div>
                  </div>
                  <div className="flex flex-col gap-0.5">
                    <button
                      className="p-0.5 rounded hover:bg-muted disabled:opacity-30"
                      onClick={() => move(i, -1)}
                      disabled={i === 0 || reorder.isPending}
                      aria-label="Move up"
                    >
                      <ArrowUp className="h-3 w-3" />
                    </button>
                    <button
                      className="p-0.5 rounded hover:bg-muted disabled:opacity-30"
                      onClick={() => move(i, 1)}
                      disabled={i === stops.length - 1 || reorder.isPending}
                      aria-label="Move down"
                    >
                      <ArrowDown className="h-3 w-3" />
                    </button>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </div>
  );
}
