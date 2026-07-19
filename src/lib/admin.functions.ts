import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function assertAdmin(ctx: { supabase: any; userId: string }) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: userData, error: userError } = await supabaseAdmin.auth.admin.getUserById(
    ctx.userId,
  );
  if (userError) throw new Error(userError.message);
  const email = userData.user?.email?.toLowerCase();
  if (!email) throw new Error("Forbidden: admin only");

  const { data: adminRows, error: adminError } = await supabaseAdmin
    .from("admin_emails")
    .select("email");
  if (adminError) throw new Error(adminError.message);
  const isAdmin = (adminRows ?? []).some((row) => row.email?.toLowerCase() === email);
  if (!isAdmin) throw new Error("Forbidden: admin only");
  return supabaseAdmin;
}

async function getIsAdmin(userId: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: userData, error: userError } = await supabaseAdmin.auth.admin.getUserById(userId);
  if (userError) throw new Error(userError.message);
  const email = userData.user?.email?.toLowerCase();
  if (!email) return false;

  const { data: adminRows, error: adminError } = await supabaseAdmin
    .from("admin_emails")
    .select("email");
  if (adminError) throw new Error(adminError.message);
  return (adminRows ?? []).some((row) => row.email?.toLowerCase() === email);
}

function readableError(error: unknown, fallback: string) {
  if (error instanceof Error && error.message && error.message !== "{}") return error.message;
  if (error && typeof error === "object") {
    const maybe = error as { message?: unknown; error?: unknown; code?: unknown; status?: unknown };
    const message = typeof maybe.message === "string" ? maybe.message : undefined;
    const nested = typeof maybe.error === "string" ? maybe.error : undefined;
    if (message && message !== "{}") return message;
    if (nested && nested !== "{}") return nested;
    try {
      const json = JSON.stringify(error);
      if (json && json !== "{}") return json;
    } catch {
      // fall through to fallback
    }
  }
  return fallback;
}

function isMissingAuthUserError(error: unknown) {
  const msg = readableError(error, "").toLowerCase();
  const status = error && typeof error === "object" ? (error as { status?: number }).status : undefined;
  return status === 404 || /not.?found|user.*missing|does not exist/.test(msg);
}

// ---------- COMPANIES ----------

export const listCompanies = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const supabaseAdmin = await assertAdmin(context);
    const { data, error } = await supabaseAdmin
      .from("companies")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const createCompany = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        name: z.string().trim().min(1).max(200),
        email: z.string().trim().email().max(255),
        phone: z.string().trim().max(40).optional().or(z.literal("")),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const supabaseAdmin = await assertAdmin(context);
    const { data: row, error } = await supabaseAdmin
      .from("companies")
      .insert({
        name: data.name,
        email: data.email,
        phone: data.phone || null,
      })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

export const setCompanyStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        status: z.enum(["pending", "approved", "suspended"]),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const supabaseAdmin = await assertAdmin(context);
    const { error } = await supabaseAdmin
      .from("companies")
      .update({ status: data.status })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });


export const setAccessEnd = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        days: z.number().int().min(0).max(3650),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const supabaseAdmin = await assertAdmin(context);
    const access_end = new Date(Date.now() + data.days * 86_400_000).toISOString();
    const { error } = await supabaseAdmin
      .from("companies")
      .update({ access_end })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { access_end };
  });

export const regenerateCustomLink = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const supabaseAdmin = await assertAdmin(context);
    const bytes = new Uint8Array(24);
    crypto.getRandomValues(bytes);
    const token = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
    const { error } = await supabaseAdmin
      .from("companies")
      .update({ custom_link: token })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { custom_link: token };
  });

export const setRequireClientCompany = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ id: z.string().uuid(), value: z.boolean() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const supabaseAdmin = await assertAdmin(context);
    const { error } = await supabaseAdmin
      .from("companies")
      .update({ require_client_company: data.value })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });


// ---------- WHOAMI ----------

export const whoAmI = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const isAdmin = await getIsAdmin(context.userId);
    return { userId: context.userId, isAdmin };
  });


// ---------- COORDINATOR PROVISIONING ----------

function phoneToEmail(phone: string) {
  // Deterministic synthetic email so phone sign-in works without an SMS provider.
  const digits = phone.replace(/[^\d]/g, "");
  return `p${digits}@phone.thecoordinator.local`;
}
function phoneToLegacyEmail(phone: string) {
  const digits = phone.replace(/[^\d]/g, "");
  return `p${digits}@phone.crewchange.local`;
}

