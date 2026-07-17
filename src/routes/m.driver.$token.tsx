import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { formatMaltaDateTime, formatMaltaTime } from "@/lib/time";
import { displayLocation } from "@/lib/trip-display";
import { BOARDING_OVERRIDE_MS } from "@/lib/boarding.constants";
import {
  getDriverManifest, driverAcceptJob, driverRejectJob, driverApproveDeletion,
  updateJobStatus, listJobPaxDriver, markPaxOnboard, markPaxNoShow, markPaxPending,
  driverReportLate, markPaxCancelled, requestBoardingApproval, driverOverrideBoardingApproval,
  getBoardingApprovalStatusDriver,
  updateDriverProfile, setJobPaymentStatus, hideJobForDriver, unhideJobForDriver, getDriverStatement, driverMarkPayoutReceived,
  getClientLiveLocationDriver,
  listGroupStopsForDriver, requestStopReorderByDriver,
  driverSnapPickupToHere,
  driverSnapDropoffToHere,
  logDriverAction,
} from "@/lib/coordinator-public.functions";
import { supabase } from "@/integrations/supabase/client";
import { useAutoNextJob } from "@/hooks/use-auto-next-job";
import { AutoNextJobSheet } from "@/components/driver/AutoNextJobSheet";


import { Badge } from "@/components/ui/badge";
import { LabelChip } from "@/components/coordinator/LabelChip";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";

import { NavigateFullscreen } from "@/components/driver/NavigateFullscreen";
import { DriverDashboardMap, type DriverMapJob } from "@/components/driver/DriverDashboardMap";
import { TripSummaryDialog } from "@/components/driver/TripSummaryDialog";
import { TripChatDialog } from "@/components/trip/TripChatDialog";
import { ClientLiveMiniMap } from "@/components/trip/ClientLiveMiniMap";
import { DriverPricePanel } from "@/components/driver/DriverPricePanel";
import { DriverWaitingPanel } from "@/components/driver/DriverWaitingPanel";
import { DriverLiveShare } from "@/components/driver/DriverLiveShare";
import { SafetyModeOverlay } from "@/components/driver/SafetyModeOverlay";
import { BrandingBar, type BrandingInfo } from "@/components/branding/BrandingBar";
import { BrandLogo, useFavicon } from "@/components/branding/BrandLogo";
import { TripProgress } from "@/components/coordinator/TripProgress";
import { type CarouselApi, Carousel, CarouselContent, CarouselItem } from "@/components/ui/carousel";
import { useIsMobile } from "@/hooks/use-mobile";
import { useSafetyMode } from "@/hooks/use-safety-mode";

import {
  CheckCircle2, Clock, Download, X, FileText, MessageCircle, MoreVertical,
  Plane, MapPin, Car, Users, Navigation, QrCode, AlertTriangle, User, ThumbsDown,
  Timer, UserX, Maximize2, Minimize2, Volume2, VolumeX, Megaphone,
  ArrowUp, ArrowUpLeft, ArrowUpRight, ArrowLeft, ArrowRight, CornerDownLeft, CornerDownRight, Route as RouteIcon, TrafficCone,
} from "lucide-react";
import { computeDriverRoute } from "@/lib/routing.functions";
import { decodePolyline, distanceToPathMeters } from "@/lib/polyline";
import { useWakeLock } from "@/hooks/use-wake-lock";
import { useDriverAudio } from "@/hooks/use-driver-audio";



const REJECT_REASONS = [
  "Unavailable — not free at that time",
  "Too far / outside my area",
  "Vehicle issue",
  "Double-booked with another trip",
  "Personal emergency",
  "Other",
] as const;



export const Route = createFileRoute("/m/driver/$token")({
  head: () => ({ meta: [{ title: "Driver Manifest" }] }),
  component: DriverManifest,
  errorComponent: ({ error }) => (
    <div className="min-h-screen grid place-items-center px-4">
      <div className="text-center">
        <h1 className="text-xl font-semibold">Manifest error</h1>
        <p className="text-sm text-muted-foreground mt-2">{error.message}</p>
      </div>
    </div>
  ),
  notFoundComponent: () => <NotFound />,
});

type Pax = { id: string; name: string; status: string; boarded_at: string | null };
type DriverPaxRow = Pax & {
  boarded_method: string | null;
  noshow_at: string | null;
  cancelled_at: string | null;
};
type BoardingApproval = {
  id: string;
  status: string;
  requested_at: string;
  responded_at: string | null;
  override_at: string | null;
  coordinator_note: string | null;
  driver_note: string | null;
  pax_summary: Record<string, number> | null;
};
type Job = {
  id: string; from_location: string; to_location: string;
  pickup_display_name?: string | null; dropoff_display_name?: string | null;
  date: string; time: string; pickup_at: string | null;
  flightorship: string | null;
  from_flight: string | null; to_flight: string | null;
  flight_status: string | null; flight_status_note: string | null;
  vehicle: string | null;
  qr_strict_mode: boolean; tracking_enabled: boolean;
  clientcompanyname: string | null;
  driver_accepted_at: string | null;
  deletion_requested_at: string | null;
  driver_cancel_requested_at?: string | null;
  driver_cancel_reason?: string | null;
  driver_cancel_note?: string | null;
  status?: string;
  payment_status?: "pending" | "paid";
  drivers?: { name: string } | null;
  pax?: Pax[];
  unread_messages?: number;
  labels?: { id: string; name: string; color: string }[];
  driver_hidden_at?: string | null;
  grouped_count?: number | null;
  grouped_at?: string | null;
  group_id?: string | null;
  group_name?: string | null;
  group_note?: string | null;
  pickup_lat?: number | null;
  pickup_lng?: number | null;
  dropoff_lat?: number | null;
  dropoff_lng?: number | null;
};

type Driver = {
  id: string; name: string;
  phone?: string | null;
  seats_available: number | null;
  availability_note: string | null;
  profile_updated_at: string | null;
  onboarded_at?: string | null;
  car_make_model?: string | null;
  plate?: string | null;
};

type DriverManifestResponse = {
  link: { subject_label: string | null };
  jobs: Job[];
  driver: Driver | null;
  branding: BrandingInfo;
  companySettings?: {
    safety_mode_threshold_kmh?: number | null;
    safety_mode_enabled?: boolean | null;
    safety_mode_allow_override?: boolean | null;
    auto_next_job_enabled?: boolean | null;
    arrival_radius_m?: number | null;
  };
} | null;

const STATUS_FLOW: Array<{ value: string; label: string }> = [
  { value: "en_route", label: "On the way to pickup" },
  { value: "arrived", label: "Arrived at pickup" },
  { value: "in_progress", label: "Passengers on board — en route" },
  { value: "completed", label: "Trip finished" },
];
const BOARDING_OVERRIDE_MINUTES = Math.floor(BOARDING_OVERRIDE_MS / 60000);
const RETURN_TO_WAITING_STATUSES = new Set(["en_route", "arrived"]);

function getPaxSummary(pax: Array<{ status: string | null | undefined }> | undefined | null) {
  const counts = { total: 0, pending: 0, onboard: 0, noshow: 0, cancelled: 0 };
  for (const p of pax ?? []) {
    counts.total += 1;
    const status = p.status ?? "pending";
    if (status === "onboard") counts.onboard += 1;
    else if (status === "noshow") counts.noshow += 1;
    else if (status === "cancelled") counts.cancelled += 1;
    else counts.pending += 1;
  }
  return {
    ...counts,
    resolved: counts.onboard + counts.noshow + counts.cancelled,
    allResolved: counts.pending === 0,
  };
}

