/**
 * AI character-overage settings + billing helpers.
 *
 * Any AI text call that accepts long input runs through `chargeCharOverage`.
 * Up to `free_char_threshold` chars are free; beyond that, `price_per_char`
 * points are deducted via `spend_points` (feature `ai_char_overage`).
 * If the wallet is empty, the caller truncates the input and continues.
 *
 * Settings live in `ai_char_overage_settings`:
 *   • `company_id = NULL` → global default (edited by platform admin)
 *   • `company_id = <uuid>` → per-company override (edited by that company)
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type OverageSettings = {
  free_char_threshold: number;
  price_per_char: number;
  enabled: boolean;
  source: "company" | "global" | "default";
};

const DEFAULT: OverageSettings = {
  free_char_threshold: 1000,
  price_per_char: 0.01,
  enabled: true,
  source: "default",
};

// ---------- server-only helpers (imported by other server fns) ----------

export async function loadEffectiveOverage(companyId: string): Promise<OverageSettings> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: rows } = await supabaseAdmin
    .from("ai_char_overage_settings")
    .select("company_id, free_char_threshold, price_per_char, enabled")
    .or(`company_id.eq.${companyId},company_id.is.null`);
  const list = (rows ?? []) as Array<{ company_id: string | null; free_char_threshold: number; price_per_char: number | string; enabled: boolean }>;
  const own = list.find((r) => r.company_id === companyId);
  if (own && own.enabled) {
    return {
      free_char_threshold: Number(own.free_char_threshold),
      price_per_char: Number(own.price_per_char),
      enabled: true,
      source: "company",
    };
  }
  const global = list.find((r) => r.company_id === null);
  if (global) {
    return {
      free_char_threshold: Number(global.free_char_threshold),
      price_per_char: Number(global.price_per_char),
      enabled: Boolean(global.enabled),
      source: "global",
    };
  }
  return DEFAULT;
}

export type CharBillingInput = {
  message: string;
  history?: Array<{ text: string }>;
};

export type CharBillingResult = {
  message: string;
  history: Array<{ text: string; role?: "user" | "assistant" }>;
  total_chars: number;
  overage_chars: number;
  cost_charged: number;
  truncated: boolean;
  settings: OverageSettings;
};

/**
 * Charge for characters over the free threshold. Never throws — on
 * insufficient credits it truncates history (oldest first), then trims
 * the tail of the current message until under threshold.
 */
export async function chargeCharOverage<T extends { text: string; role?: "user" | "assistant" }>(
  companyId: string,
  message: string,
  history: T[],
  note = "AI extra characters",
): Promise<CharBillingResult & { history: T[] }> {
  const settings = await loadEffectiveOverage(companyId);
  const count = (m: string, h: T[]) => m.length + h.reduce((s, x) => s + (x.text?.length ?? 0), 0);
  const totalOriginal = count(message, history);
  const overage = Math.max(0, totalOriginal - settings.free_char_threshold);

  if (overage <= 0 || !settings.enabled || settings.price_per_char <= 0) {
    return {
      message,
      history,
      total_chars: totalOriginal,
      overage_chars: 0,
      cost_charged: 0,
      truncated: false,
      settings,
    };
  }

  const cost = Math.max(0.01, Math.round(overage * settings.price_per_char * 100) / 100);
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  try {
    await supabaseAdmin.rpc("spend_points", {
      _company_id: companyId,
      _feature_key: "ai_char_overage",
      _job_id: undefined as unknown as string,
      _note: `${note} (${overage} chars @ ${settings.price_per_char}/char)`,
      _cost_override: cost,
    });
    return {
      message,
      history,
      total_chars: totalOriginal,
      overage_chars: overage,
      cost_charged: cost,
      truncated: false,
      settings,
    };
  } catch {
    // Truncate: drop oldest history entries first, then trim message tail.
    let workingHistory = [...history];
    while (workingHistory.length > 0 && count(message, workingHistory) > settings.free_char_threshold) {
      workingHistory.shift();
    }
    let workingMessage = message;
    if (count(workingMessage, workingHistory) > settings.free_char_threshold) {
      const budget = Math.max(0, settings.free_char_threshold - workingHistory.reduce((s, x) => s + x.text.length, 0));
      workingMessage = budget > 0 ? workingMessage.slice(0, budget - 20) + "\n…[truncated]" : "…[truncated]";
    }
    return {
      message: workingMessage,
      history: workingHistory,
      total_chars: count(workingMessage, workingHistory),
      overage_chars: overage,
      cost_charged: 0,
      truncated: true,
      settings,
    };
  }
}

