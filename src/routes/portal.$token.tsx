import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { toast } from "sonner";
import { HotelManagePanel } from "@/components/portal/HotelManagePanel";
import { BulkBookingGrid } from "@/components/portal/BulkBookingGrid";
import { AddressAutocomplete, type AddressPick } from "@/components/address/AddressAutocomplete";
import { TokenPortPicker, type TokenPort } from "@/components/address/TokenPortPicker";
import { TokenShipPicker, type TokenShip } from "@/components/address/TokenShipPicker";
import { classifyProviderEndpoint } from "@/lib/journey-resolver";
import { flightFormatWarning } from "@/lib/flight-code";
import { AlertTriangle, Download, LockKeyhole } from "lucide-react";
import { downloadBookingsStatusExcel, downloadBookingsStatusCsv } from "@/lib/booking-sheet-template";
import { splitPaxNames } from "@/lib/split-pax-names";
import { loadGoogleMaps } from "@/lib/load-google-maps";
import { formatEta } from "@/lib/trip-display";
import { OperationsWorkspace } from "@/components/portal/OperationsWorkspace";

export const Route = createFileRoute("/portal/$token")({
  ssr: false,
  head: () => ({ meta: [
    { title: "Company Portal" },
    { name: "robots", content: "noindex" },
  ] }),
  component: PortalPage,
});

const PORTAL_KIND_LABELS: Record<string, string> = {
  hotel: "Hotel",
  agent: "Agent",
  company_agent: "Company/Agent",
};
function portalKindLabel(kind: string): string {
  return PORTAL_KIND_LABELS[kind] ?? kind;
}

// Trimmed local copy of the coordinator's event palette — portal only ever
// sees the movement/boarding subset the trip-location endpoint returns
// (server-side allowlist), and deliberately doesn't import the coordinator's
// TripEventsMap metadata (that file pulls in pin-editing machinery that must
// stay coordinator-only).
const PORTAL_EVENT_META: Record<string, { label: string; color: string }> = {
  en_route: { label: "On the way", color: "#0ea5e9" },
  arrived_pickup: { label: "Arrived at pickup", color: "#22c55e" },
  in_progress: { label: "Passenger on board", color: "#3b82f6" },
  completed: { label: "Trip completed", color: "#8b5cf6" },
  actual_dropoff: { label: "Actual drop-off", color: "#ef4444" },
  pax_boarded: { label: "Passenger boarded", color: "#16a34a" },
  boarding_approved: { label: "Boarding approved", color: "#22c55e" },
  boarding_rejected: { label: "Boarding rejected", color: "#dc2626" },
  pax_no_show: { label: "Passenger no-show", color: "#94a3b8" },
  pax_cancelled: { label: "Passenger cancelled", color: "#94a3b8" },
};

function isFinishedJob(job: any): boolean {
  return job?.status === "completed" || job?.status === "cancelled";
}

// Local duplicate of the stage list used on the passenger tracking page
// (src/routes/track.$token.tsx) — trimmed to the stages a portal-accepted
// trip (job already created) can actually be in.
const TRIP_STAGES = ["active", "en_route", "arrived", "in_progress", "completed"] as const;
const TRIP_STAGE_LABELS: Record<string, string> = {
  active: "Confirmed", en_route: "En route", arrived: "Arrived", in_progress: "On trip", completed: "Completed",
};

function TripStatusTimeline({ current }: { current: string | undefined }) {
  if (current === "cancelled") {
    return <div className="text-xs font-medium text-muted-foreground">Trip cancelled</div>;
  }
  const idx = Math.max(0, TRIP_STAGES.findIndex((s) => s === current));
  return (
    <div className="space-y-1">
      {TRIP_STAGES.map((s, i) => (
        <div key={s} className="flex items-center gap-2 text-xs">
          <div className={`h-2 w-2 rounded-full ${i <= idx ? "bg-primary" : "bg-muted"}`} />
          <span className={i === idx ? "font-semibold" : i < idx ? "" : "text-muted-foreground"}>{TRIP_STAGE_LABELS[s]}</span>
        </div>
      ))}
    </div>
  );
}

type Boot = {
  portal: {
    id: string; name: string; kind: string; logo_url: string | null;
    brand_color: string | null; display_name_for_passenger: string;
    link_expires_at: string | null; template_name: string | null;
    configuration: { capabilities?: Record<string, boolean> } | null;
  };
  bookings: any[];
  jobs: any[];
  operation_groups: Array<{ id: string; reference: string; name: string; status: string }>;
};

function PortalPage() {
  const { token } = Route.useParams();
  const [boot, setBoot] = useState<Boot | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [accessMode, setAccessMode] = useState<"setup" | "login" | null>(null);
  const [tab, setTab] = useState<"bookings" | "operations" | "trips" | "chat" | "statement" | "manage" | "settings">("bookings");

  async function reload() {
    const r = await fetch(`/api/public/portal/${token}/`);
    if (!r.ok) {
      const e = await r.json().catch(() => ({}));
      if (r.status === 401 && (e.error === "password_setup_required" || e.error === "password_required")) {
        setAccessMode(e.error === "password_setup_required" ? "setup" : "login");
        setErr(null);
        setBoot(null);
        return;
      }
      setAccessMode(null);
      setErr(e.error || `error_${r.status}`);
      return;
    }
    setErr(null);
    setAccessMode(null);
    setBoot(await r.json());
  }
  useEffect(() => {
    reload();
    const refresh = window.setInterval(reload, 20_000);
    return () => window.clearInterval(refresh);
  }, [token]);

  const capabilities = boot?.portal.configuration?.capabilities;
  const capabilityEnabled = (key: string, fallback = true) => capabilities?.[key] ?? fallback;
  const showBookings = capabilityEnabled("create_booking") || capabilityEnabled("view_own_submissions");
  const showTrips = capabilityEnabled("view_trips");
  const showOperations = capabilityEnabled("select_operation_group", true);
  const showChat = capabilityEnabled("chat");
  const showStatements = capabilityEnabled("view_statements");
  const showManage = boot?.portal.kind === "hotel"
    && capabilityEnabled("manage_crew", !boot?.portal.configuration);
  const showSettings = capabilityEnabled("manage_profile");
  const availableTabs = [
    showBookings && "bookings", showOperations && "operations", showTrips && "trips", showChat && "chat",
    showStatements && "statement", showManage && "manage", showSettings && "settings",
  ].filter(Boolean) as Array<typeof tab>;
  const activeTab = availableTabs.includes(tab) ? tab : (availableTabs[0] ?? tab);

  if (accessMode) return <PortalPasswordDialog token={token} mode={accessMode} onAuthenticated={reload} />;
  if (err) return <OfflineCard reason={err} />;
  if (!boot) return <div className="p-8 text-sm text-muted-foreground">Loading…</div>;

  const brand = boot.portal.brand_color || "#0f172a";

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b" style={{ borderColor: brand + "33" }}>
        <div className="max-w-5xl mx-auto p-4 flex items-center gap-3">
          {boot.portal.logo_url ? (
            <img src={boot.portal.logo_url} alt="" className="h-10 w-10 rounded object-contain bg-white" />
          ) : (
            <div className="h-10 w-10 rounded" style={{ background: brand }} />
          )}
          <div>
            <div className="font-semibold">{boot.portal.name}</div>
            <div className="text-xs text-muted-foreground">{boot.portal.template_name ?? portalKindLabel(boot.portal.kind)} portal</div>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto p-4">
        <Tabs value={activeTab} onValueChange={(v) => setTab(v as any)}>
          <TabsList className="flex-wrap h-auto">
            {showBookings && <TabsTrigger value="bookings">Bookings</TabsTrigger>}
            {showOperations && <TabsTrigger value="operations">Operations</TabsTrigger>}
            {showTrips && <TabsTrigger value="trips">Trips</TabsTrigger>}
            {showChat && <TabsTrigger value="chat">Chat</TabsTrigger>}
            {showStatements && <TabsTrigger value="statement">Statement</TabsTrigger>}
            {showManage && <TabsTrigger value="manage">Manage</TabsTrigger>}
            {showSettings && <TabsTrigger value="settings">Settings</TabsTrigger>}
          </TabsList>

          {showBookings && <TabsContent value="bookings" className="mt-4 space-y-4">
            {capabilityEnabled("create_booking") && <BookingEntry token={token} kind={boot.portal.kind} operationGroups={boot.operation_groups ?? []} onCreated={reload} />}
            {capabilityEnabled("view_own_submissions") && <BookingsList bookings={boot.bookings} jobs={boot.jobs} token={token} onChanged={reload} />}
          </TabsContent>}

          {showOperations && <TabsContent value="operations" className="mt-4">
            <OperationsWorkspace mode="client" token={token} portalName={boot.portal.name} />
          </TabsContent>}

          {showTrips && <TabsContent value="trips" className="mt-4">
            <TripsList token={token} bookings={boot.bookings} jobs={boot.jobs} onChanged={reload} />
          </TabsContent>}

          {showChat && <TabsContent value="chat" className="mt-4">
            <ChatPanel token={token} bookings={boot.bookings} />
          </TabsContent>}

          {showStatements && <TabsContent value="statement" className="mt-4">
            <PortalStatementPanel token={token} />
          </TabsContent>}

          {showManage && (
            <TabsContent value="manage" className="mt-4">
              <HotelManagePanel token={token} portal={boot.portal as any} />
            </TabsContent>
          )}

          {showSettings && <TabsContent value="settings" className="mt-4 space-y-4">
            <LogoPanel token={token} portal={boot.portal} onSaved={reload} />
            <SettingsPanel token={token} portal={boot.portal} onSaved={reload} />
          </TabsContent>}
        </Tabs>
      </main>
    </div>
  );
}

