import { useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  getDriverManifest, driverAcceptJob, driverRejectJob, driverApproveDeletion,
  updateJobStatus, listJobPaxDriver, markPaxOnboard, markPaxNoShow, markPaxPending,
  driverReportLate,
  updateDriverProfile, setJobPaymentStatus, hideJobForDriver, unhideJobForDriver, getDriverStatement,
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

import { DriverLiveShare } from "@/components/driver/DriverLiveShare";
import { TripSummaryDialog } from "@/components/driver/TripSummaryDialog";
import { TripChatDialog } from "@/components/trip/TripChatDialog";
import { TripProgress } from "@/components/coordinator/TripProgress";

import {
  CheckCircle2, Clock, Download, X, FileText, MessageCircle, MoreVertical,
  Plane, MapPin, Car, Users, Navigation, QrCode, AlertTriangle, User, ThumbsDown,
  Timer, UserX,
} from "lucide-react";



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
type Job = {
  id: string; from_location: string; to_location: string;
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
  seats_available: number | null;
  availability_note: string | null;
  profile_updated_at: string | null;
};

const STATUS_FLOW: Array<{ value: string; label: string }> = [
  { value: "en_route", label: "On the way to pickup" },
  { value: "arrived", label: "Arrived at pickup" },
  { value: "in_progress", label: "Passengers on board — en route" },
  { value: "completed", label: "Trip finished" },
];

function DriverManifest() {
  const { token } = Route.useParams();
  const fn = useServerFn(getDriverManifest);
  const { data, isLoading } = useQuery({
    queryKey: ["driver-manifest", token],
    queryFn: () => fn({ data: { token } }) as Promise<{ link: { subject_label: string | null }; jobs: Job[]; driver: Driver | null } | null>,
    refetchInterval: 20_000,
  });
  const [openJob, setOpenJob] = useState<Job | null>(null);
  const [profileOpen, setProfileOpen] = useState(false);
  const [statementOpen, setStatementOpen] = useState(false);
  const [chatJob, setChatJob] = useState<Job | null>(null);

  useEffect(() => {
    if (data?.driver && !data.driver.profile_updated_at) setProfileOpen(true);
  }, [data?.driver]);

  const [showArchived, setShowArchived] = useState(false);
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

  const driver = data.driver;
  return (
    <div className="min-h-screen bg-gradient-to-b from-primary/5 via-background to-background">
      <header className="sticky top-0 z-20 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/70 px-4 py-3">
        <div className="max-w-3xl mx-auto flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[10px] text-primary font-semibold uppercase tracking-widest">Driver Manifest</div>
            <h1 className="text-lg font-bold truncate">{driver?.name ?? data.link.subject_label ?? "Driver"}</h1>
            {driver && (
              <div className="text-[11px] text-muted-foreground truncate">
                {driver.seats_available != null ? `${driver.seats_available} seats · ` : ""}
                {driver.availability_note ?? "No availability set"}
              </div>
            )}
          </div>
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
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      <main className="max-w-3xl mx-auto p-3 space-y-3 pb-24">
        <DriverLiveShare
          token={token}
          hasActiveTrip={jobs.some((j) => ["en_route", "arrived", "in_progress"].includes(j.status ?? ""))}
        />
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
          <JobCard key={j.id} job={j} token={token} onOpen={() => setOpenJob(j)} onChat={() => setChatJob(j)} />
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
                  <JobCard key={j.id} job={j} token={token} onOpen={() => setOpenJob(j)} onChat={() => setChatJob(j)} />
                ))}
              </div>
            )}
          </div>
        )}
      </main>

      <TripExecutionDialog job={openJob} token={token} onOpenChange={(v) => !v && setOpenJob(null)} />
      <ProfileDialog open={profileOpen} onOpenChange={setProfileOpen} token={token} driver={driver} />
      <StatementDialog open={statementOpen} onOpenChange={setStatementOpen} token={token} driverName={driver?.name ?? "driver"} />
      <TripChatDialog
        open={!!chatJob} onOpenChange={(v) => !v && setChatJob(null)}
        jobId={chatJob?.id ?? null}
        title={chatJob ? `${chatJob.from_location} → ${chatJob.to_location}` : ""}
        role="driver" token={token}
      />
    </div>
  );
}

