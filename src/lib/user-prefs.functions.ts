import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// ============================================================
// Types & catalog
// ============================================================

export type AiToggleKey =
  // Background (cron / auto)
  | "auto_flight_tracking"
  | "flight_t30_cron"
  | "ai_watchtower"
  | "schedule_collision"
  | "ai_learning_capture"
  // On-demand
  | "assistant_fab"
  | "assistant_voice"
  | "ai_bulk_paste"
  | "ai_auto_pricing"
  | "ai_address_enrichment"
  | "ai_lesson_suggestions"
  // Routing / live
  | "live_eta_polling"
  | "route_deviation_alerts"
  | "traffic_badges";

export type OperationToggleCategory = "background" | "ondemand" | "routing";

/**
 * Core operational preferences that remain available while the optional AI
 * module is inactive. The database column is still named `ai_toggles` for
 * backwards compatibility; a later migration can rename it without mixing
 * that schema change into the AI deactivation release.
 */
export const OPERATION_TOGGLES: {
  key: AiToggleKey;
  category: OperationToggleCategory;
  label: string;
  description: string;
}[] = [
  { key: "ai_watchtower", category: "background", label: "Operations monitor", description: "Check for delays, missing trip data, conflicts and workload imbalance." },
  { key: "schedule_collision", category: "background", label: "Schedule collision alerts", description: "Warn when a driver assignment will overlap another trip." },
  { key: "ai_address_enrichment", category: "ondemand", label: "Address name lookup", description: "Google Places calls when typing an address." },
  { key: "live_eta_polling", category: "routing", label: "Live ETA polling", description: "Refresh dashboard ETAs from Google Routes every minute." },
  { key: "route_deviation_alerts", category: "routing", label: "Route deviation reroute", description: "Automatically reroute the driver when off by >60 m." },
  { key: "traffic_badges", category: "routing", label: "Traffic badges", description: "Show traffic delta chip on trip cards." },
];

export type HomeLayout = {
  default_tab?: string;
  tabs?: string[];        // ordered visible tab ids
  hidden_tabs?: string[]; // tab ids hidden from the bottom bar
  quick_actions?: string[]; // ordered visible dashboard tile ids
  hidden_actions?: string[];
};

export type UserPreferences = {
  ai_toggles: Partial<Record<AiToggleKey, boolean>>;
  home_layout: HomeLayout;
  theme: "system" | "light" | "dark";
  haptics_enabled: boolean;
  sound_enabled: boolean;
};

export const DEFAULT_PREFS: UserPreferences = {
  ai_toggles: {},
  home_layout: {},
  theme: "system",
  haptics_enabled: true,
  sound_enabled: true,
};

// ============================================================
// Server functions
// ============================================================

export const getUserPrefs = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<UserPreferences> => {
    const { supabase, userId } = context;
    const { data } = await supabase
      .from("user_preferences")
      .select("ai_toggles, home_layout, theme, haptics_enabled, sound_enabled")
      .eq("user_id", userId)
      .maybeSingle();
    if (!data) return DEFAULT_PREFS;
    return {
      ai_toggles: (data.ai_toggles as any) ?? {},
      home_layout: (data.home_layout as any) ?? {},
      theme: (data.theme as any) ?? "system",
      haptics_enabled: data.haptics_enabled ?? true,
      sound_enabled: data.sound_enabled ?? true,
    };
  });

const UpdateSchema = z.object({
  ai_toggles: z.record(z.string(), z.boolean()).optional(),
  home_layout: z
    .object({
      default_tab: z.string().optional(),
      tabs: z.array(z.string()).optional(),
      hidden_tabs: z.array(z.string()).optional(),
      quick_actions: z.array(z.string()).optional(),
      hidden_actions: z.array(z.string()).optional(),
    })
    .optional(),
  theme: z.enum(["system", "light", "dark"]).optional(),
  haptics_enabled: z.boolean().optional(),
  sound_enabled: z.boolean().optional(),
});

export const updateUserPrefs = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: z.input<typeof UpdateSchema>) => UpdateSchema.parse(input))
  .handler(async ({ data, context }): Promise<UserPreferences> => {
    const { supabase, userId } = context;

    // Read current, merge, upsert
    const { data: current } = await supabase
      .from("user_preferences")
      .select("ai_toggles, home_layout, theme, haptics_enabled, sound_enabled")
      .eq("user_id", userId)
      .maybeSingle();

    const merged = {
      user_id: userId,
      ai_toggles: { ...((current?.ai_toggles as any) ?? {}), ...(data.ai_toggles ?? {}) },
      home_layout: { ...((current?.home_layout as any) ?? {}), ...(data.home_layout ?? {}) },
      theme: data.theme ?? current?.theme ?? "system",
      haptics_enabled: data.haptics_enabled ?? current?.haptics_enabled ?? true,
      sound_enabled: data.sound_enabled ?? current?.sound_enabled ?? true,
    };

    const { error } = await supabase
      .from("user_preferences")
      .upsert(merged, { onConflict: "user_id" });
    if (error) throw error;

    return {
      ai_toggles: merged.ai_toggles,
      home_layout: merged.home_layout,
      theme: merged.theme as any,
      haptics_enabled: merged.haptics_enabled,
      sound_enabled: merged.sound_enabled,
    };
  });

export const resetUserPrefsSection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { section: "ai" | "layout" | "all" }) =>
    z.object({ section: z.enum(["ai", "layout", "all"]) }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const patch: Record<string, any> = { user_id: userId };
    if (data.section === "ai" || data.section === "all") patch.ai_toggles = {};
    if (data.section === "layout" || data.section === "all") patch.home_layout = {};
    if (data.section === "all") {
      patch.theme = "system";
      patch.haptics_enabled = true;
      patch.sound_enabled = true;
    }
    const { error } = await supabase.from("user_preferences").upsert(patch, { onConflict: "user_id" });
    if (error) throw error;
    return { ok: true };
  });
