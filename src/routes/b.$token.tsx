import { createFileRoute, notFound } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AddressAutocomplete } from "@/components/address/AddressAutocomplete";
import { Loader2, Send, MessageCircle, CheckCircle2, Clock, XCircle } from "lucide-react";

export const Route = createFileRoute("/b/$token")({
  head: () => ({
    meta: [
      { title: "Book a ride" },
      { name: "description", content: "Request a private transfer — no account needed." },
      { name: "robots", content: "noindex,nofollow" },
    ],
  }),
  component: PublicBookingPage,
  errorComponent: ({ error }) => (
    <div className="max-w-md mx-auto p-8 text-center">
      <p className="text-lg font-medium">Something went wrong</p>
      <p className="text-sm text-muted-foreground mt-2">{(error as Error).message}</p>
    </div>
  ),
  notFoundComponent: () => (
    <div className="max-w-md mx-auto p-8 text-center">
      <p className="text-lg font-medium">This link is not active</p>
      <p className="text-sm text-muted-foreground mt-2">It may have expired or been turned off.</p>
    </div>
  ),
});

const VISITOR_KEY_PREFIX = "pbportal:v:";

function getVisitorId(token: string): string {
  if (typeof window === "undefined") return "";
  const key = VISITOR_KEY_PREFIX + token;
  let v = window.localStorage.getItem(key);
  if (!v) {
    v = [...crypto.getRandomValues(new Uint8Array(16))]
      .map((b) => b.toString(16).padStart(2, "0")).join("");
    window.localStorage.setItem(key, v);
  }
  return v;
}

