import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { toast } from "sonner";
import { HotelManagePanel } from "@/components/portal/HotelManagePanel";
import { CrewManagementPanel } from "@/components/portal/CrewManagementPanel";
import { BulkBookingGrid } from "@/components/portal/BulkBookingGrid";
import { AddressAutocomplete, type AddressPick } from "@/components/address/AddressAutocomplete";
import { flightFormatWarning } from "@/lib/flight-code";
import { AlertTriangle, Download } from "lucide-react";
import { downloadBookingsStatusExcel, downloadBookingsStatusCsv } from "@/lib/booking-sheet-template";

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

type Boot = {
  portal: { id: string; name: string; kind: string; logo_url: string | null; brand_color: string | null; display_name_for_passenger: string; link_expires_at: string | null };
  bookings: any[];
  jobs: any[];
};

function PortalPage() {
  const { token } = Route.useParams();
  const [boot, setBoot] = useState<Boot | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [tab, setTab] = useState<"bookings" | "trips" | "crew" | "chat" | "statement" | "manage" | "settings">("bookings");

  async function reload() {
    const r = await fetch(`/api/public/portal/${token}/`);
    if (!r.ok) {
      const e = await r.json().catch(() => ({}));
      setErr(e.error || `error_${r.status}`);
      return;
    }
    setErr(null);
    setBoot(await r.json());
  }
  useEffect(() => { reload(); }, [token]);

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
            <div className="text-xs text-muted-foreground">{portalKindLabel(boot.portal.kind)} portal</div>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto p-4">
        <Tabs value={tab} onValueChange={(v) => setTab(v as any)}>
          <TabsList className="flex-wrap h-auto">
            <TabsTrigger value="bookings">Bookings</TabsTrigger>
            <TabsTrigger value="trips">Trips</TabsTrigger>
            <TabsTrigger value="crew">Crew</TabsTrigger>
            <TabsTrigger value="chat">Chat</TabsTrigger>
            <TabsTrigger value="statement">Statement</TabsTrigger>
            {boot.portal.kind === "hotel" && <TabsTrigger value="manage">Manage</TabsTrigger>}
            <TabsTrigger value="settings">Settings</TabsTrigger>
          </TabsList>

          <TabsContent value="bookings" className="mt-4 space-y-4">
            <BookingEntry token={token} kind={boot.portal.kind} onCreated={reload} />
            <BookingsList bookings={boot.bookings} jobs={boot.jobs} token={token} onChanged={reload} />
          </TabsContent>

          <TabsContent value="trips" className="mt-4">
            <TripsList bookings={boot.bookings} jobs={boot.jobs} />
          </TabsContent>

          <TabsContent value="crew" className="mt-4">
            <CrewManagementPanel token={token} />
          </TabsContent>

          <TabsContent value="chat" className="mt-4">
            <ChatPanel token={token} bookings={boot.bookings} />
          </TabsContent>

          <TabsContent value="statement" className="mt-4">
            <PortalStatementPanel token={token} />
          </TabsContent>

          {boot.portal.kind === "hotel" && (
            <TabsContent value="manage" className="mt-4">
              <HotelManagePanel token={token} portal={boot.portal as any} />
            </TabsContent>
          )}

          <TabsContent value="settings" className="mt-4">
            <SettingsPanel token={token} portal={boot.portal} onSaved={reload} />
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}

