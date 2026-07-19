"use client";

import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Plane, AlertTriangle, AlertCircle } from "lucide-react";
import { getFlightTrackingConfig } from "@/lib/coordinator.functions";
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export function FlightTrackingIndicator() {
  const fn = useServerFn(getFlightTrackingConfig);
  const { data } = useQuery({
    queryKey: ["flight-tracking-config"],
    queryFn: () => fn(),
    staleTime: 5 * 60_000,
  });

  const configured = data?.configured ?? null;
  const isConfigured = configured === true;
  const isNotConfigured = configured === false;

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <div
            className={cn(
              "inline-flex items-center gap-1.5 px-2 py-1 rounded-md border text-[11px] font-medium transition-colors",
              isConfigured && "border-emerald-500/50 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
              isNotConfigured && "border-amber-500/50 bg-amber-500/10 text-amber-800 dark:text-amber-300",
              configured === null && "border-muted bg-muted text-muted-foreground",
            )}
            aria-label={
              isConfigured
                ? "Live flight tracking is configured"
                : isNotConfigured
                  ? "Flight tracking is not configured"
                  : "Checking flight tracking configuration"
            }
          >
            {isConfigured ? (
              <Plane className="h-3.5 w-3.5" />
            ) : isNotConfigured ? (
              <PlaneOff className="h-3.5 w-3.5" />
            ) : (
              <AlertCircle className="h-3.5 w-3.5" />
            )}
            <span className="hidden sm:inline">
              {isConfigured
                ? "Live flight tracking configured"
                : isNotConfigured
                  ? "Flight tracking not configured"
                  : "Checking flight tracking…"}
            </span>
            <span className="sm:hidden">
              {isConfigured ? "Live" : isNotConfigured ? "Not configured" : "…"}
            </span>
          </div>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="max-w-xs">
          <p>
            {isConfigured
              ? "Flight tracking is live via AeroDataBox (RapidAPI). Trip cards will update automatically when real-time data is available."
              : isNotConfigured
                ? "Live flight tracking is not configured. Add your AERODATABOX_API_KEY secret to enable real-time flight status on trips."
                : "Checking whether the flight tracking integration is configured…"}
          </p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
