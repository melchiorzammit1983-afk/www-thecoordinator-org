/**
 * Guest mini-portal. Reached after a QR scan + name capture; identified by
 * the opaque session token in the URL.
 *
 * Guests can:
 *  - Book transport (auto-fills their name / room), with optional zone-fare pricing
 *    and promo codes.
 *  - Browse offers and add-ons (hotel restaurant, spa, tours…).
 *  - Track the status of their bookings.
 */
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

type Boot = {
  portal: { id: string; name: string; slug: string | null; logo_url: string | null; brand_color: string | null; display_name_for_passenger: string | null; currency: string | null; pricing_mode: string };
  guest: { name: string; email: string | null; phone: string | null; expires_at: string };
  zones: any[]; fares: any[]; addons: any[]; offers: any[]; bookings: any[];
};

export const Route = createFileRoute("/g/$session")({
  ssr: false,
  head: () => ({ meta: [{ title: "Guest portal" }, { name: "robots", content: "noindex" }] }),
  component: GuestPortalPage,
});

function GuestPortalPage() {
  const { session } = Route.useParams();
  const [boot, setBoot] = useState<Boot | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [tab, setTab] = useState<"book" | "offers" | "mine">("book");

  async function reload() {
    const r = await fetch(`/api/public/portal/guest/${encodeURIComponent(session)}`);
    if (!r.ok) { setErr((await r.json().catch(() => ({}))).error || "unavailable"); return; }
    setErr(null);
    setBoot(await r.json());
  }
  useEffect(() => { reload(); }, [session]);

  if (err) return <Unavailable msg={err} />;
  if (!boot) return <div className="min-h-screen grid place-items-center p-8 text-sm text-muted-foreground">Loading…</div>;
  const brand = boot.portal.brand_color || "#0f172a";

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b sticky top-0 bg-background z-10" style={{ borderColor: brand + "33" }}>
        <div className="max-w-2xl mx-auto p-3 flex items-center gap-3">
          {boot.portal.logo_url
            ? <img src={boot.portal.logo_url} alt="" className="h-9 w-9 rounded object-contain bg-white" />
            : <div className="h-9 w-9 rounded" style={{ background: brand }} />}
          <div className="min-w-0">
            <div className="font-semibold truncate">{boot.portal.name}</div>
            <div className="text-[11px] text-muted-foreground truncate">Hi {boot.guest.name.split(" ")[0]}</div>
          </div>
        </div>
      </header>

      <main className="max-w-2xl mx-auto p-3">
        <Tabs value={tab} onValueChange={(v) => setTab(v as any)}>
          <TabsList className="w-full grid grid-cols-3">
            <TabsTrigger value="book">Book transport</TabsTrigger>
            <TabsTrigger value="offers">Offers</TabsTrigger>
            <TabsTrigger value="mine">My bookings</TabsTrigger>
          </TabsList>
          <TabsContent value="book" className="mt-3">
            <BookingForm boot={boot} session={session} onCreated={reload} />
          </TabsContent>
          <TabsContent value="offers" className="mt-3">
            <OffersList boot={boot} />
          </TabsContent>
          <TabsContent value="mine" className="mt-3">
            <MyBookings boot={boot} />
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}

