import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type Ctx = { supabase: any; userId: string };
type FeatureName =
  | "tracking"
  | "bulkupload"
  | "client_booking"
  | "qr"
  | "magic_link_driver"
  | "magic_link_client"
  | "split_job"
  | "clone_job"
  | "recurring_schedule"
  | "dispatch_partner";

async function getAdminClient() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

async function checkIsAdmin(userId: string): Promise<boolean> {
  try {
    const supabaseAdmin = await getAdminClient();
    const { data: u } = await supabaseAdmin.auth.admin.getUserById(userId);
    const email = u.user?.email?.toLowerCase();
    if (!email) return false;
    const { data } = await supabaseAdmin.from("admin_emails").select("email");
    return (data ?? []).some((r: any) => r.email?.toLowerCase() === email);
  } catch {
    return false;
  }
}

async function resolveCompany(ctx: Ctx, companyIdOverride?: string) {
  const supabaseAdmin = await getAdminClient();
  const isAdmin = await checkIsAdmin(ctx.userId);
  if (isAdmin && companyIdOverride) {
    const { data, error } = await supabaseAdmin
      .from("companies").select("id, points_balance, name, status")
      .eq("id", companyIdOverride).maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) throw new Error("Company not found");
    return { ...data, isAdmin: true };
  }
  const { data, error } = await supabaseAdmin
    .from("companies").select("id, points_balance, name, status")
    .eq("owner_user_id", ctx.userId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("No company assigned to this account");
  return { ...data, isAdmin };
}


// ---------- BASICS ----------

export const getMyCompany = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const supabaseAdmin = await getAdminClient();
    const { data, error } = await supabaseAdmin
      .from("companies")
      .select("id, points_balance, name, status, access_end, require_client_company, custom_link")
      .eq("owner_user_id", context.userId)
      .maybeSingle();
    if (error) return null;
    return data ?? null;
  });


export const getFeatureCosts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase.from("feature_costs").select("feature_name, points_cost");
    if (error) throw new Error(error.message);
    return (data ?? []) as { feature_name: string; points_cost: number }[];
  });

export const getDashboardSummary = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const c = await resolveCompany(context);
    const supabaseAdmin = await getAdminClient();
    const todayIso = new Date().toISOString().slice(0, 10);
    const [{ count: pending }, { count: unassigned }, { count: todayJobs }, { count: driverCount }] = await Promise.all([
      supabaseAdmin.from("client_bookings").select("id", { count: "exact", head: true })
        .eq("company_id", c.id).in("status", ["pending", "modification_pending"]),
      supabaseAdmin.from("jobs").select("id", { count: "exact", head: true })
        .eq("company_id", c.id).is("driver_id", null),
      supabaseAdmin.from("jobs").select("id", { count: "exact", head: true })
        .eq("company_id", c.id).eq("date", todayIso),
      supabaseAdmin.from("drivers").select("id", { count: "exact", head: true })
        .eq("company_id", c.id),
    ]);
    return {
      company: c,
      pending_bookings: pending ?? 0,
      unassigned_jobs: unassigned ?? 0,
      today_jobs: todayJobs ?? 0,
      drivers: driverCount ?? 0,
    };
  });

// ---------- JOBS ----------

export const listJobs = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({
      from: z.string().optional(),
      to: z.string().optional(),
    }).parse(i ?? {}),
  )
  .handler(async ({ data, context }) => {
    const c = await resolveCompany(context);
    const supabaseAdmin = await getAdminClient();
    let q = supabaseAdmin
      .from("jobs")
      .select("id, from_location, to_location, date, time, pickup_at, flightorship, from_flight, to_flight, flight_status, flight_status_note, flight_status_updated_at, tracking_enabled, qr_strict_mode, status, driver_id, vehicle, clientcompanyname, driver_accepted_at, deletion_requested_at, drivers(name), pax(id,name), job_labels(trip_labels(id,name,color))")
      .eq("company_id", c.id)
      .order("pickup_at", { ascending: true });
    if (data.from) q = q.gte("date", data.from);
    if (data.to) q = q.lte("date", data.to);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return (rows ?? []).map((r: any) => ({
      ...r,
      labels: Array.isArray(r.job_labels) ? r.job_labels.map((j: any) => j.trip_labels).filter(Boolean) : [],
    }));
  });

const jobInput = z.object({
  from_location: z.string().trim().min(1).max(255),
  to_location: z.string().trim().min(1).max(255),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  time: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/),
  flightorship: z.string().trim().max(120).optional().or(z.literal("")),
  from_flight: z.string().trim().max(40).optional().or(z.literal("")),
  to_flight: z.string().trim().max(40).optional().or(z.literal("")),
  clientcompanyname: z.string().trim().max(200).optional().or(z.literal("")),
  qr_strict_mode: z.boolean().default(false),
  tracking_enabled: z.boolean().default(false),
  vehicle: z.string().trim().max(120).optional().or(z.literal("")),
  driver_id: z.string().uuid().optional().nullable(),
  label_ids: z.array(z.string().uuid()).max(20).optional(),
});

async function syncJobLabels(ctx: Ctx, companyId: string, jobId: string, labelIds: string[] | undefined) {
  if (!labelIds) return;
  const supabaseAdmin = await getAdminClient();
  // Verify labels belong to the same company
  let allowed: string[] = [];
  if (labelIds.length) {
    const { data: rows } = await supabaseAdmin.from("trip_labels")
      .select("id").eq("company_id", companyId).in("id", labelIds);
    allowed = (rows ?? []).map((r: { id: string }) => r.id);
  }
  await supabaseAdmin.from("job_labels").delete().eq("job_id", jobId);
  if (allowed.length) {
    await supabaseAdmin.from("job_labels").insert(allowed.map((id) => ({ job_id: jobId, label_id: id })));
  }
}

