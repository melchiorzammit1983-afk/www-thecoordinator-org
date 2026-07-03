import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  MapPin, Send, Plus, LocateFixed, Share2, Phone, Loader2, CalendarPlus,
  CheckCircle2, Plane, Bell, BellOff, AlertTriangle, WifiOff, Users, Lock,
} from "lucide-react";
import {
  getClientTripPortal, chooseClientIdentity, listClientTripMessages,
  postClientTripMessage, pushClientLocation, requestClientFollowUp,
  confirmClientTrip, heartbeatClientPortal,
  triggerClientSOS, getTripEta,
  subscribeClientPush, unsubscribeClientPush, getPushPublicKey,
} from "@/lib/coordinator-public.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { TripProgress } from "@/components/coordinator/TripProgress";
import { cn } from "@/lib/utils";
import { readPortalCache, writePortalCache } from "@/lib/client-portal-cache";


export const Route = createFileRoute("/t/$token")({
  component: ClientTripPortal,
});

function getDeviceId(): string {
  const KEY = "cc.client_device_id";
  let v = localStorage.getItem(KEY);
  if (!v) {
    const bytes = new Uint8Array(12);
    crypto.getRandomValues(bytes);
    v = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
    localStorage.setItem(KEY, v);
  }
  return v;
}

function useOnline() {
  const [online, setOnline] = useState(() =>
    typeof navigator === "undefined" ? true : navigator.onLine,
  );
  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    return () => { window.removeEventListener("online", up); window.removeEventListener("offline", down); };
  }, []);
  return online;
}

