import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type Ctx = { supabase: any; userId: string };

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

function makePickupIso(date: string, time: string) {
  const normalizedTime = time.length === 5 ? `${time}:00` : time;
  const [y, mo, d] = date.split("-").map(Number);
  const [hh, mm, ss] = normalizedTime.split(":").map(Number);
  const pickup = new Date(Date.UTC(y, mo - 1, d, hh, mm, ss || 0));
  const valid =
    !Number.isNaN(pickup.getTime()) &&
    pickup.getUTCFullYear() === y &&
    pickup.getUTCMonth() === mo - 1 &&
    pickup.getUTCDate() === d &&
    pickup.getUTCHours() === hh &&
    pickup.getUTCMinutes() === mm &&
    pickup.getUTCSeconds() === (ss || 0);
  if (!valid) throw new Error("Invalid pickup date or time");
  return pickup.toISOString();
}

async function resolveCompany(ctx: Ctx, companyIdOverride?: string) {
  const supabaseAdmin = await getAdminClient();
  const isAdmin = await checkIsAdmin(ctx.userId);
  if (isAdmin && companyIdOverride) {
    const { data, error } = await supabaseAdmin
      .from("companies").select("id, name, status")
      .eq("id", companyIdOverride).maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) throw new Error("Company not found");
    return { ...data, isAdmin: true };
  }
  const { data, error } = await supabaseAdmin
    .from("companies").select("id, name, status")
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
      .select("id, name, status, access_end, require_client_company, custom_link")
      .eq("owner_user_id", context.userId)
      .maybeSingle();
    if (error) return null;
    return data ?? null;
  });


export const getMyFeatures = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const supabaseAdmin = await getAdminClient();
    const { FEATURE_KEYS } = await import("@/lib/features");
    const { data: co } = await supabaseAdmin
      .from("companies").select("id").eq("owner_user_id", context.userId).maybeSingle();
    const features: Record<string, boolean> = {};
    for (const k of FEATURE_KEYS) features[k] = true;
    if (!co) return features;
    const { data: rows } = await supabaseAdmin
      .from("company_feature_entitlements")
      .select("feature, enabled, expires_at")
      .eq("company_id", co.id);
    const now = Date.now();
    for (const r of rows ?? []) {
      const expired = r.expires_at ? new Date(r.expires_at).getTime() <= now : false;
      features[r.feature as string] = !!r.enabled && !expired;
    }
    return features;
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
    try { await syncVirtualDrivers(context, c.id); } catch { /* best effort */ }
    const supabaseAdmin = await getAdminClient();
    const cols = "id, company_id, executor_company_id, dispatch_chain_company_ids, from_location, to_location, date, time, pickup_at, flightorship, from_flight, to_flight, flight_status, flight_status_note, flight_status_updated_at, flight_scheduled_at, flight_estimated_at, tracking_enabled, qr_strict_mode, status, driver_id, vehicle, contact_phone, clientcompanyname, driver_accepted_at, deletion_requested_at, payment_status, drivers(name,vehicle,phone,seats_available,availability_note), pax(id,name,status,boarded_at), job_labels(trip_labels(id,name,color))";

    let mineQ = supabaseAdmin.from("jobs").select(cols)
      .eq("company_id", c.id).order("pickup_at", { ascending: true });
    if (data.from) mineQ = mineQ.gte("date", data.from);
    if (data.to) mineQ = mineQ.lte("date", data.to);

    let outQ = supabaseAdmin.from("jobs").select(cols + ", executor:executor_company_id(id,name)")
      .contains("dispatch_chain_company_ids", [c.id])
      .neq("company_id", c.id)
      .not("status", "in", "(completed,cancelled)")
      .order("pickup_at", { ascending: true });
    if (data.from) outQ = outQ.gte("date", data.from);
    if (data.to) outQ = outQ.lte("date", data.to);

    const [mineRes, outRes, partnersRes] = await Promise.all([
      mineQ,
      outQ,
      supabaseAdmin.from("drivers")
        .select("id, linked_company_id")
        .eq("company_id", c.id).eq("kind", "partner"),
    ]);
    if (mineRes.error) throw new Error(mineRes.error.message);
    if (outRes.error) throw new Error(outRes.error.message);

    const partnerMap: Record<string, string> = {};
    for (const d of partnersRes.data ?? []) {
      if (d.linked_company_id) partnerMap[d.linked_company_id] = d.id;
    }

    const mine = (mineRes.data ?? []).map((r: any) => ({
      ...r,
      external: false,
      labels: Array.isArray(r.job_labels) ? r.job_labels.map((j: any) => j.trip_labels).filter(Boolean) : [],
    }));
    const out = (outRes.data ?? []).map((r: any) => {
      const executorName = r.executor?.name ?? "Partner";
      const realDriver = r.drivers?.name ?? null;
      return {
        ...r,
        external: true,
        executor_name: executorName,
        external_driver_name: realDriver,
        // route into partner's virtual driver lane on my board
        driver_id: partnerMap[r.executor_company_id ?? ""] ?? null,
        drivers: realDriver
          ? { name: `${executorName} → ${realDriver}` }
          : { name: executorName },
        labels: Array.isArray(r.job_labels) ? r.job_labels.map((j: any) => j.trip_labels).filter(Boolean) : [],
      };
    });
    return [...mine, ...out];
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
  contact_phone: z.string().trim().max(40).optional().or(z.literal("")),
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