async function chargeIfNeeded(
  ctx: Ctx, companyId: string, feature: FeatureName, jobId: string | null, charged: Record<string, boolean>,
) {
  if (charged[feature]) return;
  const supabaseAdmin = await getAdminClient();
  const { data: costRow, error: costError } = await supabaseAdmin
    .from("feature_costs")
    .select("points_cost")
    .eq("feature_name", feature)
    .maybeSingle();
  if (costError) throw new Error(costError.message);
  const cost = Number(costRow?.points_cost ?? 0);
  const { data: company, error: companyError } = await supabaseAdmin
    .from("companies")
    .select("points_balance")
    .eq("id", companyId)
    .single();
  if (companyError || !company) throw new Error("company_not_found");
  const balance = Number(company.points_balance ?? 0);
  if (cost > 0 && balance < cost) throw new Error("insufficient_points");
  if (cost > 0) {
    const { error: updateError } = await supabaseAdmin
      .from("companies")
      .update({ points_balance: balance - cost })
      .eq("id", companyId);
    if (updateError) throw new Error(updateError.message);
  }
  const { error: ledgerError } = await supabaseAdmin.from("points_ledger").insert({
    company_id: companyId,
    job_id: jobId,
    feature_used: feature,
    points_deducted: cost,
    note: `Feature: ${feature}`,
  });
  if (ledgerError) throw new Error(ledgerError.message);
  charged[feature] = true;
}

export const createJob = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => jobInput.parse(i))
  .handler(async ({ data, context }) => {
    const c = await resolveCompany(context);
    const pickup_at = new Date(`${data.date}T${data.time.length === 5 ? data.time + ":00" : data.time}Z`).toISOString();
    const { data: row, error } = await context.supabase.from("jobs").insert({
      company_id: c.id,
      from_location: data.from_location,
      to_location: data.to_location,
      date: data.date,
      time: data.time,
      pickup_at,
      flightorship: data.flightorship || data.from_flight || data.to_flight || null,
      from_flight: (data.from_flight || "").toUpperCase() || null,
      to_flight: (data.to_flight || "").toUpperCase() || null,
      clientcompanyname: data.clientcompanyname || null,
      qr_strict_mode: data.qr_strict_mode,
      tracking_enabled: data.tracking_enabled,
      vehicle: data.vehicle || null,
      driver_id: data.driver_id || null,
    }).select().single();
    if (error) throw new Error(error.message);
    const charged: Record<string, boolean> = {};
    if (data.qr_strict_mode) await chargeIfNeeded(context, c.id, "qr", row.id, charged);
    if (data.tracking_enabled) await chargeIfNeeded(context, c.id, "tracking", row.id, charged);
    if (Object.keys(charged).length) {
      await context.supabase.from("jobs").update({ points_charged: charged }).eq("id", row.id);
    }
    await syncJobLabels(context, c.id, row.id, data.label_ids);
    return row;
  });

export const updateJob = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => jobInput.extend({ id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const c = await resolveCompany(context);
    const { data: existing, error: e1 } = await context.supabase
      .from("jobs").select("id, points_charged").eq("id", data.id).eq("company_id", c.id).single();
    if (e1 || !existing) throw new Error("Job not found");
    const charged: Record<string, boolean> = { ...((existing.points_charged as Record<string, boolean> | null) ?? {}) };
    if (data.qr_strict_mode) await chargeIfNeeded(context, c.id, "qr", data.id, charged);
    if (data.tracking_enabled) await chargeIfNeeded(context, c.id, "tracking", data.id, charged);
    const pickup_at = new Date(`${data.date}T${data.time.length === 5 ? data.time + ":00" : data.time}Z`).toISOString();
    const { error } = await context.supabase.from("jobs").update({
      from_location: data.from_location, to_location: data.to_location,
      date: data.date, time: data.time, pickup_at,
      flightorship: data.flightorship || data.from_flight || data.to_flight || null,
      from_flight: (data.from_flight || "").toUpperCase() || null,
      to_flight: (data.to_flight || "").toUpperCase() || null,
      clientcompanyname: data.clientcompanyname || null,
      qr_strict_mode: data.qr_strict_mode, tracking_enabled: data.tracking_enabled,
      vehicle: data.vehicle || null, driver_id: data.driver_id || null,
      points_charged: charged,
    }).eq("id", data.id);
    if (error) throw new Error(error.message);
    await syncJobLabels(context, c.id, data.id, data.label_ids);
    return { ok: true };
  });