function ClientTripPortal() {
  const { token } = Route.useParams();
  const deviceId = useMemo(() => getDeviceId(), []);
  const qc = useQueryClient();
  const online = useOnline();

  // Register service worker (offline + push)
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  }, []);

  const portalFn = useServerFn(getClientTripPortal);
  const cached = readPortalCache(token);
  const { data: liveData, isLoading, error } = useQuery({
    queryKey: ["client-portal", token, deviceId],
    queryFn: async () => {
      const res = await portalFn({ data: { token, device_id: deviceId } });
      writePortalCache(token, res);
      return res;
    },
    refetchInterval: online ? 15_000 : false,
    retry: online ? 3 : 0,
  });
  const data = liveData ?? (cached?.data as any);
  const usingCache = !liveData && !!cached;

  // Heartbeat presence every 45s while the tab is open
  const beatFn = useServerFn(heartbeatClientPortal);
  useEffect(() => {
    if (!online) return;
    const ping = () => { beatFn({ data: { token, device_id: deviceId } }).catch(() => {}); };
    ping();
    const id = window.setInterval(ping, 45_000);
    const onVis = () => { if (document.visibilityState === "visible") ping(); };
    document.addEventListener("visibilitychange", onVis);
    return () => { window.clearInterval(id); document.removeEventListener("visibilitychange", onVis); };
  }, [beatFn, token, deviceId, online]);

  const confirmFn = useServerFn(confirmClientTrip);
  const confirmMut = useMutation({
    mutationFn: () => confirmFn({ data: { token, device_id: deviceId } }),
    onSuccess: () => { toast.success("Thanks — coordinator notified"); qc.invalidateQueries({ queryKey: ["client-portal"] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const [tab, setTab] = useState<"trip" | "chat" | "rebook">("trip");

  if (isLoading && !cached) {
    return <div className="min-h-screen grid place-items-center bg-slate-50">
      <Loader2 className="h-6 w-6 animate-spin text-slate-500" />
    </div>;
  }
  if ((error || !data) && !cached) {
    return <div className="min-h-screen grid place-items-center bg-slate-50 p-6 text-center">
      <div>
        <h1 className="text-lg font-semibold mb-2">Link unavailable</h1>
        <p className="text-sm text-muted-foreground">This trip link is invalid or has expired.</p>
      </div>
    </div>;
  }

  const job = data.job;
  const company = data.company;
  const driver = data.driver;
  const isGroup = (data.siblings?.length ?? 0) > 1;
  const hasIdentity = !!data.identity;
  const uniquePax = useMemo(() => {
    const seen = new Set<string>();
    const out: any[] = [];
    for (const p of (data.pax ?? [])) {
      const k = (p?.name ?? "").trim().toLowerCase();
      if (!k || seen.has(k)) continue;
      seen.add(k);
      out.push(p);
    }
    return out;
  }, [data.pax]);
  const needsIdentity = !hasIdentity && (uniquePax.length > 1 || (isGroup && uniquePax.length > 0));

  const [pickerOpen, setPickerOpen] = useState(false);
  const autoOpenedRef = useRef(false);
  useEffect(() => {
    if (needsIdentity && !autoOpenedRef.current) {
      autoOpenedRef.current = true;
      setPickerOpen(true);
    }
    if (hasIdentity) setPickerOpen(false);
  }, [needsIdentity, hasIdentity]);

  return (
    <div className="min-h-screen bg-slate-50 pb-24">
      {/* Offline banner */}
      {(!online || usingCache) && (
        <div className="bg-amber-500 text-white text-xs font-medium px-4 py-1.5 flex items-center gap-2">
          <WifiOff className="h-3.5 w-3.5" />
          {usingCache
            ? `Offline — showing cached info from ${cached ? new Date(cached.at).toLocaleTimeString() : "?"}`
            : "You are offline. Some info may be out of date."}
        </div>
      )}

      {/* Header */}
      <header className="bg-gradient-to-br from-teal-800 to-teal-700 text-white px-4 pt-6 pb-5 shadow">
        <div className="text-[11px] uppercase tracking-widest opacity-70">{company?.name ?? "Transfer"}</div>
        <div className="mt-1 font-semibold text-lg leading-tight">
          {(job.from_location || "?")}{job.from_flight ? ` · ${job.from_flight}` : ""}
          <span className="opacity-70"> → </span>
          {(job.to_location || "?")}{job.to_flight ? ` · ${job.to_flight}` : ""}
        </div>
        <div className="mt-1 text-sm opacity-90">
          {job.pickup_at ? new Date(job.pickup_at).toLocaleString([], { weekday: "short", month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" })
            : `${job.date}${job.time ? " · " + job.time.slice(0, 5) : ""}`}
        </div>
        {data.identity?.pax_name ? (
          <div className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-white/15 px-2.5 py-0.5 text-xs">
            <span>Signed in as <b>{data.identity.pax_name}</b></span>
            {uniquePax.length > 1 && (
              <button onClick={() => setPickerOpen(true)} className="underline underline-offset-2 opacity-90 hover:opacity-100">
                Change
              </button>
            )}
          </div>
        ) : uniquePax.length > 1 ? (
          <button
            onClick={() => setPickerOpen(true)}
            className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-amber-400 text-amber-950 px-2.5 py-1 text-xs font-medium shadow-sm"
          >
            <Users className="h-3.5 w-3.5" /> Tap to choose your name
          </button>
        ) : null}
      </header>

      <IdentityPickerDialog
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        token={token}
        deviceId={deviceId}
        pax={uniquePax}
        allowSkip={!needsIdentity || hasIdentity}
        onDone={() => { setPickerOpen(false); qc.invalidateQueries({ queryKey: ["client-portal"] }); }}
      />


      {/* Tabs */}
      <nav className="sticky top-0 z-10 bg-white border-b flex">
        {(["trip", "chat", "rebook"] as const).map((t) => (
          <button key={t}
            onClick={() => setTab(t)}
            className={cn("flex-1 py-3 text-sm font-medium capitalize", tab === t ? "text-teal-800 border-b-2 border-teal-700" : "text-slate-500")}>
            {t === "trip" ? "Trip" : t === "chat" ? "Chat" : "Book again"}
          </button>
        ))}
      </nav>

      {tab === "trip" && (
        <div className="p-4 space-y-4">
          {/* Progress */}
          <section className="rounded-2xl bg-white p-4 shadow-sm border">
            <div className="text-xs font-semibold text-slate-500 uppercase mb-3">Trip status</div>
            <TripProgress status={job.status} />
            {job.client_confirmed_at ? (
              <div className="mt-3 inline-flex items-center gap-2 rounded-lg bg-emerald-50 border border-emerald-200 px-3 py-2 text-xs text-emerald-800">
                <CheckCircle2 className="h-4 w-4" /> You confirmed you'll be there
              </div>
            ) : (
              <Button className="mt-3 w-full bg-emerald-600 hover:bg-emerald-700" onClick={() => confirmMut.mutate()} disabled={confirmMut.isPending || !online}>
                <CheckCircle2 className="h-4 w-4 mr-2" /> I'll be there — confirm
              </Button>
            )}
          </section>

          {/* Flight card */}
          {(job.from_flight || job.to_flight) && (
            <FlightCard job={job} />
          )}

          {/* Driver + tracking + ETA */}
          <section className="rounded-2xl bg-white p-4 shadow-sm border">
            <div className="text-xs font-semibold text-slate-500 uppercase mb-2">Your driver</div>
            {driver ? (
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="font-medium">{driver.name}</div>
                  {driver.phone && <div className="text-xs text-muted-foreground">{driver.phone}</div>}
                </div>
                <div className="flex gap-2">
                  {driver.phone && (
                    <a href={`tel:${driver.phone}`}><Button size="sm" variant="outline"><Phone className="h-4 w-4" /></Button></a>
                  )}
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Driver not yet assigned. You can already chat with the coordinator.</p>
            )}
            {driver && <EtaPill token={token} />}
            {data.driverLocations?.[0] && (
              <ClientTripMap
                driver={{ lat: data.driverLocations[0].latitude, lng: data.driverLocations[0].longitude, name: driver?.name ?? "Driver" }}
                pickup={job.from_location}
                dropoff={job.to_location}
              />
            )}
          </section>

          {/* Alerts opt-in */}
          <PushOptIn token={token} deviceId={deviceId} />

          {/* Share my location */}
          <ShareLocation token={token} deviceId={deviceId} />

          {/* Group siblings */}
          {isGroup && (
            <section className="rounded-2xl bg-white p-4 shadow-sm border">
              <div className="text-xs font-semibold text-slate-500 uppercase mb-2">
                {job.group_name ? `Group: ${job.group_name}` : "Grouped trips"}
              </div>
              <ul className="text-sm divide-y">
                {data.siblings.map((s: any) => (
                  <li key={s.id} className="py-2 flex items-center justify-between">
                    <span className="truncate">{s.from_location} → {s.to_location}</span>
                    <Badge variant="outline" className="text-[10px]">{s.status}</Badge>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* Emergency SOS */}
          <SosButton token={token} deviceId={deviceId} />
        </div>
      )}

      {tab === "chat" && (
        <ChatPanel token={token} deviceId={deviceId} driverAssigned={!!driver} isGroup={isGroup} hasIdentity={hasIdentity} onChooseName={() => setPickerOpen(true)} />
      )}

      {tab === "rebook" && (
        <RebookPanel token={token} deviceId={deviceId} lastFrom={job.from_location ?? ""} lastTo={job.to_location ?? ""} />
      )}
    </div>
  );
}

/* ---------------- Flight status card ---------------- */

function FlightCard({ job }: { job: any }) {
  const code = job.from_flight || job.to_flight;
  const status = String(job.flight_status ?? "").toLowerCase();
  const bad = status === "cancelled" || status === "diverted" || status === "delayed" || status === "time_mismatch";
  const good = status === "landed" || status === "active" || status === "on_time" || status === "";
  const color = bad ? "border-red-200 bg-red-50 text-red-800"
    : good ? "border-emerald-200 bg-emerald-50 text-emerald-800"
    : "border-slate-200 bg-slate-50 text-slate-800";
  return (
    <section className={cn("rounded-2xl border p-4 shadow-sm", color)}>
      <div className="flex items-center gap-2 text-xs font-semibold uppercase opacity-70 mb-2">
        <Plane className="h-3.5 w-3.5" /> Flight {code}
      </div>
      <div className="text-sm font-medium">{job.flight_status_note ?? "Awaiting flight info…"}</div>
      <div className="mt-3 grid grid-cols-3 gap-2 text-center">
        <div className="rounded-lg bg-white/70 border p-2">
          <div className="text-[10px] uppercase text-slate-500">Terminal</div>
          <div className="text-sm font-semibold">{job.flight_terminal ?? "—"}</div>
        </div>
        <div className="rounded-lg bg-white/70 border p-2">
          <div className="text-[10px] uppercase text-slate-500">Gate</div>
          <div className="text-sm font-semibold">{job.flight_gate ?? "—"}</div>
        </div>
        <div className="rounded-lg bg-white/70 border p-2">
          <div className="text-[10px] uppercase text-slate-500">Belt</div>
          <div className="text-sm font-semibold">{job.flight_baggage_belt ?? "—"}</div>
        </div>
      </div>
    </section>
  );
}

/* ---------------- ETA pill ---------------- */

function EtaPill({ token }: { token: string }) {
  const etaFn = useServerFn(getTripEta);
  const { data } = useQuery({
    queryKey: ["client-eta", token],
    queryFn: () => etaFn({ data: { token } }) as Promise<any>,
    refetchInterval: 30_000,
    retry: false,
  });
  if (!data || !data.ok) return null;
  const mins = data.seconds ? Math.max(1, Math.round(data.seconds / 60)) : null;
  return (
    <div className="mt-3 inline-flex items-center gap-2 rounded-full bg-teal-50 border border-teal-200 px-3 py-1 text-xs text-teal-800">
      <MapPin className="h-3.5 w-3.5" />
      Driver arriving in <b className="mx-1">{mins ? `${mins} min` : data.text}</b>
      <span className="opacity-60">· {data.distance_text}</span>
    </div>
  );
}

/* ---------------- Push opt-in ---------------- */

function PushOptIn({ token, deviceId }: { token: string; deviceId: string }) {
  const subFn = useServerFn(subscribeClientPush);
  const unsubFn = useServerFn(unsubscribeClientPush);
  const keyFn = useServerFn(getPushPublicKey);
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const supported = typeof window !== "undefined"
    && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

  useEffect(() => {
    if (!supported) return;
    (async () => {
      try {
        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.getSubscription();
        setEnabled(!!sub);
      } catch { setEnabled(false); }
    })();
  }, [supported]);

  const b64ToUint8 = (b64: string) => {
    const pad = "=".repeat((4 - (b64.length % 4)) % 4);
    const s = (b64 + pad).replace(/-/g, "+").replace(/_/g, "/");
    const raw = atob(s);
    const out = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  };

  const enable = async () => {
    if (!supported) return toast.error("Notifications not supported on this device");
    setBusy(true);
    try {
      const perm = await Notification.requestPermission();
      if (perm !== "granted") { toast.error("Permission denied"); return; }
      const key = await keyFn();
      if (!key.publicKey) {
        toast.info("Server keys not set — using local alerts only");
        setEnabled(true); return;
      }
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: b64ToUint8(key.publicKey),
      });
      const json: any = sub.toJSON();
      await subFn({ data: {
        token, device_id: deviceId,
        endpoint: sub.endpoint,
        p256dh: json.keys?.p256dh ?? "",
        auth: json.keys?.auth ?? "",
      }});
      setEnabled(true);
      toast.success("Alerts on");
    } catch (e: any) { toast.error(e.message ?? "Could not enable"); }
    finally { setBusy(false); }
  };

  const disable = async () => {
    setBusy(true);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await unsubFn({ data: { token, device_id: deviceId, endpoint: sub.endpoint } });
        await sub.unsubscribe();
      }
      setEnabled(false);
      toast.success("Alerts off");
    } catch (e: any) { toast.error(e.message ?? "Could not disable"); }
    finally { setBusy(false); }
  };

  if (!supported) return null;

  return (
    <section className="rounded-2xl bg-white p-4 shadow-sm border">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm font-medium">Trip alerts</div>
          <div className="text-xs text-muted-foreground">Get notified when driver is assigned or arriving.</div>
        </div>
        <Button size="sm" variant={enabled ? "outline" : "default"} disabled={busy} onClick={() => (enabled ? disable() : enable())}>
          {enabled ? <><BellOff className="h-4 w-4 mr-1" /> Turn off</> : <><Bell className="h-4 w-4 mr-1" /> Turn on</>}
        </Button>
      </div>
    </section>
  );
}

/* ---------------- SOS ---------------- */

function SosButton({ token, deviceId }: { token: string; deviceId: string }) {
  const fn = useServerFn(triggerClientSOS);
  const [holdPct, setHoldPct] = useState(0);
  const timer = useRef<number | null>(null);
  const HOLD_MS = 1500;

  const fire = async () => {
    const coords = await new Promise<GeolocationCoordinates | null>((resolve) => {
      if (!navigator.geolocation) return resolve(null);
      navigator.geolocation.getCurrentPosition(
        (p) => resolve(p.coords),
        () => resolve(null),
        { enableHighAccuracy: true, timeout: 5000 },
      );
    });
    try {
      await fn({ data: {
        token, device_id: deviceId,
        latitude: coords?.latitude ?? null,
        longitude: coords?.longitude ?? null,
        accuracy_m: coords?.accuracy ?? null,
      }});
      toast.success("SOS sent — coordinator alerted");
    } catch (e: any) { toast.error(e.message ?? "SOS failed"); }
  };

  const start = () => {
    const startAt = performance.now();
    timer.current = window.setInterval(() => {
      const pct = Math.min(100, ((performance.now() - startAt) / HOLD_MS) * 100);
      setHoldPct(pct);
      if (pct >= 100) {
        stop(); fire();
      }
    }, 40) as unknown as number;
  };
  const stop = () => {
    if (timer.current != null) { window.clearInterval(timer.current); timer.current = null; }
    setHoldPct(0);
  };

  return (
    <section className="rounded-2xl bg-white p-4 shadow-sm border-2 border-red-200">
      <div className="flex items-start gap-2 mb-2">
        <AlertTriangle className="h-4 w-4 text-red-600 mt-0.5" />
        <div>
          <div className="text-sm font-semibold text-red-800">Emergency SOS</div>
          <div className="text-xs text-red-700/70">Press and hold for 1.5s. Sends your location to the coordinator.</div>
        </div>
      </div>
      <button
        onPointerDown={start}
        onPointerUp={stop}
        onPointerLeave={stop}
        onPointerCancel={stop}
        className="relative w-full h-14 rounded-xl bg-red-600 text-white font-bold text-lg overflow-hidden select-none active:bg-red-700"
      >
        <div className="absolute inset-y-0 left-0 bg-red-800/40 transition-[width]" style={{ width: `${holdPct}%` }} />
        <span className="relative z-10">SOS · Hold</span>
      </button>
    </section>
  );
}

/* ---------------- Identity picker ---------------- */

function IdentityPickerDialog({ open, onOpenChange, token, deviceId, pax, allowSkip, onDone }: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  token: string;
  deviceId: string;
  pax: any[];
  allowSkip: boolean;
  onDone: () => void;
}) {
  const chooseFn = useServerFn(chooseClientIdentity);
  const mut = useMutation({
    mutationFn: (p: { pax_id: string | null; pax_name: string }) =>
      chooseFn({ data: { token, device_id: deviceId, pax_id: p.pax_id, pax_name: p.pax_name } }),
    onSuccess: () => onDone(),
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        // Only allow closing when explicitly permitted (already chose or skipped).
        if (!v && !allowSkip) return;
        onOpenChange(v);
      }}
    >
      <DialogContent
        className="sm:max-w-sm"
        onInteractOutside={(e) => { if (!allowSkip) e.preventDefault(); }}
        onEscapeKeyDown={(e) => { if (!allowSkip) e.preventDefault(); }}
      >
        <DialogHeader>
          <DialogTitle>Which passenger are you?</DialogTitle>
          <DialogDescription>
            Pick your name so the coordinator can message you privately. This is remembered on this device.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-2 max-h-[55vh] overflow-y-auto py-1">
          {pax.map((p) => (
            <Button
              key={p.id}
              variant="outline"
              className="justify-start"
              disabled={mut.isPending}
              onClick={() => mut.mutate({ pax_id: p.id, pax_name: p.name })}
            >
              {p.name}
            </Button>
          ))}
          {pax.length === 0 && (
            <p className="text-sm text-muted-foreground">No passenger names yet — check back soon.</p>
          )}
        </div>
        <DialogFooter className="sm:justify-between gap-2">
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
            {allowSkip ? "Close" : "Skip for now"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}


/* ---------------- Share location ---------------- */

function ShareLocation({ token, deviceId }: { token: string; deviceId: string }) {
  const pushFn = useServerFn(pushClientLocation);
  const [sharing, setSharing] = useState(false);
  const [lastAt, setLastAt] = useState<string | null>(null);
  const watchId = useRef<number | null>(null);

  const send = async (mode: "live" | "pin", coords: GeolocationCoordinates) => {
    try {
      await pushFn({ data: {
        token, device_id: deviceId,
        latitude: coords.latitude, longitude: coords.longitude,
        accuracy_m: coords.accuracy ?? null, mode,
      }});
      setLastAt(new Date().toLocaleTimeString());
    } catch (e: any) { toast.error(e.message); }
  };

  const dropPin = () => {
    if (!navigator.geolocation) return toast.error("Location not supported");
    navigator.geolocation.getCurrentPosition(
      (pos) => { send("pin", pos.coords); toast.success("Location shared"); },
      (err) => toast.error(err.message),
      { enableHighAccuracy: true, timeout: 10_000 }
    );
  };

  const toggleLive = () => {
    if (sharing) {
      if (watchId.current != null) navigator.geolocation.clearWatch(watchId.current);
      watchId.current = null; setSharing(false); return;
    }
    if (!navigator.geolocation) return toast.error("Location not supported");
    const id = navigator.geolocation.watchPosition(
      (pos) => send("live", pos.coords),
      (err) => toast.error(err.message),
      { enableHighAccuracy: true, maximumAge: 5000 }
    );
    watchId.current = id; setSharing(true);
    toast.success("Live sharing on");
  };

  useEffect(() => () => {
    if (watchId.current != null) navigator.geolocation.clearWatch(watchId.current);
  }, []);

  return (
    <section className="rounded-2xl bg-white p-4 shadow-sm border">
      <div className="text-xs font-semibold text-slate-500 uppercase mb-2">Share your location</div>
      <div className="grid grid-cols-2 gap-2">
        <Button variant={sharing ? "default" : "outline"} onClick={toggleLive}>
          <LocateFixed className="h-4 w-4 mr-2" /> {sharing ? "Sharing…" : "Share live"}
        </Button>
        <Button variant="outline" onClick={dropPin}>
          <Share2 className="h-4 w-4 mr-2" /> Send my pin
        </Button>
      </div>
      {lastAt && <p className="mt-2 text-xs text-muted-foreground">Last sent at {lastAt}</p>}
    </section>
  );
}

/* ---------------- Chat (Group + Private) ---------------- */

function ChatPanel({ token, deviceId, driverAssigned, isGroup, hasIdentity, onChooseName }: {
  token: string; deviceId: string; driverAssigned: boolean; isGroup: boolean; hasIdentity: boolean; onChooseName: () => void;
}) {

  const listFn = useServerFn(listClientTripMessages);
  const postFn = useServerFn(postClientTripMessage);
  const [thread, setThread] = useState<"group" | "private">(isGroup ? "group" : "private");
  const [text, setText] = useState("");
  const qc = useQueryClient();
  const key = ["client-chat", token, thread, deviceId];

  const { data: messages } = useQuery({
    queryKey: key,
    queryFn: () => listFn({ data: { token, device_id: deviceId, thread_kind: thread } }) as Promise<any[]>,
    refetchInterval: 6_000,
  });
  const scrollRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages]);

  const mut = useMutation({
    mutationFn: (body: string) => postFn({ data: { token, device_id: deviceId, body, thread_kind: thread } }),
    onSuccess: () => { setText(""); qc.invalidateQueries({ queryKey: ["client-chat", token, thread] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const privateBlocked = thread === "private" && !hasIdentity;

  return (
    <div className="p-4">
      {isGroup && (
        <div className="grid grid-cols-2 gap-1 rounded-xl bg-slate-100 p-1 mb-3">
          <button
            className={cn("rounded-lg py-2 text-xs font-medium flex items-center justify-center gap-1.5",
              thread === "group" ? "bg-white shadow-sm text-teal-800" : "text-slate-500")}
            onClick={() => setThread("group")}
          >
            <Users className="h-3.5 w-3.5" /> Group
          </button>
          <button
            className={cn("rounded-lg py-2 text-xs font-medium flex items-center justify-center gap-1.5",
              thread === "private" ? "bg-white shadow-sm text-teal-800" : "text-slate-500")}
            onClick={() => setThread("private")}
          >
            <Lock className="h-3.5 w-3.5" /> Private
          </button>
        </div>
      )}

      <div className="rounded-2xl bg-white border shadow-sm overflow-hidden flex flex-col h-[65vh]">
        <div className={cn("border-b text-xs px-3 py-2",
          thread === "group" ? "bg-sky-50 text-sky-800" : "bg-purple-50 text-purple-800")}>
          {thread === "group"
            ? (driverAssigned ? "Group chat — visible to everyone in this trip and the driver." : "Group chat — visible to everyone in this trip. Driver joins when assigned.")
            : "Private chat — only you and the coordinator can see this."}
        </div>

        {privateBlocked ? (
          <div className="flex-1 grid place-items-center p-6 text-center text-sm text-muted-foreground gap-3">
            <p>Choose your name first to start a private chat.</p>
            <Button size="sm" onClick={onChooseName}>Choose my name</Button>
          </div>
        ) : (

          <>
            <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 space-y-2 bg-slate-50">
              {(messages ?? []).length === 0 && (
                <p className="text-center text-xs text-muted-foreground py-8">No messages yet. Say hello!</p>
              )}
              {(messages ?? []).map((m: any) => {
                const mine = m.sender_kind === "client";
                return (
                  <div key={m.id} className={cn("flex", mine ? "justify-end" : "justify-start")}>
                    <div className={cn("rounded-2xl px-3 py-2 max-w-[80%] text-sm shadow-sm",
                      m.is_sos ? "bg-red-600 text-white" :
                      mine ? "bg-teal-700 text-white rounded-br-sm"
                           : m.sender_kind === "driver" ? "bg-emerald-50 border border-emerald-200 rounded-bl-sm"
                           : "bg-white border rounded-bl-sm")}>
                      <div className={cn("text-[10px] uppercase tracking-wide mb-0.5",
                        mine || m.is_sos ? "opacity-70" : "text-muted-foreground")}>
                        {m.sender_label ?? m.sender_kind} · {new Date(m.created_at).toLocaleString([], { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "short" })}
                      </div>
                      <div className="whitespace-pre-wrap break-words">{m.body}</div>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="border-t p-2 flex gap-2 items-end bg-white">
              <Textarea value={text} onChange={(e) => setText(e.target.value)}
                placeholder={thread === "private" ? "Message the coordinator privately…" : "Message the group…"} rows={2} className="resize-none"
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); if (text.trim()) mut.mutate(text.trim()); } }}
              />
              <Button size="icon" onClick={() => text.trim() && mut.mutate(text.trim())} disabled={mut.isPending || !text.trim()}>
                <Send className="h-4 w-4" />
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/* ---------------- Rebook / follow-up ---------------- */

function RebookPanel({ token, deviceId, lastFrom, lastTo }: {
  token: string; deviceId: string; lastFrom: string; lastTo: string;
}) {
  const fn = useServerFn(requestClientFollowUp);
  const today = new Date().toISOString().slice(0, 10);
  const [from, setFrom] = useState(lastTo);
  const [to, setTo] = useState(lastFrom);
  const [date, setDate] = useState(today);
  const [time, setTime] = useState("09:00");
  const [notes, setNotes] = useState("");
  const mut = useMutation({
    mutationFn: () => fn({ data: { token, device_id: deviceId, from_location: from, to_location: to, date, time, notes: notes || undefined } }),
    onSuccess: () => {
      toast.success("Request sent — the coordinator will confirm");
      setNotes("");
    },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <div className="p-4">
      <div className="rounded-2xl bg-white border shadow-sm p-4">
        <h2 className="font-semibold mb-1 flex items-center gap-2"><CalendarPlus className="h-4 w-4 text-teal-700" /> Book another transfer</h2>
        <p className="text-xs text-muted-foreground mb-3">Sent to your coordinator as a pending request.</p>
        <div className="grid gap-3">
          <div><Label className="text-xs">From</Label><Input value={from} onChange={(e) => setFrom(e.target.value)} /></div>
          <div><Label className="text-xs">To</Label><Input value={to} onChange={(e) => setTo(e.target.value)} /></div>
          <div className="grid grid-cols-2 gap-2">
            <div><Label className="text-xs">Date</Label><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
            <div><Label className="text-xs">Time</Label><Input type="time" value={time} onChange={(e) => setTime(e.target.value)} /></div>
          </div>
          <div><Label className="text-xs">Notes</Label><Textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Pickup location details, luggage, etc." /></div>
          <Button onClick={() => mut.mutate()} disabled={mut.isPending || !from || !to}>
            <Plus className="h-4 w-4 mr-2" /> Send request
          </Button>
        </div>
      </div>
    </div>
  );
}

function ClientTripMap({ driver, pickup, dropoff }: {
  driver: { lat: number; lng: number; name: string };
  pickup: string;
  dropoff: string;
}) {
  // In-app map (embed — no external Google Maps app opens).
  // Uses the classic embed URL which does not require an API key.
  const src = `https://maps.google.com/maps?q=${driver.lat},${driver.lng}&z=14&output=embed`;
  const directionsSrc = `https://maps.google.com/maps?saddr=${encodeURIComponent(pickup)}&daddr=${encodeURIComponent(dropoff)}&output=embed`;
  const [showRoute, setShowRoute] = useState(false);
  return (
    <div className="mt-3 rounded-xl overflow-hidden border border-slate-200 bg-white">
      <div className="flex items-center justify-between px-3 py-2 bg-slate-50 border-b">
        <div className="flex items-center gap-2 text-xs text-slate-600">
          <MapPin className="h-3.5 w-3.5 text-teal-700" /> {driver.name}'s live location
        </div>
        <button
          type="button"
          onClick={() => setShowRoute((v) => !v)}
          className="text-xs font-medium text-teal-700 hover:underline"
        >
          {showRoute ? "Show driver" : "Show trip route"}
        </button>
      </div>
      <iframe
        key={showRoute ? "route" : "driver"}
        title="Trip map"
        src={showRoute ? directionsSrc : src}
        className="w-full h-64 border-0"
        loading="lazy"
        referrerPolicy="no-referrer-when-downgrade"
        allowFullScreen
      />
    </div>
  );
}