export const createJob = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => jobInput.parse(i))
  .handler(async ({ data, context }) => {
    const c = await resolveCompany(context);
    const supabaseAdmin = await getAdminClient();
    const pickup_at = makePickupIso(data.date, data.time);
    const { data: row, error } = await supabaseAdmin.from("jobs").insert({
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
      contact_phone: data.contact_phone || null,
      driver_id: data.driver_id || null,
    }).select().single();
    if (error) throw new Error(error.message);
    await syncJobLabels(context, c.id, row.id, data.label_ids);
    return row;
  });

export const updateJob = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => jobInput.extend({ id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const c = await resolveCompany(context);
    const supabaseAdmin = await getAdminClient();
    const { data: existing, error: e1 } = await supabaseAdmin
      .from("jobs").select("id").eq("id", data.id).eq("company_id", c.id).single();
    if (e1 || !existing) throw new Error("Job not found");
    const pickup_at = makePickupIso(data.date, data.time);
    const { error } = await supabaseAdmin.from("jobs").update({
      from_location: data.from_location, to_location: data.to_location,
      date: data.date, time: data.time, pickup_at,
      flightorship: data.flightorship || data.from_flight || data.to_flight || null,
      from_flight: (data.from_flight || "").toUpperCase() || null,
      to_flight: (data.to_flight || "").toUpperCase() || null,
      clientcompanyname: data.clientcompanyname || null,
      qr_strict_mode: data.qr_strict_mode, tracking_enabled: data.tracking_enabled,
      vehicle: data.vehicle || null, contact_phone: data.contact_phone || null,
      driver_id: data.driver_id || null,
    }).eq("id", data.id);
    if (error) throw new Error(error.message);
    await syncJobLabels(context, c.id, data.id, data.label_ids);
    return { ok: true };
  });

