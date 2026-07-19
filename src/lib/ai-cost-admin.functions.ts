/**
 * Admin AI cost analysis — server functions.
 * Only accessible by admins (private.is_admin). Returns aggregates over
 * `ai_cost_events` for company / feature / user / recent-call views.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const rangeSchema = z.object({
  days: z.number().int().min(1).max(90).default(7),
});

async function assertAdmin(userId: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .schema("private")
    .rpc("is_admin", { _user_id: userId });
  if (error || !data) throw new Error("Forbidden — admins only.");
}

export type AiCostSummary = {
  totals: {
    calls: number;
    input_tokens: number;
    output_tokens: number;
    real_cost_usd_cents: number;
    real_cost_credits: number;
    points_charged: number;
    margin_credits: number; // points_charged - real_cost_credits (if same unit basis)
  };
  by_company: Array<{
    company_id: string | null;
    company_name: string | null;
    calls: number;
    real_cost_usd_cents: number;
    real_cost_credits: number;
    points_charged: number;
  }>;
  by_feature: Array<{
    feature_key: string;
    calls: number;
    real_cost_usd_cents: number;
    real_cost_credits: number;
    points_charged: number;
  }>;
  by_user: Array<{
    actor_user_id: string | null;
    email: string | null;
    calls: number;
    real_cost_usd_cents: number;
    real_cost_credits: number;
    points_charged: number;
  }>;
  by_model: Array<{
    model: string | null;
    calls: number;
    input_tokens: number;
    output_tokens: number;
    real_cost_usd_cents: number;
  }>;
};

export const adminGetAiCostSummary = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => rangeSchema.parse(data))
  .handler(async ({ data, context }): Promise<AiCostSummary> => {
    await assertAdmin(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const since = new Date(Date.now() - data.days * 86_400_000).toISOString();

    const { data: rows } = await supabaseAdmin
      .from("ai_cost_events")
      .select("company_id, actor_user_id, feature_key, model, input_tokens, output_tokens, real_cost_usd_cents, real_cost_credits, points_charged")
      .gte("created_at", since)
      .limit(50_000);

    const events = (rows ?? []) as Array<{
      company_id: string | null;
      actor_user_id: string | null;
      feature_key: string;
      model: string | null;
      input_tokens: number;
      output_tokens: number;
      real_cost_usd_cents: number;
      real_cost_credits: number;
      points_charged: number;
    }>;

    const totals = {
      calls: events.length,
      input_tokens: 0,
      output_tokens: 0,
      real_cost_usd_cents: 0,
      real_cost_credits: 0,
      points_charged: 0,
      margin_credits: 0,
    };
    const byCompany = new Map<string, { calls: number; usd: number; credits: number; points: number }>();
    const byFeature = new Map<string, { calls: number; usd: number; credits: number; points: number }>();
    const byUser = new Map<string, { calls: number; usd: number; credits: number; points: number }>();
    const byModel = new Map<string, { calls: number; input: number; output: number; usd: number }>();

    for (const e of events) {
      totals.input_tokens += e.input_tokens;
      totals.output_tokens += e.output_tokens;
      totals.real_cost_usd_cents += Number(e.real_cost_usd_cents);
      totals.real_cost_credits += Number(e.real_cost_credits);
      totals.points_charged += Number(e.points_charged);

      const ck = e.company_id ?? "__none";
      const c = byCompany.get(ck) ?? { calls: 0, usd: 0, credits: 0, points: 0 };
      c.calls++; c.usd += Number(e.real_cost_usd_cents); c.credits += Number(e.real_cost_credits); c.points += Number(e.points_charged);
      byCompany.set(ck, c);

      const f = byFeature.get(e.feature_key) ?? { calls: 0, usd: 0, credits: 0, points: 0 };
      f.calls++; f.usd += Number(e.real_cost_usd_cents); f.credits += Number(e.real_cost_credits); f.points += Number(e.points_charged);
      byFeature.set(e.feature_key, f);

      const uk = e.actor_user_id ?? "__none";
      const u = byUser.get(uk) ?? { calls: 0, usd: 0, credits: 0, points: 0 };
      u.calls++; u.usd += Number(e.real_cost_usd_cents); u.credits += Number(e.real_cost_credits); u.points += Number(e.points_charged);
      byUser.set(uk, u);

      const mk = e.model ?? "__none";
      const m = byModel.get(mk) ?? { calls: 0, input: 0, output: 0, usd: 0 };
      m.calls++; m.input += e.input_tokens; m.output += e.output_tokens; m.usd += Number(e.real_cost_usd_cents);
      byModel.set(mk, m);
    }
    totals.margin_credits = totals.points_charged - totals.real_cost_credits;

    // Resolve company names
    const companyIds = [...byCompany.keys()].filter((k) => k !== "__none");
    const companyNames = new Map<string, string>();
    if (companyIds.length) {
      const { data: cs } = await supabaseAdmin
        .from("companies").select("id, name").in("id", companyIds);
      for (const c of (cs ?? []) as Array<{ id: string; name: string | null }>) {
        companyNames.set(c.id, c.name ?? "(unnamed)");
      }
    }

    // Resolve user emails via auth admin
    const userIds = [...byUser.keys()].filter((k) => k !== "__none").slice(0, 200);
    const userEmails = new Map<string, string>();
    for (const uid of userIds) {
      try {
        const { data: u } = await supabaseAdmin.auth.admin.getUserById(uid);
        if (u.user?.email) userEmails.set(uid, u.user.email);
      } catch { /* noop */ }
    }

    const sortDesc = <T extends { real_cost_usd_cents: number }>(a: T, b: T) => b.real_cost_usd_cents - a.real_cost_usd_cents;
    return {
      totals,
      by_company: [...byCompany.entries()].map(([id, v]) => ({
        company_id: id === "__none" ? null : id,
        company_name: id === "__none" ? "(no company)" : companyNames.get(id) ?? id.slice(0, 8),
        calls: v.calls,
        real_cost_usd_cents: v.usd,
        real_cost_credits: v.credits,
        points_charged: v.points,
      })).sort(sortDesc),
      by_feature: [...byFeature.entries()].map(([key, v]) => ({
        feature_key: key,
        calls: v.calls,
        real_cost_usd_cents: v.usd,
        real_cost_credits: v.credits,
        points_charged: v.points,
      })).sort(sortDesc),
      by_user: [...byUser.entries()].map(([id, v]) => ({
        actor_user_id: id === "__none" ? null : id,
        email: id === "__none" ? "(system / anon)" : userEmails.get(id) ?? null,
        calls: v.calls,
        real_cost_usd_cents: v.usd,
        real_cost_credits: v.credits,
        points_charged: v.points,
      })).sort(sortDesc),
      by_model: [...byModel.entries()].map(([m, v]) => ({
        model: m === "__none" ? null : m,
        calls: v.calls,
        input_tokens: v.input,
        output_tokens: v.output,
        real_cost_usd_cents: v.usd,
      })).sort(sortDesc),
    };
  });

