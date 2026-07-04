import type { ReactNode } from "react";
import { Lock, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useFeature, useFeatureCost, usePointsRemaining, useMyBilling } from "@/hooks/use-features";
import { RequestTopupDialog } from "@/components/billing/RequestTopupDialog";
import type { FeatureKey } from "@/lib/features";
import { FEATURE_CATALOG } from "@/lib/features";

/**
 * Wraps an AI/premium feature. When the feature is disabled OR the coordinator
 * is out of points, replaces `children` with a locked panel that shows the
 * cost and a "Request top-up" CTA (max-conversion pattern).
 *
 * Usage: <FeatureGate feature="ai_daily_plan"><Button>…</Button></FeatureGate>
 */
export function FeatureGate({
  feature,
  costKey,
  children,
  compact,
}: {
  feature: FeatureKey;
  costKey?: string; // override cost lookup (e.g. media variant)
  children: ReactNode;
  compact?: boolean;
}) {
  const enabled = useFeature(feature);
  const cost = useFeatureCost(costKey ?? feature);
  const remaining = usePointsRemaining();
  const { data: billing } = useMyBilling();
  const meta = FEATURE_CATALOG.find((f) => f.key === feature);

  const outOfPoints = billing != null && remaining < cost;

  if (enabled && !outOfPoints) return <>{children}</>;

  return (
    <div className={`rounded-md border border-dashed bg-muted/40 ${compact ? "p-2" : "p-4"} space-y-2`}>
      <div className="flex items-center gap-2 text-sm font-medium">
        <Lock className="h-3.5 w-3.5 text-muted-foreground" />
        <span>{meta?.label ?? feature}</span>
        <span className="ml-auto text-xs text-muted-foreground">{cost} pt{cost === 1 ? "" : "s"} / use</span>
      </div>
      {!compact ? (
        <p className="text-xs text-muted-foreground">
          {!enabled ? "This feature isn't included in your current plan." : "You're out of points — top up to keep using it."}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <RequestTopupDialog
          trigger={
            <Button size="sm" variant="default" className="gap-1">
              <Sparkles className="h-3.5 w-3.5" /> Buy points
            </Button>
          }
        />
      </div>
    </div>
  );
}