function PublicBookingPage() {
  const { token } = Route.useParams();
  const [visitorId, setVisitorId] = useState<string>("");
  const [bootstrap, setBootstrap] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [showChat, setShowChat] = useState(false);

  // form state
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [pax, setPax] = useState("1");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [notes, setNotes] = useState("");
  const [flight, setFlight] = useState("");

  useEffect(() => {
    const v = getVisitorId(token);
    setVisitorId(v);
    void loadBootstrap(v);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  async function loadBootstrap(v: string) {
    setLoading(true);
    try {
      const res = await fetch(`/api/public/b/${token}/?visitor_id=${encodeURIComponent(v)}`);
      const json = await res.json();
      if (!res.ok) { setError(json.error ?? "unknown_error"); return; }
      setBootstrap(json);
      setError(null);
    } catch (e: any) {
      setError(e?.message ?? "network");
    } finally {
      setLoading(false);
    }
  }

  async function submit() {
    if (!from || !to) { toast.error("Pickup and drop-off are required"); return; }
    if (!date || !time) { toast.error("Date and time are required"); return; }
    setSubmitting(true);
    try {
      const pickup_at = new Date(`${date}T${time}:00`).toISOString();
      const res = await fetch(`/api/public/b/${token}/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          visitor_id: visitorId,
          from_location: from,
          to_location: to,
          pickup_at, date, time,
          name: name || null,
          client_phone: phone || null,
          client_email: email || null,
          flight_number: flight || null,
          pax_count: Number(pax) || 1,
          notes: notes || null,
        }),
      });
      const json = await res.json();
      if (!res.ok) { toast.error(json.error ?? "Submit failed"); return; }
      toast.success(`Request sent — ref #${json.ref}`);
      setFrom(""); setTo(""); setDate(""); setTime(""); setName(""); setPhone("");
      setEmail(""); setNotes(""); setFlight(""); setPax("1");
      void loadBootstrap(visitorId);
    } catch (e: any) {
      toast.error(e?.message ?? "Submit failed");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return <div className="p-8 flex justify-center"><Loader2 className="h-6 w-6 animate-spin" /></div>;
  }
  if (error) {
    const msg = error === "link_expired" ? "This booking link has expired."
      : error === "link_disabled" ? "This booking link is no longer active."
      : error === "not_found" ? "Booking link not found."
      : `Cannot open portal (${error}).`;
    return <div className="max-w-md mx-auto p-8 text-center">
      <p className="text-lg font-medium">{msg}</p>
    </div>;
  }

  return (
    <div className="max-w-2xl mx-auto p-4 md:p-8 space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">{bootstrap?.portal?.name ?? "Book a ride"}</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Fill in your trip details and we'll confirm shortly. No account needed.
        </p>
      </div>

      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base">New booking</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Pickup</Label>
              <AddressAutocomplete value={from} onChange={(v) => setFrom(v.address)} placeholder="Hotel, airport, address…" />
            </div>
            <div className="space-y-1.5">
              <Label>Drop-off</Label>
              <AddressAutocomplete value={to} onChange={(v) => setTo(v.address)} placeholder="Destination" />
            </div>
            <div className="space-y-1.5">
              <Label>Date</Label>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Time</Label>
              <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Passengers</Label>
              <Input type="number" min={1} max={20} value={pax} onChange={(e) => setPax(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Flight number (optional)</Label>
              <Input value={flight} onChange={(e) => setFlight(e.target.value)} placeholder="e.g. KM117" />
            </div>
            <div className="space-y-1.5">
              <Label>Your name</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name" />
            </div>
            <div className="space-y-1.5">
              <Label>Phone</Label>
              <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+356 …" />
            </div>
            <div className="md:col-span-2 space-y-1.5">
              <Label>Email (optional)</Label>
              <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
            </div>
            <div className="md:col-span-2 space-y-1.5">
              <Label>Notes</Label>
              <Textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Anything the driver should know" />
            </div>
          </div>
          <div className="flex justify-end pt-1">
            <Button onClick={submit} disabled={submitting}>
              {submitting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
              Request booking
            </Button>
          </div>
        </CardContent>
      </Card>

      <RequestList bootstrap={bootstrap} />

      <div className="flex justify-end">
        <Button variant="outline" onClick={() => setShowChat((v) => !v)}>
          <MessageCircle className="h-4 w-4 mr-2" />
          {showChat ? "Hide chat" : "Chat with coordinator"}
        </Button>
      </div>

      {showChat && (
        <ChatPanel token={token} visitorId={visitorId} messages={bootstrap?.messages ?? []}
          onSent={() => loadBootstrap(visitorId)} />
      )}
    </div>
  );
}

function RequestList({ bootstrap }: { bootstrap: any }) {
  const requests = (bootstrap?.requests ?? []) as any[];
  const jobs: Record<string, any> = useMemo(() => {
    const m: Record<string, any> = {};
    for (const j of bootstrap?.jobs ?? []) m[j.id] = j;
    return m;
  }, [bootstrap]);
  if (!requests.length) return null;
  return (
    <Card>
      <CardHeader className="pb-3"><CardTitle className="text-base">Your requests</CardTitle></CardHeader>
      <CardContent className="space-y-2">
        {requests.map((r) => {
          const p = r.payload ?? {};
          const when = p.pickup_at
            ? new Date(p.pickup_at).toLocaleString([], { month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" })
            : `${p.date ?? ""} ${p.time ?? ""}`.trim();
          const statusPill =
            r.status === "accepted" ? <Badge className="bg-green-500/20 text-green-700"><CheckCircle2 className="h-3 w-3 mr-1" />Accepted</Badge>
            : r.status === "rejected" ? <Badge className="bg-red-500/20 text-red-700"><XCircle className="h-3 w-3 mr-1" />Rejected</Badge>
            : r.status === "cancelled" ? <Badge variant="secondary">Cancelled</Badge>
            : <Badge className="bg-amber-500/20 text-amber-700"><Clock className="h-3 w-3 mr-1" />Pending</Badge>;
          const job = r.job_id ? jobs[r.job_id] : null;
          return (
            <div key={r.id} className="border rounded-md p-3 text-sm">
              <div className="flex items-center justify-between gap-2">
                <div className="font-medium truncate">{when || "—"} · {p.from_location} → {p.to_location}</div>
                {statusPill}
              </div>
              <div className="text-xs text-muted-foreground mt-1">
                Ref #{r.id.slice(0, 8)} · submitted {new Date(r.created_at).toLocaleString()}
              </div>
              {r.decided_reason && r.status === "rejected" && (
                <div className="text-xs text-destructive mt-1">Reason: {r.decided_reason}</div>
              )}
              {job && (
                <div className="text-xs text-muted-foreground mt-1">
                  Trip status: <span className="font-medium">{job.status}</span>
                </div>
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

function ChatPanel({
  token, visitorId, messages, onSent,
}: { token: string; visitorId: string; messages: any[]; onSent: () => void }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => { scrollRef.current?.scrollTo({ top: 9e9 }); }, [messages.length]);

  async function send() {
    const body = text.trim();
    if (!body) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/public/b/${token}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ visitor_id: visitorId, body }),
      });
      const j = await res.json();
      if (!res.ok) { toast.error(j.error ?? "Failed"); return; }
      setText("");
      onSent();
    } finally { setBusy(false); }
  }

  return (
    <Card>
      <CardHeader className="pb-3"><CardTitle className="text-base">Chat</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <div ref={scrollRef} className="border rounded-md p-3 max-h-72 overflow-y-auto space-y-2 bg-muted/30">
          {messages.length === 0 && <p className="text-xs text-muted-foreground">No messages yet.</p>}
          {messages.map((m: any) => (
            <div key={m.id}
              className={`text-sm p-2 rounded-md max-w-[80%] ${m.sender_role === "visitor" ? "ml-auto bg-primary text-primary-foreground" : "bg-background border"}`}>
              <div>{m.body}</div>
              <div className={`text-[10px] mt-1 ${m.sender_role === "visitor" ? "opacity-80" : "text-muted-foreground"}`}>
                {new Date(m.created_at).toLocaleString()}
              </div>
            </div>
          ))}
        </div>
        <div className="flex gap-2">
          <Input value={text} onChange={(e) => setText(e.target.value)}
            placeholder="Message the coordinator…"
            onKeyDown={(e) => { if (e.key === "Enter") send(); }} />
          <Button onClick={send} disabled={busy || !text.trim()}><Send className="h-4 w-4" /></Button>
        </div>
      </CardContent>
    </Card>
  );
}
