/**
 * Driver settings & availability — Phase 6.
 *
 * Token-authenticated (magic-link `driver` kind), same as OTG.
 * Handles: profile, vehicle catalog, weekly hours, per-date exceptions,
 * a fast "close early today" override, and a read helper the coordinator
 * uses for the open/closed badge.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

async function requireDriver(token: string) {
  const sb = await admin();
  const { data } = await sb.from("magic_links")
    .select("id, company_id, kind, subject_id, expires_at, revoked_at")
    .eq("token", token).is("revoked_at", null).maybeSingle();
  if (!data) throw new Error("invalid_or_expired_link");
  if ((data as any).kind !== "driver") throw new Error("invalid_or_expired_link");
  if ((data as any).expires_at && new Date((data as any).expires_at) < new Date()) throw new Error("invalid_or_expired_link");
  if (!(data as any).subject_id) throw new Error("driver_required");
  return data as { id: string; company_id: string; subject_id: string };
}

async function ensureSchedule(driverId: string, companyId: string) {
  const sb = await admin();
  const { data: existing } = await sb.from("availability_schedules")
    .select("id, timezone, always_open")
    .eq("owner_type", "driver").eq("owner_id", driverId).maybeSingle();
  if (existing) return existing as { id: string; timezone: string | null; always_open: boolean };
  const { data: created, error } = await sb.from("availability_schedules")
    .insert({ owner_type: "driver", owner_id: driverId, company_id: companyId, timezone: "Europe/Malta", always_open: false } as any)
    .select("id, timezone, always_open").single();
  if (error) throw new Error(error.message);
  return created as { id: string; timezone: string | null; always_open: boolean };
}

// ── READ ────────────────────────────────────────────────────────────────
export const getDriverSettings = createServerFn({ method: "GET" })
  .inputValidator((i: unknown) => z.object({ token: z.string().min(8).max(128) }).parse(i))
  .handler(async ({ data }) => {
    const link = await requireDriver(data.token);
    const sb = await admin();
    const { data: driver } = await sb.from("drivers")
      .select("id, name, phone, email, vehicle, plate, car_make_model, seats_available, onboarded_at, availability_note")
      .eq("id", link.subject_id).maybeSingle();
    const schedule = await ensureSchedule(link.subject_id, link.company_id);
    const [{ data: windows }, { data: exceptions }, { data: vehicles }] = await Promise.all([
      sb.from("availability_windows").select("id, weekday, start_time, end_time").eq("schedule_id", schedule.id),
      sb.from("availability_exceptions").select("id, date, is_open, start_time, end_time, note")
        .eq("schedule_id", schedule.id).gte("date", new Date(Date.now() - 24*3600*1000).toISOString().slice(0,10))
        .order("date"),
      sb.from("driver_vehicles").select("id, name, plate, seats, default_price_eur, per_km_eur, is_default")
        .eq("driver_id", link.subject_id).order("is_default", { ascending: false }),
    ]);
    return {
      driver: driver ?? null,
      schedule,
      windows: windows ?? [],
      exceptions: exceptions ?? [],
      vehicles: vehicles ?? [],
      onboarded: !!(driver as any)?.onboarded_at,
    };
  });

// ── PROFILE ─────────────────────────────────────────────────────────────
export const saveDriverProfile = createServerFn({ method: "POST" })
  .inputValidator((i: unknown) => z.object({
    token: z.string().min(8).max(128),
    name: z.string().min(1).max(120).optional(),
    phone: z.string().max(40).optional(),
    email: z.string().email().optional().nullable(),
    vehicle: z.string().max(120).optional().nullable(),
    plate: z.string().max(40).optional().nullable(),
    availability_note: z.string().max(500).optional().nullable(),
  }).parse(i))
  .handler(async ({ data }) => {
    const link = await requireDriver(data.token);
    const sb = await admin();
    const patch: Record<string, unknown> = {};
    for (const k of ["name","phone","email","vehicle","plate","availability_note"] as const) {
      if ((data as any)[k] !== undefined) patch[k] = (data as any)[k];
    }
    if (Object.keys(patch).length === 0) return { ok: true };
    const { error } = await sb.from("drivers").update(patch as never).eq("id", link.subject_id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ── VEHICLES ────────────────────────────────────────────────────────────
const VehicleInput = z.object({
  id: z.string().uuid().optional(),
  name: z.string().min(1).max(120),
  plate: z.string().max(40).optional().nullable(),
  seats: z.number().int().min(1).max(60).default(4),
  default_price_eur: z.number().min(0).max(9999).optional().nullable(),
  per_km_eur: z.number().min(0).max(999).optional().nullable(),
  is_default: z.boolean().optional(),
});

export const saveVehicles = createServerFn({ method: "POST" })
  .inputValidator((i: unknown) => z.object({
    token: z.string().min(8).max(128),
    vehicles: z.array(VehicleInput).max(20),
    delete_ids: z.array(z.string().uuid()).max(20).optional(),
  }).parse(i))
  .handler(async ({ data }) => {
    const link = await requireDriver(data.token);
    const sb = await admin();
    // Deletions
    if (data.delete_ids?.length) {
      await sb.from("driver_vehicles").delete().in("id", data.delete_ids).eq("driver_id", link.subject_id);
    }
    let firstDefault = true;
    for (const v of data.vehicles) {
      const row = {
        driver_id: link.subject_id,
        name: v.name,
        plate: v.plate ?? null,
        seats: v.seats,
        default_price_eur: v.default_price_eur ?? null,
        per_km_eur: v.per_km_eur ?? null,
        is_default: !!v.is_default && firstDefault,
      };
      if (row.is_default) firstDefault = false;
      if (v.id) {
        await sb.from("driver_vehicles").update(row as never).eq("id", v.id).eq("driver_id", link.subject_id);
      } else {
        await sb.from("driver_vehicles").insert(row as never);
      }
    }
    // If a default was set, clear any other default
    const defaultVeh = data.vehicles.find((v) => v.is_default);
    if (defaultVeh?.id) {
      await sb.from("driver_vehicles").update({ is_default: false } as never)
        .eq("driver_id", link.subject_id).neq("id", defaultVeh.id);
    }
    return { ok: true };
  });

// ── SCHEDULE ────────────────────────────────────────────────────────────
export const saveSchedule = createServerFn({ method: "POST" })
  .inputValidator((i: unknown) => z.object({
    token: z.string().min(8).max(128),
    timezone: z.string().max(64).optional(),
    always_open: z.boolean().optional(),
    windows: z.array(z.object({
      weekday: z.number().int().min(0).max(6),
      start_time: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/),
      end_time: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/),
    })).max(50),
  }).parse(i))
  .handler(async ({ data }) => {
    const link = await requireDriver(data.token);
    const sb = await admin();
    const schedule = await ensureSchedule(link.subject_id, link.company_id);
    const patch: Record<string, unknown> = {};
    if (data.timezone !== undefined) patch.timezone = data.timezone;
    if (data.always_open !== undefined) patch.always_open = data.always_open;
    if (Object.keys(patch).length) {
      await sb.from("availability_schedules").update(patch as never).eq("id", schedule.id);
    }
    // Replace windows wholesale (simple + predictable)
    await sb.from("availability_windows").delete().eq("schedule_id", schedule.id);
    if (data.windows.length) {
      await sb.from("availability_windows").insert(
        data.windows.map((w) => ({ schedule_id: schedule.id, weekday: w.weekday, start_time: w.start_time, end_time: w.end_time })) as never,
      );
    }
    // Mark onboarded on first save
    await sb.from("drivers").update({ onboarded_at: new Date().toISOString() } as never)
      .eq("id", link.subject_id).is("onboarded_at", null);
    return { ok: true };
  });

// ── EXCEPTIONS ──────────────────────────────────────────────────────────
export const upsertException = createServerFn({ method: "POST" })
  .inputValidator((i: unknown) => z.object({
    token: z.string().min(8).max(128),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    is_open: z.boolean(),
    start_time: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/).optional().nullable(),
    end_time: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/).optional().nullable(),
    note: z.string().max(200).optional().nullable(),
  }).parse(i))
  .handler(async ({ data }) => {
    const link = await requireDriver(data.token);
    const sb = await admin();
    const schedule = await ensureSchedule(link.subject_id, link.company_id);
    // Wipe any existing entry for this date, then insert one
    await sb.from("availability_exceptions").delete().eq("schedule_id", schedule.id).eq("date", data.date);
    const { error } = await sb.from("availability_exceptions").insert({
      schedule_id: schedule.id,
      date: data.date,
      is_open: data.is_open,
      start_time: data.start_time ?? null,
      end_time: data.end_time ?? null,
      note: data.note ?? null,
    } as never);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteException = createServerFn({ method: "POST" })
  .inputValidator((i: unknown) => z.object({
    token: z.string().min(8).max(128),
    id: z.string().uuid(),
  }).parse(i))
  .handler(async ({ data }) => {
    const link = await requireDriver(data.token);
    const sb = await admin();
    const schedule = await ensureSchedule(link.subject_id, link.company_id);
    await sb.from("availability_exceptions").delete().eq("id", data.id).eq("schedule_id", schedule.id);
    return { ok: true };
  });

// ── CLOSE EARLY TODAY ───────────────────────────────────────────────────
export const closeEarlyToday = createServerFn({ method: "POST" })
  .inputValidator((i: unknown) => z.object({
    token: z.string().min(8).max(128),
    reopen_time: z.string().regex(/^\d{2}:\d{2}$/).optional().nullable(),
    note: z.string().max(200).optional().nullable(),
  }).parse(i))
  .handler(async ({ data }) => {
    const link = await requireDriver(data.token);
    const sb = await admin();
    const schedule = await ensureSchedule(link.subject_id, link.company_id);
    const today = new Date().toISOString().slice(0, 10);
    await sb.from("availability_exceptions").delete().eq("schedule_id", schedule.id).eq("date", today);
    // If reopen_time given → today is open from reopen_time till end of day
    // Otherwise → closed all day.
    const row = data.reopen_time
      ? { schedule_id: schedule.id, date: today, is_open: true, start_time: `${data.reopen_time}:00`, end_time: "23:59:00", note: data.note ?? "Closed early" }
      : { schedule_id: schedule.id, date: today, is_open: false, start_time: null, end_time: null, note: data.note ?? "Closed early" };
    await sb.from("availability_exceptions").insert(row as never);
    return { ok: true };
  });

// ── COORDINATOR-SIDE READ: open/closed badge ────────────────────────────
// Auth: requires supabase session; scoped to same company.
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const getDriverOpenStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ driver_id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { data: driver } = await context.supabase.from("drivers")
      .select("id, name, company_id, linked_company_id").eq("id", data.driver_id).maybeSingle();
    if (!driver) return { state: "unknown" as const, reopen_at: null, note: null };

    // Read via admin because availability lives per-schedule and we want to
    // avoid cross-company visibility gaps in the badge.
    const sb = await admin();
    const { data: schedule } = await sb.from("availability_schedules")
      .select("id, timezone, always_open")
      .eq("owner_type", "driver").eq("owner_id", data.driver_id).maybeSingle();
    if (!schedule) return { state: "unknown" as const, reopen_at: null, note: null };
    if ((schedule as any).always_open) return { state: "open" as const, reopen_at: null, note: "Always open" };

    const tz = (schedule as any).timezone || "Europe/Malta";
    const now = new Date();
    const local = new Intl.DateTimeFormat("en-GB", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false })
      .formatToParts(now).reduce<Record<string,string>>((a, p) => { a[p.type] = p.value; return a; }, {});
    const dateStr = `${local.year}-${local.month}-${local.day}`;
    const hhmm = `${local.hour}:${local.minute}`;
    const weekday = new Date(`${dateStr}T00:00:00`).getDay(); // 0..6

    const [{ data: ex }, { data: wins }] = await Promise.all([
      sb.from("availability_exceptions").select("is_open, start_time, end_time, note")
        .eq("schedule_id", (schedule as any).id).eq("date", dateStr).maybeSingle(),
      sb.from("availability_windows").select("start_time, end_time, weekday")
        .eq("schedule_id", (schedule as any).id).eq("weekday", weekday),
    ]);

    function inRange(from: string | null | undefined, to: string | null | undefined) {
      if (!from || !to) return false;
      return hhmm >= from.slice(0,5) && hhmm <= to.slice(0,5);
    }

    if (ex) {
      const e = ex as any;
      if (!e.is_open) return { state: "closed" as const, reopen_at: null, note: e.note ?? "Closed today" };
      if (inRange(e.start_time, e.end_time)) return { state: "open" as const, reopen_at: null, note: e.note ?? null };
      // Not yet open today
      if (e.start_time && hhmm < e.start_time.slice(0,5)) {
        return { state: "closed" as const, reopen_at: e.start_time.slice(0,5), note: e.note ?? null };
      }
      return { state: "closed" as const, reopen_at: null, note: e.note ?? null };
    }

    for (const w of (wins ?? []) as any[]) {
      if (inRange(w.start_time, w.end_time)) {
        return { state: "open" as const, reopen_at: null, note: null };
      }
    }
    // Find next weekly window
    const { data: allWins } = await sb.from("availability_windows")
      .select("weekday, start_time, end_time").eq("schedule_id", (schedule as any).id);
    let bestReopen: string | null = null;
    for (let dOff = 0; dOff < 7; dOff++) {
      const wd = (weekday + dOff) % 7;
      const dayWins = (allWins ?? []).filter((w: any) => w.weekday === wd);
      for (const w of dayWins as any[]) {
        if (dOff === 0 && w.start_time.slice(0,5) <= hhmm) continue;
        bestReopen = `${dOff === 0 ? "Today" : dOff === 1 ? "Tomorrow" : ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"][wd]} ${w.start_time.slice(0,5)}`;
        break;
      }
      if (bestReopen) break;
    }
    return { state: "closed" as const, reopen_at: bestReopen, note: null };
  });
