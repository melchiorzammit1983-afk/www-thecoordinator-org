import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  DndContext,
  useDraggable,
  useDroppable,
  type DragEndEvent,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { format, addDays, startOfWeek } from "date-fns";
import { toast } from "sonner";
import { formatMaltaDateTime, formatMaltaTime, isoToMaltaDateTime } from "@/lib/time";
import {
  Plus,
  Copy,
  Split,
  GripVertical,
  Calendar as CalIcon,
  Trash2,
  MessageCircle,
  Send,
  Users,
  MessagesSquare,
  MoreVertical,
  ChevronDown,
  ChevronRight,
  Inbox,
  PlaneTakeoff,
  Link2,
  Unlink,
  Pencil,
  Sparkles,
  AlertTriangle,
  Search,
  X as XIcon,
  GitMerge,
  Image as ImageIcon,
  Filter,
  Users2,
  Phone,
  MessageSquare,
  ArrowRight,
  Clock,
  Plane,
  User as UserIcon,
  Info,
} from "lucide-react";
import { TripEventsMap } from "@/components/coordinator/TripEventsMap";
import {
  listConnections,
  dispatchJobToPartner,
  recallPartnerDispatch,
  listIncomingDispatches,
  listOutboundDispatches,
  respondToDispatch,
} from "@/lib/collab.functions";
import {
  listPortalBookings,
  acceptPortalBooking,
  rejectPortalBooking,
  getPortalSettings,
} from "@/lib/portal.functions";
import {
  displayLocation,
  formatEta,
  formatEtaMinutes,
  urgencyTier,
  urgencyClasses,
  DEFAULT_URGENCY,
  type UrgencyThresholds,
} from "@/lib/trip-display";
import { useEnrichVisibleJobs } from "@/hooks/use-enrich-jobs";
import { GroupStopsPanel } from "@/components/coordinator/GroupStopsPanel";
import { listGroupStops } from "@/lib/groups.functions";

import {
  listJobs,
  listDrivers,
  assignDriver,
  cloneJob,
  splitJob,
  deleteJob,
  cancelDeletionRequest,
  checkFlightStatus,
  shareJobToDriver,
  getUnreadCountsCoord,
  getClientPresenceCoord,
  listActiveDriverLocations,
  listOpenWaitSessions,
  getCardSignalsCoord,
  markJobViewedCoord,
  ungroupJobs,
  groupJobs,
  shareGroupToDriver,
  getClientTripLink,
  approveClientJob,
  rejectClientJob,
  computeTripFlags,
  dismissTripFlag,
  refreshJobLiveStatus,
  listPendingBoardingApprovals,
} from "@/lib/coordinator.functions";
import { MergeTripsDialog, type MergeCandidate } from "@/components/coordinator/MergeTripsDialog";

import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
  DropdownMenuTrigger,
  DropdownMenuPortal,
  DropdownMenuCheckboxItem,
} from "@/components/ui/dropdown-menu";
import { JobFormDialog } from "@/components/coordinator/JobFormDialog";
import { PaxSplitDialog } from "@/components/coordinator/PaxSplitDialog";
import { NewTripsPreviewDialog, type NewTripRow } from "@/components/coordinator/NewTripsPreviewDialog";

import { TripChatDialog } from "@/components/trip/TripChatDialog";
import { LabelChip, LabelStripe, type Label as TLabel } from "@/components/coordinator/LabelChip";
import { ChainTimeline } from "@/components/coordinator/ChainTimeline";
import { TripProgress } from "@/components/coordinator/TripProgress";
import { TrafficBadge } from "@/components/coordinator/TrafficBadge";
import { TripDetailsSheet } from "@/components/coordinator/TripDetailsSheet";
import { FlightCodeFixDialog } from "@/components/coordinator/FlightCodeFixDialog";
import { FlightTrackingIndicator } from "@/components/coordinator/FlightTrackingIndicator";
import { TripConflictBadge } from "@/components/coordinator/TripConflictBadge";
import {
  RouteOptimizationAlertBanner,
  useRouteOptimizationAlerts,
} from "@/components/coordinator/RouteOptimizationAlerts";
import { AutoRefreshToggle } from "@/components/coordinator/AutoRefreshToggle";
import { supabase } from "@/integrations/supabase/client";
import { Checkbox } from "@/components/ui/checkbox";
import { BulkActionBar } from "@/components/coordinator/BulkActionBar";
import { GroupDialog } from "@/components/coordinator/GroupDialog";
import { AiAutoCoordinateButton } from "@/components/coordinator/AiAutoCoordinateButton";
import { useOpenAssistant } from "@/components/coordinator/CoordinatorAssistant";
import { FlightRefreshButton } from "@/components/coordinator/FlightRefreshButton";
import { useFeature } from "@/hooks/use-features";
import { useAiToggle } from "@/hooks/use-preferences";
import { IfFeature } from "@/components/billing/IfFeature";

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
  osc.type = "sine";
  osc.frequency.value = freq;
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
  trip_no?: number | null;
  from_location: string;
  to_location: string;
  date: string;
  time: string;
  pickup_at: string | null;
  flightorship: string | null;
  from_flight: string | null;
  to_flight: string | null;
  flight_status: string | null;
  flight_status_note: string | null;
  flight_status_updated_at: string | null;
  flight_scheduled_at: string | null;
  flight_estimated_at: string | null;
  tracking_enabled: boolean;
  qr_strict_mode: boolean;
  status: string;
  driver_id: string | null;
  vehicle: string | null;
  contact_phone: string | null;
  clientcompanyname: string | null;
  driver_accepted_at: string | null;
  deletion_requested_at: string | null;
  drivers?: {
    name: string;
    vehicle?: string | null;
    phone?: string | null;
    seats_available?: number | null;
    availability_note?: string | null;
  } | null;
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
  traffic_delay_minutes?: number | null;
  traffic_severity?: string | null;
  leave_by_at?: string | null;
  pickup_shift_reason?: string | null;
  pickup_display_name?: string | null;
  dropoff_display_name?: string | null;
  pickup_place_id?: string | null;
  dropoff_place_id?: string | null;
  route_duration_sec?: number | null;
  route_distance_m?: number | null;
};

function AskAiInlineButton({ trip, size = "sm", variant = "outline", label = "Ask AI", className }: { trip?: Job | null; size?: "sm" | "xs"; variant?: "outline" | "ghost"; label?: string; className?: string }) {
  const openAi = useOpenAssistant();
  const assistantEnabled = useFeature("ai_coordinator_assist");
  if (!assistantEnabled) return null;
  return (
    <Button
      size="sm"
      variant={variant}
      className={
        size === "xs"
          ? `h-6 px-2 text-[10px] ${className ?? ""}`
          : `flex-1 min-h-11 ${className ?? ""}`
      }
      onClick={(e) => {
        e.stopPropagation();
        openAi(
          trip
            ? {
                path: typeof window !== "undefined" ? window.location.pathname : null,
                trip: {
                  id: trip.id,
                  trip_no: trip.trip_no ?? null,
                  from_location: trip.from_location,
                  to_location: trip.to_location,
                  date: trip.date,
                  time: trip.time,
                  driver_id: trip.driver_id,
                  driver_name: trip.drivers?.name ?? null,
                  from_flight: trip.from_flight,
                  to_flight: trip.to_flight,
                  vehicle: trip.vehicle,
                  contact_phone: trip.contact_phone,
                  clientcompanyname: trip.clientcompanyname,
                },
              }
            : null,
        );
      }}
    >
      <Sparkles className={size === "xs" ? "h-3 w-3 mr-1" : "h-4 w-4 mr-1.5"} />
      {label}
    </Button>
  );
}

type Driver = { id: string; name: string; vehicle: string | null };

type TripFlagInfo = {
  duplicates: {
    id: string;
    date: string | null;
    time: string | null;
    from_location: string | null;
    to_location: string | null;
    pax_names: string[];
  }[];
  suspicious: {
    id: string;
    date: string | null;
    time: string | null;
    flight_number: string | null;
    from_location: string | null;
    to_location: string | null;
    pax_names: string[];
  }[];
};

type LiveEtaPoint = {
  job_id: string;
  captured_at: string;
  wait_started_at?: string | null;
  eta_sec?: number | null;
};

type PendingBoardingApproval = {
  id: string;
  job_id: string;
  status: "pending";
  requested_at: string;
  driver_note?: string | null;
  pax_summary?: {
    onboard?: number;
    noshow?: number;
    cancelled?: number;
    pending?: number;
  } | null;
  job?: {
    id: string;
    from_location: string | null;
    to_location: string | null;
    pickup_display_name?: string | null;
    dropoff_display_name?: string | null;
  } | null;
};