function BookingForm({ boot, session, onCreated }: { boot: Boot; session: string; onCreated: () => void }) {
  const currency = boot.portal.currency ?? "EUR";
  const [zoneId, setZoneId] = useState<string>("");
  const [paxTier, setPaxTier] = useState<string>("1-3");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [pickup, setPickup] = useState("");
  const [pax, setPax] = useState("1");
  const [paxNames, setPaxNames] = useState("");
  const [flight, setFlight] = useState("");
  const [notes, setNotes] = useState("");
  const [promo, setPromo] = useState("");
  const [selectedAddons, setSelectedAddons] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  const tiersForZone = useMemo(() => {
    if (!zoneId) return [];
    return boot.fares.filter((f) => f.zone_id === zoneId);
  }, [zoneId, boot.fares]);

  const currentFare = tiersForZone.find((f) => f.pax_tier === paxTier);
  const addonsTotal = boot.addons.filter((a) => selectedAddons.has(a.id)).reduce((n, a) => n + (Number(a.price) || 0), 0);
  const priceHint = currentFare ? Number(currentFare.price) + addonsTotal : null;

  const parsedPaxNames = paxNames
    .split(/\r?\n|,|;/)
    .map((n) => n.trim())
    .filter(Boolean);

  async function submit() {
    if (!from.trim() || !to.trim() || !pickup) { toast.error("Please fill from, to and pickup time"); return; }
    setBusy(true);
    const body: any = {
      from_location: from.trim(), to_location: to.trim(),
      pickup_at: new Date(pickup).toISOString(),
      pax_count: Number(pax) || 1,
      pax_names: parsedPaxNames.length ? parsedPaxNames : undefined,
      flight_number: flight.trim() || null,
      notes: notes.trim() || null,
      promo_code: promo.trim() || null,
      addon_ids: Array.from(selectedAddons),
    };
    if (zoneId) { body.zone_id = zoneId; body.pax_tier = paxTier; }
    const r = await fetch(`/api/public/portal/guest/${encodeURIComponent(session)}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    setBusy(false);
    if (!r.ok) { toast.error("Could not submit — please try again."); return; }
    toast.success("Booking sent to reception & dispatch");
    setFrom(""); setTo(""); setPickup(""); setPax("1"); setPaxNames(""); setFlight(""); setNotes(""); setPromo(""); setSelectedAddons(new Set()); setZoneId("");
    onCreated();
  }

  return (
    <div className="space-y-3">
      {boot.zones.length > 0 && (
        <div className="rounded-xl border p-3 bg-card">
          <div className="text-xs font-medium text-muted-foreground uppercase mb-2">Popular routes</div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {boot.zones.map((z) => (
              <button key={z.id} onClick={() => setZoneId(z.id)}
                className={`text-left rounded-lg border px-3 py-2 text-sm ${zoneId === z.id ? "border-primary bg-primary/5" : ""}`}>
                <div className="font-medium truncate">{z.name}</div>
                <div className="text-[11px] text-muted-foreground">
                  {(() => {
                    const f = boot.fares.filter((x) => x.zone_id === z.id);
                    if (f.length === 0) return "Custom price";
                    const min = Math.min(...f.map((x) => Number(x.price)));
                    return `from ${currency} ${min.toFixed(2)}`;
                  })()}
                </div>
              </button>
            ))}
          </div>
          {zoneId && tiersForZone.length > 1 && (
            <div className="flex gap-2 mt-3 flex-wrap">
              {tiersForZone.map((f) => (
                <button key={f.id} onClick={() => setPaxTier(f.pax_tier)}
                  className={`text-xs rounded-full border px-3 py-1 ${paxTier === f.pax_tier ? "border-primary bg-primary/5" : ""}`}>
                  {f.pax_tier} pax · {currency} {Number(f.price).toFixed(2)}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="rounded-xl border p-3 bg-card grid grid-cols-1 gap-2">
        <div><Label className="text-xs">From</Label><Input value={from} onChange={(e) => setFrom(e.target.value)} placeholder="Hotel / your address" /></div>
        <div><Label className="text-xs">To</Label><Input value={to} onChange={(e) => setTo(e.target.value)} placeholder="Airport, restaurant, …" /></div>
        <div className="grid grid-cols-2 gap-2">
          <div><Label className="text-xs">Pickup time</Label><Input type="datetime-local" value={pickup} onChange={(e) => setPickup(e.target.value)} /></div>
          <div><Label className="text-xs">Pax</Label><Input type="number" min={1} value={pax} onChange={(e) => setPax(e.target.value)} /></div>
        </div>
        <div><Label className="text-xs">Flight (optional)</Label><Input value={flight} onChange={(e) => setFlight(e.target.value)} placeholder="KM123" /></div>
        <div><Label className="text-xs">Notes</Label><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Extra luggage, child seat, …" /></div>
        <div><Label className="text-xs">Promo code (optional)</Label><Input value={promo} onChange={(e) => setPromo(e.target.value.toUpperCase())} /></div>
      </div>

      {boot.addons.length > 0 && (
        <div className="rounded-xl border p-3 bg-card">
          <div className="text-xs font-medium text-muted-foreground uppercase mb-2">Add-ons</div>
          <div className="grid gap-2">
            {boot.addons.map((a) => {
              const on = selectedAddons.has(a.id);
              return (
                <button key={a.id} onClick={() => {
                  const s = new Set(selectedAddons); on ? s.delete(a.id) : s.add(a.id); setSelectedAddons(s);
                }} className={`text-left rounded-lg border p-3 flex items-center justify-between gap-2 ${on ? "border-primary bg-primary/5" : ""}`}>
                  <div className="min-w-0">
                    <div className="text-sm font-medium truncate">{a.title}</div>
                    {a.description && <div className="text-xs text-muted-foreground line-clamp-2">{a.description}</div>}
                  </div>
                  <div className="text-sm shrink-0">{a.price != null ? `${currency} ${Number(a.price).toFixed(2)}` : ""}</div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="rounded-xl border p-3 bg-card flex items-center justify-between gap-2 sticky bottom-2">
        <div className="text-sm">
          <div className="text-muted-foreground text-xs">Estimated</div>
          <div className="font-semibold">{priceHint != null ? `${currency} ${priceHint.toFixed(2)}` : "Custom quote"}</div>
        </div>
        <Button onClick={submit} disabled={busy || !from.trim() || !to.trim() || !pickup}>Send request</Button>
      </div>
    </div>
  );
}

function OffersList({ boot }: { boot: Boot }) {
  const currency = boot.portal.currency ?? "EUR";
  if (boot.offers.length === 0) return <p className="text-sm text-muted-foreground">No offers right now — check back later.</p>;
  return (
    <div className="grid gap-3">
      {boot.offers.map((o) => (
        <div key={o.id} className="rounded-xl border overflow-hidden bg-card">
          {o.image_url && <img src={o.image_url} alt="" className="w-full h-40 object-cover" />}
          <div className="p-3 space-y-1">
            <div className="font-medium">{o.title}</div>
            {o.description && <p className="text-sm text-muted-foreground">{o.description}</p>}
            <div className="flex items-center justify-between pt-2">
              <div className="text-sm font-semibold">{o.price != null ? `${currency} ${Number(o.price).toFixed(2)}` : ""}</div>
              {o.cta_url && <Button asChild size="sm" variant="outline"><a href={o.cta_url} target="_blank" rel="noreferrer">{o.cta_label || "View"}</a></Button>}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function MyBookings({ boot }: { boot: Boot }) {
  if (boot.bookings.length === 0) return <p className="text-sm text-muted-foreground">No bookings yet.</p>;
  return (
    <div className="space-y-2">
      {boot.bookings.map((b: any) => (
        <div key={b.id} className="rounded-xl border p-3 bg-card">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="text-sm font-medium truncate">{b.payload?.from_location} → {b.payload?.to_location}</div>
              <div className="text-xs text-muted-foreground">
                {b.payload?.pickup_at ? new Date(b.payload.pickup_at).toLocaleString() : "—"}
                {b.agreed_price != null ? ` · ${b.currency ?? "EUR"} ${Number(b.agreed_price).toFixed(2)}` : ""}
              </div>
            </div>
            <Badge variant={b.status === "accepted" ? "default" : b.status === "rejected" ? "destructive" : "secondary"}>
              {String(b.status).replace("_", " ")}
            </Badge>
          </div>
          {b.jobs?.drivers && (
            <div className="text-xs mt-2 text-muted-foreground">
              Driver: {String(b.jobs.drivers.name || "").split(" ")[0]} · {b.jobs.drivers.car_make_model} · {b.jobs.drivers.plate}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function Unavailable({ msg }: { msg: string }) {
  const text = msg === "expired" ? "Your session has expired — please scan the room QR again."
    : msg === "portal_disabled" ? "The hotel portal is not active."
    : msg === "not_found" ? "Session not found — please scan the QR again."
    : "This portal is unavailable right now.";
  return (
    <div className="min-h-screen grid place-items-center p-8 text-center">
      <div>
        <h1 className="text-lg font-semibold">{text}</h1>
        <p className="text-sm text-muted-foreground mt-2">Ask the reception desk if you need help.</p>
      </div>
    </div>
  );
}
