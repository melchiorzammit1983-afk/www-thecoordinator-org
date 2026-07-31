import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getMyFeatures } from "@/lib/coordinator.functions";
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
