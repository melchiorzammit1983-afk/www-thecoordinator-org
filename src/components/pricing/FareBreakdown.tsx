/**
 * Reusable, presentation-only fare breakdown.
 * Give it a computed breakdown (see `computeFareBreakdown`) and it renders
 * the itemized list, subtotal (fare), waiting charges, and grand total.
 *
 * Compact variant is intended for use inside trip cards; the default
 * variant is for the pricing preview and larger detail views.
 */
import type { FareBreakdown } from "@/lib/fare";
import { Badge } from "@/components/ui/badge";

export function FareBreakdownView({
  breakdown,
  compact = false,
  title,
}: {
  breakdown: FareBreakdown;
  compact?: boolean;
  title?: string;
}) {
  const { currency, areaName, lines, fare, waitCharge, total, minimumApplied } = breakdown;
  const fmt = (n: number) =>
    `${n < 0 ? "−" : ""}${currency} ${Math.abs(n).toFixed(2)}`;

  return (
    <div className={compact ? "text-xs" : "text-sm"}>
      {(title || areaName) && (
        <div className="flex items-center justify-between mb-1.5">
          <span className={compact ? "font-medium" : "text-sm font-semibold"}>
            {title ?? "Fare breakdown"}
          </span>
          {areaName && (
            <Badge variant="outline" className="text-[10px]">
              Zone: {areaName}
            </Badge>
          )}
        </div>
      )}

      <div className="rounded-md border divide-y">
        {lines.map((l) => (
          <Row
            key={l.key}
            label={l.label}
            value={fmt(l.amount)}
            muted={l.muted}
            adjustment={l.adjustment}
            compact={compact}
          />
        ))}
        <Row
          label={minimumApplied ? "Fare (minimum applied)" : "Fare"}
          value={fmt(fare)}
          strong
          compact={compact}
        />
        {waitCharge > 0 && (
          <Row label="Waiting charges" value={fmt(waitCharge)} strong compact={compact} />
        )}
        <Row label="Total" value={fmt(total)} strong emphasis compact={compact} />
      </div>
    </div>
  );
}

function Row({
  label, value, muted, strong, emphasis, adjustment, compact,
}: {
  label: string;
  value: string;
  muted?: boolean;
  strong?: boolean;
  emphasis?: boolean;
  adjustment?: boolean;
  compact?: boolean;
}) {
  const pad = compact ? "px-2.5 py-1.5" : "px-3 py-2";
  return (
    <div
      className={[
        "flex items-center justify-between gap-3",
        pad,
        muted ? "text-muted-foreground" : "",
        strong ? "font-semibold" : "",
        emphasis ? "bg-muted/40" : "",
      ].join(" ")}
    >
      <span className="flex items-center gap-1.5 min-w-0">
        <span className="truncate">{label}</span>
        {adjustment && (
          <Badge variant="secondary" className="text-[9px] leading-none py-0.5 px-1.5">
            adj
          </Badge>
        )}
      </span>
      <span className="tabular-nums shrink-0">{value}</span>
    </div>
  );
}
