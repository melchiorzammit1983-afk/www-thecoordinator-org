import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

async function getAdminClient() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

async function resolveToken(token: string, expectedKind: "driver" | "client") {
  const supabaseAdmin = await getAdminClient();
  const { data, error } = await supabaseAdmin
    .from("magic_links")
    .select("id, company_id, kind, subject_id, subject_label, expires_at, revoked_at")
    .eq("token", token)
    .is("revoked_at", null)
    .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const row = data;
  if (!row) return null;
  if (row.kind !== expectedKind) return null;
  if (row.revoked_at) return null;
  if (row.expires_at && new Date(row.expires_at) < new Date()) return null;
  return row as {
    id: string;
    company_id: string;
    kind: string;
    subject_id: string | null;
    subject_label: string | null;
    expires_at: string;
    revoked_at: string | null;
  };
}


export const getDriverManifest = createServerFn({ method: "GET" })
  .inputValidator((i: unknown) => z.object({ token: z.string().min(8).max(128) }).parse(i))
  .handler(async ({ data }) => {
    const link = await resolveToken(data.token, "driver");
    if (!link) return null;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    let q = supabaseAdmin.from("jobs")
      .select("id, from_location, to_location, date, time, pickup_at, flightorship, from_flight, to_flight, flight_status, flight_status_note, flight_status_updated_at, vehicle, qr_strict_mode, tracking_enabled, clientcompanyname, driver_accepted_at, deletion_requested_at, status, payment_status, driver_id, drivers(name), pax(id,name,status,boarded_at), job_labels(trip_labels(id,name,color))")
      .is("driver_hidden_at", null)
      .order("pickup_at", { ascending: true, nullsFirst: false })
      .order("date", { ascending: true })
      .order("time", { ascending: true });
    if (link.subject_id) {
      q = q.eq("driver_id", link.subject_id);
    } else {
      q = q.or(`company_id.eq.${link.company_id},executor_company_id.eq.${link.company_id},origin_company_id.eq.${link.company_id},dispatch_chain_company_ids.cs.{${link.company_id}}`);
    }
    const { data: jobsRaw, error } = await q;
    if (error) throw new Error(error.message);
    const jobs = (jobsRaw ?? []).map((j: any) => ({
      ...j,
      labels: Array.isArray(j.job_labels) ? j.job_labels.map((x: any) => x.trip_labels).filter(Boolean) : [],
    }));
    let driver: { id: string; name: string; seats_available: number | null; availability_note: string | null; profile_updated_at: string | null } | null = null;
    if (link.subject_id) {
      const { data: drv } = await supabaseAdmin.from("drivers")
        .select("id, name, seats_available, availability_note, profile_updated_at")
        .eq("id", link.subject_id).maybeSingle();
      driver = drv ?? null;
    }
    // Unread coordinator messages per job
    const jobIds = (jobs ?? []).map((j: { id: string }) => j.id);
    let unread: Record<string, number> = {};
    if (jobIds.length) {
      const { data: msgs } = await supabaseAdmin.from("trip_messages")
        .select("job_id").in("job_id", jobIds).eq("sender_kind", "coordinator").is("read_by_driver_at", null);
      unread = (msgs ?? []).reduce((acc: Record<string, number>, m: { job_id: string }) => {
        acc[m.job_id] = (acc[m.job_id] ?? 0) + 1; return acc;
      }, {});
    }
    const jobsWithUnread = (jobs ?? []).map((j: { id: string }) => ({ ...j, unread_messages: unread[j.id] ?? 0 }));
    return { link, jobs: jobsWithUnread, driver };
  });

// ---------- Trip messages (driver side) ----------

