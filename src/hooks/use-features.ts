import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getMyFeatures } from "@/lib/coordinator.functions";
import type { FeatureKey } from "@/lib/features";

export function useFeatures() {
  const fn = useServerFn(getMyFeatures);
  return useQuery({
    queryKey: ["my-features"],
    queryFn: () => fn() as Promise<Record<string, boolean>>,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}

export function useFeature(key: FeatureKey): boolean {
  const { data } = useFeatures();
  if (!data) return true; // optimistic — avoid flicker while loading
  return data[key] !== false;
}
