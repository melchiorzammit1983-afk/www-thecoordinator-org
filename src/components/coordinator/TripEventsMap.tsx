import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getTripMap } from "@/lib/trip-map.functions";
import { updateTripMapEvent } from "@/lib/trip-map.functions";
import { loadGoogleMaps } from "@/components/driver/DriverDashboardMap";
import { formatEta } from "@/lib/trip-display";
import { supabase } from "@/integrations/supabase/client";
import { TripTimelinePdfButton } from "@/components/coordinator/TripTimelinePdfButton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

/**
 * Live + historical trip map for the coordinator sheet.
 *
 * Pins are rendered as emoji-and-sequence badges (chronological order),
 * clustered when they overlap on-screen, and filterable by category
 * (Movement / Boarding / Waiting / Driver actions / Safety).
 *
 * Coordinators can click any pin to open its info window, then tap "Edit"
 * to correct the pax name, notes, or drag-nudge the pin location.
 */

type Category = "movement" | "boarding" | "waiting" | "driver" | "safety";

type EventMeta = { label: string; color: string; icon: string; category: Category };

const EVENT_META: Record<string, EventMeta> = {
  en_route:            { label: "On the way",             color: "#0ea5e9", icon: "🚗", category: "movement" },
  arrived_pickup:      { label: "Arrived at pickup",      color: "#22c55e", icon: "🟢", category: "movement" },
  in_progress:         { label: "Passenger on board",     color: "#3b82f6", icon: "🔵", category: "movement" },
  completed:           { label: "Trip completed",         color: "#8b5cf6", icon: "🏁", category: "movement" },
  actual_dropoff:      { label: "Actual drop-off",        color: "#ef4444", icon: "🔴", category: "movement" },
  back_to_waiting:     { label: "Back to waiting",        color: "#64748b", icon: "↩️", category: "movement" },
  arrived_pickup_override: { label: "Arrived (override)", color: "#f97316", icon: "⚠️", category: "movement" },
  status_corrected:    { label: "Status corrected",       color: "#64748b", icon: "↺",  category: "movement" },
  coord_status_override: { label: "Coord. override",      color: "#f97316", icon: "🛠️", category: "movement" },

  pax_boarded:         { label: "Passenger boarded",      color: "#16a34a", icon: "🧍", category: "boarding" },
  boarding_requested:  { label: "Boarding approval req.", color: "#a855f7", icon: "🙋", category: "boarding" },
  boarding_approved:   { label: "Boarding approved",      color: "#22c55e", icon: "✅", category: "boarding" },
  boarding_rejected:   { label: "Boarding rejected",      color: "#dc2626", icon: "⛔", category: "boarding" },
  pax_no_show:         { label: "Passenger no-show",      color: "#94a3b8", icon: "👤", category: "boarding" },
  pax_cancelled:       { label: "Passenger cancelled",    color: "#94a3b8", icon: "🚫", category: "boarding" },

  wait_started:        { label: "Waiting started",        color: "#f59e0b", icon: "⏱️", category: "waiting" },
  wait_ended:          { label: "Waiting ended",          color: "#f59e0b", icon: "▶️", category: "waiting" },

  navigate_opened:     { label: "Navigation opened",      color: "#94a3b8", icon: "🧭", category: "driver" },
  passenger_called:    { label: "Passenger called",       color: "#94a3b8", icon: "📞", category: "driver" },
  pickup_snap:         { label: "Pickup GPS snapped",     color: "#f59e0b", icon: "📍", category: "driver" },
  dropoff_snap:        { label: "Drop-off GPS snapped",   color: "#f59e0b", icon: "🎯", category: "driver" },

  emergency_override:  { label: "Emergency override",     color: "#dc2626", icon: "⚠️", category: "safety" },
  safety_concern:      { label: "Safety concern",         color: "#dc2626", icon: "🛑", category: "safety" },
  breakdown:           { label: "Breakdown",              color: "#dc2626", icon: "🔧", category: "safety" },
};

const CATEGORY_META: Record<Category, { label: string; color: string }> = {
  movement: { label: "Movement",       color: "#3b82f6" },
  boarding: { label: "Boarding",       color: "#16a34a" },
  waiting:  { label: "Waiting",        color: "#f59e0b" },
  driver:   { label: "Driver actions", color: "#64748b" },
  safety:   { label: "Safety",         color: "#dc2626" },
};

