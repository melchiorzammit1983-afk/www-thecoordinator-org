import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { Users, Tag, Trash2, Combine, Link2, X, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import {
  assignDriver, deleteJob, setJobLabels, movePaxToJob, listLabels, setJobGrouped,
} from "@/lib/coordinator.functions";
import { GroupDialog } from "./GroupDialog";

export type BulkJob = {
  id: string;
  date: string;
  time: string;
  from_location: string;
  to_location: string;
  driver_id: string | null;
  driver_accepted_at: string | null;
  labels?: { id: string; name: string; color: string }[];
  pax?: { id: string }[];
};

export type BulkDriver = { id: string; name: string; vehicle: string | null };

export function BulkActionBar({
  jobs, drivers, onClear,
}: {
  jobs: BulkJob[];
  drivers: BulkDriver[];
  onClear: () => void;
}) {
  const qc = useQueryClient();
  const [openLabels, setOpenLabels] = useState(false);
  const [openMerge, setOpenMerge] = useState(false);
  const [openGroup, setOpenGroup] = useState(false);

  const assignFn = useServerFn(assignDriver);
  const deleteFn = useServerFn(deleteJob);

  const assignMut = useMutation({
    mutationFn: async (driver_id: string | null) => {
      for (const j of jobs) await assignFn({ data: { job_id: j.id, driver_id } });
    },
    onSuccess: () => {
      toast.success(`${jobs.length} trips updated`);
      qc.invalidateQueries({ queryKey: ["jobs"] });
      onClear();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteMut = useMutation({
    mutationFn: async () => {
      let done = 0, pending = 0;
      for (const j of jobs) {
        const r = (await deleteFn({ data: { job_id: j.id } })) as { deleted?: boolean; pending?: boolean };
        if (r?.pending) pending++; else done++;
      }
      return { done, pending };
    },
    onSuccess: (r) => {
      toast.success(`${r.done} deleted${r.pending ? ` · ${r.pending} awaiting driver` : ""}`);
      qc.invalidateQueries({ queryKey: ["jobs"] });
      onClear();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Allow grouping with 2+ selections; warn in dialog if date/from/to differ.
  const mergeable = jobs.length >= 2;
  const norm = (s: string) => (s ?? "").trim().toLowerCase();
  const uniform =
    jobs.length >= 2 &&
    jobs.every((j) =>
      j.date === jobs[0].date &&
      norm(j.from_location) === norm(jobs[0].from_location) &&
      norm(j.to_location) === norm(jobs[0].to_location)
    );

  const count = jobs.length;
  const busy = assignMut.isPending || deleteMut.isPending;

  return (
    <>
      <div
        role="region" aria-label="Bulk actions"
        className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 shadow-lg"
      >
        <div className="mx-auto max-w-6xl px-3 sm:px-4 py-2 flex items-center gap-2 flex-wrap">
          <div className="text-sm font-medium mr-1">{count} selected</div>
          <Button size="sm" variant="ghost" onClick={onClear} className="h-8 px-2">
            <X className="h-4 w-4 mr-1" /> Clear
          </Button>

          <div className="ml-auto flex flex-wrap items-center gap-2">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant="outline" disabled={busy}>
                  <Users className="h-4 w-4 mr-1" /> Assign driver
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="max-h-72 w-56 overflow-y-auto">
                <DropdownMenuLabel>Assign to…</DropdownMenuLabel>
                <DropdownMenuItem onClick={() => assignMut.mutate(null)}>— Unassign —</DropdownMenuItem>
                <DropdownMenuSeparator />
                {drivers.length === 0 && (
                  <div className="px-2 py-1.5 text-xs text-muted-foreground">No drivers</div>
                )}
                {drivers.map((d) => (
                  <DropdownMenuItem key={d.id} onClick={() => assignMut.mutate(d.id)}>
                    {d.name}{d.vehicle ? ` · ${d.vehicle}` : ""}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            <Button size="sm" variant="outline" onClick={() => setOpenLabels(true)} disabled={busy}>
              <Tag className="h-4 w-4 mr-1" /> Add label
            </Button>

            <Button
              size="sm" variant="outline"
              disabled={!mergeable || busy || groupMut.isPending}
              title="Link cards together as one bundle (reversible). Trip details are kept."
              onClick={() => groupMut.mutate()}
            >
              <Link2 className="h-4 w-4 mr-1" /> Group
            </Button>

            <Button
              size="sm" variant="outline"
              disabled={!mergeable || busy}
              title={uniform ? "Merge passengers into the earliest trip (permanent)" : "Trips differ in date/from/to — merge folds them into the earliest one"}
              onClick={() => setOpenMerge(true)}
            >
              <Combine className="h-4 w-4 mr-1" /> Merge
            </Button>

            <Button
              size="sm" variant="destructive"
              onClick={() => {
                if (confirm(`Delete ${count} trip${count > 1 ? "s" : ""}? Trips already accepted by a driver will need driver approval.`)) {
                  deleteMut.mutate();
                }
              }}
              disabled={busy}
            >
              {busy ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Trash2 className="h-4 w-4 mr-1" />}
              Delete
            </Button>
          </div>
        </div>
      </div>

      <BulkLabelsDialog open={openLabels} onOpenChange={setOpenLabels} jobs={jobs} onDone={onClear} />
      <BulkMergeDialog open={openMerge} onOpenChange={setOpenMerge} jobs={jobs} onDone={onClear} />
    </>
  );
}

/* ---------- add labels ---------- */

function BulkLabelsDialog({
  open, onOpenChange, jobs, onDone,
}: { open: boolean; onOpenChange: (v: boolean) => void; jobs: BulkJob[]; onDone: () => void }) {
  const qc = useQueryClient();
  const listLabelsFn = useServerFn(listLabels);
  const setLabelsFn = useServerFn(setJobLabels);
  const q = useQuery({
    queryKey: ["trip-labels"],
    queryFn: () => listLabelsFn() as Promise<{ id: string; name: string; color: string }[]>,
    enabled: open,
  });
  const [checked, setChecked] = useState<Record<string, boolean>>({});

  const mut = useMutation({
    mutationFn: async () => {
      const add = Object.entries(checked).filter(([, v]) => v).map(([k]) => k);
      if (add.length === 0) return;
      for (const j of jobs) {
        const existing = new Set((j.labels ?? []).map((l) => l.id));
        add.forEach((id) => existing.add(id));
        await setLabelsFn({ data: { job_id: j.id, label_ids: Array.from(existing) } });
      }
    },
    onSuccess: () => {
      toast.success(`Labels applied to ${jobs.length} trips`);
      qc.invalidateQueries({ queryKey: ["jobs"] });
      onOpenChange(false);
      setChecked({});
      onDone();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add labels to {jobs.length} trips</DialogTitle>
          <DialogDescription>Selected labels are added to each trip. Existing labels are kept.</DialogDescription>
        </DialogHeader>
        <div className="space-y-2 max-h-72 overflow-y-auto">
          {q.isLoading && <div className="text-sm text-muted-foreground">Loading…</div>}
          {q.data?.length === 0 && <div className="text-sm text-muted-foreground">No labels yet. Create some in Trip labels.</div>}
          {(q.data ?? []).map((l) => (
            <label key={l.id} className="flex items-center gap-2 rounded border px-2 py-1.5 cursor-pointer">
              <Checkbox
                checked={!!checked[l.id]}
                onCheckedChange={(v) => setChecked((s) => ({ ...s, [l.id]: !!v }))}
              />
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: l.color }} />
              <span className="text-sm">{l.name}</span>
            </label>
          ))}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => mut.mutate()} disabled={mut.isPending}>
            {mut.isPending ? "Applying…" : "Apply"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ---------- group / merge ---------- */

function BulkMergeDialog({
  open, onOpenChange, jobs, onDone,
}: { open: boolean; onOpenChange: (v: boolean) => void; jobs: BulkJob[]; onDone: () => void }) {
  const qc = useQueryClient();
  const moveFn = useServerFn(movePaxToJob);
  const deleteFn = useServerFn(deleteJob);
  const groupFn = useServerFn(setJobGrouped);

  // earliest by date+time is the keeper
  const sorted = [...jobs].sort((a, b) => ((a.date ?? "") + (a.time ?? "")).localeCompare((b.date ?? "") + (b.time ?? "")));
  const keeper = sorted[0];
  const others = sorted.slice(1);

  const norm = (s: string) => (s ?? "").trim().toLowerCase();
  const uniform =
    !!keeper &&
    jobs.every((j) =>
      j.date === keeper.date &&
      norm(j.from_location) === norm(keeper.from_location) &&
      norm(j.to_location) === norm(keeper.to_location)
    );

  const mut = useMutation({
    mutationFn: async () => {
      if (!keeper) return { deleted: 0, pending: 0 };
      let deleted = 0, pending = 0;
      for (const j of others) {
        const paxIds = (j.pax ?? []).map((p) => p.id);
        if (paxIds.length > 0) {
          await moveFn({ data: { source_job_id: j.id, target_job_id: keeper.id, pax_ids: paxIds } });
        }
        const r = (await deleteFn({ data: { job_id: j.id } })) as { deleted?: boolean; pending?: boolean };
        if (r?.pending) pending++; else deleted++;
      }
      try { await groupFn({ data: { job_id: keeper.id, count: others.length + 1 } }); } catch { /* non-fatal */ }
      return { deleted, pending };
    },
    onSuccess: (r) => {
      if (keeper) {
        toast.success(`Merged into ${keeper.time?.slice(0,5)} · ${keeper.from_location} → ${keeper.to_location}` +
          (r.pending ? ` (${r.pending} awaiting driver)` : ""));
      }
      qc.invalidateQueries({ queryKey: ["jobs"] });
      onOpenChange(false);
      onDone();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!keeper) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Merge {jobs.length} trips</DialogTitle>
          <DialogDescription>
            Passengers from the other trips will be moved into the earliest one, then the empty trips will be removed.
            Trips already accepted by a driver will require driver approval before removal.
          </DialogDescription>
        </DialogHeader>
        <div className="text-sm space-y-2">
          <div><span className="text-muted-foreground">Keeping:</span> <b>{keeper.time?.slice(0,5)}</b> · {keeper.from_location} → {keeper.to_location}</div>
          <div className="text-muted-foreground">Removing: {others.length} trip(s)</div>
          {!uniform && (
            <div className="rounded border border-destructive/40 bg-destructive/10 text-destructive px-2 py-1.5 text-xs">
              Selected trips differ in date, From or To. Passengers will still be merged into the earliest trip using its details.
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => mut.mutate()} disabled={mut.isPending}>
            {mut.isPending ? "Merging…" : "Merge"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