export const createCoordinator = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        company_id: z.string().uuid(),
        phone: z.string().trim().regex(/^\+[1-9]\d{6,14}$/, "Phone must be in E.164 format, e.g. +35699123456"),
        password: z.string().min(8).max(128),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const supabaseAdmin = await assertAdmin(context);

    const phone = data.phone;
    const email = phoneToEmail(phone);

    let userId: string | null = null;
    const { data: created, error: cErr } = await supabaseAdmin.auth.admin.createUser({
      email,
      password: data.password,
      email_confirm: true,
      user_metadata: { must_change_password: true, role: "coordinator", phone },
    });
    if (cErr) {
      const msg = cErr.message?.toLowerCase() ?? "";
      if (msg.includes("already") || msg.includes("registered") || msg.includes("exists")) {
        const { data: list, error: lErr } = await supabaseAdmin.auth.admin.listUsers({
          page: 1,
          perPage: 200,
        });
        if (lErr) throw new Error(lErr.message);
        const existing = list.users.find((u) => u.email?.toLowerCase() === email);
        if (!existing) throw new Error("User exists but could not be located");
        const { error: uErr } = await supabaseAdmin.auth.admin.updateUserById(existing.id, {
          password: data.password,
          email_confirm: true,
          user_metadata: { ...(existing.user_metadata ?? {}), must_change_password: true, role: "coordinator", phone },
        });
        if (uErr) throw new Error(uErr.message);
        userId = existing.id;
      } else {
        throw new Error(cErr.message);
      }
    } else {
      userId = created.user?.id ?? null;
    }
    if (!userId) throw new Error("Could not resolve coordinator user id");

    const { error: aErr } = await supabaseAdmin
      .from("companies")
      .update({ owner_user_id: userId, coordinator_phone: phone })
      .eq("id", data.company_id);
    if (aErr) throw new Error(aErr.message);

    return { ok: true, user_id: userId, phone };
  });



// ---------- DELETE COORDINATOR ACCOUNT ----------

export const deleteCoordinator = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        company_id: z.string().uuid(),
        also_delete_company: z.boolean().default(false),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const supabaseAdmin = await assertAdmin(context);
    try {
      const { data: company, error: cErr } = await supabaseAdmin
        .from("companies")
        .select("id, owner_user_id")
        .eq("id", data.company_id)
        .single();
      if (cErr || !company) throw new Error(readableError(cErr, "Company not found"));

      let authUserDeleted = false;
      let authUserMissing = false;
      let authWarning: string | null = null;

      if (company.owner_user_id) {
        try {
          const { error: uErr } = await supabaseAdmin.auth.admin.deleteUser(company.owner_user_id);
          if (uErr) {
            if (isMissingAuthUserError(uErr)) {
              authUserMissing = true;
            } else {
              authWarning = readableError(uErr, "Auth account could not be confirmed as deleted");
              console.warn("deleteUser returned a non-fatal error", { authWarning });
            }
          } else {
            authUserDeleted = true;
          }
        } catch (e) {
          if (isMissingAuthUserError(e)) {
            authUserMissing = true;
          } else {
            authWarning = readableError(e, "Auth account could not be confirmed as deleted");
            console.warn("deleteUser threw a non-fatal error", { authWarning });
          }
        }
      } else {
        authUserMissing = true;
      }

      if (data.also_delete_company) {
        const { error: dErr } = await supabaseAdmin
          .from("companies")
          .delete()
          .eq("id", data.company_id);
        if (dErr) throw new Error(readableError(dErr, "Failed to delete company"));
        return { ok: true, company_deleted: true, auth_user_deleted: authUserDeleted, auth_user_missing: authUserMissing, warning: authWarning };
      }

      const { error: clearErr } = await supabaseAdmin
        .from("companies")
        .update({ owner_user_id: null })
        .eq("id", data.company_id);
      if (clearErr) throw new Error(readableError(clearErr, "Failed to clear coordinator assignment"));
      return { ok: true, company_deleted: false, auth_user_deleted: authUserDeleted, auth_user_missing: authUserMissing, warning: authWarning };
    } catch (e) {
      const message = readableError(e, "Coordinator deletion failed");
      console.error("deleteCoordinator failed", { message });
      return { ok: false, company_deleted: false, auth_user_deleted: false, auth_user_missing: false, warning: message };
    }
  });

// ---------- ACCESS REQUESTS ----------

