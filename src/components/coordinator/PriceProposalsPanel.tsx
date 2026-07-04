import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Euro, ArrowRight, Lock } from "lucide-react";
import {
  listPriceProposals, respondToPriceProposal, proposePartnerPrice,
} from "@/lib/collab.functions";

type Proposal = {
  id: string;
  from_party_kind: "driver" | "company";
  from_company_id: string | null;
  from_driver_id: string | null;
  to_company_id: string | null;
  to_driver_id: string | null;
  amount_eur: number | string;
  status: "proposed" | "accepted" | "countered" | "recalled" | "superseded";
  parent_id: string | null;
  note: string | null;
  created_at: string;
  i_am_from: boolean;
  i_am_to: boolean;
  from_label: string;
  to_label: string;
};

const eur = (v: number | string) =>
  new Intl.NumberFormat("en-IE", { style: "currency", currency: "EUR" }).format(Number(v));

export function PriceProposalsPanel({ jobId }: { jobId: string }) {
  const qc = useQueryClient();
  const listFn = useServerFn(listPriceProposals);
  const respondFn = useServerFn(respondToPriceProposal);
  const proposeFn = useServerFn(proposePartnerPrice);

  const { data: rows = [] } = useQuery({
    queryKey: ["price-proposals", jobId],
    queryFn: () => listFn({ data: { job_id: jobId } }) as Promise<Proposal[]>,
    refetchInterval: 10_000,
  });

  const [counterFor, setCounterFor] = useState<Proposal | null>(null);
  const [counterAmt, setCounterAmt] = useState("");
  const [recallFor, setRecallFor] = useState<Proposal | null>(null);
  const [proposeOpen, setProposeOpen] = useState(false);
  const [newAmt, setNewAmt] = useState("");
  const [newNote, setNewNote] = useState("");

  const respondMut = useMutation({
    mutationFn: (v: { proposal_id: string; action: "accept" | "counter" | "reject_price" | "recall_assignment" | "withdraw"; counter_amount_eur?: number }) =>
      respondFn({ data: v }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["price-proposals", jobId] });
      qc.invalidateQueries({ queryKey: ["jobs"] });
      qc.invalidateQueries({ queryKey: ["coord-summary"] });
      setCounterFor(null); setCounterAmt(""); setRecallFor(null);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const proposeMut = useMutation({
    mutationFn: () => proposeFn({ data: { job_id: jobId, amount_eur: Number(newAmt.replace(",", ".")), note: newNote || undefined } }),
    onSuccess: () => {
      toast.success("Price sent");
      setProposeOpen(false); setNewAmt(""); setNewNote("");
      qc.invalidateQueries({ queryKey: ["price-proposals", jobId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const hasAny = rows.length > 0;

  return (
    <section className="rounded-md border p-3 space-y-2 bg-slate-50/40 dark:bg-slate-950/10 border-slate-500/30">
      <div className="flex items-center justify-between gap-2">
        <div className="inline-flex items-center gap-1.5 text-[11px] uppercase tracking-wide font-semibold text-slate-700 dark:text-slate-300">
          <Lock className="h-3 w-3" /> Price proposals · private
        </div>
        <Button size="sm" variant="ghost" className="h-7 px-2 text-xs"
          onClick={() => setProposeOpen(true)}>
          <Euro className="h-3.5 w-3.5 mr-1" /> Propose to sender
        </Button>
      </div>

      {!hasAny && (
        <div className="text-xs text-muted-foreground">No proposals on this trip yet.</div>
      )}

      {hasAny && (
        <ul className="space-y-2">
          {rows.map((r) => {
            const isOpen = r.status === "proposed" || r.status === "countered";
            const canAct = isOpen && r.i_am_to;
            return (
              <li key={r.id} className={`rounded-md border p-2 text-xs ${r.status === "accepted" ? "border-emerald-500/40 bg-emerald-500/10" : isOpen ? "border-amber-500/40 bg-amber-500/10 animate-pulse-slow" : "opacity-70"}`}>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium">{r.from_label}</span>
                  <ArrowRight className="h-3 w-3 text-muted-foreground" />
                  <span className="font-medium">{r.to_label}</span>
                  <span className="ml-auto font-mono font-semibold">{eur(r.amount_eur)}</span>
                  <StatusBadge status={r.status} />
                </div>
                {r.note && <div className="mt-1 italic text-muted-foreground">"{r.note}"</div>}
                {canAct && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Button size="sm" className="h-8" disabled={respondMut.isPending}
                      onClick={() => respondMut.mutate({ proposal_id: r.id, action: "accept" })}>
                      Accept
                    </Button>
                    <Button size="sm" variant="outline" className="h-8" disabled={respondMut.isPending}
                      onClick={() => { setCounterFor(r); setCounterAmt(String(r.amount_eur)); }}>
                      Counter
                    </Button>
                    <Button size="sm" variant="ghost" className="h-8 text-destructive"
                      onClick={() => setRecallFor(r)}>
                      Recall
                    </Button>
                  </div>
                )}
                {isOpen && r.i_am_from && (
                  <div className="mt-2">
                    <Button size="sm" variant="ghost" className="h-8"
                      onClick={() => respondMut.mutate({ proposal_id: r.id, action: "withdraw" })}>
                      Withdraw
                    </Button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {/* Counter dialog */}
      <Dialog open={!!counterFor} onOpenChange={(v) => { if (!v) { setCounterFor(null); setCounterAmt(""); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Counter offer</DialogTitle>
            <DialogDescription>
              {counterFor && <>Sending back to <b>{counterFor.from_label}</b>. Only they will see it.</>}
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center gap-2">
            <span className="text-sm">€</span>
            <Input type="number" min={0} step="0.01" value={counterAmt}
              onChange={(e) => setCounterAmt(e.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setCounterFor(null)}>Cancel</Button>
            <Button disabled={respondMut.isPending || !counterAmt || Number(counterAmt) <= 0}
              onClick={() => counterFor && respondMut.mutate({
                proposal_id: counterFor.id, action: "counter",
                counter_amount_eur: Number(counterAmt.replace(",", ".")),
              })}>
              Send counter
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Recall confirm */}
      <AlertDialog open={!!recallFor} onOpenChange={(v) => !v && setRecallFor(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Recall this proposal</AlertDialogTitle>
            <AlertDialogDescription>
              Reject the price only, or also take the trip back from {recallFor?.from_label}?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-col sm:flex-row gap-2">
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <Button variant="outline"
              onClick={() => recallFor && respondMut.mutate({ proposal_id: recallFor.id, action: "reject_price" })}>
              Reject price only
            </Button>
            <AlertDialogAction
              onClick={() => recallFor && respondMut.mutate({ proposal_id: recallFor.id, action: "recall_assignment" })}>
              Recall assignment
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Propose (partner → sender) */}
      <Dialog open={proposeOpen} onOpenChange={setProposeOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Propose a price</DialogTitle>
            <DialogDescription>
              Sends a price to the coordinator who forwarded you this trip. Only the two of you see it.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="text-sm">€</span>
              <Input type="number" min={0} step="0.01" placeholder="0.00"
                value={newAmt} onChange={(e) => setNewAmt(e.target.value)} />
            </div>
            <Input placeholder="Optional note" value={newNote} onChange={(e) => setNewNote(e.target.value)} maxLength={200} />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setProposeOpen(false)}>Cancel</Button>
            <Button disabled={proposeMut.isPending || !newAmt || Number(newAmt) <= 0}
              onClick={() => proposeMut.mutate()}>
              {proposeMut.isPending ? "Sending…" : "Send"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

function StatusBadge({ status }: { status: Proposal["status"] }) {
  const map: Record<Proposal["status"], { label: string; cls: string }> = {
    proposed: { label: "Waiting", cls: "bg-amber-500/20 text-amber-800 dark:text-amber-300 border-amber-500/40" },
    countered: { label: "Countered", cls: "bg-slate-500/20 text-slate-700 dark:text-slate-300 border-slate-500/40" },
    accepted: { label: "Accepted", cls: "bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 border-emerald-500/40" },
    recalled: { label: "Recalled", cls: "bg-muted text-muted-foreground border-border" },
    superseded: { label: "Replaced", cls: "bg-muted text-muted-foreground border-border" },
  };
  const m = map[status];
  return <Badge variant="outline" className={`text-[9px] ${m.cls}`}>{m.label}</Badge>;
}