function JobCard({ job, token, onOpen, onChat }: { job: Job; token: string; onOpen: () => void; onChat: () => void }) {
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
  const [confirmDelOpen, setConfirmDelOpen] = useState(false);
  const [confirmHideOpen, setConfirmHideOpen] = useState(false);
  const [lateOpen, setLateOpen] = useState(false);
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [lateMinutes, setLateMinutes] = useState<number>(10);
  const [lateNote, setLateNote] = useState("");
  const lateFn = useServerFn(driverReportLate);

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
    onError: (e: Error) => toast.error(e.message),
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
  const problem = job.flight_status === "delayed" || job.flight_status === "cancelled" || !!job.deletion_requested_at;
  const pax = job.pax ?? [];
  const paxCount = pax.length;
  const onboardCount = pax.filter((p) => p.status === "onboard").length;

  const borderClass = problem
    ? "border-destructive/60 ring-1 ring-destructive/40"
    : accepted
    ? "border-emerald-500/60 ring-1 ring-emerald-500/30"
    : "border-border";

  const dateLabel = job.pickup_at
    ? new Date(job.pickup_at).toLocaleString([], { weekday: "short", day: "2-digit", month: "short" })
    : job.date;
  const timeLabel = job.pickup_at
    ? new Date(job.pickup_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
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
    <article className={`rounded-2xl border-2 bg-card shadow-sm overflow-hidden transition ${borderClass}`}>
      {stripeStyle && <div aria-hidden className="h-1.5 w-full" style={stripeStyle} />}
      {/* Header strip */}
      <div className={`px-4 py-2.5 flex items-center justify-between gap-2 ${problem ? "bg-destructive/10" : accepted ? "bg-emerald-500/10" : "bg-muted/50"}`}>
        <div className="flex items-center gap-2 min-w-0">
          <div className="rounded-lg bg-background/80 px-2 py-1 text-sm font-mono font-bold tracking-tight">{timeLabel}</div>
          <div className="text-xs font-medium text-muted-foreground truncate">{dateLabel}</div>
        </div>
        <div className="flex items-center gap-1">
          {job.deletion_requested_at && (
            <Badge variant="destructive" className="text-[10px] gap-1"><AlertTriangle className="h-3 w-3" /> Delete requested</Badge>
          )}
          {accepted && !job.deletion_requested_at && (
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
              <div className="text-base font-bold leading-tight break-words">{job.from_location}</div>
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
              <div className="text-base font-bold leading-tight break-words">{job.to_location}</div>
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
          <Badge variant="outline" className="text-[10px] gap-1"><Users className="h-3 w-3" />{paxCount} pax{accepted && onboardCount > 0 ? ` · ${onboardCount} onboard` : ""}</Badge>
          
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
        {paxCount > 0 && (
          <div className="mt-3 rounded-lg bg-muted/40 border p-2.5">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1.5 flex items-center justify-between">
              <span className="inline-flex items-center gap-1"><Users className="h-3 w-3" /> Passengers ({paxCount})</span>
              <span className={onboardCount === paxCount ? "text-emerald-600 font-semibold" : ""}>
                {onboardCount}/{paxCount} onboard
              </span>
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
                </li>
              ))}
            </ul>
            {onboardCount === paxCount && paxCount > 0 && (
              <div className="mt-2 rounded-md bg-emerald-500/15 border border-emerald-500/40 text-emerald-700 dark:text-emerald-400 text-xs font-medium px-2.5 py-1.5 flex items-center gap-1.5">
                <CheckCircle2 className="h-3.5 w-3.5" /> All passengers found — ready to go
              </div>
            )}
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="p-3 pt-3 grid grid-cols-2 gap-2">
        {!accepted && !job.deletion_requested_at && (
          <>
            <Button className="col-span-2 h-12 text-base" disabled={acceptMut.isPending} onClick={() => acceptMut.mutate()}>
              {acceptMut.isPending ? "Accepting…" : "Accept trip"}
            </Button>
            <Button variant="outline" className="col-span-2 h-10 text-destructive border-destructive/40 hover:bg-destructive/10"
              onClick={() => setRejectOpen(true)}>
              <ThumbsDown className="h-4 w-4 mr-1.5" /> Can't make it — Reject
            </Button>
          </>
        )}
        {accepted && !job.deletion_requested_at && (
          <>
            <Button className="col-span-2 h-11" onClick={onOpen}>
              <QrCode className="h-4 w-4 mr-1.5" /> Open trip · Board passengers
            </Button>
            {nextStatus && (
              <Button variant="secondary" className="h-10" disabled={statusMut.isPending}
                onClick={() => statusMut.mutate(nextStatus.value)}>
                {nextStatus.label}
              </Button>
            )}
            {job.status !== "completed" && (
              <Button variant="outline" className="h-10"
                onClick={() => setLateOpen(true)}>
                <Timer className="h-4 w-4 mr-1.5" /> Running late
              </Button>
            )}
            {job.status !== "in_progress" && job.status !== "completed" && (
              <Button variant="outline" className="col-span-2 h-10 text-destructive border-destructive/40 hover:bg-destructive/10"
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
        {job.deletion_requested_at && (
          <Button variant="destructive" className="col-span-2 h-10" disabled={approveDelMut.isPending}
            onClick={() => setConfirmDelOpen(true)}>
            {approveDelMut.isPending ? "Approving…" : "Approve deletion"}
          </Button>
        )}

        <div className="col-span-2 flex items-center gap-2 pt-1">
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
      </div>

      <Dialog open={rejectOpen} onOpenChange={(v) => { setRejectOpen(v); if (!v) setRejectReason(""); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject this trip?</DialogTitle>
            <DialogDescription>
              The trip returns to your coordinator's Unassigned list and they'll get a message with your reason.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label>Reason (optional but recommended)</Label>
            <Textarea rows={3} value={rejectReason} onChange={(e) => setRejectReason(e.target.value)}
              placeholder="e.g. Vehicle breakdown, already assigned another trip, ran late…" />
            <div className="flex flex-wrap gap-1.5 pt-1">
              {["Vehicle issue","Double-booked","Personal emergency","Too far","Running late"].map((r) => (
                <button key={r} type="button"
                  className="text-[11px] rounded-full border px-2 py-0.5 hover:bg-muted"
                  onClick={() => setRejectReason(r)}>{r}</button>
              ))}
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRejectOpen(false)}>Cancel</Button>
            <Button variant="destructive" disabled={rejectMut.isPending}
              onClick={() => rejectMut.mutate(rejectReason)}>
              {rejectMut.isPending ? "Sending…" : "Reject trip"}
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

    </article>
  );
}


function ProfileDialog({ open, onOpenChange, token, driver }: {
  open: boolean; onOpenChange: (v: boolean) => void; token: string; driver: Driver | null;
}) {
  const [name, setName] = useState(driver?.name ?? "");
  const [seats, setSeats] = useState<string>(driver?.seats_available != null ? String(driver.seats_available) : "");
  const [note, setNote] = useState(driver?.availability_note ?? "");
  useEffect(() => {
    setName(driver?.name ?? "");
    setSeats(driver?.seats_available != null ? String(driver.seats_available) : "");
    setNote(driver?.availability_note ?? "");
  }, [driver, open]);

  const qc = useQueryClient();
  const fn = useServerFn(updateDriverProfile);
  const mut = useMutation({
    mutationFn: () => fn({ data: {
      token,
      name: name.trim() || undefined,
      seats_available: seats.trim() === "" ? null : Number(seats),
      availability_note: note.trim() === "" ? null : note.trim(),
    }}),
    onSuccess: () => { toast.success("Saved"); onOpenChange(false); qc.invalidateQueries({ queryKey: ["driver-manifest", token] }); },
    onError: (e: Error) => toast.error(e.message === "driver_link_required" ? "Ask your coordinator for a personal link." : e.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Your profile</DialogTitle>
          <DialogDescription>Coordinators see this on their dispatch board.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5"><Label>Name</Label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
          <div className="space-y-1.5">
            <Label>Seats available</Label>
            <Input type="number" min={0} value={seats} onChange={(e) => setSeats(e.target.value)} placeholder="e.g. 4" />
          </div>
          <div className="space-y-1.5">
            <Label>Availability</Label>
            <Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. Mon–Fri 06:00–18:00. Off Sundays." />
          </div>
        </div>
        <DialogFooter>
          <Button disabled={mut.isPending} onClick={() => mut.mutate()}>{mut.isPending ? "Saving…" : "Save"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function StatementDialog({ open, onOpenChange, token, driverName }: {
  open: boolean; onOpenChange: (v: boolean) => void; token: string; driverName: string;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const monthAgo = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
  const [from, setFrom] = useState(monthAgo);
  const [to, setTo] = useState(today);
  const [payment, setPayment] = useState<"all" | "paid" | "pending">("all");
  const fn = useServerFn(getDriverStatement);
  const mut = useMutation({
    mutationFn: () => fn({ data: { token, from, to, payment } }),
    onSuccess: (rows) => {
      const list = rows as Array<Record<string, unknown>>;
      if (list.length === 0) { toast.info("No trips in this range"); return; }
      const headers = ["date","time","from","to","client","vehicle","status","payment"];
      const csv = [headers.join(",")].concat(list.map((r) => [
        r.date, (r.time as string || "").slice(0,5),
        csvCell(r.from_location), csvCell(r.to_location),
        csvCell(r.clientcompanyname), csvCell(r.vehicle),
        r.status, r.payment_status,
      ].join(","))).join("\n");
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `statement-${driverName.replace(/\s+/g, "_")}-${from}_${to}.csv`;
      a.click();
      URL.revokeObjectURL(a.href);
      toast.success(`${list.length} trip(s) exported`);
    },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Download statement</DialogTitle>
          <DialogDescription>Export a CSV of your trips.</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5"><Label>From</Label><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
          <div className="space-y-1.5"><Label>To</Label><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
          <div className="col-span-2 space-y-1.5">
            <Label>Payment</Label>
            <div className="flex gap-2">
              {(["all","paid","pending"] as const).map((k) => (
                <Button key={k} type="button" size="sm"
                  variant={payment === k ? "default" : "outline"}
                  onClick={() => setPayment(k)}>{k}</Button>
              ))}
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button disabled={mut.isPending} onClick={() => mut.mutate()}>
            <Download className="h-4 w-4 mr-1" /> {mut.isPending ? "Preparing…" : "Download CSV"}
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

function TripExecutionDialog({ job, token, onOpenChange }: { job: Job | null; token: string; onOpenChange: (v: boolean) => void }) {
  // (QR scanning removed — manual confirm / no-show is used everywhere now.)
  const qc = useQueryClient();
  const listFn = useServerFn(listJobPaxDriver);
  const markFn = useServerFn(markPaxOnboard);
  const noShowFn = useServerFn(markPaxNoShow);
  const undoFn = useServerFn(markPaxPending);

  const { data: pax, refetch } = useQuery({
    queryKey: ["driver-pax", job?.id],
    queryFn: () => listFn({ data: { token, job_id: job!.id } }) as Promise<Array<{ id: string; name: string; status: string }>>,
    enabled: !!job,
  });

  const invalidateManifest = () => qc.invalidateQueries({ queryKey: ["driver-manifest", token] });
  const markMut = useMutation({
    mutationFn: (v: { pax_id: string; method: "qr" | "manual" }) =>
      markFn({ data: { token, job_id: job!.id, pax_id: v.pax_id, method: v.method } }),
    onSuccess: () => { toast.success("Passenger onboard"); refetch(); invalidateManifest(); },
    onError: (e: Error) => toast.error(e.message === "qr_required" ? "QR scan required for this trip" : e.message),
  });
  const noShowMut = useMutation({
    mutationFn: (pax_id: string) => noShowFn({ data: { token, job_id: job!.id, pax_id } }),
    onSuccess: () => { toast.success("Marked as no-show"); refetch(); invalidateManifest(); },
    onError: (e: Error) => toast.error(e.message),
  });
  const undoMut = useMutation({
    mutationFn: (pax_id: string) => undoFn({ data: { token, job_id: job!.id, pax_id } }),
    onSuccess: () => { toast.success("Reset to pending"); refetch(); invalidateManifest(); },
    onError: (e: Error) => toast.error(e.message),
  });

  // handleScan retained for future re-enable; currently unused.


  return (
    <Dialog open={!!job} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{job?.from_location} → {job?.to_location}</DialogTitle>
          <DialogDescription>
            Tap "Confirm" for boarding passengers, or "No-show" if someone doesn't turn up.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2 max-h-72 overflow-auto">
          {(pax ?? []).length === 0 && <p className="text-sm text-muted-foreground text-center py-6">No passengers on this trip.</p>}
          {(pax ?? []).map((p) => {
            const isOnboard = p.status === "onboard";
            const isNoShow = p.status === "noshow";
            return (
              <div key={p.id} className={`flex items-center justify-between border rounded-md p-2.5 gap-2 ${isNoShow ? "border-destructive/50 bg-destructive/5" : ""}`}>
                <div className="min-w-0">
                  <div className="font-medium truncate">{p.name}</div>
                  <div className={`text-xs capitalize ${isNoShow ? "text-destructive font-medium" : "text-muted-foreground"}`}>{isNoShow ? "No-show" : p.status}</div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  {isOnboard && <Badge className="bg-emerald-600 hover:bg-emerald-600">Onboard</Badge>}
                  {isNoShow && <Badge variant="destructive" className="gap-1"><UserX className="h-3 w-3" /> No-show</Badge>}
                  {!isOnboard && !isNoShow && (
                    <>
                      <Button size="sm" variant="secondary" disabled={markMut.isPending}
                        onClick={() => markMut.mutate({ pax_id: p.id, method: "manual" })}>
                        Confirm
                      </Button>
                      <Button size="sm" variant="outline" className="text-destructive border-destructive/40 hover:bg-destructive/10"
                        disabled={noShowMut.isPending}
                        onClick={() => noShowMut.mutate(p.id)}>
                        <UserX className="h-4 w-4 mr-1" /> No-show
                      </Button>
                    </>
                  )}
                  {(isOnboard || isNoShow) && (
                    <Button size="sm" variant="ghost" className="text-muted-foreground"
                      disabled={undoMut.isPending}
                      onClick={() => undoMut.mutate(p.id)}>
                      Undo
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
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
