import { useRef } from "react";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { RefreshCw, Navigation2, MapPin, Route, AlertTriangle, WifiOff } from "lucide-react";
import { getTripRouteInsights } from "@/lib/route-insights.functions";
import { Button } from "@/components/ui/button";
import { formatEta } from "@/lib/trip-display";

type Insights = Awaited<ReturnType<typeof getTripRouteInsights>>;

/**
 * Coordinator "route insights" panel.
 *
 * Pre-acceptance: shows the planned pickup → dropoff route (ETA, distance,
 * traffic delay). Post-acceptance: adds a live "driver → pickup" leg from
 * the driver's most recent GPS ping.
 *
 * Resilient to network / provider failures: on error we surface a plain-
 * language message with a Retry button, and keep displaying the last
 * successful ETA (marked as stale) so the coordinator always has a number
 * to work with.
 */
export function TripRouteInsights({ jobId }: { jobId: string }) {
  const fn = useServerFn(getTripRouteInsights);
  const lastGoodAt = useRef<number | null>(null);

  const q = useQuery<Insights, Error>({
    queryKey: ["trip-route-insights", jobId],
    queryFn: () => fn({ data: { job_id: jobId } }),
    refetchInterval: 60_000,
    staleTime: 30_000,
    retry: 1,
    placeholderData: keepPreviousData,
  });

  if (q.data && q.isSuccess && !q.isFetching) {
    lastGoodAt.current = Date.now();
  }

  const insights = q.data ?? null;
  const showingStale = q.isError && !!insights;
  const errMsg = q.isError ? friendlyError((q.error as Error)?.message) : null;

  return (
    <div className="rounded-md border p-3 space-y-3 bg-muted/40">
      <div className="flex items-center justify-between gap-2">
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

      {/* First-load skeleton */}
      {q.isLoading && !insights && (
        <div className="text-xs text-muted-foreground">Loading route…</div>
      )}

      {/* Hard failure with no cached data */}
      {q.isError && !insights && errMsg && (
        <ErrorBanner
          title={errMsg.title}
          detail={errMsg.detail}
          icon={errMsg.icon}
          onRetry={() => q.refetch()}
          retrying={q.isFetching}
        />
      )}

      {/* Cached data (possibly stale) */}
      {insights && (
        <>
          {showingStale && errMsg && (
            <ErrorBanner
              title={errMsg.title}
              detail={`${errMsg.detail} Showing last-known ETA${
                lastGoodAt.current
                  ? ` from ${relativeTime(new Date(lastGoodAt.current).toISOString())}`
                  : ""
              }.`}
              icon={errMsg.icon}
              onRetry={() => q.refetch()}
              retrying={q.isFetching}
              tone="warning"
            />
          )}

          <LegRow
            icon={<Route className="h-4 w-4 text-primary" />}
            title="Trip route"
            subtitle="Pickup → Drop-off"
            leg={insights.planned}
            emptyMsg="Route unavailable — the map provider didn't return a path for these addresses."
            stale={showingStale}
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
                  ? "Route to pickup unavailable — traffic service didn't respond."
                  : "Driver hasn't shared their location yet."
              }
              stale={showingStale}
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

function ErrorBanner({
  title,
  detail,
  icon,
  onRetry,
  retrying,
  tone = "error",
}: {
  title: string;
  detail: string;
  icon: React.ReactNode;
  onRetry: () => void;
  retrying: boolean;
  tone?: "error" | "warning";
}) {
  const toneCls =
    tone === "warning"
      ? "border-amber-500/40 bg-amber-500/10 text-amber-900 dark:text-amber-200"
      : "border-red-500/40 bg-red-500/10 text-red-900 dark:text-red-200";
  return (
    <div className={`rounded-md border px-2.5 py-2 text-xs ${toneCls}`}>
      <div className="flex items-start gap-2">
        <div className="shrink-0 mt-0.5">{icon}</div>
        <div className="flex-1 min-w-0">
          <div className="font-medium leading-tight">{title}</div>
          <div className="mt-0.5 text-[11px] opacity-90">{detail}</div>
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-7 px-2 text-xs shrink-0"
          onClick={onRetry}
          disabled={retrying}
        >
          <RefreshCw className={`h-3 w-3 mr-1 ${retrying ? "animate-spin" : ""}`} />
          Retry
        </Button>
      </div>
    </div>
  );
}

function friendlyError(raw: string | undefined): {
  title: string;
  detail: string;
  icon: React.ReactNode;
} {
  const msg = (raw ?? "").toLowerCase();
  if (msg.includes("routing_unavailable")) {
    return {
      title: "Map service isn't connected",
      detail: "The traffic and routing provider isn't set up. Ask an admin to reconnect Google Maps.",
      icon: <AlertTriangle className="h-4 w-4" />,
    };
  }
  if (msg.includes("routes_api_403") || msg.includes("permission_denied") || msg.includes("request_denied")) {
    return {
      title: "Traffic service refused the request",
      detail: "The Google Maps key needs the Routes API enabled. An admin can fix this in the Cloud Console.",
      icon: <AlertTriangle className="h-4 w-4" />,
    };
  }
  if (msg.includes("routes_api_429") || msg.includes("resource_exhausted") || msg.includes("quota")) {
    return {
      title: "Traffic service is rate-limited",
      detail: "Too many requests for now. It usually clears within a minute — try again shortly.",
      icon: <AlertTriangle className="h-4 w-4" />,
    };
  }
  if (msg.includes("routes_api_5") || msg.includes("upstream") || msg.includes("gateway")) {
    return {
      title: "Traffic service is temporarily down",
      detail: "Google's routing service didn't respond. Retry in a few seconds.",
      icon: <WifiOff className="h-4 w-4" />,
    };
  }
  if (msg.includes("failed to fetch") || msg.includes("networkerror") || msg.includes("network")) {
    return {
      title: "Can't reach the server",
      detail: "Check the internet connection and retry.",
      icon: <WifiOff className="h-4 w-4" />,
    };
  }
  if (msg.includes("not found") || msg.includes("access denied")) {
    return {
      title: "This trip is no longer available",
      detail: "The trip may have been reassigned or deleted. Reopen it from the calendar.",
      icon: <AlertTriangle className="h-4 w-4" />,
    };
  }
  return {
    title: "Couldn't refresh the route",
    detail: "Something went wrong reaching the map service. You can try again.",
    icon: <AlertTriangle className="h-4 w-4" />,
  };
}

function LegRow({
  icon,
  title,
  subtitle,
  leg,
  emptyMsg,
  stale,
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
  stale?: boolean;
}) {
  const trafficMin =
    leg?.traffic_delay_sec != null ? Math.round(leg.traffic_delay_sec / 60) : 0;
  const severity =
    trafficMin >= 10 ? "high" : trafficMin >= 4 ? "medium" : trafficMin >= 1 ? "low" : "none";
  return (
    <div className={`flex items-start gap-2 ${stale ? "opacity-70" : ""}`}>
      <div className="shrink-0 mt-0.5">{icon}</div>
      <div className="flex-1 min-w-0">
        <div className="text-xs font-medium leading-tight flex items-center gap-1.5">
          {title}
          {stale && leg && (
            <span className="rounded-full bg-amber-500/15 text-amber-800 dark:text-amber-200 px-1.5 py-0.5 text-[9px] uppercase tracking-wide font-semibold">
              Last known
            </span>
          )}
        </div>
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