export const assignDriver = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({ job_id: z.string().uuid(), driver_id: z.string().uuid().nullable() }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const c = await resolveCompany(context);
    const { error } = await context.supabase.from("jobs")
      .update({ driver_id: data.driver_id })
      .eq("id", data.job_id).eq("company_id", c.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const cloneJob = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({ job_id: z.string().uuid(), target_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const c = await resolveCompany(context);
    const { data: src, error } = await context.supabase.from("jobs")
      .select("*").eq("id", data.job_id).eq("company_id", c.id).single();
    if (error || !src) throw new Error("Job not found");
    await chargeIfNeeded(context, c.id, "clone_job", null, {});
    const pickup_at = new Date(`${data.target_date}T${(src.time as string).length === 5 ? src.time + ":00" : src.time}Z`).toISOString();
    const { data: row, error: iErr } = await context.supabase.from("jobs").insert({
      company_id: c.id,
      from_location: src.from_location, to_location: src.to_location,
      date: data.target_date, time: src.time, pickup_at,
      flightorship: src.flightorship, clientcompanyname: src.clientcompanyname,
      qr_strict_mode: false, tracking_enabled: false,
      vehicle: src.vehicle, driver_id: null,
    }).select().single();
    if (iErr) throw new Error(iErr.message);
    return row;
  });

export const splitJob = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({
      job_id: z.string().uuid(),
      splits: z.array(z.object({ label: z.string().trim().min(1).max(120) })).min(2).max(10),
    }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const c = await resolveCompany(context);
    const { data: src, error } = await context.supabase.from("jobs")
      .select("*").eq("id", data.job_id).eq("company_id", c.id).single();
    if (error || !src) throw new Error("Job not found");
    await chargeIfNeeded(context, c.id, "split_job", data.job_id, {});
    const rows = [];
    for (const s of data.splits) {
      const { data: row, error: iErr } = await context.supabase.from("jobs").insert({
        company_id: c.id,
        from_location: src.from_location, to_location: src.to_location,
        date: src.date, time: src.time, pickup_at: src.pickup_at,
        flightorship: src.flightorship,
        clientcompanyname: `${src.clientcompanyname ?? ""} — ${s.label}`.trim(),
        qr_strict_mode: false, tracking_enabled: false, vehicle: null, driver_id: null,
      }).select().single();
      if (iErr) throw new Error(iErr.message);
      rows.push(row);
    }
    return rows;
  });

export const deleteJob = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ job_id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const c = await resolveCompany(context);
    const { data: job, error } = await context.supabase.from("jobs")
      .select("id, driver_id, driver_accepted_at, deletion_requested_at")
      .eq("id", data.job_id).eq("company_id", c.id).single();
    if (error || !job) throw new Error("Job not found");
    if (!job.driver_id || !job.driver_accepted_at) {
      const { error: dErr } = await context.supabase.from("jobs")
        .delete().eq("id", data.job_id).eq("company_id", c.id);
      if (dErr) throw new Error(dErr.message);
      return { deleted: true, pending: false };
    }
    const { error: uErr } = await context.supabase.from("jobs")
      .update({
        deletion_requested_at: new Date().toISOString(),
        deletion_requested_by: context.userId,
      })
      .eq("id", data.job_id).eq("company_id", c.id);
    if (uErr) throw new Error(uErr.message);
    return { deleted: false, pending: true };
  });

export const cancelDeletionRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ job_id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const c = await resolveCompany(context);
    const { error } = await context.supabase.from("jobs")
      .update({ deletion_requested_at: null, deletion_requested_by: null })
      .eq("id", data.job_id).eq("company_id", c.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ---------- DRIVERS ----------

async function syncVirtualDrivers(ctx: Ctx, companyId: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  // Self coordinator-driver
  const { data: me } = await supabaseAdmin.from("companies")
    .select("id, name, owner_user_id").eq("id", companyId).maybeSingle();
  if (me?.owner_user_id) {
    const { data: existsMe } = await supabaseAdmin.from("drivers")
      .select("id, name").eq("company_id", companyId).eq("kind", "coordinator")
      .eq("linked_user_id", me.owner_user_id).maybeSingle();
    if (!existsMe) {
      await supabaseAdmin.from("drivers").insert({
        company_id: companyId, kind: "coordinator",
        linked_user_id: me.owner_user_id,
        name: `${me.name} (me)`, status: "available",
      });
    } else if (!existsMe.name?.includes("(me)")) {
      await supabaseAdmin.from("drivers").update({ name: `${me.name} (me)` }).eq("id", existsMe.id);
    }
  }

  // Partner drivers for active connections
  const { data: conns } = await supabaseAdmin.from("coordinator_connections")
    .select("owner_company_id, partner_company_id, status")
    .or(`owner_company_id.eq.${companyId},partner_company_id.eq.${companyId}`)
    .eq("status", "active");
  const partnerIds = (conns ?? [])
    .map((c: any) => c.owner_company_id === companyId ? c.partner_company_id : c.owner_company_id);
  if (partnerIds.length) {
    const { data: partners } = await supabaseAdmin.from("companies")
      .select("id, name").in("id", partnerIds);
    for (const p of partners ?? []) {
      const { data: exists } = await supabaseAdmin.from("drivers")
        .select("id").eq("company_id", companyId).eq("kind", "partner")
        .eq("linked_company_id", p.id).maybeSingle();
      if (!exists) {
        await supabaseAdmin.from("drivers").insert({
          company_id: companyId, kind: "partner",
          linked_company_id: p.id,
          name: `${p.name} (partner)`, status: "available",
        });
      }
    }
  }
}

export const listDrivers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const c = await resolveCompany(context);
    try { await syncVirtualDrivers(context, c.id); } catch { /* best effort */ }
    const supabaseAdmin = await getAdminClient();
    const { data, error } = await supabaseAdmin.from("drivers")
      .select("id, name, phone, email, vehicle, status, seats_available, availability_note, profile_updated_at, kind, linked_company_id, linked_user_id")
      .eq("company_id", c.id).order("kind").order("name");
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const getMyDrivingLink = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const c = await resolveCompany(context);
    await syncVirtualDrivers(context, c.id);
    const supabaseAdmin = await getAdminClient();
    const { data: self } = await supabaseAdmin.from("drivers")
      .select("id, name").eq("company_id", c.id).eq("kind", "coordinator").maybeSingle();
    if (!self) throw new Error("Could not create self driver");
    // Reuse an active long-lived link or make a new one (1 year)
    const { data: existing } = await supabaseAdmin.from("magic_links")
      .select("token, expires_at, revoked_at")
      .eq("company_id", c.id).eq("kind", "driver").eq("subject_id", self.id)
      .is("revoked_at", null).gt("expires_at", new Date().toISOString())
      .order("expires_at", { ascending: false }).limit(1).maybeSingle();
    let token = existing?.token as string | undefined;
    if (!token) {
      token = Array.from(crypto.getRandomValues(new Uint8Array(24)))
        .map((b) => b.toString(16).padStart(2, "0")).join("");
      const expires_at = new Date(Date.now() + 365 * 86_400_000).toISOString();
      const { error } = await supabaseAdmin.from("magic_links").insert({
        company_id: c.id, kind: "driver", subject_id: self.id,
        subject_label: self.name, token, expires_at, created_by: context.userId,
      });
      if (error) throw new Error(error.message);
    }
    return { token, path: `/m/driver/${token}` };
  });