function fmtTime(iso: string) {
  try {
    return new Date(iso).toLocaleString([], {
      hour: "2-digit",
      minute: "2-digit",
      day: "2-digit",
      month: "short",
    });
  } catch {
    return iso;
  }
}

/** SVG data URL for an emoji-and-number pin badge. */
function pinIcon(color: string, emoji: string, seq: number) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="34" height="34" viewBox="0 0 34 34">
    <circle cx="17" cy="17" r="13" fill="${color}" stroke="#ffffff" stroke-width="2.5"/>
    <text x="17" y="21" text-anchor="middle" font-size="14" font-family="Apple Color Emoji, Segoe UI Emoji, sans-serif">${emoji}</text>
    <circle cx="27" cy="7" r="6.5" fill="#0f172a" stroke="#ffffff" stroke-width="1.5"/>
    <text x="27" y="9.5" text-anchor="middle" font-size="7.5" font-weight="700" fill="#ffffff" font-family="system-ui, sans-serif">${seq}</text>
  </svg>`;
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

/** Cluster bubble icon. */
function clusterIcon(count: number) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 40 40">
    <circle cx="20" cy="20" r="17" fill="#0f172a" stroke="#ffffff" stroke-width="2.5" opacity="0.92"/>
    <text x="20" y="24" text-anchor="middle" font-size="14" font-weight="700" fill="#ffffff" font-family="system-ui, sans-serif">${count}</text>
  </svg>`;
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

type EventRow = {
  id: string;
  event_type: string;
  lat: number | null;
  lng: number | null;
  notes: string | null;
  meta: string | null;
  occurred_at: string;
  payout_delta_eur: number;
  trust_delta: number;
  seq?: number;
};

