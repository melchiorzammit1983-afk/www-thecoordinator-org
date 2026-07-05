import { useEffect, useMemo, useRef, useState } from "react";
import { loadGoogleMaps } from "@/components/driver/DriverDashboardMap";
import {
  ArrowLeft, ArrowRight, ArrowUp, ArrowUpLeft, ArrowUpRight,
  CornerDownLeft, CornerDownRight, TrafficCone, Volume2, VolumeX,
  X, Crosshair, ExternalLink,
} from "lucide-react";

type RouteStep = {
  maneuver: string | null;
  instruction: string | null;
  distance_m: number | null;
  polyline: string | null;
  end: { lat: number; lng: number };
};

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
  steps: RouteStep[];
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
 * In-app turn-by-turn view. Renders a live Google Map with the route,
 * tracks the driver's progress through the step list (advancing the HUD
 * arrow / instruction / distance-to-next-turn), and trims the polyline
 * into a grey "already travelled" portion and a blue "ahead" portion —
 * the way Google Maps navigation renders.
 */
export function NavigateFullscreen({
  live, destination, onExit, onSpeak, isSpeaking, externalNavUrl,
  mode = "navigate", footerSlot = null, title = null,
}: {
  live: LiveRouteInfo;
  destination: string | null;
  onExit: () => void;
  onSpeak: (() => void) | null;
  isSpeaking: boolean;
  externalNavUrl: string;
  mode?: "navigate" | "preview";
  footerSlot?: React.ReactNode;
  title?: string | null;
}) {
  const isPreview = mode === "preview";

  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const meMarkerRef = useRef<any>(null);
  const destMarkerRef = useRef<any>(null);
  const polyAheadRef = useRef<any>(null);
  const polyDoneRef = useRef<any>(null);
  const [ready, setReady] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const followRef = useRef(true);
  const [follow, setFollow] = useState(true);
  const suppressPanRef = useRef(false);

  // Driver position + step tracking
  const [drvPos, setDrvPos] = useState<{ lat: number; lng: number } | null>(null);
  const drvPosRef = useRef<{ lat: number; lng: number } | null>(null);
  const headingRef = useRef<number | null>(null);
  const [stepIdx, setStepIdx] = useState(0);
  const stepIdxRef = useRef(0);
  const [distToStepEnd, setDistToStepEnd] = useState<number | null>(null);

  // Reset step index when the route (destination) changes
  useEffect(() => { setStepIdx(0); stepIdxRef.current = 0; }, [destination]);

  // Init map
  useEffect(() => {
    let cancelled = false;
    loadGoogleMaps()
      .then((gmaps) => {
        if (cancelled || !containerRef.current) return;
        const map = new gmaps.Map(containerRef.current, {
          center: { lat: 35.9, lng: 14.5 },
          zoom: 17,
          disableDefaultUI: true,
          clickableIcons: false,
          gestureHandling: "greedy",
          tilt: 0,
          heading: 0,
          rotateControl: false,
          styles: [
            { featureType: "poi", stylers: [{ visibility: "off" }] },
            { featureType: "transit", stylers: [{ visibility: "off" }] },
          ],
        });
        mapRef.current = map;
        try { new gmaps.TrafficLayer().setMap(map); } catch { /* ignore */ }
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

  // Watch driver GPS
  useEffect(() => {
    if (!ready || typeof navigator === "undefined" || !navigator.geolocation) return;
    const gmaps = (window as any).google?.maps;
    if (!gmaps) return;
    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const p = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        const heading = pos.coords.heading;
        headingRef.current = (heading != null && !Number.isNaN(heading)) ? heading : headingRef.current;
        drvPosRef.current = p;
        setDrvPos(p);
        if (!meMarkerRef.current) {
          meMarkerRef.current = new gmaps.Marker({
            map: mapRef.current,
            position: p,
            icon: {
              path: gmaps.SymbolPath.FORWARD_CLOSED_ARROW,
              scale: 8,
              fillColor: "#2563eb",
              fillOpacity: 1,
              strokeColor: "#ffffff",
              strokeWeight: 2,
              rotation: 0,
            },
            title: "You",
            zIndex: 999,
          });
        } else {
          meMarkerRef.current.setPosition(p);
        }
        if (!isPreview && followRef.current && mapRef.current) {
          suppressPanRef.current = true;
          mapRef.current.panTo(p);
          if ((mapRef.current.getZoom() ?? 0) < 17) mapRef.current.setZoom(18);
          try {
            if (headingRef.current != null) mapRef.current.setHeading(headingRef.current);
            mapRef.current.setTilt(45);
          } catch { /* raster map: tilt/heading unsupported */ }
          const marker = meMarkerRef.current;
          const cur = marker.getIcon?.();
          if (cur) marker.setIcon({ ...cur, rotation: 0 });
          setTimeout(() => { suppressPanRef.current = false; }, 60);
        } else if (meMarkerRef.current) {
          const cur = meMarkerRef.current.getIcon?.();
          if (cur && headingRef.current != null) meMarkerRef.current.setIcon({ ...cur, rotation: headingRef.current });
        }

      },
      () => { /* handled by DriverLiveShare */ },
      { enableHighAccuracy: true, maximumAge: 2_000, timeout: 20_000 },
    );
    return () => navigator.geolocation.clearWatch(watchId);
  }, [ready]);

  const steps = live.steps;

  // Decode step polylines once per step list.
  const decodedSteps = useMemo(() => {
    const gmaps = (window as any).google?.maps;
    if (!ready || !gmaps) return [] as Array<{ path: any[]; end: { lat: number; lng: number } }>;
    return steps.map((s) => {
      let path: any[] = [];
      if (s.polyline) {
        try { path = gmaps.geometry.encoding.decodePath(s.polyline); } catch { path = []; }
      }
      return { path, end: s.end };
    });
  }, [ready, steps]);

  // Advance step index as driver approaches / passes the current step's end.
  useEffect(() => {
    const gmaps = (window as any).google?.maps;
    if (!gmaps || !drvPos || decodedSteps.length === 0) return;
    const here = new gmaps.LatLng(drvPos.lat, drvPos.lng);
    let i = stepIdxRef.current;
    // Never regress. Advance while within 25m of end, up to end of list.
    while (i < decodedSteps.length - 1) {
      const end = decodedSteps[i].end;
      const endLL = new gmaps.LatLng(end.lat, end.lng);
      const d = gmaps.geometry.spherical.computeDistanceBetween(here, endLL);
      if (d < 25) { i += 1; continue; }
      break;
    }
    if (i !== stepIdxRef.current) {
      stepIdxRef.current = i;
      setStepIdx(i);
    }
    // Live distance to end of current step
    const endCur = decodedSteps[i]?.end;
    if (endCur) {
      const d = gmaps.geometry.spherical.computeDistanceBetween(
        here, new gmaps.LatLng(endCur.lat, endCur.lng),
      );
      setDistToStepEnd(Math.round(d));
    }
  }, [drvPos, decodedSteps]);

  // Draw / update polylines (travelled vs ahead) + destination marker.
  useEffect(() => {
    if (!ready) return;
    const gmaps = (window as any).google?.maps;
    const map = mapRef.current;
    if (!gmaps || !map) return;

    if (polyAheadRef.current) { polyAheadRef.current.setMap(null); polyAheadRef.current = null; }
    if (polyDoneRef.current) { polyDoneRef.current.setMap(null); polyDoneRef.current = null; }
    if (destMarkerRef.current) { destMarkerRef.current.setMap(null); destMarkerRef.current = null; }

    if (decodedSteps.length === 0) return;

    // Build full path from all step polylines (fallback to route polyline).
    let full: any[] = [];
    for (const s of decodedSteps) full = full.concat(s.path);
    if (full.length === 0 && live.polyline) {
      try { full = gmaps.geometry.encoding.decodePath(live.polyline); } catch { /* ignore */ }
    }
    if (full.length === 0) return;

    // Split point: end of steps completed (stepIdx-1 endpoint), or 0.
    const done: any[] = [];
    const ahead: any[] = [];
    if (stepIdx <= 0) {
      ahead.push(...full);
    } else {
      // Concatenate paths for completed steps -> done; rest -> ahead.
      for (let i = 0; i < decodedSteps.length; i++) {
        const p = decodedSteps[i].path;
        if (i < stepIdx) done.push(...p); else ahead.push(...p);
      }
    }
    // Include current driver pos at the head of "ahead" for a tight follow line.
    if (drvPosRef.current) ahead.unshift(new gmaps.LatLng(drvPosRef.current.lat, drvPosRef.current.lng));

    polyDoneRef.current = new gmaps.Polyline({
      map, path: done, strokeColor: "#94a3b8", strokeOpacity: 0.7, strokeWeight: 5, zIndex: 90,
    });
    polyAheadRef.current = new gmaps.Polyline({
      map, path: ahead, strokeColor: "#2563eb", strokeOpacity: 0.95, strokeWeight: 7, zIndex: 100,
    });

    const end = full[full.length - 1];
    destMarkerRef.current = new gmaps.Marker({
      map, position: end, title: destination ?? "Destination", zIndex: 500,
    });
  }, [ready, decodedSteps, stepIdx, destination, live.polyline]);

  // Fullscreen API on mount
  useEffect(() => {
    const el = document.documentElement;
    if (el.requestFullscreen) el.requestFullscreen().catch(() => { /* ignore */ });
    return () => {
      if (document.fullscreenElement && document.exitFullscreen) {
        document.exitFullscreen().catch(() => { /* ignore */ });
      }
    };
  }, []);

  const current: RouteStep | null = steps[stepIdx] ?? null;
  const upcoming: RouteStep | null = steps[stepIdx + 1] ?? null;

  const displayManeuver = current?.maneuver ?? live.next_maneuver;
  const displayInstruction = (current?.instruction ?? live.next_instruction)
    ?.replace(/<[^>]+>/g, "").trim() ?? null;
  const displayDistance = distToStepEnd ?? current?.distance_m ?? live.next_step_distance_m;

  const upcomingInstruction = upcoming?.instruction?.replace(/<[^>]+>/g, "").trim() ?? null;

  const recenter = () => {
    followRef.current = true;
    setFollow(true);
    const me = meMarkerRef.current;
    if (me && mapRef.current) {
      mapRef.current.panTo(me.getPosition());
      if ((mapRef.current.getZoom() ?? 0) < 17) mapRef.current.setZoom(18);
      try {
        if (headingRef.current != null) mapRef.current.setHeading(headingRef.current);
        mapRef.current.setTilt(45);
      } catch { /* raster fallback */ }
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

      {/* Top-center: current instruction banner (Google-Maps-style) */}
      {displayInstruction && (
        <div className="absolute top-4 left-20 right-20 z-[9] mx-auto max-w-md">
          <div
            className="flex items-center gap-3 rounded-2xl px-3 py-2 shadow-lg"
            style={{ background: "rgba(37,99,235,0.95)", color: "#fff", backdropFilter: "blur(8px)" }}
          >
            <ManeuverArrow maneuver={displayManeuver} className="h-8 w-8 shrink-0" />
            <div className="min-w-0 flex-1">
              <div className="text-lg font-bold tabular-nums leading-none">
                {formatDistance(displayDistance ?? null)}
              </div>
              <div className="mt-0.5 truncate text-xs opacity-90">{displayInstruction}</div>
            </div>
          </div>
        </div>
      )}

      {/* Recenter FAB */}
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

      {/* Bottom HUD: ETA + next step preview */}
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
          <div className="min-w-0 flex-1">
            <div className="text-3xl sm:text-4xl font-black tabular-nums leading-none text-slate-900">
              ETA {formatEtaMin(live.eta_sec)}
            </div>
            <div className="mt-1 flex items-center gap-2 text-sm font-semibold text-slate-700">
              <span className="tabular-nums">{formatDistance(live.distance_m)}</span>
              {upcomingInstruction && (
                <>
                  <span className="text-slate-400">·</span>
                  <span className="flex items-center gap-1 min-w-0">
                    <span className="text-xs uppercase tracking-wider text-slate-500">Then</span>
                    <ManeuverArrow maneuver={upcoming?.maneuver ?? null} className="h-4 w-4 shrink-0 text-slate-700" />
                    <span className="truncate text-xs text-slate-500">{upcomingInstruction}</span>
                  </span>
                </>
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
