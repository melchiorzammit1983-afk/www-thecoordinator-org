import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { toast } from "sonner";

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
  show_driver_location: boolean;
  passenger?: { name: string; note: string | null } | null;

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
    fetch(`/api/public/track/${token}/`).then(async (r) => {
      if (!r.ok) { setErr("This tracking link is unavailable."); return; }
      setBoot(await r.json());
    });
    setJwt(sessionStorage.getItem(`pax_jwt_${token}`));
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

        {boot.driver && (
          <Card>
            <CardContent className="p-4">
              <div className="text-xs text-muted-foreground">Your driver</div>
              <div className="font-medium">{boot.driver.first_name}</div>
              {boot.driver.vehicle && <div className="text-sm">{boot.driver.vehicle} · {boot.driver.plate}</div>}
              <div className="text-xs text-muted-foreground mt-2">Live map is off for your privacy. Tap below to share your location if you'd like the driver to find you.</div>
            </CardContent>
          </Card>
        )}

        {!jwt ? (
          <VerifyBox token={token} onVerified={setJwt} brandName={brandName} />
        ) : (
          <>
            <ChatBox token={token} jwt={jwt} brandName={brandName} accent={brand} />
            <LocationBox token={token} jwt={jwt} />
          </>
        )}

        <p className="text-[10px] text-muted-foreground text-center pt-4">Powered by {brandName}</p>
      </main>
    </div>
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
      <div className="text-sm font-medium mb-2" style={{ color: accent }}>Message {brandName} Reception</div>
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

function LocationBox({ token, jwt }: { token: string; jwt: string }) {
  const [shareOwn, setShareOwn] = useState(false);
  const [showDriver, setShowDriver] = useState(false);
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
