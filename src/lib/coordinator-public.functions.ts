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

    // If this magic link points at a virtual driver (coordinator/partner
    // provisioning), we can't filter jobs by driver_id — those jobs are
    // dispatched at the company level. Fall back to company scope.
    type DriverRow = {
      id: string; name: string; kind: string | null;
      seats_available: number | null; availability_note: string | null;
      profile_updated_at: string | null;
    };
    let driverRow: DriverRow | null = null;
    if (link.subject_id) {
      const { data: drv } = await supabaseAdmin.from("drivers")
        .select("id, name, kind, seats_available, availability_note, profile_updated_at")
        .eq("id", link.subject_id).maybeSingle();
      driverRow = (drv as DriverRow | null) ?? null;
    }
    const isVirtualDriver = driverRow?.kind === "coordinator" || driverRow?.kind === "partner";
    const filterByDriverId = Boolean(link.subject_id) && !isVirtualDriver;

    let q = supabaseAdmin.from("jobs")
      .select("id, from_location, to_location, date, time, pickup_at, flightorship, from_flight, to_flight, flight_status, flight_status_note, flight_status_updated_at, vehicle, qr_strict_mode, tracking_enabled, clientcompanyname, driver_accepted_at, deletion_requested_at, status, payment_status, driver_id, driver_hidden_at, grouped_count, grouped_at, group_id, group_name, group_note, drivers(name), pax(id,name,status,boarded_at), job_labels(trip_labels(id,name,color))")
      .order("pickup_at", { ascending: true, nullsFirst: false })
      .order("date", { ascending: true })
      .order("time", { ascending: true });
    if (filterByDriverId) {
      q = q.eq("driver_id", link.subject_id!);
    } else {
      q = q.or(`company_id.eq.${link.company_id},executor_company_id.eq.${link.company_id},origin_company_id.eq.${link.company_id},dispatch_chain_company_ids.cs.{${link.company_id}}`);
    }
    const { data: jobsRaw, error } = await q;
    if (error) throw new Error(error.message);
    const jobs = (jobsRaw ?? []).map((j: any) => ({
      ...j,
      labels: Array.isArray(j.job_labels) ? j.job_labels.map((x: any) => x.trip_labels).filter(Boolean) : [],
    }));
    const driver = driverRow
      ? {
          id: driverRow.id, name: driverRow.name,
          seats_available: driverRow.seats_available,
          availability_note: driverRow.availability_note,
          profile_updated_at: driverRow.profile_updated_at,
        }
      : null;
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
    const { job, supabaseAdmin } = await loadDriverJob(data.token, data.job_id);
    let ids: string[] = [data.job_id];
    const gid = (job as any).group_id as string | null;
    if (gid) {
      const { data: sibs } = await supabaseAdmin.from("jobs").select("id").eq("group_id" as any, gid);
      const sibIds = (sibs ?? []).map((s: any) => s.id as string);
      if (sibIds.length) ids = sibIds;
    }
    const { data: rows, error } = await supabaseAdmin.from("trip_messages")
      .select("id, sender_kind, sender_label, body, created_at, read_by_driver_at")
      .in("job_id", ids).order("created_at", { ascending: true });
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

