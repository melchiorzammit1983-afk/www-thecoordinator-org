import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getMyCompany, getFeatureCosts } from "@/lib/coordinator.functions";

export type Company = {
  id: string;
  name: string;
  points_balance: number;
  status: string;
  isAdmin: boolean;
} | null;

export function useMyCompany() {
  const fn = useServerFn(getMyCompany);
  return useQuery({
    queryKey: ["my-company"],
    queryFn: () => fn() as Promise<Company>,
    staleTime: 15_000,
  });
}

export function useFeatureCosts() {
  const fn = useServerFn(getFeatureCosts);
  return useQuery({
    queryKey: ["feature-costs"],
    queryFn: () => fn() as Promise<{ feature_name: string; points_cost: number }[]>,
    staleTime: 60_000,
  });
}

export function useFeatureCost(feature: string): number | undefined {
  const { data } = useFeatureCosts();
  return data?.find((f) => f.feature_name === feature)?.points_cost;
}
