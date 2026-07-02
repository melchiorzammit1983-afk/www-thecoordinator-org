import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  MapPin, Send, MessageSquare, Plus, LocateFixed, Share2, Phone, Loader2, CalendarPlus, CheckCircle2,
} from "lucide-react";
import {
  getClientTripPortal, chooseClientIdentity, listClientTripMessages,
  postClientTripMessage, pushClientLocation, requestClientFollowUp,
  confirmClientTrip, heartbeatClientPortal,
} from "@/lib/coordinator-public.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { TripProgress } from "@/components/coordinator/TripProgress";
import { cn } from "@/lib/utils";

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

function ClientTripPortal() {
  const { token } = Route.useParams();
  const deviceId = useMemo(() => getDeviceId(), []);
  const qc = useQueryClient();

  const portalFn = useServerFn(getClientTripPortal);
  const { data, isLoading, error } = useQuery({
    queryKey: ["client-portal", token, deviceId],
    queryFn: () => portalFn({ data: { token, device_id: deviceId } }),
    refetchInterval: 15_000,
  });

  const [tab, setTab] = useState<"trip" | "chat" | "rebook">("trip");

  if (isLoading) {
    return <div className="min-h-screen grid place-items-center bg-slate-50">
      <Loader2 className="h-6 w-6 animate-spin text-slate-500" />
    </div>;
  }
  if (error || !data) {
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

  const needsIdentity = !data.identity && (data.pax?.length ?? 0) > 1;

  return (
    <div className="min-h-screen bg-slate-50 pb-24">
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
        {data.identity?.pax_name && (
          <div className="mt-2 inline-flex items-center gap-1 rounded-full bg-white/15 px-2.5 py-0.5 text-xs">
            Signed in as <b className="ml-1">{data.identity.pax_name}</b>
          </div>
        )}
      </header>

      {needsIdentity && <IdentityPicker token={token} deviceId={deviceId} pax={data.pax} onDone={() => qc.invalidateQueries({ queryKey: ["client-portal"] })} />}

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
            {job.flight_status && job.flight_status !== "on_time" && (
              <div className="mt-3 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-800">
                Flight status: {job.flight_status}
              </div>
            )}
          </section>

          {/* Driver + tracking */}
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
            {data.driverLocations?.[0] && (
              <a
                className="mt-3 flex items-center justify-center gap-2 rounded-lg bg-teal-700 text-white py-2.5 text-sm font-medium"
                href={`https://www.google.com/maps/search/?api=1&query=${data.driverLocations[0].latitude},${data.driverLocations[0].longitude}`}
                target="_blank" rel="noreferrer"
              >
                <MapPin className="h-4 w-4" /> Track driver on Google Maps
              </a>
            )}
          </section>

          {/* Share my location */}
          <ShareLocation token={token} deviceId={deviceId} />

          {/* Group siblings */}
          {(data.siblings?.length ?? 0) > 1 && (
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
        </div>
      )}

      {tab === "chat" && (
        <ChatPanel token={token} deviceId={deviceId} driverAssigned={!!driver} />
      )}
      {tab === "rebook" && (
        <RebookPanel token={token} deviceId={deviceId} lastFrom={job.from_location ?? ""} lastTo={job.to_location ?? ""} />
      )}
    </div>
  );
}

/* ---------------- Identity picker ---------------- */

function IdentityPicker({ token, deviceId, pax, onDone }: {
  token: string; deviceId: string; pax: any[]; onDone: () => void;
}) {
  const chooseFn = useServerFn(chooseClientIdentity);
  const mut = useMutation({
    mutationFn: (p: { pax_id: string | null; pax_name: string }) =>
      chooseFn({ data: { token, device_id: deviceId, pax_id: p.pax_id, pax_name: p.pax_name } }),
    onSuccess: () => onDone(),
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <div className="p-4">
      <div className="rounded-2xl bg-white border p-4 shadow-sm">
        <h2 className="font-semibold mb-1">Which passenger are you?</h2>
        <p className="text-xs text-muted-foreground mb-3">This is remembered on your device.</p>
        <div className="grid gap-2">
          {pax.map((p) => (
            <Button key={p.id} variant="outline" className="justify-start"
              onClick={() => mut.mutate({ pax_id: p.id, pax_name: p.name })}>
              {p.name}
            </Button>
          ))}
        </div>
      </div>
    </div>
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

/* ---------------- Chat ---------------- */

function ChatPanel({ token, deviceId, driverAssigned }: {
  token: string; deviceId: string; driverAssigned: boolean;
}) {
  const listFn = useServerFn(listClientTripMessages);
  const postFn = useServerFn(postClientTripMessage);
  const [text, setText] = useState("");
  const qc = useQueryClient();
  const key = ["client-chat", token];
  const { data: messages } = useQuery({
    queryKey: key,
    queryFn: () => listFn({ data: { token } }) as Promise<any[]>,
    refetchInterval: 8_000,
  });
  const scrollRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages]);

  const mut = useMutation({
    mutationFn: (body: string) => postFn({ data: { token, device_id: deviceId, body } }),
    onSuccess: () => { setText(""); qc.invalidateQueries({ queryKey: key }); },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="p-4">
      <div className="rounded-2xl bg-white border shadow-sm overflow-hidden flex flex-col h-[70vh]">
        {!driverAssigned && (
          <div className="bg-sky-50 border-b text-xs text-sky-800 px-3 py-2">
            You're chatting with the coordinator. The driver will join here once assigned.
          </div>
        )}
        <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 space-y-2 bg-slate-50">
          {(messages ?? []).length === 0 && (
            <p className="text-center text-xs text-muted-foreground py-8">No messages yet. Say hello!</p>
          )}
          {(messages ?? []).map((m: any) => {
            const mine = m.sender_kind === "client";
            return (
              <div key={m.id} className={cn("flex", mine ? "justify-end" : "justify-start")}>
                <div className={cn("rounded-2xl px-3 py-2 max-w-[80%] text-sm shadow-sm",
                  mine ? "bg-teal-700 text-white rounded-br-sm"
                       : m.sender_kind === "driver" ? "bg-emerald-50 border border-emerald-200 rounded-bl-sm"
                       : "bg-white border rounded-bl-sm")}>
                  <div className={cn("text-[10px] uppercase tracking-wide mb-0.5",
                    mine ? "opacity-70" : "text-muted-foreground")}>
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
            placeholder="Type a message…" rows={2} className="resize-none"
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); if (text.trim()) mut.mutate(text.trim()); } }}
          />
          <Button size="icon" onClick={() => text.trim() && mut.mutate(text.trim())} disabled={mut.isPending || !text.trim()}>
            <Send className="h-4 w-4" />
          </Button>
        </div>
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
