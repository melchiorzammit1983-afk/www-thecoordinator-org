/**
 * Coordinator pricing — company-wide defaults, service areas, and per-driver
 * rate overrides. All fns are scoped to the caller's owning company.
 *
 * The company row already carries the waiting policy (free_wait_minutes,
 * waiting_rate_per_minute); this module adds per-km / per-hour / minimum
 * fare + driver-payout defaults, and adds an editable `service_areas` list
 * for per-area rate cards.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function getAdmin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

async function resolveOwnedCompany(ctx: any) {
  const sb = await getAdmin();
  const { data: co } = await sb
    .from("companies")
    .select("id")
    .eq("owner_user_id", ctx.userId)
    .maybeSingle();
  if (!co) throw new Error("No company for user");
  return co.id as string;
}

const CURRENCY = z.string().length(3).transform((s) => s.toUpperCase());
const NUM = z.number().nonnegative().max(1_000_000);
const PCT = z.number().min(0).max(100);

// ---------- Company-wide pricing settings ----------
const PricingPatch = z.object({
  currency: CURRENCY.optional(),
  price_per_km: NUM.optional(),
  price_per_hour: NUM.optional(),
  minimum_fare: NUM.optional(),
  free_wait_minutes: z.number().int().min(0).max(240).optional(),
  waiting_rate_per_minute: NUM.optional(),
  default_driver_pay_per_km: NUM.optional(),
  default_driver_pay_per_hour: NUM.optional(),
  default_driver_wait_share_pct: PCT.optional(),
  default_driver_commission_pct: PCT.optional(),
});

export const getPricingSettings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const companyId = await resolveOwnedCompany(context);
    const sb = await getAdmin();
    const { data } = await sb
      .from("companies")
      .select(
        "id, currency, price_per_km, price_per_hour, minimum_fare, free_wait_minutes, waiting_rate_per_minute, default_driver_pay_per_km, default_driver_pay_per_hour, default_driver_wait_share_pct, default_driver_commission_pct",
      )
      .eq("id", companyId)
      .maybeSingle();
    return data ?? { id: companyId };
  });

export const updatePricingSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => PricingPatch.parse(i))
  .handler(async ({ data, context }) => {
    const companyId = await resolveOwnedCompany(context);
    const sb = await getAdmin();
    const { error } = await sb.from("companies").update(data as any).eq("id", companyId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ---------- Service areas ----------
const AreaInput = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(1).max(120),
  currency: CURRENCY.nullable().optional(),
  base_price: NUM.default(0),
  price_per_km: NUM.default(0),
  price_per_hour: NUM.default(0),
  minimum_fare: NUM.default(0),
  free_wait_minutes: z.number().int().min(0).max(240).nullable().optional(),
  waiting_rate_per_minute: NUM.nullable().optional(),
  notes: z.string().max(1000).nullable().optional(),
  active: z.boolean().default(true),
  sort_order: z.number().int().default(0),
});

export const listServiceAreas = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const companyId = await resolveOwnedCompany(context);
    const sb = await getAdmin();
    const { data } = await sb
      .from("service_areas" as any)
      .select("*")
      .eq("company_id", companyId)
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true });
    return data ?? [];
  });

export const upsertServiceArea = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => AreaInput.parse(i))
  .handler(async ({ data, context }) => {
    const companyId = await resolveOwnedCompany(context);
    const sb = await getAdmin();
    // If updating, verify ownership
    if (data.id) {
      const { data: existing } = await sb.from("service_areas" as any).select("id").eq("id", data.id).eq("company_id", companyId).maybeSingle();
      if (!existing) throw new Error("Area not found");
    }
    const payload = { ...data, company_id: companyId };
    const { data: row, error } = await sb.from("service_areas" as any).upsert(payload).select().single();
    if (error) throw new Error(error.message);
    return row;
  });

export const deleteServiceArea = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const companyId = await resolveOwnedCompany(context);
    const sb = await getAdmin();
    const { error } = await sb.from("service_areas" as any).delete().eq("id", data.id).eq("company_id", companyId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ---------- Driver-side rate overrides ----------
const DriverRates = z.object({
  id: z.string().uuid(),
  pay_per_km: NUM.nullable().optional(),
  pay_per_hour: NUM.nullable().optional(),
  wait_share_pct: PCT.nullable().optional(),
  commission_pct: PCT.nullable().optional(),
});

export const updateDriverRates = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => DriverRates.parse(i))
  .handler(async ({ data, context }) => {
    const companyId = await resolveOwnedCompany(context);
    const sb = await getAdmin();
    const { id, ...patch } = data;
    // Only nullify or set the keys the caller sent
    const clean: Record<string, unknown> = {};
    for (const k of Object.keys(patch)) {
      const v = (patch as any)[k];
      if (v !== undefined) clean[k] = v;
    }
    const { error } = await sb
      .from("drivers")
      .update(clean as never)
      .eq("id", id)
      .eq("company_id", companyId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