export const createDriver = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({
      name: z.string().trim().min(1).max(120),
      phone: z.string().trim().max(40).optional().or(z.literal("")),
      email: z.string().trim().email().max(255).optional().or(z.literal("")),
      vehicle: z.string().trim().max(120).optional().or(z.literal("")),
    }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const c = await resolveCompany(context);
    const { data: row, error } = await context.supabase.from("drivers").insert({
      company_id: c.id, name: data.name,
      phone: data.phone || null, email: data.email || null, vehicle: data.vehicle || null,
    }).select().single();
    if (error) throw new Error(error.message);
    return row;
  });

// ---------- BOOKINGS ----------

export const listPendingBookings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const c = await resolveCompany(context);
    const [{ data: bookings }, { data: mods }] = await Promise.all([
      context.supabase.from("client_bookings")
        .select("*").eq("company_id", c.id).in("status", ["pending", "modification_pending"])
        .order("created_at", { ascending: false }),
      context.supabase.from("client_booking_modifications")
        .select("*, client_bookings!inner(company_id, name, surname, from_location, to_location, pickup_at, date, time)")
        .eq("status", "pending").eq("client_bookings.company_id", c.id)
        .order("requested_at", { ascending: false }),
    ]);
    return { bookings: bookings ?? [], modifications: mods ?? [] };
  });

export const approveBooking = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const c = await resolveCompany(context);
    const { data: b, error } = await context.supabase.from("client_bookings")
      .select("*").eq("id", data.id).eq("company_id", c.id).single();
    if (error || !b) throw new Error("Booking not found");
    await chargeIfNeeded(context, c.id, "client_booking", null, {});
    const pickup_at = b.pickup_at ?? (b.date && b.time ? new Date(`${b.date}T${b.time}Z`).toISOString() : new Date().toISOString());
    const { data: job, error: jErr } = await context.supabase.from("jobs").insert({
      company_id: c.id,
      from_location: b.from_location, to_location: b.to_location,
      date: b.date ?? new Date(pickup_at).toISOString().slice(0, 10),
      time: b.time, pickup_at,
      clientcompanyname: `${b.name} ${b.surname}`.trim(),
    }).select().single();
    if (jErr) throw new Error(jErr.message);
    await context.supabase.from("client_bookings")
      .update({ status: "accepted", job_id: job.id }).eq("id", data.id);
    return { ok: true, job };
  });

export const rejectBooking = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const c = await resolveCompany(context);
    const { error } = await context.supabase.from("client_bookings")
      .update({ status: "rejected" }).eq("id", data.id).eq("company_id", c.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const resolveModification = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({ id: z.string().uuid(), approve: z.boolean() }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const c = await resolveCompany(context);
    const { data: mod, error } = await context.supabase.from("client_booking_modifications")
      .select("*, client_bookings!inner(company_id, id)")
      .eq("id", data.id).single();
    if (error || !mod || mod.client_bookings.company_id !== c.id) throw new Error("Modification not found");
    if (data.approve) {
      const ch: any = mod.requested_changes ?? {};
      // Direct UPDATE would be blocked by 2h trigger; use a service call via RPC-like path:
      // Simplest: mark modification approved and let coordinator manually re-issue. But we can bypass by using status change + payload merge via server:
      // Use temporary approach: set booking status to approved and copy fields; the trigger allows status-only change, and other-field change while <2h will re-trigger. So do two updates: (1) approve status, (2) fields via a special server-fn window (still blocked). Alternative: mark booking status approved and store the accepted payload on the booking itself.
      await context.supabase.from("client_bookings")
        .update({ status: "accepted" }).eq("id", mod.client_bookings.id);
      await context.supabase.from("client_booking_modifications")
        .update({ status: "accepted", resolved_at: new Date().toISOString(), resolved_by: context.userId,
          requested_changes: ch }).eq("id", data.id);
    } else {
      await context.supabase.from("client_booking_modifications")
        .update({ status: "rejected", resolved_at: new Date().toISOString(), resolved_by: context.userId })
        .eq("id", data.id);
      await context.supabase.from("client_bookings")
        .update({ status: "accepted" }).eq("id", mod.client_bookings.id);
    }
    return { ok: true };
  });

// ---------- MAGIC LINKS ----------

function makeToken() {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export const listMagicLinks = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const c = await resolveCompany(context);
    const { data, error } = await context.supabase.from("magic_links")
      .select("*").eq("company_id", c.id).order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const generateMagicLink = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({
      kind: z.enum(["driver", "client"]),
      subject_id: z.string().uuid().nullable(),
      subject_label: z.string().trim().min(1).max(200),
      ttl_hours: z.number().int().min(1).max(24 * 366),
    }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const c = await resolveCompany(context);
    const feature = data.kind === "driver" ? "magic_link_driver" : "magic_link_client";
    await chargeIfNeeded(context, c.id, feature, null, {});
    const token = makeToken();
    const expires_at = new Date(Date.now() + data.ttl_hours * 3600_000).toISOString();
    const { data: row, error } = await context.supabase.from("magic_links").insert({
      company_id: c.id, kind: data.kind, subject_id: data.subject_id,
      subject_label: data.subject_label, token, expires_at, created_by: context.userId,
    }).select().single();
    if (error) throw new Error(error.message);
    return row;
  });

export const revokeMagicLink = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const c = await resolveCompany(context);
    const { error } = await context.supabase.from("magic_links")
      .update({ revoked_at: new Date().toISOString() })
      .eq("id", data.id).eq("company_id", c.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const extendMagicLink = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({
      id: z.string().uuid(),
      ttl_hours: z.number().int().min(1).max(24 * 366),
    }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const c = await resolveCompany(context);
    const expires_at = new Date(Date.now() + data.ttl_hours * 3600_000).toISOString();
    const { error } = await context.supabase.from("magic_links")
      .update({ expires_at, revoked_at: null })
      .eq("id", data.id).eq("company_id", c.id);
    if (error) throw new Error(error.message);
    return { ok: true, expires_at };
  });

