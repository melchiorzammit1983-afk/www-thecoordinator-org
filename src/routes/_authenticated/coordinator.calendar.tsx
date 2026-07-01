import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useState } from "react";
import { DndContext, useDraggable, useDroppable, type DragEndEvent, PointerSensor, useSensor, useSensors } from "@dnd-kit/core";
import { format, addDays, startOfWeek } from "date-fns";
import { toast } from "sonner";
import {
  Plus, Copy, Split, GripVertical, Calendar as CalIcon, Trash2, MessageCircle, Send,
  Users, MessagesSquare, MoreVertical, ChevronDown, ChevronRight, Inbox, PlaneTakeoff, Link2,
} from "lucide-react";
import {
  listConnections, dispatchJobToPartner,
  listIncomingDispatches, listOutboundDispatches, respondToDispatch,
} from "@/lib/collab.functions";

import {
  listJobs, listDrivers, assignDriver, cloneJob, splitJob, deleteJob, cancelDeletionRequest,
  checkFlightStatus, shareJobToDriver, getUnreadCountsCoord,
} from "@/lib/coordinator.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuSub, DropdownMenuSubTrigger, DropdownMenuSubContent,
  DropdownMenuTrigger, DropdownMenuPortal,
} from "@/components/ui/dropdown-menu";
import { JobFormDialog } from "@/components/coordinator/JobFormDialog";
import { PaxSplitDialog } from "@/components/coordinator/PaxSplitDialog";
import { TripChatDialog } from "@/components/trip/TripChatDialog";
import { LabelChip, LabelStripe, type Label as TLabel } from "@/components/coordinator/LabelChip";
import { ChainTimeline } from "@/components/coordinator/ChainTimeline";
import { TripProgress } from "@/components/coordinator/TripProgress";
import { TripDetailsSheet } from "@/components/coordinator/TripDetailsSheet";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/coordinator/calendar")({
  head: () => ({ meta: [{ title: "Dispatch — Coordinator" }] }),
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
  flight_scheduled_at: string | null;
  flight_estimated_at: string | null;
  tracking_enabled: boolean; qr_strict_mode: boolean;
  status: string;
  driver_id: string | null;
  vehicle: string | null;
  clientcompanyname: string | null;
  driver_accepted_at: string | null;
  deletion_requested_at: string | null;
  drivers?: { name: string; vehicle?: string | null; phone?: string | null; seats_available?: number | null; availability_note?: string | null } | null;
  pax?: { id: string; name: string; status?: string | null; boarded_at?: string | null }[];
  labels?: TLabel[];
  external?: boolean;
  executor_name?: string | null;
  external_driver_name?: string | null;
  payment_status?: string | null;
};

type Driver = { id: string; name: string; vehicle: string | null };

