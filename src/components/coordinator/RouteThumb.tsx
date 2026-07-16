import { MapIcon } from "lucide-react";

const BROWSER_KEY = import.meta.env.VITE_LOVABLE_CONNECTOR_GOOGLE_MAPS_BROWSER_KEY as
  | string
  | undefined;

/**
 * Small map thumbnail showing the A → B route for a trip card.
 *
 * Uses the Google Maps Embed API (Directions mode) via an iframe with the
 * referrer-restricted browser key. This works on `*.lovable.app` /
 * `*.lovableproject.com` and on connected custom domains without needing
 * Static Maps enabled on the server key.
 *
 * Optionally overlays an ETA / distance chip when provided.
 */
export function RouteThumb({
  from,
  to,
  className,
  onClick,
  title,
  etaSec,
  distanceM,
  width = 176,
  height = 72,
}: {
  from: string | null | undefined;
  to: string | null | undefined;
  className?: string;
  onClick?: (e: React.MouseEvent) => void;
  title?: string;
  etaSec?: number | null;
  distanceM?: number | null;
  width?: number;
  height?: number;
}) {
  const hasAddrs =
    !!from && !!to && from.trim().length > 1 && to.trim().length > 1;
  const canEmbed = !!BROWSER_KEY && hasAddrs;

  const src = canEmbed
    ? `https://www.google.com/maps/embed/v1/directions?key=${encodeURIComponent(
        BROWSER_KEY!,
      )}&origin=${encodeURIComponent(from!)}&destination=${encodeURIComponent(
        to!,
      )}&mode=driving`
    : null;

  const etaMin = etaSec && etaSec > 0 ? Math.max(1, Math.round(etaSec / 60)) : null;
  const km = distanceM && distanceM > 0 ? (distanceM / 1000).toFixed(1) : null;
  const chip =
    etaMin != null || km != null
      ? [etaMin != null ? `${etaMin} min` : null, km != null ? `${km} km` : null]
          .filter(Boolean)
          .join(" · ")
      : null;

  const box =
    "relative shrink-0 rounded-md overflow-hidden border bg-muted/40 " +
    (onClick ? "cursor-pointer hover:ring-2 hover:ring-primary/40 transition" : "");

  return (
    <div
      className={`${box} ${className ?? ""}`}
      style={{ width, height }}
      onClick={(e) => {
        e.stopPropagation();
        onClick?.(e);
      }}
      title={title ?? "Route preview — click to open trip"}
      aria-label="Route preview"
    >
      {src ? (
        <>
          <iframe
            src={src}
            title="Route preview"
            className="w-full h-full border-0 pointer-events-none"
            loading="lazy"
            referrerPolicy="no-referrer-when-downgrade"
          />
          {/* Transparent overlay so clicks bubble to the parent card */}
          <div className="absolute inset-0" />
          {chip && (
            <div className="absolute bottom-1 left-1 rounded bg-background/85 backdrop-blur px-1.5 py-0.5 text-[10px] font-semibold tabular-nums shadow-sm">
              {chip}
            </div>
          )}
        </>
      ) : (
        <div className="w-full h-full flex flex-col items-center justify-center text-muted-foreground gap-0.5">
          <MapIcon className="h-4 w-4 opacity-60" />
          {chip && (
            <span className="text-[10px] font-medium tabular-nums">{chip}</span>
          )}
        </div>
      )}
    </div>
  );
}
