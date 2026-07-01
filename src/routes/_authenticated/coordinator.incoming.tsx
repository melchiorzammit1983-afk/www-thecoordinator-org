import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Send, ChevronDown, ChevronRight } from "lucide-react";
import { listIncomingDispatches, respondToDispatch, listOutboundDispatches } from "@/lib/collab.functions";
import { supabase } from "@/integrations/supabase/client";
import { ChainTimeline } from "@/components/coordinator/ChainTimeline";

export const Route = createFileRoute("/_authenticated/coordinator/incoming")({
  component: IncomingPage,
});

function IncomingPage() {
  const qc = useQueryClient();
  const listIn = useServerFn(listIncomingDispatches);
  const listOut = useServerFn(listOutboundDispatches);
  const respond = useServerFn(respondToDispatch);

  const incoming = useQuery({ queryKey: ["collab", "incoming"], queryFn: () => listIn(), refetchInterval: 15_000 });
  const outbound = useQuery({ queryKey: ["collab", "outbound"], queryFn: () => listOut(), refetchInterval: 15_000 });

  // Realtime: any job/hop/driver-status change refreshes the boards
  useEffect(() => {
    const ch = supabase
      .channel("collab-chain")
      .on("postgres_changes", { event: "*", schema: "public", table: "jobs" }, () => {
        qc.invalidateQueries({ queryKey: ["collab"] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "job_dispatch_hops" }, () => {
        qc.invalidateQueries({ queryKey: ["collab"] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "driver_status_updates" }, () => {
        qc.invalidateQueries({ queryKey: ["collab"] });
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [qc]);

  const respondMut = useMutation({
    mutationFn: async (v: { job_id: string; decision: "accepted" | "rejected" }) => await respond({ data: v }),
    onSuccess: () => { toast.success("Done"); qc.invalidateQueries({ queryKey: ["collab"] }); qc.invalidateQueries({ queryKey: ["jobs"] }); },
    onError: (e: any) => toast.error(e.message),
  });

  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  return (
    <div className="p-4 md:p-6 space-y-6">
      <h1 className="text-2xl font-semibold flex items-center gap-2"><Send className="h-5 w-5" /> Partner jobs</h1>

      <Card>
        <CardHeader><CardTitle className="text-base">Incoming — pending your decision</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {(incoming.data ?? []).length === 0 && <p className="text-sm text-muted-foreground">Nothing pending.</p>}
          {(incoming.data ?? []).map((j: any) => (
            <div key={j.id} className="border rounded-md p-3 space-y-1">
              <div className="flex items-center gap-2 flex-wrap">
                <Badge variant="outline">from {j.origin?.name ?? "partner"}</Badge>
                <span className="font-medium">{j.date} {j.time?.slice(0, 5)}</span>
                <span className="text-sm">{j.from_location} → {j.to_location}</span>
                {j.vehicle && <span className="text-xs text-muted-foreground">{j.vehicle}</span>}
                <span className="text-xs text-muted-foreground ml-auto">{(j.pax ?? []).length} pax</span>
              </div>
              {j.dispatch_note && <div className="text-xs text-muted-foreground">Note: {j.dispatch_note}</div>}
              <div className="flex gap-2 pt-2">
                <Button size="sm" onClick={() => respondMut.mutate({ job_id: j.id, decision: "accepted" })}>Accept</Button>
                <Button size="sm" variant="outline" onClick={() => respondMut.mutate({ job_id: j.id, decision: "rejected" })}>Reject</Button>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Outbound — trips in your chain (live status)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {(outbound.data ?? []).length === 0 && <p className="text-sm text-muted-foreground">Nothing dispatched yet.</p>}
          {(outbound.data ?? []).map((j: any) => {
            const depth = (j.dispatch_chain_company_ids ?? []).length;
            const open = expanded[j.id];
            return (
              <div key={j.id} className="border rounded-md p-3 space-y-2">
                <button
                  type="button"
                  onClick={() => setExpanded((s) => ({ ...s, [j.id]: !s[j.id] }))}
                  className="flex items-center gap-2 flex-wrap w-full text-left"
                >
                  {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                  <Badge variant="outline">now at {j.executor?.name ?? "partner"}</Badge>
                  <span className="font-medium">{j.date} {j.time?.slice(0, 5)}</span>
                  <span className="text-sm">{j.from_location} → {j.to_location}</span>
                  <Badge variant={j.dispatch_status === "accepted" ? "default" : j.dispatch_status === "rejected" ? "destructive" : "secondary"}>{j.dispatch_status}</Badge>
                  {j.drivers?.name && <Badge variant="secondary">driver: {j.drivers.name}</Badge>}
                  {depth > 2 && <Badge variant="outline">chain · {depth - 1} hops</Badge>}
                  <span className="text-xs text-muted-foreground ml-auto">trip: {j.status}</span>
                </button>
                {open && (
                  <div className="pl-6">
                    <ChainTimeline jobId={j.id} />
                  </div>
                )}
              </div>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}
