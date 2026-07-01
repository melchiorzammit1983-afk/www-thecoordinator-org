import { createServerFn } from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database } from "@/integrations/supabase/types";

function publicClient() {
  return createClient<Database>(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_PUBLISHABLE_KEY!,
    { auth: { storage: undefined, persistSession: false, autoRefreshToken: false } },
  );
}

async function resolveToken(token: string, expectedKind: "driver" | "client") {
  const supabase = publicClient();
  const { data, error } = await supabase.from("magic_links")
    .select("id, company_id, kind, subject_id, subject_label, expires_at, revoked_at")
    .eq("token", token).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  if (data.kind !== expectedKind) return null;
  if (data.revoked_at) return null;
  if (new Date(data.expires_at) < new Date()) return null;
  return data;
}

export const getDriverManifest = createServerFn({ method: "GET" })
  .inputValidator((i: unknown) => z.object({ token: z.string().min(8).max(128) }).parse(i))
  .handler(async ({ data }) => {
    const link = await resolveToken(data.token, "driver");
    if (!link) return null;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const today = new Date().toISOString().slice(0, 10);
    const weekOut = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);
    let q = supabaseAdmin.from("jobs")
      .select("id, from_location, to_location, date, time, pickup_at, flightorship, vehicle, qr_strict_mode, tracking_enabled, clientcompanyname, driver_accepted_at, deletion_requested_at, status")
      .eq("company_id", link.company_id)
      .or(`and(date.gte.${today},date.lte.${weekOut}),deletion_requested_at.not.is.null`)
      .order("pickup_at", { ascending: true, nullsFirst: false })
      .order("date", { ascending: true })
      .order("time", { ascending: true });
    if (link.subject_id) q = q.eq("driver_id", link.subject_id);
    const { data: jobs, error } = await q;
    if (error) throw new Error(error.message);
    return { link, jobs: jobs ?? [] };
  });

export const driverAcceptJob = createServerFn({ method: "POST" })
  .inputValidator((i: unknown) =>
    z.object({ token: z.string().min(8).max(128), job_id: z.string().uuid() }).parse(i),
  )
  .handler(async ({ data }) => {
    const supabase = publicClient();
    const { error } = await supabase.rpc("driver_accept_job", { _token: data.token, _job_id: data.job_id });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const driverApproveDeletion = createServerFn({ method: "POST" })
  .inputValidator((i: unknown) =>
    z.object({ token: z.string().min(8).max(128), job_id: z.string().uuid() }).parse(i),
  )
  .handler(async ({ data }) => {
    const supabase = publicClient();
    const { error } = await supabase.rpc("driver_approve_deletion", { _token: data.token, _job_id: data.job_id });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const getClientBookings = createServerFn({ method: "GET" })
  .inputValidator((i: unknown) => z.object({ token: z.string().min(8).max(128) }).parse(i))
  .handler(async ({ data }) => {
    const link = await resolveToken(data.token, "client");
    if (!link) return null;
    const supabase = publicClient();
    const q = supabase.from("client_bookings")
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
  if (job.company_id !== link.company_id) throw new Error("forbidden");
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