function OfflineCard({ reason }: { reason: string }) {
  const msg = reason === "link_off" ? "This portal link is currently switched off."
    : reason === "link_expired" ? "This portal link has expired."
    : reason === "portal_disabled" ? "This portal is not active."
    : reason === "portal_configuration_disabled" ? "This portal configuration is not active."
    : reason === "not_found" ? "This link is not valid."
    : "This link is unavailable.";
  return (
    <div className="min-h-screen grid place-items-center p-8 text-center">
      <div>
        <h1 className="text-lg font-semibold">{msg}</h1>
        <p className="text-sm text-muted-foreground mt-2">Please contact your dispatcher for a new link.</p>
      </div>
    </div>
  );
}

function PortalPasswordDialog({ token, mode, onAuthenticated }: {
  token: string;
  mode: "setup" | "login";
  onAuthenticated: () => void;
}) {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function submit() {
    if (mode === "setup" && password !== confirmPassword) {
      setMessage("The passwords do not match.");
      return;
    }
    if (password.length < 8) {
      setMessage("Use at least 8 characters.");
      return;
    }
    setBusy(true); setMessage(null);
    try {
      const response = await fetch(`/api/public/portal/${token}/access`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: mode, password }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (payload.error === "password_already_created") {
          setMessage("A password was already created. Enter that password to continue.");
          window.setTimeout(onAuthenticated, 300); return;
        }
        if (payload.error === "password_locked") {
          const until = payload.locked_until
            ? new Date(payload.locked_until).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
            : "later";
          setMessage(`Too many attempts. Try again after ${until}.`); return;
        }
        if (payload.error === "invalid_password") {
          setMessage(`Incorrect password. ${payload.attempts_remaining ?? 0} attempts remaining.`); return;
        }
        if (payload.error === "rate_limited") {
          setMessage("Too many attempts. Wait one minute and try again."); return;
        }
        setMessage("Password access could not be completed."); return;
      }
      toast.success(mode === "setup" ? "Your portal password is ready" : "Portal unlocked");
      await onAuthenticated();
    } catch {
      setMessage("Could not connect. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return <div className="min-h-screen bg-muted/30">
    <Dialog open onOpenChange={() => undefined}>
      <DialogContent onInteractOutside={(event) => event.preventDefault()}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><LockKeyhole className="h-5 w-5" />
            {mode === "setup" ? "Create your portal password" : "Enter your portal password"}
          </DialogTitle>
          <DialogDescription>{mode === "setup"
            ? "This is your first visit. Create a private password that only your company should know. The coordinator cannot view it."
            : "This company portal is password protected."}</DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
          <div className="space-y-1.5"><Label>Password</Label>
            <Input type="password" autoComplete={mode === "setup" ? "new-password" : "current-password"}
              value={password} onChange={(event) => setPassword(event.target.value)} autoFocus />
            {mode === "setup" && <p className="text-xs text-muted-foreground">Use at least 8 characters. Do not share it in the same message as the portal link.</p>}
          </div>
          {mode === "setup" && <div className="space-y-1.5"><Label>Confirm password</Label>
            <Input type="password" autoComplete="new-password" value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)} />
          </div>}
          {message && <p className="text-sm text-destructive">{message}</p>}
          <Button className="w-full" type="submit" disabled={busy}>
            {busy ? "Please wait…" : mode === "setup" ? "Create password & open portal" : "Open portal"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  </div>;
}

function BookingEntry({ token, kind, operationGroups, onCreated }: { token: string; kind: string; operationGroups: Boot["operation_groups"]; onCreated: () => void }) {
  const [view, setView] = useState<"grid" | "single">("grid");
  if (kind !== "company_agent") return <NewBookingForm token={token} operationGroups={operationGroups} onCreated={onCreated} />;
  return (
    <div className="space-y-2">
      <div className="flex justify-end">
        <Button variant="ghost" size="sm" onClick={() => setView(view === "grid" ? "single" : "grid")}>
          {view === "grid" ? "Switch to single-entry form" : "Switch to bulk grid"}
        </Button>
      </div>
      {view === "grid"
        ? <BulkBookingGrid token={token} operationGroups={operationGroups} onCreated={onCreated} />
        : <NewBookingForm token={token} operationGroups={operationGroups} onCreated={onCreated} />}
    </div>
  );
}

function NewBookingForm({ token, operationGroups, onCreated }: { token: string; operationGroups: Boot["operation_groups"]; onCreated: () => void }) {
  const [f, setF] = useState({
    name: "", surname: "", client_phone: "", client_email: "",
    pickup_at: "", room_number: "",
    flight_number: "", vehicle: "", pax_count: "1", notes: "", extra_pax: "", person_type: "crew" as "crew" | "visitor", organisation: "", movement_type: "other" as "on_signing" | "off_signing" | "visitor" | "other", flight_information: "", hotel_required: false, transport_required: false, visit_start_date: "", visit_end_date: "",
  });
  const [fromPick, setFromPick] = useState<AddressPick>({ address: "", place_id: null, lat: null, lng: null });
  const [toPick, setToPick] = useState<AddressPick>({ address: "", place_id: null, lat: null, lng: null });
  const [fromPortId, setFromPortId] = useState<string | null>(null);
  const [fromBerthId, setFromBerthId] = useState<string | null>(null);
  const [toPortId, setToPortId] = useState<string | null>(null);
  const [toBerthId, setToBerthId] = useState<string | null>(null);
  const [shipEventId, setShipEventId] = useState<string | null>(null);
  const [operationGroupId, setOperationGroupId] = useState<string | null>(null);
  const [ports, setPorts] = useState<TokenPort[]>([]);
  const [ships, setShips] = useState<TokenShip[]>([]);
  const [busy, setBusy] = useState(false);
  const flightWarning = flightFormatWarning(f.flight_number);

  // Same Port Directory / ship-event data the coordinator links against —
  // so a port or ship an HR/company agent picks here shows on the
  // coordinator's trip card exactly like one they'd have linked themselves.
  useEffect(() => {
    fetch(`/api/public/portal/${token}/`)
      .then((r) => r.json())
      .then((data) => { setPorts(data.ports ?? []); setShips(data.ships ?? []); })
      .catch(() => undefined);
  }, [token]);

  async function submit() {
    setBusy(true);
    const primary = `${f.name.trim()} ${f.surname.trim()}`.trim();
    const paxNames = [primary, ...splitPaxNames(f.extra_pax)].filter(Boolean);
    const body = {
      name: f.name.trim() || null,
      surname: f.surname.trim() || null,
      pax_names: paxNames.length ? paxNames : null,
      client_phone: f.client_phone.trim() || null,
      client_email: f.client_email.trim() || null,
      room_number: f.room_number.trim() || null,
      flight_number: f.flight_number.trim() || null,
      vehicle: f.vehicle.trim() || null,
      notes: f.notes.trim() || null,
      from_location: fromPick.address,
      from_location_type: fromPortId ? "port" as const : classifyProviderEndpoint(fromPick.place_types),
      from_place_id: fromPick.place_id,
      from_lat: fromPick.lat,
      from_lng: fromPick.lng,
      from_display_name: fromPick.display_name ?? null,
      from_port_id: fromPortId,
      from_berth_id: fromBerthId,
      to_location: toPick.address,
      to_location_type: toPortId ? "port" as const : classifyProviderEndpoint(toPick.place_types),
      to_place_id: toPick.place_id,
      to_lat: toPick.lat,
      to_lng: toPick.lng,
      to_display_name: toPick.display_name ?? null,
      to_port_id: toPortId,
      to_berth_id: toBerthId,
      ship_event_id: shipEventId,
      operation_group_id: operationGroupId,
      person_type: f.person_type,
      organisation: f.organisation.trim() || null,
      movement_type: f.movement_type,
      flight_information: f.flight_information.trim() || null,
      hotel_required: f.hotel_required,
      transport_required: f.transport_required,
      visit_start_date: f.person_type === "visitor" ? (f.visit_start_date || null) : null,
      visit_end_date: f.person_type === "visitor" ? (f.visit_end_date || null) : null,
      pax_count: Math.max(Number(f.pax_count) || 1, paxNames.length || 1),
      pickup_at: f.pickup_at ? new Date(f.pickup_at).toISOString() : null,
    };
    const r = await fetch(`/api/public/portal/${token}/bookings`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    setBusy(false);
    if (!r.ok) { toast.error("Failed to submit"); return; }
    toast.success("Booking submitted — awaiting coordinator approval");
    setF({ name: "", surname: "", client_phone: "", client_email: "", pickup_at: "", room_number: "", flight_number: "", vehicle: "", pax_count: "1", notes: "", extra_pax: "", person_type: "crew", organisation: "", movement_type: "other", flight_information: "", hotel_required: false, transport_required: false, visit_start_date: "", visit_end_date: "" });
    setFromPick({ address: "", place_id: null, lat: null, lng: null });
    setToPick({ address: "", place_id: null, lat: null, lng: null });
    setFromPortId(null); setFromBerthId(null); setToPortId(null); setToBerthId(null); setShipEventId(null); setOperationGroupId(null);
    onCreated();
  }
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">New booking</CardTitle></CardHeader>
      <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Field label="Guest first name"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="Guest last name"><Input value={f.surname} onChange={(e) => setF({ ...f, surname: e.target.value })} /></Field>
        <Field label="Guest phone"><Input value={f.client_phone} onChange={(e) => setF({ ...f, client_phone: e.target.value })} /></Field>
        <Field label="Guest email"><Input type="email" value={f.client_email} onChange={(e) => setF({ ...f, client_email: e.target.value })} /></Field>
        <Field label="From">
          <AddressAutocomplete publicToken={token} value={fromPick.address} placeId={fromPick.place_id} onChange={setFromPick} />
          <TokenPortPicker ports={ports} portId={fromPortId} berthId={fromBerthId} onChange={({ portId, berthId, address }) => { setFromPortId(portId); setFromBerthId(berthId); if (address) setFromPick((p) => ({ ...p, address })); }} />
        </Field>
        <Field label="To">
          <AddressAutocomplete publicToken={token} value={toPick.address} placeId={toPick.place_id} onChange={setToPick} />
          <TokenPortPicker ports={ports} portId={toPortId} berthId={toBerthId} onChange={({ portId, berthId, address }) => { setToPortId(portId); setToBerthId(berthId); if (address) setToPick((p) => ({ ...p, address })); }} />
        </Field>
        <Field label="Pickup date & time"><Input type="datetime-local" value={f.pickup_at} onChange={(e) => setF({ ...f, pickup_at: e.target.value })} /></Field>
        <Field label="Room"><Input value={f.room_number} onChange={(e) => setF({ ...f, room_number: e.target.value })} /></Field>
        <Field label="Flight">
          <div className="relative">
            <Input
              value={f.flight_number}
              onChange={(e) => setF({ ...f, flight_number: e.target.value })}
              className={flightWarning ? "border-red-500 focus-visible:ring-red-500 pr-8" : ""}
              placeholder="e.g. FR1234"
            />
            {flightWarning && (
              <AlertTriangle className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 h-4 w-4 text-red-500" aria-label={flightWarning} />
            )}
          </div>
          {flightWarning && <p className="text-xs text-red-600 mt-1">{flightWarning}</p>}
        </Field>
        <Field label="Vehicle preference (optional)"><Input value={f.vehicle} onChange={(e) => setF({ ...f, vehicle: e.target.value })} placeholder="e.g. Minivan, Sedan" /></Field>
        <Field label="Ship (optional)"><TokenShipPicker ships={ships} shipEventId={shipEventId} onChange={setShipEventId} /></Field>
        {operationGroups.length > 0 && <Field label="Operation (optional)"><select className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={operationGroupId ?? ""} onChange={(e) => setOperationGroupId(e.target.value || null)}><option value="">No Operation</option>{operationGroups.map((group) => <option key={group.id} value={group.id}>{group.reference} · {group.name} ({group.status})</option>)}</select></Field>}
        <Field label="Person type"><select className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={f.person_type} onChange={(e) => setF({ ...f, person_type: e.target.value as "crew" | "visitor" })}><option value="crew">Crew</option><option value="visitor">Visitor</option></select></Field>
        <Field label="Movement type"><select className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={f.movement_type} onChange={(e) => setF({ ...f, movement_type: e.target.value as "on_signing" | "off_signing" | "visitor" | "other" })}><option value="on_signing">On-signing</option><option value="off_signing">Off-signing</option><option value="visitor">Visitor</option><option value="other">Other</option></select></Field>
        <Field label="Organisation (optional)"><Input value={f.organisation} onChange={(e) => setF({ ...f, organisation: e.target.value })} /></Field>
        <Field label="Flight information (optional)"><Input value={f.flight_information} onChange={(e) => setF({ ...f, flight_information: e.target.value })} /></Field>
        {f.person_type === "visitor" && <><Field label="Visit start"><Input type="date" value={f.visit_start_date} onChange={(e) => setF({ ...f, visit_start_date: e.target.value })} /></Field><Field label="Visit end"><Input type="date" value={f.visit_end_date} onChange={(e) => setF({ ...f, visit_end_date: e.target.value })} /></Field></>}
        <div className="md:col-span-2 flex items-center gap-4 text-sm"><label className="flex items-center gap-2"><input type="checkbox" checked={f.hotel_required} onChange={(e) => setF({ ...f, hotel_required: e.target.checked })} />Hotel required</label><label className="flex items-center gap-2"><input type="checkbox" checked={f.transport_required} onChange={(e) => setF({ ...f, transport_required: e.target.checked })} />Transport required</label></div>
        <Field label="Pax"><Input type="number" min={1} value={f.pax_count} onChange={(e) => setF({ ...f, pax_count: e.target.value })} /></Field>
        <div className="md:col-span-2">
          <Field label="Additional passengers (comma-separated, optional)">
            <Input value={f.extra_pax} onChange={(e) => setF({ ...f, extra_pax: e.target.value })} placeholder="Maria Rossi, Ali Hassan" />
          </Field>
        </div>
        <div className="md:col-span-2"><Field label="Notes"><Textarea value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field></div>
        <div className="md:col-span-2 flex justify-end">
          <Button onClick={submit} disabled={busy || !fromPick.address || !toPick.address}>Submit for approval</Button>
        </div>
      </CardContent>
    </Card>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (<div><Label className="text-xs">{label}</Label>{children}</div>);
}

// Consecutive bookings sharing a batch_id (i.e. submitted together in one
// grid/upload) are grouped for display; bookings with no batch_id (or where
// the batch got interrupted by something else in the sort order) each get
// their own singleton "group" and render exactly as before.
function groupBookings(bookings: any[]): { batchId: string | null; items: any[] }[] {
  const groups: { batchId: string | null; items: any[] }[] = [];
  for (const b of bookings) {
    const bid = b.batch_id ?? null;
    const last = groups[groups.length - 1];
    if (last && bid !== null && last.batchId === bid) last.items.push(b);
    else groups.push({ batchId: bid, items: [b] });
  }
  return groups;
}

function BookingsList({ bookings, jobs, token, onChanged }: { bookings: any[]; jobs: any[]; token: string; onChanged: () => void }) {
  const groups = groupBookings(bookings);
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">Your bookings</h3>
        {bookings.length > 0 && (
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => downloadBookingsStatusExcel(bookings, jobs)}>
              <Download className="h-3.5 w-3.5 mr-1" /> Status (.xlsx)
            </Button>
            <Button variant="outline" size="sm" onClick={() => downloadBookingsStatusCsv(bookings, jobs)}>
              <Download className="h-3.5 w-3.5 mr-1" /> Status (.csv)
            </Button>
          </div>
        )}
      </div>
      {bookings.length === 0 && <p className="text-sm text-muted-foreground">No bookings yet.</p>}
      {groups.map((g, gi) => (
        g.items.length > 1 ? (
          <div key={gi} className="rounded-lg border border-dashed p-2 space-y-2">
            <div className="text-xs text-muted-foreground px-1">Batch of {g.items.length}</div>
            {g.items.map((b) => (
              <BookingCard key={b.id} booking={b} job={jobs.find((j) => j.id === b.job_id)} token={token} onChanged={onChanged} />
            ))}
          </div>
        ) : (
          <BookingCard key={g.items[0].id} booking={g.items[0]} job={jobs.find((j) => j.id === g.items[0].job_id)} token={token} onChanged={onChanged} />
        )
      ))}
    </div>
  );
}

