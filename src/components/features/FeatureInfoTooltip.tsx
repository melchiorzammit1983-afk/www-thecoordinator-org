import { Info } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listAiFeatureCosts } from "@/lib/billing.functions";
import { useReferencePack } from "@/hooks/use-reference-rate";
import { formatPoints } from "@/lib/points-eur";
import { FEATURE_META_BY_KEY } from "@/lib/feature-descriptions";

type Cost = { feature_key: string; points_cost: number | string };

/**
 * Compact "i" affordance that opens a small popover with:
 *   • plain-English description (from FEATURE_META)
 *   • point cost + EUR-equivalent when a reference pack is set,
 *     or "Free — no cost" when points_cost is 0 / not billed.
 * Falls back gracefully when the feature has no metadata.
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
  const listFn = useServerFn(listAiFeatureCosts);
  const { data: costs } = useQuery<Cost[]>({
    queryKey: ["ai-feature-costs"],
    queryFn: () => listFn() as Promise<Cost[]>,
    staleTime: 5 * 60_000,
  });
  const pack = useReferencePack();

  const meta = FEATURE_META_BY_KEY[featureKey];
  const desc = meta?.description ?? fallbackDescription ?? "";
  const cost = (costs ?? []).find((c) => c.feature_key === featureKey);
  const pts = cost ? Number(cost.points_cost) : null;
  const costText =
    pts == null ? null : pts <= 0 ? "Free — no cost" : formatPoints(pts, pack);

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
        {desc && <div>{desc}</div>}
        {costText && <div className="pt-1 border-t text-[11px] font-medium text-foreground/80">{costText}</div>}
        {!desc && !costText && <div className="text-muted-foreground">No metadata for this feature.</div>}
      </PopoverContent>
    </Popover>
  );
}
