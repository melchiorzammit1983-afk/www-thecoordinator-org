import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useRef, useState } from "react";
import { DndContext, useDraggable, useDroppable, type DragEndEvent, PointerSensor, useSensor, useSensors } from "@dnd-kit/core";
import { format, addDays, startOfWeek } from "date-fns";
import { toast } from "sonner";
import {
  Plus, Copy, Split, GripVertical, Calendar as CalIcon, Trash2, MessageCircle,
  Users, MessagesSquare, MoreVertical, ChevronDown, ChevronRight, Inbox,
  Pencil, Sparkles, Link2, Unlink,
} from "lucide-react";


import {
  listJobs, listDrivers, assignDriver, cloneJob, splitJob, deleteJob, cancelDeletionRequest,
  checkFlightStatus, shareJobToDriver, getUnreadCountsCoord, getClientPresenceCoord, listActiveDriverLocations,
  getCardSignalsCoord, markJobViewedCoord,
  ungroupJobs, groupJobs, shareGroupToDriver, getClientTripLink,
  listActiveSosPoints, acknowledgeSosCoord, acknowledgeAllSosForJob,
  approveClientJob, rejectClientJob,

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
import { DriverLiveMap, type LivePoint } from "@/components/coordinator/DriverLiveMap";
import { AutoRefreshToggle } from "@/components/coordinator/AutoRefreshToggle";
import { supabase } from "@/integrations/supabase/client";
import { Checkbox } from "@/components/ui/checkbox";
import { BulkActionBar } from "@/components/coordinator/BulkActionBar";
import { GroupDialog } from "@/components/coordinator/GroupDialog";
import { useFeature } from "@/hooks/use-features";


export const Route = createFileRoute("/_authenticated/coordinator/calendar")({
  head: () => ({ meta: [{ title: "Dispatch — Coordinator" }] }),
  component: CalendarPage,
});

/* --- module-scope helpers used by CalendarPage effects --- */
let _audioCtx: AudioContext | null = null;
function playAlertBeep(freq = 880, durationSec = 0.3) {
  if (typeof window === "undefined") return;
  const Ctor = (window.AudioContext || (window as any).webkitAudioContext) as typeof AudioContext | undefined;
  if (!Ctor) return;
  if (!_audioCtx) _audioCtx = new Ctor();
  const ctx = _audioCtx;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "sine"; osc.frequency.value = freq;
  gain.gain.setValueAtTime(0.0001, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + durationSec);
  osc.connect(gain).connect(ctx.destination);
  osc.start();
  osc.stop(ctx.currentTime + durationSec + 0.02);
}
function scrollToJob(jobId: string) {
  if (typeof document === "undefined") return;
  const el = document.querySelector<HTMLElement>(`[data-job-id="${jobId}"]`);
  if (!el) return;
  el.scrollIntoView({ behavior: "smooth", block: "center" });
  el.classList.add("ring-2", "ring-primary");
  setTimeout(() => el.classList.remove("ring-2", "ring-primary"), 2500);
}

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
  contact_phone: string | null;
  clientcompanyname: string | null;
  driver_accepted_at: string | null;
  deletion_requested_at: string | null;
  drivers?: { name: string; vehicle?: string | null; phone?: string | null; seats_available?: number | null; availability_note?: string | null } | null;
  pax?: { id: string; name: string; status?: string | null; boarded_at?: string | null }[];
  labels?: TLabel[];
  external?: boolean;
  chain_role?: "executor" | "creator_watching" | "hop_watching";
  executor_name?: string | null;
  origin_name?: string | null;
  external_driver_name?: string | null;
  payment_status?: string | null;
  grouped_count?: number | null;
  grouped_at?: string | null;
  group_id?: string | null;
  group_name?: string | null;
  group_note?: string | null;
  client_confirmed_at?: string | null;
  source?: string | null;
  coord_approved_at?: string | null;
  parent_job_id?: string | null;
  chain_names?: string[];
  dispatch_status?: string | null;
  dispatch_chain_company_ids?: string[] | null;
  executor_company_id?: string | null;
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
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [editGroup, setEditGroup] = useState<{ groupId: string; jobs: Job[] } | null>(null);
  const [alertsOnly, setAlertsOnly] = useState(false);
  const qc = useQueryClient();
  const clientPortalEnabled = useFeature("client_trip_portal");


  const toggleExpandedGroup = (gid: string) => setExpandedGroups((s) => {
    const n = new Set(s); if (n.has(gid)) n.delete(gid); else n.add(gid); return n;
  });

  const toggleSelect = (id: string) => setSelected((s) => {
    const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n;
  });
  const clearSelect = () => setSelected(new Set());


  const unreadFn = useServerFn(getUnreadCountsCoord);
  const { data: unreadByJob } = useQuery({
    queryKey: ["coord-unread"],
    queryFn: () => unreadFn() as Promise<Record<string, { driver: number; client: number; total: number }>>,
    refetchInterval: 15_000,
  });
  const presenceFn = useServerFn(getClientPresenceCoord);
  const [presenceJobIds, setPresenceJobIds] = useState<string[]>([]);
  const { data: clientPresence } = useQuery({
    queryKey: ["coord-client-presence", presenceJobIds.join(",")],
    enabled: presenceJobIds.length > 0,
    queryFn: () => presenceFn({ data: { job_ids: presenceJobIds } }) as Promise<Record<string, string>>,
    refetchInterval: 20_000,
  });
  const signalsFn = useServerFn(getCardSignalsCoord);
  const { data: cardSignals } = useQuery({
    queryKey: ["coord-card-signals", presenceJobIds.join(",")],
    enabled: presenceJobIds.length > 0,
    queryFn: () => signalsFn({ data: { job_ids: presenceJobIds } }) as Promise<Record<string, {
      unread_client: number; unread_driver: number;
      client_change: boolean; sos_open: boolean; driver_status_new: boolean; rejected: boolean;
    }>>,

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

  useEffect(() => {
    const ids = (jobs ?? []).map((j) => j.id);
    setPresenceJobIds((prev) => (prev.length === ids.length && prev.every((v, i) => v === ids[i]) ? prev : ids));
  }, [jobs]);

  // Track prior signals to detect NEW SOS / client-change transitions.
  const prevSignalsRef = useRef<Record<string, { sos_open: boolean; client_change: boolean; rejected: boolean }>>({});
  const firstSignalsRun = useRef(true);
  useEffect(() => {
    if (!cardSignals) return;
    const prev = prevSignalsRef.current;
    if (firstSignalsRun.current) {
      const seed: typeof prev = {};
      for (const [id, s] of Object.entries(cardSignals)) seed[id] = { sos_open: !!s.sos_open, client_change: !!s.client_change, rejected: !!(s as any).rejected };
      prevSignalsRef.current = seed;
      firstSignalsRun.current = false;
      return;
    }
    for (const [id, s] of Object.entries(cardSignals)) {
      const p = prev[id] ?? { sos_open: false, client_change: false, rejected: false };
      if (s.sos_open && !p.sos_open) {
        try { playAlertBeep(880, 0.35); setTimeout(() => playAlertBeep(660, 0.35), 200); } catch { /* ignore */ }
        const j = (jobs ?? []).find((x) => x.id === id);
        toast.error(`🆘 SOS from client${j ? ` · ${j.from_location} → ${j.to_location}` : ""}`, {
          action: j ? { label: "Open", onClick: () => { scrollToJob(id); setDetailsJob(j); } } : undefined,
          duration: 15000,
          description: "Open the trip to see who pressed SOS and dismiss the alert.",
        });
        scrollToJob(id);

      } else if (s.client_change && !p.client_change) {
        try { playAlertBeep(520, 0.15); } catch { /* ignore */ }
        const j = (jobs ?? []).find((x) => x.id === id);
        toast.warning(`Client requested a change${j ? ` · ${j.from_location} → ${j.to_location}` : ""}`, {
          action: j ? { label: "Open", onClick: () => { scrollToJob(id); setDetailsJob(j); } } : undefined,
          duration: 8000,
        });
        scrollToJob(id);
      } else if ((s as any).rejected && !p.rejected) {
        try { playAlertBeep(440, 0.25); setTimeout(() => playAlertBeep(330, 0.25), 180); } catch { /* ignore */ }
        const j = (jobs ?? []).find((x) => x.id === id);
        toast.warning(`⚠️ Driver rejected a trip${j ? ` · ${j.from_location} → ${j.to_location}` : ""}`, {
          action: j ? { label: "Open", onClick: () => { scrollToJob(id); setChatJob(j); } } : undefined,
          duration: 12000,
          description: "The trip is back in Unassigned. Check the chat for the reason.",
        });
        scrollToJob(id);
      }
      prev[id] = { sos_open: !!s.sos_open, client_change: !!s.client_change, rejected: !!(s as any).rejected };
    }
  }, [cardSignals, jobs]);

  function onDragEnd(e: DragEndEvent) {
    const rawId = String(e.active.id);
    const dropId = e.over?.id ? String(e.over.id) : null;
    if (!dropId) return;

    const driverId = dropId === "unassigned" ? null : dropId.startsWith("driver:") ? dropId.slice(7) : undefined;
    if (driverId === undefined) return;
    if (rawId.startsWith("group:")) {
      const gid = rawId.slice(6);
      const memberIds = (jobs ?? []).filter((j) => j.group_id === gid).map((j) => j.id);
      for (const id of memberIds) assignMut.mutate({ job_id: id, driver_id: driverId });
    } else {
      if (rawId.includes("::hop-")) return; // synthetic
      assignMut.mutate({ job_id: rawId, driver_id: driverId });
    }
  }



  const markViewedFn = useServerFn(markJobViewedCoord);
  const handleMarkViewed = (id: string) => {
    markViewedFn({ data: { job_id: id } }).catch(() => { /* ignore */ });
    qc.setQueryData<any>(["coord-card-signals", presenceJobIds.join(",")], (prev: any) => {
      if (!prev || !prev[id]) return prev;
      return { ...prev, [id]: { ...prev[id], driver_status_new: false } };
    });
  };
  const hasAlert = (jobId: string) => {
    const s = cardSignals?.[jobId];
    if (!s) return false;
    return (s.unread_client + s.unread_driver) > 0 || s.client_change || s.sos_open || s.driver_status_new || (s as any).rejected;
  };

  const isPendingClient = (j: Job) =>
    !j.external && !j.coord_approved_at && (j.source ?? "").startsWith("client");
  const visibleAll = alertsOnly ? (jobs ?? []).filter((j) => hasAlert(j.id)) : (jobs ?? []);
  const pendingClientJobs = visibleAll.filter(isPendingClient);
  const visibleJobs = visibleAll.filter((j) => !isPendingClient(j));
  const unassigned = visibleJobs.filter((j) => !j.driver_id);

  const cardCtx: CardCtx = {
    onEdit: setEditJob, onPax: setPaxJob, onChat: setChatJob,
    onOpenDetails: (j) => { handleMarkViewed(j.id); setDetailsJob(j); },
    onAssign: (job, driverId) => assignMut.mutate({ job_id: job.id, driver_id: driverId }),
    drivers: drivers ?? [],
    unread: unreadByJob ?? {},
    highlightId: justAcceptedId,
    selected, onToggleSelect: toggleSelect,
    expandedGroups, onToggleExpandedGroup: toggleExpandedGroup,
    onEditGroup: (groupId, memberJobs) => setEditGroup({ groupId, jobs: memberJobs }),
    clientPortalEnabled,
    clientPresence: clientPresence ?? {},
    signals: cardSignals ?? {},
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
        <div className="flex justify-end items-center gap-2">
          <button
            type="button"
            onClick={() => setAlertsOnly((v) => !v)}
            className={`px-2.5 py-1 rounded-full border text-[11px] transition-colors ${
              alertsOnly
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-background text-muted-foreground hover:text-foreground"
            }`}
            title="Show only cards with unread messages, client changes, or SOS"
          >
            {alertsOnly ? "● " : ""}Only cards with alerts
          </button>
          <AutoRefreshToggle jobs={jobs ?? []} />
        </div>
      </header>

      {/* Live driver map */}
      <LiveMapPanel />

      {/* Client-requested trips awaiting coordinator approval */}
      <PendingClientApprovalBoard jobs={pendingClientJobs} ctx={cardCtx} onChanged={() => refetch()} />


      <DndContext sensors={sensors} onDragEnd={onDragEnd}>
        <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-3">
          <UnassignedColumn jobs={unassigned} ctx={cardCtx} />
          {view === "day"
            ? <DriverLanes drivers={drivers ?? []} jobs={visibleJobs} ctx={cardCtx} />
            : <WeekGrid drivers={drivers ?? []} jobs={visibleJobs} days={range.days} ctx={cardCtx} />}
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

      {editGroup && (
        <GroupDialog
          mode="edit"
          open={!!editGroup}
          onOpenChange={(v) => !v && setEditGroup(null)}
          groupId={editGroup.groupId}
          jobs={editGroup.jobs}
          drivers={drivers ?? []}
          initialName={editGroup.jobs.find((j) => j.group_name)?.group_name ?? ""}
          initialNote={editGroup.jobs.find((j) => j.group_note)?.group_note ?? ""}
          initialDriverId={editGroup.jobs.find((j) => j.driver_id)?.driver_id ?? null}
          onDone={() => setEditGroup(null)}
        />
      )}

      {selected.size > 0 && (
        <>
          <div aria-hidden className="h-16" />
          <BulkActionBar
            jobs={(jobs ?? []).filter((j) => selected.has(j.id))}
            drivers={drivers ?? []}
            onClear={clearSelect}
          />
        </>
      )}
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
  unread: Record<string, { driver: number; client: number; total: number }>;
  highlightId?: string | null;
  selected: Set<string>;
  onToggleSelect: (id: string) => void;
  expandedGroups: Set<string>;
  onToggleExpandedGroup: (gid: string) => void;
  onEditGroup: (groupId: string, jobs: Job[]) => void;
  clientPortalEnabled: boolean;
  clientPresence?: Record<string, string>;
  signals?: Record<string, {
    unread_client: number; unread_driver: number;
    client_change: boolean; sos_open: boolean; driver_status_new: boolean; rejected?: boolean;
  }>;

};

/* --- deterministic per-group hue for a colored stripe --- */
function groupHue(gid: string): number {
  let h = 0;
  for (let i = 0; i < gid.length; i++) h = (h * 31 + gid.charCodeAt(i)) >>> 0;
  return h % 360;
}
function groupStripeStyle(gid: string | null | undefined): React.CSSProperties | undefined {
  if (!gid) return undefined;
  return { boxShadow: `inset 4px 0 0 hsl(${groupHue(gid)} 70% 50%)` };
}


/* ------------------------------ Grouping helpers ------------------------------ */

type RenderItem =
  | { kind: "single"; job: Job }
  | { kind: "group"; group_id: string; jobs: Job[] };

function bucketByGroup(jobs: Job[]): RenderItem[] {
  const groups = new Map<string, Job[]>();
  for (const j of jobs) if (j.group_id) {
    const a = groups.get(j.group_id) ?? []; a.push(j); groups.set(j.group_id, a);
  }
  const items: RenderItem[] = [];
  const seen = new Set<string>();
  for (const j of jobs) {
    if (j.group_id) {
      if (seen.has(j.group_id)) continue;
      seen.add(j.group_id);
      const arr = groups.get(j.group_id)!;
      if (arr.length < 2) items.push({ kind: "single", job: arr[0] });
      else items.push({
        kind: "group",
        group_id: j.group_id,
        jobs: [...arr].sort((a, b) => ((a.date ?? "") + (a.time ?? "")).localeCompare((b.date ?? "") + (b.time ?? ""))),
      });
    } else {
      items.push({ kind: "single", job: j });
    }
  }
  return items;
}

function renderItems(items: RenderItem[], ctx: CardCtx, driverNameOf?: (j: Job) => string | undefined) {
  return items.map((it) =>
    it.kind === "single"
      ? <TripCard key={it.job.id} job={it.job} ctx={ctx} driverName={driverNameOf?.(it.job)} />
      : <GroupedStackCard key={it.group_id} groupId={it.group_id} jobs={it.jobs} ctx={ctx} driverNameOf={driverNameOf} />,
  );
}



/* ---------- Pending Client Approval ---------- */
function PendingClientApprovalBoard({ jobs, ctx: _ctx, onChanged }: { jobs: Job[]; ctx: CardCtx; onChanged: () => void }) {
  const approveFn = useServerFn(approveClientJob);
  const rejectFn = useServerFn(rejectClientJob);
  const [busy, setBusy] = useState<string | null>(null);

  if (jobs.length === 0) return null;

  async function approve(id: string) {
    setBusy(id);
    try {
      await approveFn({ data: { job_id: id } });
      toast.success("Trip approved — moved to Unassigned");
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to approve");
    } finally { setBusy(null); }
  }
  async function reject(id: string) {
    if (!confirm("Reject this client-requested trip? It will be deleted.")) return;
    setBusy(id);
    try {
      await rejectFn({ data: { job_id: id } });
      toast.success("Trip rejected");
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to reject");
    } finally { setBusy(null); }
  }

  return (
    <section className="rounded-lg border-2 border-amber-400/60 bg-amber-50/60 dark:bg-amber-950/20 p-3 space-y-2">
      <div className="flex items-center gap-2 text-sm font-semibold text-amber-900 dark:text-amber-200">
        <Inbox className="h-4 w-4" /> Client requests awaiting approval ({jobs.length})
      </div>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {jobs.map((j) => {
          const paxLine = (j.pax ?? []).map((p) => p.name).filter(Boolean).join(", ");
          return (
            <div key={j.id} className="rounded-md border bg-card p-2.5 space-y-1.5 text-xs">
              <div className="flex items-center justify-between gap-2">
                <div className="font-medium truncate">{j.from_location} → {j.to_location}</div>
                <Badge variant="outline" className="shrink-0 text-[10px]">
                  {j.source === "client_followup" ? "Follow-up" : "Client"}
                </Badge>
              </div>
              <div className="text-muted-foreground">
                {j.date} · {j.time?.slice(0,5)}
                {(j.pax?.length ?? 0) > 0 && <> · {j.pax!.length} pax</>}
              </div>
              {paxLine && <div className="truncate text-muted-foreground">{paxLine}</div>}
              {j.clientcompanyname && <div className="truncate text-muted-foreground">Client: {j.clientcompanyname}</div>}
              <div className="flex gap-1.5 pt-1">
                <Button size="sm" className="flex-1 h-7" disabled={busy === j.id} onClick={() => approve(j.id)}>
                  Approve
                </Button>
                <Button size="sm" variant="outline" className="flex-1 h-7" disabled={busy === j.id} onClick={() => reject(j.id)}>
                  Reject
                </Button>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

/* ------------------------------ Columns ------------------------------ */



function UnassignedColumn({ jobs, ctx }: { jobs: Job[]; ctx: CardCtx }) {
  const { setNodeRef, isOver } = useDroppable({ id: "unassigned" });
  const items = bucketByGroup(jobs);
  const suggestionsEnabled = useFeature("ai_group_suggestions");
  const suggestions = useMemo(
    () => (suggestionsEnabled ? suggestGroups(jobs) : []),
    [jobs, suggestionsEnabled],
  );
  return (
    <div ref={setNodeRef} className={`rounded-lg border bg-card p-3 min-h-[220px] ${isOver ? "ring-2 ring-primary" : ""}`}>
      <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
        Unassigned ({jobs.length})
      </div>
      {suggestionsEnabled && suggestions.length > 0 && (
        <div className="mb-2 rounded-md border border-primary/40 bg-primary/5 p-2 space-y-1.5">
          <div className="text-[11px] font-semibold text-primary flex items-center gap-1">
            <Sparkles className="h-3 w-3" /> Auto-group suggestions
          </div>
          {suggestions.slice(0, 3).map((s, i) => (
            <div key={i} className="flex items-center gap-2 text-[11px]">
              <span className="truncate flex-1">
                <span className="font-medium">{s.jobs.length} trips</span>{" "}
                · {s.label}
              </span>
              <button
                className="text-primary hover:underline shrink-0"
                onClick={() => {
                  for (const j of s.jobs) if (!ctx.selected.has(j.id)) ctx.onToggleSelect(j.id);
                  toast.success(`Selected ${s.jobs.length} trips — tap "Group" in the bar`);
                }}
              >
                Select
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="space-y-2">
        {jobs.length === 0 && <div className="text-xs text-muted-foreground py-6 text-center">Everything is assigned</div>}
        {renderItems(items, ctx)}
      </div>
    </div>
  );
}

/* Suggest groups from ungrouped jobs sharing date+from+to within a 60-min window. */
function suggestGroups(jobs: Job[]): { label: string; jobs: Job[] }[] {
  const eligible = jobs.filter((j) => !j.group_id);
  const buckets = new Map<string, Job[]>();
  for (const j of eligible) {
    const key = `${j.date}|${(j.from_location ?? "").toLowerCase().trim()}|${(j.to_location ?? "").toLowerCase().trim()}`;
    const arr = buckets.get(key) ?? [];
    arr.push(j);
    buckets.set(key, arr);
  }
  const out: { label: string; jobs: Job[] }[] = [];
  for (const [, arr] of buckets) {
    if (arr.length < 2) continue;
    const sorted = [...arr].sort((a, b) => (a.time ?? "").localeCompare(b.time ?? ""));
    // Cluster ones within 60 min of each other
    let cluster: Job[] = [sorted[0]];
    const flush = () => {
      if (cluster.length >= 2) {
        const first = cluster[0];
        out.push({
          label: `${first.date} · ${first.from_location} → ${first.to_location} (${cluster[0].time?.slice(0,5)}–${cluster[cluster.length-1].time?.slice(0,5)})`,
          jobs: [...cluster],
        });
      }
      cluster = [];
    };
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1].time ?? "00:00";
      const cur = sorted[i].time ?? "00:00";
      const diff = minutesBetween(prev, cur);
      if (diff <= 60) cluster.push(sorted[i]);
      else { flush(); cluster = [sorted[i]]; }
    }
    flush();
  }
  return out;
}

function partnerColor(id: string | null | undefined): string {
  if (!id) return "hsl(38 92% 50%)";
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return `hsl(${h % 360} 78% 48%)`;
}


function minutesBetween(a: string, b: string): number {
  const [ah, am] = a.split(":").map(Number);
  const [bh, bm] = b.split(":").map(Number);
  return Math.abs((bh * 60 + (bm || 0)) - (ah * 60 + (am || 0)));
}


function DriverLanes({ drivers, jobs, ctx }: { drivers: Driver[]; jobs: Job[]; ctx: CardCtx }) {
  return (
    <div className="rounded-lg border bg-card p-3 overflow-x-auto">
      <div className="grid gap-3 sm:auto-cols-[minmax(240px,1fr)] sm:grid-flow-col">
        {drivers.length === 0 && (
          <div className="text-sm text-muted-foreground p-8 text-center">Add drivers to see lanes.</div>
        )}
        {drivers.map((d) => (
          <DriverLane key={d.id} driver={d} jobs={jobs.filter((j) => j.driver_id === d.id && !(j as any)._origin_job_id)} ctx={ctx} />
        ))}
      </div>
    </div>
  );
}


function DriverLane({ driver, jobs, ctx }: { driver: Driver; jobs: Job[]; ctx: CardCtx }) {
  const { setNodeRef, isOver } = useDroppable({ id: `driver:${driver.id}` });
  const items = bucketByGroup(jobs);
  return (
    <div ref={setNodeRef} className={`rounded-md border p-2 min-h-[220px] ${isOver ? "ring-2 ring-primary bg-primary/5" : ""}`}>
      <div className="text-sm font-medium truncate">{driver.name}</div>
      <div className="text-xs text-muted-foreground mb-2 truncate">{driver.vehicle ?? "—"}</div>
      <div className="space-y-2">
        {renderItems(items, ctx)}
      </div>
    </div>
  );
}

function WeekGrid({ drivers, jobs, days, ctx }: { drivers: Driver[]; jobs: Job[]; days: Date[]; ctx: CardCtx }) {
  const driverName = (j: Job) => drivers.find((dr) => dr.id === j.driver_id)?.name;
  return (
    <div className="rounded-lg border bg-card p-3 overflow-x-auto">
      <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(7, minmax(180px, 1fr))` }}>
        {days.map((d) => {
          const key = format(d, "yyyy-MM-dd");
          const dayJobs = jobs.filter((j) => j.date === key);
          const items = bucketByGroup(dayJobs);
          return (
            <div key={key} className="rounded-md border p-2 min-h-[220px]">
              <div className="text-sm font-medium">{format(d, "EEE")}</div>
              <div className="text-xs text-muted-foreground mb-2">{format(d, "d MMM")}</div>
              <div className="space-y-2">
                {renderItems(items, ctx, driverName)}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ------------------------------ Grouped stack card ------------------------------ */

function GroupedStackCard({
  groupId, jobs, ctx, driverNameOf,
}: {
  groupId: string;
  jobs: Job[];
  ctx: CardCtx;
  driverNameOf?: (j: Job) => string | undefined;
}) {
  const expanded = ctx.expandedGroups.has(groupId);
  const first = jobs[0];
  const groupName = jobs.find((j) => j.group_name)?.group_name || null;
  const groupNote = jobs.find((j) => j.group_note)?.group_note || null;

  const totalPax = jobs.reduce((n, j) => n + (j.pax?.length ?? 0), 0);
  const anyProblem = jobs.some((j) => {
    const fi = j.flight_status === "delayed" || j.flight_status === "cancelled" || j.flight_status === "time_mismatch";
    return fi || !!j.deletion_requested_at;
  });
  const allAccepted = jobs.every((j) => !!j.driver_id && !!j.driver_accepted_at);
  const anyAssigned = jobs.some((j) => !!j.driver_id);

  const tone = anyProblem
    ? "border-destructive bg-destructive/10"
    : allAccepted
    ? "border-emerald-500/70 bg-emerald-500/5"
    : anyAssigned
    ? "border-amber-500/70 bg-amber-500/5"
    : "border-border bg-background";

  const allSelected = jobs.every((j) => ctx.selected.has(j.id));
  const someSelected = !allSelected && jobs.some((j) => ctx.selected.has(j.id));

  const toggleAll = () => {
    // If any not selected → select all; else deselect all.
    const shouldSelect = !allSelected;
    for (const j of jobs) {
      const isSel = ctx.selected.has(j.id);
      if (shouldSelect && !isSel) ctx.onToggleSelect(j.id);
      if (!shouldSelect && isSel) ctx.onToggleSelect(j.id);
    }
  };

  const driverNames = Array.from(
    new Set(jobs.map((j) => driverNameOf?.(j) ?? j.drivers?.name).filter(Boolean) as string[]),
  );

  const stripe = groupStripeStyle(groupId);

  const shareGroupFn = useServerFn(shareGroupToDriver);
  const shareGroupMut = useMutation({
    mutationFn: () => shareGroupFn({ data: { group_id: groupId } }) as Promise<any>,
    onSuccess: (res: any) => {
      const url = `${window.location.origin}/m/driver/${res.token}`;
      const lines: string[] = [];
      lines.push(`🚐 Group assignment${res.driver_name ? ` — ${res.driver_name}` : ""}`);
      if (res.group_name) lines.push(`📎 ${res.group_name}`);
      lines.push(`🧾 ${res.jobs.length} trips · ${res.total_pax} pax total`);
      lines.push("");
      for (const j of res.jobs) {
        const when = j.pickup_at
          ? new Date(j.pickup_at).toLocaleString([], { month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" })
          : `${j.date} ${j.time?.slice(0, 5) ?? ""}`;
        const from = [j.from_location, j.from_flight].filter(Boolean).join(" ");
        const to = [j.to_location, j.to_flight].filter(Boolean).join(" ");
        lines.push(`• ${when} — ${from} → ${to} (${j.pax_count}p)`);
      }
      if (res.group_note) { lines.push(""); lines.push(`📝 ${res.group_note}`); }
      lines.push("", `Open manifest: ${url}`);
      window.open(`https://wa.me/?text=${encodeURIComponent(lines.join("\n"))}`, "_blank", "noopener");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Drag whole stack (only when collapsed)
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `group:${groupId}`,
    disabled: expanded,
  });
  const dragStyle: React.CSSProperties = transform
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`, opacity: isDragging ? 0.7 : 1 }
    : {};

  if (expanded) {
    return (
      <div className={`rounded-md border-2 p-2 space-y-2 ${tone}`} style={stripe}>
        <div className="flex items-center gap-2 flex-wrap">
          <Checkbox
            checked={allSelected ? true : someSelected ? "indeterminate" : false}
            onCheckedChange={toggleAll}
            aria-label="Select group"
          />
          <div className="text-[11px] uppercase tracking-wide font-semibold text-primary flex items-center gap-1 min-w-0">
            <Link2 className="h-3 w-3 shrink-0" />
            <span className="truncate">{groupName || "Grouped"} · {jobs.length}</span>
          </div>
          <div className="ml-auto flex items-center gap-1">
            <Button
              size="sm" variant="ghost" className="h-7 px-2 text-[11px]"
              onClick={() => ctx.onEditGroup(groupId, jobs)}
              title="Edit group name, note, driver"
            >
              <Pencil className="h-3.5 w-3.5 mr-1" /> Edit
            </Button>
            {jobs.every((j) => j.driver_id === jobs[0].driver_id) && jobs[0].driver_id && (
              <Button
                size="sm" variant="ghost" className="h-7 px-2 text-[11px] text-emerald-600"
                onClick={() => shareGroupMut.mutate()} disabled={shareGroupMut.isPending}
                title="Share whole group on WhatsApp"
              >
                <MessageCircle className="h-3.5 w-3.5 mr-1" /> WhatsApp
              </Button>
            )}
            <button
              className="text-[11px] text-muted-foreground hover:text-foreground underline px-1"
              onClick={() => ctx.onToggleExpandedGroup(groupId)}
            >
              Collapse
            </button>
          </div>
        </div>
        {groupNote && (
          <div className="text-[11px] text-muted-foreground italic px-1">{groupNote}</div>
        )}
        <div className="space-y-2">
          {jobs.map((j) => <TripCard key={j.id} job={j} ctx={ctx} driverName={driverNameOf?.(j)} />)}
        </div>
      </div>
    );
  }

  // Collapsed stack — layered look, draggable
  return (
    <div ref={setNodeRef} style={dragStyle} className="relative">
      {/* Fanned back layers */}
      {jobs.length >= 3 && (
        <div className={`absolute inset-x-2 -bottom-1.5 h-3 rounded-md border-2 ${tone} opacity-40`} />
      )}
      {jobs.length >= 2 && (
        <div className={`absolute inset-x-1 -bottom-0.5 h-3 rounded-md border-2 ${tone} opacity-70`} />
      )}
      <div className={`relative rounded-md border-2 pl-8 pr-1 py-2 shadow-sm ${tone}`} style={stripe}>
        {/* Checkbox */}
        <div className="absolute top-2 left-2 z-10" onClick={(e) => e.stopPropagation()}>
          <Checkbox
            checked={allSelected ? true : someSelected ? "indeterminate" : false}
            onCheckedChange={toggleAll}
            aria-label="Select group"
          />
        </div>
        {/* Drag handle */}
        <button
          className="absolute top-1.5 right-1 text-muted-foreground p-1 touch-none hidden sm:inline-flex"
          {...attributes} {...listeners}
          aria-label="Drag group"
          onClick={(e) => e.stopPropagation()}
        >
          <GripVertical className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() => ctx.onToggleExpandedGroup(groupId)}
          className="w-full text-left pr-6"
        >
          <div className="flex items-center gap-2 text-[11px] text-primary font-semibold uppercase tracking-wide">
            <Link2 className="h-3 w-3" />
            <span className="truncate">{groupName || "Grouped"}</span>
            <Badge variant="secondary" className="ml-auto text-[10px]">{jobs.length} trips · {totalPax} pax</Badge>
          </div>
          {driverNames.length > 0 && (
            <div className="text-[11px] mt-0.5 truncate">
              <span className="text-muted-foreground">Driver:</span>{" "}
              <span className="font-medium">{driverNames.join(", ")}</span>
            </div>
          )}
          <div className="mt-1 space-y-0.5">
            {jobs.slice(0, 4).map((j) => (
              <div key={j.id} className="flex items-center gap-1.5 text-[12px] min-w-0">
                <span className="font-semibold w-10 shrink-0">{j.time?.slice(0, 5)}</span>
                <span className="truncate">
                  {j.from_location} <span className="text-muted-foreground">→</span> {j.to_location}
                </span>
                <span className="ml-auto text-[10px] text-muted-foreground shrink-0">
                  {j.pax?.length ?? 0}p
                </span>
              </div>
            ))}
            {jobs.length > 4 && (
              <div className="text-[10px] text-muted-foreground">+ {jobs.length - 4} more…</div>
            )}
          </div>
          {groupNote && (
            <div className="text-[11px] text-muted-foreground italic mt-1 truncate">{groupNote}</div>
          )}
          <div className="text-[10px] text-primary/70 mt-1">Tap to expand · drag to assign</div>
        </button>
      </div>
    </div>
  );
}

/* ---------- Collapsed strip for completed / cancelled trips ---------- */
function CompletedStrip({
  job, ctx, driverName, isSelected,
}: { job: Job; ctx: CardCtx; driverName?: string; isSelected: boolean }) {
  const cancelled = job.status === "cancelled";
  const paxCount = job.pax?.length ?? 0;
  return (
    <div
      className={`relative flex items-center gap-2 rounded-md border px-2 py-1 text-[11px] transition-colors ${
        cancelled
          ? "border-muted bg-muted/30 text-muted-foreground line-through"
          : "border-emerald-500/30 bg-emerald-500/5 text-muted-foreground"
      } ${isSelected ? "ring-2 ring-primary" : ""}`}
    >
      <div onClick={(e) => e.stopPropagation()}>
        <Checkbox
          checked={isSelected}
          onCheckedChange={() => ctx.onToggleSelect(job.id)}
          aria-label="Select trip"
        />
      </div>
      <button
        type="button"
        onClick={() => ctx.onOpenDetails(job)}
        className="flex-1 flex items-center gap-2 min-w-0 text-left"
        title={cancelled ? "Cancelled" : "Completed"}
      >
        <span className="font-medium text-foreground">{job.time?.slice(0,5)}</span>
        <span className="truncate">
          {job.from_location} → {job.to_location}
        </span>
        {driverName && <span className="ml-auto truncate">· {driverName}</span>}
        {paxCount > 0 && (
          <span className="inline-flex items-center gap-0.5 shrink-0">
            <Users className="h-3 w-3" /> {paxCount}
          </span>
        )}
        <Badge variant="outline" className="text-[9px] py-0 px-1 shrink-0">
          {cancelled ? "Cancelled" : "Done"}
        </Badge>
      </button>
    </div>
  );
}



/* ------------------------------ Trip card ------------------------------ */

function TripCard({ job, ctx, driverName }: { job: Job; ctx: CardCtx; driverName?: string }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: job.id });
  const [openClone, setOpenClone] = useState(false);
  const [openSplit, setOpenSplit] = useState(false);

  const paxCount = job.pax?.length ?? 0;
  const unreadCounts = ctx.unread[job.id] ?? { driver: 0, client: 0, total: 0 };
  const unread = unreadCounts.total;
  const flightIssue = job.flight_status === "delayed" || job.flight_status === "cancelled" || job.flight_status === "time_mismatch";
  const problem = flightIssue || !!job.deletion_requested_at;
  const assignedAccepted = !!job.driver_id && !!job.driver_accepted_at;
  const assignedPending = !!job.driver_id && !job.driver_accepted_at;

  const sig = ctx.signals?.[job.id];
  const isFinished = job.status === "completed" || job.status === "cancelled";
  const hasUnread = (sig?.unread_client ?? 0) + (sig?.unread_driver ?? 0) > 0;
  const clientChange = !!sig?.client_change;
  const sosOpen = !!sig?.sos_open;
  const driverStatusNew = !!sig?.driver_status_new;
  const rejected = !!(sig as any)?.rejected;


  // Partnership state: amber = handed off & pending, green = partner accepted, red = partner rejected.
  const partnerPending = (job.chain_role === "creator_watching" || job.chain_role === "hop_watching") && job.dispatch_status === "pending";
  const partnerRejected = job.dispatch_status === "rejected";
  const partnerAccepted = (job.chain_role === "creator_watching" || job.chain_role === "hop_watching") && job.dispatch_status === "accepted";

  // Color priority: red > blue(unread) > partner state > driver-accepted > driver-pending > default
  const tone = problem || partnerRejected
    ? "border-destructive bg-destructive/10"
    : unread > 0 || hasUnread
    ? "border-blue-500 bg-blue-500/10 ring-1 ring-blue-500/40"
    : partnerPending
    ? "border-amber-500 bg-amber-500/10 ring-1 ring-amber-500/30"
    : partnerAccepted
    ? "border-emerald-500/70 bg-emerald-500/5"
    : assignedAccepted
    ? "border-emerald-500/70 bg-emerald-500/5"
    : assignedPending
    ? "border-amber-500/70 bg-amber-500/5"
    : "border-border bg-background";

  // Colored left rim shows which partner currently holds the trip (creator's-eye view).
  const rimColor = (job.chain_role === "creator_watching" || job.chain_role === "hop_watching") && job.executor_company_id
    ? partnerColor(job.executor_company_id)
    : null;


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

  const isSelected = ctx.selected.has(job.id);

  // Collapsed strip for finished / cancelled trips
  if (isFinished) {
    return (
      <CompletedStrip job={job} ctx={ctx} driverName={shownDriver ?? undefined} isSelected={isSelected} />
    );
  }

  const totalUnreadSignal = (sig?.unread_client ?? 0) + (sig?.unread_driver ?? 0);

  const gStripe = groupStripeStyle(job.group_id);
  const style: React.CSSProperties = {
    ...(transform ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`, opacity: isDragging ? 0.7 : 1 } : {}),
    ...(gStripe ?? {}),
    ...(rimColor ? { borderLeftColor: rimColor, borderLeftWidth: 6 } : {}),
  };

  return (
    <div
      ref={setNodeRef}
      data-job-id={job.id}
      style={style}
      className={`relative rounded-md border-2 pl-8 pr-1 py-2 shadow-sm transition-colors ${tone} ${isSelected ? "ring-2 ring-primary" : ""} ${ctx.highlightId === job.id ? "ring-2 ring-primary ring-offset-1 animate-pulse" : ""}`}
    >

      <LabelStripe labels={labels} />

      {/* Signal overlays */}
      {hasUnread && (
        <>
          <span className="signal-stripe-msg" aria-label="Unread messages" />
          {totalUnreadSignal > 0 && (
            <span className="signal-unread-badge" aria-label={`${totalUnreadSignal} unread`}>
              {totalUnreadSignal > 99 ? "99+" : totalUnreadSignal}
            </span>
          )}
        </>
      )}
      {driverStatusNew && <span className="signal-stripe-driver" aria-label="Driver status updated" />}
      {sosOpen ? (
        <span className="signal-corner-sos" title="SOS from client" aria-label="SOS from client" />
      ) : rejected ? (
        <span className="signal-corner-rejected" title="Driver rejected — back in Unassigned" aria-label="Driver rejected" />
      ) : clientChange ? (
        <span className="signal-corner-change" title="Client requested a change" aria-label="Client change" />
      ) : null}


      {/* Multi-select checkbox */}
      <div className="absolute top-2 left-2 z-10" onClick={(e) => e.stopPropagation()}>
        <Checkbox
          checked={isSelected}
          onCheckedChange={() => ctx.onToggleSelect(job.id)}
          aria-label="Select trip"
        />
      </div>

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
              {job.client_confirmed_at && (
                <span title="Client confirmed" className="inline-flex items-center text-emerald-600" aria-label="Client confirmed">
                  ✓
                </span>
              )}
              {(() => {
                const seen = ctx.clientPresence?.[job.id];
                if (!seen) return null;
                const ageMs = Date.now() - new Date(seen).getTime();
                if (ageMs > 2 * 60_000) return null;
                return <span title="Client online" className="inline-block h-2 w-2 rounded-full bg-emerald-500 animate-pulse" aria-label="Client online" />;
              })()}
              {driverStatusNew && (
                <span className="signal-dot-driver" title="Driver status updated" aria-label="Driver status updated" />
              )}
              <span className="ml-auto flex items-center gap-1">
                {unreadCounts.driver > 0 && (
                  <span className="inline-flex items-center gap-0.5 text-blue-600 font-medium" title="Unread driver messages">
                    <MessagesSquare className="h-3 w-3" /> {unreadCounts.driver}
                  </span>
                )}
                {unreadCounts.client > 0 && (
                  <span className="inline-flex items-center gap-0.5 text-sky-600 font-medium" title="Unread client messages">
                    <MessageCircle className="h-3 w-3" /> {unreadCounts.client}
                  </span>
                )}
              </span>
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
            {(job.status && job.status !== "pending" && job.status !== "active") && (
              <div className="mt-1.5">
                <TripProgress status={job.status} compact />
              </div>
            )}
            <div className="flex flex-wrap gap-1 mt-1">
              {paxCount > 0 && (() => {
                const onboard = (job.pax ?? []).filter((p) => p.status === "onboard").length;
                const allAboard = onboard === paxCount;
                return (
                  <Badge
                    variant={allAboard ? "default" : "secondary"}
                    className={`text-[10px] gap-1 ${allAboard ? "bg-emerald-600 hover:bg-emerald-600" : ""}`}
                  >
                    <Users className="h-3 w-3" /> {onboard > 0 ? `${onboard}/${paxCount}` : paxCount}
                    {allAboard && " ✓"}
                  </Badge>
                );
              })()}
              {(job.group_id || (job.grouped_count ?? 0) >= 2) && (
                <Badge className="text-[10px] gap-1 bg-primary/15 text-primary hover:bg-primary/15 border border-primary/30">
                  <Link2 className="h-3 w-3" /> Grouped{job.grouped_count ? ` · ${job.grouped_count}` : ""}
                </Badge>
              )}
              {flightCode && !delayed && <Badge variant="outline" className="text-[10px]">✈ {flightCode}</Badge>}
              {job.tracking_enabled && <Badge variant="outline" className="text-[10px]">Track</Badge>}
              
              {job.deletion_requested_at && <Badge variant="destructive" className="text-[10px]">Delete pending</Badge>}
              {job.chain_role === "creator_watching" && (
                <Badge variant="outline" className="text-[10px] border-amber-500/60 text-amber-700 dark:text-amber-400">
                  Watching · handed to {job.executor_name ?? "partner"}
                </Badge>
              )}
              {job.chain_role === "hop_watching" && job.external && (
                <Badge variant="outline" className="text-[10px] border-primary/60 text-primary">
                  Partner: {job.executor_name}{job.external_driver_name ? ` · ${job.external_driver_name}` : ""}
                </Badge>
              )}
              {job.external && !job.chain_role && (
                <Badge variant="outline" className="text-[10px] border-primary/60 text-primary">
                  Partner: {job.executor_name}{job.external_driver_name ? ` · ${job.external_driver_name}` : ""}
                </Badge>
              )}
              {labels.map((l) => <LabelChip key={l.id} label={l} />)}
            </div>
            {job.chain_names && job.chain_names.length >= 2 && (
              <div className="mt-1 flex flex-wrap items-center gap-1 text-[10px] text-muted-foreground" aria-label="Trip chain">
                {job.chain_names.map((name, i) => {
                  const isLast = i === (job.chain_names!.length - 1);
                  const dotColor = i === 0 ? "hsl(var(--muted-foreground))" : partnerColor((job.dispatch_chain_company_ids ?? [])[i] ?? null);
                  return (
                    <span key={`${i}-${name}`} className="inline-flex items-center gap-1">
                      <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ backgroundColor: dotColor }} />
                      <span className={isLast ? "font-medium text-foreground" : ""}>{name}</span>
                      {!isLast && <ChevronRight className="h-3 w-3 opacity-60" />}
                    </span>
                  );
                })}
              </div>
            )}

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
          driverName={shownDriver ?? undefined}
        />
      </div>

      <CloneDialog open={openClone} onOpenChange={setOpenClone} job={job} />
      <SplitDialog open={openSplit} onOpenChange={setOpenSplit} job={job} />
    </div>
  );
}

function TripMenu({
  job, ctx, onOpenSplit, onOpenClone, driverName,
}: {
  job: Job; ctx: CardCtx;
  onOpenSplit: () => void; onOpenClone: () => void;
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

  const ungroupFn = useServerFn(ungroupJobs);
  const ungroupMut = useMutation({
    mutationFn: () => ungroupFn({ data: { job_id: job.id } }) as Promise<{ cleared: number }>,
    onSuccess: (r) => { toast.success(`Ungrouped ${r.cleared} trip${r.cleared === 1 ? "" : "s"}`); qc.invalidateQueries({ queryKey: ["jobs"] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const recallFn = useServerFn(recallPartnerDispatch);
  const recallMut = useMutation({
    mutationFn: () => recallFn({ data: { job_id: (job as any)._origin_job_id ?? job.id } }),
    onSuccess: () => { toast.success("Hand-off recalled"); qc.invalidateQueries({ queryKey: ["jobs"] }); },
    onError: (e: Error) => toast.error(e.message),
  });
  const canRecall = job.chain_role === "creator_watching" && job.dispatch_status === "pending";


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

  const clientLinkFn = useServerFn(getClientTripLink);
  function buildClientWhatsappText(res: any) {
    const url = `${window.location.origin}/t/${res.token}`;
    const j = res.job;
    const when = j.pickup_at
      ? new Date(j.pickup_at).toLocaleString([], { weekday: "short", month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" })
      : `${j.date}${j.time ? " " + j.time.slice(0, 5) : ""}`;
    const from = [j.from_location, j.from_flight].filter(Boolean).join(" ");
    const to = [j.to_location, j.to_flight].filter(Boolean).join(" ");
    const lines = [
      "🚐 Your transfer",
      `🕒 ${when}`,
      `📍 ${from || "?"} → ${to || "?"}`,
      "",
      "Track your ride, chat with us, and share your location:",
      url,
    ];
    return { url, text: lines.join("\n") };
  }
  const shareClientWa = useMutation({
    mutationFn: () => clientLinkFn({ data: { job_id: job.id } }) as Promise<any>,
    onSuccess: (res) => {
      const { text } = buildClientWhatsappText(res);
      window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank", "noopener");
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const copyClientLink = useMutation({
    mutationFn: () => clientLinkFn({ data: { job_id: job.id } }) as Promise<any>,
    onSuccess: async (res) => {
      const { url } = buildClientWhatsappText(res);
      try { await navigator.clipboard.writeText(url); toast.success("Client link copied"); }
      catch { toast.error("Copy failed — " + url); }
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
        {ctx.clientPortalEnabled && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-[10px] uppercase tracking-wide text-muted-foreground">Client</DropdownMenuLabel>
            <DropdownMenuItem onClick={() => shareClientWa.mutate()} disabled={shareClientWa.isPending}>
              <MessageCircle className="h-4 w-4 mr-2 text-sky-600" /> Share with client (WhatsApp)
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => copyClientLink.mutate()} disabled={copyClientLink.isPending}>
              <Link2 className="h-4 w-4 mr-2" /> Copy client link
            </DropdownMenuItem>
          </>
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
        {canRecall && (
          <DropdownMenuItem
            onClick={() => { if (confirm("Recall this hand-off before the partner accepts?")) recallMut.mutate(); }}
            disabled={recallMut.isPending}
            className="text-amber-600"
          >
            <Unlink className="h-4 w-4 mr-2" /> Recall hand-off
          </DropdownMenuItem>
        )}

        {job.group_id && (
          <DropdownMenuItem onClick={() => ungroupMut.mutate()} disabled={ungroupMut.isPending}>
            <Unlink className="h-4 w-4 mr-2" /> Ungroup
          </DropdownMenuItem>
        )}
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
    onError: (e: Error) => toast.error(e.message),
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
    onError: (e: Error) => toast.error(e.message),
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

function DispatchDialog({ open, onOpenChange, job, preselectedPartnerId }: { open: boolean; onOpenChange: (v: boolean) => void; job: Job; preselectedPartnerId?: string }) {
  const [partnerId, setPartnerId] = useState<string>("");
  const [note, setNote] = useState("");
  const qc = useQueryClient();
  const listConn = useServerFn(listConnections);
  const dispatchFn = useServerFn(dispatchJobToPartner);
  const conns = useQuery({ queryKey: ["collab", "connections"], queryFn: () => listConn(), enabled: open });
  useEffect(() => {
    if (open && preselectedPartnerId) setPartnerId(preselectedPartnerId);
    if (!open) { setPartnerId(""); setNote(""); }
  }, [open, preselectedPartnerId]);
  const mut = useMutation({
    mutationFn: async () => await dispatchFn({ data: { job_id: job.id, partner_company_id: partnerId, note: note || undefined } }),
    onSuccess: () => { toast.success("Sent to partner"); onOpenChange(false); qc.invalidateQueries({ queryKey: ["jobs"] }); qc.invalidateQueries({ queryKey: ["collab"] }); },
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

/* ------------------------------ Details sheet host ------------------------------ */

function DetailsSheetHost({
  job, onClose, onEdit, onChat, onPax, driverName,
}: {
  job: Job | null;
  onClose: () => void;
  onEdit: (j: Job) => void;
  onChat: (j: Job) => void;
  onPax: (j: Job) => void;
  driverName?: string | null;
}) {
  const shareFn = useServerFn(shareJobToDriver);
  const shareMut = useMutation({
    mutationFn: (jobId: string) => shareFn({ data: { job_id: jobId } }) as Promise<any>,
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
        `👥 ${res.job.pax_count ?? 0} pax`,
      ];
      if (res.job.vehicle) lines.push(`🚙 ${res.job.vehicle}`);
      lines.push("", `Open your manifest: ${url}`);
      const text = encodeURIComponent(lines.join("\n"));
      window.open(`https://wa.me/?text=${text}`, "_blank", "noopener");
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const copyMut = useMutation({
    mutationFn: (jobId: string) => shareFn({ data: { job_id: jobId } }) as Promise<any>,
    onSuccess: async (res: any) => {
      const url = `${window.location.origin}/m/driver/${res.token}`;
      try {
        await navigator.clipboard.writeText(url);
        toast.success("Link copied");
      } catch {
        toast.error("Copy failed — " + url);
      }
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <TripDetailsSheet
      job={job}
      open={!!job}
      onOpenChange={(v) => { if (!v) onClose(); }}
      onEdit={() => job && onEdit(job)}
      onChat={() => job && onChat(job)}
      onPax={() => job && onPax(job)}
      onShare={() => job && shareMut.mutate(job.id)}
      onCopyLink={() => job && copyMut.mutate(job.id)}
      driverName={driverName}
    />
  );
}

/* ------------------------------ Live map panel ------------------------------ */

function LiveMapPanel({ initialOpen = true }: { initialOpen?: boolean }) {
  const [open, setOpen] = useState(initialOpen);
  const fn = useServerFn(listActiveDriverLocations);
  const sosFn = useServerFn(listActiveSosPoints);
  const ackFn = useServerFn(acknowledgeSosCoord);
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ["live-locations"],
    queryFn: () => fn({ data: { since_minutes: 30 } }) as Promise<LivePoint[]>,
    refetchInterval: 30_000,
  });
  const { data: sosData } = useQuery({
    queryKey: ["active-sos-points"],
    queryFn: () => sosFn({} as any) as Promise<any[]>,

    refetchInterval: 15_000,
  });
  useEffect(() => {
    const ch = supabase
      .channel("driver-locations-live")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "driver_locations" }, () => {
        qc.invalidateQueries({ queryKey: ["live-locations"] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "client_sos_events" }, () => {
        qc.invalidateQueries({ queryKey: ["active-sos-points"] });
        qc.invalidateQueries({ queryKey: ["card-signals"] });
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [qc]);

  const ackMut = useMutation({
    mutationFn: (sos_id: string) => ackFn({ data: { sos_id } }) as Promise<{ ok: true }>,
    onSuccess: () => {
      toast.success("SOS dismissed");
      qc.invalidateQueries({ queryKey: ["active-sos-points"] });
      qc.invalidateQueries({ queryKey: ["card-signals"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const points = data ?? [];
  const sosPoints = sosData ?? [];
  const liveCount = points.filter((p) => Date.now() - new Date(p.captured_at).getTime() < 30_000).length;

  return (
    <section className={`rounded-lg border bg-card ${sosPoints.length ? "ring-2 ring-red-500/60" : ""}`}>
      <button
        type="button" onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 px-3 py-2 text-sm font-medium"
      >
        {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        <span className="relative flex h-2.5 w-2.5">
          <span className={`absolute inline-flex h-full w-full rounded-full opacity-75 ${liveCount ? "bg-emerald-500 animate-ping" : "bg-muted"}`} />
          <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${liveCount ? "bg-emerald-600" : "bg-muted-foreground/40"}`} />
        </span>
        <span>Live map</span>
        <Badge variant="secondary" className="ml-1">
          {liveCount} live · {points.length} tracked
        </Badge>
        {sosPoints.length > 0 && (
          <Badge variant="destructive" className="ml-1 animate-pulse">
            🆘 {sosPoints.length} SOS
          </Badge>
        )}
        <div className="ml-auto hidden sm:flex items-center gap-3 text-[10px] text-muted-foreground">
          <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-emerald-600" />live</span>
          <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-amber-500" />paused</span>
          <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-gray-500" />offline</span>
          <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-red-600" />SOS</span>
        </div>
      </button>
      {open && (
        <div className="p-3 pt-0">
          {points.length === 0 && sosPoints.length === 0 ? (
            <div className="text-xs text-muted-foreground border rounded-md p-6 text-center bg-muted/30">
              No drivers sharing location and no active SOS. Drivers can enable tracking from their manifest.
            </div>
          ) : (
            <DriverLiveMap
              points={points}
              sosPoints={sosPoints}
              height={320}
              onAcknowledgeSos={(id) => ackMut.mutate(id)}
            />
          )}
        </div>
      )}
    </section>
  );
}