export const addJobPax = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({ job_id: z.string().uuid(), name: z.string().trim().min(1).max(200) }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const c = await resolveCompany(context);
    const supabaseAdmin = await getAdminClient();
    const { data: job, error: je } = await supabaseAdmin
      .from("jobs").select("id").eq("id", data.job_id).eq("company_id", c.id).maybeSingle();
    if (je || !job) throw new Error("Job not found");
    const { error } = await supabaseAdmin.from("pax").insert({ job_id: data.job_id, name: data.name });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const removeJobPax = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ pax_id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const c = await resolveCompany(context);
    const supabaseAdmin = await getAdminClient();
    const { data: row, error: pe } = await supabaseAdmin
      .from("pax").select("id, job_id, jobs!inner(company_id)").eq("id", data.pax_id).maybeSingle();
    if (pe || !row) throw new Error("Passenger not found");
    if ((row as any).jobs?.company_id !== c.id) throw new Error("Forbidden");
    const { error } = await supabaseAdmin.from("pax").delete().eq("id", data.pax_id);
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
    const supabaseAdmin = await getAdminClient();
    const { error } = await supabaseAdmin.from("jobs")
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
    const supabaseAdmin = await getAdminClient();
    const { data: src, error } = await supabaseAdmin.from("jobs")
      .select("*").eq("id", data.job_id).eq("company_id", c.id).single();
    if (error || !src) throw new Error("Job not found");
    const pickup_at = makePickupIso(data.target_date, src.time as string);
    const { data: row, error: iErr } = await supabaseAdmin.from("jobs").insert({
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
    const supabaseAdmin = await getAdminClient();
    const { data: src, error } = await supabaseAdmin.from("jobs")
      .select("*").eq("id", data.job_id).eq("company_id", c.id).single();
    if (error || !src) throw new Error("Job not found");
    const rows = [];
    for (const s of data.splits) {
      const { data: row, error: iErr } = await supabaseAdmin.from("jobs").insert({
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
    const supabaseAdmin = await getAdminClient();
    const { data: job, error } = await supabaseAdmin.from("jobs")
      .select("id, driver_id, driver_accepted_at, deletion_requested_at")
      .eq("id", data.job_id).eq("company_id", c.id).single();
    if (error || !job) throw new Error("Job not found");
    if (!job.driver_id || !job.driver_accepted_at) {
      const { error: dErr } = await supabaseAdmin.from("jobs")
        .delete().eq("id", data.job_id).eq("company_id", c.id);
      if (dErr) throw new Error(dErr.message);
      return { deleted: true, pending: false };
    }
    const { error: uErr } = await supabaseAdmin.from("jobs")
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
    const supabaseAdmin = await getAdminClient();
    const { error } = await supabaseAdmin.from("jobs")
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
    const supabaseAdmin = await getAdminClient();
    const { data: row, error } = await supabaseAdmin.from("drivers").insert({
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
    const supabaseAdmin = await getAdminClient();
    const [{ data: bookings }, { data: mods }] = await Promise.all([
      supabaseAdmin.from("client_bookings")
        .select("*").eq("company_id", c.id).in("status", ["pending", "modification_pending"])
        .order("created_at", { ascending: false }),
      supabaseAdmin.from("client_booking_modifications")
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
    const supabaseAdmin = await getAdminClient();
    const { data: b, error } = await supabaseAdmin.from("client_bookings")
      .select("*").eq("id", data.id).eq("company_id", c.id).single();
    if (error || !b) throw new Error("Booking not found");
    const pickup_at = b.pickup_at ?? (b.date && b.time ? makePickupIso(b.date, b.time) : new Date().toISOString());
    const { data: job, error: jErr } = await supabaseAdmin.from("jobs").insert({
      company_id: c.id,
      from_location: b.from_location, to_location: b.to_location,
      date: b.date ?? new Date(pickup_at).toISOString().slice(0, 10),
      time: b.time, pickup_at,
      clientcompanyname: `${b.name} ${b.surname}`.trim(),
    }).select().single();
    if (jErr) throw new Error(jErr.message);
    await supabaseAdmin.from("client_bookings")
      .update({ status: "accepted", job_id: job.id }).eq("id", data.id);
    return { ok: true, job };
  });

export const rejectBooking = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const c = await resolveCompany(context);
    const supabaseAdmin = await getAdminClient();
    const { error } = await supabaseAdmin.from("client_bookings")
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
    const supabaseAdmin = await getAdminClient();
    const { data: mod, error } = await supabaseAdmin.from("client_booking_modifications")
      .select("*, client_bookings!inner(company_id, id)")
      .eq("id", data.id).single();
    if (error || !mod || mod.client_bookings.company_id !== c.id) throw new Error("Modification not found");
    if (data.approve) {
      const ch: any = mod.requested_changes ?? {};
      // Direct UPDATE would be blocked by 2h trigger; use a service call via RPC-like path:
      // Simplest: mark modification approved and let coordinator manually re-issue. But we can bypass by using status change + payload merge via server:
      // Use temporary approach: set booking status to approved and copy fields; the trigger allows status-only change, and other-field change while <2h will re-trigger. So do two updates: (1) approve status, (2) fields via a special server-fn window (still blocked). Alternative: mark booking status approved and store the accepted payload on the booking itself.
      await supabaseAdmin.from("client_bookings")
        .update({ status: "accepted" }).eq("id", mod.client_bookings.id);
      await supabaseAdmin.from("client_booking_modifications")
        .update({ status: "accepted", resolved_at: new Date().toISOString(), resolved_by: context.userId,
          requested_changes: ch }).eq("id", data.id);
    } else {
      await supabaseAdmin.from("client_booking_modifications")
        .update({ status: "rejected", resolved_at: new Date().toISOString(), resolved_by: context.userId })
        .eq("id", data.id);
      await supabaseAdmin.from("client_bookings")
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
    const supabaseAdmin = await getAdminClient();
    const { data, error } = await supabaseAdmin.from("magic_links")
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
    const supabaseAdmin = await getAdminClient();
    const feature = data.kind === "driver" ? "magic_link_driver" : "magic_link_client";
    const token = makeToken();
    const expires_at = new Date(Date.now() + data.ttl_hours * 3600_000).toISOString();
    const { data: row, error } = await supabaseAdmin.from("magic_links").insert({
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
    const supabaseAdmin = await getAdminClient();
    const { error } = await supabaseAdmin.from("magic_links")
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
    const supabaseAdmin = await getAdminClient();
    const expires_at = new Date(Date.now() + data.ttl_hours * 3600_000).toISOString();
    const { error } = await supabaseAdmin.from("magic_links")
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
    const supabaseAdmin = await getAdminClient();
    const { data: link, error: le } = await supabaseAdmin.from("magic_links")
      .select("*").eq("id", data.id).eq("company_id", c.id).single();
    if (le || !link) throw new Error("Link not found");
    const today = new Date().toISOString().slice(0, 10);
    let jobs: any[] = [];
    if (link.kind === "driver") {
      let q = supabaseAdmin.from("jobs")
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
      const { data: px } = await supabaseAdmin.from("pax").select("job_id").in("job_id", ids);
      for (const p of px ?? []) paxByJob[p.job_id] = (paxByJob[p.job_id] ?? 0) + 1;
    }
    return { link, jobs, paxByJob, company: { name: c.name } };
  });

export const shareJobToDriver = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ job_id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const c = await resolveCompany(context);
    const supabaseAdmin = await getAdminClient();
    const { data: job, error: je } = await supabaseAdmin.from("jobs")
      .select("id,date,time,pickup_at,from_location,from_flight,to_location,to_flight,vehicle,driver_id,company_id,executor_company_id,origin_company_id,dispatch_chain_company_ids,drivers(name)")
      .eq("id", data.job_id)
      .or(`company_id.eq.${c.id},executor_company_id.eq.${c.id},origin_company_id.eq.${c.id},dispatch_chain_company_ids.cs.{${c.id}}`).single();
    if (je || !job) throw new Error("Trip not found");
    if (!job.driver_id) throw new Error("Assign a driver first");
    const nowIso = new Date().toISOString();
    const { data: existing } = await supabaseAdmin.from("magic_links")
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
      const { data: row, error } = await supabaseAdmin.from("magic_links").insert({
        company_id: c.id, kind: "driver", subject_id: job.driver_id,
        subject_label: label, token, expires_at, created_by: context.userId,
      }).select().single();
      if (error) throw new Error(error.message);
      link = row;
    }
    const { count: paxCount } = await supabaseAdmin.from("pax")
      .select("id", { count: "exact", head: true }).eq("job_id", job.id);
    return { token: link.token, expires_at: link.expires_at, job: { ...job, pax_count: paxCount ?? 0 }, company: { name: c.name } };
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
    contact_phone: z.string().trim().max(40).optional().default(""),
    pax: z.array(z.string().trim().min(1).max(200)).max(200).default([]),
  })).min(1).max(50),
  label_ids: z.array(z.string().uuid()).max(20).optional(),
});

export const createJobsBulk = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => bulkTripInput.parse(i))
  .handler(async ({ data, context }) => {
    const c = await resolveCompany(context);
    const supabaseAdmin = await getAdminClient();
    const created: string[] = [];
    for (const t of data.trips) {
      const time = t.time.length === 5 ? `${t.time}:00` : t.time;
      const pickup_at = makePickupIso(t.date, time);
      const { data: job, error } = await supabaseAdmin.from("jobs").insert({
        company_id: c.id,
        from_location: t.from_location, to_location: t.to_location,
        date: t.date, time, pickup_at,
        flightorship: t.flightorship || t.from_flight || t.to_flight || null,
        from_flight: (t.from_flight || "").toUpperCase() || null,
        to_flight: (t.to_flight || "").toUpperCase() || null,
        clientcompanyname: t.clientcompanyname || null,
        contact_phone: t.contact_phone || null,
        qr_strict_mode: false, tracking_enabled: false,
        vehicle: null, driver_id: null,
      }).select("id").single();
      if (error) throw new Error(error.message);
      created.push(job.id);
      if (t.pax.length) {
        const rows = t.pax.map((name) => ({ job_id: job.id, name }));
        const { error: pErr } = await supabaseAdmin.from("pax").insert(rows);
        if (pErr) throw new Error(pErr.message);
      }
      await syncJobLabels(context, c.id, job.id, data.label_ids);
    }
    return { created };
  });

// ---------- FLIGHT STATUS ----------
// ---------- MALTA AIRPORT FLIGHT STATUS ----------
// Scrapes maltairport.com arrivals/departures via Firecrawl and persists status
// on the job. Cards go red when status === 'delayed' / 'cancelled' / 'time_mismatch'.

type MaltaFlightRow = {
  flight?: string | null;
  airline?: string | null;
  origin?: string | null;
  destination?: string | null;
  scheduled?: string | null;
  estimated?: string | null;
  status?: string | null;
  gate?: string | null;
  terminal?: string | null;
};

const maltaCache = new Map<string, { at: number; rows: MaltaFlightRow[] }>();
const MALTA_TTL_MS = 60_000;

async function fetchMaltaBoard(kind: "arrivals" | "departures"): Promise<MaltaFlightRow[]> {
  const url = `https://maltairport.com/flights/${kind}/`;
  const cached = maltaCache.get(url);
  if (cached && Date.now() - cached.at < MALTA_TTL_MS) return cached.rows;
  const apiKey = process.env.FIRECRAWL_API_KEY;
  if (!apiKey) throw new Error("FIRECRAWL_API_KEY not configured");
  const { default: Firecrawl } = await import("@mendable/firecrawl-js");
  const fc = new Firecrawl({ apiKey });
  const schema = {
    type: "object",
    properties: {
      rows: {
        type: "array",
        items: {
          type: "object",
          properties: {
            flight: { type: "string" },
            airline: { type: "string" },
            origin: { type: "string" },
            destination: { type: "string" },
            scheduled: { type: "string" },
            estimated: { type: "string" },
            status: { type: "string" },
            gate: { type: "string" },
            terminal: { type: "string" },
          },
          required: ["flight"],
        },
      },
    },
    required: ["rows"],
  };
  const prompt =
    `Extract every flight row from the Malta International Airport ${kind} board. ` +
    `Return { rows: [...] } where each row has: flight (code like "KM643" or "KM 643"), ` +
    `airline, ${kind === "arrivals" ? "origin (city or airport)" : "destination (city or airport)"}, ` +
    `scheduled (HH:MM local), estimated (HH:MM local if shown), status (label shown such as "On time", "Delayed", "Landed", "Cancelled", "Boarding", "Departed"), gate, terminal.`;
  const result: any = await fc.scrape(url, {
    onlyMainContent: true,
    formats: [{ type: "json", schema, prompt } as any],
  });
  const json = (result?.json ?? result?.data?.json ?? {}) as { rows?: MaltaFlightRow[] };
  const rows = Array.isArray(json.rows) ? json.rows : [];
  maltaCache.set(url, { at: Date.now(), rows });
  return rows;
}

function normalizeFlightCode(c: string) {
  return c.replace(/\s+/g, "").toUpperCase();
}

function mapMaltaStatus(raw: string | null | undefined) {
  const s = String(raw ?? "").trim().toLowerCase();
  if (!s) return "scheduled";
  if (s.includes("cancel")) return "cancelled";
  if (s.includes("divert")) return "diverted";
  if (s.includes("delay")) return "delayed";
  if (s.includes("land") || s.includes("arrived")) return "landed";
  if (s.includes("depart") || s.includes("airborne") || s.includes("en route") || s.includes("en-route") || s.includes("board")) return "active";
  return "scheduled";
}

function combineDateAndTime(baseIso: string | null, hhmm: string | null | undefined): string | null {
  if (!hhmm) return null;
  const m = /(\d{1,2}):(\d{2})/.exec(hhmm.trim());
  if (!m) return null;
  const base = baseIso ? new Date(baseIso) : new Date();
  if (Number.isNaN(base.getTime())) return null;
  // Board shows local Malta time; keep the pickup date and stamp the HH:MM in UTC.
  // toLocaleString on the client renders it in the viewer's zone — acceptable
  // approximation for surfacing scheduled/estimated in the details panel.
  const d = new Date(Date.UTC(
    base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate(),
    Number(m[1]), Number(m[2]), 0,
  ));
  return d.toISOString();
}

async function refreshMaltaFlightForJob(
  supabaseAdmin: any,
  job: { id: string; from_flight: string | null; to_flight: string | null; pickup_at: string | null },
) {
  const code = job.from_flight || job.to_flight;
  if (!code) return { ok: false as const, reason: "no_code" };
  const kind: "arrivals" | "departures" = job.from_flight ? "arrivals" : "departures";
  const rows = await fetchMaltaBoard(kind);
  const norm = normalizeFlightCode(code);
  const row = rows.find((r) => normalizeFlightCode(String(r.flight ?? "")) === norm) ?? null;
  if (!row) {
    await supabaseAdmin.from("jobs").update({
      flight_status: "unknown",
      flight_status_note: "Not on Malta Airport board",
      flight_status_updated_at: new Date().toISOString(),
    }).eq("id", job.id);
    return { ok: false as const, reason: "not_found" };
  }
  const scheduledIso = combineDateAndTime(job.pickup_at, row.scheduled ?? null);
  const estimatedIso = combineDateAndTime(job.pickup_at, row.estimated ?? null);
  let mapped = mapMaltaStatus(row.status);
  const shownTime = (row.estimated || row.scheduled || "").trim();
  const pickTime = job.pickup_at ? new Date(job.pickup_at).toISOString().slice(11, 16) : "";
  if (scheduledIso && job.pickup_at) {
    const s = new Date(scheduledIso).getTime();
    const p = new Date(job.pickup_at).getTime();
    if (!Number.isNaN(s) && !Number.isNaN(p) && Math.abs(s - p) > 45 * 60_000) {
      mapped = "time_mismatch";
    }
  }
  let note: string;
  switch (mapped) {
    case "cancelled": note = "CANCELLED"; break;
    case "diverted": note = "DIVERTED"; break;
    case "time_mismatch": note = `Flight ${shownTime || "?"} vs pickup ${pickTime || "?"}`; break;
    case "delayed": note = `Delayed → ${row.estimated || shownTime || "?"}`; break;
    case "landed": note = `Landed ${row.estimated || shownTime || ""}`.trim(); break;
    case "active": note = row.status || "In progress"; break;
    default: note = `On time · ${shownTime || "?"}`; break;
  }
  if (row.gate) note += ` · Gate ${row.gate}`;
  if (row.terminal) note += ` · T${row.terminal}`;
  await supabaseAdmin.from("jobs").update({
    flight_status: mapped,
    flight_status_note: note,
    flight_status_updated_at: new Date().toISOString(),
    flight_scheduled_at: scheduledIso,
    flight_estimated_at: estimatedIso,
  }).eq("id", job.id);
  return { ok: true as const, status: mapped, note };
}

export const checkFlightStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const c = await resolveCompany(context);
    const supabaseAdmin = await getAdminClient();
    const configured = !!process.env.FIRECRAWL_API_KEY;
    const fromIso = new Date(Date.now() - 6 * 3600_000).toISOString();
    const toIso = new Date(Date.now() + 48 * 3600_000).toISOString();
    const { data: jobs, error } = await supabaseAdmin.from("jobs")
      .select("id, from_flight, to_flight, pickup_at")
      .eq("company_id", c.id)
      .or("from_flight.not.is.null,to_flight.not.is.null")
      .gte("pickup_at", fromIso).lte("pickup_at", toIso);
    if (error) throw new Error(error.message);
    if (!configured || !jobs?.length) return { checked: jobs?.length ?? 0, updated: 0, configured };
    let updated = 0;
    for (const j of jobs) {
      try {
        const r = await refreshMaltaFlightForJob(supabaseAdmin, j as any);
        if (r.ok) updated++;
      } catch { /* ignore per-flight errors */ }
    }
    return { checked: jobs.length, updated, configured };
  });

