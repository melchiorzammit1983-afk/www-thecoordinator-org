import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  getUserPrefs,
  updateUserPrefs,
  resetUserPrefsSection,
  DEFAULT_PREFS,
  type UserPreferences,
  type AiToggleKey,
  type HomeLayout,
} from "@/lib/user-prefs.functions";

const KEY = ["user-prefs"] as const;

export function usePreferences() {
  const fn = useServerFn(getUserPrefs);
  const q = useQuery<UserPreferences>({
    queryKey: KEY,
    queryFn: () => fn(),
    staleTime: 60_000,
  });
  return {
    prefs: q.data ?? DEFAULT_PREFS,
    isLoading: q.isLoading,
    aiEnabled: (k: AiToggleKey) => (q.data?.ai_toggles?.[k] ?? true) !== false,
  };
}

/** Cheap boolean-only accessor for hot paths. */
export function useAiToggle(k: AiToggleKey): boolean {
  const { aiEnabled } = usePreferences();
  return aiEnabled(k);
}

export function useUpdatePreferences() {
  const fn = useServerFn(updateUserPrefs);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      ai_toggles?: Partial<Record<AiToggleKey, boolean>>;
      home_layout?: HomeLayout;
      theme?: "system" | "light" | "dark";
      haptics_enabled?: boolean;
      sound_enabled?: boolean;
    }) => fn({ data: input as any }),
    onSuccess: (data) => qc.setQueryData(KEY, data),
  });
}

export function useResetPreferences() {
  const fn = useServerFn(resetUserPrefsSection);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (section: "ai" | "layout" | "all") => fn({ data: { section } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}
