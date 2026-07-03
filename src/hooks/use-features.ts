import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getMyFeatures } from "@/lib/coordinator.functions";
import { supabase } from "@/integrations/supabase/client";
import type { FeatureKey } from "@/lib/features";

export function useFeatures() {
  const fn = useServerFn(getMyFeatures);
  const qc = useQueryClient();

  // Realtime: when the admin toggles any entitlement, invalidate immediately.
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
    staleTime: 0,
    refetchInterval: 15_000,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
  });
}

export function useFeature(key: FeatureKey): boolean {
  const { data, isLoading } = useFeatures();
  // Before first load: allow (avoid flicker). After load: strict.
  if (isLoading || !data) return true;
  return data[key] !== false;
}