export const listAccessRequests = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        status: z.enum(["all", "new", "contacted", "approved", "rejected"]).default("all"),
        limit: z.number().int().min(1).max(500).default(200),
      })
      .parse(input ?? {}),
  )
  .handler(async ({ data, context }) => {
    const supabaseAdmin = await assertAdmin(context);
    let q = supabaseAdmin
      .from("access_requests")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(data.limit);
    if (data.status !== "all") q = q.eq("status", data.status);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    const list = rows ?? [];
    const codes = Array.from(new Set(
      list.map((r: any) => r.referral_code).filter((c: any): c is string => !!c),
    ));
    let refMap: Record<string, { id: string; name: string }> = {};
    if (codes.length) {
      const { data: companies } = await supabaseAdmin
        .from("companies")
        .select("id, name, referral_code")
        .in("referral_code", codes as never);
      for (const c of (companies ?? []) as any[]) {
        if (c.referral_code) refMap[c.referral_code] = { id: c.id, name: c.name };
      }
    }
    return list.map((r: any) => ({
      ...r,
      referred_by: r.referral_code ? refMap[r.referral_code] ?? null : null,
    }));
  });

export const setAccessRequestStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        status: z.enum(["new", "contacted", "approved", "rejected"]),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const supabaseAdmin = await assertAdmin(context);
    const { error } = await supabaseAdmin
      .from("access_requests")
      .update({ status: data.status })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteAccessRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const supabaseAdmin = await assertAdmin(context);
    const { error } = await supabaseAdmin
      .from("access_requests")
      .delete()
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const countNewAccessRequests = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const supabaseAdmin = await assertAdmin(context);
    const { count, error } = await supabaseAdmin
      .from("access_requests")
      .select("id", { count: "exact", head: true })
      .eq("status", "new");
    if (error) throw new Error(error.message);
    return { count: count ?? 0 };
  });


// ---------- FEATURE ENTITLEMENTS ----------

import { FEATURE_CATALOG, FEATURE_KEYS, type FeatureKey } from "@/lib/features";

export const listFeatureEntitlements = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ company_id: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const supabaseAdmin = await assertAdmin(context);
    const { data: rows, error } = await supabaseAdmin
      .from("company_feature_entitlements")
      .select("feature, enabled, expires_at")
      .eq("company_id", data.company_id);
    if (error) throw new Error(error.message);
    const byKey = new Map<string, { enabled: boolean; expires_at: string | null }>();
    for (const r of rows ?? []) byKey.set(r.feature as string, { enabled: !!r.enabled, expires_at: r.expires_at });
    return FEATURE_CATALOG.map((f) => {
      const row = byKey.get(f.key);
      const active = row ? row.enabled && (!row.expires_at || new Date(row.expires_at) > new Date()) : true;
      return {
        key: f.key,
        label: f.label,
        description: f.description,
        enabled: row ? row.enabled : true,
        expires_at: row?.expires_at ?? null,
        active,
        has_override: !!row,
      };
    });
  });

export const setFeatureEntitlement = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        company_id: z.string().uuid(),
        feature: z.enum(FEATURE_KEYS as [FeatureKey, ...FeatureKey[]]),
        enabled: z.boolean(),
        duration_days: z.number().int().positive().max(3650).nullable().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const supabaseAdmin = await assertAdmin(context);
    const expiresAt = data.duration_days
      ? new Date(Date.now() + data.duration_days * 86400_000).toISOString()
      : null;
    const { error } = await supabaseAdmin
      .from("company_feature_entitlements")
      .upsert(
        {
          company_id: data.company_id,
          feature: data.feature,
          enabled: data.enabled,
          expires_at: expiresAt,
          created_by: context.userId,
        },
        { onConflict: "company_id,feature" },
      );
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const clearFeatureEntitlement = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        company_id: z.string().uuid(),
        feature: z.enum(FEATURE_KEYS as [FeatureKey, ...FeatureKey[]]),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const supabaseAdmin = await assertAdmin(context);
    const { error } = await supabaseAdmin
      .from("company_feature_entitlements")
      .delete()
      .eq("company_id", data.company_id)
      .eq("feature", data.feature);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/**
 * Batch-set entitlements: used by the admin "master switches" (Turn all AI
 * off, Kill switch, Enable everything) so a single click updates many rows
 * at once. Pass a specific list of feature keys to scope the change (e.g.
 * only AI features), or omit for all catalog features.
 */