export const listTripMessages = createServerFn({ method: "GET" })
  .inputValidator((i: unknown) =>
    z.object({ token: z.string().min(8).max(128), job_id: z.string().uuid() }).parse(i),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await loadDriverJob(data.token, data.job_id);
    const { data: rows, error } = await supabaseAdmin.from("trip_messages")
      .select("id, sender_kind, sender_label, body, created_at, read_by_driver_at")
      .eq("job_id", data.job_id).order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    const unreadIds = (rows ?? []).filter((r) => r.sender_kind === "coordinator" && !r.read_by_driver_at).map((r) => r.id);
    if (unreadIds.length) {
      await supabaseAdmin.from("trip_messages")
        .update({ read_by_driver_at: new Date().toISOString() } as never)
        .in("id", unreadIds);
    }
    return rows ?? [];
  });

export const postTripMessage = createServerFn({ method: "POST" })
  .inputValidator((i: unknown) =>
    z.object({
      token: z.string().min(8).max(128),
      job_id: z.string().uuid(),
      body: z.string().trim().min(1).max(4000),
    }).parse(i),
  )
  .handler(async ({ data }) => {
    const { link, job, supabaseAdmin } = await loadDriverJob(data.token, data.job_id);
    const { error } = await supabaseAdmin.from("trip_messages").insert({
      job_id: data.job_id,
      company_id: job.company_id,
      sender_kind: "driver",
      sender_label: link.subject_label ?? "Driver",
      body: data.body,
    } as never);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const updateDriverProfile = createServerFn({ method: "POST" })
  .inputValidator((i: unknown) =>
    z.object({
      token: z.string().min(8).max(128),
      name: z.string().trim().min(1).max(120).optional(),
      seats_available: z.number().int().min(0).max(200).nullable().optional(),
      availability_note: z.string().trim().max(500).nullable().optional(),
    }).parse(i),
  )
  .handler(async ({ data }) => {
    const link = await resolveToken(data.token, "driver");
    if (!link || !link.subject_id) throw new Error("driver_link_required");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const patch: Record<string, unknown> = { profile_updated_at: new Date().toISOString() };
    if (data.name !== undefined) patch.name = data.name;
    if (data.seats_available !== undefined) patch.seats_available = data.seats_available;
    if (data.availability_note !== undefined) patch.availability_note = data.availability_note;
    const { error } = await supabaseAdmin.from("drivers")
      .update(patch as never).eq("id", link.subject_id).eq("company_id", link.company_id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const setJobPaymentStatus = createServerFn({ method: "POST" })
  .inputValidator((i: unknown) =>
    z.object({
      token: z.string().min(8).max(128),
      job_id: z.string().uuid(),
      status: z.enum(["pending", "paid"]),
    }).parse(i),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await loadDriverJob(data.token, data.job_id);
    const { error } = await supabaseAdmin.from("jobs")
      .update({ payment_status: data.status as never }).eq("id", data.job_id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const hideJobForDriver = createServerFn({ method: "POST" })
  .inputValidator((i: unknown) =>
    z.object({ token: z.string().min(8).max(128), job_id: z.string().uuid() }).parse(i),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await loadDriverJob(data.token, data.job_id);
    const { error } = await supabaseAdmin.from("jobs")
      .update({ driver_hidden_at: new Date().toISOString() }).eq("id", data.job_id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const getDriverStatement = createServerFn({ method: "GET" })
  .inputValidator((i: unknown) =>
    z.object({
      token: z.string().min(8).max(128),
      from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      payment: z.enum(["all", "paid", "pending"]).optional(),
    }).parse(i),
  )
  .handler(async ({ data }) => {
    const link = await resolveToken(data.token, "driver");
    if (!link) throw new Error("invalid_or_expired_link");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    let q = supabaseAdmin.from("jobs")
      .select("id, date, time, pickup_at, from_location, to_location, clientcompanyname, vehicle, status, payment_status, points_charged")
      .order("date", { ascending: true }).order("time", { ascending: true });
    if (link.subject_id) {
      q = q.eq("driver_id", link.subject_id);
    } else {
      q = q.or(`company_id.eq.${link.company_id},executor_company_id.eq.${link.company_id},origin_company_id.eq.${link.company_id},dispatch_chain_company_ids.cs.{${link.company_id}}`);
    }
    if (data.from) q = q.gte("date", data.from);
    if (data.to) q = q.lte("date", data.to);
    if (data.payment && data.payment !== "all") q = q.eq("payment_status", data.payment);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return rows ?? [];
  });


export const driverAcceptJob = createServerFn({ method: "POST" })
  .inputValidator((i: unknown) =>
    z.object({ token: z.string().min(8).max(128), job_id: z.string().uuid() }).parse(i),
  )
  .handler(async ({ data }) => {
    const link = await resolveToken(data.token, "driver");
    if (!link) throw new Error("invalid_or_expired_link");
    const { job, supabaseAdmin } = await loadDriverJob(data.token, data.job_id);
    const { error } = await supabaseAdmin.from("jobs").update({
      driver_accepted_at: job.driver_accepted_at ?? new Date().toISOString(),
    } as never).eq("id", data.job_id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const driverApproveDeletion = createServerFn({ method: "POST" })
  .inputValidator((i: unknown) =>
    z.object({ token: z.string().min(8).max(128), job_id: z.string().uuid() }).parse(i),
  )
  .handler(async ({ data }) => {
    const link = await resolveToken(data.token, "driver");
    if (!link) throw new Error("invalid_or_expired_link");
    const { job, supabaseAdmin } = await loadDriverJob(data.token, data.job_id);
    if (!job.deletion_requested_at) throw new Error("no_deletion_requested");
    const { error } = await supabaseAdmin.from("jobs").delete().eq("id", data.job_id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });


export const getClientBookings = createServerFn({ method: "GET" })
  .inputValidator((i: unknown) => z.object({ token: z.string().min(8).max(128) }).parse(i))
  .handler(async ({ data }) => {
    const link = await resolveToken(data.token, "client");
    if (!link) return null;
    const supabaseAdmin = await getAdminClient();
    const q = supabaseAdmin.from("client_bookings")
      .select("id, name, surname, client_email, from_location, to_location, date, time, pickup_at, status, room_number")
      .eq("company_id", link.company_id)
      .order("pickup_at", { ascending: true, nullsFirst: false });
    const filtered = link.subject_label
      ? q.eq("client_email", link.subject_label)
      : q;
    const { data: bookings, error } = await filtered;
    if (error) throw new Error(error.message);
    return { link, bookings: bookings ?? [] };
  });

// ---------- Phase 3: Client actions ----------

const changesSchema = z.object({
  from_location: z.string().trim().min(1).max(255).optional(),
  to_location: z.string().trim().min(1).max(255).optional(),
  pickup_at: z.string().datetime().optional(),
  time: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/).optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  room_number: z.string().trim().max(40).optional().nullable(),
  name: z.string().trim().min(1).max(100).optional(),
  surname: z.string().trim().min(1).max(100).optional(),
}).strict();

async function loadBookingForClient(token: string, booking_id: string) {
  const link = await resolveToken(token, "client");
  if (!link) throw new Error("invalid_or_expired_link");
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: booking, error } = await supabaseAdmin.from("client_bookings")
    .select("*").eq("id", booking_id).maybeSingle();
  if (error) throw new Error(error.message);
  if (!booking) throw new Error("booking_not_found");
  if (booking.company_id !== link.company_id) throw new Error("forbidden");
  if (link.subject_label && booking.client_email !== link.subject_label) throw new Error("forbidden");
  return { link, booking, supabaseAdmin };
}

export const updateClientBooking = createServerFn({ method: "POST" })
  .inputValidator((i: unknown) =>
    z.object({
      token: z.string().min(8).max(128),
      booking_id: z.string().uuid(),
      changes: changesSchema,
    }).parse(i),
  )
  .handler(async ({ data }) => {
    const { booking, supabaseAdmin } = await loadBookingForClient(data.token, data.booking_id);
    const pickupAt = booking.pickup_at ? new Date(booking.pickup_at).getTime() : null;
    const diffMs = pickupAt ? pickupAt - Date.now() : Infinity;
    const twoHours = 2 * 60 * 60 * 1000;

    const changes: Record<string, unknown> = { ...data.changes };
    if (changes.time && (changes.time as string).length === 5) changes.time = `${changes.time}:00`;

    if (diffMs > twoHours) {
      const { error } = await supabaseAdmin.from("client_bookings")
        .update(changes as never).eq("id", data.booking_id);
      if (error) throw new Error(error.message);
      return { mode: "direct" as const };
    }
    const { error: mErr } = await supabaseAdmin.from("client_booking_modifications").insert({
      booking_id: data.booking_id,
      requested_changes: changes as never,
      status: "pending",
    });
    if (mErr) throw new Error(mErr.message);
    await supabaseAdmin.from("client_bookings")
      .update({ status: "modification_pending" }).eq("id", data.booking_id);
    return { mode: "pending" as const };
  });

export const cancelClientBooking = createServerFn({ method: "POST" })
  .inputValidator((i: unknown) =>
    z.object({ token: z.string().min(8).max(128), booking_id: z.string().uuid() }).parse(i),
  )
  .handler(async ({ data }) => {
    const { booking, supabaseAdmin } = await loadBookingForClient(data.token, data.booking_id);
    const pickupAt = booking.pickup_at ? new Date(booking.pickup_at).getTime() : null;
    const diffMs = pickupAt ? pickupAt - Date.now() : Infinity;
    const twoHours = 2 * 60 * 60 * 1000;

    if (diffMs > twoHours) {
      const { error } = await supabaseAdmin.from("client_bookings")
        .update({ status: "cancelled" }).eq("id", data.booking_id);
      if (error) throw new Error(error.message);
      return { mode: "direct" as const };
    }
    const { error: mErr } = await supabaseAdmin.from("client_booking_modifications").insert({
      booking_id: data.booking_id,
      requested_changes: { action: "cancel" },
      status: "pending",
    });
    if (mErr) throw new Error(mErr.message);
    await supabaseAdmin.from("client_bookings")
      .update({ status: "modification_pending" }).eq("id", data.booking_id);
    return { mode: "pending" as const };
  });

export const createRecurringBookings = createServerFn({ method: "POST" })
  .inputValidator((i: unknown) =>
    z.object({
      token: z.string().min(8).max(128),
      weekdays: z.array(z.number().int().min(0).max(6)).min(1),
      time: z.string().regex(/^\d{2}:\d{2}$/),
      from_location: z.string().trim().min(1).max(255),
      to_location: z.string().trim().min(1).max(255),
      name: z.string().trim().min(1).max(100),
      surname: z.string().trim().min(1).max(100),
      room_number: z.string().trim().max(40).optional(),
    }).parse(i),
  )
  .handler(async ({ data }) => {
    const link = await resolveToken(data.token, "client");
    if (!link) throw new Error("invalid_or_expired_link");
    const email = link.subject_label ?? `${data.name}.${data.surname}@portal.local`.toLowerCase();
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const rows: Array<Record<string, unknown>> = [];
    const now = new Date();
    for (let i = 0; i < 7; i++) {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i);
      if (!data.weekdays.includes(d.getDay())) continue;
      const [hh, mm] = data.time.split(":").map(Number);
      const pickup = new Date(d.getFullYear(), d.getMonth(), d.getDate(), hh, mm);
      if (pickup.getTime() <= Date.now()) continue;
      rows.push({
        company_id: link.company_id,
        name: data.name,
        surname: data.surname,
        client_email: email,
        room_number: data.room_number || null,
        from_location: data.from_location,
        to_location: data.to_location,
        time: `${data.time}:00`,
        date: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`,
        pickup_at: pickup.toISOString(),
        status: "pending",
      });
    }
    if (rows.length === 0) return { created: 0 };
    const { error } = await supabaseAdmin.from("client_bookings").insert(rows as never);
    if (error) throw new Error(error.message);
    return { created: rows.length };
  });

// ---------- Phase 4: Driver actions ----------

async function loadDriverJob(token: string, job_id: string) {
  const link = await resolveToken(token, "driver");
  if (!link) throw new Error("invalid_or_expired_link");
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: job, error } = await supabaseAdmin.from("jobs")
    .select("*").eq("id", job_id).maybeSingle();
  if (error) throw new Error(error.message);
  if (!job) throw new Error("job_not_found");
  const chainIds: string[] = job.dispatch_chain_company_ids ?? [];
  const inChain = job.company_id === link.company_id
    || job.executor_company_id === link.company_id
    || job.origin_company_id === link.company_id
    || chainIds.includes(link.company_id);
  if (!inChain) throw new Error("forbidden");
  if (link.subject_id && job.driver_id !== link.subject_id) throw new Error("not_your_job");
  return { link, job, supabaseAdmin };
}

export const listJobPaxDriver = createServerFn({ method: "GET" })
  .inputValidator((i: unknown) =>
    z.object({ token: z.string().min(8).max(128), job_id: z.string().uuid() }).parse(i),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await loadDriverJob(data.token, data.job_id);
    const { data: pax, error } = await supabaseAdmin.from("pax")
      .select("id, name, status, boarded_at, boarded_method")
      .eq("job_id", data.job_id).order("name");
    if (error) throw new Error(error.message);
    return pax ?? [];
  });

export const updateJobStatus = createServerFn({ method: "POST" })
  .inputValidator((i: unknown) =>
    z.object({
      token: z.string().min(8).max(128),
      job_id: z.string().uuid(),
      status: z.enum(["pending", "en_route", "arrived", "in_progress", "active", "completed"]),
    }).parse(i),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await loadDriverJob(data.token, data.job_id);
    const { error } = await supabaseAdmin.from("jobs")
      .update({ status: data.status as never }).eq("id", data.job_id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const markPaxOnboard = createServerFn({ method: "POST" })
  .inputValidator((i: unknown) =>
    z.object({
      token: z.string().min(8).max(128),
      job_id: z.string().uuid(),
      pax_id: z.string().uuid(),
      method: z.enum(["qr", "manual"]),
    }).parse(i),
  )
  .handler(async ({ data }) => {
    const { job, supabaseAdmin } = await loadDriverJob(data.token, data.job_id);
    if (data.method === "manual" && job.qr_strict_mode) {
      throw new Error("qr_required");
    }
    const { error } = await supabaseAdmin.from("pax")
      .update({
        status: "onboard" as never,
        boarded_at: new Date().toISOString(),
        boarded_method: data.method,
      })
      .eq("id", data.pax_id).eq("job_id", data.job_id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ---------- Live driver GPS tracking ----------

export const pushDriverLocation = createServerFn({ method: "POST" })
  .inputValidator((i: unknown) =>
    z.object({
      token: z.string().min(8).max(128),
      job_id: z.string().uuid(),
      latitude: z.number().gte(-90).lte(90),
      longitude: z.number().gte(-180).lte(180),
      accuracy_m: z.number().nonnegative().max(100000).optional().nullable(),
      heading: z.number().gte(0).lt(360).optional().nullable(),
      speed_mps: z.number().gte(0).max(200).optional().nullable(),
    }).parse(i),
  )
  .handler(async ({ data }) => {
    const { job, link, supabaseAdmin } = await loadDriverJob(data.token, data.job_id);
    // Only accept pings while the trip is actively running
    const active = ["en_route", "arrived", "in_progress", "active"].includes(String(job.status ?? ""));
    if (!active) return { ok: false, reason: "not_active" };
    if (!job.driver_id) return { ok: false, reason: "no_driver" };
    const { error } = await supabaseAdmin.from("driver_locations").insert({
      driver_id: job.driver_id,
      job_id: data.job_id,
      company_id: job.executor_company_id ?? job.company_id ?? link.company_id,
      latitude: data.latitude,
      longitude: data.longitude,
      accuracy_m: data.accuracy_m ?? null,
      heading: data.heading ?? null,
      speed_mps: data.speed_mps ?? null,
      captured_at: new Date().toISOString(),
    } as never);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
