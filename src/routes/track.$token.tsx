import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { PastTripsCard } from "@/components/client/PastTripsCard";
import { AddressAutocomplete, type AddressPick } from "@/components/address/AddressAutocomplete";
import { toast } from "sonner";
import { Phone, MessageCircle, Car } from "lucide-react";
import { loadGoogleMaps } from "@/lib/load-google-maps";


/**
 * Public passenger tracking page. Hotel-branded, coordinator invisible.
 * Chat and location share require verification (last-4 or booking ref).
 */
export const Route = createFileRoute("/track/$token")({
  ssr: false,
  head: () => ({ meta: [
    { title: "Trip tracking" },
    { name: "robots", content: "noindex" },
  ] }),
  component: TrackPage,
});

type Boot = {
  brand: { name: string; logo_url: string | null; brand_color: string | null } | null;
  status: string;
  pickup_at: string | null;
  from: string;
  to: string;
  driver: { first_name: string; vehicle: string | null; plate: string | null } | null;
  support_phone: string | null;
  show_driver_location: boolean;
  waiting: boolean;
  edits_locked: boolean;
  has_portal_booking: boolean;
  passenger?: { name: string } | null;
  history?: Array<{ id: string; when: string | null; from: string | null; to: string | null; status: string; driver_name?: string | null; vehicle?: string | null; plate?: string | null }>;

};


const STAGES = ["pending", "confirmed", "assigned", "en_route", "arrived", "in_progress", "completed"] as const;
const STAGE_LABELS: Record<string, string> = {
  pending: "Requested", confirmed: "Confirmed", assigned: "Driver assigned",
  en_route: "En route", arrived: "Arrived", in_progress: "On trip", completed: "Completed",
};

