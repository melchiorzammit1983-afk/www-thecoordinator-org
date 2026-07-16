import { Clock } from "lucide-react";

/**
 * Compact ETA chip showing how long the A → B trip will take.
 *
 * The map preview was removed — coordinators only need the drive time
 * (and optional distance) at a glance on the trip row.
 */
export function RouteThumb({
  className,
  onClick,
  title,
  etaSec,
  distanceM,
  width = 176,
  height = 72,
}: {
  from?: string | null | undefined;
  to?: string | null | undefined;
  className?: string;
  onClick?: (e: React.MouseEvent) => void;
  title?: string;
  etaSec?: number | null;
  distanceM?: number | null;
  width?: number;
  height?: number;
}) {
  const etaMin = etaSec && etaSec > 0 ? Math.max(1, Math.round(etaSec / 60)) : null;
  const km = distanceM && distanceM > 0 ? (distanceM / 1000).toFixed(1) : null;

  const box =
    "relative shrink-0 rounded-md overflow-hidden border bg-muted/40 flex flex-col items-center justify-center gap-0.5 text-center px-2 " +
    (onClick ? "cursor-pointer hover:ring-2 hover:ring-primary/40 transition" : "");

  return (
    <div
      className={`${box} ${className ?? ""}`}
      style={{ width, height }}
      onClick={(e) => {
        e.stopPropagation();
        onClick?.(e);
      }}
      title={title ?? (etaMin != null ? `Drive time ~${etaMin} min` : "Drive time")}
      aria-label={etaMin != null ? `Drive time ${etaMin} minutes` : "Drive time unavailable"}
    >
      <div className="flex items-center gap-1 text-foreground">
        <Clock className="h-3.5 w-3.5 opacity-70" />
        <span className="text-sm font-semibold tabular-nums leading-none">
          {etaMin != null ? `${etaMin} min` : "—"}
        </span>
      </div>
      {km != null && (
        <span className="text-[10px] text-muted-foreground tabular-nums leading-none">
          {km} km
        </span>
      )}
    </div>
  );
}
