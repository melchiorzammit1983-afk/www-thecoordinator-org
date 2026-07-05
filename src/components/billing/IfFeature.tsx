import type { ReactNode } from "react";
import { useFeature } from "@/hooks/use-features";
import type { FeatureKey } from "@/lib/features";

/**
 * Renders children only when the given feature is enabled for the current
 * coordinator company. When the admin toggles the feature OFF, this hides
 * the wrapped UI entirely (no locked-panel upsell) — matches the product
 * decision to fully hide disabled features.
 *
 * While the entitlements query is still loading, `useFeature` returns `true`
 * to avoid a flash of hidden content on first paint.
 */
export function IfFeature({ feature, children }: { feature: FeatureKey; children: ReactNode }) {
  const enabled = useFeature(feature);
  if (!enabled) return null;
  return <>{children}</>;
}

/**
 * Hook variant when you need a boolean in an expression (e.g. `enabled && …`).
 * Same semantics as `useFeature` — kept as an alias for readability at call sites.
 */
export { useFeature as useFeatureEnabled } from "@/hooks/use-features";
