import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Link2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { groupJobs } from "@/lib/coordinator.functions";
import type { BulkJob, BulkDriver } from "./BulkActionBar";

const UNASSIGNED = "__unassigned__";
const KEEP = "__keep__";

export function GroupDialog({
  open, onOpenChange, jobs, drivers, onDone,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  jobs: BulkJob[];
  drivers: BulkDriver[];
  onDone: () => void;
}) {
  const qc = useQueryClient();
  const groupFn = useServerFn(groupJobs);

  const [name, setName] = useState("");
  const [note, setNote] = useState("");
  const [driverChoice, setDriverChoice] = useState<string>(KEEP);

  // Auto-order by time (earliest first)
  const ordered = useMemo(
    () => [...jobs].sort((a, b) =>
      ((a.date ?? "") + (a.time ?? "")).localeCompare((b.date ?? "") + (b.time ?? "")),
    ),
    [jobs],
  );

  const currentDrivers = new Set(jobs.map((j) => j.driver_id).filter(Boolean) as string[]);
  const mixedDrivers = currentDrivers.size > 1;

  const mut = useMutation({
    mutationFn: () => {
      const payload: {
        job_ids: string[];
        name?: string;
        note?: string;
        driver_id?: string | null;
      } = {
        job_ids: jobs.map((j) => j.id),
        name: name.trim() || undefined,
        note: note.trim() || undefined,
      };
      if (driverChoice !== KEEP) {
        payload.driver_id = driverChoice === UNASSIGNED ? null : driverChoice;
      }
      return groupFn({ data: payload }) as Promise<{ count: number }>;
    },
    onSuccess: (r) => {
      toast.success(`Grouped ${r.count} trips`);
      qc.invalidateQueries({ queryKey: ["jobs"] });
      onOpenChange(false);
      setName(""); setNote(""); setDriverChoice(KEEP);
      onDone();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Link2 className="h-4 w-4" /> Group {jobs.length} trips
          </DialogTitle>
          <DialogDescription>
            Link these trips as a single stack. Each keeps its own details — you can ungroup any time.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="grp-name">Group name (optional)</Label>
            <Input
              id="grp-name"
              placeholder="e.g. Morning airport run"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={80}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="grp-note">Note for driver (optional)</Label>
            <Textarea
              id="grp-note"
              placeholder="Extra info the driver should see on the stack"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={500}
              rows={2}
            />
          </div>

          <div className="space-y-1.5">
            <Label>Assign driver</Label>
            <Select value={driverChoice} onValueChange={setDriverChoice}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={KEEP}>Keep current driver{mixedDrivers ? "s (mixed)" : ""}</SelectItem>
                <SelectItem value={UNASSIGNED}>— Unassigned —</SelectItem>
                {drivers.map((d) => (
                  <SelectItem key={d.id} value={d.id}>
                    {d.name}{d.vehicle ? ` · ${d.vehicle}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {mixedDrivers && driverChoice === KEEP && (
              <p className="text-[11px] text-amber-600">
                Trips have different drivers today. Choose one to unify, or keep as-is.
              </p>
            )}
          </div>

          <div className="rounded-md border bg-muted/30 p-2">
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium mb-1">
              Order (auto by time)
            </div>
            <ol className="text-xs space-y-0.5 list-decimal list-inside">
              {ordered.map((j) => (
                <li key={j.id} className="truncate">
                  <span className="font-medium">{j.time?.slice(0, 5)}</span>{" "}
                  · {j.from_location} → {j.to_location}
                </li>
              ))}
            </ol>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => mut.mutate()} disabled={mut.isPending}>
            {mut.isPending ? "Grouping…" : "Group trips"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