function BookingCard({ booking: b, job, token, onChanged }: { booking: any; job: any; token: string; onChanged: () => void }) {
  return (
    <Card>
      <CardContent className="p-4 flex items-center justify-between gap-3 flex-wrap">
        <div>
          <div className="font-medium">{b.payload?.name} {b.payload?.surname} <span className="text-xs text-muted-foreground">· {b.payload?.pax_count ?? 1} pax</span></div>
          {Array.isArray(b.payload?.pax_names) && b.payload.pax_names.length > 1 && (
            <div className="text-xs text-muted-foreground">{b.payload.pax_names.join(", ")}</div>
          )}
          <div className="text-sm text-muted-foreground">{b.payload?.from_location} → {b.payload?.to_location}</div>
          <div className="text-xs mt-1">{b.payload?.pickup_at ? new Date(b.payload.pickup_at).toLocaleString() : "—"}</div>
          {b.status === "accepted" && b.agreed_price != null && (
            <div className="text-xs mt-1 font-medium">{b.currency ?? "EUR"} {Number(b.agreed_price).toFixed(2)}</div>
          )}
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge status={b.status} />
          {job && b.status === "accepted" && <PaxLinkButton bookingId={b.id} token={token} />}
          <BookingActions booking={b} token={token} onChanged={onChanged} />
        </div>
      </CardContent>
    </Card>
  );
}