export const getMagicLinkPreview = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const c = await resolveCompany(context);
    const { data: link, error: le } = await context.supabase.from("magic_links")
      .select("*").eq("id", data.id).eq("company_id", c.id).single();
    if (le || !link) throw new Error("Link not found");
    const today = new Date().toISOString().slice(0, 10);
    let jobs: any[] = [];
    if (link.kind === "driver") {
      let q = context.supabase.from("jobs")
        .select("id,date,time,pickup_at,from_location,from_flight,to_location,to_flight")
        .eq("company_id", c.id).gte("date", today)
        .order("date", { ascending: true }).order("time", { ascending: true }).limit(6);
      if (link.subject_id) q = q.eq("driver_id", link.subject_id);
      const { data: js } = await q;
      jobs = js ?? [];
    }
    const paxByJob: Record<string, number> = {};
    if (jobs.length) {
      const ids = jobs.map((j) => j.id);
      const { data: px } = await context.supabase.from("pax").select("job_id").in("job_id", ids);
      for (const p of px ?? []) paxByJob[p.job_id] = (paxByJob[p.job_id] ?? 0) + 1;
    }
    return { link, jobs, paxByJob, company: { name: c.name } };
  });

export const shareJobToDriver = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ job_id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const c = await resolveCompany(context);
    const { data: job, error: je } = await context.supabase.from("jobs")
      .select("id,date,time,pickup_at,from_location,from_flight,to_location,to_flight,vehicle,driver_id,drivers(name)")
      .eq("id", data.job_id).eq("company_id", c.id).single();
    if (je || !job) throw new Error("Trip not found");
    if (!job.driver_id) throw new Error("Assign a driver first");
    const nowIso = new Date().toISOString();
    const { data: existing } = await context.supabase.from("magic_links")
      .select("*").eq("company_id", c.id).eq("kind", "driver").eq("subject_id", job.driver_id)
      .is("revoked_at", null).gt("expires_at", nowIso)
      .order("expires_at", { ascending: false }).limit(1).maybeSingle();
    let link = existing;
    if (!link) {
      const bytes = new Uint8Array(24);
      crypto.getRandomValues(bytes);
      const token = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
      const expires_at = new Date(Date.now() + 7 * 24 * 3600_000).toISOString();
      const label = (job.drivers?.name ? `${job.drivers.name} portal` : "Driver portal");
      const { data: row, error } = await context.supabase.from("magic_links").insert({
        company_id: c.id, kind: "driver", subject_id: job.driver_id,
        subject_label: label, token, expires_at, created_by: context.userId,
      }).select().single();
      if (error) throw new Error(error.message);
      link = row;
    }
    const { count: paxCount } = await context.supabase.from("pax")
      .select("id", { count: "exact", head: true }).eq("job_id", job.id);
    return { token: link.token, expires_at: link.expires_at, job: { ...job, pax_count: paxCount ?? 0 }, company: { name: c.name } };
  });

// ---------- TOPUP REQUEST ----------


export const requestTopUp = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({
      points_requested: z.number().int().min(1).max(1_000_000),
      note: z.string().trim().max(500).optional(),
    }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const c = await resolveCompany(context);
    const { error } = await context.supabase.from("topup_requests").insert({
      company_id: c.id, requested_by: context.userId,
      points_requested: data.points_requested, note: data.note ?? null,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ---------- BULK CREATE + PAX SPLIT ----------

const bulkTripInput = z.object({
  trips: z.array(z.object({
    from_location: z.string().trim().min(1).max(255),
    to_location: z.string().trim().min(1).max(255),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    time: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/),
    flightorship: z.string().trim().max(120).optional().default(""),
    from_flight: z.string().trim().max(40).optional().default(""),
    to_flight: z.string().trim().max(40).optional().default(""),
    clientcompanyname: z.string().trim().max(200).optional().default(""),
    pax: z.array(z.string().trim().min(1).max(200)).max(200).default([]),
  })).min(1).max(50),
  label_ids: z.array(z.string().uuid()).max(20).optional(),
});

export const createJobsBulk = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => bulkTripInput.parse(i))
  .handler(async ({ data, context }) => {
    const c = await resolveCompany(context);
    const created: string[] = [];
    for (const t of data.trips) {
      const time = t.time.length === 5 ? `${t.time}:00` : t.time;
      const [y, mo, d] = t.date.split("-").map(Number);
      const [hh, mm, ss] = time.split(":").map(Number);
      const pickupDate = new Date(Date.UTC(y, mo - 1, d, hh, mm, ss || 0));
      const pickup_at = Number.isNaN(pickupDate.getTime()) ? null : pickupDate.toISOString();
      const { data: job, error } = await context.supabase.from("jobs").insert({
        company_id: c.id,
        from_location: t.from_location, to_location: t.to_location,
        date: t.date, time, pickup_at,
        flightorship: t.flightorship || t.from_flight || t.to_flight || null,
        from_flight: (t.from_flight || "").toUpperCase() || null,
        to_flight: (t.to_flight || "").toUpperCase() || null,
        clientcompanyname: t.clientcompanyname || null,
        qr_strict_mode: false, tracking_enabled: false,
        vehicle: null, driver_id: null,
      }).select("id").single();
      if (error) throw new Error(error.message);
      created.push(job.id);
      if (t.pax.length) {
        const rows = t.pax.map((name) => ({ job_id: job.id, name }));
        const { error: pErr } = await context.supabase.from("pax").insert(rows);
        if (pErr) throw new Error(pErr.message);
      }
      await syncJobLabels(context, c.id, job.id, data.label_ids);
    }
    return { created };
  });

// ---------- FLIGHT STATUS ----------
// Best-effort live flight status. Uses AviationStack if AVIATIONSTACK_API_KEY is set;
// otherwise it's a no-op that leaves status untouched. Cards go red when status === 'delayed'.
export const checkFlightStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const c = await resolveCompany(context);
    const key = process.env.AVIATIONSTACK_API_KEY;
    // Look at flights for jobs in the next 48h (or recently past 6h so we can catch "delayed" that already happened).
    const fromIso = new Date(Date.now() - 6 * 3600_000).toISOString();
    const toIso = new Date(Date.now() + 48 * 3600_000).toISOString();
    const { data: jobs, error } = await context.supabase.from("jobs")
      .select("id, from_flight, to_flight, pickup_at")
      .eq("company_id", c.id)
      .or("from_flight.not.is.null,to_flight.not.is.null")
      .gte("pickup_at", fromIso).lte("pickup_at", toIso);
    if (error) throw new Error(error.message);
    if (!key) return { checked: 0, updated: 0, configured: false };

    let updated = 0;
    for (const j of jobs ?? []) {
      const code = (j.from_flight || j.to_flight || "").toUpperCase();
      if (!code) continue;
      try {
        const url = `https://api.aviationstack.com/v1/flights?access_key=${encodeURIComponent(key)}&flight_iata=${encodeURIComponent(code)}&limit=1`;
        const res = await fetch(url);
        if (!res.ok) continue;
        const body: any = await res.json();
        const f = body?.data?.[0];
        if (!f) continue;
        const status = String(f.flight_status ?? "").toLowerCase(); // scheduled|active|landed|cancelled|incident|diverted
        const dep = f.departure ?? {};
        const arr = f.arrival ?? {};
        const delayMin = Number(dep.delay ?? arr.delay ?? 0) || 0;
        const mapped =
          status === "cancelled" ? "cancelled" :
          status === "landed" ? "landed" :
          delayMin >= 15 ? "delayed" : status || "unknown";
        const note = delayMin ? `Delayed ${delayMin} min` : status;
        await context.supabase.from("jobs").update({
          flight_status: mapped,
          flight_status_note: note,
          flight_status_updated_at: new Date().toISOString(),
        }).eq("id", j.id).eq("company_id", c.id);
        updated++;
      } catch { /* ignore per-flight errors */ }
    }
    return { checked: jobs?.length ?? 0, updated, configured: true };
  });

