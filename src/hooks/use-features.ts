import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getMyFeatures } from "@/lib/coordinator.functions";
import { getMyBilling } from "@/lib/billing.functions";
import { supabase } from "@/integrations/supabase/client";
import type { FeatureKey } from "@/lib/features";

export function useFeatures() {
  const fn = useServerFn(getMyFeatures);
  const qc = useQueryClient();

  useEffect(() => {
    const channel = supabase
      .channel(`feature-entitlements-self-${Math.random().toString(36).slice(2)}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "company_feature_entitlements" },
        () => qc.invalidateQueries({ queryKey: ["my-features"] }),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [qc]);

  return useQuery({
    queryKey: ["my-features"],
    queryFn: () => fn() as Promise<Record<string, boolean>>,
    // Realtime channel above invalidates this query when entitlements change,
    // so we don't need aggressive polling. 5 min staleTime + focus refetch is plenty.
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: true,
  });
}

export function useFeature(key: FeatureKey): boolean {
  const { data, isLoading } = useFeatures();
  if (isLoading || !data) return true;
  return data[key] !== false;
}

export function useMyBilling() {
  const fn = useServerFn(getMyBilling);
  return useQuery({
    queryKey: ["my-billing"],
    queryFn: () => fn() as Promise<{
      company: { id: string; name: string; points_balance: number; trial_ends_at: string | null; grace_actions_remaining: number } | null;
      subscription: { plan_id: string; points_remaining_this_period: number; current_period_end: string; plans: { code: string; name: string; included_points: number; price_monthly: number } } | null;
      costs: { feature_key: string; points_cost: number; label: string | null; min_plan_code: string | null; is_addon: boolean; category: string | null; enabled: boolean; block_on_empty: boolean }[];
      recent: { id: string; feature_key: string | null; points_deducted: number; created_at: string; note: string | null }[];
    } | null>,
    staleTime: 60_000,
  });
}


export function useFeatureCost(key: string): number {
  const { data } = useMyBilling();
  if (!data) return 1;
  const raw = data.costs.find((c) => c.feature_key === key)?.points_cost;
  return raw != null ? Number(raw) : 1;
}

export function usePointsRemaining(): number {
  const { data } = useMyBilling();
  if (!data) return 0;
  const plan = Number(data.subscription?.points_remaining_this_period ?? 0);
  const balance = Number(data.company?.points_balance ?? 0);
  return plan + balance;
}
