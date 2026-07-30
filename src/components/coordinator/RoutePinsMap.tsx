import { useEffect, useRef, useState } from "react";
import { loadGoogleMaps } from "@/components/driver/DriverDashboardMap";

type LatLng = { lat: number; lng: number };

/**
 * Lightweight pickup/dropoff preview map for the New Trip dialog — just two
 * pins (green pickup, red dropoff), no routed polyline. Deliberately simpler
 * than the trip-card live map: this renders before a job exists, from
 * whatever lat/lng the address autocomplete has resolved so far, so it must
 * work with only one side filled in and must never block trip creation if
 * Maps fails to load.
 */
export function RoutePinsMap({ from, to }: { from: LatLng | null; to: LatLng | null }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const markersRef = useRef<any[]>([]);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!from && !to) return;
    let cancelled = false;
    loadGoogleMaps()
      .then((maps) => {
        if (cancelled || !containerRef.current) return;
        if (!mapRef.current) {
          mapRef.current = new maps.Map(containerRef.current, {
            center: from ?? to!,
            zoom: 12,
            disableDefaultUI: true,
            zoomControl: true,
          });
        }
        markersRef.current.forEach((m) => m.setMap(null));
        markersRef.current = [];
        const bounds = new maps.LatLngBounds();
        if (from) {
          markersRef.current.push(
            new maps.Marker({
              position: from,
              map: mapRef.current,
              title: "Pickup",
              icon: {
                path: maps.SymbolPath.CIRCLE,
                scale: 8,
                fillColor: "#22c55e",
                fillOpacity: 1,
                strokeColor: "#ffffff",
                strokeWeight: 2,
              },
            }),
          );
          bounds.extend(from);
        }
        if (to) {
          markersRef.current.push(
            new maps.Marker({
              position: to,
              map: mapRef.current,
              title: "Dropoff",
              icon: {
                path: maps.SymbolPath.CIRCLE,
                scale: 8,
                fillColor: "#ef4444",
                fillOpacity: 1,
                strokeColor: "#ffffff",
                strokeWeight: 2,
              },
            }),
          );
          bounds.extend(to);
        }
        if (from && to) mapRef.current.fitBounds(bounds, 40);
        else mapRef.current.setCenter(from ?? to!);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [from?.lat, from?.lng, to?.lat, to?.lng]);

  if (failed || (!from && !to)) return null;

  return <div ref={containerRef} className="h-36 w-full rounded-md border" />;
}
