import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { TripProgress, TRIP_STAGES } from "./TripProgress";
import { ChainTimeline } from "./ChainTimeline";
import { LabelChip, type Label as TLabel } from "./LabelChip";
import { DriverLiveMap, type LivePoint } from "./DriverLiveMap";
import { listActiveDriverLocations, getMaltaFlightStatus, normalizeJobData, listPaxActivityCoord } from "@/lib/coordinator.functions";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  Pencil, MessagesSquare, MessageCircle, Link2, Users, Plane, QrCode, Navigation2, CircleCheck, CircleAlert, MapPin, RefreshCw, Check, CheckCheck,
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

  const { data: paxActivity } = useQuery({
    queryKey: ["pax-activity", job.id],
    queryFn: () => paxActivityFn({ data: { job_id: job.id } }) as Promise<Record<string, {
      identity_id: string | null;
      last_seen_at: string | null;
      last_message: { body: string; created_at: string; sender_kind: string; sender_label: string | null; read_by_coordinator_at: string | null } | null;
      unread_count: number;
    }>>,
    enabled: open,
    refetchInterval: open ? 20_000 : false,
  });


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
          </SheetHeader>

          {/* Progress */}
          <div className="rounded-md border p-3 space-y-2 bg-muted/40">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium">Trip status</div>
            <TripProgress status={job.status} />
            <div className="text-xs text-muted-foreground">
              {stageIdx >= 0 ? TRIP_STAGES[stageIdx].label : "Not started"}
            </div>
          </div>

          {/* Alerts */}
          {(flightIssue || job.deletion_requested_at) && (
            <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-xs text-destructive space-y-1">
              {flightIssue && (
                <div className="flex items-start gap-2">
                  <CircleAlert className="h-4 w-4 mt-0.5 shrink-0" />
                  <span>
                    <b>✈ {flightCode}</b>{" "}
                    {job.flight_status === "cancelled" ? "CANCELLED" :
                      job.flight_status === "time_mismatch"
                        ? (job.flight_status_note || (newTime ? `flight ${newTime} ≠ pickup` : "TIME MISMATCH"))
                        : (job.flight_status_note || (newTime ? `DELAYED → ${newTime}` : "DELAYED"))}
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
                  const online = act?.last_seen_at && (Date.now() - new Date(act.last_seen_at).getTime()) < 90_000;
                  const msg = act?.last_message;
                  const isClientMsg = msg?.sender_kind === "client";
                  const isRead = !!msg?.read_by_coordinator_at;
                  return (
                    <li key={p.id} className="px-3 py-2 text-sm space-y-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate flex items-center gap-1.5">
                          {online && <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 shrink-0" title="Online now" />}
                          <span className="truncate">{p.name}</span>
                          {act && act.unread_count > 0 && (
                            <Badge className="h-4 px-1.5 text-[9px] bg-primary hover:bg-primary">{act.unread_count} new</Badge>
                          )}
                        </span>
                        <span className={`text-[10px] capitalize shrink-0 ${p.status === "onboard" ? "text-emerald-600 font-medium" : "text-muted-foreground"}`}>
                          {p.status ?? "pending"}
                        </span>
                      </div>
                      {msg && (
                        <div className="flex items-start gap-1.5 text-[11px] text-muted-foreground pl-3">
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
                      )}
                      {!msg && act?.identity_id && (
                        <div className="text-[10px] text-muted-foreground pl-3">Linked · no messages yet</div>
                      )}
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
                  <div>Scheduled: {new Date(job.flight_scheduled_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</div>
                )}
                {job.flight_estimated_at && job.flight_estimated_at !== job.flight_scheduled_at && (
                  <div>Estimated: <span className={flightIssue ? "text-destructive font-medium" : ""}>
                    {new Date(job.flight_estimated_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </span></div>
                )}
                <div className="text-[10px] text-muted-foreground pt-1 border-t flex items-center justify-between">
                  <span>
                    {job.flight_status_updated_at
                      ? `Updated ${new Date(job.flight_status_updated_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
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
            <TripLiveLocation driverId={job.driver_id} />
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
    </Sheet>
  );
}

function TripLiveLocation({ driverId }: { driverId: string }) {
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
      {state === "none" ? (
        <div className="text-xs text-muted-foreground border border-dashed rounded-md p-3">
          Driver hasn't shared location yet. They can enable it from their manifest.
        </div>
      ) : (
        <DriverLiveMap points={points} focusDriverId={driverId} height={220} />
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
