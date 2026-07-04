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
    return rows ?? [];
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