function OfflineCard({ reason }: { reason: string }) {
  const msg = reason === "link_off" ? "This portal link is currently switched off."
    : reason === "link_expired" ? "This portal link has expired."
    : reason === "portal_disabled" ? "This portal is not active."
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

function BookingEntry({ token, kind, onCreated }: { token: string; kind: string; onCreated: () => void }) {
  const [view, setView] = useState<"grid" | "single">("grid");
  if (kind !== "company_agent") return <NewBookingForm token={token} onCreated={onCreated} />;
  return (
    <div className="space-y-2">
      <div className="flex justify-end">
        <Button variant="ghost" size="sm" onClick={() => setView(view === "grid" ? "single" : "grid")}>
          {view === "grid" ? "Switch to single-entry form" : "Switch to bulk grid"}
        </Button>
      </div>
      {view === "grid"
        ? <BulkBookingGrid token={token} onCreated={onCreated} />
        : <NewBookingForm token={token} onCreated={onCreated} />}
    </div>
  );
}

function NewBookingForm({ token, onCreated }: { token: string; onCreated: () => void }) {
  const [f, setF] = useState({
    name: "", surname: "", client_phone: "", client_email: "",
    pickup_at: "", room_number: "",
    flight_number: "", pax_count: "1", notes: "",
  });
  const [fromPick, setFromPick] = useState<AddressPick>({ address: "", place_id: null, lat: null, lng: null });
  const [toPick, setToPick] = useState<AddressPick>({ address: "", place_id: null, lat: null, lng: null });
  const [busy, setBusy] = useState(false);
  const flightWarning = flightFormatWarning(f.flight_number);

  async function submit() {
    setBusy(true);
    const body = {
      name: f.name.trim() || null,
      surname: f.surname.trim() || null,
      client_phone: f.client_phone.trim() || null,
      client_email: f.client_email.trim() || null,
      room_number: f.room_number.trim() || null,
      flight_number: f.flight_number.trim() || null,
      notes: f.notes.trim() || null,
      from_location: fromPick.address,
      from_place_id: fromPick.place_id,
      from_lat: fromPick.lat,
      from_lng: fromPick.lng,
      to_location: toPick.address,
      to_place_id: toPick.place_id,
      to_lat: toPick.lat,
      to_lng: toPick.lng,
      pax_count: Number(f.pax_count) || 1,
      pickup_at: f.pickup_at ? new Date(f.pickup_at).toISOString() : null,
    };
    const r = await fetch(`/api/public/portal/${token}/bookings`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    setBusy(false);
    if (!r.ok) { toast.error("Failed to submit"); return; }
    toast.success("Booking submitted — awaiting coordinator approval");
    setF({ name: "", surname: "", client_phone: "", client_email: "", pickup_at: "", room_number: "", flight_number: "", pax_count: "1", notes: "" });
    setFromPick({ address: "", place_id: null, lat: null, lng: null });
    setToPick({ address: "", place_id: null, lat: null, lng: null });
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
        <Field label="From"><AddressAutocomplete value={fromPick.address} placeId={fromPick.place_id} onChange={setFromPick} /></Field>
        <Field label="To"><AddressAutocomplete value={toPick.address} placeId={toPick.place_id} onChange={setToPick} /></Field>
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
        <Field label="Pax"><Input type="number" min={1} value={f.pax_count} onChange={(e) => setF({ ...f, pax_count: e.target.value })} /></Field>
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
    pax_count: String(payload.pax_count ?? 1), notes: payload.notes ?? "",
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
      const requestedChanges: Record<string, unknown> = isPending
        ? {
            name: form.name.trim() || null, surname: form.surname.trim() || null,
            client_phone: form.client_phone.trim() || null, client_email: form.client_email.trim() || null,
            from_location: fromPick.address, from_place_id: fromPick.place_id, from_lat: fromPick.lat, from_lng: fromPick.lng,
            to_location: toPick.address, to_place_id: toPick.place_id, to_lat: toPick.lat, to_lng: toPick.lng,
            pickup_at: pickupAt ? new Date(pickupAt).toISOString() : null,
            room_number: form.room_number.trim() || null, flight_number: form.flight_number.trim() || null,
            pax_count: Number(form.pax_count) || 1, notes: form.notes.trim() || null,
          }
        : {
            from_location: fromPick.address, to_location: toPick.address,
            pickup_at: pickupAt ? new Date(pickupAt).toISOString() : null,
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
            <Field label="From"><AddressAutocomplete value={fromPick.address} placeId={fromPick.place_id} onChange={setFromPick} /></Field>
            <Field label="To"><AddressAutocomplete value={toPick.address} placeId={toPick.place_id} onChange={setToPick} /></Field>
            <Field label="Pickup date & time"><Input type="datetime-local" value={pickupAt} onChange={(e) => setPickupAt(e.target.value)} /></Field>
            {isPending && (
              <>
                <Field label="Room"><Input value={form.room_number} onChange={(e) => setForm({ ...form, room_number: e.target.value })} /></Field>
                <Field label="Flight"><Input value={form.flight_number} onChange={(e) => setForm({ ...form, flight_number: e.target.value })} /></Field>
                <Field label="Pax"><Input type="number" min={1} value={form.pax_count} onChange={(e) => setForm({ ...form, pax_count: e.target.value })} /></Field>
                <div className="md:col-span-2"><Field label="Notes"><Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field></div>
              </>
            )}
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

function TripsList({ bookings, jobs }: { bookings: any[]; jobs: any[] }) {
  const accepted = bookings.filter((b) => b.status === "accepted" && b.job_id);
  return (
    <div className="space-y-2">
      {accepted.length === 0 && <p className="text-sm text-muted-foreground">No accepted trips yet.</p>}
      {accepted.map((b) => {
        const job = jobs.find((j) => j.id === b.job_id);
        return (
          <Card key={b.id}>
            <CardContent className="p-4">
              <div className="font-medium">{b.payload?.name} {b.payload?.surname}</div>
              <div className="text-sm text-muted-foreground">{b.payload?.from_location} → {b.payload?.to_location}</div>
              <div className="text-xs mt-1">Status: {job?.status ?? "—"} {job?.pickup_at && `· ${new Date(job.pickup_at).toLocaleString()}`}</div>
              {job?.drivers && (
                <div className="text-xs mt-1">Driver: {String(job.drivers.name || "").split(" ")[0]} · {job.drivers.car_make_model} · {job.drivers.plate}</div>
              )}
            </CardContent>
          </Card>
        );
      })}
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
      new Date(row.created_at).toISOString(), `${row.payload?.name ?? ""} ${row.payload?.surname ?? ""}`,
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
