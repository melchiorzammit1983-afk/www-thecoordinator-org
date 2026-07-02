import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { pushDriverLocation } from "@/lib/coordinator-public.functions";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { MapPin, Loader2, AlertTriangle } from "lucide-react";

type QueuedPoint = {
  latitude: number;
  longitude: number;
  accuracy_m: number | null;
  heading: number | null;
  speed_mps: number | null;
  captured_at: string;
};

const STORAGE_KEY = "driverLiveShareOn";
const QUEUE_KEY = "driverLiveQueue";
const MIN_DISTANCE_M = 25;
const MIN_INTERVAL_MS = 8_000;
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

export function DriverLiveShare({ token, hasActiveTrip }: { token: string; hasActiveTrip: boolean }) {
  const [enabled, setEnabled] = useState(false);
  const [status, setStatus] = useState<"idle" | "live" | "paused" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [lastAt, setLastAt] = useState<number | null>(null);
  const watchIdRef = useRef<number | null>(null);
  const wakeLockRef = useRef<any>(null);
  const queueRef = useRef<QueuedPoint[]>([]);
  const lastPosRef = useRef<{ lat: number; lng: number; t: number } | null>(null);
  const pushFn = useServerFn(pushDriverLocation);

  // Restore persisted queue + toggle
  useEffect(() => {
    try {
      const q = JSON.parse(localStorage.getItem(QUEUE_KEY) || "[]");
      if (Array.isArray(q)) queueRef.current = q;
    } catch { /* ignore */ }
    if (localStorage.getItem(STORAGE_KEY) === "1") setEnabled(true);
  }, []);

  // Start / stop watch when enabled changes.
  useEffect(() => {
    if (!enabled) {
      if (watchIdRef.current != null && "geolocation" in navigator) {
        navigator.geolocation.clearWatch(watchIdRef.current);
      }
      watchIdRef.current = null;
      if (wakeLockRef.current) {
        try { wakeLockRef.current.release(); } catch { /* ignore */ }
        wakeLockRef.current = null;
      }
      setStatus("idle"); setError(null);
      localStorage.setItem(STORAGE_KEY, "0");
      return;
    }
    localStorage.setItem(STORAGE_KEY, "1");
    if (!("geolocation" in navigator)) { setStatus("error"); setError("Geolocation not supported"); return; }

    // Wake lock (best effort)
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
        const now = Date.now();
        const cur = { lat: pos.coords.latitude, lng: pos.coords.longitude, t: now };
        const last = lastPosRef.current;
        const dt = last ? now - last.t : Infinity;
        const dm = last ? distanceMeters(last, cur) : Infinity;
        if (last && dt < MIN_INTERVAL_MS && dm < MIN_DISTANCE_M) return;
        lastPosRef.current = cur;
        setStatus("live"); setError(null); setLastAt(now);
        const point: QueuedPoint = {
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          accuracy_m: pos.coords.accuracy ?? null,
          heading: pos.coords.heading ?? null,
          speed_mps: pos.coords.speed ?? null,
          captured_at: new Date(now).toISOString(),
        };
        queueRef.current.push(point);
        try { localStorage.setItem(QUEUE_KEY, JSON.stringify(queueRef.current.slice(-100))); } catch { /* ignore */ }
      },
      (e) => {
        setStatus("error");
        setError(e.code === 1 ? "Permission denied" : e.message || "Location error");
      },
      { enableHighAccuracy: true, maximumAge: 5_000, timeout: 20_000 },
    );

    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      if (watchIdRef.current != null) navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
      if (wakeLockRef.current) { try { wakeLockRef.current.release(); } catch { /* ignore */ } wakeLockRef.current = null; }
    };
  }, [enabled]);

  // Flush queue.
  useEffect(() => {
    if (!enabled) return;
    let running = false;
    const flush = async () => {
      if (running) return;
      if (queueRef.current.length === 0) return;
      running = true;
      const batch = queueRef.current.slice(0, 50);
      try {
        await pushFn({ data: { token, points: batch } });
        queueRef.current = queueRef.current.slice(batch.length);
        localStorage.setItem(QUEUE_KEY, JSON.stringify(queueRef.current));
      } catch (e: any) {
        // Keep queued; will retry.
        setError(e?.message ?? "Upload failed");
      } finally { running = false; }
    };
    const id = setInterval(flush, FLUSH_INTERVAL_MS);
    flush();
    return () => clearInterval(id);
  }, [enabled, pushFn, token]);

  // "Paused" hint when tab is hidden > 30s
  useEffect(() => {
    if (!enabled || !lastAt) return;
    const id = setInterval(() => {
      if (document.visibilityState === "hidden" || Date.now() - lastAt > 30_000) setStatus("paused");
    }, 5_000);
    return () => clearInterval(id);
  }, [enabled, lastAt]);

  return (
    <div className="rounded-lg border bg-card p-3 flex items-center gap-3">
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
        <div className="text-sm font-semibold flex items-center gap-2">
          Share live location
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
            ? (hasActiveTrip
                ? "Keep this tab open. Minimizing the app pauses updates."
                : "Location will send once you're en route. Turns off between trips.")
            : "Coordinators can see your car on their map while enabled."}
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
