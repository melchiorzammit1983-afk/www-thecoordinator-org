import { Info } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { FEATURE_META_BY_KEY } from "@/lib/feature-descriptions";

/**
 * Compact "i" affordance that opens a small popover with a plain-English
 * description of the feature (from FEATURE_META). Falls back gracefully when
 * the feature has no metadata.
 */
export function FeatureInfoTooltip({
  featureKey,
  fallbackDescription,
  className,
}: {
  featureKey: string;
  fallbackDescription?: string;
  className?: string;
}) {
  const meta = FEATURE_META_BY_KEY[featureKey];
  const desc = meta?.description ?? fallbackDescription ?? "";

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="More info"
          className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground ${className ?? ""}`}
          onClick={(e) => e.stopPropagation()}
        >
          <Info className="h-3.5 w-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent side="top" align="start" className="w-72 text-xs space-y-1.5">
        {desc ? <div>{desc}</div> : <div className="text-muted-foreground">No metadata for this feature.</div>}
      </PopoverContent>
    </Popover>
  );
}
