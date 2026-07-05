import { useEffect, useRef, useState } from "react";
import { loadGoogleMaps } from "@/components/driver/DriverDashboardMap";
import {
  ArrowLeft, ArrowRight, ArrowUp, ArrowUpLeft, ArrowUpRight,
  CornerDownLeft, CornerDownRight, TrafficCone, Volume2, VolumeX,
  X, Crosshair, ExternalLink,
} from "lucide-react";

/**
 * Route info shape returned by `useLiveRoute` in the driver route file.
 * Duplicated structurally here so this component doesn't couple to the
 * (large) route file that owns it.
 */
type LiveRouteInfo = {
  polyline: string | null;
  eta_sec: number | null;
  distance_m: number | null;
  next_instruction: string | null;
  next_maneuver: string | null;
  next_step_distance_m: number | null;
  delay_sec: number;
  reroute_available: boolean;
  reroute_saving_sec: number;
  onAcceptReroute: () => void;
  isLoading: boolean;
};

function formatEtaMin(sec: number | null): string {
  if (sec == null) return "—";
  const m = Math.max(1, Math.round(sec / 60));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return `${h}h ${r}m`;
}
function formatDistance(m: number | null): string {
  if (m == null) return "—";
  if (m < 950) return `${Math.round(m / 10) * 10} m`;
  return `${(m / 1000).toFixed(m < 10_000 ? 1 : 0)} km`;
}

function ManeuverArrow({ maneuver, className }: { maneuver: string | null; className?: string }) {
  const cls = className ?? "h-6 w-6";
  switch (maneuver) {
    case "TURN_LEFT":
    case "TURN_SHARP_LEFT":
      return <ArrowLeft className={cls} />;
    case "TURN_SLIGHT_LEFT":
      return <ArrowUpLeft className={cls} />;
    case "TURN_RIGHT":
    case "TURN_SHARP_RIGHT":
      return <ArrowRight className={cls} />;
    case "TURN_SLIGHT_RIGHT":
      return <ArrowUpRight className={cls} />;
    case "UTURN_LEFT":
      return <CornerDownLeft className={cls} />;
    case "UTURN_RIGHT":
      return <CornerDownRight className={cls} />;
    default:
      return <ArrowUp className={cls} />;
  }
}

/**
 * Full-screen in-app turn-by-turn view. Renders a live Google Map with the
 * route polyline, driver marker, and destination marker. Bottom HUD overlays
 * the current maneuver + ETA. Follow-mode auto-recenters on the driver;
 * panning temporarily disables it until the "recenter" FAB is tapped.
 */
