import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Sparkles, Check, X, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  suggestRouteOptimization,
  listGroupRouteOptimizations,
  approveRouteOptimization,
  rejectRouteOptimization,
} from "@/lib/route-optimization.functions";

function fmtMin(seconds: number | null | undefined) {
  if (seconds == null) return "—";
  return `${Math.round(seconds / 60)} min`;
}
function fmtKm(meters: number | null | undefined) {
  if (meters == null) return "—";
  return `${(meters / 1000).toFixed(1)} km`;
}

export function RouteOptimizationPanel({
  groupId,
  stopCount,
}: {
  groupId: string;
  stopCount: number;
}) {
  const qc = useQueryClient();
  const listFn = useServerFn(listGroupRouteOptimizations);
  const suggestFn = useServerFn(suggestRouteOptimization);
  const approveFn = useServerFn(approveRouteOptimization);
  const rejectFn = useServerFn(rejectRouteOptimization);

  const { data: rows = [] } = useQuery({
    queryKey: ["route-opts", groupId],
    queryFn: () => listFn({ data: { group_id: groupId } }),
  });

  const pending = rows.find((r: any) => r.status === "pending");
  const lastDecided = rows.find((r: any) => r.status !== "pending" && r.status !== "superseded");

  const suggest = useMutation({
    mutationFn: () => suggestFn({ data: { group_id: groupId } }),
    onSuccess: () => {
      toast.success("Route suggestion ready");
      qc.invalidateQueries({ queryKey: ["route-opts", groupId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const approve = useMutation({
    mutationFn: (id: string) => approveFn({ data: { id } }),
    onSuccess: () => {
      toast.success("Route applied");
      qc.invalidateQueries({ queryKey: ["route-opts", groupId] });
      qc.invalidateQueries({ queryKey: ["group-stops", groupId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const reject = useMutation({
    mutationFn: (id: string) => rejectFn({ data: { id } }),
    onSuccess: () => {
      toast.success("Suggestion rejected");
      qc.invalidateQueries({ queryKey: ["route-opts", groupId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const savingSec =
    pending && pending.duration_seconds_original != null && pending.duration_seconds_suggested != null
      ? pending.duration_seconds_original - pending.duration_seconds_suggested
      : null;

  return (
    <div className="rounded border bg-background p-2 text-xs space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium flex items-center gap-1">
          <Sparkles className="h-3.5 w-3.5 text-primary" />
          AI Route Optimization
        </span>
        <Button
          size="sm"
          variant="outline"
          className="h-7 px-2 text-[11px]"
          disabled={suggest.isPending || stopCount < 3 || !!pending}
          onClick={() => suggest.mutate()}
        >
          {suggest.isPending ? (
            <>
              <Loader2 className="h-3 w-3 mr-1 animate-spin" />
              Analysing…
            </>
          ) : (
            "Suggest better order"
          )}
        </Button>
      </div>
      {stopCount < 3 && (
        <div className="text-[10px] text-muted-foreground">
          Need at least 3 stops with coordinates to run optimization (3 points per suggestion).
        </div>
      )}
      {pending && (
        <div className="rounded border border-primary/40 bg-primary/5 p-2 space-y-1.5">
          <div className="flex items-center gap-1.5 text-[11px] font-medium">
            Pending suggestion
            <Badge variant="outline" className="h-4 px-1.5 text-[10px]">
              {pending.model?.split("/").pop() ?? "ai"}
            </Badge>
          </div>
          <div className="grid grid-cols-2 gap-1 text-[10px] text-muted-foreground">
            <div>
              <div className="font-medium text-foreground">Current</div>
              {fmtMin(pending.duration_seconds_original)} · {fmtKm(pending.distance_meters_original)}
            </div>
            <div>
              <div className="font-medium text-foreground">Suggested</div>
              {fmtMin(pending.duration_seconds_suggested)} · {fmtKm(pending.distance_meters_suggested)}
            </div>
          </div>
          {savingSec != null && savingSec > 60 && (
            <div className="text-[10px] text-emerald-700">
              Saves ~{Math.round(savingSec / 60)} min
            </div>
          )}
          {savingSec != null && savingSec <= 60 && (
            <div className="text-[10px] text-muted-foreground">
              Marginal improvement (&lt; 1 min).
            </div>
          )}
          {pending.reasoning && (
            <div className="text-[10px] text-muted-foreground italic">
              “{pending.reasoning}”
            </div>
          )}
          <div className="flex gap-1.5">
            <Button
              size="sm"
              className="h-7 px-2 text-[11px]"
              disabled={approve.isPending}
              onClick={() => approve.mutate(pending.id)}
            >
              <Check className="h-3 w-3 mr-1" /> Apply
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-7 px-2 text-[11px]"
              disabled={reject.isPending}
              onClick={() => reject.mutate(pending.id)}
            >
              <X className="h-3 w-3 mr-1" /> Reject
            </Button>
          </div>
        </div>
      )}
      {!pending && lastDecided && (
        <div className="text-[10px] text-muted-foreground">
          Last decision: <span className="font-medium">{lastDecided.status}</span>
          {lastDecided.decided_at && ` · ${new Date(lastDecided.decided_at).toLocaleString()}`}
        </div>
      )}
    </div>
  );
}
