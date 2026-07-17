import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getTripMap } from "@/lib/trip-map.functions";
import { loadGoogleMaps } from "@/components/driver/DriverDashboardMap";
import { formatEta } from "@/lib/trip-display";
import { supabase } from "@/integrations/supabase/client";
import { TripTimelinePdfButton } from "@/components/coordinator/TripTimelinePdfButton";

/**
 * Live + historical trip map for the coordinator sheet.
 *
 * Renders:
 *  - Planned pickup (A) and drop-off (B) markers.
 *  - A thin polyline breadcrumb of the driver's recorded GPS pings.
 *  - Event pins (arrived at pickup, in-progress, actual drop-off, driver GPS
 *    snaps, emergency overrides). Hover / tap → info-window with the type,
 *    timestamp and any note.
 *
 * Used for both live trips (auto-refreshes every 30 s while open) and
 * completed trips (single fetch, read-only replay).
 */
const EVENT_META: Record<
  string,
  { label: string; color: string; icon: string }
> = {
  en_route:            { label: "On the way",             color: "#0ea5e9", icon: "🚗" },
  arrived_pickup:      { label: "Arrived at pickup",      color: "#22c55e", icon: "🟢" },
  in_progress:         { label: "Passenger on board",     color: "#3b82f6", icon: "🔵" },
  completed:           { label: "Trip completed",         color: "#8b5cf6", icon: "🏁" },
  actual_dropoff:      { label: "Actual drop-off",        color: "#ef4444", icon: "🔴" },
  back_to_waiting:     { label: "Back to waiting",        color: "#64748b", icon: "↩️" },
  wait_started:        { label: "Waiting started",        color: "#f59e0b", icon: "⏱️" },
  wait_ended:          { label: "Waiting ended",          color: "#f59e0b", icon: "▶️" },
  boarding_requested:  { label: "Boarding approval req.", color: "#a855f7", icon: "🙋" },
  boarding_approved:   { label: "Boarding approved",      color: "#22c55e", icon: "✅" },
  boarding_rejected:   { label: "Boarding rejected",      color: "#dc2626", icon: "⛔" },
  pax_no_show:         { label: "Passenger no-show",      color: "#94a3b8", icon: "👤" },
  pax_cancelled:       { label: "Passenger cancelled",    color: "#94a3b8", icon: "🚫" },
  navigate_opened:     { label: "Navigation opened",      color: "#94a3b8", icon: "🧭" },
  passenger_called:    { label: "Passenger called",       color: "#94a3b8", icon: "📞" },
  pickup_snap:         { label: "Pickup GPS snapped",     color: "#f59e0b", icon: "📍" },
  dropoff_snap:        { label: "Drop-off GPS snapped",   color: "#f59e0b", icon: "🎯" },
  emergency_override:  { label: "Emergency override",     color: "#dc2626", icon: "⚠️" },
  safety_concern:      { label: "Safety concern",         color: "#dc2626", icon: "🛑" },
  breakdown:           { label: "Breakdown",              color: "#dc2626", icon: "🔧" },
  status_corrected:    { label: "Status corrected",       color: "#64748b", icon: "↺" },
  arrived_pickup_override: { label: "Arrived (override)", color: "#f97316", icon: "⚠️" },
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

  const fn = useServerFn(getTripMap);
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["trip-map", jobId],
    queryFn: () => fn({ data: { job_id: jobId } }) as Promise<any>,
    refetchInterval: isLive ? 30_000 : false,
    staleTime: isLive ? 15_000 : 5 * 60_000,
  });

  // Realtime: refetch immediately whenever a new pin is inserted for this job
  // so the coordinator sees driver actions the moment they happen.
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
        mapRef.current = map;
        infoRef.current = new gmaps.InfoWindow();
        setReady(true);
      })
      .catch((e: Error) => !cancelled && setErr(e.message));
    return () => {
      cancelled = true;
    };
  }, []);

  // Draw pins + breadcrumb whenever data changes
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

    // Event pins
    for (const ev of (q.data.events ?? []) as any[]) {
      if (ev.lat == null || ev.lng == null) continue;
      const meta = EVENT_META[ev.event_type] ?? {
        label: ev.event_type, color: "#64748b", icon: "•",
      };
      const marker = new gmaps.Marker({
        map,
        position: { lat: Number(ev.lat), lng: Number(ev.lng) },
        icon: {
          path: gmaps.SymbolPath.CIRCLE,
          scale: 8,
          fillColor: meta.color,
          fillOpacity: 1,
          strokeColor: "#ffffff",
          strokeWeight: 2,
        },
        title: `${meta.label} · ${fmtTime(ev.occurred_at)}`,
      });
      marker.addListener("click", () => {
        const noteHtml = ev.notes
          ? `<div style="margin-top:4px;color:#334155;">${escapeHtml(ev.notes)}</div>`
          : "";
        const plannedDelta = deltaFromPlanned(ev, job);
        const metaHtml = renderMetaHtml(ev);
        const impactHtml = renderImpactHtml(ev);
        infoRef.current?.setContent(
          `<div style="min-width:200px;font:12px system-ui,sans-serif;">
             <div style="font-weight:600;">${meta.icon} ${meta.label}</div>
             <div style="color:#64748b;">${fmtTime(ev.occurred_at)}</div>
             ${plannedDelta ? `<div style="color:#b45309;margin-top:2px;">${plannedDelta}</div>` : ""}
             ${impactHtml}
             ${noteHtml}
             ${metaHtml}
           </div>`,
        );
        infoRef.current?.open({ map, anchor: marker });
      });
      overlaysRef.current.push(marker);
      bounds.extend(marker.getPosition());
    }

    if (!bounds.isEmpty()) {
      map.fitBounds(bounds, { top: 40, bottom: 40, left: 40, right: 40 });
    }
  }, [ready, q.data]);

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
      <div
        ref={containerRef}
        className="w-full h-72 rounded-md border bg-muted"
      />
      {err && (
        <div className="text-xs text-muted-foreground">Map unavailable: {err}</div>
      )}
      <div className="flex flex-wrap gap-2 text-[10px] text-muted-foreground">
        {Object.entries(EVENT_META).map(([k, v]) => (
          <span key={k} className="inline-flex items-center gap-1">
            <span
              className="inline-block h-2 w-2 rounded-full"
              style={{ background: v.color }}
            />
            {v.label}
          </span>
        ))}
      </div>
    </div>
  );
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

// Render the payout / trust impact chip inside the info window when the
// event has a recorded impact (e.g. wait charge, no-show fee, trust penalty).
function renderImpactHtml(ev: any): string {
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

// Render human-friendly `meta` fields on the info window (waiting duration
// and amount, boarding approval id, pax names, override context, etc).
function renderMetaHtml(ev: any): string {
  let meta: Record<string, unknown> | null = null;
  try {
    meta = typeof ev.meta === "string" ? JSON.parse(ev.meta) : ev.meta;
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

// Return a human-readable note about how far the actual event drifted from
// the planned point (only meaningful for the drop-off pin).
function deltaFromPlanned(ev: any, job: any): string | null {
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
