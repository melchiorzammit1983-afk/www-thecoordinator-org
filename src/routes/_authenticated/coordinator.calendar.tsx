import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useState } from "react";
import { DndContext, useDraggable, useDroppable, type DragEndEvent, PointerSensor, useSensor, useSensors } from "@dnd-kit/core";
import { format, addDays, startOfWeek, parseISO } from "date-fns";
import { toast } from "sonner";
import { Plus, Copy, Split, Pencil, GripVertical, Calendar as CalIcon, Trash2, MessageCircle } from "lucide-react";

import {
  listJobs, listDrivers, assignDriver, cloneJob, splitJob, deleteJob, cancelDeletionRequest,
  checkFlightStatus, shareJobToDriver,
} from "@/lib/coordinator.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { JobFormDialog } from "@/components/coordinator/JobFormDialog";
import { PaxSplitDialog } from "@/components/coordinator/PaxSplitDialog";
import { TripChatDialog } from "@/components/trip/TripChatDialog";
import { getUnreadCountsCoord } from "@/lib/coordinator.functions";
import { Users, MessagesSquare } from "lucide-react";

export const Route = createFileRoute("/_authenticated/coordinator/calendar")({
  head: () => ({ meta: [{ title: "Calendar — Coordinator" }] }),
  component: CalendarPage,
});

type Job = {
  id: string;
  from_location: string; to_location: string;
  date: string; time: string; pickup_at: string | null;
  flightorship: string | null;
  from_flight: string | null;
  to_flight: string | null;
  flight_status: string | null;
  flight_status_note: string | null;
  flight_status_updated_at: string | null;
  tracking_enabled: boolean; qr_strict_mode: boolean;
  status: string;
  driver_id: string | null;
  vehicle: string | null;
  clientcompanyname: string | null;
  driver_accepted_at: string | null;
  deletion_requested_at: string | null;
  drivers?: { name: string } | null;
  pax?: { id: string; name: string }[];
};

type Driver = { id: string; name: string; vehicle: string | null };

