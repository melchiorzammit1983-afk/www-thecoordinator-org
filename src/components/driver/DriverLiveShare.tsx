import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { pushDriverLocation } from "@/lib/coordinator-public.functions";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { MapPin, Loader2, AlertTriangle, Smartphone } from "lucide-react";

type QueuedPoint = {
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
};

export type LiveShareMeta = {
  eta_sec: number | null;
  distance_m: number | null;
  next_instruction: string | null;
  destination_label: string | null;
};

const STORAGE_KEY = "driverLiveShareOn";
const QUEUE_KEY = "driverLiveQueue";
// Battery-friendly cadence: emit at most every ~12s OR every 20m moved.
const MIN_DISTANCE_M = 20;
const MIN_INTERVAL_MS = 12_000;
const FLUSH_INTERVAL_MS = 10_000;

function distanceMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const R = 6371000;
  const toRad = (x: number) => (x * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * R * Math.asin(Math.sqrt(h));
}

// Runtime detection: are we inside a Capacitor native shell?
function isNative(): boolean {
  try {
    // Capacitor injects `window.Capacitor` in native shells.
    const cap = (globalThis as any).Capacitor;
    return Boolean(cap?.isNativePlatform?.() ?? cap?.isNative);
  } catch { return false; }
}

async function readPersistedFlag(): Promise<boolean> {
  if (isNative()) {
    try {
      const { Preferences } = await import("@capacitor/preferences");
      const { value } = await Preferences.get({ key: STORAGE_KEY });
      return value === "1";
    } catch { /* fall through */ }
  }
  return typeof localStorage !== "undefined" && localStorage.getItem(STORAGE_KEY) === "1";
}

async function writePersistedFlag(v: boolean) {
  const s = v ? "1" : "0";
  if (isNative()) {
    try {
      const { Preferences } = await import("@capacitor/preferences");
      await Preferences.set({ key: STORAGE_KEY, value: s });
      return;
    } catch { /* fall through */ }
  }
  if (typeof localStorage !== "undefined") localStorage.setItem(STORAGE_KEY, s);
}

async function readQueue(): Promise<QueuedPoint[]> {
  try {
    if (isNative()) {
      const { Preferences } = await import("@capacitor/preferences");
      const { value } = await Preferences.get({ key: QUEUE_KEY });
      if (value) return JSON.parse(value);
    } else if (typeof localStorage !== "undefined") {
      const v = localStorage.getItem(QUEUE_KEY);
      if (v) return JSON.parse(v);
    }
  } catch { /* ignore */ }
  return [];
}

async function writeQueue(q: QueuedPoint[]) {
  const trimmed = q.slice(-200);
  const s = JSON.stringify(trimmed);
  try {
    if (isNative()) {
      const { Preferences } = await import("@capacitor/preferences");
      await Preferences.set({ key: QUEUE_KEY, value: s });
      return;
    }
  } catch { /* fall through */ }
  if (typeof localStorage !== "undefined") localStorage.setItem(QUEUE_KEY, s);
}

