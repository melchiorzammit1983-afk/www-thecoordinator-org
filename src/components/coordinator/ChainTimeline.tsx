import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Badge } from "@/components/ui/badge";
import { ArrowRight, Clock, User, Radio } from "lucide-react";
import { listJobChain } from "@/lib/collab.functions";
import { supabase } from "@/integrations/supabase/client";

const TRIP_STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  completed: "default",
  in_progress: "default",
  arrived: "default",
  en_route: "secondary",
  assigned: "secondary",
  pending: "outline",
  cancelled: "destructive",
};

export function ChainTimeline({ jobId }: { jobId: string }) {
  const qc = useQueryClient();
  const fetchChain = useServerFn(listJobChain);
  const q = useQuery({
    queryKey: ["collab", "chain", jobId],
    queryFn: () => fetchChain({ data: { job_id: jobId } }),
    refetchInterval: 20_000,
  });

  // Live refresh: any change to this job / its hops / driver updates re-runs the query.
  useEffect(() => {
    const ch = supabase
      .channel(`chain-${jobId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "jobs", filter: `id=eq.${jobId}` }, () => {
        qc.invalidateQueries({ queryKey: ["collab", "chain", jobId] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "job_dispatch_hops", filter: `job_id=eq.${jobId}` }, () => {
        qc.invalidateQueries({ queryKey: ["collab", "chain", jobId] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "driver_status_updates" }, () => {
        qc.invalidateQueries({ queryKey: ["collab", "chain", jobId] });
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [jobId, qc]);

  const hops: any[] = (q.data as any)?.hops ?? [];
  const job: any = (q.data as any)?.job;

  if (q.isLoading) return <div className="text-xs text-muted-foreground">Loading chain…</div>;
  if (hops.length === 0 && !job) return <div className="text-xs text-muted-foreground">No dispatch history.</div>;

  const currentExecutorId = job?.executor_company_id;
  const tripStatus = job?.status ?? "pending";

  return (
    <div className="space-y-3">
      {/* Breadcrumb: origin → hop.to → ... */}
      <div className="flex flex-wrap items-center gap-1">
        {job?.origin?.name && <Badge variant="outline">{job.origin.name}</Badge>}
        {hops.map((h) => (
          <div key={h.id} className="flex items-center gap-1">
            <ArrowRight className="h-3 w-3 text-muted-foreground" />
            <Badge
              variant={
                h.to_company_id === currentExecutorId && h.status === "accepted"
                  ? "default"
                  : h.status === "rejected"
                  ? "destructive"
                  : h.status === "accepted"
                  ? "secondary"
                  : "outline"
              }
            >
              {h.to_company?.name ?? "partner"} · {h.status}
            </Badge>
          </div>
        ))}
      </div>

      {/* Per-hop details */}
      <ol className="relative border-l pl-4 space-y-2">
        {hops.map((h) => {
          const isCurrent = h.to_company_id === currentExecutorId;
          return (
            <li key={h.id} className="relative">
              <span className={`absolute -left-[21px] top-1 h-3 w-3 rounded-full ring-2 ring-background ${
                h.status === "accepted" ? "bg-green-500" :
                h.status === "rejected" ? "bg-destructive" :
                "bg-muted-foreground"
              }`} />
              <div className="flex items-center gap-2 flex-wrap text-xs">
                <span className="font-medium">#{h.hop_index + 1}</span>
                <span>{h.from_company?.name ?? "creator"} → {h.to_company?.name}</span>
                <Badge variant={h.status === "accepted" ? "default" : h.status === "rejected" ? "destructive" : "outline"}>
                  {h.status}
                </Badge>
                {isCurrent && (
                  <Badge variant="secondary" className="gap-1">
                    <Radio className="h-3 w-3" /> current
                  </Badge>
                )}
              </div>
              <div className="text-[11px] text-muted-foreground flex items-center gap-1 mt-0.5">
                <Clock className="h-3 w-3" />
                {h.decided_at
                  ? `decided ${new Date(h.decided_at).toLocaleString()}`
                  : h.dispatched_at
                  ? `sent ${new Date(h.dispatched_at).toLocaleString()}`
                  : "—"}
              </div>
              {h.note && <div className="text-[11px] italic text-muted-foreground">"{h.note}"</div>}
              {isCurrent && (
                <div className="mt-1 flex items-center gap-2 text-xs">
                  <User className="h-3 w-3 text-muted-foreground" />
                  <span>
                    Driver:{" "}
                    <span className="font-medium">{job?.drivers?.name ?? "not assigned yet"}</span>
                  </span>
                  <Badge variant={TRIP_STATUS_VARIANT[tripStatus] ?? "outline"}>
                    {tripStatus.replace(/_/g, " ")}
                  </Badge>
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
