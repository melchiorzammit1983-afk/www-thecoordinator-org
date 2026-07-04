import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { formatMaltaTime } from "@/lib/time";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { TripProgress, TRIP_STAGES } from "./TripProgress";
import { ChainTimeline } from "./ChainTimeline";
import { LabelChip, type Label as TLabel } from "./LabelChip";
import { DriverLiveMap, type LivePoint } from "./DriverLiveMap";
import { PriceProposalsPanel } from "./PriceProposalsPanel";
import { listActiveDriverLocations, getMaltaFlightStatus, normalizeJobData, listPaxActivityCoord, listSosForJob, acknowledgeSosCoord, acknowledgeAllSosForJob, getTripPricing, coordinatorSetTripPrice, rescheduleJobToFlight, getClientTripLink } from "@/lib/coordinator.functions";
import { useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { TripChatDialog } from "@/components/trip/TripChatDialog";
import {
  Pencil, MessagesSquare, MessageCircle, Link2, Users, Plane, QrCode, Navigation2, CircleCheck, CircleAlert, MapPin, RefreshCw, Check, CheckCheck, ShieldAlert, Lock, Wallet, FileText, Receipt,
} from "lucide-react";



type Pax = { id: string; name: string; status?: string | null; boarded_at?: string | null };
type DriverEmbed = { name: string; vehicle?: string | null; phone?: string | null; seats_available?: number | null; availability_note?: string | null };

export type DetailsJob = {
  id: string;
  from_location: string; to_location: string;
  date: string; time: string; pickup_at: string | null;
  status: string;
  vehicle: string | null;
  clientcompanyname: string | null;
  driver_id: string | null;
  driver_accepted_at: string | null;
  deletion_requested_at: string | null;
  payment_status?: string | null;
  tracking_enabled: boolean; qr_strict_mode: boolean;
  from_flight: string | null; to_flight: string | null;
  flight_status: string | null; flight_status_note: string | null;
  flight_status_updated_at?: string | null;
  flight_scheduled_at: string | null; flight_estimated_at: string | null;
  drivers?: DriverEmbed | null;
  pax?: Pax[];
  labels?: TLabel[];
  external?: boolean;
  executor_name?: string | null;
  external_driver_name?: string | null;
  promo_note?: string | null;
};

export function TripDetailsSheet({
  job,
  open,
  onOpenChange,
  onEdit,
  onChat,
  onShare,
  onCopyLink,
  onPax,
  driverName,
}: {
  job: DetailsJob | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onEdit: () => void;
  onChat: () => void;
  onShare: () => void;
  onCopyLink: () => void;
  onPax: () => void;
  driverName?: string | null;
}) {
  if (!job) return null;
  const formatRelTime = (iso: string) => {
    const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
    if (diff < 60) return "now";
    if (diff < 3600) return `${Math.floor(diff / 60)}m`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
    return `${Math.floor(diff / 86400)}d`;
  };

  const pax = job.pax ?? [];
  const onboard = pax.filter((p) => p.status === "onboard").length;
  const allAboard = pax.length > 0 && onboard === pax.length;
  const stageIdx = TRIP_STAGES.findIndex((s) => s.value === job.status);
  const flightIssue =
    job.flight_status === "delayed" || job.flight_status === "cancelled" || job.flight_status === "time_mismatch";
  const newTime = (() => {
    const iso = job.flight_estimated_at || job.flight_scheduled_at;
    if (!iso) return "";
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? "" : d.toISOString().slice(11, 16);
  })();
  const flightCode = job.from_flight || job.to_flight;
  const shownDriver = driverName ?? job.drivers?.name ?? job.external_driver_name ?? null;
  const paid = job.payment_status === "paid";

  const qc = useQueryClient();
  const refreshFlightFn = useServerFn(getMaltaFlightStatus);
  const normalizeFn = useServerFn(normalizeJobData);
  const paxActivityFn = useServerFn(listPaxActivityCoord);
  const [refreshingFlight, setRefreshingFlight] = useState(false);
  const [paxChat, setPaxChat] = useState<{ paxId: string; name: string; identityId: string | null } | null>(null);
  const [driverChatOpen, setDriverChatOpen] = useState(false);

  const isRealJobId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(job.id);

  const { data: paxActivity } = useQuery({
    queryKey: ["pax-activity", job.id],
    queryFn: () => paxActivityFn({ data: { job_id: job.id } }) as Promise<Record<string, {
      identity_id: string | null;
      last_seen_at: string | null;
      first_seen_at: string | null;
      presence: "online" | "away" | "never";
      last_message: { body: string; created_at: string; sender_kind: string; sender_label: string | null; read_by_coordinator_at: string | null } | null;
      unread_count: number;
    }>>,
    enabled: open && isRealJobId,
    refetchInterval: open && isRealJobId ? 20_000 : false,
  });

  const sosListFn = useServerFn(listSosForJob);
  const ackSosFn = useServerFn(acknowledgeSosCoord);
  const ackAllSosFn = useServerFn(acknowledgeAllSosForJob);
  const { data: sosRows } = useQuery({
    queryKey: ["job-sos", job.id],
    queryFn: () => sosListFn({ data: { job_id: job.id, include_ack: false } }) as Promise<Array<{
      id: string; job_id: string; pax_name: string | null;
      latitude: number | null; longitude: number | null; note: string | null; created_at: string;
    }>>,

    enabled: open && isRealJobId,
    refetchInterval: open && isRealJobId ? 15_000 : false,
  });
  const openSos = sosRows ?? [];
  const sosByPax = new Map<string, typeof openSos>();
  for (const s of openSos) {
    const key = (s.pax_name ?? "").trim().toLowerCase();
    if (!key) continue;
    const arr = sosByPax.get(key) ?? [];
    arr.push(s);
    sosByPax.set(key, arr);
  }
  const ackOne = useMutation({
    mutationFn: (sos_id: string) => ackSosFn({ data: { sos_id } }) as Promise<{ ok: true }>,
    onSuccess: () => {
      toast.success("SOS dismissed");
      qc.invalidateQueries({ queryKey: ["job-sos", job.id] });
      qc.invalidateQueries({ queryKey: ["active-sos-points"] });
      qc.invalidateQueries({ queryKey: ["card-signals"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const ackAll = useMutation({
    mutationFn: () => ackAllSosFn({ data: { job_id: job.id } }) as Promise<{ ok: true; cleared: number }>,
    onSuccess: (r) => {
      toast.success(`Dismissed ${r.cleared} SOS alert${r.cleared === 1 ? "" : "s"}`);
      qc.invalidateQueries({ queryKey: ["job-sos", job.id] });
      qc.invalidateQueries({ queryKey: ["active-sos-points"] });
      qc.invalidateQueries({ queryKey: ["card-signals"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const rescheduleFn = useServerFn(rescheduleJobToFlight);
  const rescheduleMut = useMutation({
    mutationFn: () => rescheduleFn({ data: { id: job.id } }) as Promise<{ ok: true; date: string; time: string }>,
    onSuccess: (r) => {
      toast.success(`Pickup updated to ${r.date} ${r.time}`);
      qc.invalidateQueries({ queryKey: ["jobs"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const [holdPct, setHoldPct] = useState(0);
  const holdRef = useRef<{ start: number | null; raf: number | null }>({ start: null, raf: null });
  const startHold = () => {
    if (!flightIssue || !newTime || rescheduleMut.isPending) return;
    holdRef.current.start = performance.now();
    const tick = () => {
      if (holdRef.current.start == null) return;
      const p = Math.min(1, (performance.now() - holdRef.current.start) / 1000);
      setHoldPct(p);
      if (p >= 1) {
        holdRef.current.start = null;
        setHoldPct(0);
        rescheduleMut.mutate();
      } else {
        holdRef.current.raf = requestAnimationFrame(tick);
      }
    };
    holdRef.current.raf = requestAnimationFrame(tick);
  };
  const cancelHold = () => {
    holdRef.current.start = null;
    if (holdRef.current.raf != null) cancelAnimationFrame(holdRef.current.raf);
    holdRef.current.raf = null;
    setHoldPct(0);
  };



  useEffect(() => {
    if (!open || !job?.id) return;
    let cancelled = false;
    (async () => {
      try {
        const r: any = await normalizeFn({ data: { job_id: job.id } });
        if (cancelled) return;
        if (r?.changed || r?.removed) {
          qc.invalidateQueries({ queryKey: ["jobs"] });
          qc.invalidateQueries({ queryKey: ["job-pax", job.id] });
          const parts: string[] = [];
          if (r.removed) parts.push(`Removed ${r.removed} blank passenger${r.removed > 1 ? "s" : ""}`);
          if (r.phoneMoved) parts.push("moved phone number");
          if (parts.length) toast.success(parts.join(" · "));
        }
      } catch { /* silent */ }
    })();
    return () => { cancelled = true; };
  }, [open, job?.id]);
  const handleRefreshFlight = async () => {
    if (!job) return;
    setRefreshingFlight(true);
    try {
      const r: any = await refreshFlightFn({ data: { job_id: job.id } });
      if (r?.ok) toast.success(`Flight: ${r.status}${r.note ? ` — ${r.note}` : ""}`);
      else if (r?.reason === "not_found") toast.info("Flight not on Malta Airport board");
      else if (r?.reason === "scrape_failed") toast.error("Could not fetch Malta Airport board");
      else if (r?.reason === "no_flight") toast.info("No flight code on this trip");
      qc.invalidateQueries({ queryKey: ["jobs"] });
    } catch (e: any) {
      toast.error(e?.message ?? "Refresh failed");
    } finally {
      setRefreshingFlight(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-md overflow-y-auto p-0">
        <div className="p-5 space-y-4">
          <SheetHeader className="space-y-1 text-left">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span>{job.date}</span>
              <span>·</span>
              <span className="font-medium text-foreground">{job.time?.slice(0, 5)}</span>
              {job.external && (
                <Badge variant="outline" className="ml-auto border-primary/60 text-primary text-[10px]">
                  Partner: {job.executor_name}
                </Badge>
              )}
            </div>
            <SheetTitle className="text-base leading-tight">
              {job.from_location} → {job.to_location}
            </SheetTitle>
            {job.clientcompanyname && (
              <SheetDescription>{job.clientcompanyname}</SheetDescription>
            )}
            {job.promo_note && (
              <div className="mt-2 inline-flex items-center gap-1.5 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-2 py-1 text-xs font-medium text-emerald-800 dark:text-emerald-200">
                <span className="text-[10px] uppercase tracking-widest opacity-70">Promo · billing reminder</span>
                <span>{job.promo_note}</span>
              </div>
            )}
          </SheetHeader>

          {/* Progress */}
          <div className="rounded-md border p-3 space-y-2 bg-muted/40">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium">Trip status</div>
            <TripProgress status={job.status} />
            <div className="text-xs text-muted-foreground">
              {stageIdx >= 0 ? TRIP_STAGES[stageIdx].label : "Not started"}
            </div>
          </div>

          {/* Pricing (coordinator-only) */}
          <TripPricingPanel jobId={job.id} />

          {/* Private per-hop price proposals */}
          <PriceProposalsPanel jobId={job.id} />




          {/* Alerts */}
          {(flightIssue || job.deletion_requested_at) && (
            <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-xs text-destructive space-y-1">
              {flightIssue && (
                <div
                  className="relative flex items-start gap-2 rounded-sm select-none cursor-pointer overflow-hidden"
                  onPointerDown={startHold}
                  onPointerUp={cancelHold}
                  onPointerLeave={cancelHold}
                  onPointerCancel={cancelHold}
                  title={newTime ? "Hold 1s to reschedule pickup to flight time" : undefined}
                >
                  {holdPct > 0 && (
                    <div
                      className="pointer-events-none absolute inset-y-0 left-0 bg-destructive/25 transition-[width] duration-75"
                      style={{ width: `${Math.round(holdPct * 100)}%` }}
                    />
                  )}
                  <CircleAlert className="h-4 w-4 mt-0.5 shrink-0 relative" />
                  <span className="relative">
                    <b>✈ {flightCode}</b>{" "}
                    {job.flight_status === "cancelled" ? "CANCELLED" :
                      job.flight_status === "time_mismatch"
                        ? (job.flight_status_note || (newTime ? `flight ${newTime} ≠ pickup` : "TIME MISMATCH"))
                        : (job.flight_status_note || (newTime ? `DELAYED → ${newTime}` : "DELAYED"))}
                    {newTime && (
                      <span className="ml-1 opacity-70">· hold 1s to move pickup to {newTime}</span>
                    )}
                  </span>
                </div>
              )}
              {job.deletion_requested_at && (
                <div className="flex items-start gap-2">
                  <CircleAlert className="h-4 w-4 mt-0.5 shrink-0" />
                  <span>Deletion pending driver approval</span>
                </div>
              )}
            </div>
          )}

          {/* SOS Alerts */}
          {openSos.length > 0 && (
            <section className="rounded-md border-2 border-red-500 bg-red-50 dark:bg-red-950/30 p-3 space-y-2 animate-pulse">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-sm font-semibold text-red-700 dark:text-red-300">
                  <ShieldAlert className="h-4 w-4" />
                  {openSos.length} active SOS
                </div>
                <Button
                  size="sm" variant="destructive" className="h-7 text-xs"
                  onClick={() => ackAll.mutate()}
                  disabled={ackAll.isPending}
                >
                  Dismiss all
                </Button>
              </div>
              <ul className="space-y-1.5">
                {openSos.map((s) => (
                  <li key={s.id} className="rounded-md bg-white/70 dark:bg-black/30 border border-red-300 p-2 text-xs">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="font-medium text-red-800 dark:text-red-200 truncate">
                          🆘 {s.pax_name || "Passenger"}
                        </div>
                        {s.note && <div className="text-muted-foreground truncate">{s.note}</div>}
                        <div className="text-[10px] text-muted-foreground">
                          {formatRelTime(s.created_at)}
                          {s.latitude != null && s.longitude != null && (
                            <> · <a
                              className="underline text-primary"
                              href={`https://www.google.com/maps?q=${s.latitude},${s.longitude}`}
                              target="_blank" rel="noreferrer"
                            >Open on map</a></>
                          )}
                        </div>
                      </div>
                      <Button
                        size="sm" variant="outline" className="h-6 px-2 text-[10px] shrink-0"
                        onClick={() => ackOne.mutate(s.id)}
                        disabled={ackOne.isPending}
                      >
                        Dismiss
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
              <div className="text-[10px] text-muted-foreground">
                Dismissing clears the alert on your side. The passenger can press SOS again — a new alert will appear immediately.
              </div>
            </section>
          )}



          {/* Driver */}
          <section className="space-y-2">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium">Driver</div>
            {shownDriver ? (
              <div className="rounded-md border p-3 space-y-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{shownDriver}</span>
                  {job.driver_accepted_at ? (
                    <Badge className="bg-emerald-600 hover:bg-emerald-600 text-[10px]">✓ accepted</Badge>
                  ) : (
                    <Badge variant="outline" className="text-[10px] text-amber-600 border-amber-500/50">pending</Badge>
                  )}
                </div>
                {job.drivers?.vehicle && <div className="text-xs text-muted-foreground">🚙 {job.drivers.vehicle}</div>}
                {job.drivers?.phone && (
                  <a href={`tel:${job.drivers.phone}`} className="text-xs text-primary underline">
                    📞 {job.drivers.phone}
                  </a>
                )}
                {job.drivers?.seats_available != null && (
                  <div className="text-xs text-muted-foreground">🪑 {job.drivers.seats_available} seats available</div>
                )}
                {job.drivers?.availability_note && (
                  <div className="text-xs text-muted-foreground italic">"{job.drivers.availability_note}"</div>
                )}
              </div>
            ) : (
              <div className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">No driver assigned</div>
            )}
          </section>

          {/* Passengers */}
          <section className="space-y-2">
            <div className="flex items-center justify-between">
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium">
                Passengers ({pax.length})
              </div>
              {pax.length > 0 && (
                <Badge className={allAboard ? "bg-emerald-600 hover:bg-emerald-600 text-[10px]" : "text-[10px]"} variant={allAboard ? "default" : "secondary"}>
                  {allAboard ? <><CircleCheck className="h-3 w-3 mr-1" />all found</> : `${onboard}/${pax.length} onboard`}
                </Badge>
              )}
            </div>
            {pax.length === 0 ? (
              <div className="text-xs text-muted-foreground">No passengers added yet.</div>
            ) : (
              <ul className="rounded-md border divide-y max-h-72 overflow-y-auto">
                {pax.map((p) => {
                  const act = paxActivity?.[p.id];
                  const presence = act?.presence ?? "never";
                  const msg = act?.last_message;
                  const isClientMsg = msg?.sender_kind === "client";
                  const isRead = !!msg?.read_by_coordinator_at;
                  const paxSos = sosByPax.get((p.name ?? "").trim().toLowerCase()) ?? [];
                  const dotClass =
                    presence === "online" ? "bg-emerald-500 ring-2 ring-emerald-200 animate-pulse"
                    : presence === "away" ? "bg-amber-400"
                    : "bg-slate-300";
                  const dotTitle =
                    presence === "online" ? "Online now"
                    : presence === "away" ? (act?.last_seen_at ? `Last seen ${formatRelTime(act.last_seen_at)}` : "Opened before")
                    : "Hasn't opened the link yet";
                  const subLabel =
                    presence === "online" ? "Online now · tap to chat"
                    : presence === "away" ? `Away · last seen ${act?.last_seen_at ? formatRelTime(act.last_seen_at) : "recently"}`
                    : "Not opened yet · your message will queue until they open the link";
                  return (
                    <li key={p.id} className="p-0">
                      <button
                        type="button"
                        onClick={() => setPaxChat({ paxId: p.id, name: p.name, identityId: act?.identity_id ?? null })}
                        className={`w-full text-left px-3 py-2 text-sm space-y-1 hover:bg-muted/60 focus:bg-muted/60 focus:outline-none transition-colors ${paxSos.length ? "bg-red-50 dark:bg-red-950/30" : ""}`}
                        aria-label={`Open chat with ${p.name}`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate flex items-center gap-1.5">
                            <span className={`h-2 w-2 rounded-full shrink-0 ${dotClass}`} title={dotTitle} aria-label={dotTitle} />
                            <span className="truncate">{p.name}</span>
                            {paxSos.length > 0 && (
                              <Badge className="h-4 px-1.5 text-[9px] bg-red-600 hover:bg-red-600 animate-pulse gap-1">
                                <ShieldAlert className="h-2.5 w-2.5" /> SOS
                              </Badge>
                            )}
                            {act && act.unread_count > 0 && (
                              <Badge className="h-4 px-1.5 text-[9px] bg-primary hover:bg-primary">{act.unread_count} new</Badge>
                            )}
                          </span>

                          <span className="flex items-center gap-2 shrink-0">
                            {p.status === "noshow" ? (
                              <Badge variant="destructive" className="h-4 px-1.5 text-[9px] uppercase tracking-wide">No-show</Badge>
                            ) : (
                              <span className={`text-[10px] capitalize ${p.status === "onboard" ? "text-emerald-600 font-medium" : "text-muted-foreground"}`}>
                                {p.status ?? "pending"}
                              </span>
                            )}
                            <PaxLinkButton jobId={job.id} paxId={p.id} paxName={p.name} />
                            <MessagesSquare className="h-3.5 w-3.5 text-muted-foreground" />
                          </span>

                        </div>
                        {msg ? (
                          <div className="flex items-start gap-1.5 text-[11px] text-muted-foreground pl-3.5">
                            <span className="shrink-0 mt-0.5">
                              {isClientMsg
                                ? (isRead
                                    ? <CheckCheck className="h-3 w-3 text-emerald-600" aria-label="Read" />
                                    : <Check className="h-3 w-3 text-amber-500" aria-label="New" />)
                                : <CheckCheck className="h-3 w-3 text-sky-500" aria-label="Delivered" />}
                            </span>
                            <span className="truncate flex-1">
                              <span className={isClientMsg ? "text-foreground" : ""}>
                                {isClientMsg ? "" : "You: "}{msg.body}
                              </span>
                            </span>
                            <span className="shrink-0">{formatRelTime(msg.created_at)}</span>
                          </div>
                        ) : (
                          <div className="text-[10px] text-muted-foreground pl-3.5">{subLabel}</div>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
            <Button variant="outline" size="sm" className="w-full" onClick={onPax}>
              <Users className="h-4 w-4 mr-2" /> Manage / split passengers
            </Button>

          </section>

          {/* Flight */}
          {(job.from_flight || job.to_flight) && (
            <section className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium">Flight</div>
                <Button
                  variant="ghost" size="sm"
                  className="h-6 px-2 text-[10px]"
                  onClick={handleRefreshFlight}
                  disabled={refreshingFlight}
                >
                  <RefreshCw className={`h-3 w-3 mr-1 ${refreshingFlight ? "animate-spin" : ""}`} />
                  Refresh
                </Button>
              </div>
              <div className={`rounded-md border p-3 space-y-1.5 text-xs ${flightIssue ? "border-destructive/50 bg-destructive/5" : ""}`}>
                <div className="flex items-center justify-between gap-2">
                  <div className="space-y-0.5">
                    {job.from_flight && <div>From: <b>✈ {job.from_flight}</b></div>}
                    {job.to_flight && <div>To: <b>✈ {job.to_flight}</b></div>}
                  </div>
                  <FlightStatusPill status={job.flight_status} />
                </div>
                {job.flight_status_note && (
                  <div className={flightIssue ? "text-destructive font-medium" : "text-muted-foreground"}>
                    {job.flight_status_note}
                  </div>
                )}
                {job.flight_scheduled_at && (
                  <div>Scheduled: {formatMaltaTime(job.flight_scheduled_at)}</div>
                )}
                {job.flight_estimated_at && job.flight_estimated_at !== job.flight_scheduled_at && (
                  <div>Estimated: <span className={flightIssue ? "text-destructive font-medium" : ""}>
                    {formatMaltaTime(job.flight_estimated_at)}
                  </span></div>
                )}
                <div className="text-[10px] text-muted-foreground pt-1 border-t flex items-center justify-between">
                  <span>
                    {job.flight_status_updated_at
                      ? `Updated ${formatMaltaTime(job.flight_status_updated_at)}`
                      : "Not checked yet"}
                  </span>
                  <a
                    href={`https://maltairport.com/flights/${job.from_flight ? "arrivals" : "departures"}/`}
                    target="_blank" rel="noopener noreferrer"
                    className="underline"
                  >
                    Malta Airport
                  </a>
                </div>
              </div>
            </section>
          )}

          {/* Options */}
          <section className="flex flex-wrap gap-1.5">
            {job.tracking_enabled && <Badge variant="outline" className="text-[10px]"><Navigation2 className="h-3 w-3 mr-1" />Tracking on</Badge>}
            
            <Badge variant={paid ? "default" : "secondary"} className={paid ? "bg-emerald-600 hover:bg-emerald-600 text-[10px]" : "text-[10px]"}>
              {paid ? "Paid" : "Payment pending"}
            </Badge>
            {(job.labels ?? []).map((l) => <LabelChip key={l.id} label={l} />)}
          </section>

          {/* Live location */}
          {job.driver_id && !job.external && (
            <TripLiveLocation
              driverId={job.driver_id}
              sosPoints={openSos
                .filter((s) => s.latitude != null && s.longitude != null)
                .map((s) => ({
                  id: s.id,
                  job_id: s.job_id,
                  pax_name: s.pax_name,
                  latitude: s.latitude as number,
                  longitude: s.longitude as number,
                  note: s.note,
                  created_at: s.created_at,
                  job_from: job.from_location,
                  job_to: job.to_location,
                }))}
              onAcknowledgeSos={(id) => ackOne.mutate(id)}
            />
          )}


          {/* Chain */}
          <section className="space-y-2">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium">Dispatch chain</div>
            <ChainTimeline jobId={job.id} />
          </section>

          {/* Footer actions */}
          <div className="grid grid-cols-2 gap-2 pt-2 sticky bottom-0 bg-background border-t -mx-5 px-5 py-3">
            {!job.external && (
              <Button variant="default" onClick={onEdit}>
                <Pencil className="h-4 w-4 mr-2" /> Edit
              </Button>
            )}
            <Button variant="outline" onClick={onChat}>
              <MessagesSquare className="h-4 w-4 mr-2" /> Chat
            </Button>
            {job.driver_id && (
              <Button variant="outline" onClick={() => setDriverChatOpen(true)}>
                <MessagesSquare className="h-4 w-4 mr-2 text-primary" /> Driver (private)
              </Button>
            )}
            {job.driver_id && !job.external && (
              <>
                <Button variant="outline" onClick={onShare}>
                  <MessageCircle className="h-4 w-4 mr-2 text-emerald-600" /> WhatsApp
                </Button>
                <Button variant="outline" onClick={onCopyLink}>
                  <Link2 className="h-4 w-4 mr-2" /> Copy link
                </Button>
              </>
            )}
          </div>
        </div>
      </SheetContent>
      <TripChatDialog
        open={!!paxChat}
        onOpenChange={(v) => { if (!v) setPaxChat(null); }}
        jobId={paxChat ? job.id : null}
        role="coordinator"
        identityId={paxChat?.identityId ?? null}
        paxId={paxChat?.paxId ?? null}
        threadKind={paxChat ? "private" : "group"}
        paxName={paxChat?.name ?? null}
        title="Passenger chat"
      />
      <TripChatDialog
        open={driverChatOpen}
        onOpenChange={setDriverChatOpen}
        jobId={driverChatOpen ? job.id : null}
        role="coordinator"
        threadKind="driver"
        title="Private with driver"
      />
    </Sheet>
  );
}

function PaxLinkButton({ jobId, paxId, paxName }: { jobId: string; paxId: string; paxName: string }) {
  const linkFn = useServerFn(getClientTripLink);
  const [busy, setBusy] = useState(false);
  const onClick = async (e: ReactMouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      const res: any = await linkFn({ data: { job_id: jobId } });
      const url = `${window.location.origin}/t/${res.token}?pax=${paxId}`;
      try {
        await navigator.clipboard.writeText(url);
        toast.success(`Link for ${paxName} copied`);
      } catch {
        toast.error("Copy failed — " + url);
      }
    } catch (err: any) {
      toast.error(err?.message ?? "Could not create link");
    } finally {
      setBusy(false);
    }
  };
  return (
    <span
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") onClick(e as unknown as ReactMouseEvent); }}
      title={`Copy personal link for ${paxName}`}
      aria-label={`Copy personal link for ${paxName}`}
      className="inline-flex items-center justify-center h-5 w-5 rounded hover:bg-primary/10 text-muted-foreground hover:text-primary cursor-pointer"
    >
      <Link2 className="h-3.5 w-3.5" />
    </span>
  );
}

function TripLiveLocation({
  driverId,
  sosPoints = [],
  onAcknowledgeSos,
}: {
  driverId: string;
  sosPoints?: import("./DriverLiveMap").SosPoint[];
  onAcknowledgeSos?: (id: string) => void;
}) {
  const fn = useServerFn(listActiveDriverLocations);
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ["live-locations"],
    queryFn: () => fn({ data: { since_minutes: 30 } }) as Promise<LivePoint[]>,
    refetchInterval: 30_000,
  });
  useEffect(() => {
    const ch = supabase
      .channel(`driver-live-${driverId}`)
      .on("postgres_changes",
        { event: "INSERT", schema: "public", table: "driver_locations", filter: `driver_id=eq.${driverId}` },
        () => qc.invalidateQueries({ queryKey: ["live-locations"] }))
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [qc, driverId]);

  const points = (data ?? []).filter((p) => p.driver_id === driverId);
  const p = points[0];
  const ageSec = p ? Math.max(0, Math.floor((Date.now() - new Date(p.captured_at).getTime()) / 1000)) : null;
  const state: "live" | "paused" | "offline" | "none" =
    !p ? "none" : ageSec! < 30 ? "live" : ageSec! < 120 ? "paused" : "offline";

  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium inline-flex items-center gap-1">
          <MapPin className="h-3 w-3" /> Live location
        </div>
        {state !== "none" && (
          <Badge
            className={`text-[10px] ${
              state === "live" ? "bg-emerald-600 hover:bg-emerald-600" :
              state === "paused" ? "bg-amber-500 hover:bg-amber-500" :
              "bg-muted-foreground/70 hover:bg-muted-foreground/70"
            }`}
          >
            {state === "live" ? "Live" : state === "paused" ? "Paused" : "Offline"}
            {ageSec != null && ageSec >= 5 && ` · ${ageSec < 60 ? `${ageSec}s` : `${Math.floor(ageSec/60)}m`} ago`}
          </Badge>
        )}
      </div>
      {state === "none" && sosPoints.length === 0 ? (
        <div className="text-xs text-muted-foreground border border-dashed rounded-md p-3">
          Driver hasn't shared location yet. They can enable it from their manifest.
        </div>
      ) : (
        <DriverLiveMap points={points} sosPoints={sosPoints} focusDriverId={driverId} height={220} onAcknowledgeSos={onAcknowledgeSos} />

      )}
    </section>
  );
}

function FlightStatusPill({ status }: { status: string | null | undefined }) {
  const s = status ?? "unknown";
  const map: Record<string, { label: string; cls: string }> = {
    scheduled: { label: "On time", cls: "bg-emerald-600 hover:bg-emerald-600 text-white" },
    active: { label: "In progress", cls: "bg-sky-600 hover:bg-sky-600 text-white" },
    landed: { label: "Landed", cls: "bg-emerald-700 hover:bg-emerald-700 text-white" },
    delayed: { label: "Delayed", cls: "bg-destructive hover:bg-destructive text-destructive-foreground" },
    cancelled: { label: "Cancelled", cls: "bg-destructive hover:bg-destructive text-destructive-foreground" },
    diverted: { label: "Diverted", cls: "bg-destructive hover:bg-destructive text-destructive-foreground" },
    time_mismatch: { label: "Time mismatch", cls: "bg-destructive hover:bg-destructive text-destructive-foreground" },
    unknown: { label: "Unknown", cls: "bg-muted text-muted-foreground" },
  };
  const m = map[s] ?? map.unknown;
  return <Badge className={`text-[10px] shrink-0 ${m.cls}`}>{m.label}</Badge>;
}

function TripPricingPanel({ jobId }: { jobId: string }) {
  const qc = useQueryClient();
  const getFn = useServerFn(getTripPricing);
  const setFn = useServerFn(coordinatorSetTripPrice);

  const { data, isLoading } = useQuery({
    queryKey: ["trip-pricing", jobId],
    queryFn: () => getFn({ data: { job_id: jobId } }) as Promise<{
      price_amount: number | null;
      price_currency: string | null;
      payment_method: "cash" | "invoice" | null;
      payment_status: string | null;
      price_set_by: string | null;
      price_set_at: string | null;
      driver_started_at: string | null;
      driver_completed_at: string | null;
      driver_reported_km: number | null;
      driver_note: string | null;
    }>,
  });

  const [editing, setEditing] = useState(false);
  const [amt, setAmt] = useState("");
  const [ccy, setCcy] = useState("EUR");
  const [method, setMethod] = useState<"cash" | "invoice" | "">("");

  useEffect(() => {
    if (!data) return;
    setAmt(data.price_amount != null ? String(data.price_amount) : "");
    setCcy(data.price_currency || "EUR");
    setMethod((data.payment_method as "cash" | "invoice" | null) ?? "");
  }, [data]);

  const mut = useMutation({
    mutationFn: () => setFn({
      data: {
        job_id: jobId,
        price_amount: amt.trim() === "" ? null : Number(amt.replace(",", ".")),
        price_currency: ccy,
        payment_method: method === "" ? null : method,
      },
    }) as Promise<{ ok: true }>,
    onSuccess: () => {
      toast.success("Pricing updated");
      qc.invalidateQueries({ queryKey: ["trip-pricing", jobId] });
      qc.invalidateQueries({ queryKey: ["jobs"] });
      setEditing(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const durationMin = (() => {
    if (!data?.driver_started_at || !data?.driver_completed_at) return null;
    const a = new Date(data.driver_started_at).getTime();
    const b = new Date(data.driver_completed_at).getTime();
    if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return null;
    return Math.round((b - a) / 60_000);
  })();

  return (
    <section className="rounded-md border p-3 space-y-2 bg-amber-50/40 dark:bg-amber-950/10 border-amber-500/30">
      <div className="flex items-center justify-between gap-2">
        <div className="inline-flex items-center gap-1.5 text-[11px] uppercase tracking-wide font-semibold text-amber-800 dark:text-amber-300">
          <Lock className="h-3 w-3" /> Pricing · coordinator only
        </div>
        {!editing && (
          <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => setEditing(true)}>
            <Pencil className="h-3.5 w-3.5 mr-1" /> Edit
          </Button>
        )}
      </div>

      {isLoading ? (
        <div className="text-xs text-muted-foreground">Loading…</div>
      ) : editing ? (
        <div className="space-y-2">
          <div className="flex gap-2">
            <input
              type="number" min={0} step="0.01" placeholder="0.00"
              value={amt} onChange={(e) => setAmt(e.target.value)}
              className="flex-1 h-9 rounded-md border bg-background px-2 text-sm"
            />
            <select value={ccy} onChange={(e) => setCcy(e.target.value)}
              className="h-9 rounded-md border bg-background px-2 text-sm">
              {["EUR", "USD", "GBP"].map((c) => <option key={c}>{c}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <button type="button" onClick={() => setMethod("cash")}
              className={`rounded-md border p-2 text-left text-xs transition ${method === "cash" ? "border-emerald-500 bg-emerald-500/10" : "hover:bg-muted"}`}>
              <div className="inline-flex items-center gap-1.5 font-medium"><Wallet className="h-3.5 w-3.5" /> Paid on spot</div>
            </button>
            <button type="button" onClick={() => setMethod("invoice")}
              className={`rounded-md border p-2 text-left text-xs transition ${method === "invoice" ? "border-primary bg-primary/10" : "hover:bg-muted"}`}>
              <div className="inline-flex items-center gap-1.5 font-medium"><FileText className="h-3.5 w-3.5" /> Invoice</div>
            </button>
          </div>
          <div className="flex gap-2 pt-1">
            <Button size="sm" variant="ghost" className="h-8" onClick={() => setEditing(false)}>Cancel</Button>
            <Button size="sm" className="h-8 ml-auto" disabled={mut.isPending} onClick={() => mut.mutate()}>
              {mut.isPending ? "Saving…" : "Save"}
            </Button>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div className="col-span-2 flex items-center gap-2">
            <Receipt className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="font-semibold text-sm">
              {data?.price_amount != null ? `${data.price_currency ?? "EUR"} ${Number(data.price_amount).toFixed(2)}` : "— not priced"}
            </span>
            {data?.payment_method === "cash" && (
              <Badge variant="outline" className="ml-auto border-emerald-500/60 text-emerald-700 dark:text-emerald-400 text-[10px]">
                <Wallet className="h-3 w-3 mr-1" /> Paid on spot
              </Badge>
            )}
            {data?.payment_method === "invoice" && (
              <Badge variant="outline" className="ml-auto border-primary/60 text-primary text-[10px]">
                <FileText className="h-3 w-3 mr-1" /> Invoice
              </Badge>
            )}
          </div>
          <div className="text-muted-foreground">Duration <span className="text-foreground font-medium ml-1">{durationMin != null ? `${durationMin} min` : "—"}</span></div>
          <div className="text-muted-foreground">Distance <span className="text-foreground font-medium ml-1">{data?.driver_reported_km != null ? `${data.driver_reported_km} km` : "—"}</span></div>
          {data?.driver_note && (
            <div className="col-span-2 rounded bg-muted/60 p-2 text-[11px] italic">"{data.driver_note}"</div>
          )}
        </div>
      )}
    </section>
  );
}
