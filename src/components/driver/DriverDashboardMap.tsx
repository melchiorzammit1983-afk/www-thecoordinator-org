import { useEffect, useRef, useState } from "react";

const BROWSER_KEY = import.meta.env.VITE_LOVABLE_CONNECTOR_GOOGLE_MAPS_BROWSER_KEY as string | undefined;
const CHANNEL_ID = import.meta.env.VITE_LOVABLE_CONNECTOR_GOOGLE_MAPS_TRACKING_ID as string | undefined;

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
      libraries: "geometry",
    });
    if (CHANNEL_ID) params.set("channel", CHANNEL_ID);
    s.src = `https://maps.googleapis.com/maps/api/js?${params.toString()}`;
    s.async = true; s.defer = true;
    s.onerror = () => { mapsLoader = null; reject(new Error("gmaps_load_failed")); };
    document.head.appendChild(s);
  });
  return mapsLoader;
}

export type DriverMapJob = {
  id: string;
  from_location: string;
  to_location: string;
  is_active?: boolean;
};

/**
 * Fullscreen, always-on Google Map that sits as the canvas underneath the
 * driver dashboard UI. Floating cards render on top with z-index >= 10.
 *
 * When a `routeEncodedPolyline` is supplied (produced server-side by the
 * Routes API), the map decodes and draws that live traffic-aware path
 * instead of a straight A→B line.
 */
export function DriverDashboardMap({
  activeJob,
  routeEncodedPolyline = null,
  onDriverPosition,
}: {
  activeJob: DriverMapJob | null;
  routeEncodedPolyline?: string | null;
  onDriverPosition?: (pos: { lat: number; lng: number }) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const meMarkerRef = useRef<any>(null);
  const pickupMarkerRef = useRef<any>(null);
  const dropoffMarkerRef = useRef<any>(null);
  const routeRef = useRef<any>(null);
  const geocoderRef = useRef<any>(null);
  const [ready, setReady] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Init map once
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
          styles: [
            { featureType: "poi", stylers: [{ visibility: "off" }] },
            { featureType: "transit", stylers: [{ visibility: "off" }] },
          ],
        });
        mapRef.current = map;
        geocoderRef.current = new gmaps.Geocoder();
        try { new gmaps.TrafficLayer().setMap(map); } catch { /* ignore */ }
        setReady(true);
      })
      .catch((e: Error) => { if (!cancelled) setErr(e.message); });
    return () => { cancelled = true; };
  }, []);

  // Follow user location
  useEffect(() => {
    if (!ready || typeof navigator === "undefined" || !navigator.geolocation) return;
    const gmaps = (window as any).google?.maps;
    if (!gmaps) return;
    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const p = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        onDriverPosition?.(p);
        if (!meMarkerRef.current) {
          meMarkerRef.current = new gmaps.Marker({
            map: mapRef.current,
            position: p,
            icon: {
              path: gmaps.SymbolPath.CIRCLE,
              scale: 10,
              fillColor: "#2563eb",
              fillOpacity: 1,
              strokeColor: "#ffffff",
              strokeWeight: 3,
            },
            title: "You",
            zIndex: 999,
          });
          mapRef.current.panTo(p);
          if ((mapRef.current.getZoom() ?? 0) < 14) mapRef.current.setZoom(15);
        } else {
          meMarkerRef.current.setPosition(p);
        }
      },
      () => { /* ignore permission errors */ },
      { enableHighAccuracy: true, maximumAge: 5_000, timeout: 20_000 }
    );
    return () => navigator.geolocation.clearWatch(watchId);
  }, [ready]);

  // Draw pickup + drop-off markers and fit the map around them.
  useEffect(() => {
    if (!ready) return;
    const gmaps = (window as any).google?.maps;
    const map = mapRef.current;
    const geocoder = geocoderRef.current;
    if (!gmaps || !map || !geocoder) return;

    // clear old markers
    pickupMarkerRef.current?.setMap(null);
    dropoffMarkerRef.current?.setMap(null);
    pickupMarkerRef.current = null;
    dropoffMarkerRef.current = null;

    if (!activeJob) return;

    let cancelled = false;
    const geocode = (addr: string) =>
      new Promise<{ lat: number; lng: number } | null>((resolve) => {
        geocoder.geocode({ address: addr, region: "mt" }, (res: any, status: string) => {
          if (status === "OK" && res?.[0]?.geometry?.location) {
            const loc = res[0].geometry.location;
            resolve({ lat: loc.lat(), lng: loc.lng() });
          } else {
            resolve(null);
          }
        });
      });

    (async () => {
      const [from, to] = await Promise.all([
        geocode(activeJob.from_location),
        geocode(activeJob.to_location),
      ]);
      if (cancelled) return;
      const bounds = new gmaps.LatLngBounds();
      if (from) {
        pickupMarkerRef.current = new gmaps.Marker({
          map, position: from, label: { text: "A", color: "#fff", fontWeight: "700" },
          title: `Pickup — ${activeJob.from_location}`,
        });
        bounds.extend(from);
      }
      if (to) {
        dropoffMarkerRef.current = new gmaps.Marker({
          map, position: to, label: { text: "B", color: "#fff", fontWeight: "700" },
          title: `Drop-off — ${activeJob.to_location}`,
        });
        bounds.extend(to);
      }
      if (!bounds.isEmpty()) {
        // Leave generous padding so floating cards do not cover the endpoints.
        map.fitBounds(bounds, { top: 220, bottom: 320, left: 40, right: 40 });
      }
    })();
    return () => { cancelled = true; };
  }, [ready, activeJob?.id, activeJob?.from_location, activeJob?.to_location]);

  // Draw the live traffic-aware route polyline whenever it changes.
  useEffect(() => {
    if (!ready) return;
    const gmaps = (window as any).google?.maps;
    const map = mapRef.current;
    if (!gmaps || !map) return;

    routeRef.current?.setMap(null);
    routeRef.current = null;

    if (!routeEncodedPolyline || !gmaps.geometry?.encoding?.decodePath) return;
    let path: any[] = [];
    try { path = gmaps.geometry.encoding.decodePath(routeEncodedPolyline); }
    catch { return; }
    if (!path.length) return;

    routeRef.current = new gmaps.Polyline({
      map,
      path,
      strokeColor: "#2563eb",
      strokeOpacity: 0.9,
      strokeWeight: 6,
    });
  }, [ready, routeEncodedPolyline]);



  return (
    <div
      aria-hidden="true"
      style={{ position: "fixed", top: 0, left: 0, width: "100vw", height: "100vh", zIndex: 1 }}
      className="bg-muted"
    >
      <div ref={containerRef} className="w-full h-full" />
      {err && (
        <div className="absolute inset-0 grid place-items-center text-xs text-muted-foreground bg-background/80">
          Map unavailable: {err}
        </div>
      )}
      {!BROWSER_KEY && (
        <div className="absolute inset-0 grid place-items-center text-xs text-muted-foreground bg-background/80">
          Google Maps browser key not configured.
        </div>
      )}
    </div>
  );
}
