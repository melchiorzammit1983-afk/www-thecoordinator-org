import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { MapIcon } from "lucide-react";
import { getRouteThumb } from "@/lib/static-map.functions";

/**
 * Small static-map thumbnail showing the A → B route for a trip card.
 *
 * - Cached per (from, to, driver-cell) so scrolling the list doesn't refetch.
 * - When the trip is live and we have a driver point, adds a small blue dot.
 * - Falls back to a subtle placeholder when coords/addresses are missing or
 *   the Static Maps call fails, so cards never render a broken image.
 */
export function RouteThumb({
  from,
  to,
  driver,
  className,
  onClick,
  title,
}: {
  from: string | null | undefined;
  to: string | null | undefined;
  driver?: { lat: number; lng: number } | null;
  className?: string;
  onClick?: (e: React.MouseEvent) => void;
  title?: string;
}) {
  const fetchThumb = useServerFn(getRouteThumb);

  // Round driver coord to ~50 m so tiny GPS jitter doesn't invalidate the cache.
  const dCell = driver
    ? `${driver.lat.toFixed(3)},${driver.lng.toFixed(3)}`
    : null;

  const enabled = !!(from && to && from.trim().length > 1 && to.trim().length > 1);

  const q = useQuery({
    queryKey: ["route-thumb", from, to, dCell],
    queryFn: () =>
      fetchThumb({
        data: {
          from: from!,
          to: to!,
          driver: driver ?? null,
          width: 192,
          height: 112,
          scale: 2,
        },
      }),
    enabled,
    staleTime: 5 * 60_000,
    gcTime: 15 * 60_000,
    refetchOnWindowFocus: false,
    retry: 1,
  });

  const dataUrl = q.data && (q.data as any).ok ? (q.data as any).dataUrl : null;

  const box =
    "relative shrink-0 rounded-md overflow-hidden border bg-muted/40 " +
    (onClick ? "cursor-pointer hover:ring-2 hover:ring-primary/40 transition" : "");

  return (
    <div
      className={`${box} ${className ?? ""}`}
      style={{ width: 96, height: 56 }}
      onClick={(e) => {
        e.stopPropagation();
        onClick?.(e);
      }}
      title={title ?? "Route preview — click to open trip"}
      aria-label="Route preview"
    >
      {dataUrl ? (
        <img
          src={dataUrl}
          alt="Route from pickup to dropoff"
          loading="lazy"
          className="w-full h-full object-cover"
          draggable={false}
        />
      ) : (
        <div className="w-full h-full flex items-center justify-center text-muted-foreground">
          <MapIcon className="h-4 w-4 opacity-60" />
        </div>
      )}
    </div>
  );
}