// Edit/cancel a booking you submitted. Every change goes through the
// coordinator's approval — this never edits the booking directly, it files
// a portal_change_requests row (same mechanism the coordinator already uses
// for accepted-booking edits, extended here to also cover still-pending
// bookings, and given an actual UI for the first time).
function BookingActions({ booking, token, onChanged }: { booking: any; token: string; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const payload = booking.payload ?? {};
  const isPending = booking.status === "pending";
  const isAccepted = booking.status === "accepted";

  const [form, setForm] = useState({
    name: payload.name ?? "", surname: payload.surname ?? "",
    client_phone: payload.client_phone ?? "", client_email: payload.client_email ?? "",
    room_number: payload.room_number ?? "", flight_number: payload.flight_number ?? "",
    vehicle: payload.vehicle ?? "",
    pax_count: String(payload.pax_count ?? 1), notes: payload.notes ?? "",
    extra_pax: Array.isArray(payload.pax_names) ? payload.pax_names.slice(1).join(", ") : "",
  });
  const [fromPick, setFromPick] = useState<AddressPick>({
    address: payload.from_location ?? "", place_id: payload.from_place_id ?? null,
    lat: payload.from_lat ?? null, lng: payload.from_lng ?? null,
  });
  const [toPick, setToPick] = useState<AddressPick>({
    address: payload.to_location ?? "", place_id: payload.to_place_id ?? null,
    lat: payload.to_lat ?? null, lng: payload.to_lng ?? null,
  });
  const [pickupAt, setPickupAt] = useState(payload.pickup_at ? new Date(payload.pickup_at).toISOString().slice(0, 16) : "");

  if (!isPending && !isAccepted) {
    return booking.status === "change_requested"
      ? <span className="text-[11px] text-muted-foreground">Change requested — awaiting coordinator</span>
      : null;
  }

  async function submitChange() {
    setBusy(true);
    try {
      const primaryName = isPending
        ? `${form.name.trim()} ${form.surname.trim()}`.trim()
        : `${payload.name ?? ""} ${payload.surname ?? ""}`.trim();
      const paxNames = [primaryName, ...splitPaxNames(form.extra_pax)].filter(Boolean);
      const paxCount = Math.max(Number(form.pax_count) || 1, paxNames.length || 1);
      const requestedChanges: Record<string, unknown> = isPending
        ? {
            name: form.name.trim() || null, surname: form.surname.trim() || null,
            client_phone: form.client_phone.trim() || null, client_email: form.client_email.trim() || null,
            from_location: fromPick.address, from_place_id: fromPick.place_id, from_lat: fromPick.lat, from_lng: fromPick.lng,
            from_display_name: fromPick.display_name ?? null,
            to_location: toPick.address, to_place_id: toPick.place_id, to_lat: toPick.lat, to_lng: toPick.lng,
            to_display_name: toPick.display_name ?? null,
            pickup_at: pickupAt ? new Date(pickupAt).toISOString() : null,
            room_number: form.room_number.trim() || null, flight_number: form.flight_number.trim() || null,
            vehicle: form.vehicle.trim() || null,
            pax_count: paxCount, pax_names: paxNames.length ? paxNames : null,
            notes: form.notes.trim() || null,
          }
        : {
            from_location: fromPick.address, from_lat: fromPick.lat, from_lng: fromPick.lng,
            from_display_name: fromPick.display_name ?? null,
            to_location: toPick.address, to_lat: toPick.lat, to_lng: toPick.lng,
            to_display_name: toPick.display_name ?? null,
            pickup_at: pickupAt ? new Date(pickupAt).toISOString() : null,
            pax_count: paxCount, pax_names: paxNames.length ? paxNames : null,
            notes: form.notes.trim() || null,
          };
      const r = await fetch(`/api/public/portal/${token}/change-requests`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ booking_id: booking.id, kind: isPending ? "edit" : "reschedule", requested_changes: requestedChanges }),
      });
      if (!r.ok) { toast.error("Failed to submit change request"); return; }
      toast.success("Change requested — awaiting coordinator approval");
      setOpen(false);
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  async function cancelBooking() {
    if (!confirm("Request cancellation of this booking?")) return;
    const r = await fetch(`/api/public/portal/${token}/change-requests`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ booking_id: booking.id, kind: "cancel" }),
    });
    if (!r.ok) { toast.error("Failed to request cancellation"); return; }
    toast.success("Cancellation requested — awaiting coordinator approval");
    onChanged();
  }

  return (
    <div className="flex gap-1">
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button size="sm" variant="outline">{isPending ? "Edit" : "Request change"}</Button>
        </DialogTrigger>
        <DialogContent className="max-h-[85vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{isPending ? "Edit booking" : "Request a change"}</DialogTitle></DialogHeader>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {isPending && (
              <>
                <Field label="Guest first name"><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
                <Field label="Guest last name"><Input value={form.surname} onChange={(e) => setForm({ ...form, surname: e.target.value })} /></Field>
                <Field label="Guest phone"><Input value={form.client_phone} onChange={(e) => setForm({ ...form, client_phone: e.target.value })} /></Field>
                <Field label="Guest email"><Input value={form.client_email} onChange={(e) => setForm({ ...form, client_email: e.target.value })} /></Field>
              </>
            )}
            <Field label="From"><AddressAutocomplete publicToken={token} value={fromPick.address} placeId={fromPick.place_id} onChange={setFromPick} /></Field>
            <Field label="To"><AddressAutocomplete publicToken={token} value={toPick.address} placeId={toPick.place_id} onChange={setToPick} /></Field>
            <Field label="Pickup date & time"><Input type="datetime-local" value={pickupAt} onChange={(e) => setPickupAt(e.target.value)} /></Field>
            {isPending && (
              <>
                <Field label="Room"><Input value={form.room_number} onChange={(e) => setForm({ ...form, room_number: e.target.value })} /></Field>
                <Field label="Flight"><Input value={form.flight_number} onChange={(e) => setForm({ ...form, flight_number: e.target.value })} /></Field>
                <Field label="Vehicle preference (optional)"><Input value={form.vehicle} onChange={(e) => setForm({ ...form, vehicle: e.target.value })} placeholder="e.g. Minivan, Sedan" /></Field>
              </>
            )}
            <Field label="Pax"><Input type="number" min={1} value={form.pax_count} onChange={(e) => setForm({ ...form, pax_count: e.target.value })} /></Field>
            <Field label="Additional passengers (comma-separated, optional)">
              <Input value={form.extra_pax} onChange={(e) => setForm({ ...form, extra_pax: e.target.value })} placeholder="Maria Rossi, Ali Hassan" />
            </Field>
            <div className="md:col-span-2"><Field label="Notes"><Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field></div>
          </div>
          <div className="flex justify-end mt-3">
            <Button onClick={submitChange} disabled={busy}>Submit for approval</Button>
          </div>
        </DialogContent>
      </Dialog>
      <Button size="sm" variant="ghost" className="text-destructive" onClick={cancelBooking}>Cancel</Button>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    pending: "bg-yellow-500/20 text-yellow-700",
    accepted: "bg-green-500/20 text-green-700",
    rejected: "bg-red-500/20 text-red-700",
    cancelled: "bg-slate-500/20 text-slate-700",
    change_requested: "bg-blue-500/20 text-blue-700",
  };
  return <Badge className={map[status] || ""}>{status.replace("_", " ")}</Badge>;
}

