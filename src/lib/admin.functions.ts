import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function assertAdmin(ctx: { supabase: any; userId: string }) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin.rpc("is_admin", { _user_id: ctx.userId });
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Forbidden: admin only");
}

// ---------- COMPANIES ----------

export const listCompanies = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const { data, error } = await context.supabase
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
    await assertAdmin(context);
    const { data: row, error } = await context.supabase
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
    await assertAdmin(context);
    const { error } = await context.supabase
      .from("companies")
      .update({ status: data.status })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const topUpPoints = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        company_id: z.string().uuid(),
        points: z.number().int().refine((n) => n !== 0, "Points must be non-zero"),
        note: z.string().trim().max(500).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { data: company, error: cErr } = await context.supabase
      .from("companies")
      .select("points_balance")
      .eq("id", data.company_id)
      .single();
    if (cErr || !company) throw new Error(cErr?.message ?? "Company not found");
    const newBalance = (company.points_balance ?? 0) + data.points;
    const { error: uErr } = await context.supabase
      .from("companies")
      .update({ points_balance: newBalance })
      .eq("id", data.company_id);
    if (uErr) throw new Error(uErr.message);
    // Ledger convention: positive = deducted, negative = top-up
    const { error: lErr } = await context.supabase.from("points_ledger").insert({
      company_id: data.company_id,
      points_deducted: -data.points,
      note: data.note ?? (data.points > 0 ? "Admin top-up" : "Admin adjustment"),
    });
    if (lErr) throw new Error(lErr.message);
    return { balance: newBalance };
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
    await assertAdmin(context);
    const access_end = new Date(Date.now() + data.days * 86_400_000).toISOString();
    const { error } = await context.supabase
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
    await assertAdmin(context);
    const bytes = new Uint8Array(24);
    crypto.getRandomValues(bytes);
    const token = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
    const { error } = await context.supabase
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
    await assertAdmin(context);
    const { error } = await context.supabase
      .from("companies")
      .update({ require_client_company: data.value })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ---------- FEATURE COSTS ----------

export const listFeatureCosts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const { data, error } = await context.supabase
      .from("feature_costs")
      .select("*")
      .order("feature_name");
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const setFeatureCost = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        feature_name: z.enum(["tracking", "bulkupload", "client_booking", "qr"]),
        points_cost: z.number().int().min(0).max(1_000_000),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { error } = await context.supabase
      .from("feature_costs")
      .update({ points_cost: data.points_cost })
      .eq("feature_name", data.feature_name);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ---------- LEDGER ----------

export const listLedger = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        company_id: z.string().uuid().optional(),
        limit: z.number().int().min(1).max(500).default(100),
      })
      .parse(input ?? {}),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    let q = context.supabase
      .from("points_ledger")
      .select("id, company_id, job_id, feature_used, points_deducted, note, created_at, companies(name)")
      .order("created_at", { ascending: false })
      .limit(data.limit);
    if (data.company_id) q = q.eq("company_id", data.company_id);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

// ---------- WHOAMI ----------

export const whoAmI = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin.rpc("is_admin", {
      _user_id: context.userId,
    });
    if (error) throw new Error(error.message);
    return { userId: context.userId, isAdmin: !!data };
  });


// ---------- COORDINATOR PROVISIONING ----------

export const createCoordinator = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        company_id: z.string().uuid(),
        email: z.string().trim().email().max(255),
        password: z.string().min(8).max(128),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const email = data.email.toLowerCase();

    // Find or create the auth user with password, email pre-confirmed.
    let userId: string | null = null;
    const { data: created, error: cErr } = await supabaseAdmin.auth.admin.createUser({
      email,
      password: data.password,
      email_confirm: true,
    });
    if (cErr) {
      const msg = cErr.message?.toLowerCase() ?? "";
      if (msg.includes("already") || msg.includes("registered") || msg.includes("exists")) {
        // Look up existing user and update the password.
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

    // Assign as the company's coordinator (owner_user_id).
    const { error: aErr } = await supabaseAdmin
      .from("companies")
      .update({ owner_user_id: userId })
      .eq("id", data.company_id);
    if (aErr) throw new Error(aErr.message);

    return { ok: true, user_id: userId, email };
  });