export const bulkSetFeatureEntitlements = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        company_id: z.string().uuid(),
        enabled: z.boolean(),
        features: z
          .array(z.enum(FEATURE_KEYS as [FeatureKey, ...FeatureKey[]]))
          .min(1)
          .optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const supabaseAdmin = await assertAdmin(context);
    const keys = (data.features ?? FEATURE_KEYS) as FeatureKey[];
    const rows = keys.map((f) => ({
      company_id: data.company_id,
      feature: f,
      enabled: data.enabled,
      expires_at: null,
      created_by: context.userId,
    }));
    const { error } = await supabaseAdmin
      .from("company_feature_entitlements")
      .upsert(rows, { onConflict: "company_id,feature" });
    if (error) throw new Error(error.message);
    return { ok: true, count: rows.length };
  });


// ---------- ACTIVITY LOG ----------

export const listActivityLog = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      actor_user_id: z.string().uuid().nullable().optional(),
      actor_email: z.string().trim().max(200).nullable().optional(),
      table_name: z.string().trim().max(80).nullable().optional(),
      action: z.enum(["INSERT", "UPDATE", "DELETE"]).nullable().optional(),
      company_id: z.string().uuid().nullable().optional(),
      row_id: z.string().trim().max(80).nullable().optional(),
      since: z.string().datetime().nullable().optional(),
      until: z.string().datetime().nullable().optional(),
      search: z.string().trim().max(200).nullable().optional(),
      limit: z.number().int().min(1).max(500).default(100),
      offset: z.number().int().min(0).max(100000).default(0),
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const supabaseAdmin = await assertAdmin(context);
    let q = supabaseAdmin
      .from("admin_activity_log")
      .select("*", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(data.offset, data.offset + data.limit - 1);
    if (data.actor_user_id) q = q.eq("actor_user_id", data.actor_user_id);
    if (data.actor_email) q = q.ilike("actor_email", `%${data.actor_email}%`);
    if (data.table_name) q = q.eq("table_name", data.table_name);
    if (data.action) q = q.eq("action", data.action);
    if (data.company_id) q = q.eq("company_id", data.company_id);
    if (data.row_id) q = q.eq("row_id", data.row_id);
    if (data.since) q = q.gte("created_at", data.since);
    if (data.until) q = q.lte("created_at", data.until);
    if (data.search) {
      // Search JSON blobs by casting to text.
      q = q.or(`row_id.ilike.%${data.search}%,actor_email.ilike.%${data.search}%`);
    }
    const { data: rows, error, count } = await q;
    if (error) throw new Error(error.message);
    return { rows: rows ?? [], total: count ?? 0 };
  });

export const listActivityFacets = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const supabaseAdmin = await assertAdmin(context);
    // Distinct actor + table + company lists — small; pulled from the last 30 days
    // to keep the dropdowns focused on recent activity.
    const since = new Date(Date.now() - 30 * 24 * 60 * 60_000).toISOString();
    const [{ data: actors }, { data: tables }, { data: companies }] = await Promise.all([
      supabaseAdmin.from("admin_activity_log")
        .select("actor_user_id, actor_email, actor_label")
        .gte("created_at", since)
        .not("actor_user_id", "is", null)
        .limit(2000),
      supabaseAdmin.from("admin_activity_log")
        .select("table_name")
        .gte("created_at", since)
        .limit(5000),
      supabaseAdmin.from("companies").select("id, name").order("name"),
    ]);
    const actorMap = new Map<string, { user_id: string; email: string | null; label: string | null }>();
    for (const a of (actors ?? []) as any[]) {
      if (!a.actor_user_id) continue;
      if (!actorMap.has(a.actor_user_id))
        actorMap.set(a.actor_user_id, { user_id: a.actor_user_id, email: a.actor_email, label: a.actor_label });
    }
    const tableSet = new Set<string>();
    for (const t of (tables ?? []) as any[]) if (t.table_name) tableSet.add(t.table_name);
    return {
      actors: Array.from(actorMap.values()).sort((a, b) => (a.email ?? "").localeCompare(b.email ?? "")),
      tables: Array.from(tableSet).sort(),
      companies: (companies ?? []) as { id: string; name: string }[],
    };
  });


// ---------- MONETIZATION: PLANS ----------

export const adminListPlans = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const sb = await assertAdmin(context);
    const { data } = await sb.from("plans").select("*").order("sort_order");
    return data ?? [];
  });

export const adminUpsertPlan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({
      id: z.string().uuid().optional(),
      code: z.string().trim().min(1).max(40),
      name: z.string().trim().min(1).max(80),
      price_monthly: z.number().min(0),
      included_points: z.number().int().min(0),
      feature_keys: z.array(z.string()).max(50),
      sort_order: z.number().int().min(0).max(999).default(0),
      description: z.string().trim().max(500).optional().nullable(),
      driver_cap: z.number().int().min(0).max(10000).optional().nullable(),
      trial_days: z.number().int().min(0).max(365).optional(),
      is_public: z.boolean().optional(),
    }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const sb = await assertAdmin(context);
    const row = { ...data };
    const { error } = await sb.from("plans").upsert(row as never, { onConflict: "code" });
    if (error) throw new Error(error.message);
    return { ok: true };
  });


