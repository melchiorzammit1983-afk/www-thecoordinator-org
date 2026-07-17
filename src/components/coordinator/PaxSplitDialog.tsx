import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { listJobPax, splitPaxToNewJob } from "@/lib/coordinator.functions";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { NewTripsPreviewDialog, type NewTripRow } from "@/components/coordinator/NewTripsPreviewDialog";


type Driver = { id: string; name: string; vehicle: string | null };
type Pax = { id: string; name: string; status: string };

export function PaxSplitDialog({
  open, onOpenChange, jobId, jobLabel, drivers,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  jobId: string | null;
  jobLabel: string;
  drivers: Driver[];
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [driverId, setDriverId] = useState<string>("__none__");

  useEffect(() => { if (open) { setSelected(new Set()); setDriverId("__none__"); } }, [open, jobId]);

  const listFn = useServerFn(listJobPax);
  const { data: pax, refetch } = useQuery({
    queryKey: ["job-pax", jobId],
    queryFn: () => listFn({ data: { job_id: jobId! } }) as Promise<Pax[]>,
    enabled: !!jobId && open,
  });

  const qc = useQueryClient();
  const splitFn = useServerFn(splitPaxToNewJob);
  const mut = useMutation({
    mutationFn: () => splitFn({ data: {
      source_job_id: jobId!,
      pax_ids: Array.from(selected),
      driver_id: driverId === "__none__" ? null : driverId,
    } }),
    onSuccess: () => {
      toast.success("Passengers moved to new trip");
      qc.invalidateQueries({ queryKey: ["jobs"] });
      refetch();
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Passengers</DialogTitle>
          <DialogDescription>{jobLabel}</DialogDescription>
        </DialogHeader>
        <div className="max-h-72 overflow-auto space-y-1.5 rounded-md border p-2">
          {(pax ?? []).length === 0 && <div className="text-xs text-muted-foreground py-4 text-center">No passengers on this trip.</div>}
          {(pax ?? []).map((p) => (
            <label key={p.id} className="flex items-center gap-2 text-sm cursor-pointer rounded p-1 hover:bg-muted/50">
              <Checkbox checked={selected.has(p.id)} onCheckedChange={() => toggle(p.id)} />
              <span className="flex-1">{p.name}</span>
              <span className="text-[10px] uppercase text-muted-foreground">{p.status}</span>
            </label>
          ))}
        </div>
        <div className="space-y-1.5">
          <Label>Move {selected.size || "selected"} to</Label>
          <Select value={driverId} onValueChange={setDriverId}>
            <SelectTrigger><SelectValue placeholder="New unassigned trip" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">New unassigned trip</SelectItem>
              {drivers.map((d) => <SelectItem key={d.id} value={d.id}>{d.name}{d.vehicle ? ` · ${d.vehicle}` : ""}</SelectItem>)}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">Creates a new trip with the selected passengers.</p>
        </div>
        <DialogFooter>
          <Button disabled={mut.isPending || selected.size === 0} onClick={() => mut.mutate()}>
            {mut.isPending ? "Splitting…" : "Split into new trip"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