export const getMaltaFlightStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ job_id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    await assertJobInCompany(context, data.job_id);
    const supabaseAdmin = await getAdminClient();
    const { data: job, error } = await supabaseAdmin.from("jobs")
      .select("id, from_flight, to_flight, pickup_at")
      .eq("id", data.job_id).maybeSingle();
    if (error) throw new Error(error.message);
    if (!job) throw new Error("Job not found");
    if (!job.from_flight && !job.to_flight) return { ok: false, reason: "no_flight" as const };
    try {
      return await refreshMaltaFlightForJob(supabaseAdmin, job as any);
    } catch (e: any) {
      return { ok: false as const, reason: "scrape_failed", error: String(e?.message ?? e) };
    }
  });

export const listJobPax = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ job_id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const c = await resolveCompany(context);
    const supabaseAdmin = await getAdminClient();
    const { data: job, error: jErr } = await supabaseAdmin.from("jobs")
      .select("id").eq("id", data.job_id).eq("company_id", c.id).single();
    if (jErr || !job) throw new Error("Job not found");
    const { data: rows, error } = await supabaseAdmin.from("pax")
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
    const supabaseAdmin = await getAdminClient();
    const { data: src, error } = await supabaseAdmin.from("jobs")
      .select("*").eq("id", data.source_job_id).eq("company_id", c.id).single();
    if (error || !src) throw new Error("Job not found");
    const { data: job, error: iErr } = await supabaseAdmin.from("jobs").insert({
      company_id: c.id,
      from_location: src.from_location, to_location: src.to_location,
      date: src.date, time: src.time, pickup_at: src.pickup_at,
      flightorship: src.flightorship, clientcompanyname: src.clientcompanyname,
      qr_strict_mode: false, tracking_enabled: false,
      vehicle: data.vehicle || null, driver_id: data.driver_id ?? null,
    }).select("id").single();
    if (iErr) throw new Error(iErr.message);
    const { error: uErr } = await supabaseAdmin.from("pax")
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
    const supabaseAdmin = await getAdminClient();
    const { data: rows, error } = await supabaseAdmin.from("jobs")
      .select("id").eq("company_id", c.id).in("id", [data.source_job_id, data.target_job_id]);
    if (error || !rows || rows.length !== 2) throw new Error("Job not found");
    const { error: uErr } = await supabaseAdmin.from("pax")
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
    .select("id, company_id, executor_company_id, origin_company_id, dispatch_chain_company_ids").eq("id", jobId)
    .or(`company_id.eq.${c.id},executor_company_id.eq.${c.id},origin_company_id.eq.${c.id},dispatch_chain_company_ids.cs.{${c.id}}`).maybeSingle();
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
    const { data: userRow } = await supabaseAdmin.auth.admin.getUserById(context.userId);
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
    const supabaseAdmin = await getAdminClient();
    const { data, error } = await supabaseAdmin.from("trip_labels")
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
    const supabaseAdmin = await getAdminClient();
    const { data: row, error } = await supabaseAdmin.from("trip_labels").insert({
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
    const supabaseAdmin = await getAdminClient();
    const patch: Record<string, unknown> = {};
    if (data.name !== undefined) patch.name = data.name;
    if (data.color !== undefined) patch.color = data.color;
    if (data.sort_order !== undefined) patch.sort_order = data.sort_order;
    const { error } = await supabaseAdmin.from("trip_labels")
      .update(patch as never).eq("id", data.id).eq("company_id", c.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteLabel = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const c = await resolveCompany(context);
    const supabaseAdmin = await getAdminClient();
    const { error } = await supabaseAdmin.from("trip_labels")
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
    const supabaseAdmin = await getAdminClient();
    const { data: job, error } = await supabaseAdmin.from("jobs")
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

    const supabaseAdmin = await getAdminClient();
    // Base query — service-role read with explicit company/chain scoping below.
    let q = supabaseAdmin.from("jobs")
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
    } else if (!c.isAdmin) {
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
      const { data: comps } = await supabaseAdmin.from("companies")
        .select("id,name").in("id", Array.from(companyIds));
      for (const cp of comps ?? []) nameById[cp.id] = cp.name;
    }

    const jobIds = jobs.map((j) => j.id);
    void jobIds;


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
      
      truncated,
    };
  });

