import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Per-company user-level opt-out for individual paid features.
 *
 * This is ADDITIVE to the admin-only `company_feature_entitlements` layer:
 * admin controls whether a company CAN use a feature (billing/plan gating),
 * this table lets the coordinator turn it OFF for their own usage without
 * asking the admin. Default is enabled=true (opt-out model).
 *
 * Row-level security scopes writes to the caller's own company.
 */

async function resolveCompanyForUser(userId: string): Promise<string | null> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin
    .from("companies")
    .select("id")
    .eq("owner_user_id", userId)
    .maybeSingle();
  return (data?.id as string) ?? null;
}

export const listMyFeaturePreferences = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<Record<string, boolean>> => {
    const companyId = await resolveCompanyForUser(context.userId);
    if (!companyId) return {};
    const { data, error } = await context.supabase
      .from("user_feature_preferences")
      .select("feature_key, enabled")
      .eq("company_id", companyId);
    if (error) throw new Error(error.message);
    const out: Record<string, boolean> = {};
    for (const r of (data ?? []) as Array<{ feature_key: string; enabled: boolean }>) {
      out[r.feature_key] = r.enabled;
    }
    return out;
  });

export const setMyFeaturePreference = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({
      feature_key: z.string().trim().min(1).max(80),
      enabled: z.boolean(),
    }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const companyId = await resolveCompanyForUser(context.userId);
    if (!companyId) throw new Error("no_company_for_user");
    const { error } = await context.supabase
      .from("user_feature_preferences")
      .upsert(
        {
          company_id: companyId,
          feature_key: data.feature_key,
          enabled: data.enabled,
          updated_by_user_id: context.userId,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "company_id,feature_key" },
      );
    if (error) throw new Error(error.message);
    return { ok: true };
  });
