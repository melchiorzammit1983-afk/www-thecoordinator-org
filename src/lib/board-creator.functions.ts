import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const FREE_LOGO_LIMIT = 5;
const HARD_LOGO_LIMIT = 25;

async function getAdmin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

async function getMyCompanyId(userId: string): Promise<string> {
  const sb = await getAdmin();
  const { data, error } = await sb
    .from("companies")
    .select("id")
    .eq("owner_user_id", userId)
    .maybeSingle();
  if (error || !data) throw new Error("No company assigned to this user");
  return data.id as string;
}

async function signPath(storage_path: string, ttlSec = 60 * 60): Promise<string> {
  const sb = await getAdmin();
  const { data } = await sb.storage.from("company-logos").createSignedUrl(storage_path, ttlSec);
  return data?.signedUrl ?? "";
}

/**
 * List every uploaded logo/background for the caller's company, with fresh
 * signed URLs suitable for display in the browser preview.
 */
export const listMyLogos = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const companyId = await getMyCompanyId(context.userId);
    const sb = await getAdmin();
    const { data, error } = await sb
      .from("company_logos")
      .select("id, storage_path, label, is_primary, sort_order, is_background, created_at")
      .eq("company_id", companyId)
      .order("is_primary", { ascending: false })
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);

    const rows = data ?? [];
    const withUrls = await Promise.all(
      rows.map(async (r: any) => ({
        ...r,
        url: await signPath(r.storage_path),
      })),
    );

    const logoCount = rows.filter((r: any) => !r.is_background).length;
    const feeRow = await sb
      .from("ai_feature_costs")
      .select("points_cost, enabled")
      .eq("feature_key", "extra_company_logos_weekly")
      .maybeSingle();
    const weeklyCost = feeRow.data?.enabled ? Number(feeRow.data?.points_cost ?? 0) : 0;

    return {
      logos: withUrls,
      logo_count: logoCount,
      free_limit: FREE_LOGO_LIMIT,
      hard_limit: HARD_LOGO_LIMIT,
      over_limit: logoCount > FREE_LOGO_LIMIT,
      weekly_cost: weeklyCost,
    };
  });

/**
 * Create a short-lived signed upload URL for a new logo. The browser then
 * PUTs the file directly to Supabase Storage.
 */
export const getLogoUploadUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      filename: z.string().trim().min(1).max(200),
      content_type: z.string().trim().min(1).max(120),
      is_background: z.boolean().optional().default(false),
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const companyId = await getMyCompanyId(context.userId);
    const sb = await getAdmin();

    if (!data.is_background) {
      const { count } = await sb
        .from("company_logos")
        .select("id", { count: "exact", head: true })
        .eq("company_id", companyId)
        .eq("is_background", false);
      if ((count ?? 0) >= HARD_LOGO_LIMIT) {
        throw new Error(`You already have ${HARD_LOGO_LIMIT} logos. Please delete some before uploading more.`);
      }
    }

    const safeName = data.filename.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-80);
    const uid = crypto.randomUUID();
    const path = `${companyId}/${uid}-${safeName}`;

    const { data: signed, error } = await sb.storage
      .from("company-logos")
      .createSignedUploadUrl(path);
    if (error || !signed) throw new Error(error?.message ?? "Failed to create upload URL");

    return {
      path,
      token: signed.token,
      signed_url: signed.signedUrl,
    };
  });

/**
 * Register a successful upload into company_logos. Returns the fresh row
 * plus the current billing situation.
 */