function PaxLinkButton({ bookingId, token }: { bookingId: string; token: string }) {
  const [link, setLink] = useState<string | null>(null);
  async function copy() {
    // The pax token was created at accept-time; ask the portal endpoint to hand back.
    // We piggyback on /messages GET via the booking to fetch it isn't ideal; expose via jobs listing instead.
    // Simplest here: just show the tracking URL derived from booking id (server can look it up).
    const r = await fetch(`/api/public/portal/${token}/pax-link?booking_id=${bookingId}`);
    if (!r.ok) { toast.error("Could not get link"); return; }
    const j = await r.json();
    const url = `${window.location.origin}/track/${j.pax_token}`;
    setLink(url);
    navigator.clipboard.writeText(url).catch(() => {});
    toast.success("Passenger tracking link copied");
  }
  return (
    <div className="flex flex-col items-end gap-1">
      <Button size="sm" variant="outline" onClick={copy}>Copy passenger link</Button>
      {link && <div className="text-[10px] text-muted-foreground max-w-[200px] truncate">{link}</div>}
    </div>
  );
}

function TripsList({ token, bookings, jobs, onChanged }: { token: string; bookings: any[]; jobs: any[]; onChanged: () => void }) {
  const accepted = bookings.filter((b) => b.status === "accepted" && b.job_id);
  const [openId, setOpenId] = useState<string | null>(null);
  const openBooking = accepted.find((b) => b.id === openId) ?? null;
  const openJob = openBooking ? jobs.find((j) => j.id === openBooking.job_id) : null;
  return (
    <div className="space-y-2">
      {accepted.length === 0 && <p className="text-sm text-muted-foreground">No accepted trips yet.</p>}
      {accepted.map((b) => {
        const job = jobs.find((j) => j.id === b.job_id);
        if (isFinishedJob(job)) {
          return <CompletedTripStrip key={b.id} booking={b} job={job} onOpen={() => setOpenId(b.id)} />;
        }
        const names = Array.isArray(b.payload?.pax_names) && b.payload.pax_names.length
          ? b.payload.pax_names.join(", ")
          : `${b.payload?.name ?? ""} ${b.payload?.surname ?? ""}`.trim();
        return (
          <Card key={b.id} className="cursor-pointer hover:bg-muted/40" onClick={() => setOpenId(b.id)}>
            <CardContent className="p-4">
              <div className="font-medium">
                {names || "Guest"}
                {Number(b.payload?.pax_count) > 1 && (
                  <span className="text-xs text-muted-foreground font-normal"> · {b.payload.pax_count} pax</span>
                )}
              </div>
              <div className="text-sm text-muted-foreground">{b.payload?.from_location} → {b.payload?.to_location}</div>
              <div className="text-xs mt-1">
                Status: {job?.status ?? "—"} {job?.pickup_at && `· ${new Date(job.pickup_at).toLocaleString()}`}
                {job?.status === "arrived" && <span className="ml-1 font-semibold text-amber-700">· Driver waiting</span>}
              </div>
              {job?.drivers && (
                <div className="text-xs mt-1">Driver: {String(job.drivers.name || "").split(" ")[0]} · {job.drivers.car_make_model} · {job.drivers.plate}</div>
              )}
            </CardContent>
          </Card>
        );
      })}

      <Dialog open={!!openBooking} onOpenChange={(v) => !v && setOpenId(null)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto">
          {openBooking && (
            <>
              <DialogHeader>
                <DialogTitle>
                  {Array.isArray(openBooking.payload?.pax_names) && openBooking.payload.pax_names.length
                    ? openBooking.payload.pax_names.join(", ")
                    : `${openBooking.payload?.name ?? ""} ${openBooking.payload?.surname ?? ""}`.trim() || "Trip"}
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-2 text-sm">
                <div className="text-muted-foreground">{openBooking.payload?.from_location} → {openBooking.payload?.to_location}</div>
                <div>{openJob?.pickup_at ? new Date(openJob.pickup_at).toLocaleString() : "—"}</div>
                <div>Status: {openJob?.status ?? "—"} {openJob?.status === "arrived" && <span className="font-semibold text-amber-700">· Driver waiting</span>}</div>
                {openJob?.drivers && (
                  <div>Driver: {openJob.drivers.name} · {openJob.drivers.car_make_model} · {openJob.drivers.plate}</div>
                )}
                {openBooking.payload?.notes && <div className="italic text-muted-foreground">"{openBooking.payload.notes}"</div>}
                <TripStatusTimeline current={openJob?.status} />
              </div>
              <AddPassengerForm token={token} booking={openBooking} onAdded={onChanged} />
              <TripLiveMap token={token} jobId={openBooking.job_id} />
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

// Add one more named passenger to an already-accepted trip, right from the
// map detail view. Goes through the same portal_change_requests →
// decideChangeRequest pipeline as "Request change" on the Bookings tab
// (accepted-booking pax_names/pax_count path) — the coordinator still
// approves it before the extra pax row is seeded on the job.
function AddPassengerForm({ token, booking, onAdded }: { token: string; booking: any; onAdded: () => void }) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const existingNames: string[] = Array.isArray(booking.payload?.pax_names) && booking.payload.pax_names.length
    ? booking.payload.pax_names
    : [`${booking.payload?.name ?? ""} ${booking.payload?.surname ?? ""}`.trim()].filter(Boolean);

  if (booking.status !== "accepted") return null;

  async function submit() {
    const trimmed = name.trim();
    if (!trimmed) return;
    setBusy(true);
    try {
      const paxNames = [...existingNames, trimmed];
      const r = await fetch(`/api/public/portal/${token}/change-requests`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          booking_id: booking.id, kind: "reschedule",
          requested_changes: { pax_names: paxNames, pax_count: paxNames.length },
        }),
      });
      if (!r.ok) { toast.error("Failed to request adding this passenger"); return; }
      toast.success("Requested — awaiting coordinator approval");
      setName("");
      onAdded();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-end gap-2 border rounded p-2">
      <div className="flex-1">
        <Label className="text-xs">Add a passenger to this trip</Label>
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name" onKeyDown={(e) => e.key === "Enter" && submit()} />
      </div>
      <Button size="sm" onClick={submit} disabled={busy || !name.trim()}>Request</Button>
    </div>
  );
}

// Collapsed one-line row for a finished trip, mirroring the coordinator
// dispatch board's CompletedStrip pattern — the detail Dialog itself keeps
// everything (map switches to replay, per TripLiveMap), only the list row
// collapses.
function CompletedTripStrip({ booking: b, job, onOpen }: { booking: any; job: any; onOpen: () => void }) {
  const cancelled = job?.status === "cancelled";
  const paxCount = Number(b.payload?.pax_count) || (Array.isArray(b.payload?.pax_names) ? b.payload.pax_names.length : 1);
  const driverFirst = job?.drivers?.name ? String(job.drivers.name).split(" ")[0] : null;
  return (
    <div
      onClick={onOpen}
      className={`flex items-center gap-2 rounded-md border px-3 py-1.5 text-xs cursor-pointer hover:bg-muted/40 ${
        cancelled
          ? "border-muted bg-muted/30 text-muted-foreground line-through"
          : "border-emerald-500/30 bg-emerald-500/5 text-muted-foreground"
      }`}
    >
      <span className="font-medium text-foreground shrink-0">
        {job?.pickup_at ? new Date(job.pickup_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—"}
      </span>
      <span className="truncate flex-1">{b.payload?.from_location} → {b.payload?.to_location}</span>
      {driverFirst && <span className="truncate shrink-0">· {driverFirst}</span>}
      <span className="shrink-0">· {paxCount} pax</span>
      <Badge variant="outline" className="text-[9px] py-0 px-1 shrink-0">{cancelled ? "Cancelled" : "Done"}</Badge>
    </div>
  );
}

type TripLocationEvent = { id: string; event_type: string; lat: number | null; lng: number | null; occurred_at: string; notes: string | null };

type TripLocationData = {
  driver: { latitude: number; longitude: number; captured_at: string } | null;
  breadcrumb: Array<{ lat: number; lng: number; t: string }>;
  pickup: { lat: number; lng: number; label: string | null } | null;
  dropoff: { lat: number; lng: number; label: string | null } | null;
  eta_sec: number | null;
  eta_updated_at: string | null;
  job_status: string | null;
  events: TripLocationEvent[];
};

function TripLiveMap({ token, jobId }: { token: string; jobId: string }) {
  const mapDivRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<any>(null);
  const driverMarkerRef = useRef<any>(null);
  const pickupMarkerRef = useRef<any>(null);
  const dropoffMarkerRef = useRef<any>(null);
  const trackLineRef = useRef<any>(null);
  const eventMarkersRef = useRef<any[]>([]);
  const [data, setData] = useState<TripLocationData | null>(null);

  const isLive = data?.job_status !== "completed" && data?.job_status !== "cancelled";

  useEffect(() => {
    let stopped = false;
    let timer: number | undefined;
    async function poll() {
      try {
        const r = await fetch(`/api/public/portal/${token}/trip-location?job_id=${jobId}`);
        if (stopped) return;
        if (!r.ok) {
          timer = window.setTimeout(poll, 15_000);
          return;
        }
        const j: TripLocationData = await r.json();
        setData(j);
        const finished = j.job_status === "completed" || j.job_status === "cancelled";
        if (!finished && !stopped) timer = window.setTimeout(poll, 15_000);
      } catch { /* keep last known data, try again next tick */
        if (!stopped) timer = window.setTimeout(poll, 15_000);
      }
    }
    poll();
    return () => { stopped = true; if (timer) window.clearTimeout(timer); };
  }, [token, jobId]);

  const hasAnyPoint = !!(data?.driver || data?.pickup || data?.dropoff);

  useEffect(() => {
    if (!data || !hasAnyPoint || !mapDivRef.current) return;
    let cancelled = false;
    loadGoogleMaps().then((maps) => {
      if (cancelled || !mapDivRef.current) return;
      if (!mapRef.current) {
        mapRef.current = new maps.Map(mapDivRef.current, { zoom: 13, disableDefaultUI: true, zoomControl: true });
      }
      const map = mapRef.current;
      const bounds = new maps.LatLngBounds();

      if (data.pickup) {
        const pos = { lat: data.pickup.lat, lng: data.pickup.lng };
        bounds.extend(pos);
        const icon = { path: maps.SymbolPath.CIRCLE, scale: 8, fillColor: "#16a34a", fillOpacity: 1, strokeColor: "#fff", strokeWeight: 2 };
        if (!pickupMarkerRef.current) {
          pickupMarkerRef.current = new maps.Marker({ position: pos, map, icon, title: `Pickup: ${data.pickup.label ?? ""}` });
        } else {
          pickupMarkerRef.current.setPosition(pos);
        }
      }
      if (data.dropoff) {
        const pos = { lat: data.dropoff.lat, lng: data.dropoff.lng };
        bounds.extend(pos);
        const icon = { path: maps.SymbolPath.CIRCLE, scale: 8, fillColor: "#dc2626", fillOpacity: 1, strokeColor: "#fff", strokeWeight: 2 };
        if (!dropoffMarkerRef.current) {
          dropoffMarkerRef.current = new maps.Marker({ position: pos, map, icon, title: `Drop-off: ${data.dropoff.label ?? ""}` });
        } else {
          dropoffMarkerRef.current.setPosition(pos);
        }
      }
      if (data.breadcrumb.length > 1) {
        const path = data.breadcrumb.map((p) => ({ lat: p.lat, lng: p.lng }));
        if (!trackLineRef.current) {
          trackLineRef.current = new maps.Polyline({
            path, map, strokeColor: "#2563eb", strokeOpacity: 0.85, strokeWeight: 3,
          });
        } else {
          trackLineRef.current.setPath(path);
        }
      }
      if (data.driver) {
        const pos = { lat: data.driver.latitude, lng: data.driver.longitude };
        bounds.extend(pos);
        const icon = { path: maps.SymbolPath.CIRCLE, scale: 9, fillColor: "#2563eb", fillOpacity: 1, strokeColor: "#fff", strokeWeight: 3 };
        if (!driverMarkerRef.current) {
          driverMarkerRef.current = new maps.Marker({ position: pos, map, icon, title: "Driver", zIndex: 999 });
        } else {
          driverMarkerRef.current.setPosition(pos);
        }
      }

      for (const m of eventMarkersRef.current) {
        try { m.setMap(null); } catch { /* noop */ }
      }
      eventMarkersRef.current = [];
      for (const ev of data.events ?? []) {
        if (ev.lat == null || ev.lng == null) continue;
        const meta = PORTAL_EVENT_META[ev.event_type];
        const pos = { lat: Number(ev.lat), lng: Number(ev.lng) };
        const marker = new maps.Marker({
          map,
          position: pos,
          icon: {
            path: maps.SymbolPath.CIRCLE,
            scale: 6,
            fillColor: meta?.color ?? "#64748b",
            fillOpacity: 1,
            strokeColor: "#ffffff",
            strokeWeight: 1.5,
          },
          title: `${meta?.label ?? ev.event_type} · ${new Date(ev.occurred_at).toLocaleTimeString()}`,
        });
        eventMarkersRef.current.push(marker);
        bounds.extend(pos);
      }

      if (!bounds.isEmpty()) {
        if (bounds.getNorthEast().equals(bounds.getSouthWest())) {
          map.setCenter(bounds.getCenter());
          if ((map.getZoom() ?? 0) < 13) map.setZoom(14);
        } else {
          map.fitBounds(bounds, 40);
        }
      }
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [data, hasAnyPoint]);

  if (!data) return null;
  if (!hasAnyPoint) {
    return (
      <div className="text-xs text-muted-foreground mt-2">
        {data.job_status === "arrived" || data.job_status === "en_route" || data.job_status === "in_progress"
          ? "Waiting for the driver's live position…"
          : "Live map will appear once the driver is on the way."}
      </div>
    );
  }
  const eta = formatEta(data.eta_sec);
  return (
    <div className="mt-2">
      <div className="text-[10px] text-muted-foreground mb-1">Trip map · {isLive ? "live" : "replay"}</div>
      <div ref={mapDivRef} className="h-56 w-full rounded border" />
      <div className="flex items-center gap-2 mt-1 text-[10px] text-muted-foreground flex-wrap">
        {eta && <span className="font-semibold text-foreground">ETA {eta}</span>}
        {data.eta_updated_at && <span>as of {new Date(data.eta_updated_at).toLocaleTimeString()}</span>}
        {data.driver && <span>· driver position updated {new Date(data.driver.captured_at).toLocaleTimeString()}</span>}
      </div>
    </div>
  );
}

function ChatPanel({ token, bookings }: { token: string; bookings: any[] }) {
  const [pick, setPick] = useState<string | null>(bookings[0]?.id ?? null);
  const [scope, setScope] = useState<"hotel_coord" | "hotel_pax">("hotel_coord");
  const [msgs, setMsgs] = useState<any[]>([]);
  const [text, setText] = useState("");

  useEffect(() => {
    if (!pick) return;
    fetch(`/api/public/portal/${token}/messages?booking_id=${pick}&scope=${scope}`)
      .then((r) => r.json()).then((j) => setMsgs(j.messages ?? []));
  }, [pick, scope, token]);

  async function send() {
    if (!pick || !text.trim()) return;
    const r = await fetch(`/api/public/portal/${token}/messages`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ booking_id: pick, scope, body: text.trim() }),
    });
    if (!r.ok) { toast.error("Send failed"); return; }
    setText("");
    const j2 = await fetch(`/api/public/portal/${token}/messages?booking_id=${pick}&scope=${scope}`).then((r) => r.json());
    setMsgs(j2.messages ?? []);
  }

  return (
    <div className="grid grid-cols-12 gap-3 h-[520px]">
      <div className="col-span-4 border rounded overflow-auto">
        {bookings.map((b) => (
          <button key={b.id} onClick={() => setPick(b.id)}
            className={`w-full text-left p-3 border-b hover:bg-muted ${pick === b.id ? "bg-muted" : ""}`}>
            <div className="text-sm font-medium truncate">{b.payload?.name} {b.payload?.surname}</div>
            <div className="text-xs text-muted-foreground truncate">{b.payload?.from_location} → {b.payload?.to_location}</div>
          </button>
        ))}
      </div>
      <div className="col-span-8 border rounded flex flex-col">
        <div className="border-b p-2 flex gap-1">
          <Button size="sm" variant={scope === "hotel_coord" ? "default" : "outline"} onClick={() => setScope("hotel_coord")}>With coordinator</Button>
          <Button size="sm" variant={scope === "hotel_pax" ? "default" : "outline"} onClick={() => setScope("hotel_pax")}>With guest</Button>
        </div>
        <div className="flex-1 overflow-auto p-3 space-y-2">
          {msgs.length === 0 && <p className="text-xs text-muted-foreground">No messages yet.</p>}
          {msgs.map((m, i) => (
            <div key={i} className={`text-sm ${m.sender_role === "portal" ? "text-right" : ""}`}>
              <div className="text-[10px] text-muted-foreground">{m.sender_label} · {new Date(m.created_at).toLocaleTimeString()}</div>
              <div className="inline-block bg-muted rounded px-2 py-1 max-w-[80%]">{m.body}</div>
            </div>
          ))}
        </div>
        <div className="border-t p-2 flex gap-2">
          <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="Type a message…" onKeyDown={(e) => e.key === "Enter" && send()} />
          <Button onClick={send}>Send</Button>
        </div>
      </div>
    </div>
  );
}

function PortalStatementPanel({ token }: { token: string }) {
  const [start, setStart] = useState(new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10));
  const [end, setEnd] = useState(new Date().toISOString().slice(0, 10));
  const [stmt, setStmt] = useState<any>(null);
  const [busy, setBusy] = useState(false);

  async function generate() {
    setBusy(true);
    try {
      const periodStart = new Date(start).toISOString();
      const periodEnd = new Date(`${end}T23:59:59`).toISOString();
      const r = await fetch(`/api/public/portal/${token}/statement?period_start=${encodeURIComponent(periodStart)}&period_end=${encodeURIComponent(periodEnd)}`);
      if (!r.ok) { toast.error("Failed to generate statement"); return; }
      setStmt(await r.json());
    } finally {
      setBusy(false);
    }
  }

  function downloadCsv() {
    if (!stmt?.rows) return;
    const header = "date,guest,from,to,status,agreed_price\n";
    const rows = stmt.rows.map((row: any) => [
      new Date(row.created_at).toISOString(),
      Array.isArray(row.payload?.pax_names) && row.payload.pax_names.length
        ? row.payload.pax_names.join(", ")
        : `${row.payload?.name ?? ""} ${row.payload?.surname ?? ""}`,
      row.payload?.from_location, row.payload?.to_location, row.status, row.agreed_price ?? "",
    ].map((v: any) => `"${String(v ?? "").replace(/"/g, "''")}"`).join(",")).join("\n");
    const blob = new Blob([header + rows], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `statement_${start}_${end}.csv`; a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Statement</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap gap-2 items-end">
          <div><Label className="text-xs">From</Label><Input type="date" value={start} onChange={(e) => setStart(e.target.value)} /></div>
          <div><Label className="text-xs">To</Label><Input type="date" value={end} onChange={(e) => setEnd(e.target.value)} /></div>
          <Button onClick={generate} disabled={busy}>Generate</Button>
          {stmt && <Button variant="outline" onClick={downloadCsv}>Download CSV</Button>}
        </div>
        {stmt && (
          <div className="text-sm grid grid-cols-2 md:grid-cols-4 gap-3">
            <div>Bookings<div className="font-semibold text-base">{stmt.statement.totals.bookings_count}</div></div>
            <div>Accepted<div className="font-semibold text-base">{stmt.statement.totals.accepted}</div></div>
            <div>Cancelled<div className="font-semibold text-base">{stmt.statement.totals.cancelled}</div></div>
            <div>Revenue<div className="font-semibold text-base">€{Number(stmt.statement.totals.revenue).toFixed(2)}</div></div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// Lets the HR/corporate contact upload their own logo without needing the
// coordinator to do it from the coordinator-side portal management page.
// Once set, this logo shows on the passenger tracking page, the driver's
// sign board, and as a small badge on the coordinator's trip cards.
function LogoPanel({ token, portal, onSaved }: { token: string; portal: Boot["portal"]; onSaved: () => void }) {
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const r = await fetch(`/api/public/portal/${token}/logo`, { method: "POST", body: form });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        toast.error(j.error === "unsupported_type" ? "Use a PNG, JPG, WEBP, or SVG file" : j.error === "too_large" ? "Logo must be under 5MB" : "Upload failed");
        return;
      }
      toast.success("Logo updated");
      onSaved();
    } finally {
      setUploading(false);
    }
  }

  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Your logo</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center gap-3">
          {portal.logo_url ? (
            <img src={portal.logo_url} alt="" className="h-14 w-14 rounded object-contain bg-white border" />
          ) : (
            <div className="h-14 w-14 rounded border grid place-items-center text-xs text-muted-foreground">No logo</div>
          )}
          <div>
            <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()} disabled={uploading}>
              {uploading ? "Uploading…" : portal.logo_url ? "Change logo" : "Upload logo"}
            </Button>
            <input ref={fileInputRef} type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" className="hidden" onChange={handleUpload} />
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          Shown to passengers on their tracking page and to your driver on the pickup sign board.
        </p>
      </CardContent>
    </Card>
  );
}

function SettingsPanel({ token, portal, onSaved }: { token: string; portal: Boot["portal"]; onSaved: () => void }) {
  const [expiry, setExpiry] = useState<string>(portal.link_expires_at?.slice(0, 16) ?? "");
  async function disable() {
    await fetch(`/api/public/portal/${token}/`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "disable_link" }),
    });
    toast.success("Link turned off. Refresh to update.");
    onSaved();
  }
  async function setLinkExpiry() {
    await fetch(`/api/public/portal/${token}/`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "set_expiry", expires_at: expiry ? new Date(expiry).toISOString() : null }),
    });
    toast.success("Expiry updated");
    onSaved();
  }
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Link controls</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <div>
          <Label>Auto-expiry</Label>
          <div className="flex gap-2">
            <Input type="datetime-local" value={expiry} onChange={(e) => setExpiry(e.target.value)} />
            <Button variant="outline" onClick={setLinkExpiry}>Save</Button>
          </div>
          <p className="text-xs text-muted-foreground mt-1">Leave empty for no expiry. The coordinator can also set limits.</p>
        </div>
        <div>
          <Button variant="destructive" onClick={disable}>Turn link off now</Button>
          <p className="text-xs text-muted-foreground mt-1">Ask the coordinator to re-enable when you need it back.</p>
        </div>
      </CardContent>
    </Card>
  );
}