export function DriverLiveShare({ token, hasActiveTrip, liveMeta, hidden, onSpeedChange }: {
  token: string;
  hasActiveTrip: boolean;
  liveMeta?: LiveShareMeta | null;
  hidden?: boolean;
  onSpeedChange?: (speedMps: number | null) => void;
}) {
  const [enabled, setEnabled] = useState(false);
  const [status, setStatus] = useState<"idle" | "live" | "paused" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [lastAt, setLastAt] = useState<number | null>(null);
  const native = isNative();
  const watchIdRef = useRef<number | null>(null); // web watchPosition id
  const nativeWatcherRef = useRef<string | null>(null); // native watcher id
  const wakeLockRef = useRef<any>(null);
  const queueRef = useRef<QueuedPoint[]>([]);
  const lastPosRef = useRef<{ lat: number; lng: number; t: number } | null>(null);
  const metaRef = useRef<LiveShareMeta | null>(liveMeta ?? null);
  const pushFn = useServerFn(pushDriverLocation);

  useEffect(() => { metaRef.current = liveMeta ?? null; }, [liveMeta]);

  // Restore persisted queue + toggle on mount.
  useEffect(() => {
    (async () => {
      queueRef.current = await readQueue();
      if (await readPersistedFlag()) setEnabled(true);
    })();
  }, []);

  // Auto-start tracking the moment the driver has an active trip (first
  // status change to en_route / arrived / in_progress). Coordinator can
  // then see the car move without the driver having to remember to tap.
  useEffect(() => {
    if (hasActiveTrip && !enabled) setEnabled(true);
    else if (!hasActiveTrip && enabled) setEnabled(false);
  }, [hasActiveTrip, enabled]);


  // Start / stop watch when `enabled` changes.
  useEffect(() => {
    if (!enabled) {
      // Web teardown
      if (watchIdRef.current != null && "geolocation" in navigator) {
        navigator.geolocation.clearWatch(watchIdRef.current);
      }
      watchIdRef.current = null;
      if (wakeLockRef.current) {
        try { wakeLockRef.current.release(); } catch { /* ignore */ }
        wakeLockRef.current = null;
      }
      // Native teardown
      if (nativeWatcherRef.current) {
        (async () => {
          try {
            const { registerPlugin } = await import("@capacitor/core");
            const BackgroundGeolocation = registerPlugin<{
              removeWatcher(o: { id: string }): Promise<void>;
            }>("BackgroundGeolocation");
            await BackgroundGeolocation.removeWatcher({ id: nativeWatcherRef.current! });
          } catch { /* ignore */ }
          nativeWatcherRef.current = null;
        })();
      }
      setStatus("idle"); setError(null);
      onSpeedChange?.(null);
      writePersistedFlag(false);
      return;
    }
    writePersistedFlag(true);

    const enqueue = (p: QueuedPoint) => {
      const now = new Date(p.captured_at).getTime() || Date.now();
      const cur = { lat: p.latitude, lng: p.longitude, t: now };
      const last = lastPosRef.current;
      const dt = last ? now - last.t : Infinity;
      const dm = last ? distanceMeters(last, cur) : Infinity;
      if (last && dt < MIN_INTERVAL_MS && dm < MIN_DISTANCE_M) return;
      lastPosRef.current = cur;
      setStatus("live"); setError(null); setLastAt(now);
      const m = metaRef.current;
      const enriched: QueuedPoint = m ? {
        ...p,
        eta_sec: m.eta_sec,
        distance_m: m.distance_m,
        next_instruction: m.next_instruction,
        destination_label: m.destination_label,
      } : p;
      onSpeedChange?.(p.speed_mps ?? null);
      queueRef.current.push(enriched);
      writeQueue(queueRef.current);
    };

    if (native) {
      // Native background geolocation.
      // The plugin manages permission prompts natively when
      // `requestPermissions: true` is passed. On Android 10+ it first asks
      // for foreground location, then escalates to "Allow all the time"
      // (background). On iOS it asks for "When in Use", then upgrades to
      // "Always" the first time a background location is delivered. A
      // NOT_AUTHORIZED error in the callback means the user declined.
      let cancelled = false;
      let watcherId: string | null = null;
      (async () => {
        try {
          const { registerPlugin } = await import("@capacitor/core");
          type WatcherOptions = { backgroundMessage?: string; backgroundTitle?: string; requestPermissions?: boolean; stale?: boolean; distanceFilter?: number };
          type LocationT = { latitude: number; longitude: number; accuracy?: number; bearing?: number | null; speed?: number | null; time?: number };
          type CallbackError = { code?: string; message?: string };
          type BGPlugin = {
            addWatcher(
              options: WatcherOptions,
              callback: (location?: LocationT, error?: CallbackError) => void,
            ): Promise<string>;
            removeWatcher(options: { id: string }): Promise<void>;
          };
          const BackgroundGeolocation = registerPlugin<BGPlugin>("BackgroundGeolocation");

          const id = await BackgroundGeolocation.addWatcher(
            {
              backgroundMessage: "Sharing live location with dispatcher",
              backgroundTitle: "Transfers MT",
              requestPermissions: true,
              stale: false,
              distanceFilter: MIN_DISTANCE_M,
            },
            (location, err) => {
              if (err) {
                if (err.code === "NOT_AUTHORIZED") {
                  setStatus("error");
                  setError("Location permission denied. Enable 'Always' in Settings.");
                  onSpeedChange?.(null);
                } else {
                  setStatus("error");
                  setError(err.message ?? "Location error");
                  onSpeedChange?.(null);
                }
                return;
              }
              if (!location) return;
              enqueue({
                latitude: location.latitude,
                longitude: location.longitude,
                accuracy_m: location.accuracy ?? null,
                heading: location.bearing ?? null,
                speed_mps: location.speed ?? null,
                captured_at: new Date(location.time ?? Date.now()).toISOString(),
              });
            },
          );
          watcherId = id;
          if (cancelled) {
            // Effect was torn down (trip completed) before addWatcher resolved.
            try { await BackgroundGeolocation.removeWatcher({ id }); } catch { /* ignore */ }
            nativeWatcherRef.current = null;
          } else {
            nativeWatcherRef.current = id;
          }
        } catch (e: any) {
          setStatus("error");
          setError(e?.message ?? "Failed to start background tracking");
          onSpeedChange?.(null);
        }
      })();
      return () => {
        cancelled = true;
        // Guaranteed teardown when the driver marks the trip completed
        // (or turns the toggle off). Stops the foreground service on
        // Android and releases the "Always" location hold on iOS so the
        // battery isn't drained after the trip.
        if (watcherId) {
          (async () => {
            try {
              const { registerPlugin } = await import("@capacitor/core");
              const BackgroundGeolocation = registerPlugin<{
                removeWatcher(o: { id: string }): Promise<void>;
              }>("BackgroundGeolocation");
              await BackgroundGeolocation.removeWatcher({ id: watcherId! });
            } catch { /* ignore */ }
            nativeWatcherRef.current = null;
          })();
        }
      };
    }

    // ------------ Web fallback ------------
    if (!("geolocation" in navigator)) {
      setStatus("error"); setError("Geolocation not supported"); return;
    }

    // Wake lock (best effort).
    (async () => {
      try {
        if ("wakeLock" in navigator) {
          wakeLockRef.current = await (navigator as any).wakeLock.request("screen");
        }
      } catch { /* ignore */ }
    })();

    const onVisible = async () => {
      if (document.visibilityState === "visible" && enabled && !wakeLockRef.current) {
        try {
          if ("wakeLock" in navigator) {
            wakeLockRef.current = await (navigator as any).wakeLock.request("screen");
          }
        } catch { /* ignore */ }
      }
    };
    document.addEventListener("visibilitychange", onVisible);

    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        enqueue({
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          accuracy_m: pos.coords.accuracy ?? null,
          heading: pos.coords.heading ?? null,
          speed_mps: pos.coords.speed ?? null,
          captured_at: new Date().toISOString(),
        });
      },
      (e) => {
        setStatus("error");
        setError(e.code === 1 ? "Permission denied" : e.message || "Location error");
        onSpeedChange?.(null);
      },
      { enableHighAccuracy: true, maximumAge: 5_000, timeout: 20_000 },
    );

    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      if (watchIdRef.current != null) navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
      if (wakeLockRef.current) { try { wakeLockRef.current.release(); } catch { /* ignore */ } wakeLockRef.current = null; }
    };
  }, [enabled, native, onSpeedChange]);

  // Flush queue periodically.
  useEffect(() => {
    if (!enabled) return;
    let running = false;
    const flush = async () => {
      if (running || queueRef.current.length === 0) return;
      running = true;
      const batch = queueRef.current.slice(0, 50);
      try {
        await pushFn({ data: { token, points: batch } });
        queueRef.current = queueRef.current.slice(batch.length);
        await writeQueue(queueRef.current);
      } catch (e: any) {
        setError(e?.message ?? "Upload failed");
      } finally { running = false; }
    };
    const id = setInterval(flush, FLUSH_INTERVAL_MS);
    flush();
    return () => clearInterval(id);
  }, [enabled, pushFn, token]);

  // "Paused" hint when web tab is hidden > 30s. Native runs in background so
  // we skip this to avoid false pauses.
  useEffect(() => {
    if (!enabled || !lastAt || native) return;
    const id = setInterval(() => {
      if (document.visibilityState === "hidden" || Date.now() - lastAt > 30_000) setStatus("paused");
    }, 5_000);
    return () => clearInterval(id);
  }, [enabled, lastAt, native]);

  return (
    <div
      className="rounded-lg border bg-card p-3 flex items-center gap-3"
      style={hidden ? { position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)", pointerEvents: "none", opacity: 0 } : undefined}
      aria-hidden={hidden ? true : undefined}
    >
      <div className={`h-9 w-9 rounded-full grid place-items-center shrink-0 ${
        status === "live" ? "bg-emerald-500/15 text-emerald-600"
          : status === "paused" ? "bg-amber-500/15 text-amber-600"
          : status === "error" ? "bg-destructive/15 text-destructive"
          : "bg-muted text-muted-foreground"
      }`}>
        {status === "error" ? <AlertTriangle className="h-4 w-4" />
          : status === "live" ? <MapPin className="h-4 w-4 animate-pulse" />
          : status === "paused" ? <Loader2 className="h-4 w-4 animate-spin" />
          : <MapPin className="h-4 w-4" />}
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold flex items-center gap-2 flex-wrap">
          Share live location
          {native && (
            <span className="inline-flex items-center gap-1 text-[10px] text-emerald-700 bg-emerald-500/10 px-1.5 py-0.5 rounded">
              <Smartphone className="h-3 w-3" /> Background
            </span>
          )}
          {enabled && (
            <Badge className={`text-[10px] ${
              status === "live" ? "bg-emerald-600 hover:bg-emerald-600"
                : status === "paused" ? "bg-amber-500 hover:bg-amber-500"
                : status === "error" ? "" : "bg-muted-foreground/70 hover:bg-muted-foreground/70"
            }`} variant={status === "error" ? "destructive" : "default"}>
              {status === "live" ? "Live"
                : status === "paused" ? "Paused"
                : status === "error" ? "Error"
                : "Starting…"}
            </Badge>
          )}
        </div>
        <div className="text-[11px] text-muted-foreground leading-snug mt-0.5">
          {enabled
            ? native
              ? (hasActiveTrip
                  ? "Tracking continues when the screen is off or the app is minimized."
                  : "Live now — your location is sent to the coordinator even without an active trip.")
              : (hasActiveTrip
                  ? "Keep this tab open. Minimizing the browser pauses updates. Install the app for background tracking."
                  : "Live now — keep this tab open so coordinators can see you on the map.")
            : native
              ? "Turn on to share your live location. You can share anytime — even before you're en route."
              : "Turn on and coordinators see your car on their map. Works even without an active trip."}
        </div>

        {error && <div className="text-[11px] text-destructive mt-0.5 truncate">{error}</div>}
      </div>
      <Button
        size="sm" variant={enabled ? "secondary" : "default"} className="shrink-0"
        onClick={() => setEnabled((v) => !v)}
      >
        {enabled ? "Turn off" : "Turn on"}
      </Button>
    </div>
  );
}
