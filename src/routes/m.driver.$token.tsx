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
  updateDriverProfile, setJobPaymentStatus, hideJobForDriver, unhideJobForDriver, getDriverStatement,
  getClientLiveLocationDriver,
} from "@/lib/coordinator-public.functions";


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
import { EmergencyOverrideDialog } from "@/components/driver/EmergencyOverrideDialog";
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
  if (msg === "arrival_no_gps") {
    return "No recent GPS location found. Make sure location sharing is active and try again.";
  }
  if (msg.startsWith("arrival_weak_gps:")) {
    const parts = msg.split(":");
    const accuracyStr = parts[1];
    const radiusStr   = parts[2];
    return `GPS accuracy is too weak (±${accuracyStr}m, need ±${radiusStr}m). Wait for a better signal and try again.`;
  }
  if (msg.startsWith("arrival_outside_radius:")) {
    const parts = msg.split(":");
    const distStr   = parts[1];
    const radiusStr = parts[2];
    return `You're ${distStr}m from the pickup (${radiusStr}m required). Move closer and try again.`;
  }
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
    return {
      activeJobs: sorted.filter((j) => !j.driver_hidden_at),
      archivedJobs: sorted.filter((j) => !!j.driver_hidden_at),
    };
  }, [data]);
  const jobs = activeJobs;
  // Auto-reveal archived when there are none active but archived exist.
  useEffect(() => {
    if (jobs.length === 0 && archivedJobs.length > 0) setShowArchived(true);
  }, [jobs.length, archivedJobs.length]);


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
  const { isSafetyMode, speedKmh } = useSafetyMode({
    speedMps: currentSpeedMps,
    thresholdKmh: safetyThresholdKmh,
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
      const isReassign = !newJobs.some((nj) => nj.id === j.id);
      const text = isReassign
        ? `Trip reassigned to you: ${j.from_location} to ${j.to_location}${pickupLabel}. Please accept or decline.`
        : `New trip assigned: ${j.from_location} to ${j.to_location}${pickupLabel}. Please accept or decline.`;
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
      const text = `New message on trip to ${bumpedJob.to_location}`;
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
      const dest = activeJob.status === "in_progress" ? activeJob.to_location : activeJob.from_location;
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
      {!navigateMode && isSafetyMode && <SafetyModeOverlay speedKmh={speedKmh} />}
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
            <JobCard key={j.id} job={j} token={token} driverPos={driverPos} isSafetyMode={isSafetyMode} onOpen={() => setOpenJob(j)} onChat={() => setChatJob(j)} />
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
                    <JobCard key={j.id} job={j} token={token} driverPos={driverPos} isSafetyMode={isSafetyMode} onOpen={() => setOpenJob(j)} onChat={() => setChatJob(j)} />
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
      <BrandingBar branding={data.branding} />
    </div>
  );
}

