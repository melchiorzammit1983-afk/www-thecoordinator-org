import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Badge } from "@/components/ui/badge";
import { ArrowRight, Clock } from "lucide-react";
import { listJobChain } from "@/lib/collab.functions";

export function ChainTimeline({ jobId }: { jobId: string }) {
  const fetchChain = useServerFn(listJobChain);
  const q = useQuery({
    queryKey: ["collab", "chain", jobId],
    queryFn: () => fetchChain({ data: { job_id: jobId } }),
    refetchInterval: 15_000,
  });
  const hops: any[] = (q.data as any)?.hops ?? [];
  const job: any = (q.data as any)?.job;

  if (q.isLoading) return <div className="text-xs text-muted-foreground">Loading chain…</div>;
  if (hops.length === 0) return <div className="text-xs text-muted-foreground">No dispatch history.</div>;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1">
        {hops.map((h, i) => (
          <div key={h.id} className="flex items-center gap-1">
            {i === 0 && h.to_company?.name && (
              <Badge variant="outline">{h.to_company.name}</Badge>
            )}
            {i > 0 && (
              <>
                <ArrowRight className="h-3 w-3 text-muted-foreground" />
                <Badge
                  variant={
                    h.status === "accepted" ? "default" : h.status === "rejected" ? "destructive" : "secondary"
                  }
                >
                  {h.to_company?.name ?? "partner"} · {h.status}
                </Badge>
              </>
            )}
          </div>
        ))}
      </div>
      <div className="space-y-1">
        {hops.map((h) => (
          <div key={h.id} className="flex items-center gap-2 text-xs text-muted-foreground">
            <Clock className="h-3 w-3" />
            <span>
              #{h.hop_index} {h.from_company?.name ?? "creator"} → {h.to_company?.name}
              {" · "}
              {h.status}
              {h.decided_at ? ` · ${new Date(h.decided_at).toLocaleString()}` : h.dispatched_at ? ` · sent ${new Date(h.dispatched_at).toLocaleString()}` : ""}
            </span>
            {h.note && <span className="italic">"{h.note}"</span>}
          </div>
        ))}
      </div>
      {job?.drivers?.name && (
        <div className="text-xs">
          Current driver: <span className="font-medium">{job.drivers.name}</span> · status {job.status}
        </div>
      )}
    </div>
  );
}