function formatCountdown(totalSeconds: number): string {
  const seconds = Math.max(0, Math.ceil(totalSeconds));
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(remainingSeconds).padStart(2, "0")}`;
}

function getApprovalCountdown(approval: BoardingApproval | null, nowMs: number) {
  if (!approval?.requested_at) return 0;
  const unlockAt = new Date(approval.requested_at).getTime() + BOARDING_OVERRIDE_MS;
  return Math.max(0, Math.ceil((unlockAt - nowMs) / 1000));
}

function formatDriverStatusError(error: Error): string {
  const msg = error.message ?? "";
  if (msg === "trip_cannot_return_to_waiting") {
    return "This trip can only go back to waiting before passengers are on board.";
  }
  // Arrival GPS gate was removed — drivers can always mark "arrived" without
  // server-side geofencing. Every status change is still echoed to the trip
  // map so the coordinator sees where and when it happened.
  if (msg === "partial_boarding_needs_approval") {
    return "Some passengers are still pending. Request coordinator approval or finish boarding decisions first.";
  }
  if (msg === "boarding_approval_already_pending") {
    return "Approval has already been requested. Wait for a coordinator response or use override when available.";
  }
  if (msg === "boarding_approval_only_when_arrived") {
    return "Approval can only be requested while the trip is at pickup.";
  }
  if (msg.startsWith("override_too_early:")) {
    const remaining = Number(msg.split(":")[1] ?? 0);
    return `Override available in ${formatCountdown(remaining)}.`;
  }
  if (msg === "boarding_approval_not_found") {
    return "Approval request not found. Refresh and try again.";
  }
  if (msg === "boarding_approval_already_resolved") {
    return "This approval request has already been resolved.";
  }
  if (msg === "cancellation_not_allowed_in_current_status") {
    return "Passenger cancellation is only allowed while Arrived or En Route with passengers onboard.";
  }
  if (msg === "pax_not_found") {
    return "Passenger not found. Refresh the trip and try again.";
  }
  return msg;
}

function getInstructionText(instruction: string | null | undefined): string | null {
  if (!instruction) return null;
  if (typeof document === "undefined") return instruction.trim() || null;
  const parser = new DOMParser();
  const parsed = parser.parseFromString(instruction, "text/html");
  return parsed.body.textContent?.replace(/\s+/g, " ").trim() || null;
}

function canReturnTripToWaiting(status: string | null | undefined): boolean {
  return RETURN_TO_WAITING_STATUSES.has(status ?? "");
}

function shouldHandleBoardingInDialog(status: string | null | undefined, nextStatus: string | null | undefined, pendingCount: number) {
  return status === "arrived" && nextStatus === "in_progress" && pendingCount > 0;
}

function PassengerSummaryPanel({ pax }: { pax: Array<{ id: string; name: string; status: string }> | undefined }) {
  const summary = getPaxSummary(pax);
  return (
    <div className="rounded-xl border bg-muted/30 p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="text-sm font-semibold flex items-center gap-1.5">
          <Users className="h-4 w-4" /> Passenger summary
        </div>
        <Badge variant="outline">{summary.total} total</Badge>
      </div>
      <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
        <div className="rounded-lg bg-background px-2.5 py-2"><div className="text-muted-foreground">Onboard</div><div className="font-semibold text-emerald-600">{summary.onboard}</div></div>
        <div className="rounded-lg bg-background px-2.5 py-2"><div className="text-muted-foreground">Pending</div><div className="font-semibold">{summary.pending}</div></div>
        <div className="rounded-lg bg-background px-2.5 py-2"><div className="text-muted-foreground">No-show</div><div className="font-semibold text-rose-600">{summary.noshow}</div></div>
        <div className="rounded-lg bg-background px-2.5 py-2"><div className="text-muted-foreground">Cancelled</div><div className="font-semibold text-slate-700">{summary.cancelled}</div></div>
      </div>
      {summary.total > 0 && summary.allResolved && (
        <div className="rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-800 font-medium">
          All passengers resolved — ready to depart.
        </div>
      )}
    </div>
  );
}

function BoardingApprovalCard({
  approval,
  nowMs,
  pendingCount,
  resolvedCount,
  requestNote,
  requestBusy,
  overrideBusy,
  startBusy,
  approvalError,
  onRequest,
  onOverride,
  onOpenBoarding,
  onChat,
  onStartTrip,
}: {
  approval: BoardingApproval | null;
  nowMs: number;
  pendingCount: number;
  resolvedCount: number;
  requestNote?: string;
  requestBusy?: boolean;
  overrideBusy?: boolean;
  startBusy?: boolean;
  approvalError?: string | null;
  onRequest?: () => void;
  onOverride?: () => void;
  onOpenBoarding?: () => void;
  onChat?: () => void;
  onStartTrip?: () => void;
}) {
  const status = approval?.status ?? "needs_request";
  const countdown = getApprovalCountdown(approval, nowMs);
  const canOverride = status === "pending" && countdown <= 0;
  const summary = approval?.pax_summary ?? null;
  const pendingFromApproval = Number(summary?.pending ?? pendingCount);
  const onboardFromApproval = Number(summary?.onboard ?? 0);
  const noshowFromApproval = Number(summary?.noshow ?? 0);
  const cancelledFromApproval = Number(summary?.cancelled ?? 0);
  const totalResolved = onboardFromApproval + noshowFromApproval + cancelledFromApproval || resolvedCount;

  const tone =
    status === "approved" || status === "overridden"
      ? "border-emerald-300 bg-emerald-50"
      : status === "rejected"
        ? "border-rose-300 bg-rose-50"
        : "border-amber-300 bg-amber-50";

  return (
    <div className={`rounded-xl border p-3 space-y-3 ${tone}`}>
      <div className="space-y-1">
        <div className="text-sm font-semibold">
          {status === "approved"
            ? "✅ Boarding approved by coordinator"
            : status === "rejected"
              ? "⛔ Boarding rejected by coordinator"
              : status === "overridden"
                ? "✅ Boarding override applied"
                : status === "pending"
                  ? "Approval requested"
                  : "Partial boarding needs approval"}
        </div>
        <div className="text-xs text-muted-foreground">
          {status === "needs_request"
            ? `Resolved passengers: ${resolvedCount}. Pending passengers: ${pendingCount}.`
            : `Resolved passengers: ${totalResolved}. Pending passengers: ${pendingFromApproval}.`}
        </div>
      </div>

      {status === "needs_request" && (
        <p className="text-sm text-slate-700">
          Some passengers are still pending. Request coordinator approval or finish boarding decisions first.
        </p>
      )}

      {approval?.driver_note && (
        <div className="text-xs rounded-lg bg-background/70 px-3 py-2">
          <span className="font-medium">Driver note:</span> {approval.driver_note}
        </div>
      )}
      {!approval?.driver_note && requestNote && status === "needs_request" && (
        <div className="text-xs rounded-lg bg-background/70 px-3 py-2">
          <span className="font-medium">Driver note:</span> {requestNote}
        </div>
      )}

      {approval?.coordinator_note && (
        <div className="text-xs rounded-lg bg-background/70 px-3 py-2">
          <span className="font-medium">Coordinator note:</span> {approval.coordinator_note}
        </div>
      )}

      {status === "pending" && (
        <div className="rounded-lg bg-background/70 px-3 py-2 text-sm">
          Override {canOverride ? "is now available." : `available in ${formatCountdown(countdown)}.`}
        </div>
      )}

      {approvalError && (
        <div className="rounded-lg border border-amber-300 bg-background/80 px-3 py-2 text-sm text-amber-900">
          {approvalError}
        </div>
      )}

      <div className="flex flex-col gap-2 sm:flex-row">
        {status === "needs_request" && onRequest && (
          <Button className="sm:flex-1" onClick={onRequest} disabled={requestBusy}>
            {requestBusy ? "Requesting…" : "Request coordinator approval"}
          </Button>
        )}
        {(status === "approved" || status === "overridden") && onStartTrip && (
          <Button className="sm:flex-1" onClick={onStartTrip} disabled={startBusy}>
            {startBusy ? "Starting…" : "Start trip"}
          </Button>
        )}
        {status === "rejected" && onRequest && (
          <Button className="sm:flex-1" onClick={onRequest} disabled={requestBusy}>
            {requestBusy ? "Requesting…" : "Request approval again"}
          </Button>
        )}
        {status === "pending" && onOverride && (
          <Button variant="outline" className="sm:flex-1" onClick={onOverride} disabled={!canOverride || overrideBusy}>
            {overrideBusy ? "Overriding…" : canOverride ? "Override now" : `Override in ${formatCountdown(countdown)}`}
          </Button>
        )}
        {onOpenBoarding && (
          <Button variant="outline" className="sm:flex-1" onClick={onOpenBoarding}>
            Continue boarding
          </Button>
        )}
        {onChat && (
          <Button variant="outline" className="sm:flex-1" onClick={onChat}>
            Chat coordinator
          </Button>
        )}
      </div>
    </div>
  );
}

function DriverBoardingApprovalPanel({
  token,
  job,
  onOpenBoarding,
  onChat,
}: {
  token: string;
  job: Job;
  onOpenBoarding: () => void;
  onChat: () => void;
}) {
  const qc = useQueryClient();
  const approvalFn = useServerFn(getBoardingApprovalStatusDriver);
  const overrideFn = useServerFn(driverOverrideBoardingApproval);
  const statusFn = useServerFn(updateJobStatus);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [approvalError, setApprovalError] = useState<string | null>(null);
  const [overrideConfirmOpen, setOverrideConfirmOpen] = useState(false);
  const approvalPollingEnabled = job.status === "arrived";

  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const summary = getPaxSummary(job.pax);
  const { data: approvals, refetch } = useQuery({
    queryKey: ["driver-boarding-approval", token, job.id],
    enabled: approvalPollingEnabled,
    refetchInterval: approvalPollingEnabled ? 10_000 : false,
    queryFn: () => approvalFn({ data: { token, job_id: job.id } }) as Promise<BoardingApproval[]>,
  });
  const latestApproval = approvals?.[0] ?? null;
  const shouldShowApproval = !!latestApproval && (
    summary.pending > 0
    || latestApproval.status === "pending"
    || latestApproval.status === "approved"
    || latestApproval.status === "overridden"
  );

  const startTripMut = useMutation({
    mutationFn: () => statusFn({ data: { token, job_id: job.id, status: "in_progress" } }),
    onSuccess: () => {
      toast.success("Status updated");
      setApprovalError(null);
      qc.invalidateQueries({ queryKey: ["driver-manifest", token] });
    },
    onError: (e: Error) => {
      setApprovalError(formatDriverStatusError(e));
      toast.error(formatDriverStatusError(e));
    },
  });
  const overrideMut = useMutation({
    mutationFn: () => overrideFn({ data: { token, job_id: job.id, approval_id: latestApproval!.id } }),
    onSuccess: async () => {
      toast.success("Boarding override applied");
      setApprovalError(null);
      setOverrideConfirmOpen(false);
      await refetch();
      startTripMut.mutate();
    },
    onError: (e: Error) => {
      setApprovalError(formatDriverStatusError(e));
      toast.error(formatDriverStatusError(e));
    },
  });

  if (job.status !== "arrived" || !shouldShowApproval) return null;

  return (
    <>
      <BoardingApprovalCard
        approval={latestApproval}
        nowMs={nowMs}
        pendingCount={summary.pending}
        resolvedCount={summary.resolved}
        approvalError={approvalError}
        overrideBusy={overrideMut.isPending}
        startBusy={startTripMut.isPending}
        onOverride={() => setOverrideConfirmOpen(true)}
        onOpenBoarding={onOpenBoarding}
        onChat={onChat}
        onStartTrip={() => startTripMut.mutate()}
      />
      <Dialog open={overrideConfirmOpen} onOpenChange={setOverrideConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Override coordinator approval and start this trip?</DialogTitle>
            <DialogDescription>
              Use this only when the coordinator has not responded within {BOARDING_OVERRIDE_MINUTES} minutes and you need to depart with pending passengers.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOverrideConfirmOpen(false)}>Cancel</Button>
            <Button onClick={() => overrideMut.mutate()} disabled={overrideMut.isPending}>
              {overrideMut.isPending ? "Overriding…" : "Override now"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function DriverManifest() {
  const { token } = Route.useParams();
  const fn = useServerFn(getDriverManifest);
  const qcTop = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["driver-manifest", token],
    queryFn: () => fn({ data: { token } }) as Promise<DriverManifestResponse>,
    refetchInterval: 20_000,
  });
  const [openJob, setOpenJob] = useState<Job | null>(null);
  const [profileOpen, setProfileOpen] = useState(false);
  const [statementOpen, setStatementOpen] = useState(false);
  const [chatJob, setChatJob] = useState<Job | null>(null);

  useEffect(() => {
    if (data?.driver && !data.driver.onboarded_at) setProfileOpen(true);
  }, [data?.driver]);

  // Realtime broadcast: server pushes `jobs_updated` on driver:<id> whenever
  // any of this driver's jobs (or a grouped cascade) changes, so sibling
  // cards flip statuses instantly across all open driver sessions.
  const driverId = data?.driver?.id ?? null;
  useEffect(() => {
    if (!driverId) return;
    const ch = supabase
      .channel(`driver:${driverId}`, { config: { broadcast: { self: false } } })
      .on("broadcast", { event: "jobs_updated" }, () => {
        qcTop.invalidateQueries({ queryKey: ["driver-manifest", token] });
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [driverId, token, qcTop]);


  const [showArchived, setShowArchived] = useState(false);
  const isMobile = useIsMobile();
  const [dashboardCarouselApi, setDashboardCarouselApi] = useState<CarouselApi | null>(null);
  const [dashboardPanelIndex, setDashboardPanelIndex] = useState(0);
  const { activeJobs, archivedJobs } = useMemo(() => {
    if (!data) return { activeJobs: [] as Job[], archivedJobs: [] as Job[] };
    const sorted = [...data.jobs].sort((a, b) => {
      const ta = a.pickup_at ? new Date(a.pickup_at).getTime() : Infinity;
      const tb = b.pickup_at ? new Date(b.pickup_at).getTime() : Infinity;
      return ta - tb;
    });
    const isDone = (s: string | null | undefined) => s === "completed" || s === "cancelled";
    return {
      activeJobs: sorted.filter((j) => !j.driver_hidden_at && !isDone(j.status)),
      archivedJobs: sorted.filter((j) => !!j.driver_hidden_at || isDone(j.status)),
    };
  }, [data]);
  const jobs = activeJobs;
  // Auto-reveal archived when there are none active but archived exist.
  useEffect(() => {
    if (jobs.length === 0 && archivedJobs.length > 0) setShowArchived(true);
  }, [jobs.length, archivedJobs.length]);

  // Batch D — Auto Next Job: watch for completion transitions and surface next assigned trip.
  const autoNextEnabled = data?.companySettings?.auto_next_job_enabled ?? true;
  const arrivalRadiusM = data?.companySettings?.arrival_radius_m ?? 150;
  const { nextJob: autoNextJob, dismiss: dismissAutoNext } = useAutoNextJob(
    jobs,
    { enabled: autoNextEnabled },
  );


  const branding = data?.branding;
  useFavicon(branding?.logo_url ?? null);

  const driver = data?.driver ?? null;

  // Active trip drives the fullscreen map focus + the "next instruction" hero.
  const liveStatuses = new Set(["en_route", "arrived", "in_progress"]);
  const activeJob: Job | null =
    jobs.find((j) => !!j.driver_accepted_at && liveStatuses.has(j.status ?? ""))
    ?? jobs.find((j) => !!j.driver_accepted_at && j.status !== "completed")
    ?? null;
  const mapJob: DriverMapJob | null = activeJob
    ? { id: activeJob.id, from_location: activeJob.from_location, to_location: activeJob.to_location, is_active: true }
    : null;

  // Driver location — lifted so routing + map both use one source of truth.
  const [driverPos, setDriverPos] = useState<{ lat: number; lng: number } | null>(null);
  const [currentSpeedMps, setCurrentSpeedMps] = useState<number | null>(null);
  const [lastSpeedAt, setLastSpeedAt] = useState<number | null>(null);
  const safetyThresholdKmh = data?.companySettings?.safety_mode_threshold_kmh ?? 10;
  const safetyEnabled = data?.companySettings?.safety_mode_enabled ?? true;
  const safetyAllowOverride = data?.companySettings?.safety_mode_allow_override ?? true;
  const [safetyUnlockedUntil, setSafetyUnlockedUntil] = useState(0);
  const { isSafetyMode, speedKmh } = useSafetyMode({
    speedMps: currentSpeedMps,
    thresholdKmh: safetyThresholdKmh,
    enabled: safetyEnabled,
    unlockedUntilMs: safetyUnlockedUntil,
  });

  useEffect(() => {
    if (!activeJob) {
      setCurrentSpeedMps(null);
      setLastSpeedAt(null);
    }
  }, [activeJob?.id]);

  useEffect(() => {
    if (!activeJob || lastSpeedAt == null) return;
    const elapsedMs = Date.now() - lastSpeedAt;
    if (elapsedMs >= 30_000) {
      setCurrentSpeedMps(null);
      return;
    }
    const timeoutId = window.setTimeout(() => setCurrentSpeedMps(null), 30_000 - elapsedMs);
    return () => window.clearTimeout(timeoutId);
  }, [activeJob?.id, lastSpeedAt]);

  const handleSpeedChange = useCallback((speedMps: number | null) => {
    setCurrentSpeedMps(speedMps);
    setLastSpeedAt(Date.now());
  }, []);

  // Where the driver is heading right now depends on the trip phase.
  const routeDestination =
    activeJob?.status === "in_progress" ? activeJob?.to_location
    : activeJob ? activeJob.from_location
    : null;

  // "In Motion" = the vehicle is actively moving on this trip.
  const inMotion = activeJob?.status === "en_route" || activeJob?.status === "in_progress";

  const wakeActive =
    activeJob?.status === "en_route"
    || activeJob?.status === "arrived"
    || activeJob?.status === "in_progress";
  const wake = useWakeLock(!!wakeActive);

  const live = useLiveRoute({
    origin: driverPos,
    destination: routeDestination,
    enabled: !!activeJob && !!driverPos && !!routeDestination,
  });

  const [navigateMode, setNavigateMode] = useState(false);
  useEffect(() => {
    if (!inMotion && navigateMode) setNavigateMode(false);
  }, [inMotion, navigateMode]);
  useEffect(() => {
    if (!dashboardCarouselApi) return;
    const sync = () => setDashboardPanelIndex(dashboardCarouselApi.selectedScrollSnap());
    sync();
    dashboardCarouselApi.on("select", sync);
    dashboardCarouselApi.on("reInit", sync);
    return () => {
      dashboardCarouselApi.off("select", sync);
      dashboardCarouselApi.off("reInit", sync);
    };
  }, [dashboardCarouselApi]);

  // Hands-free audio layer: dispatch/message chimes + Web Speech readouts.
  const audio = useDriverAudio({ storageKey: `driver:auto-read:${token}` });
  const [lastAnnouncement, setLastAnnouncement] = useState<string | null>(null);
  const knownJobIdsRef = useRef<Set<string> | null>(null);
  const unreadCountsRef = useRef<Map<string, number> | null>(null);
  const pendingIdsRef = useRef<Set<string> | null>(null);

  // Any assigned trip that hasn't been accepted yet requires the driver's consent.
  const pendingJobs = useMemo(
    () => jobs.filter((j) => !j.driver_accepted_at && !j.deletion_requested_at),
    [jobs],
  );

  useEffect(() => {
    if (!data) return;
    const currentJobs = data.jobs;
    const prevIds = knownJobIdsRef.current;
    const prevUnread = unreadCountsRef.current;
    const prevPending = pendingIdsRef.current;
    const currentPending = new Set(
      currentJobs.filter((j) => !j.driver_accepted_at && !j.deletion_requested_at).map((j) => j.id),
    );

    if (prevIds === null || prevUnread === null || prevPending === null) {
      knownJobIdsRef.current = new Set(currentJobs.map((j) => j.id));
      const seed = new Map<string, number>();
      for (const j of currentJobs) seed.set(j.id, j.unread_messages ?? 0);
      unreadCountsRef.current = seed;
      pendingIdsRef.current = currentPending;
      return;
    }

    const newJobs = currentJobs.filter((j) => !prevIds.has(j.id));
    // Newly pending = brand-new job OR existing job that a coordinator just (re)assigned.
    const newlyPending = currentJobs.filter(
      (j) => currentPending.has(j.id) && !prevPending.has(j.id),
    );
    if (newlyPending.length > 0) {
      audio.playChime("dispatch");
      try { if (typeof navigator !== "undefined" && "vibrate" in navigator) navigator.vibrate?.([180, 80, 180]); } catch { /* ignore */ }
      const j = newlyPending[0];
      const pickupLabel = j.pickup_at ? ` at ${formatMaltaTime(j.pickup_at)}` : "";
      const fromLbl = displayLocation(j.from_location, j.pickup_display_name);
      const toLbl = displayLocation(j.to_location, j.dropoff_display_name);
      const isReassign = !newJobs.some((nj) => nj.id === j.id);
      const text = isReassign
        ? `Trip reassigned to you: ${fromLbl} to ${toLbl}${pickupLabel}. Please accept or decline.`
        : `New trip assigned: ${fromLbl} to ${toLbl}${pickupLabel}. Please accept or decline.`;
      setLastAnnouncement(text);
      if (audio.autoRead) audio.speak(text);
    }

    const nextUnread = new Map<string, number>();
    let bumpedJob: Job | null = null;
    for (const j of currentJobs) {
      const cur = j.unread_messages ?? 0;
      nextUnread.set(j.id, cur);
      const before = prevUnread.get(j.id) ?? 0;
      if (cur > before && !newJobs.some((nj) => nj.id === j.id)) {
        bumpedJob = j;
      }
    }
    if (bumpedJob) {
      audio.playChime("message");
      const text = `New message on trip to ${displayLocation(bumpedJob.to_location, bumpedJob.dropoff_display_name)}`;
      setLastAnnouncement(text);
      if (audio.autoRead) audio.speak(text);
    }

    knownJobIdsRef.current = new Set(currentJobs.map((j) => j.id));
    unreadCountsRef.current = nextUnread;
    pendingIdsRef.current = currentPending;
  }, [data, audio]);

  useEffect(() => {
    if (!inMotion) audio.cancelSpeech();
  }, [inMotion, audio]);

  const speakLatest = useCallback(() => {
    if (audio.isSpeaking) { audio.cancelSpeech(); return; }
    if (lastAnnouncement) { audio.speak(lastAnnouncement); return; }
    if (activeJob) {
      const dest = activeJob.status === "in_progress"
        ? displayLocation(activeJob.to_location, activeJob.dropoff_display_name)
        : displayLocation(activeJob.from_location, activeJob.pickup_display_name);
      const etaMin = live.eta_sec != null ? Math.max(1, Math.round(live.eta_sec / 60)) : null;
      const nextInstructionText = getInstructionText(live.next_instruction);
      const parts = [
        activeJob.status === "in_progress" ? `Driving to ${dest}` : `Heading to pickup at ${dest}`,
        etaMin ? `ETA ${etaMin} minute${etaMin === 1 ? "" : "s"}` : null,
        nextInstructionText ? `Next: ${nextInstructionText}` : null,
      ].filter(Boolean);
      audio.speak(parts.join(". "));
    }
  }, [audio, lastAnnouncement, activeJob, live.eta_sec, live.next_instruction]);

  const dashboardPanels = [
    ...(activeJob ? [{
      key: `trip-${activeJob.id}`,
      label: "Active trip",
      content: (
        <NextInstructionCard
          job={activeJob}
          token={token}
          driverPos={driverPos}
          onOpenSummary={() => setOpenJob(activeJob)}
          live={live}
          canEnterNavigate={inMotion}
          onEnterNavigate={() => setNavigateMode(true)}
          canReturnToWaiting={isSafetyMode ? false : canReturnTripToWaiting(activeJob.status)}
        />

      ),
    }] : []),
    ...(!isSafetyMode && activeJob && (activeJob.status === "arrived" || activeJob.status === "in_progress") ? [{
      key: `waiting-${activeJob.id}`,
      label: "Waiting & charges",
      content: (
        <DriverWaitingPanel
          token={token}
          jobId={activeJob.id}
          status={activeJob.status ?? null}
          fromLocation={activeJob.from_location ?? null}
          toLocation={activeJob.to_location ?? null}
        />
      ),
    }] : []),
  ];
  useEffect(() => {
    if (dashboardPanelIndex < dashboardPanels.length) return;
    setDashboardPanelIndex(0);
    dashboardCarouselApi?.scrollTo(0);
  }, [dashboardCarouselApi, dashboardPanelIndex, dashboardPanels.length]);

  if (isLoading) {
    return (
      <div className="min-h-screen grid place-items-center">
        <div className="flex flex-col items-center gap-3 text-muted-foreground">
          <div className="h-8 w-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          <div className="text-sm">Loading manifest…</div>
        </div>
      </div>
    );
  }
  if (!data) return <NotFound />;

  return (
    <div className={`relative min-h-screen ${navigateMode ? "pb-0" : "pb-28"} ${isSafetyMode && !navigateMode ? "pt-16 sm:pt-20" : ""}`}>
      {!navigateMode && isSafetyMode && (
        <SafetyModeOverlay
          speedKmh={speedKmh}
          allowOverride={safetyAllowOverride}
          onUnlock={() => setSafetyUnlockedUntil(Date.now() + 30_000)}
        />
      )}
      {/* Always-on map canvas — never unmounts while the dashboard is open. */}
      <DriverDashboardMap
        activeJob={mapJob}
        routeEncodedPolyline={live.polyline}
        onDriverPosition={setDriverPos}
      />

      



      {!navigateMode && (
        <header
          className="sticky top-0 z-20 px-4 py-3 border-b border-white/40 dark:border-white/10 shadow-sm"
          style={{ background: "rgba(255,255,255,0.75)", backdropFilter: "blur(16px)", WebkitBackdropFilter: "blur(16px)" }}
        >
          <div className="max-w-3xl mx-auto flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <BrandLogo logoUrl={branding?.logo_url ?? null} name={branding?.company_name ?? data.link.subject_label ?? "D"} />
              <div className="min-w-0">
                <div className="text-[10px] text-primary font-semibold uppercase tracking-widest truncate">
                  {branding?.company_name ?? "Driver Manifest"}
                </div>
                <h1 className="text-lg font-bold truncate">{driver?.name ?? data.link.subject_label ?? "Driver"}</h1>
                {driver && !isSafetyMode && (
                  <div className="text-[11px] text-muted-foreground truncate">
                    {driver.seats_available != null ? `${driver.seats_available} seats · ` : ""}
                    {driver.availability_note ?? "No availability set"}
                  </div>
                )}
                {isSafetyMode && (
                  <div className="text-[11px] font-semibold text-emerald-700 dark:text-emerald-400 truncate flex items-center gap-1.5">
                    <span>Safety Mode · distracting options hidden</span>
                    {wake.held && (
                      <span className="inline-flex items-center gap-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/30 px-1.5 py-0.5 text-[9px] uppercase tracking-wider">
                        ☀ Screen awake
                      </span>
                    )}
                  </div>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2">
              {audio.speechSupported && (
                <Button
                  type="button"
                  size="icon"
                  variant={audio.isSpeaking ? "default" : "outline"}
                  aria-label={audio.isSpeaking ? "Stop speaking" : "Speak latest notification"}
                  aria-pressed={audio.isSpeaking}
                  onClick={speakLatest}
                >
                  {audio.isSpeaking ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
                </Button>
              )}
              {isSafetyMode ? (
                <Button size="icon" variant="outline" aria-label="Menu locked while driving" disabled>
                  <MoreVertical className="h-4 w-4" />
                </Button>
              ) : (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button size="icon" variant="outline" aria-label="Menu"><MoreVertical className="h-4 w-4" /></Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    {driver && (
                      <DropdownMenuItem onClick={() => setProfileOpen(true)}>
                        <User className="h-4 w-4 mr-2" /> Edit profile
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuItem onClick={() => setStatementOpen(true)}>
                      <FileText className="h-4 w-4 mr-2" /> Download statement
                    </DropdownMenuItem>
                    {audio.speechSupported && (
                      <>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          onClick={() => {
                            const next = !audio.autoRead;
                            audio.setAutoRead(next);
                            toast.success(next ? "Auto-read on: new alerts will be spoken" : "Auto-read off");
                          }}
                        >
                          <Megaphone className="h-4 w-4 mr-2" />
                          {audio.autoRead ? "Turn off auto-read" : "Turn on auto-read"}
                        </DropdownMenuItem>
                      </>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>

          </div>
        </header>
      )}

      <main className="relative z-10 max-w-3xl mx-auto p-3 space-y-3 pb-24">
        {isMobile ? (
          <section aria-label="Driver dashboard panels" className="space-y-2">
            <div className="flex items-center justify-between gap-2 px-1">
              <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                {dashboardPanels.length > 1 ? "Swipe panels" : "Dashboard"}
              </div>
              {dashboardPanels.length > 1 && (
                <div className="text-xs text-muted-foreground">
                  {dashboardPanelIndex + 1}/{dashboardPanels.length}
                </div>
              )}
            </div>
            <Carousel setApi={setDashboardCarouselApi} opts={{ align: "start" }} className="-mx-1">
              <CarouselContent className="ml-0">
                {dashboardPanels.map((panel) => (
                  <CarouselItem key={panel.key} className="pl-0">
                    <div className="px-1">
                      {panel.content}
                    </div>
                  </CarouselItem>
                ))}
              </CarouselContent>
            </Carousel>
            {dashboardPanels.length > 1 && (
              <div className="flex flex-wrap items-center justify-center gap-2 px-1">
                {dashboardPanels.map((panel, index) => (
                  <button
                    key={panel.key}
                    type="button"
                    onClick={() => dashboardCarouselApi?.scrollTo(index)}
                    aria-pressed={dashboardPanelIndex === index}
                    className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
                      dashboardPanelIndex === index
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border bg-background text-muted-foreground"
                    }`}
                  >
                    {panel.label}
                  </button>
                ))}
              </div>
            )}
          </section>
        ) : (
          dashboardPanels.map((panel) => (
            <div key={panel.key}>
              {panel.content}
            </div>
          ))
        )}

        {activeJob?.status === "arrived" && (
          <DriverBoardingApprovalPanel
            token={token}
            job={activeJob}
            onOpenBoarding={() => setOpenJob(activeJob)}
            onChat={() => setChatJob(activeJob)}
          />
        )}

 
          {pendingJobs.length > 0 && (
            <button
              type="button"
              onClick={() => {
                const el = document.getElementById(`job-card-${pendingJobs[0].id}`);
                el?.scrollIntoView({ behavior: "smooth", block: "start" });
              }}
              className="w-full text-left rounded-lg border-2 border-amber-500/70 bg-amber-500/10 p-3 flex items-center gap-3 animate-pulse"
              aria-label={`${pendingJobs.length} trip${pendingJobs.length === 1 ? "" : "s"} awaiting your response`}
            >
              <div className="h-9 w-9 rounded-full bg-amber-500 text-white grid place-items-center shrink-0">
                <AlertTriangle className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="font-semibold text-sm">
                  {pendingJobs.length} trip{pendingJobs.length === 1 ? "" : "s"} awaiting your response
                </div>
                <div className="text-xs text-muted-foreground truncate">
                  Tap to review — accept or decline before it's locked in.
                </div>
              </div>
              <Badge className="bg-amber-600 hover:bg-amber-600 text-white">{pendingJobs.length}</Badge>
            </button>
          )}

          {jobs.length === 0 && archivedJobs.length === 0 && (
            <div className="text-center py-20">
              <div className="mx-auto h-14 w-14 rounded-full bg-muted grid place-items-center mb-3">
                <MapPin className="h-6 w-6 text-muted-foreground" />
              </div>
              <div className="font-medium">No trips yet</div>
              <div className="text-sm text-muted-foreground mt-1">Your coordinator hasn't assigned trips.</div>
            </div>
          )}
          {jobs.length === 0 && archivedJobs.length > 0 && (
            <div className="text-center py-6 text-sm text-muted-foreground">
              No active trips — archived trips are shown below.
            </div>
          )}
          {jobs.map((j) => (
            <JobCard key={j.id} job={j} token={token} driverPos={driverPos} arrivalRadiusM={arrivalRadiusM} isSafetyMode={isSafetyMode} onOpen={() => setOpenJob(j)} onChat={() => setChatJob(j)} />
          ))}


          {archivedJobs.length > 0 && (
            <div className="pt-2">
              <button
                type="button"
                onClick={() => setShowArchived((v) => !v)}
                className="w-full text-xs font-medium text-muted-foreground hover:text-foreground py-2 border-t"
              >
                {showArchived ? "Hide" : "Show"} archived ({archivedJobs.length})
              </button>
              {showArchived && (
                <div className="space-y-3 mt-3 opacity-75">
                  {archivedJobs.map((j) => (
                    <JobCard key={j.id} job={j} token={token} driverPos={driverPos} arrivalRadiusM={arrivalRadiusM} isSafetyMode={isSafetyMode} onOpen={() => setOpenJob(j)} onChat={() => setChatJob(j)} />
                  ))}
                </div>
              )}
            </div>
          )}
        </main>

      {navigateMode && activeJob && (
        <NavigateFullscreen
          live={live}
          destination={routeDestination}
          destinationLabel={
            activeJob.status === "in_progress"
              ? displayLocation(activeJob.to_location, activeJob.dropoff_display_name)
              : displayLocation(activeJob.from_location, activeJob.pickup_display_name)
          }
          externalNavUrl={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(routeDestination ?? "")}&travelmode=driving`}
          onExit={() => setNavigateMode(false)}
          onSpeak={audio.speechSupported ? speakLatest : null}
          isSpeaking={audio.isSpeaking}
        />
      )}



      <TripExecutionDialog
        job={openJob}
        token={token}
        onOpenChange={(v) => !v && setOpenJob(null)}
        onChat={(job) => { setOpenJob(null); setChatJob(job); }}
      />
      <ProfileDialog open={profileOpen} onOpenChange={setProfileOpen} token={token} driver={driver} />
      <StatementDialog open={statementOpen} onOpenChange={setStatementOpen} token={token} driverName={driver?.name ?? "driver"} />
      <TripChatDialog
        open={!!chatJob} onOpenChange={(v) => !v && setChatJob(null)}
        jobId={chatJob?.id ?? null}
        title={chatJob ? `${displayLocation(chatJob.from_location, chatJob.pickup_display_name)} → ${displayLocation(chatJob.to_location, chatJob.dropoff_display_name)}` : ""}
        role="driver" token={token}
      />
      <DriverLiveShare token={token} hasActiveTrip={!!activeJob} hidden onSpeedChange={handleSpeedChange} />
      <AutoNextJobSheet
        job={autoNextJob}
        onDismiss={dismissAutoNext}
        onOpenTrip={() => { if (autoNextJob) { setOpenJob(autoNextJob as unknown as Job); dismissAutoNext(); } }}
      />
      <BrandingBar branding={data.branding} />
    </div>
  );
}

function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function GpsRadiusChip({ distanceM, thresholdM }: { distanceM: number; thresholdM: number }) {
  const within = distanceM <= thresholdM;
  const label = distanceM < 1000
    ? `${Math.round(distanceM)} m`
    : `${(distanceM / 1000).toFixed(distanceM < 10_000 ? 1 : 0)} km`;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold border ${
        within
          ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/30"
          : "bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/30"
      }`}
      title={`Your GPS is ${label} from this point. Allowed radius: ${thresholdM} m.`}
    >
      <MapPin className="h-3 w-3" />
      {label} / {thresholdM}m {within ? "✓" : ""}
    </span>
  );
}