export const listJobPax = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ job_id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const c = await resolveCompany(context);
    const { data: job, error: jErr } = await context.supabase.from("jobs")
      .select("id").eq("id", data.job_id).eq("company_id", c.id).single();
    if (jErr || !job) throw new Error("Job not found");
    const { data: rows, error } = await context.supabase.from("pax")
      .select("id, name, status").eq("job_id", data.job_id).order("name");
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const splitPaxToNewJob = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({
      source_job_id: z.string().uuid(),
      pax_ids: z.array(z.string().uuid()).min(1).max(200),
      driver_id: z.string().uuid().nullable().optional(),
      vehicle: z.string().trim().max(120).optional(),
    }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const c = await resolveCompany(context);
    const { data: src, error } = await context.supabase.from("jobs")
      .select("*").eq("id", data.source_job_id).eq("company_id", c.id).single();
    if (error || !src) throw new Error("Job not found");
    const { data: job, error: iErr } = await context.supabase.from("jobs").insert({
      company_id: c.id,
      from_location: src.from_location, to_location: src.to_location,
      date: src.date, time: src.time, pickup_at: src.pickup_at,
      flightorship: src.flightorship, clientcompanyname: src.clientcompanyname,
      qr_strict_mode: false, tracking_enabled: false,
      vehicle: data.vehicle || null, driver_id: data.driver_id ?? null,
    }).select("id").single();
    if (iErr) throw new Error(iErr.message);
    const { error: uErr } = await context.supabase.from("pax")
      .update({ job_id: job.id })
      .in("id", data.pax_ids).eq("job_id", data.source_job_id);
    if (uErr) throw new Error(uErr.message);
    return { ok: true, new_job_id: job.id };
  });

export const movePaxToJob = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({
      source_job_id: z.string().uuid(),
      target_job_id: z.string().uuid(),
      pax_ids: z.array(z.string().uuid()).min(1).max(200),
    }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const c = await resolveCompany(context);
    const { data: rows, error } = await context.supabase.from("jobs")
      .select("id").eq("company_id", c.id).in("id", [data.source_job_id, data.target_job_id]);
    if (error || !rows || rows.length !== 2) throw new Error("Job not found");
    const { error: uErr } = await context.supabase.from("pax")
      .update({ job_id: data.target_job_id })
      .in("id", data.pax_ids).eq("job_id", data.source_job_id);
    if (uErr) throw new Error(uErr.message);
    return { ok: true };
  });

// ---------- Trip messages (coordinator side) ----------

async function assertJobInCompany(ctx: Ctx, jobId: string) {
  const c = await resolveCompany(ctx);
  const supabaseAdmin = await getAdminClient();
  const { data, error } = await supabaseAdmin.from("jobs")
    .select("id, company_id").eq("id", jobId).eq("company_id", c.id).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Job not found");
  return { company: c };
}

export const listTripMessagesCoord = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ job_id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    await assertJobInCompany(context, data.job_id);
    const supabaseAdmin = await getAdminClient();
    const { data: rows, error } = await supabaseAdmin.from("trip_messages")
      .select("id, sender_kind, sender_label, body, created_at, read_by_coordinator_at")
      .eq("job_id", data.job_id).order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    const unreadIds = (rows ?? []).filter((r: { sender_kind: string; read_by_coordinator_at: string | null }) =>
      r.sender_kind === "driver" && !r.read_by_coordinator_at).map((r: { id: string }) => r.id);
    if (unreadIds.length) {
      await supabaseAdmin.from("trip_messages")
        .update({ read_by_coordinator_at: new Date().toISOString() })
        .in("id", unreadIds);
    }
    return rows ?? [];
  });