function TrackPage() {
  const { token } = Route.useParams();
  const [boot, setBoot] = useState<Boot | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [jwt, setJwt] = useState<string | null>(null);

  useEffect(() => {
    let loaded = false;
    const load = async () => {
      try {
        const response = await fetch(`/api/public/track/${token}/`);
        if (!response.ok) {
          if (!loaded) setErr("This tracking link is unavailable.");
          return;
        }
        loaded = true;
        setErr(null);
        setBoot(await response.json());
      } catch {
        if (!loaded) setErr("This tracking link is unavailable.");
      }
    };
    load();
    const refresh = window.setInterval(load, 30_000);
    setJwt(sessionStorage.getItem(`pax_jwt_${token}`));
    return () => window.clearInterval(refresh);
  }, [token]);

  if (err) return <div className="min-h-screen grid place-items-center p-8 text-center"><p>{err}</p></div>;
  if (!boot) return <div className="p-8 text-sm text-muted-foreground">Loading…</div>;

  const brand = boot.brand?.brand_color || "#0f172a";
  const brandName = boot.brand?.name || "Reception";

  return (
    <div className="min-h-screen" style={{ backgroundColor: "#fafafa" }}>
      <header className="p-4 flex items-center gap-3" style={{ borderBottom: `2px solid ${brand}` }}>
        {boot.brand?.logo_url ? (
          <img src={boot.brand.logo_url} alt="" className="h-12 w-12 rounded object-contain bg-white" />
        ) : (
          <div className="h-12 w-12 rounded" style={{ background: brand }} />
        )}
        <div>
          <div className="font-semibold">{brandName}</div>
          <div className="text-xs text-muted-foreground">Your trip</div>
        </div>
      </header>

      <main className="max-w-lg mx-auto p-4 space-y-4">
        {boot.passenger && (
          <Card>
            <CardContent className="p-4">
              <div className="text-xs text-muted-foreground">Passenger</div>
              <div className="font-medium">{boot.passenger.name}</div>
            </CardContent>
          </Card>
        )}

        {boot.support_phone && (
          <Card className="border-emerald-200 bg-emerald-50">
            <CardContent className="flex items-center justify-between gap-3 p-4">
              <div>
                <div className="text-xs font-semibold uppercase text-emerald-800">24/7 trip support</div>
                <div className="mt-1 font-medium text-emerald-950">{boot.support_phone}</div>
              </div>
              <a href={`tel:${boot.support_phone}`}>
                <Button size="sm" className="bg-emerald-700 hover:bg-emerald-800">
                  <Phone className="mr-1.5 h-4 w-4" /> Call
                </Button>
              </a>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground">From</div>
            <div className="font-medium">{boot.from}</div>
            <div className="text-xs text-muted-foreground mt-2">To</div>
            <div className="font-medium">{boot.to}</div>
            {boot.pickup_at && (
              <div className="text-xs mt-2">Pickup: {new Date(boot.pickup_at).toLocaleString()}</div>
            )}
          </CardContent>
        </Card>

        <StatusTimeline current={boot.status} accent={brand} />

        {boot.waiting && (
          <Card className="border-amber-300 bg-amber-50">
            <CardContent className="p-4 flex items-center gap-2">
              <Car className="h-5 w-5 text-amber-700 shrink-0" />
              <div className="text-sm font-medium text-amber-900">Your driver has arrived and is waiting for you.</div>
            </CardContent>
          </Card>
        )}

        {boot.driver && (
          <Card>
            <CardContent className="p-4">
              <div className="text-xs text-muted-foreground">Your driver</div>
              <div className="font-medium">{boot.driver.first_name}</div>
              {boot.driver.vehicle && <div className="text-sm">{boot.driver.vehicle} · {boot.driver.plate}</div>}
              {jwt ? (
                <DriverMap token={token} jwt={jwt} />
              ) : (
                <div className="text-xs text-muted-foreground mt-2">Verify below to see the live map and share/request location.</div>
              )}
            </CardContent>
          </Card>
        )}

        <PastTripsCard trips={(boot as any).history ?? []} />


        {!jwt ? (
          <VerifyBox token={token} onVerified={setJwt} brandName={brandName} />
        ) : (
          <>
            <TripActionsBox token={token} jwt={jwt} boot={boot} onChanged={() => { /* server is source of truth on next 30s poll */ }} />
            <ChatBox token={token} jwt={jwt} brandName={brandName} accent={brand} />
            <DriverChatBox token={token} jwt={jwt} hasDriver={!!boot.driver} />
            <LocationBox token={token} jwt={jwt} initialShowDriver={boot.show_driver_location} />
          </>
        )}

        <p className="text-[10px] text-muted-foreground text-center pt-4">Powered by {brandName}</p>
      </main>
    </div>
  );
}

function DriverMap({ token, jwt }: { token: string; jwt: string }) {
  const mapDivRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<any>(null);
  const markerRef = useRef<any>(null);
  const [state, setState] = useState<{ enabled: boolean; point: any | null; error: boolean }>({ enabled: false, point: null, error: false });

  useEffect(() => {
    let stopped = false;
    async function poll() {
      try {
        const r = await fetch(`/api/public/track/${token}/location`, { headers: { Authorization: `Bearer ${jwt}` } });
        if (!r.ok) return;
        const j = await r.json();
        if (stopped) return;
        setState({ enabled: !!j.show_driver_location, point: j.driver ?? null, error: false });
      } catch {
        if (!stopped) setState((s) => ({ ...s, error: true }));
      }
    }
    poll();
    const t = window.setInterval(poll, 15_000);
    return () => { stopped = true; window.clearInterval(t); };
  }, [token, jwt]);

  useEffect(() => {
    if (!state.enabled || !state.point || !mapDivRef.current) return;
    let cancelled = false;
    loadGoogleMaps().then((maps) => {
      if (cancelled || !mapDivRef.current) return;
      const pos = { lat: state.point.latitude, lng: state.point.longitude };
      if (!mapRef.current) {
        mapRef.current = new maps.Map(mapDivRef.current, { center: pos, zoom: 14, disableDefaultUI: true, zoomControl: true });
        markerRef.current = new maps.Marker({ position: pos, map: mapRef.current, title: "Driver" });
      } else {
        mapRef.current.panTo(pos);
        markerRef.current.setPosition(pos);
      }
    }).catch(() => setState((s) => ({ ...s, error: true })));
    return () => { cancelled = true; };
  }, [state.enabled, state.point]);

  if (!state.enabled) {
    return <div className="text-xs text-muted-foreground mt-2">Live map is off for your privacy. Turn on "Show driver's location to me" below to see it.</div>;
  }
  if (state.error) {
    return <div className="text-xs text-muted-foreground mt-2">Map unavailable right now.</div>;
  }
  if (!state.point) {
    return <div className="text-xs text-muted-foreground mt-2">Waiting for the driver's location…</div>;
  }
  return (
    <div className="mt-2">
      <div ref={mapDivRef} className="h-48 w-full rounded border" />
      <div className="text-[10px] text-muted-foreground mt-1">Updated {new Date(state.point.captured_at).toLocaleTimeString()}</div>
    </div>
  );
}

function TripActionsBox({ token, jwt, boot, onChanged }: { token: string; jwt: string; boot: Boot; onChanged: () => void }) {
  const [mode, setMode] = useState<"none" | "edit" | "rebook">("none");
  if (!boot.has_portal_booking) return null;

  return (
    <Card>
      <CardContent className="p-4 space-y-2">
        <div className="text-sm font-medium">Manage your trip</div>
        {boot.edits_locked ? (
          <p className="text-xs text-muted-foreground">
            This trip is within 3 hours of pickup and can no longer be changed here. Please call {boot.support_phone ?? "reception"} if something urgent has come up.
          </p>
        ) : (
          <div className="flex gap-2 flex-wrap">
            <Button size="sm" variant="outline" onClick={() => setMode(mode === "edit" ? "none" : "edit")}>Edit / reschedule</Button>
            <Button size="sm" variant="outline" onClick={() => setMode(mode === "rebook" ? "none" : "rebook")}>Book another trip</Button>
          </div>
        )}
        {mode === "edit" && !boot.edits_locked && (
          <ClientChangeRequestForm token={token} jwt={jwt} boot={boot} onDone={() => { setMode("none"); onChanged(); }} />
        )}
        {mode === "rebook" && !boot.edits_locked && (
          <ClientRebookForm token={token} jwt={jwt} onDone={() => { setMode("none"); onChanged(); }} />
        )}
        <p className="text-[10px] text-muted-foreground">Every request needs {boot.brand?.name ?? "our team"}'s approval before it's confirmed — it won't reach the driver until then.</p>
      </CardContent>
    </Card>
  );
}

function ClientChangeRequestForm({ token, jwt, boot, onDone }: { token: string; jwt: string; boot: Boot; onDone: () => void }) {
  const [fromPick, setFromPick] = useState<AddressPick>({ address: boot.from ?? "", place_id: null, lat: null, lng: null });
  const [toPick, setToPick] = useState<AddressPick>({ address: boot.to ?? "", place_id: null, lat: null, lng: null });
  const [pickupAt, setPickupAt] = useState(boot.pickup_at ? new Date(boot.pickup_at).toISOString().slice(0, 16) : "");
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    try {
      const r = await fetch(`/api/public/track/${token}/change-requests`, {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${jwt}` },
        body: JSON.stringify({
          kind: "reschedule",
          requested_changes: {
            from_location: fromPick.address, from_lat: fromPick.lat, from_lng: fromPick.lng,
            to_location: toPick.address, to_lat: toPick.lat, to_lng: toPick.lng,
            pickup_at: pickupAt ? new Date(pickupAt).toISOString() : null,
          },
        }),
      });
      if (r.status === 409) { toast.error("Too close to pickup time to change — please call for urgent changes."); return; }
      if (!r.ok) { toast.error("Failed to submit request"); return; }
      toast.success("Change requested — awaiting approval");
      onDone();
    } finally {
      setBusy(false);
    }
  }
  async function cancelTrip() {
    if (!confirm("Request cancellation of this trip?")) return;
    setBusy(true);
    try {
      const r = await fetch(`/api/public/track/${token}/change-requests`, {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${jwt}` },
        body: JSON.stringify({ kind: "cancel" }),
      });
      if (r.status === 409) { toast.error("Too close to pickup time to cancel — please call."); return; }
      if (!r.ok) { toast.error("Failed to submit request"); return; }
      toast.success("Cancellation requested — awaiting approval");
      onDone();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2 border rounded p-3">
      <Field label="From"><AddressAutocomplete publicToken={token} value={fromPick.address} placeId={fromPick.place_id} onChange={setFromPick} /></Field>
      <Field label="To"><AddressAutocomplete publicToken={token} value={toPick.address} placeId={toPick.place_id} onChange={setToPick} /></Field>
      <Field label="Pickup date & time"><Input type="datetime-local" value={pickupAt} onChange={(e) => setPickupAt(e.target.value)} /></Field>
      <div className="flex gap-2 justify-end">
        <Button size="sm" variant="ghost" className="text-destructive" onClick={cancelTrip} disabled={busy}>Cancel trip</Button>
        <Button size="sm" onClick={submit} disabled={busy}>Submit request</Button>
      </div>
    </div>
  );
}

function ClientRebookForm({ token, jwt, onDone }: { token: string; jwt: string; onDone: () => void }) {
  const [fromPick, setFromPick] = useState<AddressPick>({ address: "", place_id: null, lat: null, lng: null });
  const [toPick, setToPick] = useState<AddressPick>({ address: "", place_id: null, lat: null, lng: null });
  const [pickupAt, setPickupAt] = useState("");
  const [paxCount, setPaxCount] = useState("1");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!fromPick.address || !toPick.address) { toast.error("Please fill in From and To"); return; }
    setBusy(true);
    try {
      const r = await fetch(`/api/public/track/${token}/rebook`, {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${jwt}` },
        body: JSON.stringify({
          from_location: fromPick.address, to_location: toPick.address,
          pickup_at: pickupAt ? new Date(pickupAt).toISOString() : null,
          pax_count: Number(paxCount) || 1, notes: notes.trim() || null,
        }),
      });
      if (!r.ok) { toast.error("Failed to submit request"); return; }
      toast.success("New trip requested — awaiting approval");
      onDone();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2 border rounded p-3">
      <Field label="From"><AddressAutocomplete publicToken={token} value={fromPick.address} placeId={fromPick.place_id} onChange={setFromPick} /></Field>
      <Field label="To"><AddressAutocomplete publicToken={token} value={toPick.address} placeId={toPick.place_id} onChange={setToPick} /></Field>
      <Field label="Pickup date & time"><Input type="datetime-local" value={pickupAt} onChange={(e) => setPickupAt(e.target.value)} /></Field>
      <Field label="Pax"><Input type="number" min={1} value={paxCount} onChange={(e) => setPaxCount(e.target.value)} /></Field>
      <Field label="Notes"><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
      <div className="flex justify-end">
        <Button size="sm" onClick={submit} disabled={busy}>Request trip</Button>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (<div><Label className="text-xs">{label}</Label>{children}</div>);
}

function DriverChatBox({ token, jwt, hasDriver }: { token: string; jwt: string; hasDriver: boolean }) {
  const [msgs, setMsgs] = useState<any[]>([]);
  const [text, setText] = useState("");
  async function load() {
    const r = await fetch(`/api/public/track/${token}/driver-messages`, { headers: { Authorization: `Bearer ${jwt}` } });
    if (r.ok) setMsgs((await r.json()).messages ?? []);
  }
  useEffect(() => { load(); const t = setInterval(load, 8000); return () => clearInterval(t); }, [token, jwt]);
  async function send() {
    if (!text.trim()) return;
    const r = await fetch(`/api/public/track/${token}/driver-messages`, {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${jwt}` },
      body: JSON.stringify({ body: text.trim() }),
    });
    if (r.status === 409) { toast.error("No driver assigned to this trip yet"); return; }
    if (!r.ok) { toast.error("Send failed"); return; }
    setText(""); load();
  }
  return (
    <Card><CardContent className="p-4">
      <div className="text-sm font-medium mb-1 flex items-center gap-1.5"><MessageCircle className="h-4 w-4" /> Message your driver</div>
      <p className="text-[10px] text-muted-foreground mb-2">Messages aren't instant — if it's urgent, please call instead.</p>
      {!hasDriver && <p className="text-xs text-muted-foreground mb-2">No driver assigned yet — you can still leave a message, they'll see it once assigned.</p>}
      <div className="h-40 overflow-auto space-y-2 border rounded p-2 bg-white">
        {msgs.length === 0 && <p className="text-xs text-muted-foreground">No messages yet.</p>}
        {msgs.map((m, i) => (
          <div key={i} className={`text-sm ${m.sender_kind === "client" ? "text-right" : ""}`}>
            <div className="text-[10px] text-muted-foreground">{m.sender_label} · {new Date(m.created_at).toLocaleTimeString()}</div>
            <div className="inline-block bg-muted rounded px-2 py-1 max-w-[85%]">{m.body}</div>
          </div>
        ))}
      </div>
      <div className="flex gap-2 mt-2">
        <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="Message your driver…" onKeyDown={(e) => e.key === "Enter" && send()} />
        <Button onClick={send}>Send</Button>
      </div>
    </CardContent></Card>
  );
}

