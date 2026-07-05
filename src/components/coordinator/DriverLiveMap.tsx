import { useEffect, useMemo, useRef, useState } from "react";

const BROWSER_KEY = import.meta.env.VITE_LOVABLE_CONNECTOR_GOOGLE_MAPS_BROWSER_KEY as string | undefined;
const CHANNEL_ID = import.meta.env.VITE_LOVABLE_CONNECTOR_GOOGLE_MAPS_TRACKING_ID as string | undefined;

export type LivePoint = {
  driver_id: string;
  job_id: string;
  driver_name: string;
  from_location: string | null;
  to_location: string | null;
  latitude: number;
  longitude: number;
  accuracy_m: number | null;
  heading: number | null;
  speed_mps: number | null;
  captured_at: string;
  eta_sec?: number | null;
  distance_m?: number | null;
  next_instruction?: string | null;
  destination_label?: string | null;
  wait_started_at?: string | null;
};

type GMaps = any;

let mapsLoader: Promise<GMaps> | null = null;

function loadGoogleMaps(): Promise<GMaps> {
  if (typeof window === "undefined") return Promise.reject(new Error("no_window"));
  if ((window as any).google?.maps) return Promise.resolve((window as any).google.maps);
  if (mapsLoader) return mapsLoader;
  if (!BROWSER_KEY) return Promise.reject(new Error("missing_browser_key"));

  mapsLoader = new Promise<GMaps>((resolve, reject) => {
    const cbName = `__lovable_gmaps_cb_${Math.random().toString(36).slice(2)}`;
    (window as any)[cbName] = () => {
      try { resolve((window as any).google.maps); }
      finally { delete (window as any)[cbName]; }
    };
    const s = document.createElement("script");
    const params = new URLSearchParams({
      key: BROWSER_KEY,
      loading: "async",
      callback: cbName,
    });
    if (CHANNEL_ID) params.set("channel", CHANNEL_ID);
    s.src = `https://maps.googleapis.com/maps/api/js?${params.toString()}`;
    s.async = true;
    s.defer = true;
    s.onerror = () => { mapsLoader = null; reject(new Error("gmaps_load_failed")); };
    document.head.appendChild(s);
  });
  return mapsLoader;
}

function freshness(ts: string): "live" | "paused" | "offline" {
  const age = Date.now() - new Date(ts).getTime();
  if (age < 30_000) return "live";
  if (age < 120_000) return "paused";
  return "offline";
}

function colorFor(state: "live" | "paused" | "offline") {
  return state === "live" ? "#16a34a" : state === "paused" ? "#f59e0b" : "#6b7280";
}

