import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Euro } from "lucide-react";
import {
  proposeDriverPrice, driverRespondToPrice, listMyDriverPriceThread,
} from "@/lib/coordinator-public.functions";

type Proposal = {
  id: string;
  from_party_kind: "driver" | "company";
  from_driver_id: string | null;
  from_company_id: string | null;
  to_driver_id: string | null;
  to_company_id: string | null;
  amount_eur: number | string;
  status: "proposed" | "accepted" | "countered" | "recalled" | "superseded";
  parent_id: string | null;
  note: string | null;
  created_at: string;
};

const eur = (v: number | string) =>
  new Intl.NumberFormat("en-IE", { style: "currency", currency: "EUR" }).format(Number(v));

export function DriverPricePanel({ token, jobId, accepted }: { token: string; jobId: string; accepted: boolean }) {
  const qc = useQueryClient();
  const listFn = useServerFn(listMyDriverPriceThread);
  const proposeFn = useServerFn(proposeDriverPrice);
  const respondFn = useServerFn(driverRespondToPrice);

  const [open, setOpen] = useState(false);
  const [amt, setAmt] = useState("");
  const [note, setNote] = useState("");

  const { data: rows = [] } = useQuery({
    queryKey: ["driver-price-thread", token, jobId],
    queryFn: () => listFn({ data: { token, job_id: jobId } }) as Promise<Proposal[]>,
    refetchInterval: 15_000,
  });

  const proposeMut = useMutation({
    mutationFn: () => proposeFn({ data: { token, job_id: jobId, amount_eur: Number(amt.replace(",", ".")), note: note || undefined } }),
    onSuccess: () => {
      toast.success("Price sent to coordinator");
      setOpen(false); setAmt(""); setNote("");
      qc.invalidateQueries({ queryKey: ["driver-price-thread", token, jobId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const respondMut = useMutation({
    mutationFn: (v: { proposal_id: string; action: "accept" | "withdraw" }) => respondFn({ data: { token, ...v } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["driver-price-thread", token, jobId] }),
    onError: (e: Error) => toast.error(e.message),
  });

  const openRows = rows.filter((r) => r.status === "proposed" || r.status === "countered");
  const acceptedRow = rows.find((r) => r.status === "accepted");
  const latest = openRows[openRows.length - 1] ?? null;

  // If accepted trip and no open thread, hide the propose button entirely.
  if (accepted && !latest && !acceptedRow) return null;

  return (
    <div className="px-3 pt-3">
      {acceptedRow && (
        <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm flex items-center gap-2">
          <Euro className="h-4 w-4 text-emerald-600" />
          <span className="font-semibold">{eur(acceptedRow.amount_eur)}</span>
          <span className="text-xs text-muted-foreground">agreed with coordinator</span>
        </div>
      )}
      {latest && latest.from_party_kind === "driver" && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm">
          <div className="flex items-center gap-2">
            <Euro className="h-4 w-4 text-amber-700" />
            <span>You proposed <b>{eur(latest.amount_eur)}</b></span>
            <span className="text-xs text-muted-foreground ml-auto animate-pulse">waiting for reply</span>
          </div>
          <div className="mt-2 flex gap-2">
            <Button size="sm" variant="ghost" className="h-8"
              disabled={respondMut.isPending}
              onClick={() => respondMut.mutate({ proposal_id: latest.id, action: "withdraw" })}>
              Withdraw
            </Button>
          </div>
        </div>
      )}
      {latest && latest.from_party_kind === "company" && (
        <div className="rounded-lg border border-primary/40 bg-primary/10 px-3 py-2 text-sm">
          <div className="flex items-center gap-2">
            <Euro className="h-4 w-4 text-primary" />
            <span>Coordinator counter-offer: <b>{eur(latest.amount_eur)}</b></span>
          </div>
          {latest.note && <div className="text-xs text-muted-foreground mt-1">"{latest.note}"</div>}
          <div className="mt-2 flex gap-2">
            <Button size="sm" className="h-8" disabled={respondMut.isPending}
              onClick={() => respondMut.mutate({ proposal_id: latest.id, action: "accept" })}>
              Accept €
            </Button>
            <Button size="sm" variant="ghost" className="h-8" disabled={respondMut.isPending}
              onClick={() => setOpen(true)}>
              Counter with new price
            </Button>
          </div>
        </div>
      )}
      {!latest && !acceptedRow && !accepted && (
        <Button variant="outline" className="w-full h-10 border-dashed"
          onClick={() => setOpen(true)}>
          <Euro className="h-4 w-4 mr-1.5" /> Propose price (optional)
        </Button>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Propose a price</DialogTitle>
            <DialogDescription>
              Send a price to the coordinator who assigned this trip. They can accept, counter, or recall.
              Only the two of you see this number.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">€</span>
              <Input type="number" inputMode="decimal" min={0} step="0.01" placeholder="0.00"
                value={amt} onChange={(e) => setAmt(e.target.value)} />
            </div>
            <Input placeholder="Optional note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button disabled={proposeMut.isPending || !amt || Number(amt) <= 0}
              onClick={() => proposeMut.mutate()}>
              {proposeMut.isPending ? "Sending…" : "Send price"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