export function TripEventsMap({
  jobId,
  isLive,
}: {
  jobId: string;
  isLive: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const overlaysRef = useRef<any[]>([]);
  const infoRef = useRef<any>(null);
  const [ready, setReady] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [hidden, setHidden] = useState<Set<Category>>(new Set());
  const [zoomTick, setZoomTick] = useState(0);
  const [editing, setEditing] = useState<EventRow | null>(null);

  const fn = useServerFn(getTripMap);
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["trip-map", jobId],
    queryFn: () => fn({ data: { job_id: jobId } }) as Promise<any>,
    refetchInterval: isLive ? 30_000 : false,
    staleTime: isLive ? 15_000 : 5 * 60_000,
  });

  // Realtime refetch on any new pin.
  useEffect(() => {
    if (!isLive) return;
    const ch = supabase
      .channel(`trip-map-events:${jobId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "trip_map_events", filter: `job_id=eq.${jobId}` },
        () => qc.invalidateQueries({ queryKey: ["trip-map", jobId] }),
      )
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [isLive, jobId, qc]);

  // Boot map
  useEffect(() => {
    let cancelled = false;
    loadGoogleMaps()
      .then((gmaps) => {
        if (cancelled || !containerRef.current) return;
        const map = new gmaps.Map(containerRef.current, {
          center: { lat: 35.9, lng: 14.5 },
          zoom: 11,
          disableDefaultUI: true,
          clickableIcons: false,
          gestureHandling: "greedy",
          styles: [{ featureType: "poi", stylers: [{ visibility: "off" }] }],
        });
        map.addListener("zoom_changed", () => setZoomTick((t) => t + 1));
        mapRef.current = map;
        infoRef.current = new gmaps.InfoWindow();
        setReady(true);
      })
      .catch((e: Error) => !cancelled && setErr(e.message));
    return () => { cancelled = true; };
  }, []);

  // Sort + assign sequence numbers.
  const sequencedEvents: EventRow[] = useMemo(() => {
    const evs: EventRow[] = (q.data?.events ?? []) as EventRow[];
    return [...evs]
      .sort((a, b) => new Date(a.occurred_at).getTime() - new Date(b.occurred_at).getTime())
      .map((e, i) => ({ ...e, seq: i + 1 }));
  }, [q.data]);

  // Category counts (all events, unfiltered).
  const categoryCounts = useMemo(() => {
    const c: Record<Category, number> = { movement: 0, boarding: 0, waiting: 0, driver: 0, safety: 0 };
    for (const ev of sequencedEvents) {
      const meta = EVENT_META[ev.event_type];
      if (meta) c[meta.category]++;
    }
    return c;
  }, [sequencedEvents]);

  // Draw pins + breadcrumb whenever data / filters / zoom changes.
  useEffect(() => {
    if (!ready || !q.data) return;
    const gmaps = (window as any).google?.maps;
    const map = mapRef.current;
    if (!gmaps || !map) return;

    for (const o of overlaysRef.current) {
      try { o.setMap(null); } catch { /* noop */ }
    }
    overlaysRef.current = [];

    const bounds = new gmaps.LatLngBounds();
    const job = q.data.job;

    // A / B planned pins
    if (job.pickup_lat != null && job.pickup_lng != null) {
      const m = new gmaps.Marker({
        map,
        position: { lat: Number(job.pickup_lat), lng: Number(job.pickup_lng) },
        label: { text: "A", color: "#fff", fontWeight: "700" },
        title: `Pickup — ${job.pickup_label}`,
      });
      overlaysRef.current.push(m);
      bounds.extend(m.getPosition());
    }
    if (job.dropoff_lat != null && job.dropoff_lng != null) {
      const m = new gmaps.Marker({
        map,
        position: { lat: Number(job.dropoff_lat), lng: Number(job.dropoff_lng) },
        label: { text: "B", color: "#fff", fontWeight: "700" },
        title: `Drop-off — ${job.dropoff_label}`,
      });
      overlaysRef.current.push(m);
      bounds.extend(m.getPosition());
    }

    // Breadcrumb polyline
    const crumb = (q.data.breadcrumb ?? []).filter((p: any) => p.lat != null && p.lng != null);
    if (crumb.length > 1) {
      const line = new gmaps.Polyline({
        map,
        path: crumb.map((p: any) => ({ lat: Number(p.lat), lng: Number(p.lng) })),
        strokeColor: "#2563eb",
        strokeOpacity: 0.55,
        strokeWeight: 4,
      });
      overlaysRef.current.push(line);
      for (const p of crumb) bounds.extend({ lat: Number(p.lat), lng: Number(p.lng) });
    }

    // Visible events (filter by hidden categories, drop no-coords).
    const visible = sequencedEvents.filter((ev) => {
      if (ev.lat == null || ev.lng == null) return false;
      const meta = EVENT_META[ev.event_type];
      if (!meta) return true;
      return !hidden.has(meta.category);
    });

    // Simple pixel-space clustering. Uses the map projection to compute
    // pixel positions at the current zoom; buckets pins whose pixel
    // distance is under CLUSTER_PX and renders a single count bubble.
    const CLUSTER_PX = 30;
    const projection = map.getProjection?.();
    const zoom = map.getZoom?.() ?? 11;
    const scale = Math.pow(2, zoom);
    type Cluster = { key: string; px: { x: number; y: number }; events: EventRow[] };
    const clusters: Cluster[] = [];

    for (const ev of visible) {
      const ll = new gmaps.LatLng(Number(ev.lat), Number(ev.lng));
      let px = { x: 0, y: 0 };
      if (projection) {
        const world = projection.fromLatLngToPoint(ll);
        px = { x: world.x * scale, y: world.y * scale };
      }
      let placed = false;
      for (const c of clusters) {
        const dx = c.px.x - px.x;
        const dy = c.px.y - px.y;
        if (dx * dx + dy * dy <= CLUSTER_PX * CLUSTER_PX) {
          c.events.push(ev);
          placed = true;
          break;
        }
      }
      if (!placed) clusters.push({ key: ev.id, px, events: [ev] });
      bounds.extend(ll);
    }

    for (const c of clusters) {
      if (c.events.length === 1) {
        const ev = c.events[0];
        const meta = EVENT_META[ev.event_type] ?? { label: ev.event_type, color: "#64748b", icon: "•", category: "driver" as Category };
        const marker = new gmaps.Marker({
          map,
          position: { lat: Number(ev.lat), lng: Number(ev.lng) },
          icon: {
            url: pinIcon(meta.color, meta.icon, ev.seq ?? 1),
            anchor: new gmaps.Point(17, 17),
            scaledSize: new gmaps.Size(34, 34),
          },
          title: `#${ev.seq} · ${meta.label} · ${fmtTime(ev.occurred_at)}`,
        });
        marker.addListener("click", () => openInfo(ev, marker, map, job));
        overlaysRef.current.push(marker);
      } else {
        // Cluster: place at centroid.
        const lat = c.events.reduce((s, e) => s + Number(e.lat), 0) / c.events.length;
        const lng = c.events.reduce((s, e) => s + Number(e.lng), 0) / c.events.length;
        const marker = new gmaps.Marker({
          map,
          position: { lat, lng },
          icon: {
            url: clusterIcon(c.events.length),
            anchor: new gmaps.Point(20, 20),
            scaledSize: new gmaps.Size(40, 40),
          },
          title: `${c.events.length} events here — click to expand`,
          zIndex: 999,
        });
        marker.addListener("click", () => {
          openClusterInfo(c.events, marker, map, job);
        });
        overlaysRef.current.push(marker);
      }
    }

    if (!bounds.isEmpty() && zoomTick === 0) {
      map.fitBounds(bounds, { top: 40, bottom: 40, left: 40, right: 40 });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, q.data, sequencedEvents, hidden, zoomTick]);

  function openInfo(ev: EventRow, anchor: any, map: any, job: any) {
    const meta = EVENT_META[ev.event_type] ?? { label: ev.event_type, color: "#64748b", icon: "•" };
    const noteHtml = ev.notes
      ? `<div style="margin-top:4px;color:#334155;">${escapeHtml(ev.notes)}</div>`
      : "";
    const plannedDelta = deltaFromPlanned(ev, job);
    const metaHtml = renderMetaHtml(ev);
    const impactHtml = renderImpactHtml(ev);
    const editBtn = `<button data-edit-event="${ev.id}" style="margin-top:8px;padding:3px 8px;border:1px solid #cbd5e1;border-radius:6px;background:#f8fafc;color:#0f172a;font-size:11px;cursor:pointer;">Edit pin</button>`;
    infoRef.current?.setContent(
      `<div style="min-width:220px;font:12px system-ui,sans-serif;">
         <div style="font-weight:600;">#${ev.seq} ${meta.icon} ${meta.label}</div>
         <div style="color:#64748b;">${fmtTime(ev.occurred_at)}</div>
         ${plannedDelta ? `<div style="color:#b45309;margin-top:2px;">${plannedDelta}</div>` : ""}
         ${impactHtml}
         ${noteHtml}
         ${metaHtml}
         ${editBtn}
       </div>`,
    );
    infoRef.current?.open({ map, anchor });
    // Wire the edit button on next tick (Google info-window renders async).
    setTimeout(() => {
      const el = document.querySelector<HTMLButtonElement>(`[data-edit-event="${ev.id}"]`);
      if (el) el.onclick = () => { infoRef.current?.close(); setEditing(ev); };
    }, 60);
  }

  function openClusterInfo(events: EventRow[], anchor: any, map: any, _job: any) {
    const rows = events
      .sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0))
      .map((ev) => {
        const meta = EVENT_META[ev.event_type] ?? { label: ev.event_type, color: "#64748b", icon: "•" };
        return `<div style="display:flex;align-items:center;gap:6px;padding:3px 0;border-bottom:1px solid #f1f5f9;">
          <span style="display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:9999px;background:${meta.color};color:#fff;font-size:12px;">${meta.icon}</span>
          <span style="flex:1;color:#0f172a;">#${ev.seq} ${escapeHtml(meta.label)}</span>
          <span style="color:#64748b;font-size:11px;">${fmtTime(ev.occurred_at)}</span>
        </div>`;
      }).join("");
    infoRef.current?.setContent(
      `<div style="min-width:260px;max-height:260px;overflow:auto;font:12px system-ui,sans-serif;">
         <div style="font-weight:600;margin-bottom:4px;">${events.length} events at this spot</div>
         ${rows}
         <div style="color:#64748b;margin-top:6px;font-size:11px;">Zoom in to open individual pins.</div>
       </div>`,
    );
    infoRef.current?.open({ map, anchor });
  }

  const plan = q.data?.job?.planned_duration_sec ?? null;
  const live = q.data?.job?.live_eta_sec ?? null;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-xs">
        <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 font-medium">
          Plan {formatEta(plan) ?? "—"}
        </span>
        <span
          className={`inline-flex items-center rounded-full px-2 py-0.5 font-medium ${
            live == null
              ? "bg-muted text-muted-foreground"
              : plan && live > plan + 60
                ? "bg-red-500/10 text-red-700 dark:text-red-300"
                : plan && live < plan - 60
                  ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                  : "bg-primary/10 text-primary"
          }`}
        >
          Live {formatEta(live) ?? "—"}
        </span>
        {q.data?.job?.live_eta_updated_at && (
          <span className="text-[10px] text-muted-foreground">
            · updated {fmtTime(q.data.job.live_eta_updated_at)}
          </span>
        )}
        <div className="ml-auto">
          <TripTimelinePdfButton jobId={jobId} />
        </div>
      </div>

      {/* Category filter chips */}
      <div className="flex flex-wrap gap-1.5">
        {(Object.keys(CATEGORY_META) as Category[]).map((cat) => {
          const info = CATEGORY_META[cat];
          const count = categoryCounts[cat];
          const off = hidden.has(cat);
          return (
            <button
              key={cat}
              type="button"
              onClick={() => {
                setHidden((prev) => {
                  const next = new Set(prev);
                  if (next.has(cat)) next.delete(cat); else next.add(cat);
                  return next;
                });
              }}
              className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium transition ${
                off
                  ? "bg-background text-muted-foreground opacity-60"
                  : "bg-card"
              }`}
              title={off ? `Show ${info.label}` : `Hide ${info.label}`}
            >
              <span
                className="inline-block h-2 w-2 rounded-full"
                style={{ background: info.color }}
              />
              {info.label}
              <span className="text-muted-foreground">· {count}</span>
            </button>
          );
        })}
      </div>

      <div
        ref={containerRef}
        className="w-full h-72 rounded-md border bg-muted"
      />
      {err && (
        <div className="text-xs text-muted-foreground">Map unavailable: {err}</div>
      )}

      <EditEventDialog
        event={editing}
        onOpenChange={(o) => { if (!o) setEditing(null); }}
        onSaved={() => { setEditing(null); qc.invalidateQueries({ queryKey: ["trip-map", jobId] }); }}
      />
    </div>
  );
}

function EditEventDialog({
  event,
  onOpenChange,
  onSaved,
}: {
  event: EventRow | null;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const fn = useServerFn(updateTripMapEvent);
  const [paxName, setPaxName] = useState("");
  const [notes, setNotes] = useState("");
  const [lat, setLat] = useState("");
  const [lng, setLng] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!event) return;
    let m: any = null;
    try { m = event.meta ? JSON.parse(event.meta) : null; } catch { /* noop */ }
    setPaxName((m && (m.pax_name as string)) ?? "");
    setNotes(event.notes ?? "");
    setLat(event.lat != null ? String(event.lat) : "");
    setLng(event.lng != null ? String(event.lng) : "");
  }, [event]);

  async function save() {
    if (!event) return;
    setBusy(true);
    try {
      const payload: any = { event_id: event.id };
      if (paxName.trim()) payload.pax_name = paxName.trim();
      if (notes.trim() !== (event.notes ?? "")) payload.notes = notes.trim();
      const nlat = Number(lat);
      const nlng = Number(lng);
      if (Number.isFinite(nlat) && Number.isFinite(nlng)) {
        payload.lat = nlat;
        payload.lng = nlng;
      }
      await fn({ data: payload });
      toast.success("Pin updated");
      onSaved();
    } catch (e: any) {
      toast.error(e?.message ?? "Could not update pin");
    } finally {
      setBusy(false);
    }
  }

  const meta = event ? EVENT_META[event.event_type] : null;
  return (
    <Dialog open={!!event} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {meta ? `Edit pin — ${meta.label}` : "Edit pin"}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          {event && (
            <div className="text-xs text-muted-foreground">
              #{event.seq} · {fmtTime(event.occurred_at)}
            </div>
          )}
          <div>
            <Label className="text-xs">Passenger name (if applicable)</Label>
            <Input value={paxName} onChange={(e) => setPaxName(e.target.value)} placeholder="e.g. Jane Smith" />
          </div>
          <div>
            <Label className="text-xs">Notes</Label>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional context" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-xs">Latitude</Label>
              <Input value={lat} onChange={(e) => setLat(e.target.value)} inputMode="decimal" />
            </div>
            <div>
              <Label className="text-xs">Longitude</Label>
              <Input value={lng} onChange={(e) => setLng(e.target.value)} inputMode="decimal" />
            </div>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Edits are audited — your user ID and edit time are recorded on the pin.
          </p>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
          <Button onClick={save} disabled={busy}>{busy ? "Saving…" : "Save"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function renderImpactHtml(ev: EventRow): string {
  const payout = Number(ev.payout_delta_eur ?? 0);
  const trust = Number(ev.trust_delta ?? 0);
  if (!payout && !trust) return "";
  const chips: string[] = [];
  if (payout) {
    chips.push(
      `<span style="display:inline-block;padding:1px 6px;border-radius:9999px;background:#ecfdf5;color:#047857;font-weight:600;">Payout +€${payout.toFixed(2)}</span>`,
    );
  }
  if (trust) {
    const positive = trust > 0;
    chips.push(
      `<span style="display:inline-block;padding:1px 6px;border-radius:9999px;background:${
        positive ? "#eff6ff" : "#fef2f2"
      };color:${positive ? "#1d4ed8" : "#b91c1c"};font-weight:600;">Trust ${
        positive ? "+" : ""
      }${trust}</span>`,
    );
  }
  return `<div style="margin-top:6px;display:flex;gap:4px;flex-wrap:wrap;">${chips.join("")}</div>`;
}

function renderMetaHtml(ev: EventRow): string {
  let meta: Record<string, unknown> | null = null;
  try {
    meta = typeof ev.meta === "string" ? JSON.parse(ev.meta) : (ev.meta as any);
  } catch { meta = null; }
  if (!meta || typeof meta !== "object") return "";
  const rows: string[] = [];
  const push = (label: string, val: unknown) => {
    if (val == null || val === "") return;
    rows.push(
      `<div style="display:flex;justify-content:space-between;gap:8px;color:#475569;">
         <span>${escapeHtml(label)}</span>
         <span style="color:#0f172a;font-weight:500;">${escapeHtml(String(val))}</span>
       </div>`,
    );
  };
  if (meta.elapsed_minutes != null) push("Elapsed", `${meta.elapsed_minutes} min`);
  if (meta.chargeable_minutes != null) push("Chargeable", `${meta.chargeable_minutes} min`);
  if (meta.calculated_amount != null) push("Calculated", `€${Number(meta.calculated_amount).toFixed(2)}`);
  if (meta.agreed_amount != null) push("Agreed", `€${Number(meta.agreed_amount).toFixed(2)}`);
  if (meta.pax_name) push("Passenger", meta.pax_name as string);
  if (meta.method) push("Method", String(meta.method).toUpperCase());
  if (meta.pax_summary && typeof meta.pax_summary === "object") {
    const s = meta.pax_summary as Record<string, number>;
    push("Boarded", s.boarded ?? 0);
    push("Pending", s.pending ?? 0);
  }
  if (meta.reason) push("Reason", String(meta.reason).replace(/_/g, " "));
  if (meta.action) push("Action", String(meta.action).replace(/_/g, " "));
  if (meta.from_status && meta.to_status) push("Transition", `${meta.from_status} → ${meta.to_status}`);
  if (meta.street_address) push("Near", meta.street_address as string);
  if (meta.photo_url) {
    rows.push(
      `<div style="margin-top:6px;"><a href="${escapeHtml(String(meta.photo_url))}" target="_blank" rel="noopener" style="color:#2563eb;">View photo</a></div>`,
    );
  }
  if (!rows.length) return "";
  return `<div style="margin-top:6px;display:grid;gap:2px;font-size:11px;">${rows.join("")}</div>`;
}

function deltaFromPlanned(ev: EventRow, job: any): string | null {
  if (ev.event_type !== "actual_dropoff") return null;
  const pLat = Number(job.dropoff_lat);
  const pLng = Number(job.dropoff_lng);
  if (!Number.isFinite(pLat) || !Number.isFinite(pLng)) return null;
  const d = haversine(pLat, pLng, Number(ev.lat), Number(ev.lng));
  if (!Number.isFinite(d)) return null;
  if (d < 100) return null;
  return `${Math.round(d)} m from planned drop-off`;
}

function haversine(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371000;
  const toRad = (x: number) => (x * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}