function CalendarPage() {
  const [view, setView] = useState<"day" | "week">("day");
  const [anchor, setAnchor] = useState<Date>(new Date());
  const [openNew, setOpenNew] = useState(false);
  const [editJob, setEditJob] = useState<Job | null>(null);
  const [paxJob, setPaxJob] = useState<Job | null>(null);

  const range = useMemo(() => {
    if (view === "day") return { from: format(anchor, "yyyy-MM-dd"), to: format(anchor, "yyyy-MM-dd"), days: [anchor] };
    const start = startOfWeek(anchor, { weekStartsOn: 1 });
    const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
    return { from: format(start, "yyyy-MM-dd"), to: format(addDays(start, 6), "yyyy-MM-dd"), days };
  }, [view, anchor]);

  const jobsFn = useServerFn(listJobs);
  const driversFn = useServerFn(listDrivers);
  const { data: jobs, refetch } = useQuery({
    queryKey: ["jobs", range.from, range.to],
    queryFn: () => jobsFn({ data: { from: range.from, to: range.to } }) as Promise<Job[]>,
  });
  const { data: drivers } = useQuery({
    queryKey: ["drivers"], queryFn: () => driversFn() as Promise<Driver[]>,
  });

  const assignFn = useServerFn(assignDriver);
  const assignMut = useMutation({
    mutationFn: (v: { job_id: string; driver_id: string | null }) => assignFn({ data: v }),
    onSuccess: () => { toast.success("Assigned"); refetch(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  // Poll live flight statuses every 3 min for jobs with a flight in view.
  const flightFn = useServerFn(checkFlightStatus);
  useEffect(() => {
    const hasFlights = (jobs ?? []).some((j) => j.from_flight || j.to_flight);
    if (!hasFlights) return;
    let cancelled = false;
    const run = async () => {
      try { await flightFn(); if (!cancelled) refetch(); } catch { /* ignore */ }
    };
    run();
    const id = setInterval(run, 180_000);
    return () => { cancelled = true; clearInterval(id); };
  }, [jobs, flightFn, refetch]);

  function onDragEnd(e: DragEndEvent) {
    const jobId = String(e.active.id);
    const dropId = e.over?.id ? String(e.over.id) : null;
    if (!dropId) return;
    if (dropId === "unassigned") assignMut.mutate({ job_id: jobId, driver_id: null });
    else if (dropId.startsWith("driver:")) assignMut.mutate({ job_id: jobId, driver_id: dropId.slice(7) });
  }

  const unassigned = (jobs ?? []).filter((j) => !j.driver_id);

  return (
    <div className="p-4 md:p-6">
      <header className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 mb-4">
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-semibold">Dispatch board</h1>
          <div className="ml-2 flex rounded-md border overflow-hidden">
            <button className={`px-3 py-1.5 text-xs ${view==="day"?"bg-primary text-primary-foreground":"bg-background"}`} onClick={() => setView("day")}>Day</button>
            <button className={`px-3 py-1.5 text-xs ${view==="week"?"bg-primary text-primary-foreground":"bg-background"}`} onClick={() => setView("week")}>Week</button>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => setAnchor(addDays(anchor, view === "day" ? -1 : -7))}>‹</Button>
          <div className="text-sm font-medium min-w-[140px] text-center flex items-center gap-1 justify-center">
            <CalIcon className="h-3.5 w-3.5" />
            {view === "day" ? format(anchor, "EEE, d MMM yyyy") : `${format(range.days[0], "d MMM")} – ${format(range.days[6], "d MMM")}`}
          </div>
          <Button size="sm" variant="outline" onClick={() => setAnchor(addDays(anchor, view === "day" ? 1 : 7))}>›</Button>
          <Button size="sm" onClick={() => setOpenNew(true)}><Plus className="h-4 w-4 mr-1" /> New trip</Button>
        </div>
      </header>

      <DndContext sensors={sensors} onDragEnd={onDragEnd}>
        <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-4">
          <UnassignedColumn jobs={unassigned} onEdit={setEditJob} onPax={setPaxJob} />
          {view === "day"
            ? <DriverLanes drivers={drivers ?? []} jobs={jobs ?? []} onEdit={setEditJob} onPax={setPaxJob} />
            : <WeekGrid drivers={drivers ?? []} jobs={jobs ?? []} days={range.days} onEdit={setEditJob} onPax={setPaxJob} />}
        </div>
      </DndContext>

      <JobFormDialog open={openNew} onOpenChange={setOpenNew} drivers={drivers ?? []} onSaved={() => refetch()} />
      <JobFormDialog
        open={!!editJob} onOpenChange={(v) => !v && setEditJob(null)}
        drivers={drivers ?? []} job={editJob ?? undefined} onSaved={() => { setEditJob(null); refetch(); }}
      />
      <PaxSplitDialog
        open={!!paxJob} onOpenChange={(v) => !v && setPaxJob(null)}
        jobId={paxJob?.id ?? null}
        jobLabel={paxJob ? `${paxJob.from_location} → ${paxJob.to_location} · ${paxJob.date} ${paxJob.time?.slice(0,5)}` : ""}
        drivers={drivers ?? []}
      />
    </div>
  );
}

function UnassignedColumn({ jobs, onEdit, onPax }: { jobs: Job[]; onEdit: (j: Job) => void; onPax: (j: Job) => void }) {
  const { setNodeRef, isOver } = useDroppable({ id: "unassigned" });
  return (
    <div ref={setNodeRef} className={`rounded-lg border bg-card p-3 min-h-[420px] ${isOver ? "ring-2 ring-primary" : ""}`}>
      <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
        Unassigned ({jobs.length})
      </div>
      <div className="space-y-2">
        {jobs.length === 0 && <div className="text-xs text-muted-foreground py-8 text-center">Everything is assigned 🎉</div>}
        {jobs.map((j) => <TripCard key={j.id} job={j} onEdit={onEdit} onPax={onPax} />)}
      </div>
    </div>
  );
}

function DriverLanes({ drivers, jobs, onEdit, onPax }: { drivers: Driver[]; jobs: Job[]; onEdit: (j: Job) => void; onPax: (j: Job) => void }) {
  return (
    <div className="rounded-lg border bg-card p-3 overflow-x-auto">
      <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${Math.max(drivers.length, 1)}, minmax(220px, 1fr))` }}>
        {drivers.length === 0 && (
          <div className="text-sm text-muted-foreground p-8 text-center">Add drivers first to see lanes.</div>
        )}
        {drivers.map((d) => (
          <DriverLane key={d.id} driver={d} jobs={jobs.filter((j) => j.driver_id === d.id)} onEdit={onEdit} onPax={onPax} />
        ))}
      </div>
    </div>
  );
}

function DriverLane({ driver, jobs, onEdit, onPax }: { driver: Driver; jobs: Job[]; onEdit: (j: Job) => void; onPax: (j: Job) => void }) {
  const { setNodeRef, isOver } = useDroppable({ id: `driver:${driver.id}` });
  return (
    <div ref={setNodeRef} className={`rounded-md border p-2 min-h-[380px] ${isOver ? "ring-2 ring-primary bg-primary/5" : ""}`}>
      <div className="text-sm font-medium">{driver.name}</div>
      <div className="text-xs text-muted-foreground mb-2">{driver.vehicle ?? "—"}</div>
      <div className="space-y-2">
        {jobs.map((j) => <TripCard key={j.id} job={j} onEdit={onEdit} onPax={onPax} />)}
      </div>
    </div>
  );
}

function WeekGrid({ drivers, jobs, days, onEdit, onPax }: { drivers: Driver[]; jobs: Job[]; days: Date[]; onEdit: (j: Job) => void; onPax: (j: Job) => void }) {
  return (
    <div className="rounded-lg border bg-card p-3 overflow-x-auto">
      <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(7, minmax(180px, 1fr))` }}>
        {days.map((d) => {
          const key = format(d, "yyyy-MM-dd");
          const dayJobs = jobs.filter((j) => j.date === key);
          return (
            <div key={key} className="rounded-md border p-2 min-h-[380px]">
              <div className="text-sm font-medium">{format(d, "EEE")}</div>
              <div className="text-xs text-muted-foreground mb-2">{format(d, "d MMM")}</div>
              <div className="space-y-2">
                {dayJobs.map((j) => (
                  <TripCard key={j.id} job={j} onEdit={onEdit} onPax={onPax}
                    driverName={drivers.find((dr) => dr.id === j.driver_id)?.name} />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function TripCard({ job, onEdit, onPax, driverName }: { job: Job; onEdit: (j: Job) => void; onPax: (j: Job) => void; driverName?: string }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: job.id });
  const [openClone, setOpenClone] = useState(false);
  const [openSplit, setOpenSplit] = useState(false);
  const paxCount = job.pax?.length ?? 0;
  const style: React.CSSProperties = transform
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`, opacity: isDragging ? 0.7 : 1 }
    : {};
  const problem = job.flight_status === "delayed" || job.flight_status === "cancelled" || !!job.deletion_requested_at;
  const assignedAccepted = !!job.driver_id && !!job.driver_accepted_at;
  const assignedPending = !!job.driver_id && !job.driver_accepted_at;
  const cardClass = problem
    ? "rounded-md border-2 border-destructive bg-destructive/10 p-2 shadow-sm hover:shadow transition-shadow"
    : assignedAccepted
    ? "rounded-md border-2 border-emerald-500 bg-emerald-500/10 p-2 shadow-sm hover:shadow transition-shadow"
    : assignedPending
    ? "rounded-md border-2 border-amber-500 bg-amber-500/10 p-2 shadow-sm hover:shadow transition-shadow"
    : "rounded-md border bg-background p-2 shadow-sm hover:shadow transition-shadow";
  const delayed = job.flight_status === "delayed" || job.flight_status === "cancelled";
  const flightCode = job.from_flight || job.to_flight || job.flightorship;
  return (
    <div ref={setNodeRef} style={style} className={cardClass}>
      <div className="flex items-start gap-2">
        <button className="text-muted-foreground touch-none" {...attributes} {...listeners}>
          <GripVertical className="h-4 w-4" />
        </button>
        <div className="min-w-0 flex-1">
          <div className="text-xs text-muted-foreground">{job.time?.slice(0, 5)} · {job.date}</div>
          <div className="text-sm font-medium truncate">{job.from_location} → {job.to_location}</div>
          {job.clientcompanyname && <div className="text-xs text-muted-foreground truncate">{job.clientcompanyname}</div>}
          {driverName && <div className="text-xs mt-1">👤 {driverName}</div>}
          {delayed && (
            <div className="text-[11px] font-medium text-destructive mt-1">
              ✈ {flightCode} {job.flight_status === "cancelled" ? "CANCELLED" : (job.flight_status_note || "DELAYED")}
            </div>
          )}
          <div className="flex gap-1 mt-1 flex-wrap">
            {paxCount > 0 && (
              <button
                type="button" onClick={() => onPax(job)}
                className="inline-flex items-center gap-1 rounded bg-primary/10 text-primary text-[10px] px-1.5 py-0.5 hover:bg-primary/20"
              >
                <Users className="h-3 w-3" /> {paxCount} pax
              </button>
            )}
            {job.tracking_enabled && <Badge variant="outline" className="text-[10px]">Tracking</Badge>}
            {job.qr_strict_mode && <Badge variant="outline" className="text-[10px]">QR</Badge>}
            {flightCode && !delayed && <Badge variant="secondary" className="text-[10px]">✈ {flightCode}</Badge>}
            {job.driver_accepted_at && <Badge className="text-[10px] bg-emerald-600 hover:bg-emerald-600">Accepted</Badge>}
            {job.deletion_requested_at && <Badge variant="destructive" className="text-[10px]">Deletion pending</Badge>}
          </div>
          <div className="flex gap-1 mt-2">
            <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => onEdit(job)}><Pencil className="h-3 w-3" /></Button>
            <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => onPax(job)} title="Passengers"><Users className="h-3 w-3" /></Button>
            <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => setOpenSplit(true)}><Split className="h-3 w-3" /></Button>
            <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => setOpenClone(true)}><Copy className="h-3 w-3" /></Button>
            {job.driver_id && <ShareToDriverButton job={job} paxCount={paxCount} driverName={driverName} />}
            <DeleteButton job={job} />
          </div>

        </div>
      </div>
      <CloneDialog open={openClone} onOpenChange={setOpenClone} job={job} />
      <SplitDialog open={openSplit} onOpenChange={setOpenSplit} job={job} />
    </div>
  );
}

function ShareToDriverButton({ job, paxCount, driverName }: { job: Job; paxCount: number; driverName?: string }) {
  const shareFn = useServerFn(shareJobToDriver);
  const shareMut = useMutation({
    mutationFn: () => shareFn({ data: { job_id: job.id } }) as Promise<any>,
    onSuccess: (res: any) => {
      const url = `${window.location.origin}/m/driver/${res.token}`;
      const when = res.job.pickup_at
        ? new Date(res.job.pickup_at).toLocaleString([], { weekday: "short", month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" })
        : `${res.job.date}${res.job.time ? " " + res.job.time.slice(0, 5) : ""}`;
      const from = [res.job.from_location, res.job.from_flight].filter(Boolean).join(" ");
      const to = [res.job.to_location, res.job.to_flight].filter(Boolean).join(" ");
      const lines = [
        `🚐 New trip assigned${driverName ? ` — ${driverName}` : ""}`,
        `🕒 ${when}`,
        `📍 ${from || "?"} → ${to || "?"}`,
        `👥 ${res.job.pax_count ?? paxCount} pax`,
      ];
      if (res.job.vehicle) lines.push(`🚙 ${res.job.vehicle}`);
      lines.push("", `Open your manifest: ${url}`);
      const text = encodeURIComponent(lines.join("\n"));
      window.open(`https://wa.me/?text=${text}`, "_blank", "noopener");
    },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <Button
      size="sm" variant="ghost"
      className="h-7 px-2 text-emerald-600"
      title="Share trip with driver on WhatsApp"
      onClick={() => shareMut.mutate()}
      disabled={shareMut.isPending}
    >
      <MessageCircle className="h-3 w-3" />
    </Button>
  );
}

function DeleteButton({ job }: { job: Job }) {
  const qc = useQueryClient();
  const delFn = useServerFn(deleteJob);
  const cancelFn = useServerFn(cancelDeletionRequest);
  const requiresApproval = !!(job.driver_id && job.driver_accepted_at);
  const pending = !!job.deletion_requested_at;

  const delMut = useMutation({
    mutationFn: () => delFn({ data: { job_id: job.id } }),
    onSuccess: (res: { deleted: boolean; pending: boolean }) => {
      toast.success(res.pending ? "Deletion requested — waiting for driver approval" : "Deleted");
      qc.invalidateQueries({ queryKey: ["jobs"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const cancelMut = useMutation({
    mutationFn: () => cancelFn({ data: { job_id: job.id } }),
    onSuccess: () => { toast.success("Deletion request cancelled"); qc.invalidateQueries({ queryKey: ["jobs"] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  function onClick() {
    if (pending) {
      if (confirm("Cancel the pending deletion request?")) cancelMut.mutate();
      return;
    }
    const msg = requiresApproval
      ? "This driver has already accepted this trip. Deletion will be sent to them for approval. Continue?"
      : "Delete this trip?";
    if (confirm(msg)) delMut.mutate();
  }

  return (
    <Button
      size="sm" variant="ghost"
      className={`h-7 px-2 ${pending ? "text-amber-600" : "text-destructive"}`}
      onClick={onClick}
      title={pending ? "Cancel deletion request" : requiresApproval ? "Request deletion (driver must approve)" : "Delete trip"}
    >
      <Trash2 className="h-3 w-3" />
    </Button>
  );
}

function CloneDialog({ open, onOpenChange, job }: { open: boolean; onOpenChange: (v: boolean) => void; job: Job }) {
  const [target, setTarget] = useState(job.date);
  const qc = useQueryClient();
  const fn = useServerFn(cloneJob);
  const mut = useMutation({
    mutationFn: () => fn({ data: { job_id: job.id, target_date: target } }),
    onSuccess: () => { toast.success("Cloned"); onOpenChange(false); qc.invalidateQueries({ queryKey: ["jobs"] }); },
    onError: (e: Error) => e.message === "insufficient_points" ? toast.error("Top-Up Required to clone") : toast.error(e.message),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Clone trip</DialogTitle><DialogDescription>Choose a target date.</DialogDescription></DialogHeader>
        <div className="space-y-2">
          <Label>Target date</Label>
          <Input type="date" value={target} onChange={(e) => setTarget(e.target.value)} />
        </div>
        <DialogFooter><Button disabled={mut.isPending} onClick={() => mut.mutate()}>{mut.isPending?"Cloning…":"Clone"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SplitDialog({ open, onOpenChange, job }: { open: boolean; onOpenChange: (v: boolean) => void; job: Job }) {
  const [labels, setLabels] = useState<string[]>(["Vehicle A", "Vehicle B"]);
  const qc = useQueryClient();
  const fn = useServerFn(splitJob);
  const mut = useMutation({
    mutationFn: () => fn({ data: { job_id: job.id, splits: labels.filter(Boolean).map((l) => ({ label: l })) } }),
    onSuccess: () => { toast.success("Split into new jobs"); onOpenChange(false); qc.invalidateQueries({ queryKey: ["jobs"] }); },
    onError: (e: Error) => e.message === "insufficient_points" ? toast.error("Top-Up Required to split") : toast.error(e.message),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Split trip into vehicles</DialogTitle>
          <DialogDescription>Creates one new job per row. Original stays.</DialogDescription></DialogHeader>
        <div className="space-y-2">
          {labels.map((l, i) => (
            <Input key={i} value={l} onChange={(e) => setLabels(labels.map((x, j) => j===i? e.target.value : x))} />
          ))}
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => setLabels([...labels, `Vehicle ${String.fromCharCode(65+labels.length)}`])}>Add row</Button>
            {labels.length > 2 && <Button size="sm" variant="ghost" onClick={() => setLabels(labels.slice(0, -1))}>Remove</Button>}
          </div>
        </div>
        <DialogFooter><Button disabled={mut.isPending} onClick={() => mut.mutate()}>{mut.isPending?"Splitting…":"Split"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