function JobCard({ job, token, driverPos, isSafetyMode, onOpen, onChat }: { job: Job; token: string; driverPos: { lat: number; lng: number } | null; isSafetyMode: boolean; onOpen: () => void; onChat: () => void }) {
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
  const [emergencyOpen, setEmergencyOpen] = useState(false);
  const [lateMinutes, setLateMinutes] = useState<number>(10);
  const [lateNote, setLateNote] = useState("");
  const lateFn = useServerFn(driverReportLate);
  const clientLiveFn = useServerFn(getClientLiveLocationDriver);

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

  // --- Pre-acceptance route preview (driver → pickup) ---
  const isPending = !job.driver_accepted_at && !job.deletion_requested_at;
  const previewEnabled = !!isPending && !!driverPos && !!job.from_location;
  const routeFn = useServerFn(computeDriverRoute);
  const previewOriginKey = driverPos ? `${driverPos.lat.toFixed(3)},${driverPos.lng.toFixed(3)}` : null;
  const { data: previewData } = useQuery({
    queryKey: ["driver-preview-route", job.id, job.from_location, previewOriginKey],
    enabled: previewEnabled,
    refetchInterval: 60_000,
    staleTime: 45_000,
    queryFn: () => routeFn({
      data: {
        origin: { latitude: driverPos!.lat, longitude: driverPos!.lng },
        destination_address: job.from_location,
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
  const previewLive: LiveRouteInfo = {
    polyline: previewPrimary?.polyline ?? null,
    eta_sec: previewPrimary?.duration_sec ?? null,
    distance_m: previewPrimary?.distance_m ?? null,
    next_instruction: previewPrimary?.next_instruction ?? null,
    next_maneuver: previewPrimary?.next_maneuver ?? null,
    next_step_distance_m: previewPrimary?.next_step_distance_m ?? null,
    delay_sec: 0,
    reroute_available: false,
    reroute_saving_sec: 0,
    onAcceptReroute: () => { /* no-op in preview */ },
    isLoading: false,
    steps: previewPrimary?.steps ?? [],
  };
  const [previewOpen, setPreviewOpen] = useState(false);



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
  const statusMut = useMutation({
    mutationFn: (status: string) => statusFn({ data: { token, job_id: job.id, status: status as never } }),
    onSuccess: () => { toast.success("Status updated"); invalidate(); },
    onError: (e: Error) => toast.error(formatDriverStatusError(e)),
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
  const accepted = !!job.driver_accepted_at;
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
      <div className={`px-4 py-2.5 flex items-center justify-between gap-2 ${problem ? "bg-destructive/10" : accepted ? "bg-emerald-500/10" : "bg-muted/50"}`}>
        <div className="flex items-center gap-2 min-w-0">
          <div className="rounded-lg bg-background/80 px-2 py-1 text-sm font-mono font-bold tracking-tight">{timeLabel}</div>
          <div className="text-xs font-medium text-muted-foreground truncate">{dateLabel}</div>
        </div>
        <div className="flex items-center gap-1">
          {job.status === "in_progress" && (
            <Badge className="bg-emerald-600 hover:bg-emerald-600 text-[10px] gap-1 animate-pulse">
              <span className="h-1.5 w-1.5 rounded-full bg-white" /> In progress
            </Badge>
          )}
          {job.deletion_requested_at && (
            <Badge variant="destructive" className="text-[10px] gap-1"><AlertTriangle className="h-3 w-3" /> Delete requested</Badge>
          )}
          {accepted && !job.deletion_requested_at && job.status !== "in_progress" && (
            <Badge className="bg-emerald-600 hover:bg-emerald-600 text-[10px] gap-1"><CheckCircle2 className="h-3 w-3" /> Accepted</Badge>
          )}
          {!accepted && !job.deletion_requested_at && (
            <Badge variant="outline" className="text-[10px] gap-1"><Clock className="h-3 w-3" /> Awaiting you</Badge>
          )}
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
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Pickup</div>
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
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Drop-off</div>
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
          {job.status && job.status !== "pending" && (
            <Badge variant="outline" className="text-[10px] capitalize">{job.status.replace("_", " ")}</Badge>
          )}
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
            <ul className="space-y-0.5">
              {pax.map((p) => (
                <li key={p.id} className="text-sm flex items-center justify-between gap-2">
                  <span className="truncate">{p.name}</span>
                  {p.status === "onboard" && (
                    <span className="text-[10px] text-emerald-600 font-medium inline-flex items-center gap-1">
                      <CheckCircle2 className="h-3 w-3" /> Onboard
                    </span>
                  )}
                  {p.status === "noshow" && (
                    <span className="text-[10px] text-rose-600 font-medium inline-flex items-center gap-1">
                      <UserX className="h-3 w-3" /> No-show
                    </span>
                  )}
                  {p.status === "cancelled" && (
                    <span className="text-[10px] text-slate-700 font-medium inline-flex items-center gap-1">
                      <X className="h-3 w-3" /> Cancelled
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

      {/* Actions */}
      <div className="grid grid-cols-1 gap-2 p-3 pt-3 sm:grid-cols-2">

        {!accepted && !job.deletion_requested_at && (
          <>
            {/* Route preview strip */}
            {previewEnabled && (
              <div className="rounded-xl border-2 border-primary/30 bg-primary/5 p-3 flex items-center gap-3 sm:col-span-2">
                <div className="h-10 w-10 grid place-items-center rounded-full bg-primary/15 text-primary shrink-0">
                  <Navigation className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium">To pickup</div>
                  {previewPrimary ? (
                    <div className="text-sm font-bold tabular-nums text-slate-900 leading-tight">
                      {(() => {
                        const s = previewPrimary.duration_sec;
                        if (s == null) return "—";
                        const m = Math.max(1, Math.round(s / 60));
                        return m < 60 ? `${m} min` : `${Math.floor(m / 60)}h ${m % 60}m`;
                      })()}
                      <span className="text-muted-foreground font-medium ml-2">
                        {previewPrimary.distance_m != null
                          ? (previewPrimary.distance_m < 950
                              ? `${Math.round(previewPrimary.distance_m / 10) * 10} m`
                              : `${(previewPrimary.distance_m / 1000).toFixed(previewPrimary.distance_m < 10_000 ? 1 : 0)} km`)
                          : ""}
                      </span>
                    </div>
                  ) : (
                    <div className="text-sm text-muted-foreground">Calculating route…</div>
                  )}
                </div>
                <Button size="sm" variant="secondary" className="shrink-0" onClick={() => setPreviewOpen(true)}>
                  Preview route
                </Button>
              </div>
            )}
            {!previewEnabled && isPending && !driverPos && (
              <div className="rounded-xl border border-dashed border-muted-foreground/30 p-3 text-xs text-muted-foreground text-center sm:col-span-2">
                Enable location to preview the route to pickup
              </div>
            )}
            <Button className="h-12 text-base sm:col-span-2" disabled={acceptMut.isPending} onClick={() => acceptMut.mutate()}>
              {acceptMut.isPending ? "Accepting…" : "Accept trip"}
            </Button>
            <Button variant="outline" className="h-10 text-destructive border-destructive/40 hover:bg-destructive/10 sm:col-span-2"
              onClick={() => setRejectOpen(true)}>
              <ThumbsDown className="h-4 w-4 mr-1.5" /> Can't make it — Reject
            </Button>
          </>
        )}

        {accepted && !job.deletion_requested_at && (
          <>
            <Button className="h-11 sm:col-span-2" onClick={onOpen}>
              <QrCode className="h-4 w-4 mr-1.5" /> Open trip · Board passengers
            </Button>
            {job.status !== "completed" && job.status !== "cancelled" && (
              <Button
                variant="destructive"
                className={isSafetyMode ? "h-16 text-base font-bold sm:col-span-2" : "h-10 sm:col-span-2"}
                onClick={() => setEmergencyOpen(true)}
              >
                <AlertTriangle className="h-4 w-4 mr-1.5" /> Emergency Override
              </Button>
            )}
            {nextStatus && (
              <Button variant="secondary" className={isSafetyMode ? "h-16 text-lg font-bold" : "h-10"} disabled={statusMut.isPending}
                onClick={() => {
                  if (nextStatus.value === "completed") setSummaryOpen(true);
                  else if (shouldHandleBoardingInDialog(job.status, nextStatus.value, jobPaxSummary.pending)) onOpen();
                  else statusMut.mutate(nextStatus.value);
                }}>
                {nextStatus.label}
              </Button>
            )}

            {!isSafetyMode && job.status !== "completed" && (
              <Button variant="outline" className="h-10"
                onClick={() => setLateOpen(true)}>
                <Timer className="h-4 w-4 mr-1.5" /> Running late
              </Button>
            )}
            {!isSafetyMode && canReturnToWaiting && (
              <Button
                variant="outline"
                className="h-10 sm:col-span-2"
                disabled={statusMut.isPending}
                onClick={() => statusMut.mutate("pending")}
              >
                <ArrowLeft className="h-4 w-4 mr-1.5" /> Back to waiting
              </Button>
            )}
            {!isSafetyMode && job.status !== "in_progress" && job.status !== "completed" && (
              <Button variant="outline" className="h-10 text-destructive border-destructive/40 hover:bg-destructive/10 sm:col-span-2"
                onClick={() => setRejectOpen(true)}>
                <ThumbsDown className="h-4 w-4 mr-1.5" /> Can't make it — Give back
              </Button>
            )}
          </>
        )}


        <Button variant="outline" className="h-10" asChild>
          <a href={mapsUrl} target="_blank" rel="noreferrer">
            <Navigation className="h-4 w-4 mr-1.5" /> Navigate
          </a>
        </Button>
        <Button variant="outline" className="h-10 relative" onClick={onChat}>
          <MessageCircle className="h-4 w-4 mr-1.5" /> Chat coordinator
          {(job.unread_messages ?? 0) > 0 && (
            <span className="absolute -top-1 -right-1 rounded-full bg-destructive text-destructive-foreground text-[10px] h-5 min-w-5 px-1 grid place-items-center font-semibold">
              {job.unread_messages}
            </span>
          )}
        </Button>
        <Button variant="outline" className="h-10 sm:col-span-2" asChild>
          <Link to="/m/driver/$token/sign/$jobId" params={{ token, jobId: job.id }}>
            <Megaphone className="h-4 w-4 mr-1.5" /> Open Sign Board
          </Link>
        </Button>
        {job.deletion_requested_at && (
          <Button variant="destructive" className="h-10 sm:col-span-2" disabled={approveDelMut.isPending}
            onClick={() => setConfirmDelOpen(true)}>
            {approveDelMut.isPending ? "Approving…" : "Approve deletion"}
          </Button>
        )}

        {!isSafetyMode && (
          <div className="flex items-center gap-2 pt-1 sm:col-span-2">
            <Button variant={paid ? "outline" : "secondary"} size="sm" className="flex-1" disabled={payMut.isPending}
              onClick={() => payMut.mutate(paid ? "pending" : "paid")}>
              {paid ? "Mark pending" : "Mark paid"}
            </Button>
            {job.driver_hidden_at ? (
              <Button variant="ghost" size="sm" disabled={unhideMut.isPending}
                onClick={() => unhideMut.mutate()}>
                Restore
              </Button>
            ) : (
              <Button variant="ghost" size="sm" className="text-muted-foreground" disabled={hideMut.isPending}
                onClick={() => setConfirmHideOpen(true)}>
                <X className="h-4 w-4 mr-1" /> Hide
              </Button>
            )}
          </div>
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

      <EmergencyOverrideDialog
        open={emergencyOpen}
        onOpenChange={setEmergencyOpen}
        token={token}
        job={{ id: job.id, status: job.status }}
      />

      {previewOpen && (
        <NavigateFullscreen
          mode="preview"
          live={previewLive}
          destination={job.from_location}
          title={displayLocation(job.from_location, job.pickup_display_name)}
          externalNavUrl={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(job.from_location)}&travelmode=driving`}
          onExit={() => setPreviewOpen(false)}
          onSpeak={null}
          isSpeaking={false}
          footerSlot={
            <div className="flex gap-2 px-4 py-3 border-t border-white/40" style={{ background: "rgba(255,255,255,0.95)" }}>
              <Button variant="outline" className="flex-1 h-12 text-destructive border-destructive/40 hover:bg-destructive/10"
                onClick={() => { setPreviewOpen(false); setRejectOpen(true); }}>
                <ThumbsDown className="h-4 w-4 mr-1.5" /> Decline
              </Button>
              <Button className="flex-1 h-12 text-base" disabled={acceptMut.isPending}
                onClick={() => { acceptMut.mutate(); setPreviewOpen(false); }}>
                {acceptMut.isPending ? "Accepting…" : "Accept trip"}
              </Button>
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
};


/**
 * Polls the Routes API server-side every 30s while a driver has an active
 * leg. Detects heavy traffic (primary duration >> staticDuration) and
 * surfaces a faster alternative route the driver can accept in one tap.
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
  const [acceptedAltIdx, setAcceptedAltIdx] = useState<number | null>(null);

  // Finer origin key (~11m) so route refetches as the driver actually moves.
  const originKey = origin ? `${origin.lat.toFixed(4)},${origin.lng.toFixed(4)}` : null;


  const { data, isLoading } = useQuery({
    queryKey: ["driver-live-route", destination, originKey],
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

  // Reset accepted alternative when the destination changes.
  useEffect(() => { setAcceptedAltIdx(null); }, [destination]);

  const primary = data?.primary ?? null;
  const alternatives = data?.alternatives ?? [];
  const active = acceptedAltIdx != null ? alternatives[acceptedAltIdx] ?? primary : primary;

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
function NextInstructionCard({ job, token, onOpenSummary, live, canEnterNavigate, onEnterNavigate, canReturnToWaiting }: {
  job: Job; token: string; onOpenSummary: () => void; live: LiveRouteInfo;
  canEnterNavigate?: boolean; onEnterNavigate?: () => void;
  canReturnToWaiting?: boolean;
}) {
  const qc = useQueryClient();
  const statusFn = useServerFn(updateJobStatus);
  const jobPaxSummary = getPaxSummary(job.pax);
  const statusMut = useMutation({
    mutationFn: (status: string) => statusFn({ data: { token, job_id: job.id, status: status as never } }),
    onSuccess: () => { toast.success("Status updated"); qc.invalidateQueries({ queryKey: ["driver-manifest", token] }); },
    onError: (e: Error) => toast.error(formatDriverStatusError(e)),
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

      {showLive && routeHint && (
        <div className="px-5 pt-4">
          <div className="rounded-2xl border border-primary/15 bg-primary/5 px-4 py-3">
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
                <div className="mt-1 text-xs leading-relaxed text-muted-foreground">{routeHint}</div>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="px-5 pt-4 pb-3">
        <div className="text-[11px] font-bold uppercase tracking-[0.2em] text-primary">
          {job.status === "in_progress" ? "In progress" : job.status === "arrived" ? "At pickup" : "Next up"}
        </div>
        <h2 className="mt-1 text-xl sm:text-3xl font-black leading-tight tracking-tight text-slate-900 dark:text-white break-words">
          {headline}
        </h2>

        {/* Live ETA + remaining distance */}
        {showLive && (live.eta_sec != null || live.distance_m != null) && (
          <div className="mt-3 grid grid-cols-2 gap-2">
            <div className="rounded-xl bg-white/70 dark:bg-white/10 border border-white/60 px-3 py-2">
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground">ETA</div>
              <div className="text-xl sm:text-2xl font-black tabular-nums leading-none mt-0.5">
                {formatEtaMin(live.eta_sec)}
              </div>
              {live.delay_sec >= 120 && (
                <div className="text-[11px] font-semibold text-amber-700 mt-0.5">
                  +{formatEtaMin(live.delay_sec)} in traffic
                </div>
              )}
            </div>
            <div className="rounded-xl bg-white/70 dark:bg-white/10 border border-white/60 px-3 py-2">
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Remaining</div>
              <div className="text-xl sm:text-2xl font-black tabular-nums leading-none mt-0.5">
                {formatDistance(live.distance_m)}
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
  { key: "payment_status", label: "Payment", group: "Trip" },
  { key: "payment_method", label: "Payment method", group: "Trip" },
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
  "date","time","from_location","to_location","flight","clientcompanyname",
  "pax_names","pax_count","status","payment_status","price_display",
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
              {["Trip","Route","People","Ops"].map((g) => (
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
