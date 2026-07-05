import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Sparkles, Bot } from "lucide-react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { aiAutoCoordinate, applyAutoCoordinateProposal } from "@/lib/coordinator.functions";
import { useFeature } from "@/hooks/use-features";

type Proposal =
  | { kind: "group"; trip_ids: string[]; reason: string }
  | { kind: "assign"; trip_ids: string[]; driver_id: string; reason: string };

type PlanResponse = { proposals: Proposal[]; metering_mode: string; considered: number };

export function AiAutoCoordinateButton() {
  const enabled = useFeature("ai_auto_coordinate");
  const [open, setOpen] = useState(false);
  const [plan, setPlan] = useState<PlanResponse | null>(null);
  const [done, setDone] = useState<Set<number>>(new Set());
  const qc = useQueryClient();
  const runFn = useServerFn(aiAutoCoordinate);
  const applyFn = useServerFn(applyAutoCoordinateProposal);

  const runMut = useMutation({
    mutationFn: () => runFn() as Promise<PlanResponse>,
    onSuccess: (r) => {
      setPlan(r);
      setDone(new Set());
      if (r.proposals.length === 0) toast.info("Nothing to coordinate — you're all caught up.");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const applyMut = useMutation({
    mutationFn: (p: { idx: number; proposal: Proposal }) => {
      const { proposal } = p;
      return applyFn({
        data: {
          kind: proposal.kind,
          trip_ids: proposal.trip_ids,
          driver_id: proposal.kind === "assign" ? proposal.driver_id : undefined,
        },
      }) as Promise<{ ok: boolean }>;
    },
    onSuccess: (_r, v) => {
      setDone((prev) => new Set(prev).add(v.idx));
      qc.invalidateQueries({ queryKey: ["calendar-jobs"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const acceptAll = async () => {
    if (!plan) return;
    for (let i = 0; i < plan.proposals.length; i++) {
      if (done.has(i)) continue;
      try {
        await applyMut.mutateAsync({ idx: i, proposal: plan.proposals[i] });
      } catch {
        break;
      }
    }
    toast.success("Applied all proposals");
  };

  if (!enabled) return null;
  return (
    <>
      <Button size="sm" variant="outline" onClick={() => { setOpen(true); runMut.mutate(); }}>
        <Bot className="h-4 w-4 mr-1.5" /> AI Auto-Coordinate
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="h-4 w-4" /> AI Auto-Coordinate
            </DialogTitle>
          </DialogHeader>
          <>
            <div className="space-y-3 max-h-[60vh] overflow-y-auto">
              {runMut.isPending && <p className="text-sm text-muted-foreground">Planning the whole backlog…</p>}
              {!runMut.isPending && plan && plan.proposals.length === 0 && (
                <p className="text-sm text-muted-foreground">Nothing to coordinate — you're all caught up.</p>
              )}
              {!runMut.isPending && plan && plan.proposals.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  Reviewed {plan.considered} unassigned trip{plan.considered === 1 ? "" : "s"} · metering: {plan.metering_mode.replace("_", " ")}
                </p>
              )}
              {plan?.proposals.map((p, i) => (
                <div key={i} className={`rounded-md border p-3 space-y-2 ${done.has(i) ? "opacity-50" : ""}`}>
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge variant={p.kind === "group" ? "secondary" : "default"} className="uppercase text-[10px]">
                      {p.kind === "group" ? "Group" : "Assign"}
                    </Badge>
                    {p.trip_ids.map((id) => (
                      <Badge key={id} variant="outline" className="text-[10px] font-mono">{id.slice(0, 8)}</Badge>
                    ))}
                    {p.kind === "assign" && (
                      <Badge variant="outline" className="text-[10px] font-mono">→ drv {p.driver_id.slice(0, 8)}</Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">{p.reason}</p>
                  <div className="flex justify-end">
                    <Button
                      size="sm"
                      onClick={() => applyMut.mutate({ idx: i, proposal: p })}
                      disabled={done.has(i) || applyMut.isPending}
                    >
                      {done.has(i) ? "Applied" : "Accept"}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </>
          <DialogFooter className="flex-wrap gap-2">
            <Button variant="outline" onClick={() => setOpen(false)}>Close</Button>
            <Button variant="secondary" onClick={() => runMut.mutate()} disabled={runMut.isPending}>Re-run</Button>
            {plan && plan.proposals.length > 0 && (
              <Button onClick={acceptAll} disabled={applyMut.isPending || done.size === plan.proposals.length}>
                Accept all
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
