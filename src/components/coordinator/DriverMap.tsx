import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listActiveDriverLocations } from "@/lib/coordinator.functions";
import { supabase } from "@/integrations/supabase/client";
import { MapPin, Loader2, Navigation, Car, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

type Loc = {
  job_id: string;
  driver_id: string;
  driver_name: string;
  driver_phone: string | null;
  driver_vehicle: string | null;
  from_location: string;
  to_location: string;
  pickup_at: string | null;
  status: string;
  latitude: number;
  longitude: number;
  accuracy_m: number | null;
  heading: number | null;
  speed_mps: number | null;
  captured_at: string;
};

const BROWSER_KEY = import.meta.env.VITE_LOVABLE_CONNECTOR_GOOGLE_MAPS_BROWSER_KEY as string | undefined;
const TRACKING_ID = import.meta.env.VITE_LOVABLE_CONNECTOR_GOOGLE_MAPS_TRACKING_ID as string | undefined;

// Global loader promise so multiple map mounts don't re-inject the script
let mapsLoader: Promise<typeof google.maps> | null = null;
function loadGoogleMaps(): Promise<typeof google.maps> {
  if (typeof window === "undefined") return Promise.reject(new Error("no window"));
  if (!BROWSER_KEY) return Promise.reject(new Error("Google Maps key missing"));
  if ((window as any).google?.maps) return Promise.resolve((window as any).google.maps);
  if (mapsLoader) return mapsLoader;
  mapsLoader = new Promise((resolve, reject) => {
    const cbName = `__lovableInitMap_${Math.random().toString(36).slice(2, 8)}`;
    (window as any)[cbName] = () => resolve((window as any).google.maps);
    const s = document.createElement("script");
    const params = new URLSearchParams({ key: BROWSER_KEY, loading: "async", callback: cbName, v: "weekly" });
    if (TRACKING_ID) params.set("channel", TRACKING_ID);
    s.src = `https://maps.googleapis.com/maps/api/js?${params.toString()}`;
    s.async = true;
    s.onerror = () => reject(new Error("Google Maps failed to load"));
    document.head.appendChild(s);
  });
  return mapsLoader;
}

function statusColor(status: string) {
  switch (status) {
    case "en_route": return "#3b82f6";
    case "arrived": return "#f59e0b";
    case "in_progress":
    case "active": return "#10b981";
    default: return "#6b7280";
  }
}
function statusLabel(status: string) {
  switch (status) {
    case "en_route": return "On the way";
    case "arrived": return "Arrived";
    case "in_progress":
    case "active": return "In progress";
    default: return status;
  }
}
function ago(iso: string) {
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  return `${m}m ago`;
}

export function DriverMap({
  height = 420,
  onSelectJob,
}: {
  height?: number;
  onSelectJob?: (jobId: string) => void;
}) {
  const listFn = useServerFn(listActiveDriverLocations);
  const { data, refetch, isLoading } = useQuery({
    queryKey: ["driver-locations"],
    queryFn: () => listFn() as Promise<Loc[]>,
    refetchInterval: 20_000,
  });

  const mapRef = useRef<HTMLDivElement | null>(null);
  const mapObj = useRef<google.maps.Map | null>(null);
  const markers = useRef<Map<string, google.maps.Marker>>(new Map());
  const [mapReady, setMapReady] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedJob, setSelectedJob] = useState<string | null>(null);

  // Initialize map
  useEffect(() => {
    let cancelled = false;
    loadGoogleMaps()
      .then((maps) => {
        if (cancelled || !mapRef.current || mapObj.current) return;
        mapObj.current = new maps.Map(mapRef.current, {
          center: { lat: 25.2048, lng: 55.2708 },
          zoom: 10,
          streetViewControl: false,
          mapTypeControl: false,
          fullscreenControl: false,
        });
        setMapReady(true);
      })
      .catch((e) => setLoadError(e.message));
    return () => { cancelled = true; };
  }, []);

  // Realtime updates on new pings
  useEffect(() => {
    const ch = supabase
      .channel("driver-locations-live")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "driver_locations" }, () => {
        refetch();
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [refetch]);

  // Sync markers
  useEffect(() => {
    if (!mapReady || !mapObj.current) return;
    const maps = (window as any).google.maps as typeof google.maps;
    const map = mapObj.current;
    const locs = data ?? [];
    const nextIds = new Set(locs.map((l) => l.job_id));

    // Remove stale
    markers.current.forEach((m, id) => {
      if (!nextIds.has(id)) { m.setMap(null); markers.current.delete(id); }
    });

    const bounds = new maps.LatLngBounds();
    for (const l of locs) {
      const pos = { lat: l.latitude, lng: l.longitude };
      bounds.extend(pos);
      let m = markers.current.get(l.job_id);
      if (!m) {
        m = new maps.Marker({
          position: pos,
          map,
          title: `${l.driver_name} · ${l.from_location} → ${l.to_location}`,
          icon: {
            path: maps.SymbolPath.CIRCLE,
            scale: 9,
            fillColor: statusColor(l.status),
            fillOpacity: 1,
            strokeColor: "#fff",
            strokeWeight: 2,
          },
        });
        m.addListener("click", () => {
          setSelectedJob(l.job_id);
          onSelectJob?.(l.job_id);
        });
        markers.current.set(l.job_id, m);
      } else {
        m.setPosition(pos);
        m.setIcon({
          path: maps.SymbolPath.CIRCLE,
          scale: 9,
          fillColor: statusColor(l.status),
          fillOpacity: 1,
          strokeColor: "#fff",
          strokeWeight: 2,
        });
      }
    }

    if (locs.length === 1) {
      map.setCenter({ lat: locs[0].latitude, lng: locs[0].longitude });
      if ((map.getZoom() ?? 0) < 12) map.setZoom(14);
    } else if (locs.length > 1) {
      map.fitBounds(bounds, 60);
    }
  }, [data, mapReady, onSelectJob]);

  const selected = useMemo(
    () => (data ?? []).find((l) => l.job_id === selectedJob) ?? null,
    [data, selectedJob],
  );

  if (!BROWSER_KEY) {
    return (
      <div className="rounded-lg border bg-muted/40 p-6 text-sm text-muted-foreground">
        Google Maps key not configured yet.
      </div>
    );
  }

  return (
    <div className="rounded-lg border bg-card overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 border-b bg-muted/40">
        <div className="flex items-center gap-2 text-sm font-medium">
          <MapPin className="h-4 w-4 text-primary" />
          Live driver tracking
          <Badge variant="outline" className="text-[10px]">{(data ?? []).length} live</Badge>
        </div>
        <Button size="sm" variant="ghost" onClick={() => refetch()} className="h-7">
          <RefreshCw className={`h-3.5 w-3.5 ${isLoading ? "animate-spin" : ""}`} />
        </Button>
      </div>
      <div className="relative">
        <div ref={mapRef} style={{ height }} className="w-full bg-muted" />
        {!mapReady && !loadError && (
          <div className="absolute inset-0 grid place-items-center bg-background/60 text-sm text-muted-foreground">
            <div className="flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Loading map…</div>
          </div>
        )}
        {loadError && (
          <div className="absolute inset-0 grid place-items-center bg-background/80 text-sm text-destructive px-4 text-center">
            {loadError}
          </div>
        )}
        {mapReady && (data ?? []).length === 0 && (
          <div className="absolute inset-x-0 top-2 mx-auto w-fit rounded-full bg-background/95 border shadow px-3 py-1 text-xs text-muted-foreground flex items-center gap-1.5">
            <Car className="h-3.5 w-3.5" /> No drivers currently sharing location
          </div>
        )}
        {selected && (
          <div className="absolute left-2 right-2 bottom-2 md:left-auto md:right-2 md:w-72 rounded-lg border bg-background shadow-lg p-3 text-sm">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="font-semibold truncate">{selected.driver_name}</div>
                <div className="text-xs text-muted-foreground truncate">
                  {selected.from_location} → {selected.to_location}
                </div>
              </div>
              <button className="text-muted-foreground text-xs" onClick={() => setSelectedJob(null)}>✕</button>
            </div>
            <div className="mt-2 flex items-center gap-2 flex-wrap">
              <Badge style={{ backgroundColor: statusColor(selected.status), color: "#fff" }} className="text-[10px]">
                {statusLabel(selected.status)}
              </Badge>
              {selected.speed_mps != null && (
                <Badge variant="outline" className="text-[10px] gap-1">
                  <Navigation className="h-3 w-3" /> {Math.round(selected.speed_mps * 3.6)} km/h
                </Badge>
              )}
              <span className="text-[10px] text-muted-foreground">Updated {ago(selected.captured_at)}</span>
            </div>
            {onSelectJob && (
              <Button size="sm" variant="secondary" className="w-full mt-2" onClick={() => onSelectJob(selected.job_id)}>
                Open trip details
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