// ---------- Live driver locations (coordinator) ----------

export const listActiveDriverLocations = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({ since_minutes: z.number().int().min(1).max(180).optional() }).parse(i ?? {}),
  )
  .handler(async ({ data, context }) => {
    const c = await resolveCompany(context);
    const supabaseAdmin = await getAdminClient();
    const sinceIso = new Date(Date.now() - (data.since_minutes ?? 30) * 60_000).toISOString();

    // Find all jobs the caller can see (owner / executor / origin / chain) that
    // have any driver activity recently. Then pull the latest point per driver.
    const { data: jobs, error: jobsErr } = await supabaseAdmin.from("jobs")
      .select("id, driver_id, from_location, to_location, drivers(id,name)")
      .not("driver_id", "is", null)
      .or(`company_id.eq.${c.id},executor_company_id.eq.${c.id},origin_company_id.eq.${c.id},dispatch_chain_company_ids.cs.{${c.id}}`);
    if (jobsErr) throw new Error(jobsErr.message);
    const jobIds = (jobs ?? []).map((j: any) => j.id);
    if (jobIds.length === 0) return [] as any[];

    const { data: pts, error: ptsErr } = await supabaseAdmin.from("driver_locations")
      .select("driver_id, job_id, latitude, longitude, accuracy_m, heading, speed_mps, captured_at")
      .in("job_id", jobIds)
      .gte("captured_at", sinceIso)
      .order("captured_at", { ascending: false })
      .limit(2000);
    if (ptsErr) throw new Error(ptsErr.message);

    const jobMap = new Map<string, any>();
    for (const j of jobs ?? []) jobMap.set(j.id, j);

    // Keep latest per driver
    const latest = new Map<string, any>();
    for (const p of pts ?? []) {
      if (!p.job_id) continue;
      if (!latest.has(p.driver_id)) {
        const job = jobMap.get(p.job_id);
        latest.set(p.driver_id, {
          driver_id: p.driver_id,
          job_id: p.job_id,
          driver_name: job?.drivers?.name ?? "Driver",
          from_location: job?.from_location ?? null,
          to_location: job?.to_location ?? null,
          latitude: Number(p.latitude),
          longitude: Number(p.longitude),
          accuracy_m: p.accuracy_m ?? null,
          heading: p.heading ?? null,
          speed_mps: p.speed_mps ?? null,
          captured_at: p.captured_at,
        });
      }
    }
    return Array.from(latest.values());
  });