export function NavigateFullscreen({
  live, destination, onExit, onSpeak, isSpeaking, externalNavUrl,
}: {
  live: LiveRouteInfo;
  destination: string | null;
  onExit: () => void;
  onSpeak: (() => void) | null;
  isSpeaking: boolean;
  externalNavUrl: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const meMarkerRef = useRef<any>(null);
  const destMarkerRef = useRef<any>(null);
  const polyRef = useRef<any>(null);
  const [ready, setReady] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const followRef = useRef(true);
  const [follow, setFollow] = useState(true);
  const suppressPanRef = useRef(false);

  // Init map
  useEffect(() => {
    let cancelled = false;
    loadGoogleMaps()
      .then((gmaps) => {
        if (cancelled || !containerRef.current) return;
        const map = new gmaps.Map(containerRef.current, {
          center: { lat: 35.9, lng: 14.5 },
          zoom: 15,
          disableDefaultUI: true,
          clickableIcons: false,
          gestureHandling: "greedy",
          tilt: 0,
          styles: [
            { featureType: "poi", stylers: [{ visibility: "off" }] },
            { featureType: "transit", stylers: [{ visibility: "off" }] },
          ],
        });
        mapRef.current = map;
        try { new gmaps.TrafficLayer().setMap(map); } catch { /* ignore */ }
        // Detect user drag → drop out of follow mode
        map.addListener("dragstart", () => {
          if (suppressPanRef.current) return;
          followRef.current = false;
          setFollow(false);
        });
        setReady(true);
      })
      .catch((e: Error) => { if (!cancelled) setErr(e.message); });
    return () => { cancelled = true; };
  }, []);

  // Watch driver position
  useEffect(() => {
    if (!ready || typeof navigator === "undefined" || !navigator.geolocation) return;
    const gmaps = (window as any).google?.maps;
    if (!gmaps) return;
    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const p = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        const heading = pos.coords.heading ?? null;
        if (!meMarkerRef.current) {
          meMarkerRef.current = new gmaps.Marker({
            map: mapRef.current,
            position: p,
            icon: {
              path: gmaps.SymbolPath.FORWARD_CLOSED_ARROW,
              scale: 7,
              fillColor: "#2563eb",
              fillOpacity: 1,
              strokeColor: "#ffffff",
              strokeWeight: 2,
              rotation: heading ?? 0,
            },
            title: "You",
            zIndex: 999,
          });
        } else {
          meMarkerRef.current.setPosition(p);
          if (heading != null) {
            const cur = meMarkerRef.current.getIcon?.();
            if (cur) meMarkerRef.current.setIcon({ ...cur, rotation: heading });
          }
        }
        if (followRef.current) {
          suppressPanRef.current = true;
          mapRef.current.panTo(p);
          if ((mapRef.current.getZoom() ?? 0) < 15) mapRef.current.setZoom(16);
          setTimeout(() => { suppressPanRef.current = false; }, 50);
        }
      },
      () => { /* ignore permission errors — DriverLiveShare surfaces them */ },
      { enableHighAccuracy: true, maximumAge: 3_000, timeout: 20_000 },
    );
    return () => navigator.geolocation.clearWatch(watchId);
  }, [ready]);

  // Draw / update polyline
  useEffect(() => {
    if (!ready) return;
    const gmaps = (window as any).google?.maps;
    const map = mapRef.current;
    if (!gmaps || !map) return;
    if (polyRef.current) { polyRef.current.setMap(null); polyRef.current = null; }
    if (destMarkerRef.current) { destMarkerRef.current.setMap(null); destMarkerRef.current = null; }
    if (!live.polyline) return;
    let path: any[] = [];
    try {
      path = gmaps.geometry.encoding.decodePath(live.polyline);
    } catch { return; }
    if (!path.length) return;
    polyRef.current = new gmaps.Polyline({
      map,
      path,
      strokeColor: "#2563eb",
      strokeOpacity: 0.9,
      strokeWeight: 6,
      zIndex: 100,
    });
    // Destination marker at last point
    const end = path[path.length - 1];
    destMarkerRef.current = new gmaps.Marker({
      map,
      position: end,
      title: destination ?? "Destination",
      zIndex: 500,
    });
  }, [ready, live.polyline, destination]);

  // Fullscreen API on mount (best-effort; ignored on iOS Safari)
  useEffect(() => {
    const el = document.documentElement;
    if (el.requestFullscreen) {
      el.requestFullscreen().catch(() => { /* ignore */ });
    }
    return () => {
      if (document.fullscreenElement && document.exitFullscreen) {
        document.exitFullscreen().catch(() => { /* ignore */ });
      }
    };
  }, []);

  const stripInstruction = live.next_instruction?.replace(/<[^>]+>/g, "").trim() ?? null;

  const recenter = () => {
    followRef.current = true;
    setFollow(true);
    const me = meMarkerRef.current;
    if (me && mapRef.current) {
      mapRef.current.panTo(me.getPosition());
      if ((mapRef.current.getZoom() ?? 0) < 15) mapRef.current.setZoom(16);
    }
  };

  return (
    <div className="fixed inset-0 z-40 bg-slate-900">
      <div ref={containerRef} className="absolute inset-0" />
      {err && (
        <div className="absolute top-4 inset-x-4 rounded-lg bg-destructive text-destructive-foreground p-3 text-sm">
          Map failed to load: {err}
        </div>
      )}

      {/* Top-left: exit */}
      <button
        type="button"
        onClick={onExit}
        aria-label="Exit navigate mode"
        className="absolute top-4 left-4 z-10 min-h-12 min-w-12 grid place-items-center rounded-full bg-white/95 text-slate-900 shadow-lg active:scale-95 transition"
      >
        <X className="h-6 w-6" />
      </button>

      {/* Top-right: open in Google Maps fallback */}
      <a
        href={externalNavUrl}
        target="_blank"
        rel="noreferrer"
        aria-label="Open in Google Maps"
        className="absolute top-4 right-4 z-10 min-h-12 min-w-12 grid place-items-center rounded-full bg-white/95 text-slate-900 shadow-lg active:scale-95 transition"
      >
        <ExternalLink className="h-5 w-5" />
      </a>

      {/* Recenter FAB — only when user has panned away */}
      {!follow && (
        <button
          type="button"
          onClick={recenter}
          aria-label="Recenter on you"
          className="absolute bottom-40 right-4 z-10 min-h-12 min-w-12 grid place-items-center rounded-full bg-primary text-primary-foreground shadow-lg active:scale-95 transition"
        >
          <Crosshair className="h-6 w-6" />
        </button>
      )}

      {/* Bottom HUD */}
      <div className="absolute inset-x-0 bottom-0 z-10">
        {live.reroute_available && (
          <button
            type="button"
            onClick={live.onAcceptReroute}
            className="w-full flex items-center gap-2 px-4 py-2 bg-amber-500 text-black font-bold text-left"
          >
            <TrafficCone className="h-5 w-5 shrink-0" />
            <span className="flex-1 text-sm leading-tight">
              Faster route saves {formatEtaMin(live.reroute_saving_sec)} — tap to switch
            </span>
          </button>
        )}
        <div
          className="flex items-center gap-3 px-4 py-3 border-t-2 border-white/60 shadow-2xl"
          style={{ background: "rgba(255,255,255,0.92)", backdropFilter: "blur(18px)", WebkitBackdropFilter: "blur(18px)" }}
        >
          <ManeuverArrow maneuver={live.next_maneuver} className="h-14 w-14 shrink-0 text-primary" />
          <div className="min-w-0 flex-1">
            <div className="text-3xl sm:text-4xl font-black tabular-nums leading-none text-slate-900">
              {formatDistance(live.next_step_distance_m) || formatDistance(live.distance_m)}
            </div>
            <div className="mt-1 flex items-baseline gap-2 text-base font-semibold text-slate-700">
              <span className="tabular-nums">ETA {formatEtaMin(live.eta_sec)}</span>
              {stripInstruction && (
                <span className="truncate text-sm text-slate-500">· {stripInstruction}</span>
              )}
            </div>
          </div>
          {onSpeak && (
            <button
              type="button"
              onClick={onSpeak}
              aria-label={isSpeaking ? "Stop speaking notification" : "Speak latest notification"}
              aria-pressed={isSpeaking}
              className={`shrink-0 min-h-14 min-w-14 grid place-items-center rounded-full font-bold shadow-lg active:scale-95 transition ${
                isSpeaking
                  ? "bg-amber-500 text-black animate-pulse"
                  : "bg-white text-primary border-2 border-primary/40"
              }`}
            >
              {isSpeaking ? <VolumeX className="h-6 w-6" /> : <Volume2 className="h-6 w-6" />}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
