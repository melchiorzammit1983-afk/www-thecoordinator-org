/**
 * QR landing: guest scans room QR (URL is `/h/<slug>/r/<qr>`) and enters
 * their name + optional email/phone. On submit we create a guest session
 * and redirect them to their mini-portal at `/g/<session>`.
 *
 * The QR token is opaque and single-purpose; it only unlocks session
 * creation via the public API, not the hotel dashboard.
 */
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

type Boot = {
  room: { id: string; room_number: string; label: string | null };
  portal: { id: string; name: string; slug: string | null; logo_url: string | null; brand_color: string | null; display_name_for_passenger: string | null; currency: string | null };
};

export const Route = createFileRoute("/h/$slug/r/$qr")({
  ssr: false,
  head: () => ({ meta: [{ title: "Room portal" }, { name: "robots", content: "noindex" }] }),
  component: RoomLandingPage,
});

function RoomLandingPage() {
  const { qr } = Route.useParams();
  const nav = useNavigate();
  const [boot, setBoot] = useState<Boot | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancel = false;
    fetch(`/api/public/portal/guest/room/${encodeURIComponent(qr)}`)
      .then(async (r) => (r.ok ? r.json() : Promise.reject((await r.json().catch(() => ({}))).error)))
      .then((j) => { if (!cancel) setBoot(j); })
      .catch((e) => { if (!cancel) setErr(String(e || "unavailable")); });
    return () => { cancel = true; };
  }, [qr]);

  async function submit() {
    if (!name.trim()) { toast.error("Please enter your name"); return; }
    setBusy(true);
    const r = await fetch(`/api/public/portal/guest/room/${encodeURIComponent(qr)}`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ guest_name: name.trim(), email: email.trim() || null, phone: phone.trim() || null }),
    });
    setBusy(false);
    if (!r.ok) { toast.error("Could not open portal — please ask reception."); return; }
    const j = await r.json();
    try { localStorage.setItem(`guest:${boot?.portal.id}`, j.session_token); } catch {}
    nav({ to: "/g/$session" as any, params: { session: j.session_token } });
  }

  if (err) return <Unavailable msg={err} />;
  if (!boot) return <div className="min-h-screen grid place-items-center p-8 text-sm text-muted-foreground">Loading…</div>;
  const brand = boot.portal.brand_color || "#0f172a";

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b" style={{ borderColor: brand + "33" }}>
        <div className="max-w-md mx-auto p-4 flex items-center gap-3">
          {boot.portal.logo_url
            ? <img src={boot.portal.logo_url} alt="" className="h-10 w-10 rounded object-contain bg-white" />
            : <div className="h-10 w-10 rounded" style={{ background: brand }} />}
          <div>
            <div className="font-semibold">{boot.portal.name}</div>
            <div className="text-xs text-muted-foreground">Room {boot.room.room_number}{boot.room.label ? ` · ${boot.room.label}` : ""}</div>
          </div>
        </div>
      </header>
      <main className="max-w-md mx-auto p-4 space-y-4">
        <div>
          <h1 className="text-lg font-semibold">Welcome</h1>
          <p className="text-sm text-muted-foreground">Book transport, check offers, and stay in touch with reception — all from your room.</p>
        </div>
        <div className="rounded-xl border p-4 space-y-3 bg-card">
          <div>
            <Label className="text-xs">Your name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Jane Smith" autoFocus />
          </div>
          <div>
            <Label className="text-xs">Email (optional)</Label>
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
          </div>
          <div>
            <Label className="text-xs">Phone (optional)</Label>
            <Input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+356 …" />
          </div>
          <Button className="w-full" style={{ background: brand }} disabled={busy || !name.trim()} onClick={submit}>
            {busy ? "Opening…" : "Open my portal"}
          </Button>
          <p className="text-[11px] text-muted-foreground text-center">
            Your session is device-only and expires automatically. We only share your details with the hotel and dispatch team when you make a booking.
          </p>
        </div>
      </main>
    </div>
  );
}

function Unavailable({ msg }: { msg: string }) {
  const text = msg === "room_disabled" ? "This room QR is switched off."
    : msg === "portal_disabled" ? "The hotel portal is not active."
    : msg === "not_found" ? "This QR is not valid — please scan again or ask reception."
    : "This QR is unavailable right now.";
  return (
    <div className="min-h-screen grid place-items-center p-8 text-center">
      <div>
        <h1 className="text-lg font-semibold">{text}</h1>
        <p className="text-sm text-muted-foreground mt-2">Please contact the reception desk.</p>
      </div>
    </div>
  );
}