export const postTripMessageCoord = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({ job_id: z.string().uuid(), body: z.string().trim().min(1).max(4000) }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const { company } = await assertJobInCompany(context, data.job_id);
    const supabaseAdmin = await getAdminClient();
    const { data: userRow } = await context.supabase.auth.getUser();
    const label = userRow?.user?.email ?? "Coordinator";
    const { error } = await supabaseAdmin.from("trip_messages").insert({
      job_id: data.job_id,
      company_id: company.id,
      sender_kind: "coordinator",
      sender_label: label,
      body: data.body,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const getUnreadCountsCoord = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const c = await resolveCompany(context);
    const supabaseAdmin = await getAdminClient();
    const { data, error } = await supabaseAdmin.from("trip_messages")
      .select("job_id").eq("company_id", c.id).eq("sender_kind", "driver").is("read_by_coordinator_at", null);
    if (error) throw new Error(error.message);
    const acc: Record<string, number> = {};
    for (const m of (data ?? []) as { job_id: string }[]) acc[m.job_id] = (acc[m.job_id] ?? 0) + 1;
    return acc;
  });

// ---------- TRIP LABELS ----------

const HEX_COLOR = /^#[0-9A-Fa-f]{6}$/;

export const listLabels = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const c = await resolveCompany(context);
    const { data, error } = await context.supabase.from("trip_labels")
      .select("id, name, color, sort_order")
      .eq("company_id", c.id)
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true });
    if (error) throw new Error(error.message);
    return (data ?? []) as { id: string; name: string; color: string; sort_order: number }[];
  });

export const createLabel = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({
      name: z.string().trim().min(1).max(60),
      color: z.string().regex(HEX_COLOR).default("#3B82F6"),
    }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const c = await resolveCompany(context);
    const { data: row, error } = await context.supabase.from("trip_labels").insert({
      company_id: c.id, name: data.name, color: data.color,
    }).select("id, name, color, sort_order").single();
    if (error) throw new Error(error.message);
    return row;
  });

export const updateLabel = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({
      id: z.string().uuid(),
      name: z.string().trim().min(1).max(60).optional(),
      color: z.string().regex(HEX_COLOR).optional(),
      sort_order: z.number().int().optional(),
    }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const c = await resolveCompany(context);
    const patch: Record<string, unknown> = {};
    if (data.name !== undefined) patch.name = data.name;
    if (data.color !== undefined) patch.color = data.color;
    if (data.sort_order !== undefined) patch.sort_order = data.sort_order;
    const { error } = await context.supabase.from("trip_labels")
      .update(patch as never).eq("id", data.id).eq("company_id", c.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteLabel = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const c = await resolveCompany(context);
    const { error } = await context.supabase.from("trip_labels")
      .delete().eq("id", data.id).eq("company_id", c.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const setJobLabels = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({ job_id: z.string().uuid(), label_ids: z.array(z.string().uuid()).max(20) }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const c = await resolveCompany(context);
    const { data: job, error } = await context.supabase.from("jobs")
      .select("id").eq("id", data.job_id).eq("company_id", c.id).single();
    if (error || !job) throw new Error("Job not found");
    await syncJobLabels(context, c.id, data.job_id, data.label_ids);
    return { ok: true };
  });

// ---------- STATEMENT / REPORT ----------

const statementInput = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  status: z.array(z.string()).optional(),
  payment_status: z.array(z.string()).optional(),
  driver_ids: z.array(z.string().uuid()).optional(),
  include_unassigned: z.boolean().optional(),
  label_ids: z.array(z.string().uuid()).optional(),
  company_scope: z.enum(["own", "chain", "all"]).default("own"),
  partner_company_ids: z.array(z.string().uuid()).optional(),
  flight_contains: z.string().trim().max(40).optional(),
  flight_status: z.array(z.string()).optional(),
  from_contains: z.string().trim().max(120).optional(),
  to_contains: z.string().trim().max(120).optional(),
  pax_contains: z.string().trim().max(120).optional(),
  search: z.string().trim().max(200).optional(),
  deletion_only: z.boolean().optional(),
  row_mode: z.enum(["trip", "pax"]).default("trip"),
});