function CalendarPage() {
  const [view, setView] = useState<"day" | "week">("day");
  const [anchor, setAnchor] = useState<Date>(new Date());
  const [openNew, setOpenNew] = useState(false);
  const [editJob, setEditJob] = useState<Job | null>(null);
  const [paxJob, setPaxJob] = useState<Job | null>(null);
  const [chatJob, setChatJob] = useState<Job | null>(null);
  const [detailsJob, setDetailsJob] = useState<Job | null>(null);
  const { count: pendingRouteOptCount } = useRouteOptimizationAlerts();
  const [justAcceptedId, setJustAcceptedId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [editGroup, setEditGroup] = useState<{ groupId: string; jobs: Job[] } | null>(null);
  const [flightFix, setFlightFix] = useState<{ jobId: string; code: string; side: "from" | "to" } | null>(null);
  const [alertsOnly, setAlertsOnly] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<Set<string>>(new Set());
  const [showCompleted, setShowCompleted] = useState<boolean>(() => {
    if (typeof window === "undefined") return true;
    const v = window.localStorage.getItem("calendar.showCompleted");
    return v === null ? true : v === "1";
  });
  useEffect(() => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem("calendar.showCompleted", showCompleted ? "1" : "0");
    }
  }, [showCompleted]);
  const [driverFilter, setDriverFilter] = useState<string>("all"); // "all" | "unassigned" | driver id
  const toggleStatusFilter = (s: string) =>
    setStatusFilter((prev) => {
      const n = new Set(prev);
      if (n.has(s)) n.delete(s);
      else n.add(s);
      return n;
    });
  const [trafficFilter, setTrafficFilter] = useState<Set<string>>(new Set());
  const [trafficSort, setTrafficSort] = useState<"none" | "leave_by" | "severity">("none");
  const toggleTrafficFilter = (s: string) =>
    setTrafficFilter((prev) => {
      const n = new Set(prev);
      if (n.has(s)) n.delete(s);
      else n.add(s);
      return n;
    });
  const qc = useQueryClient();
  const clientPortalEnabled = useFeature("client_trip_portal");

  const toggleExpandedGroup = (gid: string) =>
    setExpandedGroups((s) => {
      const n = new Set(s);
      if (n.has(gid)) n.delete(gid);
      else n.add(gid);
      return n;
    });

  const toggleSelect = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
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
    queryFn: () =>
      signalsFn({ data: { job_ids: presenceJobIds } }) as Promise<
        Record<
          string,
          {
            unread_client: number;
            unread_driver: number;
            client_change: boolean;
            sos_open: boolean;
            driver_status_new: boolean;
            rejected: boolean;
          }
        >
      >,

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
  const pendingBoardingFn = useServerFn(listPendingBoardingApprovals);
  const boardingScopeJobIds = useMemo(
    () => (jobs ?? []).map((j) => j.id).filter((id) => /^[0-9a-f-]{36}$/i.test(id)),
    [jobs],
  );
  const { data: pendingBoardingApprovals } = useQuery({
    queryKey: ["coord-pending-boarding", boardingScopeJobIds.join(",")],
    enabled: boardingScopeJobIds.length > 0,
    queryFn: () => pendingBoardingFn({ data: { job_ids: boardingScopeJobIds } }) as Promise<PendingBoardingApproval[]>,
    refetchInterval: 5_000,
  });
  const { data: drivers } = useQuery({
    queryKey: ["drivers"],
    queryFn: () => driversFn() as Promise<Driver[]>,
  });

  const flagsFn = useServerFn(computeTripFlags);
  const { data: tripFlags } = useQuery({
    queryKey: ["trip-flags"],
    queryFn: () => flagsFn() as Promise<Record<string, TripFlagInfo>>,
    refetchInterval: 30_000,
  });
  const dismissFlagFn = useServerFn(dismissTripFlag);
  const dismissFlagMut = useMutation({
    mutationFn: (v: { job_id: string; kind: "duplicate" | "suspicious" }) => dismissFlagFn({ data: v }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["trip-flags"] });
      toast.success("Alert dismissed");
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const [mergeTarget, setMergeTarget] = useState<{ current: MergeCandidate; duplicates: MergeCandidate[] } | null>(
    null,
  );

  const assignFn = useServerFn(assignDriver);
  const assignMut = useMutation({
    mutationFn: (v: { job_id: string; driver_id: string | null }) => assignFn({ data: v }),
    onSuccess: () => {
      toast.success("Assigned");
      refetch();
    },
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
    return () => {
      supabase.removeChannel(ch);
    };
  }, [qc]);

  // Poll live flight statuses every 3 min for jobs with a flight in view.
  const flightFn = useServerFn(checkFlightStatus);
  useEffect(() => {
    const hasFlights = (jobs ?? []).some((j) => j.from_flight || j.to_flight);
    if (!hasFlights) return;
    let cancelled = false;
    const run = async () => {
      try {
        await flightFn();
        if (!cancelled) refetch();
      } catch {
        /* ignore */
      }
    };
    run();
    const id = setInterval(run, 180_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [jobs, flightFn, refetch]);

  // Auto-refresh live status (traffic + flight) for trips leaving in the next 6h.
  // Runs every 5 min while the calendar is open. Each trip is refreshed at most
  // once every 5 min per session to keep Distance Matrix usage low. Cards read
  // the persisted columns, so the badge updates automatically.
  const refreshLiveFn = useServerFn(refreshJobLiveStatus);
  const refreshedAtRef = useRef<Record<string, number>>({});
  useEffect(() => {
    const tick = async () => {
      const now = Date.now();
      const horizon = now + 6 * 60 * 60_000;
      const candidates = (jobs ?? [])
        .filter((j: any) => {
          if (!j?.pickup_at || !j.from_location || !j.to_location) return false;
          const t = new Date(j.pickup_at).getTime();
          if (Number.isNaN(t) || t < now - 30 * 60_000 || t > horizon) return false;
          const last = refreshedAtRef.current[j.id] ?? 0;
          return now - last > 5 * 60_000;
        })
        .slice(0, 8);
      if (!candidates.length) return;
      for (const j of candidates) {
        refreshedAtRef.current[j.id] = Date.now();
        try {
          await refreshLiveFn({ data: { job_id: j.id } });
        } catch {
          /* ignore */
        }
      }
      qc.invalidateQueries({ queryKey: ["jobs"] });
    };
    tick();
    const id = setInterval(tick, 5 * 60_000);
    return () => clearInterval(id);
  }, [jobs, refreshLiveFn, qc]);

  useEffect(() => {
    const ids = Array.from(
      new Set(
        (jobs ?? [])
          .map((j) => j.id)
          .filter((id) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)),
      ),
    );
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
      for (const [id, s] of Object.entries(cardSignals))
        seed[id] = { sos_open: !!s.sos_open, client_change: !!s.client_change, rejected: !!(s as any).rejected };
      prevSignalsRef.current = seed;
      firstSignalsRun.current = false;
      return;
    }
    for (const [id, s] of Object.entries(cardSignals)) {
      const p = prev[id] ?? { sos_open: false, client_change: false, rejected: false };
      if (s.sos_open && !p.sos_open) {
        try {
          playAlertBeep(880, 0.35);
          setTimeout(() => playAlertBeep(660, 0.35), 200);
        } catch {
          /* ignore */
        }
        const j = (jobs ?? []).find((x) => x.id === id);
        toast.error(`🆘 SOS from client${j ? ` · ${j.from_location} → ${j.to_location}` : ""}`, {
          action: j
            ? {
                label: "Open",
                onClick: () => {
                  scrollToJob(id);
                  setDetailsJob(j);
                },
              }
            : undefined,
          duration: 15000,
          description: "Open the trip to see who pressed SOS and dismiss the alert.",
        });
        scrollToJob(id);
      } else if (s.client_change && !p.client_change) {
        try {
          playAlertBeep(520, 0.15);
        } catch {
          /* ignore */
        }
        const j = (jobs ?? []).find((x) => x.id === id);
        toast.warning(`Client requested a change${j ? ` · ${j.from_location} → ${j.to_location}` : ""}`, {
          action: j
            ? {
                label: "Open",
                onClick: () => {
                  scrollToJob(id);
                  setDetailsJob(j);
                },
              }
            : undefined,
          duration: 8000,
        });
        scrollToJob(id);
      } else if ((s as any).rejected && !p.rejected) {
        try {
          playAlertBeep(440, 0.25);
          setTimeout(() => playAlertBeep(330, 0.25), 180);
        } catch {
          /* ignore */
        }
        const j = (jobs ?? []).find((x) => x.id === id);
        toast.warning(`⚠️ Driver rejected a trip${j ? ` · ${j.from_location} → ${j.to_location}` : ""}`, {
          action: j
            ? {
                label: "Open",
                onClick: () => {
                  scrollToJob(id);
                  setChatJob(j);
                },
              }
            : undefined,
          duration: 12000,
          description: "The trip is back in Unassigned. Check the chat for the reason.",
        });
        scrollToJob(id);
      }
      prev[id] = { sos_open: !!s.sos_open, client_change: !!s.client_change, rejected: !!(s as any).rejected };
    }
  }, [cardSignals, jobs]);

  const [dispatchState, setDispatchState] = useState<{ job: Job; partnerId?: string } | null>(null);

  function onDragEnd(e: DragEndEvent) {
    const rawId = String(e.active.id);
    const dropId = e.over?.id ? String(e.over.id) : null;
    if (!dropId) return;

    // Drop on partner lane → open dispatch dialog prefilled
    if (dropId.startsWith("partner:")) {
      const partnerCompanyId = dropId.slice(8);
      const findJob = (id: string) => (jobs ?? []).find((j) => j.id === id) ?? null;
      if (rawId.startsWith("group:")) {
        const gid = rawId.slice(6);
        const first = (jobs ?? []).find((j) => j.group_id === gid);
        if (first) setDispatchState({ job: first, partnerId: partnerCompanyId });
      } else {
        const j = findJob(rawId);
        if (j) {
          // Ignore synthetic hop cards (already handed off)
          if ((j as any)._origin_job_id) return;
          if (j.external) {
            toast.error("This trip is already at a partner");
            return;
          }
          setDispatchState({ job: j, partnerId: partnerCompanyId });
        }
      }
      return;
    }

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
    markViewedFn({ data: { job_id: id } }).catch(() => {
      /* ignore */
    });
    qc.setQueryData<any>(["coord-card-signals", presenceJobIds.join(",")], (prev: any) => {
      if (!prev || !prev[id]) return prev;
      return { ...prev, [id]: { ...prev[id], driver_status_new: false } };
    });
  };
  const hasAlert = (jobId: string) => {
    const s = cardSignals?.[jobId];
    if (!s) return false;
    return (
      s.unread_client + s.unread_driver > 0 ||
      s.client_change ||
      s.sos_open ||
      s.driver_status_new ||
      (s as any).rejected
    );
  };

  const isPendingClient = (j: Job) => !j.external && !j.coord_approved_at && (j.source ?? "").startsWith("client");
  const afterAlerts = alertsOnly ? (jobs ?? []).filter((j) => hasAlert(j.id)) : (jobs ?? []);
  const q = searchQuery.trim().toLowerCase();
  const afterSearch = q
    ? afterAlerts.filter((j) => {
        const hay = [
          j.from_location,
          j.to_location,
          j.from_flight,
          j.to_flight,
          j.contact_phone,
          j.clientcompanyname,
          j.drivers?.name,
          ...(j.pax ?? []).map((p) => p.name),
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return hay.includes(q);
      })
    : afterAlerts;
  const afterStatus = statusFilter.size
    ? afterSearch.filter((j) => statusFilter.has(String(j.status ?? "")))
    : afterSearch;
  const afterCompleted = showCompleted
    ? afterStatus
    : afterStatus.filter((j) => j.status !== "completed" && j.status !== "cancelled");
  const afterDriver =
    driverFilter === "all"
      ? afterCompleted
      : driverFilter === "unassigned"
        ? afterCompleted.filter((j) => !j.driver_id)
        : afterCompleted.filter((j) => j.driver_id === driverFilter);
  const visibleAll = trafficFilter.size
    ? afterDriver.filter((j) => trafficFilter.has(String(j.traffic_severity ?? "")))
    : afterDriver;
  const activeFilterCount =
    (q ? 1 : 0) + statusFilter.size + (driverFilter !== "all" ? 1 : 0) + trafficFilter.size + (alertsOnly ? 1 : 0);
  const severityCounts: Record<string, number> = { light: 0, moderate: 0, heavy: 0, severe: 0 };
  for (const j of afterAlerts) {
    const s = String(j.traffic_severity ?? "");
    if (s in severityCounts) severityCounts[s]++;
  }
  const SEV_RANK: Record<string, number> = { severe: 4, heavy: 3, moderate: 2, light: 1 };
  const trafficSorted =
    trafficSort === "none"
      ? null
      : [...visibleAll].sort((a, b) => {
          if (trafficSort === "severity") {
            const rb = SEV_RANK[String(b.traffic_severity ?? "")] ?? 0;
            const ra = SEV_RANK[String(a.traffic_severity ?? "")] ?? 0;
            if (rb !== ra) return rb - ra;
            const db = (b.traffic_delay_minutes ?? 0) - (a.traffic_delay_minutes ?? 0);
            if (db !== 0) return db;
          } else {
            const av = a.leave_by_at ? new Date(a.leave_by_at).getTime() : Number.POSITIVE_INFINITY;
            const bv = b.leave_by_at ? new Date(b.leave_by_at).getTime() : Number.POSITIVE_INFINITY;
            if (av !== bv) return av - bv;
          }
          return ((a.date ?? "") + (a.time ?? "")).localeCompare((b.date ?? "") + (b.time ?? ""));
        });
  const pendingClientJobs = visibleAll.filter(isPendingClient);
  const visibleJobs = visibleAll.filter((j) => !isPendingClient(j));
  const unassigned = visibleJobs.filter((j) => !j.driver_id);

  // Fetch admin urgency thresholds once. Falls back to defaults if not readable.
  const portalSettingsFn = useServerFn(getPortalSettings);
  const { data: portalSettings } = useQuery({
    queryKey: ["portal-settings-urgency"],
    queryFn: () => portalSettingsFn() as Promise<any>,
    staleTime: 5 * 60_000,
  });
  const urgency: UrgencyThresholds = {
    green_min: Number(portalSettings?.urgency_green_min ?? DEFAULT_URGENCY.green_min),
    orange_min: Number(portalSettings?.urgency_orange_min ?? DEFAULT_URGENCY.orange_min),
    red_min: Number(portalSettings?.urgency_red_min ?? DEFAULT_URGENCY.red_min),
  };
  // Bump every 60s so unassigned cards re-evaluate their glow tier.
  const [nowTick, setNowTick] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNowTick(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, []);

  const cardCtx: CardCtx = {
    onEdit: setEditJob,
    onPax: setPaxJob,
    onChat: setChatJob,
    onOpenDetails: (j) => {
      handleMarkViewed(j.id);
      setDetailsJob(j);
    },
    onAssign: (job, driverId) => assignMut.mutate({ job_id: job.id, driver_id: driverId }),
    drivers: drivers ?? [],
    unread: unreadByJob ?? {},
    highlightId: justAcceptedId,
    selected,
    onToggleSelect: toggleSelect,
    expandedGroups,
    onToggleExpandedGroup: toggleExpandedGroup,
    onEditGroup: (groupId, memberJobs) => setEditGroup({ groupId, jobs: memberJobs }),
    clientPortalEnabled,
    clientPresence: clientPresence ?? {},
    signals: cardSignals ?? {},
    tripFlags: tripFlags ?? {},
    onDismissFlag: (job_id, kind) => dismissFlagMut.mutate({ job_id, kind }),
    onOpenMerge: (current, duplicates) => setMergeTarget({ current, duplicates }),
    urgency,
    nowTick,
    openFlightFix: (arg) => setFlightFix(arg),
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
          <div className="flex items-center gap-2">
            <FlightTrackingIndicator />
            <Button size="sm" onClick={() => setOpenNew(true)}>
              <Plus className="h-4 w-4 mr-1" /> New
            </Button>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-md border overflow-hidden">
            <button
              className={`px-3 py-1.5 text-xs ${view === "day" ? "bg-primary text-primary-foreground" : "bg-background"}`}
              onClick={() => setView("day")}
            >
              Day
            </button>
            <button
              className={`px-3 py-1.5 text-xs ${view === "week" ? "bg-primary text-primary-foreground" : "bg-background"}`}
              onClick={() => setView("week")}
            >
              Week
            </button>
          </div>
          <div className="flex items-center gap-1 ml-auto">
            <Button size="sm" variant="outline" onClick={() => setAnchor(addDays(anchor, view === "day" ? -1 : -7))}>
              ‹
            </Button>
            <div className="text-xs sm:text-sm font-medium min-w-[130px] text-center flex items-center gap-1 justify-center">
              <CalIcon className="h-3.5 w-3.5" />
              {view === "day"
                ? format(anchor, "EEE, d MMM")
                : `${format(range.days[0], "d MMM")} – ${format(range.days[6], "d MMM")}`}
            </div>
            <Button size="sm" variant="outline" onClick={() => setAnchor(addDays(anchor, view === "day" ? 1 : 7))}>
              ›
            </Button>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[180px] max-w-sm">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search trips… (from, to, flight, driver, passenger)"
              className="w-full h-8 pl-7 pr-7 text-xs rounded-md border bg-background"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <XIcon className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="outline" className="h-8 text-xs">
                <Filter className="h-3.5 w-3.5 mr-1" />
                Status{statusFilter.size > 0 ? ` (${statusFilter.size})` : ""}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-48">
              <DropdownMenuLabel>Filter by status</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {(
                [
                  { k: "pending", label: "Pending" },
                  { k: "active", label: "Active" },
                  { k: "en_route", label: "En route" },
                  { k: "arrived", label: "Arrived" },
                  { k: "in_progress", label: "In progress" },
                  { k: "completed", label: "Completed" },
                  { k: "cancelled", label: "Cancelled" },
                ] as const
              ).map((o) => (
                <DropdownMenuCheckboxItem
                  key={o.k}
                  checked={statusFilter.has(o.k)}
                  onSelect={(e) => e.preventDefault()}
                  onCheckedChange={() => toggleStatusFilter(o.k)}
                >
                  {o.label}
                </DropdownMenuCheckboxItem>
              ))}
              {statusFilter.size > 0 && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => setStatusFilter(new Set())}>Clear status filter</DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>

          <Button
            size="sm"
            variant={showCompleted ? "default" : "outline"}
            className="h-8 text-xs"
            onClick={() => setShowCompleted((v) => !v)}
            title="Toggle completed and cancelled trips"
          >
            {showCompleted ? "Hide completed" : "Show completed"}
          </Button>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="outline" className="h-8 text-xs">
                <Users2 className="h-3.5 w-3.5 mr-1" />
                {driverFilter === "all"
                  ? "Driver"
                  : driverFilter === "unassigned"
                    ? "Unassigned"
                    : ((drivers ?? []).find((d) => d.id === driverFilter)?.name ?? "Driver")}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-56 max-h-72 overflow-y-auto">
              <DropdownMenuLabel>Filter by driver</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => setDriverFilter("all")}>All drivers</DropdownMenuItem>
              <DropdownMenuItem onClick={() => setDriverFilter("unassigned")}>— Unassigned —</DropdownMenuItem>
              <DropdownMenuSeparator />
              {(drivers ?? []).map((d) => (
                <DropdownMenuItem key={d.id} onClick={() => setDriverFilter(d.id)}>
                  {d.name}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          {activeFilterCount > 0 && (
            <button
              type="button"
              onClick={() => {
                setSearchQuery("");
                setStatusFilter(new Set());
                setDriverFilter("all");
                setTrafficFilter(new Set());
                setAlertsOnly(false);
              }}
              className="px-2 py-1 rounded-md border text-[11px] text-muted-foreground hover:text-foreground"
            >
              Clear all filters
            </button>
          )}
        </div>
        <div className="flex flex-wrap justify-end items-center gap-2">
          <Popover>
            <PopoverTrigger asChild>
              <Button size="sm" variant="outline" className="h-8 text-xs">
                <Filter className="h-3.5 w-3.5 mr-1" />
                More filters
                {(trafficFilter.size > 0 || alertsOnly || trafficSort !== "none") && (
                  <span className="ml-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] text-primary-foreground">
                    {trafficFilter.size + (alertsOnly ? 1 : 0) + (trafficSort !== "none" ? 1 : 0)}
                  </span>
                )}
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-72 space-y-3">
              <div>
                <div className="text-[11px] font-semibold text-muted-foreground uppercase mb-1.5">Traffic</div>
                <div className="flex flex-wrap gap-1.5">
                  {(["light", "moderate", "heavy", "severe"] as const).map((s) => {
                    const active = trafficFilter.has(s);
                    const styles: Record<string, string> = {
                      light: "border-emerald-500/50 text-emerald-700 dark:text-emerald-300",
                      moderate: "border-amber-500/50 text-amber-800 dark:text-amber-300",
                      heavy: "border-orange-500/50 text-orange-800 dark:text-orange-300",
                      severe: "border-red-500/50 text-red-700 dark:text-red-300",
                    };
                    const activeBg: Record<string, string> = {
                      light: "bg-emerald-500/15",
                      moderate: "bg-amber-500/15",
                      heavy: "bg-orange-500/15",
                      severe: "bg-red-500/15",
                    };
                    return (
                      <button
                        key={s}
                        type="button"
                        onClick={() => toggleTrafficFilter(s)}
                        className={`px-2 py-0.5 rounded-full border text-[11px] capitalize transition-colors ${styles[s]} ${active ? activeBg[s] : "bg-background hover:bg-muted"}`}
                      >
                        {active ? "● " : ""}
                        {s} · {severityCounts[s]}
                      </button>
                    );
                  })}
                  {trafficFilter.size > 0 && (
                    <button
                      type="button"
                      onClick={() => setTrafficFilter(new Set())}
                      className="px-2 py-0.5 rounded-full border text-[11px] text-muted-foreground hover:text-foreground"
                    >
                      clear
                    </button>
                  )}
                </div>
              </div>

              <div>
                <div className="text-[11px] font-semibold text-muted-foreground uppercase mb-1.5">Sort</div>
                <div className="flex rounded-md border overflow-hidden text-[11px] w-full">
                  {(
                    [
                      { k: "none", label: "Default" },
                      { k: "leave_by", label: "Leave by ↑" },
                      { k: "severity", label: "Severity ↓" },
                    ] as const
                  ).map((o) => (
                    <button
                      key={o.k}
                      type="button"
                      onClick={() => setTrafficSort(o.k)}
                      className={`flex-1 px-2 py-1 ${trafficSort === o.k ? "bg-primary text-primary-foreground" : "bg-background text-muted-foreground hover:text-foreground"}`}
                    >
                      {o.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={() => setAlertsOnly((v) => !v)}
                  className={`flex-1 px-2.5 py-1 rounded-md border text-[11px] transition-colors ${
                    alertsOnly
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-background text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {alertsOnly ? "● " : ""}Only cards with alerts
                </button>
              </div>

              <div className="pt-1 border-t">
                <AutoRefreshToggle jobs={jobs ?? []} />
              </div>
            </PopoverContent>
          </Popover>
        </div>
      </header>


      {/* Drivers currently on waiting time */}
      <WaitingNowStrip
        onJump={(jobId) => {
          const j = (jobs ?? []).find((x: any) => x.id === jobId);
          if (j) setDetailsJob(j as any);
        }}
      />
      <BoardingApprovalAlertPanel
        alerts={pendingBoardingApprovals ?? []}
        onOpenJob={(jobId) => {
          const j = (jobs ?? []).find((x: any) => x.id === jobId);
          if (j) setDetailsJob(j as any);
        }}
      />

      {/* Trip list with concise ETA */}
      <RouteOptimizationAlertBanner />

      {/* Trip list with concise ETA */}
      <DispatchTripList
        jobs={visibleJobs}
        onOpenDetails={(j) => setDetailsJob(j)}
        onOpenChat={(j) => setChatJob(j)}
        pendingApprovalCount={pendingRouteOptCount}
      />

      {/* Inbound (pending my decision) */}
      <InboundBoard ctx={cardCtx} onAccepted={handleAccepted} />

      {/* Outbound trips now appear directly in partner lanes below */}

      {/* Client-requested trips awaiting coordinator approval */}
      <PendingClientApprovalBoard jobs={pendingClientJobs} ctx={cardCtx} onChanged={() => refetch()} />

      <div className="flex justify-end mb-2 gap-2">
        <AskAiInlineButton />
        <AiAutoCoordinateButton />
      </div>

      {trafficSorted ? (
        <div className="rounded-md border bg-card p-3 space-y-2">
          <div className="flex items-center justify-between">
            <div className="text-xs font-medium text-muted-foreground">
              Traffic view — sorted by {trafficSort === "leave_by" ? "leave-by time" : "severity"} ·{" "}
              {trafficSorted.length} trip{trafficSorted.length === 1 ? "" : "s"}
            </div>
            <button
              type="button"
              onClick={() => setTrafficSort("none")}
              className="text-[11px] text-muted-foreground hover:text-foreground underline"
            >
              back to lanes
            </button>
          </div>
          {trafficSorted.length === 0 ? (
            <div className="text-xs text-muted-foreground py-6 text-center">No trips match the current filter.</div>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
              {trafficSorted.map((j) => (
                <TripCard
                  key={j.id}
                  job={j}
                  ctx={cardCtx}
                  driverName={(drivers ?? []).find((d) => d.id === j.driver_id)?.name}
                />
              ))}
            </div>
          )}
        </div>
      ) : (
        <DndContext sensors={sensors} onDragEnd={onDragEnd}>
          <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-3">
            <UnassignedColumn jobs={unassigned} ctx={cardCtx} />
            {view === "day" ? (
              <DriverLanes drivers={drivers ?? []} jobs={visibleJobs} ctx={cardCtx} />
            ) : (
              <WeekGrid drivers={drivers ?? []} jobs={visibleJobs} days={range.days} ctx={cardCtx} />
            )}
          </div>
        </DndContext>
      )}

      {dispatchState && (
        <DispatchDialog
          open={!!dispatchState}
          onOpenChange={(v) => {
            if (!v) setDispatchState(null);
          }}
          job={dispatchState.job}
          preselectedPartnerId={dispatchState.partnerId}
        />
      )}

      <JobFormDialog
        open={openNew}
        onOpenChange={setOpenNew}
        drivers={drivers ?? []}
        onSaved={(d) => {
          if (d) {
            const [y, m, dd] = d.split("-").map(Number);
            if (y && m && dd) setAnchor(new Date(y, m - 1, dd));
          }
          setOpenNew(false);
          refetch();
        }}
      />
      <JobFormDialog
        open={!!editJob}
        onOpenChange={(v) => !v && setEditJob(null)}
        drivers={drivers ?? []}
        job={editJob ?? undefined}
        onSaved={(d) => {
          if (d) {
            const [y, m, dd] = d.split("-").map(Number);
            if (y && m && dd) setAnchor(new Date(y, m - 1, dd));
          }
          setEditJob(null);
          refetch();
        }}
      />

      <PaxSplitDialog
        open={!!paxJob}
        onOpenChange={(v) => !v && setPaxJob(null)}
        jobId={paxJob?.id ?? null}
        jobLabel={
          paxJob ? `${paxJob.from_location} → ${paxJob.to_location} · ${paxJob.date} ${paxJob.time?.slice(0, 5)}` : ""
        }
        drivers={drivers ?? []}
      />
      <TripChatDialog
        open={!!chatJob}
        onOpenChange={(v) => !v && setChatJob(null)}
        jobId={chatJob?.id ?? null}
        title={chatJob ? `${chatJob.from_location} → ${chatJob.to_location}` : ""}
        role="coordinator"
      />
      <DetailsSheetHost
        job={detailsJob}
        onClose={() => setDetailsJob(null)}
        onEdit={(j) => {
          setDetailsJob(null);
          setEditJob(j);
        }}
        onChat={(j) => setChatJob(j)}
        onPax={(j) => setPaxJob(j)}
        driverName={
          detailsJob
            ? ((drivers ?? []).find((d) => d.id === detailsJob.driver_id)?.name ?? detailsJob.drivers?.name ?? null)
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

      {flightFix && (
        <FlightCodeFixDialog
          open={!!flightFix}
          onOpenChange={(v: boolean) => !v && setFlightFix(null)}
          jobId={flightFix.jobId}
          currentCode={flightFix.code}
          currentSide={flightFix.side}
        />
      )}



      {mergeTarget && (
        <MergeTripsDialog
          open={!!mergeTarget}
          onOpenChange={(v) => !v && setMergeTarget(null)}
          current={mergeTarget.current}
          duplicates={mergeTarget.duplicates}
          onMerged={() => refetch()}
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
  signals?: Record<
    string,
    {
      unread_client: number;
      unread_driver: number;
      client_change: boolean;
      sos_open: boolean;
      driver_status_new: boolean;
      rejected?: boolean;
    }
  >;
  tripFlags?: Record<string, TripFlagInfo>;
  onDismissFlag?: (jobId: string, kind: "duplicate" | "suspicious") => void;
  onOpenMerge?: (current: MergeCandidate, duplicates: MergeCandidate[]) => void;
  urgency: UrgencyThresholds;
  nowTick: number; // ms — bumped every minute so cards re-evaluate glow
  openFlightFix?: (arg: { jobId: string; code: string; side: "from" | "to" }) => void;
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

/* ------------------------------ Lane select-all chip ------------------------------ */

function SelectAllInLane({ jobs, ctx, label = "Select all here" }: { jobs: Job[]; ctx: CardCtx; label?: string }) {
  if (jobs.length < 2) return null;
  const ids = jobs.map((j) => j.id);
  const selectedHere = ids.filter((id) => ctx.selected.has(id)).length;
  if (selectedHere === 0) return null; // only surface once user has started selecting
  const allHere = selectedHere === ids.length;
  return (
    <button
      type="button"
      onClick={() => {
        // If all selected → deselect this lane. Otherwise select the rest.
        for (const id of ids) {
          const isSel = ctx.selected.has(id);
          if (!allHere && !isSel) ctx.onToggleSelect(id);
          if (allHere && isSel) ctx.onToggleSelect(id);
        }
      }}
      className="mb-2 inline-flex items-center gap-1 rounded-full border border-primary/40 bg-primary/5 px-2 py-0.5 text-[11px] font-medium text-primary hover:bg-primary/10"
    >
      {allHere ? `Deselect all here (${selectedHere})` : `Select all here (${ids.length})`}
    </button>
  );
}

/* ------------------------------ Grouping helpers ------------------------------ */



type RenderItem = { kind: "single"; job: Job } | { kind: "group"; group_id: string; jobs: Job[] };

function bucketByGroup(jobs: Job[]): RenderItem[] {
  const groups = new Map<string, Job[]>();
  for (const j of jobs)
    if (j.group_id) {
      const a = groups.get(j.group_id) ?? [];
      a.push(j);
      groups.set(j.group_id, a);
    }
  const items: RenderItem[] = [];
  const seen = new Set<string>();
  for (const j of jobs) {
    if (j.group_id) {
      if (seen.has(j.group_id)) continue;
      seen.add(j.group_id);
      const arr = groups.get(j.group_id)!;
      if (arr.length < 2) items.push({ kind: "single", job: arr[0] });
      else
        items.push({
          kind: "group",
          group_id: j.group_id,
          jobs: [...arr].sort((a, b) =>
            ((a.date ?? "") + (a.time ?? "")).localeCompare((b.date ?? "") + (b.time ?? "")),
          ),
        });
    } else {
      items.push({ kind: "single", job: j });
    }
  }
  return items;
}

function renderItems(items: RenderItem[], ctx: CardCtx, driverNameOf?: (j: Job) => string | undefined) {
  return items.map((it) =>
    it.kind === "single" ? (
      <TripCard key={it.job.id} job={it.job} ctx={ctx} driverName={driverNameOf?.(it.job)} />
    ) : (
      <GroupedStackCard key={it.group_id} groupId={it.group_id} jobs={it.jobs} ctx={ctx} driverNameOf={driverNameOf} />
    ),
  );
}

/* ------------------------------ Inbound / Outbound ------------------------------ */

function InboundBoard({
  ctx,
  onAccepted,
}: {
  ctx: CardCtx;
  onAccepted?: (res: { id: string; date: string | null }) => void;
}) {
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
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 px-3 py-2 text-sm font-medium"
      >
        {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        <Inbox className="h-4 w-4 text-primary" />
        <span>Inbound — pending your decision</span>
        <Badge variant="secondary" className="ml-1">
          {items.length}
        </Badge>
      </button>
      {open && (
        <div className="grid gap-2 p-3 pt-0 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((j: any) => (
            <div key={j.id} className="rounded-md border bg-background p-3 space-y-2">
              <div className="flex items-center gap-2 flex-wrap text-xs">
                <Badge variant="outline">from {j.origin?.name ?? "partner"}</Badge>
                <span className="font-medium">
                  {j.date} {j.time?.slice(0, 5)}
                </span>
                <span className="ml-auto text-muted-foreground">{(j.pax ?? []).length} pax</span>
              </div>
              <div className="text-sm font-medium truncate">
                {j.from_location} → {j.to_location}
              </div>
              {j.dispatch_note && <div className="text-xs text-muted-foreground">"{j.dispatch_note}"</div>}
              <ChainTimeline jobId={j.id} />
              <div className="flex gap-2 pt-1">
                <Button
                  size="sm"
                  className="flex-1"
                  onClick={() => respondMut.mutate({ job_id: j.id, decision: "accepted" })}
                >
                  Accept
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="flex-1"
                  onClick={() => respondMut.mutate({ job_id: j.id, decision: "rejected" })}
                >
                  Reject
                </Button>
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
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 px-3 py-2 text-sm font-medium"
      >
        {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        <PlaneTakeoff className="h-4 w-4 text-primary" />
        <span>Outbound — trips at partners (live)</span>
        <Badge variant="secondary" className="ml-1">
          {items.length}
        </Badge>
      </button>
      {open && (
        <div className="grid gap-2 p-3 pt-0 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((j: any) => (
            <div key={j.id} className="rounded-md border bg-background p-3 space-y-2">
              <div className="flex items-center gap-2 flex-wrap text-xs">
                <Badge variant="outline">at {j.executor?.name ?? "partner"}</Badge>
                <span className="font-medium">
                  {j.date} {j.time?.slice(0, 5)}
                </span>
                <Badge
                  variant={
                    j.dispatch_status === "accepted"
                      ? "default"
                      : j.dispatch_status === "rejected"
                        ? "destructive"
                        : "secondary"
                  }
                >
                  {j.dispatch_status}
                </Badge>
                {j.drivers?.name && <Badge variant="secondary">👤 {j.drivers.name}</Badge>}
                <span className="ml-auto text-muted-foreground">{j.status}</span>
              </div>
              <div className="text-sm font-medium truncate">
                {j.from_location} → {j.to_location}
              </div>
              <ChainTimeline jobId={j.id} />
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

/* ---------- Pending Client Approval ---------- */
function PendingClientApprovalBoard({ jobs, ctx, onChanged }: { jobs: Job[]; ctx: CardCtx; onChanged: () => void }) {
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
    } finally {
      setBusy(null);
    }
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
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="rounded-lg border-2 border-amber-400/60 bg-amber-50/60 dark:bg-amber-950/20 p-3 space-y-2">
      <div className="flex items-center gap-2 text-sm font-semibold text-amber-900 dark:text-amber-200">
        <Inbox className="h-4 w-4" /> Client requests awaiting approval ({jobs.length})
      </div>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {jobs.map((j) => {
          const paxLine = (j.pax ?? [])
            .map((p) => p.name)
            .filter(Boolean)
            .join(", ");
          return (
            <div key={j.id} className="rounded-md border bg-card p-2.5 space-y-1.5 text-xs">
              <div className="flex items-center justify-between gap-2">
                <div className="font-medium truncate">
                  {j.from_location} → {j.to_location}
                </div>
                <Badge variant="outline" className="shrink-0 text-[10px]">
                  {j.source === "client_followup" ? "Follow-up" : "Client"}
                </Badge>
              </div>
              <div className="text-muted-foreground">
                {j.date} · {j.time?.slice(0, 5)}
                {(j.pax?.length ?? 0) > 0 && <> · {j.pax!.length} pax</>}
              </div>
              {paxLine && <div className="truncate text-muted-foreground">{paxLine}</div>}
              {j.clientcompanyname && (
                <div className="truncate text-muted-foreground">Client: {j.clientcompanyname}</div>
              )}
              <TripFlagBadges job={j} ctx={ctx} />
              <div className="flex gap-1.5 pt-1">
                <Button size="sm" className="flex-1 h-7" disabled={busy === j.id} onClick={() => approve(j.id)}>
                  Approve
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="flex-1 h-7"
                  disabled={busy === j.id}
                  onClick={() => reject(j.id)}
                >
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
  const suggestionsEnabled = useFeature("ai_auto_coordinate");
  const suggestions = useMemo(() => (suggestionsEnabled ? suggestGroups(jobs) : []), [jobs, suggestionsEnabled]);
  return (
    <div
      ref={setNodeRef}
      className={`rounded-lg border bg-card p-3 min-h-[220px] ${isOver ? "ring-2 ring-primary" : ""}`}
    >
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
                <span className="font-medium">{s.jobs.length} trips</span> · {s.label}
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
      <SelectAllInLane jobs={jobs} ctx={ctx} />
      <div className="space-y-2">
        <PendingPortalBookings />
        {jobs.length === 0 && (
          <div className="text-xs text-muted-foreground py-6 text-center">Everything is assigned</div>
        )}
        {renderItems(items, ctx)}
      </div>

    </div>
  );
}

function PendingPortalBookings() {
  const listFn = useServerFn(listPortalBookings);
  const acceptFn = useServerFn(acceptPortalBooking);
  const rejectFn = useServerFn(rejectPortalBooking);
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ["portal-bookings", "pending"],
    queryFn: () => listFn({ data: { status: "pending" } }) as Promise<any[]>,
    refetchInterval: 20_000,
  });
  const acceptMut = useMutation({
    mutationFn: (id: string) => acceptFn({ data: { booking_id: id } }),
    onSuccess: () => {
      toast.success("Approved — moved to Unassigned");
      qc.invalidateQueries({ queryKey: ["portal-bookings"] });
      qc.invalidateQueries({ queryKey: ["jobs"] });
    },
    onError: (e: Error) =>
      e.message === "insufficient_points" ? toast.error("Top-Up required to approve") : toast.error(e.message),
  });
  const rejectMut = useMutation({
    mutationFn: (id: string) => rejectFn({ data: { booking_id: id } }),
    onSuccess: () => {
      toast.success("Rejected");
      qc.invalidateQueries({ queryKey: ["portal-bookings"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const rows = data ?? [];
  if (rows.length === 0) return null;
  return (
    <div className="space-y-2">
      {rows.map((b: any) => {
        const portal = b.portal_companies ?? {};
        const brand = portal.brand_color || "hsl(38 92% 50%)";
        const payload = b.payload ?? {};
        const fullName = `${payload.name ?? ""} ${payload.surname ?? ""}`.trim() || "New booking";
        return (
          <div key={b.id} className="rounded-md border bg-card p-2.5" style={{ boxShadow: `inset 4px 0 0 ${brand}` }}>
            <div className="flex items-start gap-2">
              {portal.logo_url ? (
                <img
                  src={portal.logo_url}
                  alt={portal.name ?? "Hotel"}
                  className="h-8 w-8 rounded object-cover border shrink-0"
                />
              ) : (
                <div
                  className="h-8 w-8 rounded border shrink-0 flex items-center justify-center text-[10px] font-bold text-white"
                  style={{ backgroundColor: brand }}
                >
                  {(portal.name ?? "H").slice(0, 2).toUpperCase()}
                </div>
              )}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span
                    className="text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded"
                    style={{ backgroundColor: `${brand}22`, color: brand }}
                  >
                    {portal.name ?? "Portal"}
                  </span>
                  <Badge variant="secondary" className="text-[10px]">
                    Pending
                  </Badge>
                </div>
                <div className="font-medium text-sm mt-1 truncate">{fullName}</div>
                <div className="text-xs mt-0.5 truncate">
                  {payload.from_location} → {payload.to_location}
                </div>
                {(() => {
                  const d = payload.date ?? (payload.pickup_at ? String(payload.pickup_at).slice(0, 10) : null);
                  const t = payload.time
                    ? String(payload.time).slice(0, 5)
                    : payload.pickup_at
                      ? formatMaltaTime(String(payload.pickup_at))
                      : null;
                  return (
                    <div className="text-[11px] font-semibold text-foreground">
                      {d ?? "—"}
                      {t ? ` · ${t}` : ""}
                    </div>
                  );
                })()}
                {payload.flight_number && (
                  <div className="text-[11px] text-muted-foreground truncate">✈ {payload.flight_number}</div>
                )}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-1.5 mt-2">
              <Button
                size="sm"
                className="h-8 text-xs w-full"
                disabled={acceptMut.isPending}
                onClick={() => acceptMut.mutate(b.id)}
              >
                Approve
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-8 text-xs w-full"
                disabled={rejectMut.isPending}
                onClick={() => rejectMut.mutate(b.id)}
              >
                Reject
              </Button>
            </div>
          </div>
        );
      })}
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
          label: `${first.date} · ${first.from_location} → ${first.to_location} (${cluster[0].time?.slice(0, 5)}–${cluster[cluster.length - 1].time?.slice(0, 5)})`,
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
      else {
        flush();
        cluster = [sorted[i]];
      }
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
  return Math.abs(bh * 60 + (bm || 0) - (ah * 60 + (am || 0)));
}

function DriverLanes({ drivers, jobs, ctx }: { drivers: Driver[]; jobs: Job[]; ctx: CardCtx }) {
  const listConn = useServerFn(listConnections);
  const conns = useQuery({ queryKey: ["collab", "connections"], queryFn: () => listConn(), refetchInterval: 30_000 });
  const partners = (conns.data ?? []).filter((c: any) => c.status === "active");
  return (
    <div className="rounded-lg border bg-card p-3 overflow-x-auto">
      <div className="grid gap-3 sm:auto-cols-[minmax(240px,1fr)] sm:grid-flow-col">
        {partners.map((c: any) => {
          const laneJobs = jobs.filter((j) => {
            const chain: string[] = Array.isArray((j as any).dispatch_chain_company_ids)
              ? (j as any).dispatch_chain_company_ids
              : [];
            return chain.includes(c.other.id) || (j as any).executor_company_id === c.other.id;
          });
          return (
            <PartnerLane key={c.other.id} partnerId={c.other.id} partnerName={c.other.name} jobs={laneJobs} ctx={ctx} />
          );
        })}
        {drivers.length === 0 && partners.length === 0 && (
          <div className="text-sm text-muted-foreground p-8 text-center">Add drivers or partners to see lanes.</div>
        )}
        {drivers.map((d) => (
          <DriverLane
            key={d.id}
            driver={d}
            jobs={jobs.filter((j) => j.driver_id === d.id && !(j as any)._origin_job_id)}
            ctx={ctx}
          />
        ))}
      </div>
    </div>
  );
}

function PartnerLane({
  partnerId,
  partnerName,
  jobs,
  ctx,
}: {
  partnerId: string;
  partnerName: string;
  jobs: Job[];
  ctx: CardCtx;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `partner:${partnerId}` });
  const items = bucketByGroup(jobs);
  const color = partnerColor(partnerId);
  return (
    <div
      ref={setNodeRef}
      style={{ borderColor: color, boxShadow: isOver ? `inset 0 0 0 2px ${color}` : undefined }}
      className={`rounded-md border-2 border-dashed p-2 min-h-[220px] bg-amber-50/40 dark:bg-amber-950/10 ${isOver ? "bg-amber-100/60" : ""}`}
    >
      <div className="text-sm font-medium truncate flex items-center gap-1">
        <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: color }} />
        <PlaneTakeoff className="h-3.5 w-3.5" style={{ color }} /> Partner · {partnerName}
      </div>
      <div className="text-xs text-muted-foreground mb-2 truncate">Drop a trip here to send</div>
      <SelectAllInLane jobs={jobs} ctx={ctx} />
      <div className="space-y-2">
        {jobs.length === 0 ? (
          <div className="text-xs text-muted-foreground text-center py-6">No trips at this partner</div>
        ) : (
          renderItems(items, ctx)
        )}
      </div>

    </div>
  );
}

function DriverLane({ driver, jobs, ctx }: { driver: Driver; jobs: Job[]; ctx: CardCtx }) {
  const { setNodeRef, isOver } = useDroppable({ id: `driver:${driver.id}` });
  const items = bucketByGroup(jobs);
  return (
    <div
      ref={setNodeRef}
      className={`rounded-md border p-2 min-h-[220px] ${isOver ? "ring-2 ring-primary bg-primary/5" : ""}`}
    >
      <div className="text-sm font-medium truncate">{driver.name}</div>
      <div className="text-xs text-muted-foreground mb-2 truncate">{driver.vehicle ?? "—"}</div>
      <SelectAllInLane jobs={jobs} ctx={ctx} />
      <div className="space-y-2">{renderItems(items, ctx)}</div>

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
              <SelectAllInLane jobs={dayJobs} ctx={ctx} label="Select all this day" />
              <div className="space-y-2">{renderItems(items, ctx, driverName)}</div>

            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ------------------------------ Grouped stack card ------------------------------ */

function GroupedStackCard({
  groupId,
  jobs,
  ctx,
  driverNameOf,
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
          ? formatMaltaDateTime(j.pickup_at, { month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" })
          : `${j.date} ${j.time?.slice(0, 5) ?? ""}`;
        const from = [j.from_location, j.from_flight].filter(Boolean).join(" ");
        const to = [j.to_location, j.to_flight].filter(Boolean).join(" ");
        lines.push(`• ${when} — ${from} → ${to} (${j.pax_count}p)`);
      }
      if (res.group_note) {
        lines.push("");
        lines.push(`📝 ${res.group_note}`);
      }
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
            <span className="truncate">
              {groupName || "Grouped"} · {jobs.length}
            </span>
          </div>
          <div className="ml-auto flex items-center gap-1">
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-2 text-[11px]"
              onClick={() => ctx.onEditGroup(groupId, jobs)}
              title="Edit group name, note, driver"
            >
              <Pencil className="h-3.5 w-3.5 mr-1" /> Edit
            </Button>
            {jobs.every((j) => j.driver_id === jobs[0].driver_id) && jobs[0].driver_id && (
              <Button
                size="sm"
                variant="ghost"
                className="h-7 px-2 text-[11px] text-emerald-600"
                onClick={() => shareGroupMut.mutate()}
                disabled={shareGroupMut.isPending}
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
        {groupNote && <div className="text-[11px] text-muted-foreground italic px-1">{groupNote}</div>}
        <div className="space-y-2">
          {jobs.map((j) => (
            <TripCard key={j.id} job={j} ctx={ctx} driverName={driverNameOf?.(j)} />
          ))}
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
          {...attributes}
          {...listeners}
          aria-label="Drag group"
          onClick={(e) => e.stopPropagation()}
        >
          <GripVertical className="h-4 w-4" />
        </button>
        <button type="button" onClick={() => ctx.onToggleExpandedGroup(groupId)} className="w-full text-left pr-6">
          <div className="flex items-center gap-2 text-[11px] text-primary font-semibold uppercase tracking-wide">
            <Link2 className="h-3 w-3" />
            <span className="truncate">{groupName || "Grouped"}</span>
            <Badge variant="secondary" className="ml-auto text-[10px]">
              {jobs.length} trips · {totalPax} pax
            </Badge>
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
                <span className="ml-auto text-[10px] text-muted-foreground shrink-0">{j.pax?.length ?? 0}p</span>
              </div>
            ))}
            {jobs.length > 4 && <div className="text-[10px] text-muted-foreground">+ {jobs.length - 4} more…</div>}
          </div>
          {groupNote && <div className="text-[11px] text-muted-foreground italic mt-1 truncate">{groupNote}</div>}
          <div className="text-[10px] text-primary/70 mt-1">Tap to expand · drag to assign</div>
        </button>
      </div>
    </div>
  );
}

/* ---------- Collapsed strip for completed / cancelled trips ---------- */
function CompletedStrip({
  job,
  ctx,
  driverName,
  isSelected,
}: {
  job: Job;
  ctx: CardCtx;
  driverName?: string;
  isSelected: boolean;
}) {
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
        <Checkbox checked={isSelected} onCheckedChange={() => ctx.onToggleSelect(job.id)} aria-label="Select trip" />
      </div>
      <button
        type="button"
        onClick={() => ctx.onOpenDetails(job)}
        className="flex-1 flex items-center gap-2 min-w-0 text-left"
        title={cancelled ? "Cancelled" : "Completed"}
      >
        <span className="font-medium text-foreground">{job.time?.slice(0, 5)}</span>
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

function TripFlagBadges({ job, ctx }: { job: Job; ctx: CardCtx }) {
  const flags = ctx.tripFlags?.[job.id];
  if (!flags) return null;
  const hasDup = flags.duplicates.length > 0;
  const hasSus = flags.suspicious.length > 0;
  if (!hasDup && !hasSus) return null;
  const currentPax = (job.pax ?? []).map((p) => p.name).filter(Boolean) as string[];
  const current: MergeCandidate = {
    id: job.id,
    date: job.date,
    time: job.time,
    from_location: job.from_location,
    to_location: job.to_location,
    pax_names: currentPax,
  };
  return (
    <div className="mt-1.5 space-y-1" onClick={(e) => e.stopPropagation()}>
      {hasDup && (
        <div className="flex items-center gap-1.5 flex-wrap rounded-md border border-destructive/50 bg-destructive/10 px-2 py-1">
          <AlertTriangle className="h-3 w-3 text-destructive shrink-0" />
          <span className="text-[10px] font-semibold text-destructive">⚠️ Potential Duplicate Trip</span>
          <span className="text-[10px] text-destructive/80">× {flags.duplicates.length}</span>
          <div className="ml-auto flex items-center gap-1">
            <button
              type="button"
              onClick={() => ctx.onOpenMerge?.(current, flags.duplicates)}
              className="text-[10px] font-medium inline-flex items-center gap-1 rounded px-1.5 py-0.5 bg-destructive text-destructive-foreground hover:opacity-90"
            >
              <GitMerge className="h-3 w-3" /> Merge
            </button>
            <button
              type="button"
              onClick={() => ctx.onDismissFlag?.(job.id, "duplicate")}
              className="text-[10px] inline-flex items-center gap-1 rounded px-1.5 py-0.5 border border-destructive/40 text-destructive hover:bg-destructive/10"
              aria-label="Dismiss duplicate alert"
            >
              <XIcon className="h-3 w-3" /> Dismiss
            </button>
          </div>
        </div>
      )}
      {hasSus && (
        <div className="flex items-center gap-1.5 flex-wrap rounded-md border border-amber-500/60 bg-amber-500/10 px-2 py-1">
          <Search className="h-3 w-3 text-amber-700 dark:text-amber-400 shrink-0" />
          <span className="text-[10px] font-semibold text-amber-800 dark:text-amber-200">
            🔍 Suspicious Pattern: Verify Flight Numbers
          </span>
          <span className="text-[10px] text-amber-700/80 dark:text-amber-300/80">× {flags.suspicious.length}</span>
          <button
            type="button"
            onClick={() => ctx.onDismissFlag?.(job.id, "suspicious")}
            className="ml-auto text-[10px] inline-flex items-center gap-1 rounded px-1.5 py-0.5 border border-amber-500/60 text-amber-800 dark:text-amber-200 hover:bg-amber-500/10"
            aria-label="Dismiss suspicious alert"
          >
            <XIcon className="h-3 w-3" /> Dismiss
          </button>
        </div>
      )}
    </div>
  );
}

function useLiveEtaPoint(jobId: string): LiveEtaPoint | null {
  const fn = useServerFn(listActiveDriverLocations);
  const pollingOn = useAiToggle("live_eta_polling");
  const { data } = useQuery({
    queryKey: ["live-locations"],
    queryFn: () => fn({ data: { since_minutes: 30 } }) as Promise<LiveEtaPoint[]>,
    refetchInterval: pollingOn ? 30_000 : false,
    staleTime: 20_000,
    enabled: pollingOn,
  });
  return (data ?? []).find((p) => p.job_id === jobId) ?? null;
}

function fmtEtaShort(sec: number): string {
  if (sec < 60) return "<1 min";
  if (sec < 3600) return `${Math.max(1, Math.round(sec / 60))}m`;
  return `${Math.floor(sec / 3600)}h ${Math.round((sec % 3600) / 60)}m`;
}

function computeLateMin(job: Job, etaSec: number | null | undefined): number | null {
  if (etaSec == null || !job.date || !job.time) return null;
  const pickupMs = new Date(`${job.date}T${job.time.length === 5 ? `${job.time}:00` : job.time}`).getTime();
  if (!Number.isFinite(pickupMs)) return null;
  const projected = Date.now() + etaSec * 1000;
  return Math.round((projected - pickupMs) / 60000);
}

function EtaChip({ point, job }: { point: LiveEtaPoint | null; job: Job }) {
  if (!point) return null;
  const fresh = Date.now() - new Date(point.captured_at).getTime() < 90_000;
  if (!fresh) return null;
  if (point.wait_started_at) return null;
  const status = job.status;
  if (!["en_route", "arrived", "in_progress"].includes(status)) return null;
  if (status === "arrived") {
    return (
      <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-700 whitespace-nowrap">
        Arrived
      </span>
    );
  }
  const eta = point.eta_sec;
  if (eta == null) return null;
  const label = fmtEtaShort(eta);
  if (status === "in_progress") {
    return (
      <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-sky-500/15 text-sky-700 whitespace-nowrap">
        Drop in {label}
      </span>
    );
  }
  const lateMin = computeLateMin(job, eta);
  const isLate = lateMin != null && lateMin > 2;
  return isLate ? (
    <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-800 border border-amber-500/40 whitespace-nowrap">
      Late {lateMin}m
    </span>
  ) : (
    <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-primary/10 text-primary whitespace-nowrap">
      ETA {label}
    </span>
  );
}

function formatAgo(iso: string): string {
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
}

function WaitTimerChip({ startedAt, pickupAt }: { startedAt: string; pickupAt: string | null }) {
  // Charged wait clock is anchored to max(now, pickup_at) — mirror the display side.
  const anchor = (() => {
    const started = new Date(startedAt).getTime();
    if (!pickupAt) return started;
    const pickup = new Date(pickupAt).getTime();
    return Math.max(started, pickup);
  })();
  const min = Math.max(0, Math.floor((Date.now() - anchor) / 60000));
  if (min <= 0) return null;
  const tone =
    min >= 15
      ? "bg-red-500/15 text-red-700 border-red-500/40"
      : min >= 5
        ? "bg-amber-500/15 text-amber-800 border-amber-500/40"
        : "bg-muted text-foreground border-border";
  return (
    <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border ${tone} whitespace-nowrap`}>
      Wait {min}m
    </span>
  );
}


function TripCard({ job, ctx, driverName }: { job: Job; ctx: CardCtx; driverName?: string }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: job.id });
  const [openClone, setOpenClone] = useState(false);
  const [openSplit, setOpenSplit] = useState(false);
  const [openDispatch, setOpenDispatch] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const paxCount = job.pax?.length ?? 0;
  const unreadCounts = ctx.unread[job.id] ?? { driver: 0, client: 0, total: 0 };
  const unread = unreadCounts.total;
  const flightIssue =
    job.flight_status === "delayed" || job.flight_status === "cancelled" || job.flight_status === "time_mismatch";
  const flightEarly = job.flight_status === "early";
  const problem = flightIssue || !!job.deletion_requested_at;
  const assignedAccepted = !!job.driver_id && !!job.driver_accepted_at;
  const assignedPending = !!job.driver_id && !job.driver_accepted_at;

  const sig = ctx.signals?.[job.id];
  const isFinished = job.status === "completed" || job.status === "cancelled";
  const hasUnread = (sig?.unread_client ?? 0) + (sig?.unread_driver ?? 0) > 0;
  const clientChange = !!sig?.client_change;
  const sosOpen = !!sig?.sos_open;
  const driverStatusNew = !!sig?.driver_status_new && !!job.driver_id;
  const rejected = !!(sig as any)?.rejected;

  // Partnership state: amber = handed off & pending, green = partner accepted, red = partner rejected.
  const partnerPending =
    (job.chain_role === "creator_watching" || job.chain_role === "hop_watching") && job.dispatch_status === "pending";
  const partnerRejected = job.dispatch_status === "rejected";
  const partnerAccepted =
    (job.chain_role === "creator_watching" || job.chain_role === "hop_watching") && job.dispatch_status === "accepted";

  const livePoint = useLiveEtaPoint(job.id);
  const isLatePickup = (() => {
    if (!livePoint || livePoint.wait_started_at) return false;
    if (job.status !== "en_route") return false;
    const fresh = Date.now() - new Date(livePoint.captured_at).getTime() < 90_000;
    if (!fresh) return false;
    const late = computeLateMin(job, livePoint.eta_sec);
    return late != null && late > 2;
  })();

  // Color priority: red > blue(unread) > partner state > late > driver-accepted > driver-pending > default
  const tone =
    problem || partnerRejected
      ? "border-destructive bg-destructive/10"
      : unread > 0 || hasUnread
        ? "border-blue-500 bg-blue-500/10 ring-1 ring-blue-500/40"
        : partnerPending
          ? "border-amber-500 bg-amber-500/10 ring-1 ring-amber-500/30"
          : isLatePickup
            ? "border-amber-500 bg-amber-500/10 ring-1 ring-amber-500/30"
            : partnerAccepted
              ? "border-emerald-500/70 bg-emerald-500/5"
              : assignedAccepted
                ? "border-emerald-500/70 bg-emerald-500/5"
                : assignedPending
                  ? "border-amber-500/70 bg-amber-500/5"
                  : "border-border bg-background";

  // Colored left rim shows which partner currently holds the trip (creator's-eye view).
  const rimColor =
    (job.chain_role === "creator_watching" || job.chain_role === "hop_watching") && job.executor_company_id
      ? partnerColor(job.executor_company_id)
      : null;

  const delayed = flightIssue;
  const flightCode = job.from_flight || job.to_flight || job.flightorship;
  const newTime = (() => {
    const iso = job.flight_estimated_at || job.flight_scheduled_at;
    if (!iso) return "";
    try {
      return isoToMaltaDateTime(iso).time;
    } catch {
      return "";
    }
  })();
  const schedTime = (() => {
    const iso = job.flight_scheduled_at;
    if (!iso) return "";
    try {
      return isoToMaltaDateTime(iso).time;
    } catch {
      return "";
    }
  })();
  const hasFlightCode = !!(job.from_flight || job.to_flight);
  const flightMsg =
    job.flight_status === "cancelled"
      ? "CANCELLED"
      : job.flight_status === "time_mismatch"
        ? job.flight_status_note || (newTime ? `flight ${newTime} ≠ pickup` : "TIME MISMATCH")
        : job.flight_status === "delayed"
          ? job.flight_status_note || (newTime ? `DELAYED → ${newTime}` : "DELAYED")
          : flightEarly
            ? newTime
              ? `EARLY → ${newTime}${schedTime ? ` (was ${schedTime})` : ""}`
              : job.flight_status_note || "EARLY"
            : hasFlightCode && schedTime
              ? `Flight ${schedTime}`
              : hasFlightCode && (job.flight_status === "unknown" || !job.flight_status)
                ? (job.flight_status_note || "Not tracked · check code")
                : "";

  const labels = job.labels ?? [];
  const shownDriver = driverName ?? job.drivers?.name ?? null;

  const isSelected = ctx.selected.has(job.id);

  // Collapsed strip for finished / cancelled trips
  if (isFinished) {
    return <CompletedStrip job={job} ctx={ctx} driverName={shownDriver ?? undefined} isSelected={isSelected} />;
  }

  const totalUnreadSignal = (sig?.unread_client ?? 0) + (sig?.unread_driver ?? 0);

  const gStripe = groupStripeStyle(job.group_id);
  const style: React.CSSProperties = {
    ...(transform
      ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`, opacity: isDragging ? 0.7 : 1 }
      : {}),
    ...(gStripe ?? {}),
    ...(rimColor ? { borderLeftColor: rimColor, borderLeftWidth: 6 } : {}),
  };

  // Urgency glow — unassigned / unaccepted trips only, tiered by minutes to pickup.
  // `nowTick` is bumped every 60s so this re-evaluates without extra data fetches.
  const _tickReadForRerender = ctx.nowTick;
  const uTier = urgencyTier(job.pickup_at, {
    assigned: !!job.driver_id,
    accepted: !!job.driver_accepted_at,
    now: _tickReadForRerender,
    thresholds: ctx.urgency,
  });
  const uClass = urgencyClasses(uTier);

  return (
    <div
      ref={setNodeRef}
      data-job-id={job.id}
      style={style}
      className={`relative rounded-md border-2 pl-8 pr-2 py-2 shadow-sm transition-shadow ${tone} ${uClass} ${isSelected ? "ring-2 ring-primary" : ""} ${ctx.highlightId === job.id ? "ring-2 ring-primary ring-offset-1 animate-pulse" : ""}`}
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
        <span
          className="signal-corner-rejected"
          title="Driver rejected — back in Unassigned"
          aria-label="Driver rejected"
        />
      ) : clientChange ? (
        <span className="signal-corner-change" title="Client requested a change" aria-label="Client change" />
      ) : null}

      {/* Multi-select checkbox */}
      <div className="absolute top-2 left-2 z-10" onClick={(e) => e.stopPropagation()}>
        <Checkbox checked={isSelected} onCheckedChange={() => ctx.onToggleSelect(job.id)} aria-label="Select trip" />
      </div>




      {/* Tap area — opens details sheet */}
      <button type="button" onClick={() => ctx.onOpenDetails(job)} className="w-full text-left">
        <div className="flex items-center gap-2 min-w-0">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
              {job.trip_no != null && (
                <span
                  className="inline-flex items-center rounded-md border border-primary/40 bg-primary/10 px-1.5 py-0.5 text-[11px] font-mono font-semibold text-primary"
                  title={`Trip #${job.trip_no}`}
                >
                  #{job.trip_no}
                </span>
              )}
              <span className="font-medium text-foreground">{job.time?.slice(0, 5)}</span>
              <span>·</span>
              <span>{job.date}</span>
              {job.client_confirmed_at && (
                <span
                  title="Client confirmed"
                  className="inline-flex items-center text-emerald-600"
                  aria-label="Client confirmed"
                >
                  ✓
                </span>
              )}
              {(() => {
                const seen = ctx.clientPresence?.[job.id];
                if (!seen) return null;
                const ageMs = Date.now() - new Date(seen).getTime();
                if (ageMs > 2 * 60_000) return null;
                return (
                  <span
                    title="Client online"
                    className="inline-block h-2 w-2 rounded-full bg-emerald-500 animate-pulse"
                    aria-label="Client online"
                  />
                );
              })()}
              {driverStatusNew && (
                <span className="signal-dot-driver" title="Driver status updated" aria-label="Driver status updated" />
              )}
              <span className="ml-auto flex items-center gap-1">
                {unreadCounts.driver > 0 && (
                  <span
                    className="inline-flex items-center gap-0.5 text-blue-600 font-medium"
                    title="Unread driver messages"
                  >
                    <MessagesSquare className="h-3 w-3" /> {unreadCounts.driver}
                  </span>
                )}
                {unreadCounts.client > 0 && (
                  <span
                    className="inline-flex items-center gap-0.5 text-sky-600 font-medium"
                    title="Unread client messages"
                  >
                    <MessageCircle className="h-3 w-3" /> {unreadCounts.client}
                  </span>
                )}
              </span>
            </div>
            <div className="text-sm font-semibold truncate mt-0.5">
              {displayLocation(job.from_location, job.pickup_display_name)}{" "}
              <span className="text-muted-foreground">→</span>{" "}
              {displayLocation(job.to_location, job.dropoff_display_name)}
            </div>
            {(job.route_duration_sec ?? 0) > 0 && (
              <div className="mt-1 flex items-center gap-2 text-[11px] tabular-nums">
                <Clock className="h-3 w-3 text-muted-foreground shrink-0" />
                <span className="font-semibold text-foreground">
                  {formatEtaMinutes(job.route_duration_sec)}
                </span>
                {job.route_distance_m ? (
                  <span className="text-muted-foreground">
                    · {(job.route_distance_m / 1000).toFixed(1)} km
                  </span>
                ) : null}
                {job.pickup_at && (job.route_duration_sec ?? 0) > 0 && (
                  <span className="text-muted-foreground">
                    · arr{" "}
                    <span className="text-foreground font-medium">
                      {formatMaltaTime(
                        new Date(
                          new Date(job.pickup_at).getTime() +
                            (job.route_duration_sec ?? 0) * 1000,
                        ).toISOString(),
                      )}
                    </span>
                  </span>
                )}
                {(job.traffic_delay_minutes ?? 0) > 0 && (
                  <span className="text-destructive font-medium">
                    +{job.traffic_delay_minutes} min traffic
                  </span>
                )}
              </div>
            )}
            {expanded && job.clientcompanyname && (
              <div className="text-[11px] text-muted-foreground truncate">{job.clientcompanyname}</div>
            )}
            {shownDriver && (
              <div className="text-[11px] mt-0.5 truncate">
                <span className="text-muted-foreground">Driver:</span>{" "}
                <span className="font-medium">{shownDriver}</span>
                {assignedAccepted && <span className="ml-1 text-emerald-600">✓ accepted</span>}
                {assignedPending && <span className="ml-1 text-amber-600">• pending</span>}
              </div>
            )}
            <TripConflictBadge jobId={job.id} driverId={job.driver_id} date={job.date} />
            {delayed && (
              <div className="mt-0.5 inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-semibold text-destructive border border-destructive/60 bg-destructive/10 ring-1 ring-destructive/50 shadow-[0_0_0_2px_rgba(239,68,68,0.25)] animate-pulse truncate max-w-full">
                ✈ {flightCode} {flightMsg}
              </div>
            )}
            {flightEarly && (
              <div className="mt-0.5 inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium text-blue-600 dark:text-blue-400 border border-blue-500/40 bg-blue-500/10 truncate max-w-full">
                ✈ {flightCode} {flightMsg}
              </div>
            )}
            {!delayed && !flightEarly && hasFlightCode && (job.flight_status === "on_time" || job.flight_status === "landed" || job.flight_status === "arrived" || job.flight_status === "departed") && (
              <div className="mt-0.5 inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium text-emerald-600 dark:text-emerald-400 border border-emerald-500/40 bg-emerald-500/10 truncate max-w-full">
                ✈ {flightCode} · {flightMsg || job.flight_status}
              </div>
            )}
            {expanded && !delayed && !flightEarly && hasFlightCode && schedTime && !flightMsg.startsWith("Not tracked") && !(job.flight_status === "on_time" || job.flight_status === "landed" || job.flight_status === "arrived" || job.flight_status === "departed") && (
              <div className="text-[11px] text-muted-foreground mt-0.5 truncate">
                ✈ {flightCode} · {flightMsg}
              </div>
            )}
            {!delayed && !flightEarly && hasFlightCode && (job.flight_status === "unknown" || !job.flight_status) && !schedTime && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  ctx.openFlightFix?.({
                    jobId: job.id,
                    code: job.from_flight || job.to_flight || "",
                    side: job.from_flight ? "from" : "to",
                  });
                }}
                className="mt-0.5 inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium text-amber-700 dark:text-amber-400 border border-amber-500/40 bg-amber-500/10 hover:underline truncate max-w-full text-left"
                title="Click to fix the flight code"
              >
                ✈ {flightCode} · Not tracked · fix code
              </button>
            )}
            {hasFlightCode && (
              <FlightRefreshButton jobId={job.id} hasCode variant="icon" className="ml-1 align-middle" />
            )}

            {job.status && job.status !== "pending" && job.status !== "active" && (
              <div className="mt-1.5 flex items-center gap-2 flex-wrap">
                <TripProgress status={job.status} compact />
                <EtaChip point={livePoint} job={job} />
                {livePoint?.wait_started_at && (
                  <WaitTimerChip startedAt={livePoint.wait_started_at} pickupAt={job.pickup_at ?? null} />
                )}
                {livePoint && (
                  <span
                    className="text-[10px] text-muted-foreground"
                    title={new Date(livePoint.captured_at).toLocaleTimeString()}
                  >
                    · updated {formatAgo(livePoint.captured_at)}
                  </span>
                )}
              </div>
            )}
            {(job.driver_id || (job.traffic_delay_minutes ?? 0) > 0) && (
              <TrafficBadge
                info={{
                  traffic_delay_minutes: job.traffic_delay_minutes,
                  traffic_severity: job.traffic_severity,
                  leave_by_at: job.leave_by_at,
                  pickup_shift_reason: job.pickup_shift_reason,
                }}
                compact
                className="mt-1"
              />
            )}
            <div className="flex flex-wrap gap-1 mt-1">
              {paxCount > 0 &&
                (() => {
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
              {expanded && flightCode && !delayed && !flightEarly && (
                <Badge variant="outline" className="text-[10px]">
                  ✈ {flightCode}
                </Badge>
              )}
              {job.tracking_enabled && (
                <Badge variant="outline" className="text-[10px]">
                  Track
                </Badge>
              )}

              {job.deletion_requested_at && (
                <Badge variant="destructive" className="text-[10px]">
                  Delete pending
                </Badge>
              )}
              {job.chain_role === "creator_watching" && (
                <Badge variant="outline" className="text-[10px] border-amber-500/60 text-amber-700 dark:text-amber-400">
                  Watching · handed to {job.executor_name ?? "partner"}
                </Badge>
              )}
              {job.chain_role === "hop_watching" && job.external && (
                <Badge variant="outline" className="text-[10px] border-primary/60 text-primary">
                  Partner: {job.executor_name}
                  {job.external_driver_name ? ` · ${job.external_driver_name}` : ""}
                </Badge>
              )}
              {job.external && !job.chain_role && (
                <Badge variant="outline" className="text-[10px] border-primary/60 text-primary">
                  Partner: {job.executor_name}
                  {job.external_driver_name ? ` · ${job.external_driver_name}` : ""}
                </Badge>
              )}
              {labels.map((l) => (
                <LabelChip key={l.id} label={l} />
              ))}
            </div>
            <TripFlagBadges job={job} ctx={ctx} />

            {job.chain_names && job.chain_names.length >= 2 && (
              <div
                className="mt-1 flex flex-wrap items-center gap-1 text-[10px] text-muted-foreground"
                aria-label="Trip chain"
              >
                {job.chain_names.map((name, i) => {
                  const isLast = i === job.chain_names!.length - 1;
                  const dotColor =
                    i === 0
                      ? "hsl(var(--muted-foreground))"
                      : partnerColor((job.dispatch_chain_company_ids ?? [])[i] ?? null);
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

            {expanded && (
              <div className="mt-1.5 rounded-sm border border-border/60 bg-muted/30 px-2 py-1.5 space-y-0.5 text-[11px] text-muted-foreground">
                {job.contact_phone && (
                  <div className="truncate">
                    <span className="opacity-70">Phone:</span>{" "}
                    <a
                      href={`tel:${job.contact_phone}`}
                      onClick={(e) => e.stopPropagation()}
                      className="text-foreground hover:underline"
                    >
                      {job.contact_phone}
                    </a>
                  </div>
                )}
                {job.vehicle && (
                  <div className="truncate">
                    <span className="opacity-70">Vehicle:</span>{" "}
                    <span className="text-foreground">{job.vehicle}</span>
                  </div>
                )}
                {job.group_note && (
                  <div className="whitespace-pre-wrap">
                    <span className="opacity-70">Note:</span>{" "}
                    <span className="text-foreground">{job.group_note}</span>
                  </div>
                )}
                {!job.contact_phone && !job.vehicle && !job.group_note && !job.clientcompanyname && !hasFlightCode && (
                  <div className="italic opacity-70">No extra details</div>
                )}
              </div>
            )}

            <span
              role="button"
              tabIndex={0}
              onClick={(e) => {
                e.stopPropagation();
                setExpanded((v) => !v);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.stopPropagation();
                  e.preventDefault();
                  setExpanded((v) => !v);
                }
              }}
              className="mt-1 inline-flex items-center gap-0.5 text-[10px] text-muted-foreground hover:text-foreground cursor-pointer select-none"
              aria-expanded={expanded}
              aria-label={expanded ? "Hide details" : "Show more details"}
            >
              {expanded ? "Less" : "More"}
              <ChevronRight
                className={`h-3 w-3 transition-transform ${expanded ? "rotate-90" : ""}`}
              />
            </span>
          </div>
        </div>
      </button>

      {/* Action bar — large tap targets, well spaced from top-right kebab */}
      <div className="mt-2 flex items-stretch gap-1.5 border-t border-border/60 pt-2">
        <AskAiInlineButton trip={job} label="Ask AI" />
        <Button
          size="sm"
          variant="outline"
          className="flex-1 min-h-11"
          onClick={(e) => { e.stopPropagation(); ctx.onChat(job); }}
          aria-label="Open trip chat"
        >
          <MessagesSquare className="h-4 w-4 mr-1.5" />
          Message
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="flex-1 min-h-11"
          onClick={(e) => { e.stopPropagation(); ctx.onOpenDetails(job); }}
          aria-label="Open trip details"
        >
          <Info className="h-4 w-4 mr-1.5" />
          Details
        </Button>
      </div>




      {/* Top-right controls: drag (desktop) + menu */}
      <div className="absolute top-1.5 right-1 flex items-center gap-0.5">
        <button
          className="hidden sm:inline-flex text-muted-foreground p-1 touch-none"
          {...attributes}
          {...listeners}
          aria-label="Drag"
        >
          <GripVertical className="h-4 w-4" />
        </button>
        <TripMenu
          job={job}
          ctx={ctx}
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
  job,
  ctx,
  onOpenSplit,
  onOpenClone,
  onOpenDispatch,
  driverName,
}: {
  job: Job;
  ctx: CardCtx;
  onOpenSplit: () => void;
  onOpenClone: () => void;
  onOpenDispatch: () => void;
  driverName?: string;
}) {
  const requiresApproval = !!(job.driver_id && job.driver_accepted_at);
  const pending = !!job.deletion_requested_at;
  const qc = useQueryClient();
  const delFn = useServerFn(deleteJob);
  const cancelFn = useServerFn(cancelDeletionRequest);
  const delMut = useMutation({
    mutationFn: () => delFn({ data: { job_id: job.id } }),
    onSuccess: (res: { deleted: boolean; pending: boolean; missing?: boolean }) => {
      toast.success(
        res.missing
          ? "Trip already changed — board refreshed"
          : res.pending
            ? "Deletion requested — awaiting driver approval"
            : "Deleted",
      );
      qc.invalidateQueries({ queryKey: ["jobs"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const cancelMut = useMutation({
    mutationFn: () => cancelFn({ data: { job_id: job.id } }),
    onSuccess: () => {
      toast.success("Deletion cancelled");
      qc.invalidateQueries({ queryKey: ["jobs"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const ungroupFn = useServerFn(ungroupJobs);
  const ungroupMut = useMutation({
    mutationFn: () => ungroupFn({ data: { job_id: job.id } }) as Promise<{ cleared: number; missing?: boolean }>,
    onSuccess: (r) => {
      toast.success(
        r.missing
          ? "Trip already changed — board refreshed"
          : `Ungrouped ${r.cleared} trip${r.cleared === 1 ? "" : "s"}`,
      );
      qc.invalidateQueries({ queryKey: ["jobs"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const recallFn = useServerFn(recallPartnerDispatch);
  const recallMut = useMutation({
    mutationFn: () => recallFn({ data: { job_id: (job as any)._origin_job_id ?? job.id } }),
    onSuccess: () => {
      toast.success("Hand-off recalled");
      qc.invalidateQueries({ queryKey: ["jobs"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const canRecall = job.chain_role === "creator_watching" && job.dispatch_status === "pending";

  const shareFn = useServerFn(shareJobToDriver);
  const shareMut = useMutation({
    mutationFn: () => shareFn({ data: { job_id: job.id } }) as Promise<any>,
    onSuccess: (res: any) => {
      const url = `${window.location.origin}/m/driver/${res.token}`;
      const when = res.job.pickup_at
        ? formatMaltaDateTime(res.job.pickup_at, {
            weekday: "short",
            month: "short",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
          })
        : `${res.job.date}${res.job.time ? " " + res.job.time.slice(0, 5) : ""}`;
      const from = [res.job.from_location, res.job.from_flight].filter(Boolean).join(" ");
      const to = [res.job.to_location, res.job.to_flight].filter(Boolean).join(" ");
      const lines = [
        `🚐 New trip assigned${driverName ? ` — ${driverName}` : ""}`,
        `🕒 ${when}`,
        `📍 ${from || "?"} → ${to || "?"}`,
        `👥 ${res.job.pax_count ?? job.pax?.length ?? 0} pax`,
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
        ta.value = url;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        try {
          document.execCommand("copy");
          toast.success("Link copied");
        } catch {
          toast.error("Copy failed — " + url);
        } finally {
          document.body.removeChild(ta);
        }
      }
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const clientLinkFn = useServerFn(getClientTripLink);
  function buildClientWhatsappText(res: any) {
    const url = `${window.location.origin}/t/${res.token}`;
    const j = res.job;
    const when = j.pickup_at
      ? formatMaltaDateTime(j.pickup_at, {
          weekday: "short",
          month: "short",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
        })
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
      try {
        await navigator.clipboard.writeText(url);
        toast.success("Client link copied");
      } catch {
        toast.error("Copy failed — " + url);
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
        <IfFeature feature="chat">
          <DropdownMenuItem onClick={() => ctx.onChat(job)}>
            <MessagesSquare className="h-4 w-4 mr-2" /> Chat
          </DropdownMenuItem>
        </IfFeature>
        <DropdownMenuSeparator />
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <Users className="h-4 w-4 mr-2" /> Assign driver
          </DropdownMenuSubTrigger>
          <DropdownMenuPortal>
            <DropdownMenuSubContent className="max-h-72 overflow-y-auto w-56">
              <DropdownMenuItem onClick={() => ctx.onAssign(job, null)}>— Unassign —</DropdownMenuItem>
              <DropdownMenuSeparator />
              {ctx.drivers.length === 0 && <div className="px-2 py-1.5 text-xs text-muted-foreground">No drivers</div>}
              {ctx.drivers.map((d) => (
                <DropdownMenuItem key={d.id} onClick={() => ctx.onAssign(job, d.id)}>
                  {d.name}
                  {d.vehicle ? ` · ${d.vehicle}` : ""}
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
            <DropdownMenuLabel className="text-[10px] uppercase tracking-wide text-muted-foreground">
              Client
            </DropdownMenuLabel>
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
        <DropdownMenuItem asChild>
          <Link to="/coordinator/board-creator" search={{ jobId: job.id }}>
            <ImageIcon className="h-4 w-4 mr-2" /> 🪧 Create Sign Board
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onOpenDispatch}>
          <Send className="h-4 w-4 mr-2" /> Dispatch to partner…
        </DropdownMenuItem>
        {canRecall && (
          <DropdownMenuItem
            onClick={() => {
              if (confirm("Recall this hand-off before the partner accepts?")) recallMut.mutate();
            }}
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
            onClick={() => {
              if (confirm("Cancel the pending deletion request?")) cancelMut.mutate();
            }}
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
  const [preview, setPreview] = useState<NewTripRow[]>([]);
  const qc = useQueryClient();
  const fn = useServerFn(cloneJob);
  const mut = useMutation({
    mutationFn: () => fn({ data: { job_id: job.id, target_date: target } }),
    onSuccess: (row: any) => {
      toast.success("Cloned");
      onOpenChange(false);
      qc.invalidateQueries({ queryKey: ["jobs"] });
      if (row) setPreview([row as NewTripRow]);
    },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <>
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Clone trip</DialogTitle>
          <DialogDescription>Choose a target date.</DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label>Target date</Label>
          <Input type="date" value={target} onChange={(e) => setTarget(e.target.value)} />
        </div>
        <DialogFooter>
          <Button disabled={mut.isPending} onClick={() => mut.mutate()}>
            {mut.isPending ? "Cloning…" : "Clone"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    <NewTripsPreviewDialog
      open={preview.length > 0}
      onOpenChange={(v) => { if (!v) setPreview([]); }}
      title="Cloned trip created"
      description="Verify the cloned trip details and its client tracking link."
      trips={preview}
    />
    </>
  );
}


function SplitDialog({ open, onOpenChange, job }: { open: boolean; onOpenChange: (v: boolean) => void; job: Job }) {
  const [labels, setLabels] = useState<string[]>(["Vehicle A", "Vehicle B"]);
  const [preview, setPreview] = useState<NewTripRow[]>([]);
  const qc = useQueryClient();
  const fn = useServerFn(splitJob);
  const mut = useMutation({
    mutationFn: () => fn({ data: { job_id: job.id, splits: labels.filter(Boolean).map((l) => ({ label: l })) } }),
    onSuccess: (rows: any) => {
      toast.success("Split into new jobs");
      onOpenChange(false);
      qc.invalidateQueries({ queryKey: ["jobs"] });
      if (Array.isArray(rows) && rows.length) setPreview(rows as NewTripRow[]);
    },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <>
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Split trip into vehicles</DialogTitle>
          <DialogDescription>Creates one new job per row. Original stays.</DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          {labels.map((l, i) => (
            <Input
              key={i}
              value={l}
              onChange={(e) => setLabels(labels.map((x, j) => (j === i ? e.target.value : x)))}
            />
          ))}
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => setLabels([...labels, `Vehicle ${String.fromCharCode(65 + labels.length)}`])}
            >
              Add row
            </Button>
            {labels.length > 2 && (
              <Button size="sm" variant="ghost" onClick={() => setLabels(labels.slice(0, -1))}>
                Remove
              </Button>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button disabled={mut.isPending} onClick={() => mut.mutate()}>
            {mut.isPending ? "Splitting…" : "Split"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    <NewTripsPreviewDialog
      open={preview.length > 0}
      onOpenChange={(v) => { if (!v) setPreview([]); }}
      title="Split trips created"
      description="Verify each new vehicle card and its client tracking link."
      trips={preview}
    />
    </>
  );
}


function DispatchDialog({
  open,
  onOpenChange,
  job,
  preselectedPartnerId,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  job: Job;
  preselectedPartnerId?: string;
}) {
  const [partnerId, setPartnerId] = useState<string>("");
  const [note, setNote] = useState("");
  const qc = useQueryClient();
  const listConn = useServerFn(listConnections);
  const dispatchFn = useServerFn(dispatchJobToPartner);
  const conns = useQuery({ queryKey: ["collab", "connections"], queryFn: () => listConn(), enabled: open });
  useEffect(() => {
    if (open && preselectedPartnerId) setPartnerId(preselectedPartnerId);
    if (!open) {
      setPartnerId("");
      setNote("");
    }
  }, [open, preselectedPartnerId]);
  const mut = useMutation({
    mutationFn: async () =>
      await dispatchFn({ data: { job_id: job.id, partner_company_id: partnerId, note: note || undefined } }),
    onSuccess: () => {
      toast.success("Sent to partner");
      onOpenChange(false);
      qc.invalidateQueries({ queryKey: ["jobs"] });
      qc.invalidateQueries({ queryKey: ["collab"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Dispatch to partner</DialogTitle>
          <DialogDescription>Send this trip to a connected coordinator. Costs 1 point.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {(conns.data ?? []).length === 0 && (
            <p className="text-sm text-muted-foreground">No partners yet. Go to Collaborate to invite one.</p>
          )}
          <div className="space-y-1">
            {(conns.data ?? [])
              .filter((c: any) => c.status === "active")
              .map((c: any) => (
                <label key={c.id} className="flex items-center gap-2 border rounded p-2 cursor-pointer">
                  <input
                    type="radio"
                    name="partner"
                    checked={partnerId === c.other.id}
                    onChange={() => setPartnerId(c.other.id)}
                  />
                  <span className="font-medium">{c.other?.name}</span>
                  <Badge variant="outline" className="ml-auto">
                    {c.mode}
                  </Badge>
                </label>
              ))}
          </div>
          <div>
            <Label>Note (optional)</Label>
            <Input value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button disabled={!partnerId || mut.isPending} onClick={() => mut.mutate()}>
            Dispatch
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------ Details sheet host ------------------------------ */

function DetailsSheetHost({
  job,
  onClose,
  onEdit,
  onChat,
  onPax,
  driverName,
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
        ? formatMaltaDateTime(res.job.pickup_at, {
            weekday: "short",
            month: "short",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
          })
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
      onOpenChange={(v) => {
        if (!v) onClose();
      }}
      onEdit={() => job && onEdit(job)}
      onChat={() => job && onChat(job)}
      onPax={() => job && onPax(job)}
      onShare={() => job && shareMut.mutate(job.id)}
      onCopyLink={() => job && copyMut.mutate(job.id)}
      driverName={driverName}
    />
  );
}

function BoardingApprovalAlertPanel({
  alerts,
  onOpenJob,
}: {
  alerts: PendingBoardingApproval[];
  onOpenJob: (jobId: string) => void;
}) {
  if (!alerts.length) return null;
  return (
    <section className="rounded-md border-2 border-rose-500 bg-rose-50/70 dark:bg-rose-950/20 p-2.5 space-y-1.5">
      <div className="inline-flex items-center gap-1.5 text-[11px] uppercase tracking-wide font-semibold text-rose-700 dark:text-rose-300">
        <AlertTriangle className="h-3.5 w-3.5" />
        Boarding approval alerts ({alerts.length})
      </div>
      <ul className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
        {alerts.map((a) => (
          <li key={a.id}>
            <button
              type="button"
              onClick={() => onOpenJob(a.job_id)}
              className="w-full text-left rounded-md bg-white/70 dark:bg-background/70 border border-rose-300/70 px-2.5 py-2 hover:bg-rose-100/60 transition space-y-1"
            >
              <div className="text-xs font-semibold text-rose-900 dark:text-rose-200 truncate">
                {displayLocation(a.job?.from_location ?? "", a.job?.pickup_display_name)} →{" "}
                {displayLocation(a.job?.to_location ?? "", a.job?.dropoff_display_name)}
              </div>
              <div className="text-[11px] text-muted-foreground">
                Onboard {Number(a.pax_summary?.onboard ?? 0)} · No-show {Number(a.pax_summary?.noshow ?? 0)} ·
                {" "}Cancelled {Number(a.pax_summary?.cancelled ?? 0)} · Pending {Number(a.pax_summary?.pending ?? 0)}
              </div>
              <div className="text-[10px] text-muted-foreground">
                Requested {formatMaltaDateTime(a.requested_at)}
              </div>
              {a.driver_note && <div className="text-[10px] text-muted-foreground truncate">"{a.driver_note}"</div>}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/* ------------------------------ Dispatch trip list ------------------------------ */

function toSimpleStatus(job: Job): {
  label: string;
  tone: "live" | "assigned" | "pending" | "done" | "cancelled";
} {
  if (job.status === "cancelled") return { label: "Cancelled", tone: "cancelled" };
  if (job.status === "completed") return { label: "Done", tone: "done" };
  if (job.status === "in_progress") return { label: "On board", tone: "live" };
  if (job.status === "arrived") return { label: "Arrived", tone: "live" };
  if (job.status === "en_route") return { label: "En route", tone: "live" };
  if (job.driver_id) return { label: "Assigned", tone: "assigned" };
  return { label: "Pending", tone: "pending" };
}

const TONE_CLASS: Record<string, string> = {
  live: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/40",
  assigned: "bg-blue-500/10 text-blue-700 dark:text-blue-300 border-blue-500/30",
  pending: "bg-muted text-muted-foreground border-border",
  done: "bg-slate-500/10 text-slate-600 dark:text-slate-300 border-slate-500/30",
  cancelled: "bg-destructive/10 text-destructive border-destructive/30",
};

function urgencyRank(job: Job): number {
  const s = toSimpleStatus(job).tone;
  if (s === "live") return 0;
  const t = job.pickup_at ? new Date(job.pickup_at).getTime() - Date.now() : Number.POSITIVE_INFINITY;
  if (t < 30 * 60_000) return 1; // arriving soon
  return 2 + t / 60_000; // later
}

function DispatchTripList({
  jobs,
  onOpenDetails,
  onOpenChat,
  pendingApprovalCount = 0,
}: {
  jobs: Job[];
  onOpenDetails?: (j: Job) => void;
  onOpenChat?: (j: Job) => void;
  pendingApprovalCount?: number;
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  useEnrichVisibleJobs(jobs, [["jobs"]]);
  // Hide completed/cancelled trips — they belong under the driver's history, not the live board.
  const activeJobs = jobs.filter((j) => {
    const tone = toSimpleStatus(j).tone;
    return tone !== "done" && tone !== "cancelled";
  });
  if (activeJobs.length === 0) return null;
  const list = [...activeJobs].sort((a, b) => urgencyRank(a) - urgencyRank(b));
  const items = bucketByGroup(list);

  return (
    <section className="rounded-lg border bg-card overflow-hidden">
      {/* Header */}
      <div className="px-3 py-2.5 border-b flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <h2 className="text-sm font-semibold truncate">Active & Waiting Trips</h2>
          <span className="shrink-0 inline-flex items-center rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-700 dark:text-emerald-300 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5">
            {list.length} live
          </span>
        </div>
        {pendingApprovalCount > 0 && (
          <span
            className="inline-flex items-center gap-1 rounded-full bg-red-500 text-white text-[10px] font-bold px-2 py-0.5 animate-pulse"
            title={`${pendingApprovalCount} pending approval${pendingApprovalCount > 1 ? "s" : ""}`}
          >
            {pendingApprovalCount} to review
          </span>
        )}
      </div>

      <ul className="divide-y">
        {items.map((it) => {
          if (it.kind === "group") {
            return (
              <GroupedRunRow
                key={it.group_id}
                groupId={it.group_id}
                jobs={it.jobs}
                isOpen={expandedId === it.group_id}
                onToggle={() =>
                  setExpandedId(expandedId === it.group_id ? null : it.group_id)
                }
                onOpenDetails={onOpenDetails}
                onOpenChat={onOpenChat}
              />
            );
          }
          const job = it.job;
          return (() => {
          const from = displayLocation(job.from_location, job.pickup_display_name);
          const to = displayLocation(job.to_location, job.dropoff_display_name);
          const eta = formatEtaMinutes(job.route_duration_sec);
          const status = toSimpleStatus(job);
          const pickup =
            job.pickup_at
              ? formatMaltaTime(String(job.pickup_at))
              : job.time?.slice(0, 5) ?? null;
          const paxCount = job.pax?.length ?? 0;
          const flight = job.from_flight || job.to_flight;
          const driverName = job.drivers?.name ?? job.external_driver_name ?? null;
          const isOpen = expandedId === job.id;

          const railColor =
            status.tone === "live"
              ? "bg-emerald-500"
              : status.tone === "assigned"
                ? "bg-blue-500"
                : status.tone === "cancelled"
                  ? "bg-destructive"
                  : "bg-slate-300 dark:bg-slate-600";

          return (
            <li
              key={job.id}
              data-job-id={job.id}
              className={`relative bg-background text-sm transition ${
                isOpen ? "bg-muted/30" : "hover:bg-muted/40"
              }`}
            >
              {/* Status rail */}
              <div className={`absolute left-0 top-0 bottom-0 w-1 ${railColor}`} aria-hidden />

              <button
                type="button"
                onClick={() => setExpandedId(isOpen ? null : job.id)}
                className="w-full text-left pl-3 pr-2.5 py-2.5 flex items-start gap-3"
              >
                <div className="min-w-0 flex-1 space-y-1">
                  {/* Route line */}
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className="truncate font-semibold text-foreground">{from}</span>
                    <ArrowRight className="h-3 w-3 shrink-0 text-muted-foreground/60" />
                    <span className="truncate font-semibold text-foreground">{to}</span>
                    {eta && (
                      <span className="shrink-0 inline-flex items-center gap-1 rounded-md bg-primary/10 text-primary text-[10px] font-bold px-1.5 py-0.5 ml-1 tabular-nums">
                        <Clock className="h-2.5 w-2.5" />
                        {eta}
                      </span>
                    )}
                  </div>
                  {/* Meta line */}
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
                    {driverName && (
                      <span className="inline-flex items-center gap-1 truncate max-w-[12rem]">
                        <UserIcon className="h-3 w-3" />
                        <span className="truncate">{driverName}</span>
                      </span>
                    )}
                    {pickup && (
                      <span className="inline-flex items-center gap-1 tabular-nums">
                        <Clock className="h-3 w-3" />
                        {pickup}
                      </span>
                    )}
                    {paxCount > 0 && (
                      <span className="inline-flex items-center gap-1 tabular-nums">
                        <Users2 className="h-3 w-3" />
                        {paxCount}
                      </span>
                    )}
                    {flight && (
                      <span className="inline-flex items-center gap-1 text-blue-600 dark:text-blue-400 font-medium">
                        <Plane className="h-3 w-3" />
                        {flight}
                      </span>
                    )}
                  </div>
                </div>

                <span
                  className={`shrink-0 inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[10px] font-bold uppercase tracking-wider ${TONE_CLASS[status.tone]}`}
                >
                  {status.tone === "live" && (
                    <span className="relative flex h-1.5 w-1.5">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-500 opacity-75" />
                      <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-600" />
                    </span>
                  )}
                  {status.label}
                </span>
              </button>

              {isOpen && (
                <div className="border-t bg-muted/20 px-3 py-3 animate-accordion-down">
                  <div className="grid gap-3 lg:grid-cols-3">
                    {/* Live map (2/3 on desktop) */}
                    <div className="lg:col-span-2 relative rounded-lg overflow-hidden border bg-background min-h-[240px]">
                      <TripEventsMap
                        jobId={job.id}
                        isLive={status.tone === "live" || status.tone === "assigned"}
                      />
                      {/* Fallback shimmer only when we don't yet have a route ETA */}
                      {!eta && (
                        <svg
                          className="pointer-events-none absolute inset-0 w-full h-full opacity-40"
                          preserveAspectRatio="none"
                          aria-hidden
                        >
                          <path
                            d="M20,80% Q40%,40% 80%,20%"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeDasharray="8 6"
                            className="text-primary/60 animate-route-flow"
                          />
                        </svg>
                      )}
                    </div>

                    {/* Side rail (1/3) */}
                    <div className="space-y-3">
                      {/* Live ETA card */}
                      <div className="rounded-lg border bg-background p-3">
                        <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1">
                          Live ETA
                        </div>
                        <div className="flex items-baseline gap-2">
                          <span className="text-2xl font-bold tabular-nums text-foreground">
                            {eta ?? "—"}
                          </span>
                          {pickup && (
                            <span className="text-xs text-muted-foreground tabular-nums">
                              pickup {pickup}
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Milestone strip */}
                      <MilestoneStrip job={job} />

                      {/* Actions */}
                      <div className="flex flex-col gap-2">
                        <div className="grid grid-cols-2 gap-2">
                          {onOpenChat && (
                            <Button size="sm" variant="outline" onClick={() => onOpenChat(job)}>
                              <MessageSquare className="h-3.5 w-3.5 mr-1" />
                              Chat
                            </Button>
                          )}
                          {job.drivers?.phone ? (
                            <Button size="sm" variant="outline" asChild>
                              <a href={`tel:${job.drivers.phone}`}>
                                <Phone className="h-3.5 w-3.5 mr-1" />
                                Call
                              </a>
                            </Button>
                          ) : (
                            <Button size="sm" variant="outline" disabled>
                              <Phone className="h-3.5 w-3.5 mr-1" />
                              No phone
                            </Button>
                          )}
                        </div>
                        {onOpenDetails && (
                          <Button size="sm" onClick={() => onOpenDetails(job)}>
                            Open full details
                            <ArrowRight className="h-3.5 w-3.5 ml-1" />
                          </Button>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </li>
          );
          })();
        })}
      </ul>
    </section>
  );
}

/* ---------- Grouped run row (merged card for multi-stop trips) ---------- */

type ChainStop = { label: string; time?: string | null };

/** Build a de-duped ordered stop chain from an ordered list of legs (fallback). */
function buildStopChain(jobs: Job[]): ChainStop[] {
  const chain: ChainStop[] = [];
  const push = (label: string, time?: string | null) => {
    const last = chain[chain.length - 1];
    if (last && last.label.toLowerCase() === label.toLowerCase()) return;
    chain.push({ label, time: time ?? null });
  };
  jobs.forEach((j, i) => {
    const from = displayLocation(j.from_location, j.pickup_display_name);
    const to = displayLocation(j.to_location, j.dropoff_display_name);
    if (i === 0) push(from, j.time ?? null);
    push(to, null);
  });
  return chain;
}

/** Build a chain from persisted group_stops (merged route order). */
function buildStopChainFromStops(stops: Array<{ address: string | null; display_name: string | null }>): ChainStop[] {
  const chain: ChainStop[] = [];
  for (const s of stops) {
    const label = displayLocation(s.address, s.display_name);
    if (!label) continue;
    const last = chain[chain.length - 1];
    if (last && last.label.toLowerCase() === label.toLowerCase()) continue;
    chain.push({ label, time: null });
  }
  return chain;
}

/** Order jobs so their (from → to) sequence follows the chain order.
 *  For each consecutive pair in `chain`, pick the best matching job (case-insensitive from/to match),
 *  falling back to a partial (from OR to) match, then to remaining jobs in date/time order.
 */
function orderJobsByChain(jobs: Job[], chain: ChainStop[]): Job[] {
  if (chain.length < 2) return jobs;
  const remaining = new Set(jobs.map((j) => j.id));
  const byId = new Map(jobs.map((j) => [j.id, j] as const));
  const norm = (s: string | null | undefined) => (s ?? "").toLowerCase().trim();
  const ordered: Job[] = [];
  for (let i = 0; i < chain.length - 1; i++) {
    const from = norm(chain[i].label);
    const to = norm(chain[i + 1].label);
    let bestId: string | null = null;
    let bestScore = -1;
    for (const id of remaining) {
      const j = byId.get(id)!;
      const jf = norm(displayLocation(j.from_location, j.pickup_display_name));
      const jt = norm(displayLocation(j.to_location, j.dropoff_display_name));
      let score = 0;
      if (jf === from) score += 2;
      else if (jf.includes(from) || from.includes(jf)) score += 1;
      if (jt === to) score += 2;
      else if (jt.includes(to) || to.includes(jt)) score += 1;
      if (score > bestScore) {
        bestScore = score;
        bestId = id;
      }
    }
    if (bestId && bestScore > 0) {
      ordered.push(byId.get(bestId)!);
      remaining.delete(bestId);
    }
  }
  // Append any leftovers in date/time order so nothing is lost.
  const leftovers = [...remaining]
    .map((id) => byId.get(id)!)
    .sort((a, b) => ((a.date ?? "") + (a.time ?? "")).localeCompare((b.date ?? "") + (b.time ?? "")));
  return [...ordered, ...leftovers];
}

function GroupedRunRow({
  groupId,
  jobs,
  isOpen,
  onToggle,
  onOpenDetails,
  onOpenChat,
}: {
  groupId: string;
  jobs: Job[];
  isOpen: boolean;
  onToggle: () => void;
  onOpenDetails?: (j: Job) => void;
  onOpenChat?: (j: Job) => void;
}) {
  const listStopsFn = useServerFn(listGroupStops);
  const { data: stopsData } = useQuery({
    queryKey: ["group-stops", groupId],
    queryFn: () => listStopsFn({ data: { group_id: groupId } }),
    staleTime: 30_000,
  });
  const stops = (stopsData?.stops ?? []) as Array<{
    address: string | null;
    display_name: string | null;
  }>;

  // Prefer persisted group_stops (the coordinator's merged route order); fall back to job legs.
  // Backfill missing display_name on stops using resolved hotel/business names from the jobs'
  // pickup_display_name / dropoff_display_name so leg cards never show a generic "Location pin"
  // when a business name has already been resolved for the same address.
  const nameByAddress = new Map<string, string>();
  for (const j of jobs) {
    const from = (j.from_location ?? "").trim().toLowerCase();
    const to = (j.to_location ?? "").trim().toLowerCase();
    const fromName = (j.pickup_display_name ?? "").trim();
    const toName = (j.dropoff_display_name ?? "").trim();
    if (from && fromName && !nameByAddress.has(from)) nameByAddress.set(from, fromName);
    if (to && toName && !nameByAddress.has(to)) nameByAddress.set(to, toName);
  }
  const enrichedStops = stops.map((s) => ({
    address: s.address,
    display_name: s.display_name ?? nameByAddress.get((s.address ?? "").trim().toLowerCase()) ?? null,
  }));
  const stopChain = enrichedStops.length >= 2 ? buildStopChainFromStops(enrichedStops) : [];
  const orderedJobs = stopChain.length >= 2 ? orderJobsByChain(jobs, stopChain) : jobs;
  const chain = stopChain.length >= 2 ? stopChain : buildStopChain(orderedJobs);

  const groupName = orderedJobs.find((j) => j.group_name)?.group_name ?? null;
  const totalPax = orderedJobs.reduce((s, j) => s + (j.pax?.length ?? 0), 0);
  const totalEtaSec = orderedJobs.reduce((s, j) => s + (j.route_duration_sec ?? 0), 0);
  const eta = formatEtaMinutes(totalEtaSec);
  const earliest = orderedJobs
    .map((j) => j.pickup_at ?? (j.date && j.time ? `${j.date}T${j.time}` : null))
    .filter(Boolean)
    .sort()[0] as string | null;
  const pickup = earliest
    ? (earliest.includes("T") && !earliest.endsWith("Z") && !/[+-]\d{2}:?\d{2}$/.test(earliest)
        ? earliest.slice(11, 16)
        : formatMaltaTime(earliest))
    : orderedJobs[0]?.time?.slice(0, 5) ?? null;
  const driverName =
    orderedJobs.find((j) => j.drivers?.name)?.drivers?.name ??
    orderedJobs.find((j) => j.external_driver_name)?.external_driver_name ??
    null;
  const anyLive = orderedJobs.some((j) => {
    const t = toSimpleStatus(j).tone;
    return t === "live";
  });
  const allAssigned = orderedJobs.every((j) => j.driver_id);
  const tone: "live" | "assigned" | "queued" = anyLive
    ? "live"
    : allAssigned
      ? "assigned"
      : "queued";
  const railColor =
    tone === "live" ? "bg-emerald-500" : tone === "assigned" ? "bg-blue-500" : "bg-slate-300 dark:bg-slate-600";

  // Numbered-chip palette (from user pick)
  const chipColors = ["bg-sky-500", "bg-emerald-500", "bg-amber-500"];

  return (
    <li
      key={groupId}
      className={`relative bg-background text-sm transition ${isOpen ? "bg-muted/30" : "hover:bg-muted/40"}`}
    >
      <div className={`absolute left-0 top-0 bottom-0 w-1 ${railColor}`} aria-hidden />
      <button
        type="button"
        onClick={onToggle}
        className="w-full text-left pl-3 pr-2.5 py-2.5 flex items-start gap-3"
      >
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex items-center gap-1.5 min-w-0 flex-wrap">
            <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 border border-primary/30 text-primary text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5">
              <Link2 className="h-2.5 w-2.5" />
              {groupName ?? "Grouped run"} · {orderedJobs.length} legs
            </span>
            {eta && (
              <span className="inline-flex items-center gap-1 rounded-md bg-primary/10 text-primary text-[10px] font-bold px-1.5 py-0.5 tabular-nums">
                <Clock className="h-2.5 w-2.5" />
                total {eta}
              </span>
            )}
          </div>
          {/* Numbered stop chips (from merged route order) */}
          <div className="flex items-center gap-1 flex-wrap">
            {chain.map((c, i) => (
              <span key={i} className="inline-flex items-center gap-1">
                <span
                  className={`inline-flex items-center gap-1 rounded-md text-white text-[10px] font-bold px-1.5 py-0.5 ${chipColors[i % chipColors.length]}`}
                >
                  <span className="tabular-nums">{i + 1}</span>
                  <span className="max-w-[10rem] truncate font-semibold">{c.label}</span>
                </span>
                {i < chain.length - 1 && (
                  <ArrowRight className="h-3 w-3 shrink-0 text-muted-foreground/60" />
                )}
              </span>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
            {driverName && (
              <span className="inline-flex items-center gap-1 truncate max-w-[12rem]">
                <UserIcon className="h-3 w-3" />
                <span className="truncate">{driverName}</span>
              </span>
            )}
            {pickup && (
              <span className="inline-flex items-center gap-1 tabular-nums">
                <Clock className="h-3 w-3" />
                {pickup}
              </span>
            )}
            {totalPax > 0 && (
              <span className="inline-flex items-center gap-1 tabular-nums">
                <Users2 className="h-3 w-3" />
                {totalPax} pax
              </span>
            )}
          </div>
        </div>
        <span
          className={`shrink-0 inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[10px] font-bold uppercase tracking-wider ${TONE_CLASS[tone]}`}
        >
          {tone === "live" && (
            <span className="relative flex h-1.5 w-1.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-500 opacity-75" />
              <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-600" />
            </span>
          )}
          {tone === "live" ? "Live" : tone === "assigned" ? "Assigned" : "Queued"}
        </span>
      </button>

      {isOpen && (
        <div className="border-t bg-muted/20 px-3 py-3 space-y-3 animate-accordion-down">
          {/* Reorder + auto-suggest via existing group stops panel */}
          <GroupStopsPanel groupId={groupId} groupName={groupName} />

          {/* Chain-reflowed legs — from/to reflect the merged route order */}
          <div className="rounded-lg border bg-background">
            <div className="px-3 py-2 border-b text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              Legs (chain reflowed)
            </div>
            <ul className="divide-y">
              {orderedJobs.map((j, i) => {
                const from = chain[i]?.label ?? displayLocation(j.from_location, j.pickup_display_name);
                const to = chain[i + 1]?.label ?? displayLocation(j.to_location, j.dropoff_display_name);
                const legEta = formatEtaMinutes(j.route_duration_sec);
                const st = toSimpleStatus(j);
                return (
                  <li key={j.id} className="px-3 py-2 flex items-center gap-2 text-xs">
                    <span
                      className={`inline-flex items-center justify-center h-5 w-5 rounded-full text-white text-[10px] font-bold ${chipColors[i % chipColors.length]}`}
                    >
                      {i + 1}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="truncate font-medium">{from}</span>
                        <ArrowRight className="h-3 w-3 shrink-0 text-muted-foreground/60" />
                        <span className="truncate font-medium">{to}</span>
                        {legEta && (
                          <span className="ml-1 inline-flex items-center gap-0.5 rounded bg-primary/10 text-primary text-[10px] font-bold px-1 py-0.5 tabular-nums">
                            {legEta}
                          </span>
                        )}
                      </div>
                      <div className="text-[10px] text-muted-foreground flex gap-2">
                        {j.time && <span className="tabular-nums">{j.time.slice(0, 5)}</span>}
                        {(j.pax?.length ?? 0) > 0 && <span>{j.pax!.length} pax</span>}
                        <span className={`uppercase tracking-wider ${TONE_CLASS[st.tone]}`}>
                          {st.label}
                        </span>
                      </div>
                    </div>
                    <div className="flex gap-1 shrink-0">
                      {onOpenChat && (
                        <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={(e) => { e.stopPropagation(); onOpenChat(j); }}>
                          <MessageSquare className="h-3.5 w-3.5" />
                        </Button>
                      )}
                      {onOpenDetails && (
                        <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={(e) => { e.stopPropagation(); onOpenDetails(j); }}>
                          <ArrowRight className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      )}
    </li>
  );
}



/* Vertical milestone strip derived from job.status + driver_id. No new fields. */
function MilestoneStrip({ job }: { job: Job }) {
  type Step = { key: string; label: string };
  const steps: Step[] = [
    { key: "booked", label: "Booked" },
    { key: "assigned", label: "Assigned" },
    { key: "en_route", label: "En route" },
    { key: "arrived", label: "Arrived" },
    { key: "in_progress", label: "On board" },
    { key: "completed", label: "Done" },
  ];
  const currentIndex = (() => {
    if (job.status === "completed") return 5;
    if (job.status === "in_progress") return 4;
    if (job.status === "arrived") return 3;
    if (job.status === "en_route") return 2;
    if (job.driver_id) return 1;
    return 0;
  })();

  return (
    <div className="rounded-lg border bg-background p-3">
      <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-3">
        Progress
      </div>
      <ol className="relative space-y-2.5 ml-1">
        <div className="absolute left-[5px] top-1.5 bottom-1.5 w-px bg-border" aria-hidden />
        {steps.map((s, i) => {
          const done = i < currentIndex;
          const active = i === currentIndex;
          return (
            <li key={s.key} className="relative pl-5 flex items-center gap-2">
              <span
                className={`absolute left-0 top-1/2 -translate-y-1/2 h-2.5 w-2.5 rounded-full ring-2 ring-background ${
                  done
                    ? "bg-emerald-500"
                    : active
                      ? "bg-emerald-500"
                      : "bg-muted-foreground/30"
                }`}
              >
                {active && (
                  <span className="absolute inset-0 rounded-full bg-emerald-500 animate-ping opacity-60" />
                )}
              </span>
              <span
                className={`text-[11px] ${
                  active
                    ? "font-bold text-emerald-700 dark:text-emerald-300"
                    : done
                      ? "text-foreground"
                      : "text-muted-foreground/60"
                }`}
              >
                {s.label}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}




/* ------------------------------ Waiting-now strip ------------------------------ */
function WaitingNowStrip({ onJump }: { onJump: (jobId: string) => void }) {
  const fn = useServerFn(listOpenWaitSessions);
  const { data } = useQuery({
    queryKey: ["open-wait-sessions"],
    queryFn: () =>
      fn() as Promise<
        Array<{
          session_id: string;
          job_id: string;
          driver_name: string;
          started_at: string;
          elapsed_sec: number;
          from_location: string | null;
          to_location: string | null;
        }>
      >,
    refetchInterval: 5_000,
  });
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    if (!data || data.length === 0) return;
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, [data]);
  if (!data || data.length === 0) return null;
  return (
    <section className="rounded-md border-2 border-amber-400 bg-amber-50/60 dark:bg-amber-950/20 p-2.5 space-y-1.5">
      <div className="inline-flex items-center gap-1.5 text-[11px] uppercase tracking-wide font-semibold text-amber-800 dark:text-amber-300">
        <span className="relative flex h-2 w-2">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-500 opacity-75" />
          <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-600" />
        </span>
        Drivers waiting now
      </div>
      <ul className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
        {data.map((w) => {
          const elapsed = Math.max(0, Math.floor((nowMs - new Date(w.started_at).getTime()) / 1000));
          const h = Math.floor(elapsed / 3600);
          const m = Math.floor((elapsed % 3600) / 60);
          const s = elapsed % 60;
          const label = h > 0 ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}:${String(s).padStart(2, "0")}`;
          return (
            <li key={w.session_id}>
              <button
                type="button"
                onClick={() => onJump(w.job_id)}
                className="w-full text-left rounded-md bg-white/70 dark:bg-background/70 border border-amber-300/70 px-2.5 py-1.5 hover:bg-amber-100/60 transition"
              >
                <div className="flex items-center justify-between gap-2 text-xs">
                  <div className="font-medium truncate">{w.driver_name}</div>
                  <div className="font-mono text-amber-700 dark:text-amber-300 shrink-0">⏱ {label}</div>
                </div>
                <div className="text-[11px] text-muted-foreground truncate">
                  {w.from_location ?? ""}
                  {w.to_location ? ` → ${w.to_location}` : ""}
                </div>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