// ---------- DATA NORMALIZATION ----------
// Retro-cleans an existing job: extracts phone numbers embedded in pax names
// into contact_phone, and normalizes flight codes (from_flight/to_flight)
// including codes typed into from_location/to_location.
export const normalizeJobData = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ job_id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    await assertJobInCompany(context, data.job_id);
    const { extractPhoneFromName, extractFlightCode, normalizePhone } = await import("./parse-trips");
    const supabaseAdmin = await getAdminClient();
    const { data: job, error: je } = await supabaseAdmin
      .from("jobs")
      .select("id, contact_phone, from_flight, to_flight, from_location, to_location, flightorship")
      .eq("id", data.job_id).maybeSingle();
    if (je || !job) return { ok: false, changed: 0 };

    let changed = 0;
    let discoveredPhone = "";

    // Pax cleanup
    const { data: paxRows } = await supabaseAdmin
      .from("pax").select("id, name").eq("job_id", data.job_id);
    for (const p of paxRows ?? []) {
      const { cleanName, phone } = extractPhoneFromName(p.name ?? "");
      if (phone && !discoveredPhone) discoveredPhone = phone;
      if (cleanName && cleanName !== (p.name ?? "").trim()) {
        await supabaseAdmin.from("pax").update({ name: cleanName }).eq("id", p.id);
        changed++;
      }
    }

    // Also normalize a phone already sitting in contact_phone
    const currentPhone = normalizePhone(job.contact_phone ?? "") || (job.contact_phone ?? "");
    const jobPatch: {
      contact_phone?: string;
      from_flight?: string;
      to_flight?: string;
      from_location?: string;
      to_location?: string;
      flightorship?: string;
    } = {};
    if (!job.contact_phone && discoveredPhone) {
      jobPatch.contact_phone = discoveredPhone;
    } else if (job.contact_phone && currentPhone && currentPhone !== job.contact_phone) {
      jobPatch.contact_phone = currentPhone;
    }

    // Flight codes: normalize existing and extract from location fields
    const cleanFrom = extractFlightCode(job.from_flight ?? "");
    if (cleanFrom.code && cleanFrom.code !== (job.from_flight ?? "").toUpperCase()) {
      jobPatch.from_flight = cleanFrom.code;
    }
    const cleanTo = extractFlightCode(job.to_flight ?? "");
    if (cleanTo.code && cleanTo.code !== (job.to_flight ?? "").toUpperCase()) {
      jobPatch.to_flight = cleanTo.code;
    }
    const locFrom = extractFlightCode(job.from_location ?? "");
    if (locFrom.code && !job.from_flight) {
      jobPatch.from_flight = locFrom.code;
      jobPatch.from_location = locFrom.rest || "Airport";
    }
    const locTo = extractFlightCode(job.to_location ?? "");
    if (locTo.code && !job.to_flight) {
      jobPatch.to_flight = locTo.code;
      jobPatch.to_location = locTo.rest || "Airport";
    }
    if ((jobPatch.from_flight || jobPatch.to_flight) && !job.flightorship) {
      jobPatch.flightorship = (jobPatch.from_flight || jobPatch.to_flight) as string;
    }

    if (Object.keys(jobPatch).length) {
      const { error: ue } = await supabaseAdmin.from("jobs").update(jobPatch as any).eq("id", data.job_id);
      if (ue) throw new Error(ue.message);
      changed += Object.keys(jobPatch).length;
    }

    return { ok: true, changed, phoneMoved: !!jobPatch.contact_phone };
  });

// Lightweight setter used when a coordinator adds a passenger with a phone
// number embedded — sets contact_phone only if currently empty.
export const setJobContactPhoneIfEmpty = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({ job_id: z.string().uuid(), phone: z.string().trim().min(3).max(40) }).parse(i),
  )
  .handler(async ({ data, context }) => {
    await assertJobInCompany(context, data.job_id);
    const supabaseAdmin = await getAdminClient();
    const { data: job } = await supabaseAdmin
      .from("jobs").select("contact_phone").eq("id", data.job_id).maybeSingle();
    if (!job) throw new Error("Job not found");
    if (job.contact_phone) return { ok: true, set: false };
    const { error } = await supabaseAdmin.from("jobs")
      .update({ contact_phone: data.phone }).eq("id", data.job_id);
    if (error) throw new Error(error.message);
    return { ok: true, set: true };
  });
