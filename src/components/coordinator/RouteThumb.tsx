import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { MapIcon, ExpandIcon } from "lucide-react";
import { getRouteThumb } from "@/lib/static-map.functions";
import { getTripMap } from "@/lib/trip-map.functions";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { TripEventsMap } from "./TripEventsMap";

/**
 * Small static-map thumbnail showing the A → B route for a trip card.
 *
 * - Cached per (from, to, driver-cell) so scrolling the list doesn't refetch.
 * - When `jobId` is passed and the trip is live, we poll the trip map to grab
 *   the driver's latest breadcrumb point and overlay it as a blue dot so the
 *   thumb reflects live driver progress.
 * - Clicking opens a large dialog with the full interactive TripEventsMap
 *   (event pins, breadcrumb, live driver marker).
 * - Falls back to a subtle A → B text placeholder when the static map fails
 *   or coords are missing, so cards never render a broken image.
 */
export function RouteThumb({
  from,
  to,
  driver,
  jobId,
  isLive,
  className,
  onClick,
  title,
}: {
  from: string | null | undefined;
  to: string | null | undefined;
  driver?: { lat: number; lng: number } | null;
  /** When set + live, thumb polls trip map for last driver point and click opens full map. */
  jobId?: string;
  isLive?: boolean;
  className?: string;
  /** If provided, replaces the default "open full map" behaviour. */
  onClick?: (e: React.MouseEvent) => void;
  title?: string;
}) {
  const fetchThumb = useServerFn(getRouteThumb);
  const fetchTripMap = useServerFn(getTripMap);
  const [open, setOpen] = useState(false);

  // Live driver point from trip map (breadcrumb tail) when we have a jobId.
  const tripMap = useQuery({
    queryKey: ["trip-map", jobId],
    queryFn: () => fetchTripMap({ data: { job_id: jobId! } }) as Promise<any>,
    enabled: !!jobId && !!isLive,
    refetchInterval: isLive ? 30_000 : false,
    staleTime: 15_000,
  });

  const liveDriver = useMemo<{ lat: number; lng: number } | null>(() => {
    if (driver) return driver;
    const crumbs = (tripMap.data as any)?.breadcrumb as
      | Array<{ lat: number; lng: number }>
      | undefined;
    if (!crumbs?.length) return null;
    const tail = crumbs[crumbs.length - 1];
    if (typeof tail?.lat !== "number" || typeof tail?.lng !== "number") return null;
    return { lat: tail.lat, lng: tail.lng };
  }, [driver, tripMap.data]);

  // Round driver coord to ~50 m so tiny GPS jitter doesn't invalidate the cache.
  const dCell = liveDriver
    ? `${liveDriver.lat.toFixed(3)},${liveDriver.lng.toFixed(3)}`
    : null;

  const enabled = !!(from && to && from.trim().length > 1 && to.trim().length > 1);

  const q = useQuery({
    queryKey: ["route-thumb", from, to, dCell],
    queryFn: () =>
      fetchThumb({
        data: {
          from: from!,
          to: to!,
          driver: liveDriver ?? null,
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
  const clickable = !!onClick || !!jobId;

  const box =
    "relative shrink-0 rounded-md overflow-hidden border bg-muted/40 group " +
    (clickable ? "cursor-pointer hover:ring-2 hover:ring-primary/40 transition" : "");

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (onClick) {
      onClick(e);
      return;
    }
    if (jobId) setOpen(true);
  };

  const fromShort = (from ?? "").split(",")[0]?.trim() || "Pickup";
  const toShort = (to ?? "").split(",")[0]?.trim() || "Drop-off";

  return (
    <>
      <div
        className={`${box} ${className ?? ""}`}
        style={{ width: 96, height: 56 }}
        onClick={handleClick}
        role={clickable ? "button" : undefined}
        tabIndex={clickable ? 0 : undefined}
        onKeyDown={(e) => {
          if (!clickable) return;
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            handleClick(e as unknown as React.MouseEvent);
          }
        }}
        title={title ?? (jobId ? "Open live trip map" : "Route preview")}
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
          <div className="w-full h-full flex flex-col items-center justify-center px-1 text-[9px] leading-tight text-muted-foreground text-center">
            <MapIcon className="h-3 w-3 opacity-60 mb-0.5" />
            <span className="truncate w-full">{fromShort}</span>
            <span className="opacity-60">→</span>
            <span className="truncate w-full">{toShort}</span>
          </div>
        )}

        {/* Live driver pulse dot overlay */}
        {liveDriver && (
          <span className="absolute top-1 right-1 flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-500 opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-600 ring-1 ring-white" />
          </span>
        )}

        {clickable && (
          <span className="absolute bottom-0.5 left-0.5 opacity-0 group-hover:opacity-100 transition bg-background/80 rounded p-0.5">
            <ExpandIcon className="h-3 w-3" />
          </span>
        )}
      </div>

      {jobId && (
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent
            className="max-w-5xl w-[95vw] p-0 gap-0"
            onClick={(e) => e.stopPropagation()}
          >
            <DialogHeader className="p-4 pb-2">
              <DialogTitle className="flex items-center gap-2">
                <MapIcon className="h-4 w-4" />
                Live trip map
              </DialogTitle>
              <DialogDescription className="text-xs">
                {fromShort} → {toShort}
                {isLive ? " · Updating every 30s" : " · Read-only replay"}
              </DialogDescription>
            </DialogHeader>
            <div className="px-4 pb-4">
              <TripEventsMap jobId={jobId} isLive={!!isLive} />
            </div>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
