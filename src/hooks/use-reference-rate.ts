import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { ReferencePack } from "@/lib/points-eur";

/**
 * Reads the single point pack currently flagged as reference rate.
 * Returns null when none is set — callers should display points-only.
 */
export function useReferencePack() {
  const q = useQuery<ReferencePack>({
    queryKey: ["point-packs", "reference"],
    queryFn: async () => {
      const { data } = await supabase
        .from("point_packs")
        .select("points, price")
        .eq("is_reference_rate", true)
        .maybeSingle();
      return (data as ReferencePack) ?? null;
    },
    staleTime: 5 * 60_000,
  });
  return q.data ?? null;
}