export const adminDeletePlan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const sb = await assertAdmin(context);
    const { error } = await sb.from("plans").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ---------- MONETIZATION: POINT PACKS ----------

export const adminListPointPacks = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const sb = await assertAdmin(context);
    const { data } = await sb.from("point_packs").select("*").order("sort_order");
    return data ?? [];
  });

export const adminUpsertPointPack = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({
      id: z.string().uuid().optional(),
      name: z.string().trim().min(1).max(80),
      points: z.number().int().positive(),
      price: z.number().min(0),
      sort_order: z.number().int().min(0).max(999).default(0),
      is_active: z.boolean().default(true),
    }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const sb = await assertAdmin(context);
    if (data.id) {
      const { error } = await sb.from("point_packs").update(data as never).eq("id", data.id);
      if (error) throw new Error(error.message);
    } else {
      const { error } = await sb.from("point_packs").insert(data as never);
      if (error) throw new Error(error.message);
    }
    return { ok: true };
  });

export const adminDeletePointPack = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const sb = await assertAdmin(context);
    const { error } = await sb.from("point_packs").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ---------- MONETIZATION: AI FEATURE COSTS ----------

export const adminSetFeatureCost = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({
      feature_key: z.string().trim().min(1).max(80),
      points_cost: z.number().min(0).max(10000),
      label: z.string().trim().max(120).optional(),
      category: z.enum(["core", "ai", "comms", "data", "dispatch", "portal", "reporting", "routing"]).optional(),
      enabled: z.boolean().optional(),
      block_on_empty: z.boolean().optional(),
      min_plan_code: z.enum(["starter", "pro", "business"]).nullable().optional(),
      is_addon: z.boolean().optional(),
      sort_order: z.number().int().min(0).max(9999).optional(),
      est_cost_usd_cents: z.number().min(0).max(10000).nullable().optional(),
    }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const sb = await assertAdmin(context);
    const { error } = await sb.from("ai_feature_costs")
      .upsert({ ...data } as never, { onConflict: "feature_key" });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ---------- AI free monthly allowance (per-company override) ----------

export const adminListFreeAllowances = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const sb = await assertAdmin(context);
    const { data, error } = await sb
      .from("companies")
      .select("id, name, ai_free_monthly_points, ai_free_points_used_this_period, ai_period_reset_at")
      .gt("ai_free_monthly_points", 0)
      .order("ai_free_monthly_points", { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const adminSearchCompanies = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({ query: z.string().trim().max(120).default("") }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const sb = await assertAdmin(context);
    let q = sb.from("companies")
      .select("id, name, ai_free_monthly_points, ai_free_points_used_this_period");
    if (data.query) q = q.ilike("name", `%${data.query}%`);
    const { data: rows, error } = await q.order("name").limit(20);
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const adminSetFreeAllowance = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({
      company_id: z.string().uuid(),
      ai_free_monthly_points: z.number().min(0).max(100_000),
      reset_used: z.boolean().optional(),
    }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const sb = await assertAdmin(context);
    const patch: Record<string, unknown> = { ai_free_monthly_points: data.ai_free_monthly_points };
    if (data.reset_used) patch.ai_free_points_used_this_period = 0;
    const { error } = await sb.from("companies").update(patch as never).eq("id", data.company_id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });


export const adminListCompanyPriceOverrides = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ company_id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const sb = await assertAdmin(context);
    const { data: rows, error } = await sb
      .from("company_feature_price_overrides")
      .select("feature_key, points_cost")
      .eq("company_id", data.company_id);
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const adminSetCompanyPriceOverride = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({
      company_id: z.string().uuid(),
      feature_key: z.string().trim().min(1).max(80),
      points_cost: z.number().min(0).max(10000).nullable(),
    }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const sb = await assertAdmin(context);
    if (data.points_cost === null) {
      const { error } = await sb.from("company_feature_price_overrides")
        .delete()
        .eq("company_id", data.company_id)
        .eq("feature_key", data.feature_key);
      if (error) throw new Error(error.message);
    } else {
      const { error } = await sb.from("company_feature_price_overrides")
        .upsert({
          company_id: data.company_id,
          feature_key: data.feature_key,
          points_cost: data.points_cost,
        } as never, { onConflict: "company_id,feature_key" });
      if (error) throw new Error(error.message);
    }
    return { ok: true };
  });

// ---------- COMPANY: assign plan / grant points / cap feature ----------

export const adminSetCompanyPlan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({ company_id: z.string().uuid(), plan_id: z.string().uuid() }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const sb = await assertAdmin(context);
    const { error } = await sb.rpc("set_company_plan", {
      _company_id: data.company_id,
      _plan_id: data.plan_id,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const adminGrantPoints = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({
      company_id: z.string().uuid(),
      points: z.number().min(-1_000_000).max(1_000_000),
      note: z.string().trim().max(300).optional(),
    }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const sb = await assertAdmin(context);
    const { error } = await sb.rpc("admin_grant_points", {
      _company_id: data.company_id,
      _points: data.points,
      _note: data.note ?? undefined,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const adminSetFeatureCap = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({
      company_id: z.string().uuid(),
      feature: z.string().trim().min(1).max(80),
      monthly_cap: z.number().int().min(0).max(1_000_000).nullable(),
    }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const sb = await assertAdmin(context);
    const { error } = await sb.from("company_feature_entitlements").upsert(
      {
        company_id: data.company_id,
        feature: data.feature,
        enabled: true,
        monthly_cap: data.monthly_cap,
        created_by: context.userId,
      } as never,
      { onConflict: "company_id,feature" },
    );
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const adminGetCompanyBilling = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ company_id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const sb = await assertAdmin(context);
    const [
      { data: company },
      { data: subscription },
      { data: ledger },
    ] = await Promise.all([
      sb.from("companies").select("id, name, points_balance").eq("id", data.company_id).maybeSingle(),
      sb.from("company_subscriptions").select("*, plans(*)").eq("company_id", data.company_id).maybeSingle(),
      sb.from("points_ledger").select("*").eq("company_id", data.company_id)
        .order("created_at", { ascending: false }).limit(50),
    ]);
    return { company, subscription, ledger: ledger ?? [] };
  });

// ---------- TOP-UP QUEUE ----------

export const adminListTopups = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({
      status: z.enum(["pending", "fulfilled", "rejected", "all"]).default("pending"),
      limit: z.number().int().min(1).max(200).default(50),
    }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const sb = await assertAdmin(context);
    let q = sb.from("topup_requests")
      .select("*, companies(id, name), point_packs(id, name, points, price)")
      .order("created_at", { ascending: false })
      .limit(data.limit);
    if (data.status !== "all") q = q.eq("status", data.status as "pending" | "fulfilled" | "rejected");
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const adminApproveTopup = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({ id: z.string().uuid(), points_override: z.number().int().positive().optional() }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const sb = await assertAdmin(context);
    const { data: req } = await sb.from("topup_requests").select("*").eq("id", data.id).maybeSingle();
    if (!req) throw new Error("Top-up not found");
    if (req.status !== "pending") throw new Error("Already processed");
    const grant = data.points_override ?? req.points_requested;
    const { error: gErr } = await sb.rpc("admin_grant_points", {
      _company_id: req.company_id,
      _points: grant,
      _note: `topup approved (req ${req.id})`,
    });
    if (gErr) throw new Error(gErr.message);
    const { error: uErr } = await sb.from("topup_requests")
      .update({ status: "fulfilled" } as never).eq("id", data.id);
    if (uErr) throw new Error(uErr.message);
    return { ok: true, granted: grant };
  });

export const adminDeclineTopup = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const sb = await assertAdmin(context);
    const { error } = await sb.from("topup_requests")
      .update({ status: "rejected" } as never).eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ---------- REVENUE DASHBOARD ----------

export const adminRevenueDashboard = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const sb = await assertAdmin(context);
    const since30 = new Date(Date.now() - 30 * 86400_000).toISOString();

    const [
      { data: subs },
      { data: ledger30 },
      { data: topups30 },
      { data: companies },
    ] = await Promise.all([
      sb.from("company_subscriptions").select("*, plans(*), companies(id, name)"),
      sb.from("points_ledger").select("*").gte("created_at", since30),
      sb.from("topup_requests").select("*").gte("created_at", since30),
      sb.from("companies").select("id, name, points_balance"),
    ]);

    const subsArr = (subs ?? []) as any[];
    const mrr = subsArr.reduce((sum, s) => sum + Number(s?.plans?.price_monthly ?? 0), 0);
    const approvedTopups = (topups30 ?? []).filter((t: any) => t.status === "approved");
    const topupRevenue = approvedTopups.reduce((s: number, t: any) => s + Number(t.price ?? 0), 0);
    const pointsSold = approvedTopups.reduce((s: number, t: any) => s + Number(t.points_requested ?? 0), 0);
    const totalPointsSpent = (ledger30 ?? []).reduce((s: number, l: any) => s + Math.max(0, Number(l.points_deducted ?? 0)), 0);

    // Feature adoption
    const featureCounts = new Map<string, number>();
    for (const l of (ledger30 ?? []) as any[]) {
      if (!l.feature_key) continue;
      featureCounts.set(l.feature_key, (featureCounts.get(l.feature_key) ?? 0) + 1);
    }

    // Top spenders (by points spent last 30d)
    const spendByCompany = new Map<string, number>();
    for (const l of (ledger30 ?? []) as any[]) {
      spendByCompany.set(l.company_id, (spendByCompany.get(l.company_id) ?? 0) + Math.max(0, Number(l.points_deducted ?? 0)));
    }
    const companyMap = new Map((companies ?? []).map((c: any) => [c.id, c.name]));
    const topSpenders = Array.from(spendByCompany.entries())
      .map(([id, spent]) => ({ id, name: companyMap.get(id) ?? "—", spent }))
      .sort((a, b) => b.spent - a.spent)
      .slice(0, 10);

    // Plan distribution
    const planDist = new Map<string, number>();
    for (const s of subsArr) {
      const name = s?.plans?.name ?? "—";
      planDist.set(name, (planDist.get(name) ?? 0) + 1);
    }

    return {
      mrr,
      topup_revenue_30d: topupRevenue,
      total_revenue_30d: mrr + topupRevenue,
      points_sold_30d: pointsSold,
      points_spent_30d: totalPointsSpent,
      active_subscriptions: subsArr.length,
      total_companies: (companies ?? []).length,
      feature_usage_30d: Array.from(featureCounts.entries())
        .map(([feature_key, count]) => ({ feature_key, count }))
        .sort((a, b) => b.count - a.count),
      top_spenders: topSpenders,
      plan_distribution: Array.from(planDist.entries()).map(([plan, count]) => ({ plan, count })),
    };
  });



// ---------- PUBLIC PASSWORD RESET (phone-based) ----------

// In-memory rate limit map (per-instance). Best-effort; not shared across workers.
const _resetAttempts = new Map<string, number>();

function generateTempPassword(len = 12) {
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  let out = "";
  const arr = new Uint32Array(len);
  crypto.getRandomValues(arr);
  for (let i = 0; i < len; i++) out += chars[arr[i] % chars.length];
  return out;
}

export const requestPasswordReset = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z
      .object({
        phone: z
          .string()
          .trim()
          .regex(/^\+[1-9]\d{6,14}$/, "Phone must be in E.164 format, e.g. +35699123456"),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const phone = data.phone;

    // Rate limit: 1 request per phone per 60 seconds (per worker instance).
    const last = _resetAttempts.get(phone) ?? 0;
    const now = Date.now();
    if (now - last < 60_000) {
      // Do not reveal rate-limit state to anonymous callers; pretend success.
      return { ok: true } as const;
    }
    _resetAttempts.set(phone, now);

    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      await supabaseAdmin
        .from("password_reset_requests")
        .insert({ phone, status: "pending" });
    } catch (e) {
      console.error("requestPasswordReset insert failed", e);
    }

    // Always return ok regardless of whether an account exists, to prevent
    // using this endpoint to enumerate registered phone numbers.
    return { ok: true } as const;
  });

export const adminListPasswordResetRequests = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const sb = await assertAdmin(context);
    const { data, error } = await sb
      .from("password_reset_requests")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const adminApprovePasswordResetRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const sb = await assertAdmin(context);
    const { data: req, error: rErr } = await sb
      .from("password_reset_requests")
      .select("id, phone, status")
      .eq("id", data.id)
      .single();
    if (rErr || !req) throw new Error(readableError(rErr, "Request not found"));
    if (req.status !== "pending") throw new Error("Request is not pending");

    const phone = req.phone as string;
    const digits = phone.replace(/[^\d]/g, "");
    const email = `p${digits}@phone.thecoordinator.local`;
    const legacyEmail = `p${digits}@phone.crewchange.local`;

    // Find user by synthetic email (paginated). Match new or legacy domain.
    let existing: { id: string; user_metadata?: any } | null = null;
    for (let page = 1; page <= 5 && !existing; page++) {
      const { data: list, error } = await sb.auth.admin.listUsers({ page, perPage: 200 });
      if (error) throw new Error(error.message);
      existing = list.users.find((u) => {
        const e = u.email?.toLowerCase();
        return e === email || e === legacyEmail;
      }) as any;
      if (list.users.length < 200) break;
    }
    if (!existing) throw new Error("No account found for that phone number.");

    const temp_password = generateTempPassword(12);
    const { error: uErr } = await sb.auth.admin.updateUserById(existing.id, {
      password: temp_password,
      user_metadata: { ...(existing.user_metadata ?? {}), must_change_password: true },
    });
    if (uErr) throw new Error(uErr.message);

    const { error: updErr } = await sb
      .from("password_reset_requests")
      .update({ status: "approved", resolved_at: new Date().toISOString() })
      .eq("id", data.id);
    if (updErr) throw new Error(updErr.message);

    return { ok: true, phone, temp_password } as const;
  });

export const adminDismissPasswordResetRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const sb = await assertAdmin(context);
    const { error } = await sb
      .from("password_reset_requests")
      .update({ status: "dismissed", resolved_at: new Date().toISOString() })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true } as const;
  });