export const unhideJobForDriver = createServerFn({ method: "POST" })
  .inputValidator((i: unknown) =>
    z.object({ token: z.string().min(8).max(128), job_id: z.string().uuid() }).parse(i),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await loadDriverJob(data.token, data.job_id);
    const { error } = await supabaseAdmin.from("jobs")
      .update({ driver_hidden_at: null }).eq("id", data.job_id);
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
      .select("id, date, time, pickup_at, from_location, to_location, clientcompanyname, vehicle, status, payment_status")
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
  if (link.subject_id) {
    // Virtual drivers (coordinator / partner) are scoped to the company,
    // not a specific driver_id.
    const { data: drv } = await supabaseAdmin.from("drivers")
      .select("kind").eq("id", link.subject_id).maybeSingle();
    const isVirtual = drv?.kind === "coordinator" || drv?.kind === "partner";
    if (!isVirtual && job.driver_id !== link.subject_id) throw new Error("not_your_job");
  }
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
    const { job, supabaseAdmin } = await loadDriverJob(data.token, data.job_id);
    const patch: Record<string, unknown> = { status: data.status };
    if (data.status === "completed") {
      // Legacy merge-grouped counter still clears on this trip.
      patch.grouped_count = null;
      patch.grouped_at = null;
    }
    const { error } = await supabaseAdmin.from("jobs")
      .update(patch as never).eq("id", data.job_id);
    if (error) throw new Error(error.message);

    // Reversible-group auto-dissolve: if this trip belonged to a group and all
    // sibling trips are now completed/cancelled, clear group_id on all members.
    if (data.status === "completed") {
      const gid = (job as any).group_id as string | null | undefined;
      if (gid) {
        const { data: siblings } = await supabaseAdmin.from("jobs")
          .select("id, status")
          .eq("group_id" as any, gid);
        const allDone = (siblings ?? []).every((s: any) => s.status === "completed" || s.status === "cancelled");
        if (allDone) {
          await supabaseAdmin.from("jobs")
            .update({ group_id: null, grouped_count: null, grouped_at: null } as never)
            .eq("group_id" as any, gid);
        }
      }
    }
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

// ---------- Live driver location (public, magic-link protected) ----------

const pointSchema = z.object({
  latitude: z.number().gte(-90).lte(90),
  longitude: z.number().gte(-180).lte(180),
  accuracy_m: z.number().nonnegative().max(100000).nullable().optional(),
  heading: z.number().nullable().optional(),
  speed_mps: z.number().nullable().optional(),
  captured_at: z.string().datetime(),
});

export const pushDriverLocation = createServerFn({ method: "POST" })
  .inputValidator((i: unknown) =>
    z.object({
      token: z.string().min(8).max(128),
      points: z.array(pointSchema).min(1).max(50),
    }).parse(i),
  )
  .handler(async ({ data }) => {
    const link = await resolveToken(data.token, "driver");
    if (!link || !link.subject_id) throw new Error("driver_link_required");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Pick the driver's currently-active job, preferring most recent pickup.
    const { data: activeJobs } = await supabaseAdmin.from("jobs")
      .select("id, company_id, pickup_at")
      .eq("driver_id", link.subject_id)
      .in("status", ["en_route", "arrived", "in_progress"])
      .order("pickup_at", { ascending: false })
      .limit(1);
    const active = activeJobs?.[0];
    if (!active) return { ok: true, inserted: 0, reason: "no_active_trip" as const };

    const rows = data.points.map((p) => ({
      driver_id: link.subject_id!,
      job_id: active.id,
      company_id: active.company_id,
      latitude: p.latitude,
      longitude: p.longitude,
      accuracy_m: p.accuracy_m ?? null,
      heading: p.heading ?? null,
      speed_mps: p.speed_mps ?? null,
      captured_at: p.captured_at,
    }));
    const { error } = await supabaseAdmin.from("driver_locations").insert(rows as never);
    if (error) throw new Error(error.message);
    return { ok: true, inserted: rows.length, job_id: active.id };
  });

// ============================================================
// CLIENT TRIP PORTAL (per-trip link on jobs.client_link_token)
// ============================================================

async function loadJobByClientToken(token: string) {
  const supabaseAdmin = await getAdminClient();
  const { data: job, error } = await supabaseAdmin.from("jobs")
    .select("*").eq("client_link_token" as any, token).maybeSingle();
  if (error) throw new Error(error.message);
  if (!job) throw new Error("invalid_or_expired_link");
  return { job, supabaseAdmin };
}

async function siblingIds(supabaseAdmin: any, job: any): Promise<string[]> {
  const gid = job.group_id as string | null;
  if (!gid) return [job.id];
  const { data: sibs } = await supabaseAdmin.from("jobs").select("id").eq("group_id" as any, gid);
  const ids = (sibs ?? []).map((s: any) => s.id as string);
  return ids.length ? ids : [job.id];
}

export const getClientTripPortal = createServerFn({ method: "GET" })
  .inputValidator((i: unknown) =>
    z.object({ token: z.string().min(8).max(128), device_id: z.string().min(4).max(80).optional() }).parse(i),
  )
  .handler(async ({ data }) => {
    const { job, supabaseAdmin } = await loadJobByClientToken(data.token);
    const ids = await siblingIds(supabaseAdmin, job);

    const [{ data: siblings }, { data: pax }, { data: company }, { data: driver }] = await Promise.all([
      supabaseAdmin.from("jobs")
        .select("id, from_location, to_location, from_flight, to_flight, date, time, pickup_at, status, flight_status, driver_id, group_id, group_name")
        .in("id", ids),
      supabaseAdmin.from("pax").select("id, name, status, job_id").in("job_id", ids).order("name"),
      supabaseAdmin.from("companies").select("id, name").eq("id", job.company_id).maybeSingle(),
      job.driver_id
        ? supabaseAdmin.from("drivers").select("id, name, phone").eq("id", job.driver_id).maybeSingle()
        : Promise.resolve({ data: null }),
    ]);

    // latest driver location for any assigned driver in the group
    const driverIds = Array.from(new Set((siblings ?? []).map((s: any) => s.driver_id).filter(Boolean)));
    let driverLocations: any[] = [];
    if (driverIds.length) {
      const since = new Date(Date.now() - 30 * 60_000).toISOString();
      const { data: pts } = await supabaseAdmin.from("driver_locations")
        .select("driver_id, latitude, longitude, heading, speed_mps, captured_at")
        .in("driver_id", driverIds)
        .gte("captured_at", since)
        .order("captured_at", { ascending: false });
      const seen = new Set<string>();
      for (const p of pts ?? []) {
        if (seen.has(p.driver_id)) continue;
        seen.add(p.driver_id);
        driverLocations.push(p);
      }
    }

    // identity chosen on this device
    let identity: any = null;
    if (data.device_id) {
      const { data: id } = await supabaseAdmin.from("client_link_identities")
        .select("pax_id, pax_name").eq("token", data.token).eq("device_id", data.device_id).maybeSingle();
      identity = id ?? null;
    }

    // open SOS events (unacknowledged) for this trip / siblings
    const { data: openSos } = await supabaseAdmin
      .from("client_sos_events")
      .select("id, created_at, pax_name, latitude, longitude")
      .in("job_id", ids)
      .is("acknowledged_at", null)
      .order("created_at", { ascending: false })
      .limit(5);

    return {
      job: {
        id: job.id, group_id: job.group_id, group_name: job.group_name,
        from_location: job.from_location, to_location: job.to_location,
        from_flight: job.from_flight, to_flight: job.to_flight,
        date: job.date, time: job.time, pickup_at: job.pickup_at,
        status: job.status, flight_status: job.flight_status,
        flight_status_note: (job as any).flight_status_note ?? null,
        flight_terminal: (job as any).flight_terminal ?? null,
        flight_gate: (job as any).flight_gate ?? null,
        flight_baggage_belt: (job as any).flight_baggage_belt ?? null,
        flight_scheduled_at: (job as any).flight_scheduled_at ?? null,
        flight_estimated_at: (job as any).flight_estimated_at ?? null,
        driver_id: job.driver_id,
        pickup_lat: (job as any).pickup_lat ?? null,
        pickup_lng: (job as any).pickup_lng ?? null,
        client_confirmed_at: (job as any).client_confirmed_at ?? null,
      },
      siblings: siblings ?? [],
      pax: pax ?? [],
      company,
      driver,
      driverLocations,
      identity,
      openSos: openSos ?? [],
    };
  });

export const chooseClientIdentity = createServerFn({ method: "POST" })
  .inputValidator((i: unknown) =>
    z.object({
      token: z.string().min(8).max(128),
      device_id: z.string().min(4).max(80),
      pax_id: z.string().uuid().nullable(),
      pax_name: z.string().trim().min(1).max(200).nullable(),
    }).parse(i),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await loadJobByClientToken(data.token);
    const { error } = await supabaseAdmin.from("client_link_identities").upsert({
      token: data.token, device_id: data.device_id,
      pax_id: data.pax_id, pax_name: data.pax_name,
      chosen_at: new Date().toISOString(),
    } as never);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const listClientTripMessages = createServerFn({ method: "GET" })
  .inputValidator((i: unknown) =>
    z.object({
      token: z.string().min(8).max(128),
      device_id: z.string().min(4).max(80).optional(),
      thread_kind: z.enum(["group", "private"]).default("group"),
    }).parse(i),
  )
  .handler(async ({ data }) => {
    const { job, supabaseAdmin } = await loadJobByClientToken(data.token);
    const ids = await siblingIds(supabaseAdmin, job);

    // resolve identity for private thread scoping
    let identityId: string | null = null;
    if (data.device_id) {
      const { data: id } = await supabaseAdmin.from("client_link_identities")
        .select("id").eq("token", data.token).eq("device_id", data.device_id).maybeSingle();
      identityId = (id as any)?.id ?? null;
    }

    let q = supabaseAdmin.from("trip_messages")
      .select("id, sender_kind, sender_label, body, created_at, thread_kind, client_identity_id, is_sos")
      .in("job_id", ids)
      .order("created_at", { ascending: true });

    if (data.thread_kind === "private") {
      if (!identityId) return [];
      q = q.eq("thread_kind", "private").eq("client_identity_id", identityId);
    } else {
      q = q.eq("thread_kind", "group");
    }
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const postClientTripMessage = createServerFn({ method: "POST" })
  .inputValidator((i: unknown) =>
    z.object({
      token: z.string().min(8).max(128),
      device_id: z.string().min(4).max(80),
      body: z.string().trim().min(1).max(4000),
      thread_kind: z.enum(["group", "private"]).default("group"),
    }).parse(i),
  )
  .handler(async ({ data }) => {
    const { job, supabaseAdmin } = await loadJobByClientToken(data.token);
    const { data: id } = await supabaseAdmin.from("client_link_identities")
      .select("id, pax_name").eq("token", data.token).eq("device_id", data.device_id).maybeSingle();
    const label = (id as any)?.pax_name ?? "Passenger";
    const identityId = (id as any)?.id ?? null;
    const effectiveKind = data.thread_kind === "private" && !identityId ? "group" : data.thread_kind;
    const { error } = await supabaseAdmin.from("trip_messages").insert({
      job_id: job.id, company_id: job.company_id,
      sender_kind: "client", sender_label: label, body: data.body,
      thread_kind: data.thread_kind,
      client_identity_id: data.thread_kind === "private" ? identityId : null,
    } as never);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const pushClientLocation = createServerFn({ method: "POST" })
  .inputValidator((i: unknown) =>
    z.object({
      token: z.string().min(8).max(128),
      device_id: z.string().min(4).max(80),
      latitude: z.number().gte(-90).lte(90),
      longitude: z.number().gte(-180).lte(180),
      accuracy_m: z.number().nonnegative().max(100000).nullable().optional(),
      mode: z.enum(["live", "pin"]).default("live"),
    }).parse(i),
  )
  .handler(async ({ data }) => {
    const { job, supabaseAdmin } = await loadJobByClientToken(data.token);
    const { data: id } = await supabaseAdmin.from("client_link_identities")
      .select("pax_id, pax_name").eq("token", data.token).eq("device_id", data.device_id).maybeSingle();
    const { error } = await supabaseAdmin.from("client_locations").insert({
      token: data.token, job_id: job.id, company_id: job.company_id,
      device_id: data.device_id, pax_id: id?.pax_id ?? null, pax_name: id?.pax_name ?? null,
      latitude: data.latitude, longitude: data.longitude,
      accuracy_m: data.accuracy_m ?? null, mode: data.mode,
    } as never);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const requestClientFollowUp = createServerFn({ method: "POST" })
  .inputValidator((i: unknown) =>
    z.object({
      token: z.string().min(8).max(128),
      device_id: z.string().min(4).max(80),
      from_location: z.string().trim().min(1).max(255),
      to_location: z.string().trim().min(1).max(255),
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      time: z.string().regex(/^\d{2}:\d{2}$/),
      notes: z.string().trim().max(1000).optional(),
    }).parse(i),
  )
  .handler(async ({ data }) => {
    const { job, supabaseAdmin } = await loadJobByClientToken(data.token);
    const { data: id } = await supabaseAdmin.from("client_link_identities")
      .select("pax_name").eq("token", data.token).eq("device_id", data.device_id).maybeSingle();
    const paxName = id?.pax_name ?? "Passenger";
    const [y, mo, d] = data.date.split("-").map(Number);
    const [hh, mm] = data.time.split(":").map(Number);
    const pickup_at = new Date(Date.UTC(y, mo - 1, d, hh, mm)).toISOString();

    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    const clientToken = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

    const { data: newJob, error } = await supabaseAdmin.from("jobs").insert({
      company_id: job.company_id,
      from_location: data.from_location, to_location: data.to_location,
      date: data.date, time: `${data.time}:00`, pickup_at,
      status: "pending",
      parent_job_id: job.id,
      source: "client_followup",
      client_link_token: clientToken,
      clientcompanyname: job.clientcompanyname ?? null,
    } as never).select("id").single();
    if (error) throw new Error(error.message);

    await supabaseAdmin.from("pax").insert({ job_id: newJob!.id, name: paxName } as never);
    if (data.notes) {
      await supabaseAdmin.from("trip_messages").insert({
        job_id: newJob!.id, company_id: job.company_id,
        sender_kind: "client", sender_label: paxName,
        body: `Follow-up request: ${data.notes}`,
      } as never);
    }
    return { ok: true, job_id: newJob!.id };
  });


export const confirmClientTrip = createServerFn({ method: "POST" })
  .inputValidator((i: unknown) =>
    z.object({
      token: z.string().min(8).max(128),
      device_id: z.string().min(4).max(80),
    }).parse(i),
  )
  .handler(async ({ data }) => {
    const supabaseAdmin = await getAdminClient();
    const { data: job, error: je } = await supabaseAdmin
      .from("jobs")
      .select("id, client_confirmed_at, company_id")
      .eq("client_link_token", data.token)
      .maybeSingle();
    if (je) throw new Error(je.message);
    if (!job) throw new Error("trip_not_found");
    if (!job.client_confirmed_at) {
      const { error } = await supabaseAdmin
        .from("jobs")
        .update({ client_confirmed_at: new Date().toISOString() } as never)
        .eq("id", job.id);
      if (error) throw new Error(error.message);
    }
    return { ok: true };
  });

export const heartbeatClientPortal = createServerFn({ method: "POST" })
  .inputValidator((i: unknown) =>
    z.object({
      token: z.string().min(8).max(128),
      device_id: z.string().min(4).max(80),
    }).parse(i),
  )
  .handler(async ({ data }) => {
    const supabaseAdmin = await getAdminClient();
    await supabaseAdmin.from("client_link_identities").upsert({
      token: data.token,
      device_id: data.device_id,
      last_seen_at: new Date().toISOString(),
    } as never);
    return { ok: true };
  });

// ============================================================
// EMERGENCY SOS (client-side)
// ============================================================

export const triggerClientSOS = createServerFn({ method: "POST" })
  .inputValidator((i: unknown) =>
    z.object({
      token: z.string().min(8).max(128),
      device_id: z.string().min(4).max(80),
      latitude: z.number().gte(-90).lte(90).nullable().optional(),
      longitude: z.number().gte(-180).lte(180).nullable().optional(),
      accuracy_m: z.number().nonnegative().max(1e6).nullable().optional(),
      note: z.string().trim().max(500).optional(),
    }).parse(i),
  )
  .handler(async ({ data }) => {
    const { job, supabaseAdmin } = await loadJobByClientToken(data.token);
    const { data: id } = await supabaseAdmin.from("client_link_identities")
      .select("id, pax_name").eq("token", data.token).eq("device_id", data.device_id).maybeSingle();
    const paxName = (id as any)?.pax_name ?? "Passenger";
    const identityId = (id as any)?.id ?? null;

    const { error: se } = await supabaseAdmin.from("client_sos_events").insert({
      job_id: job.id, token: data.token, device_id: data.device_id,
      pax_name: paxName,
      latitude: data.latitude ?? null, longitude: data.longitude ?? null,
      accuracy_m: data.accuracy_m ?? null,
      note: data.note ?? null,
    } as never);
    if (se) throw new Error(se.message);

    // Also drop an urgent private message so the coordinator sees it in chat
    await supabaseAdmin.from("trip_messages").insert({
      job_id: job.id, company_id: job.company_id,
      sender_kind: "client", sender_label: paxName,
      body: `🚨 SOS from ${paxName}${data.note ? ` — ${data.note}` : ""}` +
        (data.latitude != null && data.longitude != null
          ? `  ·  https://www.google.com/maps/search/?api=1&query=${data.latitude},${data.longitude}`
          : ""),
      is_sos: true,
      thread_kind: identityId ? "private" : "group",
      client_identity_id: identityId,
    } as never);

    return { ok: true };
  });

// ============================================================
// LIVE ETA (Google Distance Matrix, traffic-aware)
// ============================================================

const etaCache = new Map<string, { at: number; value: any }>();
const ETA_TTL_MS = 20_000;

export const getTripEta = createServerFn({ method: "POST" })
  .inputValidator((i: unknown) =>
    z.object({ token: z.string().min(8).max(128) }).parse(i),
  )
  .handler(async ({ data }) => {
    const { job, supabaseAdmin } = await loadJobByClientToken(data.token);
    if (!job.driver_id) return { ok: false as const, reason: "no_driver" as const };

    // latest driver point (within 15 min)
    const since = new Date(Date.now() - 15 * 60_000).toISOString();
    const { data: pts } = await supabaseAdmin.from("driver_locations")
      .select("latitude, longitude, captured_at")
      .eq("driver_id", job.driver_id)
      .gte("captured_at", since)
      .order("captured_at", { ascending: false })
      .limit(1);
    const pt = pts?.[0];
    if (!pt) return { ok: false as const, reason: "no_gps" as const };

    // destination: pickup_lat/lng if present, otherwise geocode from_location
    let destLat: number | null = (job as any).pickup_lat ?? null;
    let destLng: number | null = (job as any).pickup_lng ?? null;
    const apiKey = process.env.GOOGLE_MAPS_API_KEY;
    if (!apiKey) return { ok: false as const, reason: "not_configured" as const };

    if (destLat == null || destLng == null) {
      if (!job.from_location) return { ok: false as const, reason: "no_dest" as const };
      const geoUrl = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(job.from_location)}&key=${apiKey}`;
      const gj: any = await (await fetch(geoUrl)).json();
      const loc = gj?.results?.[0]?.geometry?.location;
      if (!loc) return { ok: false as const, reason: "geocode_failed" as const };
      destLat = loc.lat; destLng = loc.lng;
    }

    const key = `${pt.latitude},${pt.longitude}|${destLat},${destLng}`;
    const cached = etaCache.get(key);
    if (cached && Date.now() - cached.at < ETA_TTL_MS) {
      return { ok: true as const, cached: true, ...cached.value };
    }

    const dmUrl = `https://maps.googleapis.com/maps/api/distancematrix/json?origins=${pt.latitude},${pt.longitude}&destinations=${destLat},${destLng}&departure_time=now&traffic_model=best_guess&key=${apiKey}`;
    const dm: any = await (await fetch(dmUrl)).json();
    const el = dm?.rows?.[0]?.elements?.[0];
    if (!el || el.status !== "OK") return { ok: false as const, reason: "dm_failed" as const };
    const value = {
      seconds: (el.duration_in_traffic ?? el.duration)?.value ?? null,
      text: (el.duration_in_traffic ?? el.duration)?.text ?? "",
      distance_m: el.distance?.value ?? null,
      distance_text: el.distance?.text ?? "",
      driver_at: pt.captured_at,
    };
    etaCache.set(key, { at: Date.now(), value });
    return { ok: true as const, cached: false, ...value };
  });

// ============================================================
// PUSH NOTIFICATION SUBSCRIPTIONS (Web Push)
// ============================================================

export const subscribeClientPush = createServerFn({ method: "POST" })
  .inputValidator((i: unknown) =>
    z.object({
      token: z.string().min(8).max(128),
      device_id: z.string().min(4).max(80),
      endpoint: z.string().url().max(2000),
      p256dh: z.string().min(1).max(500),
      auth: z.string().min(1).max(500),
    }).parse(i),
  )
  .handler(async ({ data }) => {
    // validate token points to a real trip
    await loadJobByClientToken(data.token);
    const supabaseAdmin = await getAdminClient();
    const { error } = await supabaseAdmin.from("client_push_subs").upsert({
      token: data.token,
      device_id: data.device_id,
      endpoint: data.endpoint,
      p256dh: data.p256dh,
      auth: data.auth,
    } as never, { onConflict: "token,device_id,endpoint" });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const unsubscribeClientPush = createServerFn({ method: "POST" })
  .inputValidator((i: unknown) =>
    z.object({
      token: z.string().min(8).max(128),
      device_id: z.string().min(4).max(80),
      endpoint: z.string().url().max(2000).optional(),
    }).parse(i),
  )
  .handler(async ({ data }) => {
    const supabaseAdmin = await getAdminClient();
    let q = supabaseAdmin.from("client_push_subs").delete()
      .eq("token", data.token).eq("device_id", data.device_id);
    if (data.endpoint) q = q.eq("endpoint", data.endpoint);
    const { error } = await q;
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// Expose VAPID public key to the client (if configured).
export const getPushPublicKey = createServerFn({ method: "GET" }).handler(async () => {
  return { publicKey: process.env.VAPID_PUBLIC_KEY ?? null };
});