function ageLabel(ts: string) {
  const s = Math.max(0, Math.floor((Date.now() - new Date(ts).getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  return `${h}h ago`;
}

export type SosPoint = {
  id: string;
  job_id: string;
  pax_name: string | null;
  latitude: number;
  longitude: number;
  note: string | null;
  created_at: string;
  job_from?: string | null;
  job_to?: string | null;
};

export function DriverLiveMap({
  points,
  sosPoints = [],
  focusDriverId,
  height = 280,
  onAcknowledgeSos,
}: {
  points: LivePoint[];
  sosPoints?: SosPoint[];
  focusDriverId?: string | null;
  height?: number;
  onAcknowledgeSos?: (sosId: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const markersRef = useRef<Map<string, { marker: any; info: any }>>(new Map());
  const sosMarkersRef = useRef<Map<string, { marker: any; info: any }>>(new Map());
  const [err, setErr] = useState<string | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [, force] = useState(0);


  // Expose the ack callback to inline InfoWindow buttons.
  useEffect(() => {
    (window as any).__coordAckSos = (id: string) => onAcknowledgeSos?.(id);
    return () => { try { delete (window as any).__coordAckSos; } catch { /* ignore */ } };
  }, [onAcknowledgeSos]);

  // Tick every 15s to refresh freshness colors/labels.
  useEffect(() => {
    const id = setInterval(() => force((x) => x + 1), 15_000);
    return () => clearInterval(id);
  }, []);


  // Initialise the map once.
  useEffect(() => {
    let cancelled = false;
    loadGoogleMaps()
      .then((gmaps) => {
        if (cancelled || !containerRef.current) return;
        const map = new gmaps.Map(containerRef.current, {
          center: { lat: 35.9, lng: 14.5 }, // Malta default
          zoom: 10,
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: false,
          clickableIcons: false,
          gestureHandling: "greedy",
        });
        mapRef.current = map;
        // Always-on live traffic overlay.
        try { new gmaps.TrafficLayer().setMap(map); } catch { /* ignore */ }
        // Trigger the marker-sync effects now that the map is ready.
        setMapReady(true);
        force((x) => x + 1);

      })
      .catch((e: Error) => { if (!cancelled) setErr(e.message); });
    return () => {
      cancelled = true;
      markersRef.current.forEach(({ marker }) => marker.setMap(null));
      markersRef.current.clear();
      sosMarkersRef.current.forEach(({ marker }) => marker.setMap(null));
      sosMarkersRef.current.clear();
    };
  }, []);


  // Sync SOS markers.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || typeof window === "undefined" || !(window as any).google?.maps) return;
    const gmaps = (window as any).google.maps as GMaps;
    const seen = new Set<string>();
    for (const s of sosPoints) {
      seen.add(s.id);
      const existing = sosMarkersRef.current.get(s.id);
      const position = { lat: s.latitude, lng: s.longitude };
      const icon = {
        path: gmaps.SymbolPath.CIRCLE,
        scale: 13,
        fillColor: "#dc2626",
        fillOpacity: 0.95,
        strokeColor: "#ffffff",
        strokeWeight: 3,
      };
      const who = s.pax_name ? escapeHtml(s.pax_name) : "Passenger";
      const trip = (s.job_from || s.job_to)
        ? `<div style="color:#555;margin-bottom:4px">${escapeHtml(s.job_from ?? "")} → ${escapeHtml(s.job_to ?? "")}</div>`
        : "";
      const note = s.note ? `<div style="color:#333;margin-bottom:6px">${escapeHtml(s.note)}</div>` : "";
      const contentHtml = `
        <div style="font: 12px system-ui; min-width: 180px">
          <div style="font-weight:700;color:#dc2626;margin-bottom:2px">🆘 SOS · ${who}</div>
          ${trip}${note}
          <div style="color:#666;font-size:11px;margin-bottom:6px">${ageLabel(s.created_at)}</div>
          <button type="button" onclick="window.__coordAckSos && window.__coordAckSos('${s.id}')"
            style="background:#dc2626;color:#fff;border:0;border-radius:6px;padding:4px 8px;font-weight:600;cursor:pointer">
            Dismiss alert
          </button>
        </div>`;
      if (existing) {
        existing.marker.setPosition(position);
        existing.info.setContent(contentHtml);
      } else {
        const marker = new gmaps.Marker({
          map, position, icon, title: `SOS · ${s.pax_name ?? "Passenger"}`, zIndex: 9999,
          animation: gmaps.Animation?.BOUNCE,
        });
        const info = new gmaps.InfoWindow({ content: contentHtml });
        marker.addListener("click", () => info.open({ anchor: marker, map }));
        sosMarkersRef.current.set(s.id, { marker, info });
      }
    }
    for (const [id, m] of sosMarkersRef.current.entries()) {
      if (!seen.has(id)) { m.marker.setMap(null); sosMarkersRef.current.delete(id); }
    }
  }, [sosPoints, mapReady]);


  // Sync markers with points.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || typeof window === "undefined" || !(window as any).google?.maps) return;
    const gmaps = (window as any).google.maps as GMaps;

    const seen = new Set<string>();
    for (const p of points) {
      seen.add(p.driver_id);
      const state = freshness(p.captured_at);
      const color = colorFor(state);
      const existing = markersRef.current.get(p.driver_id);
      const position = { lat: p.latitude, lng: p.longitude };
      const icon = {
        path: gmaps.SymbolPath.CIRCLE,
        scale: 9,
        fillColor: color,
        fillOpacity: 1,
        strokeColor: "#ffffff",
        strokeWeight: 2,
      };
      const contentHtml = `
        <div style="font: 12px system-ui; min-width: 160px">
          <div style="font-weight:600;margin-bottom:2px">${escapeHtml(p.driver_name)}</div>
          ${p.from_location || p.to_location
            ? `<div style="color:#555;margin-bottom:4px">${escapeHtml(p.from_location ?? "")} → ${escapeHtml(p.to_location ?? "")}</div>`
            : ""}
          <div style="color:${color};font-weight:600">
            ${state === "live" ? "Live" : state === "paused" ? "Paused" : "Offline"}
            <span style="color:#666;font-weight:400"> · ${ageLabel(p.captured_at)}</span>
          </div>
        </div>`;
      if (existing) {
        existing.marker.setPosition(position);
        existing.marker.setIcon(icon);
        existing.marker.setTitle(p.driver_name);
        existing.info.setContent(contentHtml);
      } else {
        const marker = new gmaps.Marker({ map, position, icon, title: p.driver_name });
        const info = new gmaps.InfoWindow({ content: contentHtml });
        marker.addListener("click", () => info.open({ anchor: marker, map }));
        markersRef.current.set(p.driver_id, { marker, info });
      }
    }
    // Remove stale markers
    for (const [id, m] of markersRef.current.entries()) {
      if (!seen.has(id)) { m.marker.setMap(null); markersRef.current.delete(id); }
    }

    // Auto-fit or focus
    const allCoords = [
      ...points.map((p) => ({ lat: p.latitude, lng: p.longitude })),
      ...sosPoints.map((s) => ({ lat: s.latitude, lng: s.longitude })),
    ];
    if (allCoords.length === 0) return;
    if (focusDriverId) {
      const target = points.find((p) => p.driver_id === focusDriverId);
      if (target) {
        map.panTo({ lat: target.latitude, lng: target.longitude });
        if ((map.getZoom() ?? 2) < 13) map.setZoom(14);
        return;
      }
    }
    if (allCoords.length === 1) {
      map.panTo(allCoords[0]);
      if ((map.getZoom() ?? 2) < 12) map.setZoom(13);
    } else {
      const bounds = new gmaps.LatLngBounds();
      for (const c of allCoords) bounds.extend(c);
      map.fitBounds(bounds, 48);
    }
  }, [points, sosPoints, focusDriverId, mapReady]);


  if (!BROWSER_KEY) {
    return (
      <div className="text-xs text-muted-foreground border rounded-md p-3 bg-muted/30">
        Google Maps browser key not configured.
      </div>
    );
  }
  if (err) {
    return (
      <div className="text-xs text-destructive border border-destructive/40 rounded-md p-3 bg-destructive/10">
        Map failed to load: {err}
      </div>
    );
  }
  return (
    <div
      ref={containerRef}
      style={{ height, width: "100%" }}
      className="rounded-md overflow-hidden border bg-muted"
      aria-label="Live driver map"
    />
  );
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string
  ));
}
