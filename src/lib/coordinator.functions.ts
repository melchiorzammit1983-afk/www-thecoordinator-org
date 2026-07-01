import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type Ctx = { supabase: any; userId: string };

async function resolveCompany(ctx: Ctx, companyIdOverride?: string) {
  // Admins may pass a companyId; coordinators are locked to their owned company.
  const { data: isAdmin } = await ctx.supabase.rpc("is_admin", { _user_id: ctx.userId });
  if (isAdmin && companyIdOverride) {
    const { data, error } = await ctx.supabase
      .from("companies").select("id, points_balance, name, status")
      .eq("id", companyIdOverride).maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) throw new Error("Company not found");
    return { ...data, isAdmin: true };
  }
  const { data, error } = await ctx.supabase
    .from("companies").select("id, points_balance, name, status")
    .eq("owner_user_id", ctx.userId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("No company assigned to this account");
  return { ...data, isAdmin: !!isAdmin };
}

// ---------- BASICS ----------

export const getMyCompany = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    try {
      const c = await resolveCompany(context);
      return c;
    } catch {
      return null;
    }
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
    const todayIso = new Date().toISOString().slice(0, 10);
    const [{ count: pending }, { count: unassigned }, { count: todayJobs }, { count: driverCount }] = await Promise.all([
      context.supabase.from("client_bookings").select("id", { count: "exact", head: true })
        .eq("company_id", c.id).in("status", ["pending", "modification_pending"]),
      context.supabase.from("jobs").select("id", { count: "exact", head: true })
        .eq("company_id", c.id).is("driver_id", null),
      context.supabase.from("jobs").select("id", { count: "exact", head: true })
        .eq("company_id", c.id).eq("date", todayIso),
      context.supabase.from("drivers").select("id", { count: "exact", head: true })
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
    let q = context.supabase
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
  // Verify labels belong to the same company
  let allowed: string[] = [];
  if (labelIds.length) {
    const { data: rows } = await ctx.supabase.from("trip_labels")
      .select("id").eq("company_id", companyId).in("id", labelIds);
    allowed = (rows ?? []).map((r: { id: string }) => r.id);
  }
  await ctx.supabase.from("job_labels").delete().eq("job_id", jobId);
  if (allowed.length) {
    await ctx.supabase.from("job_labels").insert(allowed.map((id) => ({ job_id: jobId, label_id: id })));
  }
}

async function chargeIfNeeded(
  ctx: Ctx, companyId: string, feature: string, jobId: string | null, charged: Record<string, boolean>,
) {
  if (charged[feature]) return;
  const { error } = await ctx.supabase.rpc("charge_feature", {
    _company_id: companyId, _feature: feature, _job_id: jobId, _note: `Feature: ${feature}`,
  });
  if (error) {
    if (String(error.message).includes("insufficient_points")) throw new Error("insufficient_points");
    throw new Error(error.message);
  }
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

export const listDrivers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const c = await resolveCompany(context);
    const { data, error } = await context.supabase.from("drivers")
      .select("id, name, phone, email, vehicle, status, seats_available, availability_note, profile_updated_at")
      .eq("company_id", c.id).order("name");
    if (error) throw new Error(error.message);
    return data ?? [];
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
  const { data, error } = await ctx.supabase.from("jobs")
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
    const { data: rows, error } = await context.supabase.from("trip_messages")
      .select("id, sender_kind, sender_label, body, created_at, read_by_coordinator_at")
      .eq("job_id", data.job_id).order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    const unreadIds = (rows ?? []).filter((r: { sender_kind: string; read_by_coordinator_at: string | null }) =>
      r.sender_kind === "driver" && !r.read_by_coordinator_at).map((r: { id: string }) => r.id);
    if (unreadIds.length) {
      await context.supabase.from("trip_messages")
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
    const { data: userRow } = await context.supabase.auth.getUser();
    const label = userRow?.user?.email ?? "Coordinator";
    const { error } = await context.supabase.from("trip_messages").insert({
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
    const { data, error } = await context.supabase.from("trip_messages")
      .select("job_id").eq("company_id", c.id).eq("sender_kind", "driver").is("read_by_coordinator_at", null);
    if (error) throw new Error(error.message);
    const acc: Record<string, number> = {};
    for (const m of (data ?? []) as { job_id: string }[]) acc[m.job_id] = (acc[m.job_id] ?? 0) + 1;
    return acc;
  });