/**
 * DriverStatusPill — one prominent, color-coded pill at the top of the trip
 * card that replaces the previous cluster of small status badges. Live states
 * (en_route / arrived / in_progress) get a pulsing dot so the driver can see
 * "the app knows what I'm doing" at a glance.
 */
function DriverStatusPill({
  status, accepted, problem,
}: { status?: string | null; accepted: boolean; problem: boolean }) {
  type Tone = { label: string; bg: string; text: string; dot: string; pulse: boolean };
  const s = (status ?? "").toLowerCase();
  let tone: Tone;
  if (problem) {
    tone = { label: "Attention needed", bg: "bg-rose-500/15 border-rose-500/40", text: "text-rose-700 dark:text-rose-300", dot: "bg-rose-500", pulse: true };
  } else if (!accepted) {
    tone = { label: "Awaiting your response", bg: "bg-amber-500/15 border-amber-500/40", text: "text-amber-800 dark:text-amber-200", dot: "bg-amber-500", pulse: true };
  } else if (s === "en_route") {
    tone = { label: "On the way", bg: "bg-sky-500/15 border-sky-500/40", text: "text-sky-700 dark:text-sky-300", dot: "bg-sky-500", pulse: true };
  } else if (s === "arrived") {
    tone = { label: "Arrived at pickup", bg: "bg-emerald-500/15 border-emerald-500/40", text: "text-emerald-700 dark:text-emerald-300", dot: "bg-emerald-500", pulse: true };
  } else if (s === "in_progress") {
    tone = { label: "Passenger on board", bg: "bg-blue-500/15 border-blue-500/40", text: "text-blue-700 dark:text-blue-300", dot: "bg-blue-500", pulse: true };
  } else if (s === "completed") {
    tone = { label: "Trip completed", bg: "bg-violet-500/15 border-violet-500/40", text: "text-violet-700 dark:text-violet-300", dot: "bg-violet-500", pulse: false };
  } else if (s === "cancelled") {
    tone = { label: "Cancelled", bg: "bg-rose-500/15 border-rose-500/40", text: "text-rose-700 dark:text-rose-300", dot: "bg-rose-500", pulse: false };
  } else {
    tone = { label: "Accepted — ready", bg: "bg-emerald-500/15 border-emerald-500/40", text: "text-emerald-700 dark:text-emerald-300", dot: "bg-emerald-500", pulse: false };
  }
  return (
    <span
      className={`inline-flex items-center gap-2 rounded-full border px-3 h-9 text-sm font-semibold ${tone.bg} ${tone.text}`}
      role="status"
      aria-live="polite"
    >
      <span className="relative inline-flex h-2.5 w-2.5">
        {tone.pulse && (
          <span className={`absolute inline-flex h-full w-full rounded-full opacity-60 animate-ping ${tone.dot}`} />
        )}
        <span className={`relative inline-flex h-2.5 w-2.5 rounded-full ${tone.dot}`} />
      </span>
      <span className="truncate">{tone.label}</span>
    </span>
  );
}



