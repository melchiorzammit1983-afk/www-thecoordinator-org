import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { HotelManagePanel } from "@/components/portal/HotelManagePanel";

export const Route = createFileRoute("/portal/$token")({
  ssr: false,
  head: () => ({ meta: [
    { title: "Company Portal" },
    { name: "robots", content: "noindex" },
  ] }),
  component: PortalPage,
});

type Boot = {
  portal: { id: string; name: string; kind: string; logo_url: string | null; brand_color: string | null; display_name_for_passenger: string; link_expires_at: string | null };
  bookings: any[];
  jobs: any[];
};

function PortalPage() {
  const { token } = Route.useParams();
  const [boot, setBoot] = useState<Boot | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [tab, setTab] = useState<"bookings" | "trips" | "chat" | "manage" | "settings">("bookings");

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
            <div className="text-xs text-muted-foreground capitalize">{boot.portal.kind} portal</div>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto p-4">
        <Tabs value={tab} onValueChange={(v) => setTab(v as any)}>
          <TabsList className="flex-wrap h-auto">
            <TabsTrigger value="bookings">Bookings</TabsTrigger>
            <TabsTrigger value="trips">Trips</TabsTrigger>
            <TabsTrigger value="chat">Chat</TabsTrigger>
            {boot.portal.kind === "hotel" && <TabsTrigger value="manage">Manage</TabsTrigger>}
            <TabsTrigger value="settings">Settings</TabsTrigger>
          </TabsList>

          <TabsContent value="bookings" className="mt-4 space-y-4">
            <NewBookingForm token={token} onCreated={reload} />
            <BookingsList bookings={boot.bookings} jobs={boot.jobs} token={token} />
          </TabsContent>

          <TabsContent value="trips" className="mt-4">
            <TripsList bookings={boot.bookings} jobs={boot.jobs} />
          </TabsContent>

          <TabsContent value="chat" className="mt-4">
            <ChatPanel token={token} bookings={boot.bookings} />
          </TabsContent>

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

function NewBookingForm({ token, onCreated }: { token: string; onCreated: () => void }) {
  const [f, setF] = useState({
    name: "", surname: "", client_phone: "", client_email: "",
    from_location: "", to_location: "", pickup_at: "", room_number: "",
    flight_number: "", pax_count: "1", notes: "",
  });
  const [busy, setBusy] = useState(false);
  async function submit() {
    setBusy(true);
    const body = {
      ...f,
      pax_count: Number(f.pax_count) || 1,
      pickup_at: f.pickup_at ? new Date(f.pickup_at).toISOString() : null,
    };
    const r = await fetch(`/api/public/portal/${token}/bookings`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    setBusy(false);
    if (!r.ok) { toast.error("Failed to submit"); return; }
    toast.success("Booking submitted — awaiting coordinator approval");
    setF({ name: "", surname: "", client_phone: "", client_email: "", from_location: "", to_location: "", pickup_at: "", room_number: "", flight_number: "", pax_count: "1", notes: "" });
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
        <Field label="From"><Input value={f.from_location} onChange={(e) => setF({ ...f, from_location: e.target.value })} /></Field>
        <Field label="To"><Input value={f.to_location} onChange={(e) => setF({ ...f, to_location: e.target.value })} /></Field>
        <Field label="Pickup date & time"><Input type="datetime-local" value={f.pickup_at} onChange={(e) => setF({ ...f, pickup_at: e.target.value })} /></Field>
        <Field label="Room"><Input value={f.room_number} onChange={(e) => setF({ ...f, room_number: e.target.value })} /></Field>
        <Field label="Flight"><Input value={f.flight_number} onChange={(e) => setF({ ...f, flight_number: e.target.value })} /></Field>
        <Field label="Pax"><Input type="number" min={1} value={f.pax_count} onChange={(e) => setF({ ...f, pax_count: e.target.value })} /></Field>
        <div className="md:col-span-2"><Field label="Notes"><Textarea value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field></div>
        <div className="md:col-span-2 flex justify-end">
          <Button onClick={submit} disabled={busy || !f.from_location || !f.to_location}>Submit for approval</Button>
        </div>
      </CardContent>
    </Card>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (<div><Label className="text-xs">{label}</Label>{children}</div>);
}

function BookingsList({ bookings, jobs, token }: { bookings: any[]; jobs: any[]; token: string }) {
  return (
    <div className="space-y-2">
      {bookings.length === 0 && <p className="text-sm text-muted-foreground">No bookings yet.</p>}
      {bookings.map((b) => {
        const job = jobs.find((j) => j.id === b.job_id);
        return (
          <Card key={b.id}>
            <CardContent className="p-4 flex items-center justify-between gap-3 flex-wrap">
              <div>
                <div className="font-medium">{b.payload?.name} {b.payload?.surname} <span className="text-xs text-muted-foreground">· {b.payload?.pax_count ?? 1} pax</span></div>
                <div className="text-sm text-muted-foreground">{b.payload?.from_location} → {b.payload?.to_location}</div>
                <div className="text-xs mt-1">{b.payload?.pickup_at ? new Date(b.payload.pickup_at).toLocaleString() : "—"}</div>
              </div>
              <div className="flex items-center gap-2">
                <StatusBadge status={b.status} />
                {job && b.status === "accepted" && <PaxLinkButton bookingId={b.id} token={token} />}
              </div>
            </CardContent>
          </Card>
        );
      })}
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
