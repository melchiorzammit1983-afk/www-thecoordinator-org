import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

async function resolveMyCompanyId(userId: string): Promise<string | null> {
  const sb = await admin();
  const { data } = await sb.from("companies").select("id").eq("owner_user_id", userId).maybeSingle();
  return data?.id ?? null;
}

export type AiWalletSummary = {
  company_id: string;
  ai_points_balance: number;
  ai_points_used_this_period: number;
  ai_monthly_cap: number | null;
  ai_fallback_to_general: boolean;
  ai_period_reset_at: string;
  general_points_balance: number;
  subscription_ai_remaining: number;
  subscription_ai_included: number;
  period_end: string | null;
  total_available: number;
  cap_percent_used: number | null;
  low_balance: boolean;
};

export const getMyAiWallet = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<AiWalletSummary | null> => {
    const sb = await admin();
    const companyId = await resolveMyCompanyId(context.userId);
    if (!companyId) return null;

    const [{ data: co }, { data: sub }] = await Promise.all([
      sb.from("companies").select(
        "id, points_balance, ai_points_balance, ai_points_used_this_period, ai_monthly_cap, ai_fallback_to_general, ai_period_reset_at",
      ).eq("id", companyId).maybeSingle(),
      sb.from("company_subscriptions").select(
        "ai_points_remaining_this_period, current_period_end, plans(included_ai_points)",
      ).eq("company_id", companyId).maybeSingle(),
    ]);
    if (!co) return null;

    const subRemaining = Number(sub?.ai_points_remaining_this_period ?? 0);
    const subIncluded = Number((sub as { plans?: { included_ai_points?: number } } | null)?.plans?.included_ai_points ?? 0);
    const walletBal = Number(co.ai_points_balance ?? 0);
    const generalBal = Number(co.points_balance ?? 0);
    const cap = co.ai_monthly_cap == null ? null : Number(co.ai_monthly_cap);
    const used = Number(co.ai_points_used_this_period ?? 0);
    const fallback = Boolean(co.ai_fallback_to_general);
    const totalAvailable = subRemaining + walletBal + (fallback ? generalBal : 0);
    const capPct = cap && cap > 0 ? Math.min(100, Math.round((used / cap) * 100)) : null;
    const budget = cap ?? (subIncluded + walletBal || 1);
    const lowBalance = totalAvailable > 0 && totalAvailable / Math.max(budget, 1) <= 0.25;

    return {
      company_id: companyId,
      ai_points_balance: walletBal,
      ai_points_used_this_period: used,
      ai_monthly_cap: cap,
      ai_fallback_to_general: fallback,
      ai_period_reset_at: String(co.ai_period_reset_at),
      general_points_balance: generalBal,
      subscription_ai_remaining: subRemaining,
      subscription_ai_included: subIncluded,
      period_end: sub?.current_period_end ?? null,
      total_available: totalAvailable,
      cap_percent_used: capPct,
      low_balance: lowBalance,
    };
  });

export const allocateToAiWallet = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ amount: z.number().positive().max(1_000_000) }).parse(i))
  .handler(async ({ data, context }) => {
    const sb = await admin();
    const companyId = await resolveMyCompanyId(context.userId);
    if (!companyId) throw new Error("No company assigned");
    const { data: newBal, error } = await sb.rpc("allocate_to_ai_wallet", {
      _company_id: companyId,
      _amount: data.amount,
    });
    if (error) throw new Error(error.message);
    return { ai_points_balance: Number(newBal) };
  });

export const setMyAiMonthlyCap = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({ cap: z.number().nonnegative().max(1_000_000).nullable() }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const sb = await admin();
    const companyId = await resolveMyCompanyId(context.userId);
    if (!companyId) throw new Error("No company assigned");
    const { error } = await sb.rpc("set_ai_monthly_cap", { _company_id: companyId, _cap: data.cap });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const setMyAiFallback = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ enabled: z.boolean() }).parse(i))
  .handler(async ({ data, context }) => {
    const sb = await admin();
    const companyId = await resolveMyCompanyId(context.userId);
    if (!companyId) throw new Error("No company assigned");
    const { error } = await sb.rpc("set_ai_fallback", { _company_id: companyId, _enabled: data.enabled });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const listMyAiUsage = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const sb = await admin();
    const companyId = await resolveMyCompanyId(context.userId);
    if (!companyId) return [];
    const { data } = await sb
      .from("points_ledger")
      .select("id, created_at, feature_key, points_deducted, note")
      .eq("company_id", companyId)
      .like("feature_key", "ai_%")
      .order("created_at", { ascending: false })
      .limit(100);
    return data ?? [];
  });

// ----- Admin -----

async function assertAdmin(userId: string) {
  const sb = await admin();
  const { data: email } = await sb.from("admin_emails").select("email").limit(1);
  // fall back: is_admin RPC
  const { data: ok } = await sb.rpc("is_admin_user", { _uid: userId } as never).catch(() => ({ data: null }));
  if (ok === true) return;
  const u = await sb.auth.admin.getUserById(userId);
  const em = u.data.user?.email?.toLowerCase();
  const list = (email ?? []).map((r) => r.email.toLowerCase());
  if (!em || !list.includes(em)) throw new Error("admin_only");
}

export const adminGrantAiPoints = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({
      company_id: z.string().uuid(),
      amount: z.number().refine((n) => n !== 0, "amount required").min(-1_000_000).max(1_000_000),
      note: z.string().trim().max(500).optional(),
    }).parse(i),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    const sb = await admin();
    const { data: newBal, error } = await sb.rpc("admin_grant_ai_points", {
      _company_id: data.company_id,
      _amount: data.amount,
      _note: data.note ?? null,
    });
    if (error) throw new Error(error.message);
    return { ai_points_balance: Number(newBal) };
  });

export const adminSetAiMonthlyCap = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({ company_id: z.string().uuid(), cap: z.number().nonnegative().max(1_000_000).nullable() }).parse(i),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    const sb = await admin();
    const { error } = await sb.rpc("set_ai_monthly_cap", { _company_id: data.company_id, _cap: data.cap });
    if (error) throw new Error(error.message);
    return { ok: true };
  });
