import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Send } from "lucide-react";
import { listIncomingDispatches, respondToDispatch, listOutboundDispatches } from "@/lib/collab.functions";

export const Route = createFileRoute("/_authenticated/coordinator/incoming")({
  component: IncomingPage,
});

function IncomingPage() {
  const qc = useQueryClient();
  const listIn = useServerFn(listIncomingDispatches);
  const listOut = useServerFn(listOutboundDispatches);
  const respond = useServerFn(respondToDispatch);

  const incoming = useQuery({ queryKey: ["collab", "incoming"], queryFn: () => listIn() });
  const outbound = useQuery({ queryKey: ["collab", "outbound"], queryFn: () => listOut() });

  const respondMut = useMutation({
    mutationFn: async (v: { job_id: string; decision: "accepted" | "rejected" }) => await respond({ data: v }),
    onSuccess: () => { toast.success("Done"); qc.invalidateQueries({ queryKey: ["collab"] }); qc.invalidateQueries({ queryKey: ["jobs"] }); },
    onError: (e: any) => toast.error(e.message),
  });

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
        <CardHeader><CardTitle className="text-base">Outbound — jobs you dispatched</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {(outbound.data ?? []).length === 0 && <p className="text-sm text-muted-foreground">Nothing dispatched yet.</p>}
          {(outbound.data ?? []).map((j: any) => (
            <div key={j.id} className="border rounded-md p-3">
              <div className="flex items-center gap-2 flex-wrap">
                <Badge variant="outline">to {j.executor?.name ?? "partner"}</Badge>
                <span className="font-medium">{j.date} {j.time?.slice(0, 5)}</span>
                <span className="text-sm">{j.from_location} → {j.to_location}</span>
                <Badge variant={j.dispatch_status === "accepted" ? "default" : j.dispatch_status === "rejected" ? "destructive" : "secondary"}>{j.dispatch_status}</Badge>
                {j.drivers?.name && <Badge variant="secondary">driver: {j.drivers.name}</Badge>}
                <span className="text-xs text-muted-foreground ml-auto">status: {j.status}</span>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
