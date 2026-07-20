import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listMyFeaturePreferences, setMyFeaturePreference } from "@/lib/user-feature-prefs.functions";

const KEY = ["user-feature-prefs"] as const;

export function useFeaturePrefs() {
  const fn = useServerFn(listMyFeaturePreferences);
  const q = useQuery<Record<string, boolean>>({
    queryKey: KEY,
    queryFn: () => fn(),
    staleTime: 60_000,
  });
  return {
    prefs: q.data ?? {},
    isLoading: q.isLoading,
    /** Default-on: only false when explicitly stored as false. */
    isEnabled: (k: string) => (q.data?.[k] ?? true) !== false,
  };
}

export function useSetFeaturePref() {
  const fn = useServerFn(setMyFeaturePreference);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { feature_key: string; enabled: boolean }) => fn({ data: v }),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}