function CalendarPage() {
  const [view, setView] = useState<"day" | "week">("day");
  const [anchor, setAnchor] = useState<Date>(new Date());
  const [openNew, setOpenNew] = useState(false);
  const [editJob, setEditJob] = useState<Job | null>(null);
  const [paxJob, setPaxJob] = useState<Job | null>(null);
  const [chatJob, setChatJob] = useState<Job | null>(null);
  const [detailsJob, setDetailsJob] = useState<Job | null>(null);
  const [justAcceptedId, setJustAcceptedId] = useState<string | null>(null);
  const qc = useQueryClient();


  const unreadFn = useServerFn(getUnreadCountsCoord);
  const { data: unreadByJob } = useQuery({
    queryKey: ["coord-unread"],
    queryFn: () => unreadFn() as Promise<Record<string, number>>,
    refetchInterval: 15_000,
  });

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

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  // Live refresh on partner/chain updates
  useEffect(() => {
    const ch = supabase
      .channel("dispatch-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "jobs" }, () => {
        qc.invalidateQueries({ queryKey: ["jobs"] });
        qc.invalidateQueries({ queryKey: ["collab"] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "job_dispatch_hops" }, () => {
        qc.invalidateQueries({ queryKey: ["collab"] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "trip_messages" }, () => {
        qc.invalidateQueries({ queryKey: ["coord-unread"] });
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [qc]);

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
  const cardCtx: CardCtx = {
    onEdit: setEditJob, onPax: setPaxJob, onChat: setChatJob,
    onOpenDetails: setDetailsJob,
    onAssign: (job, driverId) => assignMut.mutate({ job_id: job.id, driver_id: driverId }),
    drivers: drivers ?? [],
    unread: unreadByJob ?? {},
    highlightId: justAcceptedId,
  };

  function handleAccepted(res: { id: string; date: string | null }) {
    if (res.date) {
      const [y, m, d] = res.date.split("-").map(Number);
      if (y && m && d) setAnchor(new Date(y, m - 1, d));
    }
    setJustAcceptedId(res.id);
    qc.invalidateQueries({ queryKey: ["jobs"] });
    setTimeout(() => setJustAcceptedId((cur) => (cur === res.id ? null : cur)), 4000);
  }


  return (
    <div className="p-3 sm:p-4 md:p-6 space-y-4">
      {/* Header — mobile-friendly stacked */}
      <header className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <h1 className="text-lg sm:text-xl font-semibold truncate">Dispatch board</h1>
          <Button size="sm" onClick={() => setOpenNew(true)}>
            <Plus className="h-4 w-4 mr-1" /> New
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-md border overflow-hidden">
            <button className={`px-3 py-1.5 text-xs ${view==="day"?"bg-primary text-primary-foreground":"bg-background"}`} onClick={() => setView("day")}>Day</button>
            <button className={`px-3 py-1.5 text-xs ${view==="week"?"bg-primary text-primary-foreground":"bg-background"}`} onClick={() => setView("week")}>Week</button>
          </div>
          <div className="flex items-center gap-1 ml-auto">
            <Button size="sm" variant="outline" onClick={() => setAnchor(addDays(anchor, view === "day" ? -1 : -7))}>‹</Button>
            <div className="text-xs sm:text-sm font-medium min-w-[130px] text-center flex items-center gap-1 justify-center">
              <CalIcon className="h-3.5 w-3.5" />
              {view === "day" ? format(anchor, "EEE, d MMM") : `${format(range.days[0], "d MMM")} – ${format(range.days[6], "d MMM")}`}
            </div>
            <Button size="sm" variant="outline" onClick={() => setAnchor(addDays(anchor, view === "day" ? 1 : 7))}>›</Button>
          </div>
        </div>
      </header>

      {/* Inbound (pending my decision) */}
      <InboundBoard ctx={cardCtx} onAccepted={handleAccepted} />


      {/* Outbound (my trips currently at partners) */}
      <OutboundBoard />

      <DndContext sensors={sensors} onDragEnd={onDragEnd}>
        <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-3">
          <UnassignedColumn jobs={unassigned} ctx={cardCtx} />
          {view === "day"
            ? <DriverLanes drivers={drivers ?? []} jobs={jobs ?? []} ctx={cardCtx} />
            : <WeekGrid drivers={drivers ?? []} jobs={jobs ?? []} days={range.days} ctx={cardCtx} />}
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
      <TripChatDialog
        open={!!chatJob} onOpenChange={(v) => !v && setChatJob(null)}
        jobId={chatJob?.id ?? null}
        title={chatJob ? `${chatJob.from_location} → ${chatJob.to_location}` : ""}
        role="coordinator"
      />
      <DetailsSheetHost
        job={detailsJob}
        onClose={() => setDetailsJob(null)}
        onEdit={(j) => { setDetailsJob(null); setEditJob(j); }}
        onChat={(j) => setChatJob(j)}
        onPax={(j) => setPaxJob(j)}
        driverName={
          detailsJob
            ? (drivers ?? []).find((d) => d.id === detailsJob.driver_id)?.name ?? detailsJob.drivers?.name ?? null
            : null
        }
      />
    </div>
  );
}

type CardCtx = {
  onEdit: (j: Job) => void;
  onPax: (j: Job) => void;
  onChat: (j: Job) => void;
  onOpenDetails: (j: Job) => void;
  onAssign: (j: Job, driverId: string | null) => void;
  drivers: Driver[];
  unread: Record<string, number>;
  highlightId?: string | null;
};


/* ------------------------------ Inbound / Outbound ------------------------------ */

function InboundBoard({ ctx, onAccepted }: { ctx: CardCtx; onAccepted?: (res: { id: string; date: string | null }) => void }) {
  const listIn = useServerFn(listIncomingDispatches);
  const respond = useServerFn(respondToDispatch);
  const qc = useQueryClient();
  const [open, setOpen] = useState(true);
  const q = useQuery({ queryKey: ["collab", "incoming"], queryFn: () => listIn(), refetchInterval: 20_000 });
  const respondMut = useMutation({
    mutationFn: async (v: { job_id: string; decision: "accepted" | "rejected" }) =>
      (await respond({ data: v })) as { ok: boolean; id: string; date: string | null; decision: string },
    onSuccess: (res) => {
      toast.success("Done");
      qc.invalidateQueries({ queryKey: ["collab"] });
      qc.invalidateQueries({ queryKey: ["jobs"] });
      if (res?.decision === "accepted" && onAccepted) onAccepted({ id: res.id, date: res.date });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const items: any[] = q.data ?? [];
  if (items.length === 0) return null;
  return (
    <section className="rounded-lg border bg-card">
      <button
        type="button" onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 px-3 py-2 text-sm font-medium"
      >
        {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        <Inbox className="h-4 w-4 text-primary" />
        <span>Inbound — pending your decision</span>
        <Badge variant="secondary" className="ml-1">{items.length}</Badge>
      </button>
      {open && (
        <div className="grid gap-2 p-3 pt-0 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((j: any) => (
            <div key={j.id} className="rounded-md border bg-background p-3 space-y-2">
              <div className="flex items-center gap-2 flex-wrap text-xs">
                <Badge variant="outline">from {j.origin?.name ?? "partner"}</Badge>
                <span className="font-medium">{j.date} {j.time?.slice(0,5)}</span>
                <span className="ml-auto text-muted-foreground">{(j.pax ?? []).length} pax</span>
              </div>
              <div className="text-sm font-medium truncate">{j.from_location} → {j.to_location}</div>
              {j.dispatch_note && <div className="text-xs text-muted-foreground">"{j.dispatch_note}"</div>}
              <ChainTimeline jobId={j.id} />
              <div className="flex gap-2 pt-1">
                <Button size="sm" className="flex-1" onClick={() => respondMut.mutate({ job_id: j.id, decision: "accepted" })}>Accept</Button>
                <Button size="sm" variant="outline" className="flex-1" onClick={() => respondMut.mutate({ job_id: j.id, decision: "rejected" })}>Reject</Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function OutboundBoard() {
  const listOut = useServerFn(listOutboundDispatches);
  const [open, setOpen] = useState(false);
  const q = useQuery({ queryKey: ["collab", "outbound"], queryFn: () => listOut(), refetchInterval: 20_000 });
  const items: any[] = q.data ?? [];
  if (items.length === 0) return null;
  return (
    <section className="rounded-lg border bg-card">
      <button
        type="button" onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 px-3 py-2 text-sm font-medium"
      >
        {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        <PlaneTakeoff className="h-4 w-4 text-primary" />
        <span>Outbound — trips at partners (live)</span>
        <Badge variant="secondary" className="ml-1">{items.length}</Badge>
      </button>
      {open && (
        <div className="grid gap-2 p-3 pt-0 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((j: any) => (
            <div key={j.id} className="rounded-md border bg-background p-3 space-y-2">
              <div className="flex items-center gap-2 flex-wrap text-xs">
                <Badge variant="outline">at {j.executor?.name ?? "partner"}</Badge>
                <span className="font-medium">{j.date} {j.time?.slice(0,5)}</span>
                <Badge variant={j.dispatch_status === "accepted" ? "default" : j.dispatch_status === "rejected" ? "destructive" : "secondary"}>{j.dispatch_status}</Badge>
                {j.drivers?.name && <Badge variant="secondary">👤 {j.drivers.name}</Badge>}
                <span className="ml-auto text-muted-foreground">{j.status}</span>
              </div>
              <div className="text-sm font-medium truncate">{j.from_location} → {j.to_location}</div>
              <ChainTimeline jobId={j.id} />
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

/* ------------------------------ Columns ------------------------------ */

function UnassignedColumn({ jobs, ctx }: { jobs: Job[]; ctx: CardCtx }) {
  const { setNodeRef, isOver } = useDroppable({ id: "unassigned" });
  return (
    <div ref={setNodeRef} className={`rounded-lg border bg-card p-3 min-h-[220px] ${isOver ? "ring-2 ring-primary" : ""}`}>
      <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
        Unassigned ({jobs.length})
      </div>
      <div className="space-y-2">
        {jobs.length === 0 && <div className="text-xs text-muted-foreground py-6 text-center">Everything is assigned</div>}
        {jobs.map((j) => <TripCard key={j.id} job={j} ctx={ctx} />)}
      </div>
    </div>
  );
}

function DriverLanes({ drivers, jobs, ctx }: { drivers: Driver[]; jobs: Job[]; ctx: CardCtx }) {
  return (
    <div className="rounded-lg border bg-card p-3 overflow-x-auto">
      <div className="grid gap-3 sm:auto-cols-[minmax(240px,1fr)] sm:grid-flow-col">
        {drivers.length === 0 && (
          <div className="text-sm text-muted-foreground p-8 text-center">Add drivers first to see lanes.</div>
        )}
        {drivers.map((d) => (
          <DriverLane key={d.id} driver={d} jobs={jobs.filter((j) => j.driver_id === d.id)} ctx={ctx} />
        ))}
      </div>
    </div>
  );
}

function DriverLane({ driver, jobs, ctx }: { driver: Driver; jobs: Job[]; ctx: CardCtx }) {
  const { setNodeRef, isOver } = useDroppable({ id: `driver:${driver.id}` });
  return (
    <div ref={setNodeRef} className={`rounded-md border p-2 min-h-[220px] ${isOver ? "ring-2 ring-primary bg-primary/5" : ""}`}>
      <div className="text-sm font-medium truncate">{driver.name}</div>
      <div className="text-xs text-muted-foreground mb-2 truncate">{driver.vehicle ?? "—"}</div>
      <div className="space-y-2">
        {jobs.map((j) => <TripCard key={j.id} job={j} ctx={ctx} />)}
      </div>
    </div>
  );
}

function WeekGrid({ drivers, jobs, days, ctx }: { drivers: Driver[]; jobs: Job[]; days: Date[]; ctx: CardCtx }) {
  return (
    <div className="rounded-lg border bg-card p-3 overflow-x-auto">
      <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(7, minmax(180px, 1fr))` }}>
        {days.map((d) => {
          const key = format(d, "yyyy-MM-dd");
          const dayJobs = jobs.filter((j) => j.date === key);
          return (
            <div key={key} className="rounded-md border p-2 min-h-[220px]">
              <div className="text-sm font-medium">{format(d, "EEE")}</div>
              <div className="text-xs text-muted-foreground mb-2">{format(d, "d MMM")}</div>
              <div className="space-y-2">
                {dayJobs.map((j) => (
                  <TripCard key={j.id} job={j} ctx={ctx}
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

/* ------------------------------ Trip card ------------------------------ */

function TripCard({ job, ctx, driverName }: { job: Job; ctx: CardCtx; driverName?: string }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: job.id });
  const [openClone, setOpenClone] = useState(false);
  const [openSplit, setOpenSplit] = useState(false);
  const [openDispatch, setOpenDispatch] = useState(false);

  const paxCount = job.pax?.length ?? 0;
  const unread = ctx.unread[job.id] ?? 0;
  const flightIssue = job.flight_status === "delayed" || job.flight_status === "cancelled" || job.flight_status === "time_mismatch";
  const problem = flightIssue || !!job.deletion_requested_at;
  const assignedAccepted = !!job.driver_id && !!job.driver_accepted_at;
  const assignedPending = !!job.driver_id && !job.driver_accepted_at;

  // Color priority: red > blue(unread) > green > amber > default
  const tone = problem
    ? "border-destructive bg-destructive/10"
    : unread > 0
    ? "border-blue-500 bg-blue-500/10 ring-1 ring-blue-500/40"
    : assignedAccepted
    ? "border-emerald-500/70 bg-emerald-500/5"
    : assignedPending
    ? "border-amber-500/70 bg-amber-500/5"
    : "border-border bg-background";

  const style: React.CSSProperties = transform
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`, opacity: isDragging ? 0.7 : 1 }
    : {};

  const delayed = flightIssue;
  const flightCode = job.from_flight || job.to_flight || job.flightorship;
  const newTime = (() => {
    const iso = job.flight_estimated_at || job.flight_scheduled_at;
    if (!iso) return "";
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? "" : d.toISOString().slice(11, 16);
  })();
  const flightMsg =
    job.flight_status === "cancelled" ? "CANCELLED" :
    job.flight_status === "time_mismatch" ? (job.flight_status_note || (newTime ? `flight ${newTime} ≠ pickup` : "TIME MISMATCH")) :
    job.flight_status === "delayed" ? (job.flight_status_note || (newTime ? `DELAYED → ${newTime}` : "DELAYED")) :
    "";
  const labels = job.labels ?? [];
  const shownDriver = driverName ?? job.drivers?.name ?? null;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`relative rounded-md border-2 pl-3 pr-1 py-2 shadow-sm transition-colors ${tone} ${ctx.highlightId === job.id ? "ring-2 ring-primary ring-offset-1 animate-pulse" : ""}`}
    >
      <LabelStripe labels={labels} />

      {/* Tap area — opens details sheet */}
      <button
        type="button"
        onClick={() => ctx.onOpenDetails(job)}
        className="w-full text-left"
      >
        <div className="flex items-center gap-2 min-w-0">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
              <span className="font-medium text-foreground">{job.time?.slice(0,5)}</span>
              <span>·</span>
              <span>{job.date}</span>
              {unread > 0 && (
                <span className="ml-auto inline-flex items-center gap-1 text-blue-600 font-medium">
                  <MessagesSquare className="h-3 w-3" /> {unread} new
                </span>
              )}
            </div>
            <div className="text-sm font-semibold truncate mt-0.5">
              {job.from_location} <span className="text-muted-foreground">→</span> {job.to_location}
            </div>
            {job.clientcompanyname && (
              <div className="text-[11px] text-muted-foreground truncate">{job.clientcompanyname}</div>
            )}
            {shownDriver && (
              <div className="text-[11px] mt-0.5 truncate">
                <span className="text-muted-foreground">Driver:</span> <span className="font-medium">{shownDriver}</span>
                {assignedAccepted && <span className="ml-1 text-emerald-600">✓ accepted</span>}
                {assignedPending && <span className="ml-1 text-amber-600">• pending</span>}
              </div>
            )}
            {delayed && (
              <div className="text-[11px] font-medium text-destructive mt-0.5 truncate">
                ✈ {flightCode} {flightMsg}
              </div>
            )}
            <div className="flex flex-wrap gap-1 mt-1">
              {paxCount > 0 && (
                <Badge variant="secondary" className="text-[10px] gap-1">
                  <Users className="h-3 w-3" /> {paxCount}
                </Badge>
              )}
              {flightCode && !delayed && <Badge variant="outline" className="text-[10px]">✈ {flightCode}</Badge>}
              {job.tracking_enabled && <Badge variant="outline" className="text-[10px]">Track</Badge>}
              {job.qr_strict_mode && <Badge variant="outline" className="text-[10px]">QR</Badge>}
              {job.deletion_requested_at && <Badge variant="destructive" className="text-[10px]">Delete pending</Badge>}
              {job.external && (
                <Badge variant="outline" className="text-[10px] border-primary/60 text-primary">
                  Partner: {job.executor_name}{job.external_driver_name ? ` · ${job.external_driver_name}` : ""}
                </Badge>
              )}
              {labels.map((l) => <LabelChip key={l.id} label={l} />)}
            </div>
          </div>
        </div>
      </button>

      {/* Top-right controls: drag (desktop) + menu */}
      <div className="absolute top-1.5 right-1 flex items-center gap-0.5">
        <button
          className="hidden sm:inline-flex text-muted-foreground p-1 touch-none"
          {...attributes} {...listeners}
          aria-label="Drag"
        >
          <GripVertical className="h-4 w-4" />
        </button>
        <TripMenu
          job={job} ctx={ctx}
          onOpenSplit={() => setOpenSplit(true)}
          onOpenClone={() => setOpenClone(true)}
          onOpenDispatch={() => setOpenDispatch(true)}
          driverName={shownDriver ?? undefined}
        />
      </div>

      <CloneDialog open={openClone} onOpenChange={setOpenClone} job={job} />
      <SplitDialog open={openSplit} onOpenChange={setOpenSplit} job={job} />
      <DispatchDialog open={openDispatch} onOpenChange={setOpenDispatch} job={job} />
    </div>
  );
}

function TripMenu({
  job, ctx, onOpenSplit, onOpenClone, onOpenDispatch, driverName,
}: {
  job: Job; ctx: CardCtx;
  onOpenSplit: () => void; onOpenClone: () => void; onOpenDispatch: () => void;
  driverName?: string;
}) {
  const requiresApproval = !!(job.driver_id && job.driver_accepted_at);
  const pending = !!job.deletion_requested_at;
  const qc = useQueryClient();
  const delFn = useServerFn(deleteJob);
  const cancelFn = useServerFn(cancelDeletionRequest);
  const delMut = useMutation({
    mutationFn: () => delFn({ data: { job_id: job.id } }),
    onSuccess: (res: { deleted: boolean; pending: boolean }) => {
      toast.success(res.pending ? "Deletion requested — awaiting driver approval" : "Deleted");
      qc.invalidateQueries({ queryKey: ["jobs"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const cancelMut = useMutation({
    mutationFn: () => cancelFn({ data: { job_id: job.id } }),
    onSuccess: () => { toast.success("Deletion cancelled"); qc.invalidateQueries({ queryKey: ["jobs"] }); },
    onError: (e: Error) => toast.error(e.message),
  });

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
        `👥 ${res.job.pax_count ?? (job.pax?.length ?? 0)} pax`,
      ];
      if (res.job.vehicle) lines.push(`🚙 ${res.job.vehicle}`);
      lines.push("", `Open your manifest: ${url}`);
      const text = encodeURIComponent(lines.join("\n"));
      window.open(`https://wa.me/?text=${text}`, "_blank", "noopener");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const copyMut = useMutation({
    mutationFn: () => shareFn({ data: { job_id: job.id } }) as Promise<any>,
    onSuccess: async (res: any) => {
      const url = `${window.location.origin}/m/driver/${res.token}`;
      try {
        await navigator.clipboard.writeText(url);
        toast.success("Link copied");
      } catch {
        const ta = document.createElement("textarea");
        ta.value = url; ta.style.position = "fixed"; ta.style.opacity = "0";
        document.body.appendChild(ta); ta.select();
        try { document.execCommand("copy"); toast.success("Link copied"); }
        catch { toast.error("Copy failed — " + url); }
        finally { document.body.removeChild(ta); }
      }
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="icon" variant="ghost" className="h-7 w-7" aria-label="Actions">
          <MoreVertical className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>Trip actions</DropdownMenuLabel>
        <DropdownMenuItem onClick={() => ctx.onPax(job)}>
          <Users className="h-4 w-4 mr-2" /> Passengers
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => ctx.onChat(job)}>
          <MessagesSquare className="h-4 w-4 mr-2" /> Chat
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <Users className="h-4 w-4 mr-2" /> Assign driver
          </DropdownMenuSubTrigger>
          <DropdownMenuPortal>
            <DropdownMenuSubContent className="max-h-72 overflow-y-auto w-56">
              <DropdownMenuItem onClick={() => ctx.onAssign(job, null)}>— Unassign —</DropdownMenuItem>
              <DropdownMenuSeparator />
              {ctx.drivers.length === 0 && (
                <div className="px-2 py-1.5 text-xs text-muted-foreground">No drivers</div>
              )}
              {ctx.drivers.map((d) => (
                <DropdownMenuItem key={d.id} onClick={() => ctx.onAssign(job, d.id)}>
                  {d.name}{d.vehicle ? ` · ${d.vehicle}` : ""}
                </DropdownMenuItem>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuPortal>
        </DropdownMenuSub>
        {job.driver_id && (
          <DropdownMenuItem onClick={() => shareMut.mutate()} disabled={shareMut.isPending}>
            <MessageCircle className="h-4 w-4 mr-2 text-emerald-600" /> Share on WhatsApp
          </DropdownMenuItem>
        )}
        {job.driver_id && (
          <DropdownMenuItem onClick={() => copyMut.mutate()} disabled={copyMut.isPending}>
            <Link2 className="h-4 w-4 mr-2" /> Copy link
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={onOpenSplit}>
          <Split className="h-4 w-4 mr-2" /> Split into vehicles
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onOpenClone}>
          <Copy className="h-4 w-4 mr-2" /> Clone…
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onOpenDispatch}>
          <Send className="h-4 w-4 mr-2" /> Dispatch to partner…
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {pending ? (
          <DropdownMenuItem
            onClick={() => { if (confirm("Cancel the pending deletion request?")) cancelMut.mutate(); }}
            className="text-amber-600"
          >
            <Trash2 className="h-4 w-4 mr-2" /> Cancel deletion request
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem
            onClick={() => {
              const msg = requiresApproval
                ? "Driver has accepted. Deletion will require their approval. Continue?"
                : "Delete this trip?";
              if (confirm(msg)) delMut.mutate();
            }}
            className="text-destructive focus:text-destructive"
          >
            <Trash2 className="h-4 w-4 mr-2" /> Delete trip
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/* ------------------------------ Dialogs ------------------------------ */

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

function DispatchDialog({ open, onOpenChange, job }: { open: boolean; onOpenChange: (v: boolean) => void; job: Job }) {
  const [partnerId, setPartnerId] = useState<string>("");
  const [note, setNote] = useState("");
  const qc = useQueryClient();
  const listConn = useServerFn(listConnections);
  const dispatchFn = useServerFn(dispatchJobToPartner);
  const conns = useQuery({ queryKey: ["collab", "connections"], queryFn: () => listConn(), enabled: open });
  const mut = useMutation({
    mutationFn: async () => await dispatchFn({ data: { job_id: job.id, partner_company_id: partnerId, note: note || undefined } }),
    onSuccess: () => { toast.success("Dispatched"); onOpenChange(false); qc.invalidateQueries({ queryKey: ["jobs"] }); qc.invalidateQueries({ queryKey: ["collab"] }); },
    onError: (e: any) => toast.error(e.message),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Dispatch to partner</DialogTitle>
          <DialogDescription>Send this trip to a connected coordinator. Costs 1 point.</DialogDescription></DialogHeader>
        <div className="space-y-3">
          {(conns.data ?? []).length === 0 && <p className="text-sm text-muted-foreground">No partners yet. Go to Collaborate to invite one.</p>}
          <div className="space-y-1">
            {(conns.data ?? []).filter((c: any) => c.status === "active").map((c: any) => (
              <label key={c.id} className="flex items-center gap-2 border rounded p-2 cursor-pointer">
                <input type="radio" name="partner" checked={partnerId === c.other.id} onChange={() => setPartnerId(c.other.id)} />
                <span className="font-medium">{c.other?.name}</span>
                <Badge variant="outline" className="ml-auto">{c.mode}</Badge>
              </label>
            ))}
          </div>
          <div>
            <Label>Note (optional)</Label>
            <Input value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button disabled={!partnerId || mut.isPending} onClick={() => mut.mutate()}>Dispatch</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
