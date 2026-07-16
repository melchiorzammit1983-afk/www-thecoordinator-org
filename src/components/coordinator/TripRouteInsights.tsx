import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { RefreshCw, Navigation2, MapPin, Route } from "lucide-react";
import { getTripRouteInsights } from "@/lib/route-insights.functions";
import { Button } from "@/components/ui/button";
import { formatEta } from "@/lib/trip-display";

/**
 * Coordinator "route insights" panel.
 *
 * Pre-acceptance: shows the planned pickup → dropoff route (ETA, distance,
 * traffic delay). Post-acceptance: adds a live "driver → pickup" leg computed
 * from the driver's most recent GPS ping.
 *
 * Auto-refreshes every 60s while the trip is not completed so the coordinator
 * always sees fresh traffic information.
 */
export function TripRouteInsights({ jobId }: { jobId: string }) {
  const fn = useServerFn(getTripRouteInsights);
  const q = useQuery({
    queryKey: ["trip-route-insights", jobId],
    queryFn: () => fn({ data: { job_id: jobId } }),
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  const isLoading = q.isLoading;
  const insights = q.data;

  return (
    <div className="rounded-md border p-3 space-y-3 bg-muted/40">
      <div className="flex items-center justify-between">
        <div className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium">
          Route insights
        </div>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-7 px-2 text-xs"
          onClick={() => q.refetch()}
          disabled={q.isFetching}
        >
          <RefreshCw className={`h-3 w-3 mr-1 ${q.isFetching ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {isLoading && <div className="text-xs text-muted-foreground">Loading route…</div>}
      {q.isError && (
        <div className="text-xs text-destructive">
          {(q.error as Error)?.message ?? "Could not load route"}
        </div>
      )}

      {insights && (
        <>
          <LegRow
            icon={<Route className="h-4 w-4 text-primary" />}
            title="Trip route"
            subtitle="Pickup → Drop-off"
            leg={insights.planned}
            emptyMsg="Route unavailable"
          />

          {insights.phase === "post" && (
            <LegRow
              icon={<Navigation2 className="h-4 w-4 text-emerald-600" />}
              title="Driver → Pickup"
              subtitle={
                insights.driverPing
                  ? `GPS ${relativeTime(insights.driverPing.captured_at)}${
                      insights.driverPing.accuracy_m
                        ? ` · ±${Math.round(insights.driverPing.accuracy_m)}m`
                        : ""
                    }`
                  : "Waiting for driver's first GPS ping…"
              }
              leg={insights.toPickup}
              emptyMsg={
                insights.driverPing
                  ? "Route to pickup unavailable"
                  : "Driver has not shared location yet"
              }
            />
          )}

          {insights.phase === "pre" && (
            <div className="flex items-start gap-2 text-[11px] text-muted-foreground border-t border-dashed pt-2">
              <MapPin className="h-3.5 w-3.5 mt-0.5" />
              <span>
                Live driver → pickup ETA appears here once the driver accepts
                the trip.
              </span>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function LegRow({
  icon,
  title,
  subtitle,
  leg,
  emptyMsg,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  leg: {
    duration_sec: number | null;
    distance_m: number | null;
    traffic_delay_sec: number | null;
  } | null;
  emptyMsg: string;
}) {
  const trafficMin =
    leg?.traffic_delay_sec != null ? Math.round(leg.traffic_delay_sec / 60) : 0;
  const severity =
    trafficMin >= 10 ? "high" : trafficMin >= 4 ? "medium" : trafficMin >= 1 ? "low" : "none";
  return (
    <div className="flex items-start gap-2">
      <div className="shrink-0 mt-0.5">{icon}</div>
      <div className="flex-1 min-w-0">
        <div className="text-xs font-medium leading-tight">{title}</div>
        <div className="text-[11px] text-muted-foreground truncate">{subtitle}</div>
        {leg ? (
          <div className="mt-1 flex flex-wrap items-center gap-1.5 tabular-nums">
            <span className="inline-flex items-center rounded-full bg-primary/10 text-primary px-2 py-0.5 text-[11px] font-medium">
              {formatEta(leg.duration_sec) ?? "—"}
            </span>
            {leg.distance_m != null && (
              <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-[11px]">
                {(leg.distance_m / 1000).toFixed(1)} km
              </span>
            )}
            {trafficMin > 0 && (
              <span
                className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${
                  severity === "high"
                    ? "bg-red-500/10 text-red-700 dark:text-red-300"
                    : severity === "medium"
                      ? "bg-amber-500/10 text-amber-700 dark:text-amber-300"
                      : "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                }`}
              >
                +{trafficMin} min traffic
              </span>
            )}
            {trafficMin === 0 && leg.duration_sec != null && (
              <span className="inline-flex items-center rounded-full bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 px-2 py-0.5 text-[11px]">
                Clear traffic
              </span>
            )}
          </div>
        ) : (
          <div className="mt-1 text-[11px] text-muted-foreground">{emptyMsg}</div>
        )}
      </div>
    </div>
  );
}

function relativeTime(iso: string): string {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 30) return "just now";
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}
