/**
 * Hotel-side management surface for the extended portal:
 * rooms + printable QRs, transport zones & fares, promos, add-ons, and offers.
 *
 * Data is loaded from and written to `/api/public/portal/$token/admin`; the
 * hotel magic token is the auth boundary (same as the existing bookings/chat
 * tabs in this portal).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { QRCodeCanvas } from "qrcode.react";
import { Copy, Plus, RefreshCw, Trash2, QrCode, Printer } from "lucide-react";

type Portal = { id: string; name: string; slug: string | null; currency?: string | null; pricing_mode?: string | null };

export function HotelManagePanel({ token, portal }: { token: string; portal: Portal }) {
  const [data, setData] = useState<any | null>(null);
  const [busy, setBusy] = useState(false);
  const base = typeof window !== "undefined" ? window.location.origin : "";

  const reload = useCallback(async () => {
    const r = await fetch(`/api/public/portal/${token}/admin`);
    if (!r.ok) { toast.error("Could not load management data"); return; }
    setData(await r.json());
  }, [token]);

  useEffect(() => { reload(); }, [reload]);

  const call = useCallback(async (body: any) => {
    setBusy(true);
    const r = await fetch(`/api/public/portal/${token}/admin`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    setBusy(false);
    if (!r.ok) { const j = await r.json().catch(() => ({})); toast.error(j.error || "Update failed"); return null; }
    return await r.json();
  }, [token]);

  if (!data) return <p className="text-sm text-muted-foreground p-2">Loading…</p>;

  return (
    <Tabs defaultValue="rooms">
      <TabsList className="flex-wrap h-auto">
        <TabsTrigger value="rooms">Rooms & QRs</TabsTrigger>
        <TabsTrigger value="pricing">Zones & fares</TabsTrigger>
        <TabsTrigger value="promos">Promos</TabsTrigger>
        <TabsTrigger value="addons">Add-ons</TabsTrigger>
        <TabsTrigger value="offers">Offers</TabsTrigger>
      </TabsList>

      <TabsContent value="rooms" className="mt-3">
        <RoomsPanel rooms={data.rooms} portal={portal} baseUrl={base} call={call} reload={reload} busy={busy} />
      </TabsContent>
      <TabsContent value="pricing" className="mt-3">
        <PricingPanel zones={data.zones} fares={data.fares} currency={portal.currency ?? "EUR"} call={call} reload={reload} busy={busy} />
      </TabsContent>
      <TabsContent value="promos" className="mt-3">
        <PromosPanel promos={data.promos} call={call} reload={reload} busy={busy} />
      </TabsContent>
      <TabsContent value="addons" className="mt-3">
        <AddonsPanel addons={data.addons} currency={portal.currency ?? "EUR"} call={call} reload={reload} busy={busy} />
      </TabsContent>
      <TabsContent value="offers" className="mt-3">
        <OffersPanel offers={data.offers} currency={portal.currency ?? "EUR"} call={call} reload={reload} busy={busy} />
      </TabsContent>
    </Tabs>
  );
}

// ------- Rooms & QRs -------
function RoomsPanel({ rooms, portal, baseUrl, call, reload, busy }: any) {
  const [n, setN] = useState(""); const [label, setLabel] = useState("");
  const [bulk, setBulk] = useState("");
  const slug = portal.slug || portal.id;

  async function addOne() {
    if (!n.trim()) return;
    await call({ action: "upsert", resource: "rooms", data: { room_number: n.trim(), label: label.trim() || null, active: true } });
    setN(""); setLabel(""); reload();
  }
  async function addBulk() {
    const entries = bulk.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((l) => {
      const [num, ...rest] = l.split(/[,;\t]/); return { room_number: num.trim(), label: rest.join(",").trim() || null };
    });
    if (entries.length === 0) return;
    const r = await call({ action: "bulk_rooms", data: entries });
    if (r) toast.success(`Added ${r.inserted} rooms`);
    setBulk(""); reload();
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border p-3 bg-card space-y-2">
        <div className="text-xs font-medium uppercase text-muted-foreground">Add a room</div>
        <div className="flex gap-2 flex-wrap">
          <Input className="max-w-[140px]" placeholder="Room #" value={n} onChange={(e) => setN(e.target.value)} />
          <Input className="max-w-[220px]" placeholder="Label (optional)" value={label} onChange={(e) => setLabel(e.target.value)} />
          <Button onClick={addOne} disabled={busy || !n.trim()}><Plus className="h-4 w-4 mr-1" />Add</Button>
        </div>
        <details className="text-xs">
          <summary className="cursor-pointer text-muted-foreground">Bulk add (one per line, format: <code>101, Sea view suite</code>)</summary>
          <div className="pt-2 space-y-2">
            <Textarea rows={5} value={bulk} onChange={(e) => setBulk(e.target.value)} placeholder="101, Sea view&#10;102, Garden&#10;103" />
            <Button variant="outline" size="sm" onClick={addBulk} disabled={busy || !bulk.trim()}>Add all</Button>
          </div>
        </details>
      </div>

      {rooms.length === 0 && <p className="text-sm text-muted-foreground">No rooms yet — add one above to generate a QR.</p>}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {rooms.map((r: any) => (
          <RoomCard key={r.id} room={r} baseUrl={baseUrl} slug={slug} call={call} reload={reload} busy={busy} />
        ))}
      </div>
    </div>
  );
}

function RoomCard({ room, baseUrl, slug, call, reload, busy }: any) {
  const url = `${baseUrl}/h/${encodeURIComponent(slug)}/r/${room.qr_token}`;
  const printRef = useRef<HTMLDivElement | null>(null);

  function printQr() {
    const canvas = printRef.current?.querySelector("canvas");
    if (!canvas) return;
    const dataUrl = (canvas as HTMLCanvasElement).toDataURL("image/png");
    const w = window.open("", "_blank", "width=480,height=640");
    if (!w) return;
    w.document.write(`<html><head><title>Room ${room.room_number} QR</title>
      <style>body{font-family:sans-serif;text-align:center;padding:32px}img{width:320px;height:320px}h1{font-size:24px;margin:16px 0 8px}</style>
      </head><body><h1>Room ${room.room_number}</h1>${room.label ? `<div>${room.label}</div>` : ""}
      <img src="${dataUrl}" /><p>Scan to book transport & view offers</p></body></html>`);
    w.document.close(); w.focus(); w.print();
  }

  return (
    <div className="rounded-xl border p-3 bg-card">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="font-semibold">Room {room.room_number}</div>
          {room.label && <div className="text-xs text-muted-foreground">{room.label}</div>}
        </div>
        <Badge variant={room.active ? "default" : "secondary"}>{room.active ? "Active" : "Off"}</Badge>
      </div>
      <div ref={printRef} className="my-3 grid place-items-center">
        <QRCodeCanvas value={url} size={160} includeMargin />
      </div>
      <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
        <span className="truncate">{url}</span>
        <button className="p-1" onClick={() => { navigator.clipboard.writeText(url); toast.success("URL copied"); }}><Copy className="h-3 w-3" /></button>
      </div>
      <div className="flex gap-1 flex-wrap mt-2">
        <Button size="sm" variant="outline" onClick={printQr}><Printer className="h-3.5 w-3.5 mr-1" />Print</Button>
        <Button size="sm" variant="outline" disabled={busy}
          onClick={async () => { const r = await call({ action: "rotate_qr", id: room.id }); if (r) { toast.success("New QR generated"); reload(); } }}>
          <RefreshCw className="h-3.5 w-3.5 mr-1" />Rotate
        </Button>
        <Button size="sm" variant="outline" disabled={busy}
          onClick={async () => { await call({ action: "upsert", resource: "rooms", data: { id: room.id, room_number: room.room_number, active: !room.active } }); reload(); }}>
          <QrCode className="h-3.5 w-3.5 mr-1" />{room.active ? "Disable" : "Enable"}
        </Button>
        <Button size="sm" variant="ghost" disabled={busy}
          onClick={async () => { if (!confirm("Delete this room?")) return; await call({ action: "delete", resource: "rooms", id: room.id }); reload(); }}>
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}

// ------- Zones & Fares -------
function PricingPanel({ zones, fares, currency, call, reload, busy }: any) {
  const [zn, setZn] = useState("");
  async function addZone() {
    if (!zn.trim()) return;
    await call({ action: "upsert", resource: "zones", data: { name: zn.trim(), active: true } });
    setZn(""); reload();
  }
  return (
    <div className="space-y-4">
      <div className="rounded-xl border p-3 bg-card space-y-2">
        <div className="text-xs font-medium uppercase text-muted-foreground">Add a transport zone</div>
        <div className="flex gap-2">
          <Input placeholder="e.g. Airport" value={zn} onChange={(e) => setZn(e.target.value)} />
          <Button onClick={addZone} disabled={busy || !zn.trim()}><Plus className="h-4 w-4 mr-1" />Add zone</Button>
        </div>
      </div>
      {zones.length === 0 && <p className="text-sm text-muted-foreground">No zones yet. Zones are transport destinations you sell (e.g. "Airport", "Valletta").</p>}
      <div className="space-y-3">
        {zones.map((z: any) => (
          <ZoneRow key={z.id} zone={z} fares={fares.filter((f: any) => f.zone_id === z.id)} currency={currency} call={call} reload={reload} busy={busy} />
        ))}
      </div>
    </div>
  );
}

function ZoneRow({ zone, fares, currency, call, reload, busy }: any) {
  const [tier, setTier] = useState("1-3");
  const [price, setPrice] = useState("");
  async function addFare() {
    if (!price) return;
    await call({ action: "upsert", resource: "fares", data: { zone_id: zone.id, pax_tier: tier, price: Number(price) } });
    setPrice(""); reload();
  }
  return (
    <div className="rounded-xl border p-3 bg-card">
      <div className="flex items-center justify-between gap-2">
        <div className="font-medium">{zone.name}</div>
        <div className="flex gap-1">
          <Button size="sm" variant="ghost" disabled={busy}
            onClick={async () => { await call({ action: "upsert", resource: "zones", data: { id: zone.id, name: zone.name, active: !zone.active } }); reload(); }}>
            {zone.active ? "Disable" : "Enable"}
          </Button>
          <Button size="sm" variant="ghost" disabled={busy}
            onClick={async () => { if (!confirm("Delete zone and its fares?")) return; await call({ action: "delete", resource: "zones", id: zone.id }); reload(); }}>
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
      <div className="mt-2 space-y-1">
        {fares.length === 0 && <p className="text-xs text-muted-foreground">No fares — add a per-pax price below.</p>}
        {fares.map((f: any) => (
          <div key={f.id} className="flex items-center gap-2 text-sm">
            <span className="w-16 shrink-0 text-muted-foreground">{f.pax_tier} pax</span>
            <span className="w-24">{currency} {Number(f.price).toFixed(2)}</span>
            <Button size="sm" variant="ghost" disabled={busy}
              onClick={async () => { await call({ action: "delete", resource: "fares", id: f.id }); reload(); }}>
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        ))}
      </div>
      <div className="mt-2 flex gap-2 flex-wrap items-end">
        <div><Label className="text-xs">Pax tier</Label><Input className="w-24" value={tier} onChange={(e) => setTier(e.target.value)} placeholder="1-3" /></div>
        <div><Label className="text-xs">Price ({currency})</Label><Input className="w-28" type="number" step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} /></div>
        <Button size="sm" onClick={addFare} disabled={busy || !price}>Add fare</Button>
      </div>
    </div>
  );
}

// ------- Promos -------
function PromosPanel({ promos, call, reload, busy }: any) {
  const [f, setF] = useState({ code: "", kind: "percent", value: "10", applies_to: "transport" });
  async function add() {
    if (!f.code.trim() || !f.value) return;
    await call({ action: "upsert", resource: "promos", data: { code: f.code, kind: f.kind, value: Number(f.value), applies_to: f.applies_to, active: true } });
    setF({ code: "", kind: "percent", value: "10", applies_to: "transport" }); reload();
  }
  return (
    <div className="space-y-3">
      <div className="rounded-xl border p-3 bg-card grid grid-cols-2 sm:grid-cols-5 gap-2 items-end">
        <div><Label className="text-xs">Code</Label><Input value={f.code} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })} placeholder="SUMMER10" /></div>
        <div><Label className="text-xs">Type</Label>
          <select className="h-9 border rounded px-2 w-full" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>
            <option value="percent">% off</option><option value="amount">Amount off</option>
          </select>
        </div>
        <div><Label className="text-xs">Value</Label><Input type="number" value={f.value} onChange={(e) => setF({ ...f, value: e.target.value })} /></div>
        <div><Label className="text-xs">Applies to</Label>
          <select className="h-9 border rounded px-2 w-full" value={f.applies_to} onChange={(e) => setF({ ...f, applies_to: e.target.value })}>
            <option value="transport">Transport</option><option value="offers">Offers</option><option value="both">Both</option>
          </select>
        </div>
        <Button onClick={add} disabled={busy || !f.code || !f.value}><Plus className="h-4 w-4 mr-1" />Add</Button>
      </div>
      <div className="space-y-2">
        {promos.length === 0 && <p className="text-sm text-muted-foreground">No promo codes yet.</p>}
        {promos.map((p: any) => (
          <div key={p.id} className="rounded-lg border p-2 flex items-center justify-between gap-2 bg-card">
            <div>
              <div className="font-mono font-semibold">{p.code}</div>
              <div className="text-xs text-muted-foreground">
                {p.kind === "percent" ? `${p.value}% off` : `${p.value} off`} · {p.applies_to} · used {p.uses_count ?? 0}{p.max_uses ? `/${p.max_uses}` : ""}
              </div>
            </div>
            <div className="flex gap-1">
              <Button size="sm" variant="ghost" onClick={async () => { await call({ action: "upsert", resource: "promos", data: { id: p.id, code: p.code, kind: p.kind, value: Number(p.value), applies_to: p.applies_to, active: !p.active } }); reload(); }}>
                {p.active ? "Disable" : "Enable"}
              </Button>
              <Button size="sm" variant="ghost" onClick={async () => { if (!confirm("Delete promo?")) return; await call({ action: "delete", resource: "promos", id: p.id }); reload(); }}>
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ------- Add-ons -------
function AddonsPanel({ addons, currency, call, reload, busy }: any) {
  return <ItemsPanel items={addons} currency={currency} resource="addons" call={call} reload={reload} busy={busy}
    title="Add-ons appear next to bookings (e.g. child seat, extra luggage, welcome drink)." />;
}
function OffersPanel({ offers, currency, call, reload, busy }: any) {
  return <ItemsPanel items={offers} currency={currency} resource="offers" call={call} reload={reload} busy={busy}
    title="Offers show on the guest home tab (e.g. hotel restaurant, tours, spa packages)." withCta />;
}

function ItemsPanel({ items, currency, resource, call, reload, busy, title, withCta }: any) {
  const empty = { title: "", description: "", price: "", image_url: "", cta_label: "", cta_url: "" };
  const [f, setF] = useState<any>(empty);
  async function save() {
    if (!f.title.trim()) return;
    const data: any = {
      title: f.title.trim(),
      description: f.description.trim() || null,
      price: f.price ? Number(f.price) : null,
      image_url: f.image_url.trim() || null,
      active: true,
    };
    if (withCta) { data.cta_label = f.cta_label || null; data.cta_url = f.cta_url || null; }
    if (f.id) data.id = f.id;
    await call({ action: "upsert", resource, data });
    setF(empty); reload();
  }
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">{title}</p>
      <div className="rounded-xl border p-3 bg-card grid gap-2">
        <div className="grid grid-cols-2 gap-2">
          <div><Label className="text-xs">Title</Label><Input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></div>
          <div><Label className="text-xs">Price ({currency})</Label><Input type="number" step="0.01" value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} /></div>
        </div>
        <div><Label className="text-xs">Description</Label><Textarea rows={2} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></div>
        <div><Label className="text-xs">Image URL (optional)</Label><Input value={f.image_url} onChange={(e) => setF({ ...f, image_url: e.target.value })} placeholder="https://…" /></div>
        {withCta && (
          <div className="grid grid-cols-2 gap-2">
            <div><Label className="text-xs">Button label</Label><Input value={f.cta_label} onChange={(e) => setF({ ...f, cta_label: e.target.value })} placeholder="Book table" /></div>
            <div><Label className="text-xs">Button link</Label><Input value={f.cta_url} onChange={(e) => setF({ ...f, cta_url: e.target.value })} placeholder="https://…" /></div>
          </div>
        )}
        <div className="flex justify-end gap-2">
          {f.id && <Button variant="ghost" onClick={() => setF(empty)}>Cancel</Button>}
          <Button onClick={save} disabled={busy || !f.title.trim()}>{f.id ? "Save" : "Add"}</Button>
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {items.map((i: any) => (
          <div key={i.id} className="rounded-lg border p-2 bg-card flex gap-2">
            {i.image_url && <img src={i.image_url} className="h-16 w-16 object-cover rounded" alt="" />}
            <div className="flex-1 min-w-0">
              <div className="font-medium truncate">{i.title}</div>
              {i.description && <div className="text-xs text-muted-foreground line-clamp-2">{i.description}</div>}
              <div className="text-xs">{i.price != null ? `${currency} ${Number(i.price).toFixed(2)}` : ""}</div>
            </div>
            <div className="flex flex-col gap-1">
              <Button size="sm" variant="ghost" onClick={() => setF({
                id: i.id, title: i.title, description: i.description ?? "", price: i.price ?? "", image_url: i.image_url ?? "",
                cta_label: i.cta_label ?? "", cta_url: i.cta_url ?? "",
              })}>Edit</Button>
              <Button size="sm" variant="ghost" onClick={async () => { if (!confirm("Delete?")) return; await call({ action: "delete", resource, id: i.id }); reload(); }}>
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
