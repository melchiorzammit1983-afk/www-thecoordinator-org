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
  | { kind: "assign"; trip_ids: string[]; driver_id: string; reason: string }
  | { kind: "dispatch"; trip_ids: string[]; partner_company_id: string; reason: string };

type PlanResponse = { proposals: Proposal[]; metering_mode: string; considered: number };

export function AiAutoCoordinateButton() {
  const enabled = useFeature("ai_auto_coordinate");
  const [open, setOpen] = useState(false);
  const [directive, setDirective] = useState("");
  const [plan, setPlan] = useState<PlanResponse | null>(null);
  const [done, setDone] = useState<Set<number>>(new Set());
  const qc = useQueryClient();
  const runFn = useServerFn(aiAutoCoordinate);
  const applyFn = useServerFn(applyAutoCoordinateProposal);

  const runMut = useMutation({
    mutationFn: () => runFn({ data: { directive: directive.trim() || null } }) as Promise<PlanResponse>,
    onSuccess: (r) => {
      setPlan(r);
      setDone(new Set());
      if (r.proposals.length === 0) {
        toast.info(r.considered > 0 ? "No safe proposal found — try naming the driver or partner." : "No eligible unassigned trips found.");
      }
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
          partner_company_id: proposal.kind === "dispatch" ? proposal.partner_company_id : undefined,
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
  const chips = [
    "Assign today's unassigned trips to BaygorCab",
    "Group similar airport trips",
    "Dispatch unassigned trips to partner",
  ];
  return (
    <>
      <Button size="sm" variant="outline" onClick={() => { setOpen(true); setPlan(null); setDone(new Set()); }}>
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
              <div className="space-y-2 rounded-md border bg-muted/30 p-3">
                <div>
                  <p className="text-sm font-medium">What do you want to do?</p>
                  <p className="text-xs text-muted-foreground">Tell me the target, route, or grouping rule before I plan.</p>
                </div>
                <textarea
                  value={directive}
                  onChange={(e) => setDirective(e.target.value)}
                  rows={3}
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30"
                  placeholder='e.g. "Assign today\'s unassigned trips to BaygorCab"'
                />
                <div className="flex flex-wrap gap-1.5">
                  {chips.map((chip) => (
                    <button
                      key={chip}
                      type="button"
                      onClick={() => setDirective(chip)}
                      className="rounded-full border bg-background px-2.5 py-1 text-[11px] text-muted-foreground hover:bg-muted"
                    >
                      {chip}
                    </button>
                  ))}
                </div>
              </div>
              {runMut.isPending && <p className="text-sm text-muted-foreground">Planning the whole backlog…</p>}
              {!runMut.isPending && plan && plan.proposals.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  {plan.considered > 0
                    ? `Reviewed ${plan.considered} unassigned trip${plan.considered === 1 ? "" : "s"}, but no safe proposal was made. Try naming the exact driver or partner.`
                    : "No eligible unassigned trips found for that instruction."}
                </p>
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
                      {p.kind === "group" ? "Group" : p.kind === "assign" ? "Assign" : "Dispatch"}
                    </Badge>
                    {p.trip_ids.map((id) => (
                      <Badge key={id} variant="outline" className="text-[10px] font-mono">{id.slice(0, 8)}</Badge>
                    ))}
                    {p.kind === "assign" && (
                      <Badge variant="outline" className="text-[10px] font-mono">→ drv {p.driver_id.slice(0, 8)}</Badge>
                    )}
                    {p.kind === "dispatch" && (
                      <Badge variant="outline" className="text-[10px] font-mono">→ partner {p.partner_company_id.slice(0, 8)}</Badge>
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
            <Button variant="secondary" onClick={() => runMut.mutate()} disabled={runMut.isPending}>
              {plan ? "Re-plan" : "Plan"}
            </Button>
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