function StatusTimeline({ current, accent }: { current: string; accent: string }) {
  const idx = Math.max(0, STAGES.findIndex((s) => s === current));
  return (
    <Card><CardContent className="p-4 space-y-2">
      {STAGES.map((s, i) => (
        <div key={s} className="flex items-center gap-2 text-sm">
          <div className={`h-3 w-3 rounded-full ${i <= idx ? "" : "bg-muted"}`} style={i <= idx ? { background: accent } : {}} />
          <span className={i === idx ? "font-semibold" : i < idx ? "" : "text-muted-foreground"}>{STAGE_LABELS[s]}</span>
        </div>
      ))}
    </CardContent></Card>
  );
}

function VerifyBox({ token, onVerified, brandName }: { token: string; onVerified: (jwt: string) => void; brandName: string }) {
  const [last4, setLast4] = useState("");
  const [ref, setRef] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit() {
    setBusy(true);
    const r = await fetch(`/api/public/track/${token}/verify`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        phone_last4: last4.length === 4 ? last4 : undefined,
        booking_ref: ref.length >= 4 ? ref : undefined,
      }),
    });
    setBusy(false);
    if (!r.ok) { toast.error("Could not verify"); return; }
    const j = await r.json();
    sessionStorage.setItem(`pax_jwt_${token}`, j.jwt);
    onVerified(j.jwt);
    toast.success("Verified");
  }
  return (
    <Card><CardContent className="p-4 space-y-2">
      <div className="text-sm font-medium">Message {brandName}</div>
      <p className="text-xs text-muted-foreground">Enter the last 4 digits of your phone number OR your booking reference to open chat.</p>
      <div className="grid grid-cols-2 gap-2">
        <Input placeholder="Last 4 of phone" value={last4} onChange={(e) => setLast4(e.target.value.replace(/\D/g, "").slice(0, 4))} />
        <Input placeholder="Booking ref" value={ref} onChange={(e) => setRef(e.target.value)} />
      </div>
      <Button onClick={submit} disabled={busy || (last4.length !== 4 && ref.length < 4)} className="w-full">Continue</Button>
    </CardContent></Card>
  );
}