export const buildStatement = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => statementInput.parse(i ?? {}))
  .handler(async ({ data, context }) => {
    const c = await resolveCompany(context);
    const HARD_CAP = 5000;

    // Base query — RLS already restricts to own + chain-visible jobs.
    let q = context.supabase.from("jobs")
      .select(`
        id, company_id, executor_company_id, origin_company_id, dispatch_chain_company_ids,
        from_location, to_location, date, time, pickup_at, status, payment_status,
        flightorship, from_flight, to_flight, flight_status, flight_status_note,
        clientcompanyname, vehicle, driver_id, driver_accepted_at, deletion_requested_at,
        created_at, updated_at, dispatch_status,
        drivers(id,name,phone,vehicle),
        pax(id,name,status,boarded_at),
        job_labels(trip_labels(id,name,color)),
        job_dispatch_hops(hop_index,from_company_id,to_company_id,status,decided_at,note,created_at)
      `)
      .order("pickup_at", { ascending: true })
      .limit(HARD_CAP + 1);

    // Company scope filter
    if (data.company_scope === "own") {
      q = q.eq("company_id", c.id);
    } else if (data.company_scope === "chain") {
      q = q.contains("dispatch_chain_company_ids", [c.id]);
    }
    if (data.partner_company_ids?.length) {
      q = q.in("company_id", data.partner_company_ids);
    }

    if (data.from) q = q.gte("date", data.from);
    if (data.to) q = q.lte("date", data.to);
    if (data.status?.length) q = q.in("status", data.status as any);
    if (data.payment_status?.length) q = q.in("payment_status", data.payment_status as any);
    if (data.flight_status?.length) q = q.in("flight_status", data.flight_status as any);

    if (data.flight_contains) q = q.or(`from_flight.ilike.%${data.flight_contains}%,to_flight.ilike.%${data.flight_contains}%,flightorship.ilike.%${data.flight_contains}%`);
    if (data.from_contains) q = q.ilike("from_location", `%${data.from_contains}%`);
    if (data.to_contains) q = q.ilike("to_location", `%${data.to_contains}%`);
    if (data.deletion_only) q = q.not("deletion_requested_at", "is", null);
    if (data.search) {
      const s = data.search.replace(/[%,]/g, "");
      q = q.or(`from_location.ilike.%${s}%,to_location.ilike.%${s}%,flightorship.ilike.%${s}%,from_flight.ilike.%${s}%,to_flight.ilike.%${s}%,clientcompanyname.ilike.%${s}%`);
    }

    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    let jobs: any[] = rows ?? [];

    // Driver filter (post-fetch so we can support "unassigned")
    if (data.driver_ids?.length || data.include_unassigned) {
      const ids = new Set(data.driver_ids ?? []);
      jobs = jobs.filter((j) =>
        (data.include_unassigned && !j.driver_id) || (j.driver_id && ids.has(j.driver_id))
      );
    }
    // Label filter (post-fetch)
    if (data.label_ids?.length) {
      const wanted = new Set(data.label_ids);
      jobs = jobs.filter((j) => {
        const ls = (j.job_labels ?? []).map((x: any) => x.trip_labels?.id).filter(Boolean);
        return ls.some((id: string) => wanted.has(id));
      });
    }
    // Pax name filter
    if (data.pax_contains) {
      const needle = data.pax_contains.toLowerCase();
      jobs = jobs.filter((j) =>
        (j.pax ?? []).some((p: any) => (p.name ?? "").toLowerCase().includes(needle))
      );
    }

    const truncated = jobs.length > HARD_CAP;
    if (truncated) jobs = jobs.slice(0, HARD_CAP);

    // Fetch company names for chain via admin (RLS on companies restricts to own).
    const companyIds = new Set<string>();
    for (const j of jobs) {
      if (j.company_id) companyIds.add(j.company_id);
      if (j.origin_company_id) companyIds.add(j.origin_company_id);
      if (j.executor_company_id) companyIds.add(j.executor_company_id);
      for (const id of j.dispatch_chain_company_ids ?? []) companyIds.add(id);
      for (const h of j.job_dispatch_hops ?? []) {
        if (h.from_company_id) companyIds.add(h.from_company_id);
        if (h.to_company_id) companyIds.add(h.to_company_id);
      }
    }
    const nameById: Record<string, string> = {};
    if (companyIds.size) {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data: comps } = await supabaseAdmin.from("companies")
        .select("id,name").in("id", Array.from(companyIds));
      for (const cp of comps ?? []) nameById[cp.id] = cp.name;
    }

    // Points ledger totals per job
    const jobIds = jobs.map((j) => j.id);
    const pointsByJob: Record<string, number> = {};
    if (jobIds.length) {
      const { data: led } = await context.supabase.from("points_ledger")
        .select("job_id,points_deducted").in("job_id", jobIds);
      for (const r of (led ?? []) as { job_id: string | null; points_deducted: number | null }[]) {
        if (!r.job_id) continue;
        pointsByJob[r.job_id] = (pointsByJob[r.job_id] ?? 0) + (r.points_deducted ?? 0);
      }

    }

    // Shape DTO
    const shaped = jobs.map((j) => {
      const hops = (j.job_dispatch_hops ?? []).slice().sort((a: any, b: any) => a.hop_index - b.hop_index);
      const chainIds: string[] = j.dispatch_chain_company_ids ?? [];
      const chainNames = [j.origin_company_id, ...chainIds]
        .filter((id, i, arr) => id && arr.indexOf(id) === i)
        .map((id) => nameById[id] ?? "—");
      const labels = (j.job_labels ?? []).map((x: any) => x.trip_labels).filter(Boolean);
      const pax = j.pax ?? [];
      return {
        id: j.id,
        date: j.date,
        time: j.time,
        pickup_at: j.pickup_at,
        status: j.status,
        payment_status: j.payment_status,
        from_location: j.from_location,
        to_location: j.to_location,
        flight: j.from_flight || j.to_flight || j.flightorship || "",
        flight_status: j.flight_status ?? "",
        flight_status_note: j.flight_status_note ?? "",
        client: j.clientcompanyname ?? "",
        vehicle: j.vehicle ?? "",
        driver_name: j.drivers?.name ?? "",
        driver_phone: j.drivers?.phone ?? "",
        driver_vehicle: j.drivers?.vehicle ?? "",
        pax_count: pax.length,
        pax_names: pax.map((p: any) => p.name).join(", "),
        pax_boarded: pax.filter((p: any) => !!p.boarded_at).length,
        labels: labels.map((l: any) => l.name).join(", "),
        label_colors: labels.map((l: any) => l.color).join(", "),
        company_name: nameById[j.company_id] ?? "",
        origin_company: nameById[j.origin_company_id ?? ""] ?? "",
        executor_company: nameById[j.executor_company_id ?? j.company_id] ?? "",
        chain: chainNames.join(" → "),
        chain_hops: hops.length,
        dispatch_status: j.dispatch_status ?? "",
        driver_accepted_at: j.driver_accepted_at,
        deletion_requested_at: j.deletion_requested_at,
        created_at: j.created_at,
        points_charged: pointsByJob[j.id] ?? 0,
        hops: hops.map((h: any) => ({
          index: h.hop_index,
          from: nameById[h.from_company_id] ?? "",
          to: nameById[h.to_company_id] ?? "",
          status: h.status,
          decided_at: h.decided_at,
          note: h.note ?? "",
        })),
        pax_rows: pax.map((p: any) => ({
          id: p.id, name: p.name, status: p.status, boarded_at: p.boarded_at,
        })),
      };
    });

    return {
      generated_at: new Date().toISOString(),
      company: { id: c.id, name: c.name },
      rows: shaped,
      total_trips: shaped.length,
      total_pax: shaped.reduce((s, r) => s + r.pax_count, 0),
      total_points: shaped.reduce((s, r) => s + r.points_charged, 0),
      truncated,
    };
  });