function JobCard({ job, token, driverPos, arrivalRadiusM, isSafetyMode, onOpen, onChat }: { job: Job; token: string; driverPos: { lat: number; lng: number } | null; arrivalRadiusM: number; isSafetyMode: boolean; onOpen: () => void; onChat: () => void }) {
  const qc = useQueryClient();
  const acceptFn = useServerFn(driverAcceptJob);
  const rejectFn = useServerFn(driverRejectJob);
  const approveDelFn = useServerFn(driverApproveDeletion);
  const statusFn = useServerFn(updateJobStatus);
  const payFn = useServerFn(setJobPaymentStatus);
  const hideFn = useServerFn(hideJobForDriver);
  const unhideFn = useServerFn(unhideJobForDriver);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [rejectNote, setRejectNote] = useState("");
  const [confirmDelOpen, setConfirmDelOpen] = useState(false);
  const [confirmHideOpen, setConfirmHideOpen] = useState(false);
  const [lateOpen, setLateOpen] = useState(false);
  const [summaryOpen, setSummaryOpen] = useState(false);
  
  const [lateMinutes, setLateMinutes] = useState<number>(10);
  const [lateNote, setLateNote] = useState("");
  const lateFn = useServerFn(driverReportLate);
  const clientLiveFn = useServerFn(getClientLiveLocationDriver);
  const snapPickupFn = useServerFn(driverSnapPickupToHere);
  const snapPickup = useMutation({
    mutationFn: () => {
      if (!driverPos) throw new Error("No GPS position yet — wait a few seconds and try again.");
      return snapPickupFn({
        data: { token, job_id: job.id, lat: driverPos.lat, lng: driverPos.lng },
      });
    },
    onSuccess: () => {
      toast.success("Pickup coordinates updated to your position");
      qc.invalidateQueries({ queryKey: ["driver-manifest"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const snapDropoffFn = useServerFn(driverSnapDropoffToHere);
  const snapDropoff = useMutation({
    mutationFn: () => {
      if (!driverPos) throw new Error("No GPS position yet — wait a few seconds and try again.");
      return snapDropoffFn({
        data: { token, job_id: job.id, lat: driverPos.lat, lng: driverPos.lng },
      });
    },
    onSuccess: () => {
      toast.success("Drop-off coordinates updated to your position");
      qc.invalidateQueries({ queryKey: ["driver-manifest"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });






  const activeForLive = !!job.driver_accepted_at && job.status !== "completed" && !job.deletion_requested_at;
  const { data: clientLive } = useQuery({
    queryKey: ["client-live", token, job.id],
    enabled: activeForLive,
    refetchInterval: activeForLive ? 8_000 : false,
    queryFn: () => clientLiveFn({ data: { token, job_id: job.id } }) as Promise<{
      latitude: number; longitude: number; accuracy_m: number | null;
      captured_at: string; pax_name: string | null; mode: string;
    } | null>,
  });
  const liveFresh = clientLive && (Date.now() - new Date(clientLive.captured_at).getTime()) < 90_000;

  // --- Pre-acceptance route preview (pickup → dropoff) ---
  const isPending = !job.driver_accepted_at && !job.deletion_requested_at;
  const accepted = !!job.driver_accepted_at;

  const previewEnabled = !!isPending && !!job.from_location && !!job.to_location;
  const routeFn = useServerFn(computeDriverRoute);
  const { data: previewData } = useQuery({
    queryKey: ["driver-trip-route", job.id, job.from_location, job.to_location],
    enabled: previewEnabled,
    refetchInterval: 60_000,
    staleTime: 45_000,
    queryFn: () => routeFn({
      data: {
        origin: { address: job.from_location! },
        destination_address: job.to_location!,
      },
    }) as Promise<{
      primary: null | {
        duration_sec: number | null; static_duration_sec: number | null; distance_m: number | null;
        polyline: string | null; next_instruction: string | null; next_maneuver: string | null;
        next_step_distance_m: number | null;
        steps: Array<{ maneuver: string | null; instruction: string | null; distance_m: number | null; polyline: string | null; end: { lat: number; lng: number } }>;
      };
      alternatives: unknown[];
    }>,
  });
  const previewPrimary = previewData?.primary ?? null;
  const previewTrafficDelaySec =
    previewPrimary?.duration_sec != null && previewPrimary?.static_duration_sec != null
      ? Math.max(0, previewPrimary.duration_sec - previewPrimary.static_duration_sec)
      : 0;
  const previewLive: LiveRouteInfo = {
    polyline: previewPrimary?.polyline ?? null,
    eta_sec: previewPrimary?.duration_sec ?? null,
    distance_m: previewPrimary?.distance_m ?? null,
    next_instruction: previewPrimary?.next_instruction ?? null,
    next_maneuver: previewPrimary?.next_maneuver ?? null,
    next_step_distance_m: previewPrimary?.next_step_distance_m ?? null,
    delay_sec: previewTrafficDelaySec,
    reroute_available: false,
    reroute_saving_sec: 0,
    onAcceptReroute: () => { /* no-op in preview */ },
    isLoading: false,
    steps: previewPrimary?.steps ?? [],
    off_route_m: 0,
    rerouting: false,
    last_recalc_at: null,
  };
  const [previewOpen, setPreviewOpen] = useState(false);

  // --- Post-acceptance ETA (driver GPS → pickup) — shown once accepted, until arrived ---
  const enRouteToPickup =
    accepted &&
    !!driverPos &&
    !!job.from_location &&
    !job.deletion_requested_at &&
    !["arrived_pickup", "boarding", "en_route_dropoff", "arrived_dropoff", "completed", "cancelled"].includes(job.status ?? "");
  const { data: toPickupData } = useQuery({
    queryKey: ["driver-to-pickup", job.id, job.from_location, driverPos ? `${driverPos.lat.toFixed(3)},${driverPos.lng.toFixed(3)}` : null],
    enabled: enRouteToPickup,
    refetchInterval: 60_000,
    staleTime: 45_000,
    queryFn: () => routeFn({
      data: {
        origin: { latitude: driverPos!.lat, longitude: driverPos!.lng },
        destination_address: job.from_location!,
      },
    }) as Promise<{ primary: null | { duration_sec: number | null; static_duration_sec: number | null; distance_m: number | null } }>,
  });
  const toPickupPrimary = toPickupData?.primary ?? null;





  const lateMut = useMutation({
    mutationFn: () => lateFn({ data: { token, job_id: job.id, minutes: lateMinutes, note: lateNote || undefined } }),
    onSuccess: () => {
      toast.success(`Reported ~${lateMinutes} min late`);
      setLateOpen(false); setLateNote(""); setLateMinutes(10);
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });



  const invalidate = () => qc.invalidateQueries({ queryKey: ["driver-manifest", token] });
  const acceptMut = useMutation({
    mutationFn: () => acceptFn({ data: { token, job_id: job.id } }),
    onSuccess: () => { toast.success("Trip accepted"); invalidate(); },
    onError: (e: Error) => toast.error(e.message),
  });
  const rejectMut = useMutation({
    mutationFn: (reason: string) => rejectFn({ data: { token, job_id: job.id, reason } }),
    onSuccess: () => {
      toast.success("Trip rejected — coordinator notified");
      setRejectOpen(false); setRejectReason("");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const approveDelMut = useMutation({
    mutationFn: () => approveDelFn({ data: { token, job_id: job.id } }),
    onSuccess: () => { toast.success("Deletion approved"); invalidate(); },
    onError: (e: Error) => toast.error(e.message),
  });
  const logActionFn = useServerFn(logDriverAction);
  const fireDriverActionLog = useCallback(
    async (
      action:
        | "en_route" | "arrived_pickup" | "in_progress" | "completed" | "back_to_waiting"
        | "wait_started" | "wait_ended"
        | "boarding_requested" | "boarding_approved"
        | "pax_no_show" | "pax_cancelled"
        | "navigate_opened" | "passenger_called",
    ) => {
      // Best-effort: grab a quick GPS fix, then log. Never blocks primary flow.
      const getPos = () =>
        new Promise<GeolocationPosition | null>((resolve) => {
          if (!navigator.geolocation) return resolve(null);
          navigator.geolocation.getCurrentPosition(
            (p) => resolve(p),
            () => resolve(null),
            { enableHighAccuracy: true, maximumAge: 15_000, timeout: 4_000 },
          );
        });
      try {
        const pos = await getPos();
        await logActionFn({
          data: {
            token, job_id: job.id, action,
            lat: pos?.coords.latitude,
            lng: pos?.coords.longitude,
            accuracy_m: pos?.coords.accuracy,
          } as any,
        });
      } catch { /* swallow — logging must never block */ }
    },
    [logActionFn, token, job.id],
  );
  const statusMut = useMutation({
    mutationFn: (input: string | { status: string; override_reason?: string; override_note?: string }) => {
      const arg = typeof input === "string" ? { status: input } : input;
      return statusFn({ data: {
        token, job_id: job.id, status: arg.status as never,
        ...(driverPos ? { lat: driverPos.lat, lng: driverPos.lng } : {}),
        ...(arg.override_reason ? { override_reason: arg.override_reason as never, override_note: arg.override_note } : {}),
      } });
    },
    onSuccess: (_res, input) => {
      const status = typeof input === "string" ? input : input.status;
      toast.success("Status updated");
      if (status === "en_route") void fireDriverActionLog("en_route");
      else if (status === "pending") void fireDriverActionLog("back_to_waiting");
      invalidate();
    },
    onError: (e: Error, input) => {
      const status = typeof input === "string" ? input : input.status;
      const msg = e.message ?? "";
      if (status === "arrived" && msg.startsWith("too_far_from_pickup:")) {
        const parts = msg.split(":");
        const dist = Number(parts[1] ?? 0);
        const ok = typeof window !== "undefined" && window.confirm(
          `You appear to be ~${dist}m from the pickup point. Confirm you are actually here (wrong pin / blocked access / passenger elsewhere)?`,
        );
        if (ok) {
          statusMut.mutate({ status: "arrived", override_reason: "wrong_pin", override_note: `Driver override at ${dist}m from pin` });
        }
        return;
      }
      toast.error(formatDriverStatusError(e));
    },
  });
  const payMut = useMutation({
    mutationFn: (status: "paid" | "pending") => payFn({ data: { token, job_id: job.id, status } }),
    onSuccess: () => { toast.success("Payment updated"); invalidate(); },
    onError: (e: Error) => toast.error(e.message),
  });
  const hideMut = useMutation({
    mutationFn: () => hideFn({ data: { token, job_id: job.id } }),
    onSuccess: () => { toast.success("Removed from your list"); invalidate(); },
    onError: (e: Error) => toast.error(e.message),
  });
  const unhideMut = useMutation({
    mutationFn: () => unhideFn({ data: { token, job_id: job.id } }),
    onSuccess: () => { toast.success("Restored"); invalidate(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const mapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(job.to_location)}`;
  const currentIdx = STATUS_FLOW.findIndex((s) => s.value === job.status);
  const nextStatus = STATUS_FLOW[currentIdx + 1] ?? (currentIdx === -1 ? STATUS_FLOW[0] : null);
  const paid = job.payment_status === "paid";
  const canReturnToWaiting = accepted && canReturnTripToWaiting(job.status);

  const problem = job.flight_status === "delayed" || job.flight_status === "cancelled" || !!job.deletion_requested_at;
  const pax = job.pax ?? [];
  const jobPaxSummary = getPaxSummary(pax);

  const borderClass = problem
    ? "border-destructive/60 ring-1 ring-destructive/40"
    : accepted
    ? "border-emerald-500/60 ring-1 ring-emerald-500/30"
    : "border-amber-500/70 ring-2 ring-amber-500/40";

  const dateLabel = job.pickup_at
    ? formatMaltaDateTime(job.pickup_at, { weekday: "short", day: "2-digit", month: "short" })
    : job.date;
  const timeLabel = job.pickup_at
    ? formatMaltaTime(job.pickup_at)
    : job.time?.slice(0, 5);

  const labels = job.labels ?? [];
  const stripeStyle = labels.length
    ? {
        background:
          labels.length === 1
            ? labels[0].color
            : `linear-gradient(to right, ${labels.slice(0, 3).map((l, i, a) => `${l.color} ${(i / a.length) * 100}% ${((i + 1) / a.length) * 100}%`).join(", ")})`,
      }
    : undefined;

  return (
    <article
      id={`job-card-${job.id}`}
      className={`rounded-2xl border-2 shadow-lg overflow-hidden transition ${borderClass} ${job.status === "in_progress" ? "animate-trip-flash" : ""}`}
      style={{ background: "rgba(255,255,255,0.82)", backdropFilter: "blur(14px)", WebkitBackdropFilter: "blur(14px)" }}
    >
      {stripeStyle && <div aria-hidden className="h-1.5 w-full" style={stripeStyle} />}
      {/* Header strip */}
      <div className={`px-4 py-2.5 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 ${problem ? "bg-destructive/10" : accepted ? "bg-emerald-500/10" : "bg-muted/50"}`}>
        <div className="flex min-w-0 items-center gap-2">
          <div className="shrink-0 rounded-lg bg-background/80 px-2 py-1 text-sm font-mono font-bold tracking-tight">{timeLabel}</div>
          <div className="truncate text-xs font-medium text-muted-foreground">{dateLabel}</div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {job.deletion_requested_at && (
            <Badge variant="destructive" className="text-[10px] gap-1"><AlertTriangle className="h-3 w-3" /> Delete requested</Badge>
          )}
          <DriverStatusPill status={job.status} accepted={accepted} problem={problem} />
        </div>
      </div>

      {/* Route */}
      <div className="px-4 pt-3">
        <div className="flex gap-3">
          <div className="flex flex-col items-center pt-1.5">
            <div className="h-2.5 w-2.5 rounded-full bg-primary" />
            <div className="flex-1 w-0.5 bg-border my-1 min-h-6" />
            <div className="h-2.5 w-2.5 rounded-full bg-primary ring-4 ring-primary/20" />
          </div>
          <div className="flex-1 min-w-0 space-y-2">
            <div>
              <div className="flex items-center justify-between gap-2">
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Pickup</div>
                {driverPos && job.pickup_lat != null && job.pickup_lng != null && (
                  <GpsRadiusChip
                    distanceM={haversineMeters(driverPos.lat, driverPos.lng, job.pickup_lat, job.pickup_lng)}
                    thresholdM={arrivalRadiusM}
                  />
                )}
              </div>
              <div className="text-base font-bold leading-tight break-words">{displayLocation(job.from_location, job.pickup_display_name)}</div>
              {job.from_flight && (
                <div className="text-xs mt-0.5 inline-flex items-center gap-1 text-muted-foreground">
                  <Plane className="h-3 w-3" /> {job.from_flight}
                  {(job.flight_status === "delayed" || job.flight_status === "cancelled") && (
                    <span className="text-destructive font-semibold ml-1">
                      {job.flight_status === "cancelled" ? "CANCELLED" : (job.flight_status_note || "DELAYED")}
                    </span>
                  )}
                </div>
              )}
            </div>
            <div>
              <div className="flex items-center justify-between gap-2">
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Drop-off</div>
                {driverPos && job.dropoff_lat != null && job.dropoff_lng != null && (
                  <GpsRadiusChip
                    distanceM={haversineMeters(driverPos.lat, driverPos.lng, job.dropoff_lat, job.dropoff_lng)}
                    thresholdM={arrivalRadiusM}
                  />
                )}
              </div>
              <div className="text-base font-bold leading-tight break-words">{displayLocation(job.to_location, job.dropoff_display_name)}</div>
              {job.to_flight && (
                <div className="text-xs mt-0.5 inline-flex items-center gap-1 text-muted-foreground">
                  <Plane className="h-3 w-3" /> {job.to_flight}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Progress */}
        {accepted && (
          <div className="mt-3 rounded-lg border bg-muted/30 p-2.5 space-y-1.5">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium">Trip progress</div>
            <TripProgress status={job.status} />
          </div>
        )}

        {/* Meta chips */}
        <div className="flex flex-wrap gap-1.5 mt-3">
          {job.clientcompanyname && <Badge variant="secondary" className="text-[10px]">{job.clientcompanyname}</Badge>}
          {(job.group_id || (job.grouped_count ?? 0) >= 2) && (
            <Badge className="text-[10px] gap-1 bg-primary/15 text-primary hover:bg-primary/15 border border-primary/30">
              ⛬ {job.group_name || "Grouped"}{job.grouped_count ? ` · ${job.grouped_count}` : ""}
            </Badge>
          )}
          {job.group_id && <DriverStopReorderButton token={token} groupId={job.group_id} />}
          {job.group_note && (
            <Badge variant="outline" className="text-[10px] italic max-w-full truncate">📝 {job.group_note}</Badge>
          )}
          {job.vehicle && <Badge variant="outline" className="text-[10px] gap-1"><Car className="h-3 w-3" />{job.vehicle}</Badge>}
          <Badge variant="outline" className="text-[10px] gap-1">
            <Users className="h-3 w-3" />
            {jobPaxSummary.total} pax
            {accepted && jobPaxSummary.onboard > 0 ? ` · ${jobPaxSummary.onboard} onboard` : ""}
          </Badge>
          
          {job.tracking_enabled && <Badge variant="outline" className="text-[10px]">Tracking</Badge>}
          {paid
            ? <Badge className="bg-emerald-600 hover:bg-emerald-600 text-[10px]">Paid</Badge>
            : <Badge variant="outline" className="text-[10px]">Pending payment</Badge>}
          {/* status now lives in the header pill */}
          {(job.labels ?? []).map((l) => <LabelChip key={l.id} label={l} />)}
        </div>

        {/* Passengers preview (always visible) */}
        {jobPaxSummary.total > 0 && (
          <div className="mt-3 rounded-lg bg-muted/40 border p-2.5">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1.5 flex items-center justify-between">
              <span className="inline-flex items-center gap-1"><Users className="h-3 w-3" /> Passengers ({jobPaxSummary.total})</span>
              <span className={jobPaxSummary.allResolved ? "text-emerald-600 font-semibold" : ""}>
                {jobPaxSummary.onboard} onboard
              </span>
            </div>
            <div className="mb-2 grid grid-cols-2 gap-1.5 text-[11px] sm:grid-cols-4">
              <div className="rounded-md bg-background px-2 py-1">Onboard <span className="font-semibold text-emerald-600">{jobPaxSummary.onboard}</span></div>
              <div className="rounded-md bg-background px-2 py-1">Pending <span className="font-semibold">{jobPaxSummary.pending}</span></div>
              <div className="rounded-md bg-background px-2 py-1">No-show <span className="font-semibold text-rose-600">{jobPaxSummary.noshow}</span></div>
              <div className="rounded-md bg-background px-2 py-1">Cancelled <span className="font-semibold">{jobPaxSummary.cancelled}</span></div>
            </div>
            <ul className="space-y-1">
              {pax.map((p) => (
                <li key={p.id} className="min-h-11 rounded-md bg-background/60 px-2.5 flex items-center justify-between gap-2 text-sm">
                  <span className="truncate">{p.name}</span>
                  {p.status === "onboard" && (
                    <span className="shrink-0 text-[11px] text-emerald-600 font-semibold inline-flex items-center gap-1">
                      <CheckCircle2 className="h-3.5 w-3.5" /> Onboard
                    </span>
                  )}
                  {p.status === "noshow" && (
                    <span className="shrink-0 text-[11px] text-rose-600 font-semibold inline-flex items-center gap-1">
                      <UserX className="h-3.5 w-3.5" /> No-show
                    </span>
                  )}
                  {p.status === "cancelled" && (
                    <span className="shrink-0 text-[11px] text-slate-700 font-semibold inline-flex items-center gap-1">
                      <X className="h-3.5 w-3.5" /> Cancelled
                    </span>
                  )}
                </li>
              ))}
            </ul>
            {jobPaxSummary.total > 0 && jobPaxSummary.allResolved && (
              <div className="mt-2 rounded-md bg-emerald-500/15 border border-emerald-500/40 text-emerald-700 dark:text-emerald-400 text-xs font-medium px-2.5 py-1.5 flex items-center gap-1.5">
                <CheckCircle2 className="h-3.5 w-3.5" /> All passengers resolved — ready to depart
              </div>
            )}
          </div>
        )}
      </div>

      {liveFresh && clientLive && (
        <ClientLiveMiniMap
          lat={clientLive.latitude}
          lng={clientLive.longitude}
          paxName={clientLive.pax_name}
          capturedAt={clientLive.captured_at}
        />
      )}

      {/* Price proposal (optional pre-accept) */}
      {!isSafetyMode && !job.deletion_requested_at && (
        <DriverPricePanel token={token} jobId={job.id} accepted={accepted} />
      )}
      {!isSafetyMode && accepted && job.status === "completed" && (
        <div className="px-3 pt-3">
          <DriverWaitingPanel
            token={token}
            jobId={job.id}
            status={job.status ?? null}
            fromLocation={job.from_location ?? null}
            toLocation={job.to_location ?? null}
          />
        </div>
      )}

      {/* Actions — one dominant primary CTA + icon row + "More" dropdown */}
      <div className="p-3 pt-3 space-y-3">
        {/* PENDING: Accept / Reject pair. Accept is the single primary CTA. */}
        {!accepted && !job.deletion_requested_at && (
          <>
            {previewEnabled && (
              <div className="rounded-xl border-2 border-primary/30 bg-primary/5 p-3 flex items-center gap-3">
                <div className="h-10 w-10 grid place-items-center rounded-full bg-primary/15 text-primary shrink-0">
                  <Navigation className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium">Trip route</div>
                  <div className="text-[11px] text-slate-700 truncate">
                    {displayLocation(job.from_location, job.pickup_display_name)}
                    <span className="mx-1 text-muted-foreground">→</span>
                    {displayLocation(job.to_location, job.dropoff_display_name)}
                  </div>
                  {previewPrimary ? (
                    <div className="text-sm font-bold tabular-nums text-slate-900 leading-tight mt-0.5 flex items-center gap-2 flex-wrap">
                      <span>
                        {(() => {
                          const s = previewPrimary.duration_sec;
                          if (s == null) return "—";
                          const m = Math.max(1, Math.round(s / 60));
                          return m < 60 ? `${m} min` : `${Math.floor(m / 60)}h ${m % 60}m`;
                        })()}
                      </span>
                      <span className="text-muted-foreground font-medium">
                        {previewPrimary.distance_m != null
                          ? (previewPrimary.distance_m < 950
                              ? `${Math.round(previewPrimary.distance_m / 10) * 10} m`
                              : `${(previewPrimary.distance_m / 1000).toFixed(previewPrimary.distance_m < 10_000 ? 1 : 0)} km`)
                          : ""}
                      </span>
                      {previewTrafficDelaySec >= 60 && (
                        <span className="inline-flex items-center rounded-full bg-amber-100 text-amber-900 text-[10px] font-semibold px-2 py-0.5">
                          +{Math.round(previewTrafficDelaySec / 60)} min traffic
                        </span>
                      )}
                    </div>
                  ) : (
                    <div className="text-sm text-muted-foreground">Calculating route…</div>
                  )}
                </div>
                <Button size="sm" variant="secondary" className="shrink-0 min-h-11" onClick={() => setPreviewOpen(true)}>
                  Preview route
                </Button>
              </div>
            )}

            <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
              <Button className="h-14 text-base font-semibold" disabled={acceptMut.isPending} onClick={() => acceptMut.mutate()}>
                {acceptMut.isPending ? "Accepting…" : "Accept trip"}
              </Button>
              <Button
                variant="outline"
                className="h-14 min-w-14 px-4 text-destructive border-destructive/40 hover:bg-destructive/10"
                onClick={() => setRejectOpen(true)}
                aria-label="Reject trip"
                title="Can't make it — Reject"
              >
                <ThumbsDown className="h-5 w-5" />
              </Button>
            </div>
          </>
        )}

        {/* ACCEPTED: single dominant primary CTA + icon row + More dropdown. */}
        {accepted && !job.deletion_requested_at && (
          <>
            {enRouteToPickup && toPickupPrimary?.duration_sec != null && (
              <div className="rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 flex items-center gap-2 text-xs">
                <Navigation className="h-3.5 w-3.5 text-primary shrink-0" />
                <span className="text-muted-foreground">ETA to pickup</span>
                <span className="font-semibold tabular-nums text-slate-900">
                  {(() => {
                    const m = Math.max(1, Math.round(toPickupPrimary.duration_sec! / 60));
                    return m < 60 ? `${m} min` : `${Math.floor(m / 60)}h ${m % 60}m`;
                  })()}
                </span>
                {toPickupPrimary.distance_m != null && (
                  <span className="text-muted-foreground tabular-nums">
                    · {toPickupPrimary.distance_m < 950
                      ? `${Math.round(toPickupPrimary.distance_m / 10) * 10} m`
                      : `${(toPickupPrimary.distance_m / 1000).toFixed(toPickupPrimary.distance_m < 10_000 ? 1 : 0)} km`}
                  </span>
                )}
                {toPickupPrimary.static_duration_sec != null &&
                  toPickupPrimary.duration_sec - toPickupPrimary.static_duration_sec >= 60 && (
                    <span className="ml-auto inline-flex items-center rounded-full bg-amber-100 text-amber-900 text-[10px] font-semibold px-2 py-0.5">
                      +{Math.round((toPickupPrimary.duration_sec - toPickupPrimary.static_duration_sec) / 60)} min traffic
                    </span>
                  )}
              </div>
            )}

            {/* Primary CTA — the next status step. Full-width, h-14. */}
            {nextStatus ? (
              <Button
                className="w-full h-14 text-base font-semibold"
                disabled={statusMut.isPending}
                onClick={() => {
                  if (nextStatus.value === "completed") setSummaryOpen(true);
                  else if (shouldHandleBoardingInDialog(job.status, nextStatus.value, jobPaxSummary.pending)) onOpen();
                  else statusMut.mutate(nextStatus.value);
                }}
              >
                {nextStatus.label}
              </Button>
            ) : (
              <Button className="w-full h-14 text-base font-semibold" variant="secondary" onClick={onOpen}>
                <QrCode className="h-5 w-5 mr-2" /> Open trip · Board passengers
              </Button>
            )}

            {/* Quick access to the boarding sheet even when there IS a next-status CTA. */}
            {nextStatus && jobPaxSummary.total > 0 && (
              <Button variant="ghost" className="w-full min-h-11 text-sm" onClick={onOpen}>
                <QrCode className="h-4 w-4 mr-1.5" /> Board passengers
              </Button>
            )}

            {/* Icon action row: Navigate · Chat · More */}
            <div className="grid grid-cols-3 gap-2">
              <Button variant="outline" className="h-12 min-w-12" asChild>
                <a href={mapsUrl} target="_blank" rel="noreferrer" aria-label="Navigate">
                  <Navigation className="h-5 w-5 mr-1.5" /> Navigate
                </a>
              </Button>
              <Button variant="outline" className="h-12 min-w-12 relative" onClick={onChat} aria-label="Chat coordinator">
                <MessageCircle className="h-5 w-5 mr-1.5" /> Chat
                {(job.unread_messages ?? 0) > 0 && (
                  <span className="absolute -top-1 -right-1 rounded-full bg-destructive text-destructive-foreground text-[10px] h-5 min-w-5 px-1 grid place-items-center font-semibold">
                    {job.unread_messages}
                  </span>
                )}
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" className="h-12 min-w-12" aria-label="More actions">
                    <MoreVertical className="h-5 w-5 mr-1.5" /> More
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-64">
                  <DropdownMenuItem asChild className="min-h-11">
                    <Link to="/m/driver/$token/sign/$jobId" params={{ token, jobId: job.id }}>
                      <Megaphone className="h-4 w-4 mr-2" /> Open sign board
                    </Link>
                  </DropdownMenuItem>
                  {!isSafetyMode && (job.status === "in_progress" || job.status === "arrived") && !!driverPos && (
                    <DropdownMenuItem
                      className="min-h-11"
                      disabled={snapDropoff.isPending}
                      onSelect={(e) => { e.preventDefault(); snapDropoff.mutate(); }}
                    >
                      <MapPin className="h-4 w-4 mr-2" /> Drop-off is here (use my GPS)
                    </DropdownMenuItem>
                  )}
                  {!isSafetyMode && (job.status === "en_route" || job.status === "arrived") && !!driverPos && (
                    <DropdownMenuItem
                      className="min-h-11"
                      disabled={snapPickup.isPending}
                      onSelect={(e) => { e.preventDefault(); snapPickup.mutate(); }}
                    >
                      <MapPin className="h-4 w-4 mr-2" /> Pickup is here (use my GPS)
                    </DropdownMenuItem>
                  )}
                  {!isSafetyMode && job.status !== "completed" && (
                    <DropdownMenuItem className="min-h-11" onSelect={(e) => { e.preventDefault(); setLateOpen(true); }}>
                      <Timer className="h-4 w-4 mr-2" /> Running late
                    </DropdownMenuItem>
                  )}
                  {!isSafetyMode && canReturnToWaiting && (
                    <DropdownMenuItem
                      className="min-h-11"
                      disabled={statusMut.isPending}
                      onSelect={(e) => { e.preventDefault(); statusMut.mutate("pending"); }}
                    >
                      <ArrowLeft className="h-4 w-4 mr-2" /> Back to waiting
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuSeparator />
                  {!isSafetyMode && (
                    <DropdownMenuItem
                      className="min-h-11"
                      disabled={payMut.isPending}
                      onSelect={(e) => { e.preventDefault(); payMut.mutate(paid ? "pending" : "paid"); }}
                    >
                      {paid ? "Mark payment pending" : "Mark paid"}
                    </DropdownMenuItem>
                  )}
                  {!isSafetyMode && (
                    job.driver_hidden_at ? (
                      <DropdownMenuItem
                        className="min-h-11"
                        disabled={unhideMut.isPending}
                        onSelect={(e) => { e.preventDefault(); unhideMut.mutate(); }}
                      >
                        Restore to list
                      </DropdownMenuItem>
                    ) : (
                      <DropdownMenuItem
                        className="min-h-11 text-muted-foreground"
                        disabled={hideMut.isPending}
                        onSelect={(e) => { e.preventDefault(); setConfirmHideOpen(true); }}
                      >
                        <X className="h-4 w-4 mr-2" /> Hide from my list
                      </DropdownMenuItem>
                    )
                  )}
                  <DropdownMenuSeparator />
                  {!isSafetyMode && job.status !== "in_progress" && job.status !== "completed" && (
                    <DropdownMenuItem
                      className="min-h-11 text-destructive focus:text-destructive"
                      onSelect={(e) => { e.preventDefault(); setRejectOpen(true); }}
                    >
                      <ThumbsDown className="h-4 w-4 mr-2" /> Can't make it — give back
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </>
        )}

        {/* Coordinator-initiated deletion approval, any state. */}
        {job.deletion_requested_at && (
          <Button
            variant="destructive"
            className="w-full h-14 text-base font-semibold"
            disabled={approveDelMut.isPending}
            onClick={() => setConfirmDelOpen(true)}
          >
            {approveDelMut.isPending ? "Approving…" : "Approve deletion"}
          </Button>
        )}
      </div>





      <Dialog open={rejectOpen} onOpenChange={(v) => { setRejectOpen(v); if (!v) { setRejectReason(""); setRejectNote(""); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Decline this trip?</DialogTitle>
            <DialogDescription>
              The coordinator needs to know why — please pick a reason. The trip returns to their Unassigned list.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-2">
              <Label>Reason (required)</Label>
              <div className="grid grid-cols-1 gap-1.5">
                {REJECT_REASONS.map((r) => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => setRejectReason(r)}
                    className={`text-left text-sm rounded-md border px-3 py-2 transition ${rejectReason === r ? "border-destructive bg-destructive/10 font-medium" : "border-border hover:bg-muted"}`}
                  >
                    {r}
                  </button>
                ))}
              </div>
            </div>
            <div className="space-y-2">
              <Label>Extra details (optional)</Label>
              <Textarea rows={2} value={rejectNote} onChange={(e) => setRejectNote(e.target.value)}
                placeholder="Anything the coordinator should know…" maxLength={300} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRejectOpen(false)}>Cancel</Button>
            <Button variant="destructive" disabled={rejectMut.isPending || !rejectReason}
              onClick={() => rejectMut.mutate(rejectNote ? `${rejectReason} — ${rejectNote.trim()}` : rejectReason)}>
              {rejectMut.isPending ? "Sending…" : "Decline trip"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={lateOpen} onOpenChange={setLateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Report running late</DialogTitle>
            <DialogDescription>
              Sends a note to the coordinator (and to the client chat) so everyone can plan around the delay.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">How many minutes late?</Label>
              <div className="flex flex-wrap gap-1.5 mt-1.5">
                {[5, 10, 15, 20, 30, 45].map((m) => (
                  <button key={m} type="button"
                    className={`text-xs rounded-full border px-3 py-1.5 ${lateMinutes === m ? "bg-primary text-primary-foreground border-primary" : "hover:bg-muted"}`}
                    onClick={() => setLateMinutes(m)}>
                    +{m} min
                  </button>
                ))}
              </div>
            </div>
            <div>
              <Label className="text-xs">Optional note</Label>
              <Textarea rows={2} value={lateNote} onChange={(e) => setLateNote(e.target.value)}
                placeholder="Traffic on the highway, still fuelling up…" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setLateOpen(false)}>Cancel</Button>
            <Button disabled={lateMut.isPending} onClick={() => lateMut.mutate()}>
              {lateMut.isPending ? "Sending…" : `Send "+${lateMinutes} min late"`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={confirmDelOpen} onOpenChange={setConfirmDelOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Approve deletion?</DialogTitle>
            <DialogDescription>
              The coordinator has requested this trip be removed from your list. Approving cannot be undone from here.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmDelOpen(false)}>Cancel</Button>
            <Button variant="destructive" disabled={approveDelMut.isPending}
              onClick={() => { approveDelMut.mutate(); setConfirmDelOpen(false); }}>
              Approve deletion
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={confirmHideOpen} onOpenChange={setConfirmHideOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Hide this trip from your list?</DialogTitle>
            <DialogDescription>
              You can restore it from the archived section any time.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmHideOpen(false)}>Cancel</Button>
            <Button variant="secondary" disabled={hideMut.isPending}
              onClick={() => { hideMut.mutate(); setConfirmHideOpen(false); }}>
              <X className="h-4 w-4 mr-1" /> Hide
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <TripSummaryDialog
        open={summaryOpen}
        onOpenChange={setSummaryOpen}
        token={token}
        job={summaryOpen ? {
          id: job.id,
          from_location: job.from_location,
          to_location: job.to_location,
          pickup_display_name: job.pickup_display_name,
          dropoff_display_name: job.dropoff_display_name,
          pickup_at: job.pickup_at,
          date: job.date,
          time: job.time,
        } : null}
      />


      {previewOpen && (
        <NavigateFullscreen
          mode="preview"
          live={previewLive}
          destination={job.to_location}
          destinationLabel={displayLocation(job.to_location, job.dropoff_display_name)}
          title={`${displayLocation(job.from_location, job.pickup_display_name)} → ${displayLocation(job.to_location, job.dropoff_display_name)}`}
          externalNavUrl={`https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(job.from_location)}&destination=${encodeURIComponent(job.to_location)}&travelmode=driving`}

          onExit={() => setPreviewOpen(false)}
          onSpeak={null}
          isSpeaking={false}
          footerSlot={
            <div className="border-t border-white/40" style={{ background: "rgba(255,255,255,0.97)" }}>
              <PreviewRouteSummary
                pickupAtIso={job.pickup_at}
                durationSec={previewPrimary?.duration_sec ?? null}
                staticDurationSec={previewPrimary?.static_duration_sec ?? null}
                distanceM={previewPrimary?.distance_m ?? null}
                trafficDelaySec={previewTrafficDelaySec}
              />
              <div className="flex gap-2 px-4 pb-3 pt-2">
                <Button variant="outline" className="flex-1 h-12 text-destructive border-destructive/40 hover:bg-destructive/10"
                  onClick={() => { setPreviewOpen(false); setRejectOpen(true); }}>
                  <ThumbsDown className="h-4 w-4 mr-1.5" /> Decline
                </Button>
                <Button className="flex-1 h-12 text-base" disabled={acceptMut.isPending}
                  onClick={() => { acceptMut.mutate(); setPreviewOpen(false); }}>
                  {acceptMut.isPending ? "Accepting…" : "Accept trip"}
                </Button>
              </div>
            </div>
          }
        />
      )}
    </article>

  );

}


/**
 * Info returned by `useLiveRoute` — the live traffic-aware routing snapshot
 * for the driver's current leg. Everything is optional so the UI can render
 * gracefully before the first response arrives.
 */
type RouteStep = {
  maneuver: string | null;
  instruction: string | null;
  distance_m: number | null;
  polyline: string | null;
  end: { lat: number; lng: number };
};

type LiveRouteInfo = {
  polyline: string | null;
  eta_sec: number | null;
  distance_m: number | null;
  next_instruction: string | null;
  next_maneuver: string | null;
  next_step_distance_m: number | null;
  delay_sec: number;                  // traffic vs free-flow duration
  reroute_available: boolean;         // an alternative saves >= 3 min AND >= 15%
  reroute_saving_sec: number;
  onAcceptReroute: () => void;
  isLoading: boolean;
  steps: RouteStep[];
  // Auto-recalc on deviation:
  off_route_m: number;                // perpendicular distance from planned polyline
  rerouting: boolean;                 // an auto-recalc is in-flight due to deviation
  last_recalc_at: number | null;      // epoch ms of last successful route response
};


/**
 * Polls the Routes API server-side every 30s while a driver has an active
 * leg. Detects heavy traffic (primary duration >> staticDuration) and
 * surfaces a faster alternative route the driver can accept in one tap.
 *
 * Deviation-triggered recalculation: on every GPS update we measure the
 * perpendicular distance from the driver's position to the active planned
 * polyline. If the driver is more than ~60m off-route for two consecutive
 * samples, we immediately invalidate the cached route and refetch — which
 * pulls a fresh polyline, ETA, and traffic delay for the new path the
 * driver is actually on. A "Rerouting…" flag is exposed to the UI while
 * the recompute is in flight so users see something is happening.
 */
function useLiveRoute({
  origin,
  destination,
  enabled,
}: {
  origin: { lat: number; lng: number } | null;
  destination: string | null;
  enabled: boolean;
}): LiveRouteInfo {
  const fn = useServerFn(computeDriverRoute);
  const qc = useQueryClient();
  const [acceptedAltIdx, setAcceptedAltIdx] = useState<number | null>(null);

  // Deviation state — mutable refs so we don't re-render on every GPS ping.
  const consecutiveOffRef = useRef(0);
  const lastRecalcAtRef = useRef<number | null>(null);
  const lastForcedAtRef = useRef(0);
  const [rerouting, setRerouting] = useState(false);
  const [offRouteM, setOffRouteM] = useState(0);

  // Coarser origin key (~110m) — we recompute on real movement, not GPS jitter.
  // Fine-grained refetches now happen on-demand via the deviation detector.
  const originKey = origin ? `${origin.lat.toFixed(3)},${origin.lng.toFixed(3)}` : null;
  const queryKey = ["driver-live-route", destination, originKey];

  const { data, isLoading, isFetching } = useQuery({
    queryKey,
    enabled: enabled && !!origin && !!destination,
    refetchInterval: 30_000,
    staleTime: 20_000,
    queryFn: () => fn({
      data: {
        origin: { latitude: origin!.lat, longitude: origin!.lng },
        destination_address: destination!,
      },
    }) as Promise<{
      primary: null | {
        duration_sec: number | null;
        static_duration_sec: number | null;
        distance_m: number | null;
        polyline: string | null;
        next_instruction: string | null;
        next_maneuver: string | null;
        next_step_distance_m: number | null;
        steps: RouteStep[];
      };
      alternatives: Array<{
        duration_sec: number | null;
        static_duration_sec: number | null;
        distance_m: number | null;
        polyline: string | null;
        next_instruction: string | null;
        next_maneuver: string | null;
        next_step_distance_m: number | null;
        steps: RouteStep[];
      }>;
    }>,
  });

  // Reset accepted alternative + deviation state when the destination changes.
  useEffect(() => {
    setAcceptedAltIdx(null);
    consecutiveOffRef.current = 0;
    setOffRouteM(0);
  }, [destination]);

  const primary = data?.primary ?? null;
  const alternatives = data?.alternatives ?? [];
  const active = acceptedAltIdx != null ? alternatives[acceptedAltIdx] ?? primary : primary;

  // Cache the decoded active polyline; decoding on every GPS ping is wasteful.
  const activePolyline = active?.polyline ?? null;
  const decodedPath = useMemo(
    () => (activePolyline ? decodePolyline(activePolyline) : []),
    [activePolyline],
  );

  // Track when the last successful response landed so the UI can show
  // "Updated Xs ago" and clear the "Rerouting…" flag.
  useEffect(() => {
    if (data) {
      lastRecalcAtRef.current = Date.now();
      setRerouting(false);
      consecutiveOffRef.current = 0;
    }
  }, [data]);

  // Deviation detector — runs whenever a new GPS fix arrives.
  useEffect(() => {
    if (!enabled || !origin || decodedPath.length < 2) return;
    const d = distanceToPathMeters(origin, decodedPath);
    setOffRouteM(d);

    // Thresholds tuned for city driving:
    // - <60m: still on-route (accounts for parallel lanes and GPS wander).
    // - 60m for 2 pings in a row: driver has truly deviated → recalc.
    const OFF_ROUTE_M = 60;
    const REFETCH_COOLDOWN_MS = 15_000;

    if (d > OFF_ROUTE_M) {
      consecutiveOffRef.current += 1;
    } else {
      consecutiveOffRef.current = 0;
    }

    const now = Date.now();
    if (
      consecutiveOffRef.current >= 2
      && !isFetching
      && now - lastForcedAtRef.current > REFETCH_COOLDOWN_MS
    ) {
      lastForcedAtRef.current = now;
      setRerouting(true);
      // Alternatives were computed for the old position — clear the choice
      // so we don't stay on a stale "faster route" that no longer applies.
      setAcceptedAltIdx(null);
      qc.invalidateQueries({ queryKey: ["driver-live-route", destination] });
    }
  }, [origin, decodedPath, enabled, destination, qc, isFetching]);

  const delay_sec = primary?.duration_sec != null && primary?.static_duration_sec != null
    ? Math.max(0, primary.duration_sec - primary.static_duration_sec) : 0;

  // "Meaningful" reroute: alternative is at least 3 minutes and 15% faster.
  const bestAlt = alternatives
    .map((a, i) => ({ a, i, saving: primary?.duration_sec != null && a.duration_sec != null
      ? primary.duration_sec - a.duration_sec : 0 }))
    .sort((x, y) => y.saving - x.saving)[0];
  const reroute_available = !!bestAlt
    && acceptedAltIdx == null
    && bestAlt.saving >= 180
    && !!primary?.duration_sec
    && bestAlt.saving / primary.duration_sec >= 0.15;

  return {
    polyline: active?.polyline ?? null,
    eta_sec: active?.duration_sec ?? null,
    distance_m: active?.distance_m ?? null,
    next_instruction: active?.next_instruction ?? null,
    next_maneuver: active?.next_maneuver ?? null,
    next_step_distance_m: active?.next_step_distance_m ?? null,
    delay_sec,
    reroute_available,
    reroute_saving_sec: bestAlt?.saving ?? 0,
    onAcceptReroute: () => { if (bestAlt) setAcceptedAltIdx(bestAlt.i); },
    isLoading,
    off_route_m: offRouteM,
    rerouting: rerouting && isFetching,
    last_recalc_at: lastRecalcAtRef.current,
    steps: active?.steps ?? [],
  };
}


function formatEtaMin(sec: number | null): string {
  if (sec == null) return "—";
  const m = Math.max(1, Math.round(sec / 60));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return `${h}h ${r}m`;
}

function formatDistance(m: number | null): string {
  if (m == null) return "—";
  if (m < 950) return `${Math.round(m / 10) * 10} m`;
  return `${(m / 1000).toFixed(m < 10_000 ? 1 : 0)} km`;
}

function ManeuverArrow({ maneuver, className }: { maneuver: string | null; className?: string }) {
  const cls = className ?? "h-6 w-6";
  switch (maneuver) {
    case "TURN_LEFT":
    case "TURN_SHARP_LEFT":
      return <ArrowLeft className={cls} />;
    case "TURN_SLIGHT_LEFT":
      return <ArrowUpLeft className={cls} />;
    case "TURN_RIGHT":
    case "TURN_SHARP_RIGHT":
      return <ArrowRight className={cls} />;
    case "TURN_SLIGHT_RIGHT":
      return <ArrowUpRight className={cls} />;
    case "UTURN_LEFT":
      return <CornerDownLeft className={cls} />;
    case "UTURN_RIGHT":
      return <CornerDownRight className={cls} />;
    case "STRAIGHT":
    case undefined:
    case null:
    default:
      return <ArrowUp className={cls} />;
  }
}

/**
 * Driving-safe hero: pinned above the manifest whenever the driver has an
 * active/accepted trip. Extra-large instruction text + a 64px+ primary
 * action so the button stays tappable while the phone is dashboard-mounted.
 */
function NextInstructionCard({ job, token, onOpenSummary, live, driverPos, canEnterNavigate, onEnterNavigate, canReturnToWaiting }: {
  job: Job; token: string; onOpenSummary: () => void; live: LiveRouteInfo;
  driverPos?: { lat: number; lng: number } | null;
  canEnterNavigate?: boolean; onEnterNavigate?: () => void;
  canReturnToWaiting?: boolean;
}) {
  const qc = useQueryClient();
  const statusFn = useServerFn(updateJobStatus);
  const jobPaxSummary = getPaxSummary(job.pax);
  const statusMut = useMutation({
    mutationFn: (input: string | { status: string; override_reason?: string; override_note?: string }) => {
      const arg = typeof input === "string" ? { status: input } : input;
      return statusFn({ data: {
        token, job_id: job.id, status: arg.status as never,
        ...(driverPos ? { lat: driverPos.lat, lng: driverPos.lng } : {}),
        ...(arg.override_reason ? { override_reason: arg.override_reason as never, override_note: arg.override_note } : {}),
      } });
    },
    onSuccess: () => { toast.success("Status updated"); qc.invalidateQueries({ queryKey: ["driver-manifest", token] }); },
    onError: (e: Error, input) => {
      const status = typeof input === "string" ? input : input.status;
      const msg = e.message ?? "";
      if (status === "arrived" && msg.startsWith("too_far_from_pickup:")) {
        const dist = Number(msg.split(":")[1] ?? 0);
        const ok = typeof window !== "undefined" && window.confirm(
          `You appear to be ~${dist}m from the pickup point. Confirm you are actually here (wrong pin / blocked access / passenger elsewhere)?`,
        );
        if (ok) {
          statusMut.mutate({ status: "arrived", override_reason: "wrong_pin", override_note: `Driver override at ${dist}m from pin` });
        }
        return;
      }
      toast.error(formatDriverStatusError(e));
    },
  });

  const currentIdx = STATUS_FLOW.findIndex((s) => s.value === job.status);
  const next = STATUS_FLOW[currentIdx + 1] ?? (currentIdx === -1 ? STATUS_FLOW[0] : null);

  const destination = job.status === "in_progress" ? job.to_location : job.from_location;
  const pickupLabel = displayLocation(job.from_location, job.pickup_display_name);
  const dropoffLabel = displayLocation(job.to_location, job.dropoff_display_name);
  const destinationLabel = job.status === "in_progress" ? dropoffLabel : pickupLabel;
  const headline =
    job.status === "in_progress" ? `DRIVE TO ${dropoffLabel.toUpperCase()}`
    : job.status === "arrived"    ? `BOARD PASSENGERS AT ${pickupLabel.toUpperCase()}`
    : job.status === "en_route"   ? `HEAD TO PICKUP · ${pickupLabel.toUpperCase()}`
    :                                `NEXT TRIP · ${pickupLabel.toUpperCase()}`;

  const navUrl = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}&travelmode=driving`;

  const showLive = job.status === "en_route" || job.status === "in_progress";
  const stripInstruction = getInstructionText(live.next_instruction);
  const routeHint = stripInstruction
    ? `${live.next_step_distance_m != null ? `Next turn in ${formatDistance(live.next_step_distance_m)}` : "Next turn"} · ${stripInstruction}`
    : live.next_step_distance_m != null
    ? `Next turn in ${formatDistance(live.next_step_distance_m)}`
    : null;

  return (
    <section
      aria-label="Next driving instruction"
      className="rounded-3xl border-2 border-white/60 dark:border-white/10 shadow-2xl overflow-hidden"
      style={{ background: "rgba(255,255,255,0.82)", backdropFilter: "blur(18px)", WebkitBackdropFilter: "blur(18px)" }}
    >
      {/* Reroute alert — appears when live traffic finds a materially faster path */}
      {showLive && live.reroute_available && (
        <button
          type="button"
          onClick={live.onAcceptReroute}
          className="w-full flex items-center gap-3 px-4 py-3 bg-amber-500 text-black font-bold text-left hover:bg-amber-400 transition"
        >
          <TrafficCone className="h-6 w-6 shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="text-sm uppercase tracking-widest">Traffic ahead</div>
            <div className="text-base leading-tight">
              Faster route saves {formatEtaMin(live.reroute_saving_sec)} — tap to switch
            </div>
          </div>
          <RouteIcon className="h-6 w-6 shrink-0" />
        </button>
      )}

      {showLive && (
        <div className="px-5 pt-4">
          <div className="rounded-2xl border border-primary/15 bg-primary/5 px-4 py-3 min-h-[72px]">
            <div className="flex items-start gap-3">
              <div className="rounded-full bg-background/90 p-2 text-primary shadow-sm">
                <ManeuverArrow maneuver={live.next_maneuver} className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground font-semibold">
                  Current route
                </div>
                <div className="text-sm font-semibold text-foreground truncate">
                  To {destinationLabel}
                </div>
                <div
                  className="mt-1 text-xs leading-relaxed text-muted-foreground truncate transition-opacity duration-300"
                  style={{ opacity: routeHint ? 1 : 0.6 }}
                >
                  {routeHint ?? "Calculating next turn…"}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}


      <div className="px-5 pt-4 pb-3 min-h-[188px]">
        <div className="text-[11px] font-bold uppercase tracking-[0.2em] text-primary">
          {job.status === "in_progress" ? "In progress" : job.status === "arrived" ? "At pickup" : "Next up"}
        </div>
        <h2 className="mt-1 text-xl sm:text-3xl font-black leading-tight tracking-tight text-slate-900 dark:text-white break-words">
          {headline}
        </h2>

        {/* Live ETA + remaining distance — height reserved so values update without shifting */}
        {showLive && (
          <div className="mt-3 grid grid-cols-2 gap-2 min-h-[76px]">
            <div className="rounded-xl bg-white/70 dark:bg-white/10 border border-white/60 px-3 py-2">
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground flex items-center gap-1.5">
                <span>ETA</span>
                {live.rerouting && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-primary/15 text-primary px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider animate-pulse">
                    <RouteIcon className="h-2.5 w-2.5" />
                    Rerouting
                  </span>
                )}
              </div>
              <div className="text-xl sm:text-2xl font-black tabular-nums leading-none mt-0.5 transition-opacity duration-200">
                {live.eta_sec != null ? formatEtaMin(live.eta_sec) : "—"}
              </div>
              {live.delay_sec >= 120 && (
                <div className="text-[11px] font-semibold text-amber-700 mt-0.5">
                  +{formatEtaMin(live.delay_sec)} in traffic
                </div>
              )}
              {!live.rerouting && live.off_route_m >= 60 && live.delay_sec < 120 && (
                <div className="text-[11px] font-semibold text-slate-600 mt-0.5">
                  Off route · {formatDistance(live.off_route_m)}
                </div>
              )}
            </div>
            <div className="rounded-xl bg-white/70 dark:bg-white/10 border border-white/60 px-3 py-2">
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Remaining</div>
              <div className="text-xl sm:text-2xl font-black tabular-nums leading-none mt-0.5 transition-opacity duration-200">
                {live.distance_m != null ? formatDistance(live.distance_m) : "—"}
              </div>
              <div className="text-[11px] text-muted-foreground mt-0.5 truncate">to {destinationLabel}</div>
            </div>
          </div>
        )}

        {!showLive && (
          <div className="mt-1 text-sm text-muted-foreground truncate">
            {job.status === "in_progress" ? `From ${pickupLabel}` : `To ${dropoffLabel}`}
          </div>
        )}
      </div>
      <div className="px-4 pb-4 grid gap-2">
        {job.status === "arrived" && (
          <PassengerSummaryPanel pax={job.pax} />
        )}
        {next && (
          <Button
            className="w-full min-h-16 text-lg font-bold rounded-2xl shadow-md"
            disabled={statusMut.isPending}
            onClick={() => {
              if (next.value === "completed") onOpenSummary();
              else if (shouldHandleBoardingInDialog(job.status, next.value, jobPaxSummary.pending)) onOpenSummary();
              else statusMut.mutate(next.value);
            }}
          >
            {statusMut.isPending ? "Updating…" : next.label.toUpperCase()}
          </Button>
        )}
        {statusMut.isError && next?.value === "arrived" && (
          <div className="rounded-xl bg-amber-50 border border-amber-200 px-3 py-2.5 text-sm text-amber-900">
            {formatDriverStatusError(statusMut.error as Error)}
          </div>
        )}
        <div className="grid grid-cols-2 gap-2">
          {canEnterNavigate && onEnterNavigate ? (
            <Button
              className="min-h-16 text-base font-bold rounded-2xl bg-primary text-primary-foreground shadow-md"
              onClick={onEnterNavigate}
            >
              <Maximize2 className="h-5 w-5 mr-2" /> Navigate Mode
            </Button>
          ) : (
            <Button asChild variant="secondary" className="min-h-16 text-base font-semibold rounded-2xl">
              <a href={navUrl} target="_blank" rel="noreferrer">
                <Navigation className="h-5 w-5 mr-2" /> Navigate
              </a>
            </Button>
          )}
          <Button variant="outline" className="min-h-16 text-base font-semibold rounded-2xl" onClick={onOpenSummary}>
            <QrCode className="h-5 w-5 mr-2" /> Trip details
          </Button>
        </div>
        {canReturnToWaiting && (
          <Button
            variant="ghost"
            className="w-full min-h-11 text-sm font-semibold rounded-2xl"
            disabled={statusMut.isPending}
            onClick={() => statusMut.mutate("pending")}
          >
            <ArrowLeft className="h-4 w-4 mr-1.5" /> Back to waiting
          </Button>
        )}
        {canEnterNavigate && (
          <a
            href={navUrl}
            target="_blank"
            rel="noreferrer"
            className="text-center text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground pt-1"
          >
            Open in Google Maps instead
          </a>
        )}
      </div>
    </section>
  );
}

/**
 * Slim bottom HUD shown while Navigate Mode is active. Occupies ≤20vh so
 * the map owns the rest of the screen. Only three data points: maneuver
 * arrow, distance-to-next-turn + ETA, and a massive Expand button.
 */
function NavigateHud({ live, onExit, onSpeak, isSpeaking }: {
  live: LiveRouteInfo; onExit: () => void;
  onSpeak: (() => void) | null; isSpeaking: boolean;
}) {
  const stripInstruction = live.next_instruction?.replace(/<[^>]+>/g, "").trim() ?? null;
  return (
    <div
      className="fixed inset-x-0 bottom-0 z-30 transition-all duration-300 ease-out animate-fade-in"
      style={{ maxHeight: "20vh" }}
    >
      {live.reroute_available && (
        <button
          type="button"
          onClick={live.onAcceptReroute}
          className="w-full flex items-center gap-2 px-4 py-2 bg-amber-500 text-black font-bold text-left"
        >
          <TrafficCone className="h-5 w-5 shrink-0" />
          <span className="flex-1 text-sm leading-tight">
            Faster route saves {formatEtaMin(live.reroute_saving_sec)} — tap to switch
          </span>
        </button>
      )}
      <div
        className="flex items-center gap-3 px-4 py-3 border-t-2 border-white/60 shadow-2xl"
        style={{ background: "rgba(255,255,255,0.82)", backdropFilter: "blur(18px)", WebkitBackdropFilter: "blur(18px)" }}
      >
        <ManeuverArrow
          maneuver={live.next_maneuver}
          className="h-16 w-16 shrink-0 text-primary"
        />
        <div className="min-w-0 flex-1">
          <div className="text-3xl sm:text-4xl font-black tabular-nums leading-none text-slate-900 dark:text-white">
            {formatDistance(live.next_step_distance_m) || formatDistance(live.distance_m)}
          </div>
          <div className="mt-1 flex items-baseline gap-2 text-base font-semibold text-slate-700 dark:text-slate-200">
            <span className="tabular-nums">ETA {formatEtaMin(live.eta_sec)}</span>
            {stripInstruction && (
              <span className="truncate text-sm text-muted-foreground">· {stripInstruction}</span>
            )}
          </div>
        </div>
        {onSpeak && (
          <button
            type="button"
            onClick={onSpeak}
            aria-label={isSpeaking ? "Stop speaking notification" : "Speak latest notification"}
            aria-pressed={isSpeaking}
            className={`shrink-0 min-h-16 min-w-16 grid place-items-center rounded-full font-bold shadow-lg active:scale-95 transition ${
              isSpeaking
                ? "bg-amber-500 text-black animate-pulse"
                : "bg-white/90 text-primary border-2 border-primary/40"
            }`}
          >
            {isSpeaking ? <VolumeX className="h-7 w-7" /> : <Volume2 className="h-7 w-7" />}
          </button>
        )}
        <button
          type="button"
          onClick={onExit}
          aria-label="Expand trip details"
          className="shrink-0 min-h-16 min-w-16 grid place-items-center rounded-2xl bg-primary text-primary-foreground font-bold shadow-lg active:scale-95 transition"
        >
          <Minimize2 className="h-7 w-7" />
        </button>
      </div>
    </div>
  );
}




function ProfileDialog({ open, onOpenChange, token, driver }: {
  open: boolean; onOpenChange: (v: boolean) => void; token: string; driver: Driver | null;
}) {
  const [name, setName] = useState(driver?.name ?? "");
  const [phone, setPhone] = useState(driver?.phone ?? "");
  const [car, setCar] = useState(driver?.car_make_model ?? "");
  const [plate, setPlate] = useState(driver?.plate ?? "");
  const [seats, setSeats] = useState<string>(driver?.seats_available != null ? String(driver.seats_available) : "");
  const [note, setNote] = useState(driver?.availability_note ?? "");
  useEffect(() => {
    setName(driver?.name ?? "");
    setPhone(driver?.phone ?? "");
    setCar(driver?.car_make_model ?? "");
    setPlate(driver?.plate ?? "");
    setSeats(driver?.seats_available != null ? String(driver.seats_available) : "");
    setNote(driver?.availability_note ?? "");
  }, [driver, open]);

  const mustOnboard = !!driver && !driver.onboarded_at;
  const qc = useQueryClient();
  const fn = useServerFn(updateDriverProfile);
  const mut = useMutation({
    mutationFn: () => fn({ data: {
      token,
      name: name.trim() || undefined,
      phone: phone.trim() || undefined,
      car_make_model: car.trim() === "" ? null : car.trim(),
      plate: plate.trim() === "" ? null : plate.trim(),
      seats_available: seats.trim() === "" ? null : Number(seats),
      availability_note: note.trim() === "" ? null : note.trim(),
    }}),
    onSuccess: () => { toast.success("Saved"); onOpenChange(false); qc.invalidateQueries({ queryKey: ["driver-manifest", token] }); },
    onError: (e: Error) => toast.error(e.message === "driver_link_required" ? "Ask your coordinator for a personal link." : e.message),
  });

  const canSave = name.trim().length > 0 && phone.trim().length > 0
    && (!mustOnboard || (car.trim().length > 0 && plate.trim().length > 0 && seats.trim().length > 0));

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!mustOnboard) onOpenChange(v); }}>
      <DialogContent onEscapeKeyDown={(e) => mustOnboard && e.preventDefault()} onPointerDownOutside={(e) => mustOnboard && e.preventDefault()}>
        <DialogHeader>
          <DialogTitle>{mustOnboard ? "Welcome — finish setup" : "Your profile"}</DialogTitle>
          <DialogDescription>
            {mustOnboard
              ? "A coordinator assigned you a trip. Please complete your profile before you can start."
              : "Coordinators see this on their dispatch board."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5"><Label>Full name *</Label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
          <div className="space-y-1.5"><Label>Phone number *</Label><Input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+356 …" /></div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5"><Label>Car {mustOnboard && "*"}</Label><Input value={car} onChange={(e) => setCar(e.target.value)} placeholder="Toyota Prius" /></div>
            <div className="space-y-1.5"><Label>Plate {mustOnboard && "*"}</Label><Input value={plate} onChange={(e) => setPlate(e.target.value)} placeholder="ABC 123" /></div>
          </div>
          <div className="space-y-1.5">
            <Label>Seats available {mustOnboard && "*"}</Label>
            <Input type="number" min={0} value={seats} onChange={(e) => setSeats(e.target.value)} placeholder="e.g. 4" />
          </div>
          <div className="space-y-1.5">
            <Label>Availability</Label>
            <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. Mon–Fri 06:00–18:00. Off Sundays." />
          </div>
        </div>
        <DialogFooter>
          <Button disabled={mut.isPending || !canSave} onClick={() => mut.mutate()}>
            {mut.isPending ? "Saving…" : mustOnboard ? "Complete setup" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const STMT_COLUMNS: { key: string; label: string; group: string }[] = [
  { key: "date", label: "Date", group: "Trip" },
  { key: "time", label: "Time", group: "Trip" },
  { key: "status", label: "Status", group: "Trip" },
  { key: "payment_status", label: "Client paid?", group: "Payment" },
  { key: "paid_amount", label: "Received (client)", group: "Payment" },
  { key: "paid_at", label: "Received on", group: "Payment" },
  { key: "driver_payout_status", label: "My payout?", group: "Payment" },
  { key: "driver_paid_amount", label: "My payout amount", group: "Payment" },
  { key: "driver_paid_method", label: "My payout method", group: "Payment" },
  { key: "driver_paid_at", label: "My payout on", group: "Payment" },
  { key: "driver_paid_reference", label: "My payout ref.", group: "Payment" },
  { key: "payment_method", label: "Agreed method", group: "Trip" },
  { key: "price_display", label: "Amount", group: "Trip" },
  { key: "price_currency", label: "Currency", group: "Trip" },
  { key: "price_set_by", label: "Price set by", group: "Trip" },
  { key: "labels", label: "Labels", group: "Trip" },
  { key: "clientcompanyname", label: "Client company", group: "Trip" },
  { key: "created_at", label: "Created", group: "Trip" },
  { key: "from_location", label: "From", group: "Route" },
  { key: "to_location", label: "To", group: "Route" },
  { key: "flight", label: "Flight", group: "Route" },
  { key: "flight_status", label: "Flight status", group: "Route" },
  { key: "driver_name", label: "Driver", group: "People" },
  { key: "driver_phone", label: "Driver phone", group: "People" },
  { key: "driver_vehicle", label: "Driver vehicle", group: "People" },
  { key: "vehicle", label: "Trip vehicle", group: "People" },
  { key: "pax_count", label: "Pax count", group: "People" },
  { key: "pax_names", label: "Passenger names", group: "People" },
  { key: "pax_boarded", label: "Boarded", group: "People" },
  { key: "driver_actual_minutes", label: "Duration (min)", group: "Ops" },
  { key: "driver_reported_km", label: "Distance (km)", group: "Ops" },
  { key: "driver_accepted_at", label: "Accepted at", group: "Ops" },
];
const DRIVER_DEFAULT_COLS = [
  "date","time","from_location","to_location","clientcompanyname",
  "pax_count","status","price_display","driver_payout_status","driver_paid_amount",
];
const STMT_STATUSES = ["pending","assigned","accepted","en_route","arrived","in_progress","completed","cancelled"];
const STMT_FLIGHT_STATUSES = ["scheduled","active","landed","delayed","cancelled","diverted"];

function StatementDialog({ open, onOpenChange, token, driverName }: {
  open: boolean; onOpenChange: (v: boolean) => void; token: string; driverName: string;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const monthAgo = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
  const [from, setFrom] = useState(monthAgo);
  const [to, setTo] = useState(today);
  const [payment, setPayment] = useState<"all" | "paid" | "pending">("all");
  const [status, setStatus] = useState<string[]>([]);
  const [flightStatus, setFlightStatus] = useState<string[]>([]);
  const [flightContains, setFlightContains] = useState("");
  const [fromContains, setFromContains] = useState("");
  const [toContains, setToContains] = useState("");
  const [paxContains, setPaxContains] = useState("");
  const [search, setSearch] = useState("");
  const [selectedCols, setSelectedCols] = useState<string[]>(() => {
    if (typeof window === "undefined") return DRIVER_DEFAULT_COLS;
    try {
      const raw = window.localStorage.getItem("driver:statement:columns:v1");
      if (raw) return JSON.parse(raw);
    } catch { /* ignore */ }
    return DRIVER_DEFAULT_COLS;
  });
  const [showFilters, setShowFilters] = useState(false);
  const [showCols, setShowCols] = useState(false);

  function saveCols(next: string[]) {
    setSelectedCols(next);
    try { window.localStorage.setItem("driver:statement:columns:v1", JSON.stringify(next)); } catch { /* ignore */ }
  }
  function toggle<T>(arr: T[], v: T): T[] {
    return arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v];
  }

  const fn = useServerFn(getDriverStatement);
  const build = () => fn({ data: {
    token, from, to, payment,
    status: status.length ? status : undefined,
    flight_status: flightStatus.length ? flightStatus : undefined,
    flight_contains: flightContains || undefined,
    from_contains: fromContains || undefined,
    to_contains: toContains || undefined,
    pax_contains: paxContains || undefined,
    search: search || undefined,
  } }) as Promise<Array<Record<string, unknown>>>;

  const previewQuery = useQuery({
    queryKey: ["driver-statement-preview", token, from, to, payment],
    queryFn: build,
    enabled: open,
    staleTime: 15_000,
  });
  const previewRows = (previewQuery.data ?? []) as Array<Record<string, unknown>>;
  const payoutTotals = previewRows.reduce<{ billed: number; received: number }>(
    (acc, r) => {
      acc.billed += Number((r as any).price_amount ?? 0);
      acc.received += Number((r as any).driver_paid_amount ?? 0);
      return acc;
    },
    { billed: 0, received: 0 },
  );

  function fileBase() {
    const slug = driverName.replace(/\s+/g, "_") || "driver";
    return `statement_${slug}_${from}_${to}`;
  }

  function buildRows(list: Array<Record<string, unknown>>) {
    const cols = STMT_COLUMNS.filter((c) => selectedCols.includes(c.key));
    return list.map((r) => {
      const out: Record<string, unknown> = {};
      for (const c of cols) {
        let v = r[c.key];
        if (v == null || v === "") v = "";
        else if (c.key === "time" && typeof v === "string") v = v.slice(0, 5);
        else if (c.key.endsWith("_at") || c.key === "created_at") {
          try { v = new Date(v as string).toLocaleString(); } catch { /* keep raw */ }
        }
        out[c.label] = v;
      }
      return out;
    });
  }

  const csvMut = useMutation({
    mutationFn: build,
    onSuccess: (list) => {
      if (!list.length) { toast.info("No trips in this range"); return; }
      const rows = buildRows(list);
      const headers = Object.keys(rows[0]);
      const csv = [headers.join(",")].concat(
        rows.map((r) => headers.map((h) => csvCell(r[h])).join(","))
      ).join("\n");
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `${fileBase()}.csv`;
      a.click();
      URL.revokeObjectURL(a.href);
      toast.success(`${list.length} trip(s) exported`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const xlsxMut = useMutation({
    mutationFn: build,
    onSuccess: async (list) => {
      if (!list.length) { toast.info("No trips in this range"); return; }
      const rows = buildRows(list);
      const XLSX = await import("xlsx");
      const ws = XLSX.utils.json_to_sheet(rows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Statement");
      XLSX.writeFile(wb, `${fileBase()}.xlsx`);
      toast.success(`${list.length} trip(s) exported`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const busy = csvMut.isPending || xlsxMut.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Download statement</DialogTitle>
          <DialogDescription>Filter your trips, pick the columns you want, then export.</DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5"><Label>From</Label><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
          <div className="space-y-1.5"><Label>To</Label><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
          <div className="col-span-2 space-y-1.5">
            <Label className="text-xs">Payment</Label>
            <div className="flex gap-2 flex-wrap">
              {(["all","paid","pending"] as const).map((k) => (
                <Button key={k} type="button" size="sm"
                  variant={payment === k ? "default" : "outline"}
                  onClick={() => setPayment(k)}>{k}</Button>
              ))}
            </div>
          </div>
        </div>

        <div className="border rounded-lg">
          <button type="button" onClick={() => setShowFilters((s) => !s)}
            className="w-full flex items-center justify-between px-3 py-2 text-sm font-medium">
            <span>More filters</span>
            <span className="text-xs text-muted-foreground">{showFilters ? "Hide" : "Show"}</span>
          </button>
          {showFilters && (
            <div className="px-3 pb-3 space-y-3 border-t pt-3">
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1"><Label className="text-xs">Free search</Label>
                  <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="text…" /></div>
                <div className="space-y-1"><Label className="text-xs">Flight contains</Label>
                  <Input value={flightContains} onChange={(e) => setFlightContains(e.target.value)} placeholder="KM101" /></div>
                <div className="space-y-1"><Label className="text-xs">From contains</Label>
                  <Input value={fromContains} onChange={(e) => setFromContains(e.target.value)} /></div>
                <div className="space-y-1"><Label className="text-xs">To contains</Label>
                  <Input value={toContains} onChange={(e) => setToContains(e.target.value)} /></div>
                <div className="space-y-1 col-span-2"><Label className="text-xs">Passenger name</Label>
                  <Input value={paxContains} onChange={(e) => setPaxContains(e.target.value)} /></div>
              </div>
              <div>
                <Label className="text-xs mb-1 block">Trip status</Label>
                <div className="flex flex-wrap gap-1.5">
                  {STMT_STATUSES.map((s) => (
                    <button key={s} type="button" onClick={() => setStatus((a) => toggle(a, s))}
                      className={`text-[11px] rounded-full px-2.5 py-1 border ${status.includes(s) ? "bg-primary text-primary-foreground border-primary" : "bg-background"}`}>
                      {s.replace("_"," ")}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <Label className="text-xs mb-1 block">Flight status</Label>
                <div className="flex flex-wrap gap-1.5">
                  {STMT_FLIGHT_STATUSES.map((s) => (
                    <button key={s} type="button" onClick={() => setFlightStatus((a) => toggle(a, s))}
                      className={`text-[11px] rounded-full px-2.5 py-1 border ${flightStatus.includes(s) ? "bg-primary text-primary-foreground border-primary" : "bg-background"}`}>
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="border rounded-lg">
          <button type="button" onClick={() => setShowCols((s) => !s)}
            className="w-full flex items-center justify-between px-3 py-2 text-sm font-medium">
            <span>Columns ({selectedCols.length})</span>
            <span className="text-xs text-muted-foreground">{showCols ? "Hide" : "Pick"}</span>
          </button>
          {showCols && (
            <div className="px-3 pb-3 border-t pt-3 space-y-3">
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={() => saveCols(STMT_COLUMNS.map((c) => c.key))}>All</Button>
                <Button size="sm" variant="outline" onClick={() => saveCols(DRIVER_DEFAULT_COLS)}>Defaults</Button>
                <Button size="sm" variant="outline" onClick={() => saveCols([])}>None</Button>
              </div>
              {["Trip","Payment","Route","People","Ops"].map((g) => (
                <div key={g}>
                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">{g}</div>
                  <div className="flex flex-wrap gap-1.5">
                    {STMT_COLUMNS.filter((c) => c.group === g).map((c) => (
                      <button key={c.key} type="button"
                        onClick={() => saveCols(selectedCols.includes(c.key) ? selectedCols.filter((k) => k !== c.key) : [...selectedCols, c.key])}
                        className={`text-[11px] rounded-full px-2.5 py-1 border ${selectedCols.includes(c.key) ? "bg-primary text-primary-foreground border-primary" : "bg-background"}`}>
                        {c.label}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <DriverPayoutList
          token={token}
          rows={previewRows}
          loading={previewQuery.isFetching}
          totals={payoutTotals}
          onChanged={() => previewQuery.refetch()}
        />



        <DialogFooter className="gap-2 sm:gap-2 flex-col sm:flex-row">
          <Button variant="outline" disabled={busy || !selectedCols.length} onClick={() => csvMut.mutate()}>
            <Download className="h-4 w-4 mr-1" /> {csvMut.isPending ? "Preparing…" : "Download CSV"}
          </Button>
          <Button disabled={busy || !selectedCols.length} onClick={() => xlsxMut.mutate()}>
            <FileText className="h-4 w-4 mr-1" /> {xlsxMut.isPending ? "Preparing…" : "Download XLSX"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}


function csvCell(v: unknown): string {
  if (v == null) return "";
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function TripExecutionDialog({
  job,
  token,
  onOpenChange,
  onChat,
}: {
  job: Job | null;
  token: string;
  onOpenChange: (v: boolean) => void;
  onChat: (job: Job) => void;
}) {
  const qc = useQueryClient();
  const listFn = useServerFn(listJobPaxDriver);
  const markFn = useServerFn(markPaxOnboard);
  const noShowFn = useServerFn(markPaxNoShow);
  const undoFn = useServerFn(markPaxPending);
  const cancelFn = useServerFn(markPaxCancelled);
  const statusFn = useServerFn(updateJobStatus);
  const requestApprovalFn = useServerFn(requestBoardingApproval);
  const overrideApprovalFn = useServerFn(driverOverrideBoardingApproval);
  const approvalFn = useServerFn(getBoardingApprovalStatusDriver);
  const [approvalNote, setApprovalNote] = useState("");
  const [showApprovalFlow, setShowApprovalFlow] = useState(false);
  const [overrideConfirmOpen, setOverrideConfirmOpen] = useState(false);
  const [approvalError, setApprovalError] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const passengerListRef = useRef<HTMLDivElement | null>(null);
  const approvalPollingEnabled = !!job && job.status === "arrived";

  useEffect(() => {
    if (!job) {
      setApprovalNote("");
      setShowApprovalFlow(false);
      setOverrideConfirmOpen(false);
      setApprovalError(null);
      return;
    }
    const id = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [job]);

  const { data: pax, refetch } = useQuery({
    queryKey: ["driver-pax", job?.id],
    queryFn: () => listFn({
      data: { token, job_id: job!.id },
    }) as Promise<DriverPaxRow[]>,
    enabled: !!job,
  });
  const { data: approvals, refetch: refetchApprovals } = useQuery({
    queryKey: ["driver-boarding-approval-dialog", job?.id],
    queryFn: () => approvalFn({ data: { token, job_id: job!.id } }) as Promise<BoardingApproval[]>,
    enabled: approvalPollingEnabled,
    refetchInterval: approvalPollingEnabled ? 10_000 : false,
  });

  const latestApproval = approvals?.[0] ?? null;
  const summary = getPaxSummary(pax);
  const canStartWithApproval = latestApproval?.status === "approved" || latestApproval?.status === "overridden";
  const approvalVisible = !!job && job.status === "arrived" && (
    (showApprovalFlow && summary.pending > 0)
    || (
      !!latestApproval
      && (
        summary.pending > 0
        || latestApproval.status === "pending"
        || latestApproval.status === "approved"
        || latestApproval.status === "overridden"
      )
    )
  );

  const invalidateManifest = () => qc.invalidateQueries({ queryKey: ["driver-manifest", token] });
  const refreshBoardingState = async () => {
    try {
      await Promise.all([refetch(), refetchApprovals(), invalidateManifest()]);
    } catch {
      toast.error("The passenger update was saved, but the latest boarding screen did not refresh. Please reopen the trip if needed.");
    }
  };

  const markMut = useMutation({
    mutationFn: (v: { pax_id: string; method: "qr" | "manual" }) =>
      markFn({ data: { token, job_id: job!.id, pax_id: v.pax_id, method: v.method } }),
    onSuccess: async () => {
      setApprovalError(null);
      toast.success("Passenger onboard");
      await refreshBoardingState();
    },
    onError: (e: Error) => toast.error(e.message === "qr_required" ? "QR scan required for this trip" : e.message),
  });
  const noShowMut = useMutation({
    mutationFn: (pax_id: string) => noShowFn({ data: { token, job_id: job!.id, pax_id } }),
    onSuccess: async () => {
      setApprovalError(null);
      toast.success("Marked as no-show");
      await refreshBoardingState();
    },
    onError: (e: Error) => toast.error(formatDriverStatusError(e)),
  });
  const cancelMut = useMutation({
    mutationFn: (pax_id: string) => cancelFn({ data: { token, job_id: job!.id, pax_id } }),
    onSuccess: async () => {
      setApprovalError(null);
      toast.success("Marked as cancelled");
      await refreshBoardingState();
    },
    onError: (e: Error) => toast.error(formatDriverStatusError(e)),
  });
  const undoMut = useMutation({
    mutationFn: (pax_id: string) => undoFn({ data: { token, job_id: job!.id, pax_id } }),
    onSuccess: async () => {
      setApprovalError(null);
      toast.success("Reset to pending");
      await refreshBoardingState();
    },
    onError: (e: Error) => toast.error(formatDriverStatusError(e)),
  });
  const startTripMut = useMutation({
    mutationFn: () => statusFn({ data: { token, job_id: job!.id, status: "in_progress" } }),
    onSuccess: async () => {
      toast.success("Status updated");
      setApprovalError(null);
      onOpenChange(false);
      await invalidateManifest();
    },
    onError: (e: Error) => {
      const formatted = formatDriverStatusError(e);
      setApprovalError(formatted);
      if (e.message === "partial_boarding_needs_approval") {
        setShowApprovalFlow(true);
      }
      toast.error(formatted);
    },
  });
  const requestApprovalMut = useMutation({
    mutationFn: () => requestApprovalFn({
      data: {
        token,
        job_id: job!.id,
        driver_note: approvalNote.trim() || undefined,
      },
    }),
    onSuccess: async () => {
      toast.success("Boarding approval requested. Waiting for coordinator response.");
      setShowApprovalFlow(true);
      setApprovalError(null);
      await refreshBoardingState();
    },
    onError: (e: Error) => {
      const formatted = formatDriverStatusError(e);
      setShowApprovalFlow(true);
      setApprovalError(formatted);
      toast.error(formatted);
    },
  });
  const overrideApprovalMut = useMutation({
    mutationFn: () => overrideApprovalFn({ data: { token, job_id: job!.id, approval_id: latestApproval!.id } }),
    onSuccess: async () => {
      toast.success("Boarding override applied");
      setApprovalError(null);
      setOverrideConfirmOpen(false);
      await refreshBoardingState();
      startTripMut.mutate();
    },
    onError: (e: Error) => {
      const formatted = formatDriverStatusError(e);
      setApprovalError(formatted);
      toast.error(formatted);
    },
  });

  function handleStartTrip() {
    if (!job) return;
    if (job.status !== "arrived") {
      startTripMut.mutate();
      return;
    }
    if (summary.pending > 0 && !canStartWithApproval) {
      setShowApprovalFlow(true);
      setApprovalError("Some passengers are still pending. Request coordinator approval or finish boarding decisions first.");
      return;
    }
    startTripMut.mutate();
  }

  return (
    <>
      <Dialog open={!!job} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{job ? `${displayLocation(job.from_location, job.pickup_display_name)} → ${displayLocation(job.to_location, job.dropoff_display_name)}` : ""}</DialogTitle>
            <DialogDescription>
              Confirm, mark no-show, or cancel passengers before starting the trip.
            </DialogDescription>
          </DialogHeader>

          {job?.status === "arrived" && (
            <div className="space-y-3">
              <PassengerSummaryPanel pax={pax} />
              {approvalVisible && (
                <div className="space-y-2">
                  {!latestApproval && (
                    <div className="space-y-1.5">
                      <Label htmlFor="boarding-note">Driver note for coordinator (optional)</Label>
                      <Textarea
                        id="boarding-note"
                        value={approvalNote}
                        onChange={(e) => setApprovalNote(e.target.value)}
                        maxLength={500}
                        placeholder="Explain why some passengers are still pending…"
                      />
                    </div>
                  )}
                  <BoardingApprovalCard
                    approval={latestApproval}
                    nowMs={nowMs}
                    pendingCount={summary.pending}
                    resolvedCount={summary.resolved}
                    requestNote={approvalNote.trim()}
                    requestBusy={requestApprovalMut.isPending}
                    overrideBusy={overrideApprovalMut.isPending}
                    startBusy={startTripMut.isPending}
                    approvalError={approvalError}
                    onRequest={() => requestApprovalMut.mutate()}
                    onOverride={() => setOverrideConfirmOpen(true)}
                    onOpenBoarding={() => {
                      setApprovalError(null);
                      setShowApprovalFlow(false);
                      const prefersReducedMotion = typeof window !== "undefined"
                        && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
                      passengerListRef.current?.scrollIntoView({
                        behavior: prefersReducedMotion ? "auto" : "smooth",
                        block: "start",
                      });
                    }}
                    onChat={() => job && onChat(job)}
                    onStartTrip={handleStartTrip}
                  />
                </div>
              )}
            </div>
          )}

          <div ref={passengerListRef} className="space-y-2 max-h-72 overflow-auto pr-1">
            {(pax ?? []).length === 0 && <p className="text-sm text-muted-foreground text-center py-6">No passengers on this trip.</p>}
            {(pax ?? []).map((p) => {
              const isOnboard = p.status === "onboard";
              const isNoShow = p.status === "noshow";
              const isCancelled = p.status === "cancelled";
              const isPending = !isOnboard && !isNoShow && !isCancelled;
              return (
                <div
                  key={p.id}
                  className={`flex flex-col gap-2 border rounded-md p-2.5 sm:flex-row sm:items-center sm:justify-between ${
                    isNoShow ? "border-destructive/50 bg-destructive/5" : isCancelled ? "border-slate-300 bg-slate-50" : ""
                  }`}
                >
                  <div className="min-w-0">
                    <div className="font-medium truncate">{p.name}</div>
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      {isPending && <Badge variant="outline">Pending</Badge>}
                      {isOnboard && <Badge className="bg-emerald-600 hover:bg-emerald-600">Onboard</Badge>}
                      {isNoShow && <Badge variant="destructive" className="gap-1"><UserX className="h-3 w-3" /> No-show</Badge>}
                      {isCancelled && <Badge variant="secondary" className="gap-1"><X className="h-3 w-3" /> Cancelled</Badge>}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                    {isPending && (
                      <>
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={markMut.isPending}
                          onClick={() => markMut.mutate({ pax_id: p.id, method: "manual" })}
                        >
                          Confirm
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="text-destructive border-destructive/40 hover:bg-destructive/10"
                          disabled={noShowMut.isPending}
                          onClick={() => noShowMut.mutate(p.id)}
                        >
                          <UserX className="h-4 w-4 mr-1" /> No-show
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={cancelMut.isPending}
                          onClick={() => cancelMut.mutate(p.id)}
                        >
                          <X className="h-4 w-4 mr-1" /> Cancelled
                        </Button>
                      </>
                    )}
                    {!isPending && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-muted-foreground"
                        disabled={undoMut.isPending}
                        onClick={() => undoMut.mutate(p.id)}
                      >
                        Undo
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {job?.status === "arrived" && (
            <DialogFooter className="gap-2 sm:gap-2 flex-col sm:flex-row">
              <Button variant="ghost" onClick={() => onOpenChange(false)}>Close</Button>
              <Button onClick={handleStartTrip} disabled={startTripMut.isPending}>
                {startTripMut.isPending ? "Starting…" : "Passengers on board — en route"}
              </Button>
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={overrideConfirmOpen} onOpenChange={setOverrideConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Override coordinator approval and start this trip?</DialogTitle>
            <DialogDescription>
              Use this only when the coordinator has not responded within {BOARDING_OVERRIDE_MINUTES} minutes and you need to depart with pending passengers.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOverrideConfirmOpen(false)}>Cancel</Button>
            <Button onClick={() => overrideApprovalMut.mutate()} disabled={overrideApprovalMut.isPending}>
              {overrideApprovalMut.isPending ? "Overriding…" : "Override now"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}


function NotFound() {
  return (
    <div className="min-h-screen grid place-items-center px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold">Link invalid or expired</h1>
        <p className="text-sm text-muted-foreground mt-2">Ask your coordinator for a new link.</p>
      </div>
    </div>
  );
}

function DriverStopReorderButton({ token, groupId }: { token: string; groupId: string }) {
  const [open, setOpen] = useState(false);
  const [order, setOrder] = useState<string[] | null>(null);
  const qc = useQueryClient();
  const listFn = useServerFn(listGroupStopsForDriver);
  const submitFn = useServerFn(requestStopReorderByDriver);

  const { data } = useQuery({
    queryKey: ["driver-stops", groupId],
    queryFn: () => listFn({ data: { token, group_id: groupId } }),
    enabled: open,
  });

  const stops = data?.stops ?? [];
  const pending = data?.pending;
  const current = order ?? stops.map((s: any) => s.id);

  const move = (i: number, dir: -1 | 1) => {
    const next = i + dir;
    if (next < 0 || next >= current.length) return;
    const copy = [...current];
    [copy[i], copy[next]] = [copy[next], copy[i]];
    setOrder(copy);
  };

  const submit = useMutation({
    mutationFn: () => submitFn({ data: { token, group_id: groupId, proposed_order: current } }),
    onSuccess: () => {
      toast.success("Reorder request sent to coordinator");
      qc.invalidateQueries({ queryKey: ["driver-stops", groupId] });
      setOpen(false);
      setOrder(null);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <>
      <Badge
        onClick={() => setOpen(true)}
        className="text-[10px] cursor-pointer bg-secondary text-secondary-foreground hover:bg-secondary/80"
      >
        🔀 Reorder stops
      </Badge>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Request stop reorder</DialogTitle>
            <DialogDescription>
              Coordinator approval required before the change takes effect.
            </DialogDescription>
          </DialogHeader>
          {pending ? (
            <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs text-amber-700">
              Waiting for coordinator to review your previous request.
            </div>
          ) : stops.length === 0 ? (
            <div className="text-xs text-muted-foreground">No stops recorded for this group.</div>
          ) : (
            <ol className="space-y-1.5">
              {current.map((id, i) => {
                const stop = stops.find((s: any) => s.id === id);
                if (!stop) return null;
                return (
                  <li key={id} className="flex items-center gap-2 border rounded px-2 py-1.5 text-xs">
                    <span className="w-5 text-center font-mono">{i + 1}</span>
                    <span className="flex-1 truncate">
                      {displayLocation(stop.address, stop.display_name)}
                    </span>
                    <button className="p-1" onClick={() => move(i, -1)} disabled={i === 0}>↑</button>
                    <button className="p-1" onClick={() => move(i, 1)} disabled={i === current.length - 1}>↓</button>
                  </li>
                );
              })}
            </ol>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => { setOpen(false); setOrder(null); }}>
              Cancel
            </Button>
            <Button
              onClick={() => submit.mutate()}
              disabled={!!pending || stops.length === 0 || submit.isPending}
            >
              {submit.isPending ? "Sending…" : "Send request"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/**
 * Compact route summary shown under the preview map before the driver
 * accepts a trip. Surfaces the four numbers a driver needs at a glance:
 * pickup ETA (scheduled), dropoff ETA (scheduled pickup + driving time),
 * distance, and current traffic delay.
 */
function PreviewRouteSummary({
  pickupAtIso,
  durationSec,
  staticDurationSec,
  distanceM,
  trafficDelaySec,
}: {
  pickupAtIso: string | null;
  durationSec: number | null;
  staticDurationSec: number | null;
  distanceM: number | null;
  trafficDelaySec: number;
}) {
  const pickupMs = pickupAtIso ? new Date(pickupAtIso).getTime() : null;
  const dropoffMs =
    pickupMs != null && durationSec != null ? pickupMs + durationSec * 1000 : null;

  const trafficMin = Math.round(trafficDelaySec / 60);
  const severity =
    trafficMin >= 10 ? "high" : trafficMin >= 4 ? "medium" : trafficMin >= 1 ? "low" : "none";
  const trafficCls =
    severity === "high"
      ? "bg-red-500/10 text-red-700"
      : severity === "medium"
        ? "bg-amber-500/10 text-amber-700"
        : severity === "low"
          ? "bg-emerald-500/10 text-emerald-700"
          : "bg-slate-500/10 text-slate-700";
  const trafficLabel =
    severity === "none"
      ? staticDurationSec != null ? "Clear" : "—"
      : `+${trafficMin} min`;

  const distanceLabel =
    distanceM == null
      ? "—"
      : distanceM < 950
        ? `${Math.round(distanceM / 10) * 10} m`
        : `${(distanceM / 1000).toFixed(distanceM < 10_000 ? 1 : 0)} km`;

  const driveLabel =
    durationSec == null
      ? null
      : durationSec < 60
        ? `${Math.max(1, Math.round(durationSec))} s drive`
        : `${Math.round(durationSec / 60)} min drive`;

  return (
    <div className="px-4 pt-3 pb-2">
      <div className="flex items-center justify-between mb-1.5">
        <div className="text-[10px] uppercase tracking-wide text-slate-500 font-semibold">
          Route summary
        </div>
        {driveLabel && (
          <div className="text-[11px] text-slate-600 tabular-nums">{driveLabel}</div>
        )}
      </div>
      <div className="grid grid-cols-4 gap-2 tabular-nums">
        <SummaryTile
          label="Pickup"
          value={pickupMs ? formatMaltaTime(new Date(pickupMs).toISOString()) : "—"}
          hint={pickupMs ? "Scheduled" : "No time set"}
        />
        <SummaryTile
          label="Drop-off"
          value={dropoffMs ? formatMaltaTime(new Date(dropoffMs).toISOString()) : "—"}
          hint={dropoffMs ? "Est. arrival" : "Awaiting route"}
        />
        <SummaryTile label="Distance" value={distanceLabel} hint="Pickup → Drop-off" />
        <SummaryTile
          label="Traffic"
          value={trafficLabel}
          hint={severity === "none" ? "vs typical" : "Extra time"}
          valueClassName={trafficCls + " rounded px-1"}
        />
      </div>
    </div>
  );
}

function SummaryTile({
  label,
  value,
  hint,
  valueClassName,
}: {
  label: string;
  value: string;
  hint?: string;
  valueClassName?: string;
}) {
  return (
    <div className="rounded-md border border-slate-200 bg-white/80 px-2 py-1.5 min-w-0">
      <div className="text-[9px] uppercase tracking-wide text-slate-500 font-semibold">
        {label}
      </div>
      <div
        className={`text-sm font-semibold text-slate-900 leading-tight truncate ${valueClassName ?? ""}`}
      >
        {value}
      </div>
      {hint && <div className="text-[10px] text-slate-500 truncate">{hint}</div>}
    </div>
  );
}