function ChatBox({ token, jwt, brandName, accent }: { token: string; jwt: string; brandName: string; accent: string }) {
  const [msgs, setMsgs] = useState<any[]>([]);
  const [text, setText] = useState("");
  async function load() {
    const r = await fetch(`/api/public/track/${token}/messages`, { headers: { Authorization: `Bearer ${jwt}` } });
    if (r.ok) setMsgs((await r.json()).messages ?? []);
  }
  useEffect(() => { load(); const t = setInterval(load, 5000); return () => clearInterval(t); }, [token, jwt]);
  async function send() {
    if (!text.trim()) return;
    const r = await fetch(`/api/public/track/${token}/messages`, {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${jwt}` },
      body: JSON.stringify({ body: text.trim() }),
    });
    if (!r.ok) { toast.error("Send failed"); return; }
    setText(""); load();
  }
  return (
    <Card><CardContent className="p-4">
      <div className="text-sm font-medium mb-1" style={{ color: accent }}>Message {brandName} Reception</div>
      <p className="text-[10px] text-muted-foreground mb-2">Messages aren't instant — if it's urgent, please call {brandName} directly.</p>
      <div className="h-56 overflow-auto space-y-2 border rounded p-2 bg-white">
        {msgs.length === 0 && <p className="text-xs text-muted-foreground">No messages yet.</p>}
        {msgs.map((m, i) => (
          <div key={i} className={`text-sm ${m.sender_role === "passenger" ? "text-right" : ""}`}>
            <div className="text-[10px] text-muted-foreground">{m.sender_label} · {new Date(m.created_at).toLocaleTimeString()}</div>
            <div className="inline-block bg-muted rounded px-2 py-1 max-w-[85%]">{m.body}</div>
          </div>
        ))}
      </div>
      <div className="flex gap-2 mt-2">
        <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="Message…" onKeyDown={(e) => e.key === "Enter" && send()} />
        <Button onClick={send} style={{ background: accent }}>Send</Button>
      </div>
    </CardContent></Card>
  );
}

function LocationBox({ token, jwt, initialShowDriver }: { token: string; jwt: string; initialShowDriver?: boolean }) {
  const [shareOwn, setShareOwn] = useState(false);
  const [showDriver, setShowDriver] = useState(!!initialShowDriver);
  async function toggleOwn() {
    if (!("geolocation" in navigator)) { toast.error("Location not supported"); return; }
    if (!shareOwn) {
      navigator.geolocation.getCurrentPosition(async (pos) => {
        await fetch(`/api/public/track/${token}/location`, {
          method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${jwt}` },
          body: JSON.stringify({ share_own: true, lat: pos.coords.latitude, lng: pos.coords.longitude }),
        });
        setShareOwn(true);
        toast.success("Location shared with driver");
      }, () => toast.error("Location denied"));
    } else {
      await fetch(`/api/public/track/${token}/location`, {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${jwt}` },
        body: JSON.stringify({ share_own: false }),
      });
      setShareOwn(false);
      toast.success("Location sharing stopped");
    }
  }
  async function toggleDriver() {
    await fetch(`/api/public/track/${token}/location`, {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${jwt}` },
      body: JSON.stringify({ show_driver: !showDriver }),
    });
    setShowDriver(!showDriver);
  }
  return (
    <Card><CardContent className="p-4 space-y-2">
      <div className="text-sm font-medium">Privacy</div>
      <div className="flex items-center justify-between text-sm">
        <span>Share my location with the driver</span>
        <Button size="sm" variant={shareOwn ? "default" : "outline"} onClick={toggleOwn}>{shareOwn ? "On" : "Off"}</Button>
      </div>
      <div className="flex items-center justify-between text-sm">
        <span>Show driver's location to me</span>
        <Button size="sm" variant={showDriver ? "default" : "outline"} onClick={toggleDriver}>{showDriver ? "On" : "Off"}</Button>
      </div>
      <p className="text-[10px] text-muted-foreground">Both off by default. You can turn them off anytime.</p>
    </CardContent></Card>
  );
}