// ---------- PRICING PAGE: usage metrics + wallets ----------

export const adminFeatureUsageThisMonth = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const sb = await assertAdmin(context);
    const since = new Date();
    since.setUTCDate(1);
    since.setUTCHours(0, 0, 0, 0);
    const { data, error } = await sb
      .from("points_ledger")
      .select("feature_key, company_id")
      .gte("created_at", since.toISOString());
    if (error) throw new Error(error.message);
    const acc = new Map<string, { uses: number; companies: Set<string> }>();
    for (const row of (data ?? []) as Array<{ feature_key: string | null; company_id: string | null }>) {
      const key = row.feature_key ?? "";
      if (!key) continue;
      const bucket = acc.get(key) ?? { uses: 0, companies: new Set<string>() };
      bucket.uses += 1;
      if (row.company_id) bucket.companies.add(row.company_id);
      acc.set(key, bucket);
    }
    return Array.from(acc.entries()).map(([feature_key, v]) => ({
      feature_key,
      uses: v.uses,
      companies: v.companies.size,
    }));
  });

export const adminListCompanyWallets = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const sb = await assertAdmin(context);
    const since = new Date();
    since.setUTCDate(1);
    since.setUTCHours(0, 0, 0, 0);
    const [
      { data: companies, error: cErr },
      { data: subs, error: sErr },
      { data: ledger, error: lErr },
    ] = await Promise.all([
      sb.from("companies").select("id, name, created_at, points_balance").order("name"),
      sb.from("company_subscriptions").select("company_id, plan_id, points_remaining_this_period, plans(name)"),
      sb.from("points_ledger").select("company_id, created_at, points_deducted").gte("created_at", since.toISOString()),
    ]);
    if (cErr) throw new Error(cErr.message);
    if (sErr) throw new Error(sErr.message);
    if (lErr) throw new Error(lErr.message);
    const subMap = new Map<string, { plan_name: string | null; plan_points: number }>();
    for (const s of (subs ?? []) as Array<{ company_id: string; points_remaining_this_period: number | null; plans: { name: string } | null }>) {
      subMap.set(s.company_id, {
        plan_name: s.plans?.name ?? null,
        plan_points: Number(s.points_remaining_this_period ?? 0),
      });
    }
    const lastActivity = new Map<string, string>();
    const topupsThisMonth = new Map<string, number>();
    for (const l of (ledger ?? []) as Array<{ company_id: string | null; created_at: string; points_deducted: number | null }>) {
      if (!l.company_id) continue;
      const cur = lastActivity.get(l.company_id);
      if (!cur || cur < l.created_at) lastActivity.set(l.company_id, l.created_at);
      if (Number(l.points_deducted) < 0) {
        topupsThisMonth.set(l.company_id, (topupsThisMonth.get(l.company_id) ?? 0) + 1);
      }
    }
    return ((companies ?? []) as Array<{ id: string; name: string; created_at: string; points_balance: number | null }>).map((c) => ({
      id: c.id,
      name: c.name,
      created_at: c.created_at,
      points_balance: Number(c.points_balance ?? 0),
      plan_name: subMap.get(c.id)?.plan_name ?? null,
      plan_points: subMap.get(c.id)?.plan_points ?? 0,
      last_activity_at: lastActivity.get(c.id) ?? null,
      topups_this_month: topupsThisMonth.get(c.id) ?? 0,
    }));
  });