// ---------- server functions callable from UI ----------

async function isPlatformAdmin(userId: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: u } = await supabaseAdmin.auth.admin.getUserById(userId);
  const email = u.user?.email?.toLowerCase();
  if (!email) return false;
  const { data: rows } = await supabaseAdmin.from("admin_emails").select("email");
  return (rows ?? []).some((r) => r.email?.toLowerCase() === email);
}

async function resolveCompanyId(userId: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin
    .from("companies")
    .select("id")
    .eq("owner_user_id", userId)
    .maybeSingle();
  return data?.id as string | undefined;
}

export const getMyOverageSettings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const companyId = await resolveCompanyId(context.userId);
    const admin = await isPlatformAdmin(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: global } = await supabaseAdmin
      .from("ai_char_overage_settings")
      .select("free_char_threshold, price_per_char, enabled")
      .is("company_id", null)
      .maybeSingle();
    let company: { free_char_threshold: number; price_per_char: number; enabled: boolean } | null = null;
    if (companyId) {
      const { data: c } = await supabaseAdmin
        .from("ai_char_overage_settings")
        .select("free_char_threshold, price_per_char, enabled")
        .eq("company_id", companyId)
        .maybeSingle();
      if (c) company = { free_char_threshold: Number(c.free_char_threshold), price_per_char: Number(c.price_per_char), enabled: c.enabled };
    }
    const effective = companyId ? await loadEffectiveOverage(companyId) : { ...DEFAULT };
    return {
      is_admin: admin,
      has_company: Boolean(companyId),
      global: global
        ? { free_char_threshold: Number(global.free_char_threshold), price_per_char: Number(global.price_per_char), enabled: global.enabled }
        : { ...DEFAULT },
      company,
      effective,
    };
  });

const upsertSchema = z.object({
  free_char_threshold: z.number().int().min(0).max(200_000),
  price_per_char: z.number().min(0).max(100),
  enabled: z.boolean(),
});

export const upsertCompanyOverageSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => upsertSchema.parse(i))
  .handler(async ({ data, context }) => {
    const companyId = await resolveCompanyId(context.userId);
    if (!companyId) throw new Error("No company assigned to this account.");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("ai_char_overage_settings")
      .upsert({
        company_id: companyId,
        free_char_threshold: data.free_char_threshold,
        price_per_char: data.price_per_char,
        enabled: data.enabled,
        updated_by: context.userId,
        updated_at: new Date().toISOString(),
      }, { onConflict: "company_id" });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const clearCompanyOverageSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const companyId = await resolveCompanyId(context.userId);
    if (!companyId) throw new Error("No company assigned to this account.");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("ai_char_overage_settings")
      .delete()
      .eq("company_id", companyId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const updateGlobalOverageSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => upsertSchema.parse(i))
  .handler(async ({ data, context }) => {
    if (!(await isPlatformAdmin(context.userId))) throw new Error("Forbidden: admin only");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // Update the single global row (company_id IS NULL). Seeded by migration.
    const { data: existing } = await supabaseAdmin
      .from("ai_char_overage_settings")
      .select("id")
      .is("company_id", null)
      .maybeSingle();
    if (existing?.id) {
      const { error } = await supabaseAdmin
        .from("ai_char_overage_settings")
        .update({
          free_char_threshold: data.free_char_threshold,
          price_per_char: data.price_per_char,
          enabled: data.enabled,
          updated_by: context.userId,
          updated_at: new Date().toISOString(),
        })
        .eq("id", existing.id);
      if (error) throw new Error(error.message);
    } else {
      const { error } = await supabaseAdmin
        .from("ai_char_overage_settings")
        .insert({
          company_id: null,
          free_char_threshold: data.free_char_threshold,
          price_per_char: data.price_per_char,
          enabled: data.enabled,
          updated_by: context.userId,
        });
      if (error) throw new Error(error.message);
    }
    return { ok: true };
  });