export const registerUploadedLogo = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      storage_path: z.string().trim().min(1).max(500),
      label: z.string().trim().max(80).optional(),
      is_background: z.boolean().optional().default(false),
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const companyId = await getMyCompanyId(context.userId);
    if (!data.storage_path.startsWith(`${companyId}/`)) {
      throw new Error("Invalid storage path for this company");
    }

    const sb = await getAdmin();
    const { data: row, error } = await sb
      .from("company_logos")
      .insert({
        company_id: companyId,
        storage_path: data.storage_path,
        label: data.label ?? null,
        is_background: !!data.is_background,
      } as never)
      .select("id, storage_path, label, is_primary, sort_order, is_background, created_at")
      .single();
    if (error || !row) throw new Error(error?.message ?? "Failed to save logo");

    const { count } = await sb
      .from("company_logos")
      .select("id", { count: "exact", head: true })
      .eq("company_id", companyId)
      .eq("is_background", false);
    const logoCount = count ?? 0;

    const feeRow = await sb
      .from("ai_feature_costs")
      .select("points_cost, enabled")
      .eq("feature_key", "extra_company_logos_weekly")
      .maybeSingle();
    const weeklyCost = feeRow.data?.enabled ? Number(feeRow.data?.points_cost ?? 0) : 0;

    return {
      row: { ...row, url: await signPath(row.storage_path) },
      logo_count: logoCount,
      free_limit: FREE_LOGO_LIMIT,
      over_limit: logoCount > FREE_LOGO_LIMIT,
      weekly_cost: weeklyCost,
    };
  });

export const deleteMyLogo = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const companyId = await getMyCompanyId(context.userId);
    const sb = await getAdmin();
    const { data: row } = await sb
      .from("company_logos")
      .select("id, storage_path, company_id")
      .eq("id", data.id)
      .maybeSingle();
    if (!row || row.company_id !== companyId) throw new Error("Not found");
    await sb.storage.from("company-logos").remove([row.storage_path]).catch(() => null);
    const { error } = await sb.from("company_logos").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const setPrimaryLogo = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const companyId = await getMyCompanyId(context.userId);
    const sb = await getAdmin();
    await sb.from("company_logos").update({ is_primary: false } as never).eq("company_id", companyId);
    const { error } = await sb
      .from("company_logos")
      .update({ is_primary: true } as never)
      .eq("id", data.id)
      .eq("company_id", companyId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/**
 * Load a trip's essentials plus any saved board config, scoped to the
 * caller's own company so coordinators can't peek at other people's jobs.
 */
export const getBoardTripContext = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ job_id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const companyId = await getMyCompanyId(context.userId);
    const sb = await getAdmin();
    const { data: job, error } = await sb
      .from("jobs")
      .select(
        "id, company_id, from_location, to_location, date, time, pickup_at, from_flight, to_flight, flightorship, clientcompanyname, client_link_token, board_config, pax(name)",
      )
      .eq("id", data.job_id)
      .maybeSingle();
    if (error || !job) throw new Error("Trip not found");
    if (job.company_id !== companyId) throw new Error("Not authorized for this trip");

    const paxNames = ((job as any).pax ?? []).map((p: any) => p.name).filter(Boolean) as string[];
    const flightNumber = (job as any).from_flight || (job as any).to_flight || (job as any).flightorship || "";

    return {
      id: job.id,
      pax_names: paxNames,
      first_pax: paxNames[0] ?? "",
      flight_number: flightNumber,
      from_location: (job as any).from_location ?? "",
      to_location: (job as any).to_location ?? "",
      date: (job as any).date ?? null,
      time: (job as any).time ?? null,
      pickup_at: (job as any).pickup_at ?? null,
      client_company_name: (job as any).clientcompanyname ?? "",
      client_link_token: (job as any).client_link_token ?? null,
      board_config: (job as any).board_config ?? null,
    };
  });

export const saveTripBoardConfig = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      job_id: z.string().uuid(),
      board_config: z.any(),
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const companyId = await getMyCompanyId(context.userId);
    const sb = await getAdmin();
    const { data: job } = await sb
      .from("jobs")
      .select("id, company_id")
      .eq("id", data.job_id)
      .maybeSingle();
    if (!job || job.company_id !== companyId) throw new Error("Not authorized for this trip");
    const { error } = await sb
      .from("jobs")
      .update({ board_config: data.board_config } as never)
      .eq("id", data.job_id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