export type RecentAiCall = {
  id: string;
  created_at: string;
  feature_key: string;
  model: string | null;
  input_tokens: number;
  output_tokens: number;
  real_cost_usd_cents: number;
  real_cost_credits: number;
  points_charged: number;
  status: string;
  surface: string | null;
  duration_ms: number | null;
  company_id: string | null;
  actor_user_id: string | null;
  aig_run_id: string | null;
  aig_log_id: string | null;
};

export const adminListRecentAiCalls = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z.object({ limit: z.number().int().min(1).max(500).default(50), feature_key: z.string().optional(), company_id: z.string().uuid().optional() }).parse(data),
  )
  .handler(async ({ data, context }): Promise<RecentAiCall[]> => {
    await assertAdmin(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    let q = supabaseAdmin
      .from("ai_cost_events")
      .select("id, created_at, feature_key, model, input_tokens, output_tokens, real_cost_usd_cents, real_cost_credits, points_charged, status, surface, duration_ms, company_id, actor_user_id, aig_run_id, aig_log_id")
      .order("created_at", { ascending: false })
      .limit(data.limit);
    if (data.feature_key) q = q.eq("feature_key", data.feature_key);
    if (data.company_id) q = q.eq("company_id", data.company_id);
    const { data: rows } = await q;
    return (rows ?? []) as RecentAiCall[];
  });

// -------- Model rate table (editor) --------

export type ModelRate = {
  id: string;
  model: string;
  input_usd_per_1m: number;
  output_usd_per_1m: number;
  credits_per_usd: number;
  notes: string | null;
  updated_at: string;
};

export const adminListModelRates = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<ModelRate[]> => {
    await assertAdmin(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin
      .from("ai_model_rates")
      .select("id, model, input_usd_per_1m, output_usd_per_1m, credits_per_usd, notes, updated_at")
      .order("model");
    return (data ?? []) as ModelRate[];
  });

export const adminUpsertModelRate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z.object({
      model: z.string().trim().min(1).max(120),
      input_usd_per_1m: z.number().nonnegative(),
      output_usd_per_1m: z.number().nonnegative(),
      credits_per_usd: z.number().positive(),
      notes: z.string().max(500).optional().nullable(),
    }).parse(data),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("ai_model_rates")
      .upsert({
        model: data.model,
        input_usd_per_1m: data.input_usd_per_1m,
        output_usd_per_1m: data.output_usd_per_1m,
        credits_per_usd: data.credits_per_usd,
        notes: data.notes ?? null,
      }, { onConflict: "model" });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const adminDeleteModelRate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => z.object({ id: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("ai_model_rates").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
