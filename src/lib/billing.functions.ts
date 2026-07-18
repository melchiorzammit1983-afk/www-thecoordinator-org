import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function getAdminClient() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

async function resolveMyCompanyId(userId: string): Promise<string | null> {
  const sb = await getAdminClient();
  const { data } = await sb.from("companies").select("id").eq("owner_user_id", userId).maybeSingle();
  return data?.id ?? null;
}

// ---------- Public reads ----------

export const listPlans = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const sb = await getAdminClient();
    const { data } = await sb.from("plans").select("*").order("sort_order");
    return data ?? [];
  });

export const listPointPacks = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const sb = await getAdminClient();
    const { data } = await sb.from("point_packs").select("*").eq("is_active", true).order("sort_order");
    return data ?? [];
  });

export const listAiFeatureCosts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const sb = await getAdminClient();
    const { data } = await sb.from("ai_feature_costs").select("*").order("feature_key");
    return data ?? [];
  });

// ---------- Coordinator: my billing dashboard ----------

export const getMyBilling = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const sb = await getAdminClient();
    const companyId = await resolveMyCompanyId(context.userId);
    if (!companyId) return null;

    const [
      { data: company },
      { data: sub },
      { data: costs },
      { data: recent },
    ] = await Promise.all([
      sb.from("companies").select("id, name, points_balance, trial_ends_at, grace_actions_remaining").eq("id", companyId).maybeSingle(),
      sb.from("company_subscriptions").select("*, plans(*)").eq("company_id", companyId).maybeSingle(),
      sb.from("ai_feature_costs").select("*"),
      sb.from("points_ledger").select("*").eq("company_id", companyId).order("created_at", { ascending: false }).limit(20),
    ]);

    return {
      company,
      subscription: sub,
      costs: costs ?? [],
      recent: recent ?? [],
    };
  });


export const listMyPointsHistory = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const sb = await getAdminClient();
    const companyId = await resolveMyCompanyId(context.userId);
    if (!companyId) return [];
    const { data } = await sb.from("points_ledger").select("*").eq("company_id", companyId)
      .order("created_at", { ascending: false }).limit(200);
    return data ?? [];
  });

// ---------- Coordinator: request a top-up ----------

export const requestTopup = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({
      pack_id: z.string().uuid().optional(),
      custom_points: z.number().int().positive().max(1_000_000).optional(),
      note: z.string().trim().max(500).optional(),
    }).refine((v) => v.pack_id || v.custom_points, "Provide pack_id or custom_points")
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const sb = await getAdminClient();
    const companyId = await resolveMyCompanyId(context.userId);
    if (!companyId) throw new Error("No company assigned");

    let points = data.custom_points ?? 0;
    let price: number | null = null;
    if (data.pack_id) {
      const { data: pack } = await sb.from("point_packs").select("*").eq("id", data.pack_id).maybeSingle();
      if (!pack) throw new Error("Point pack not found");
      points = pack.points;
      price = Number(pack.price ?? 0);
    }

    const { error } = await sb.from("topup_requests").insert({
      company_id: companyId,
      requested_by: context.userId,
      points_requested: points,
      pack_id: data.pack_id ?? null,
      price,
      note: data.note ?? null,
    });
    if (error) throw new Error(error.message);
    return { ok: true, points };
  });
