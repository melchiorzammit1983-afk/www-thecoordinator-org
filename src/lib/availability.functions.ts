import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/** Shape returned to the settings UI. */
export type Schedule = {
  id: string | null;
  owner_type: "company" | "driver";
  owner_id: string;
  company_id: string;
  timezone: string;
  always_open: boolean;
  windows: { id?: string; weekday: number; start_time: string; end_time: string }[];
  exceptions: {
    id?: string;
    date: string;
    is_open: boolean;
    start_time: string | null;
    end_time: string | null;
    note: string | null;
  }[];
};

export type Policy = {
  company_id: string;
  forwarding_enabled: boolean;
  off_hours_mode: "auto_forward" | "notify_then_forward" | "manual_pick";
  notify_timeout_min: number;
  unanswered_timeout_min: number;
  max_forward_hops: number;
  preferred_partner_ids: string[];
};

const HH_MM = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const windowsSchema = z.array(
  z.object({
    id: z.string().uuid().optional(),
    weekday: z.number().int().min(0).max(6),
    start_time: z.string().regex(HH_MM),
    end_time: z.string().regex(HH_MM),
  }),
);

const exceptionsSchema = z.array(
  z.object({
    id: z.string().uuid().optional(),
    date: z.string().regex(ISO_DATE),
    is_open: z.boolean(),
    start_time: z.string().regex(HH_MM).nullable().optional(),
    end_time: z.string().regex(HH_MM).nullable().optional(),
    note: z.string().max(200).nullable().optional(),
  }),
);

/* --------------------------- Schedule read/write --------------------------- */

export const getMySchedule = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((v: { owner_type: "company" | "driver"; owner_id: string }) =>
    z.object({
      owner_type: z.enum(["company", "driver"]),
      owner_id: z.string().uuid(),
    }).parse(v),
  )
  .handler(async ({ context, data }): Promise<Schedule | null> => {
    const { supabase } = context;
    const { data: sched } = await supabase
      .from("availability_schedules")
      .select("id, owner_type, owner_id, company_id, timezone, always_open")
      .eq("owner_type", data.owner_type)
      .eq("owner_id", data.owner_id)
      .maybeSingle();
    if (!sched) return null;
    const [{ data: windows }, { data: exceptions }] = await Promise.all([
      supabase.from("availability_windows").select("id, weekday, start_time, end_time").eq("schedule_id", sched.id),
      supabase.from("availability_exceptions").select("id, date, is_open, start_time, end_time, note").eq("schedule_id", sched.id).order("date"),
    ]);
    return {
      ...sched,
      owner_type: sched.owner_type as "company" | "driver",
      windows: windows ?? [],
      exceptions: (exceptions ?? []).map((e) => ({
        ...e,
        start_time: e.start_time ?? null,
        end_time: e.end_time ?? null,
        note: e.note ?? null,
      })),
    };
  });

export const saveMySchedule = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((v: {
    owner_type: "company" | "driver";
    owner_id: string;
    company_id: string;
    timezone: string;
    always_open: boolean;
    windows: unknown;
    exceptions: unknown;
  }) =>
    z.object({
      owner_type: z.enum(["company", "driver"]),
      owner_id: z.string().uuid(),
      company_id: z.string().uuid(),
      timezone: z.string().min(1).max(64),
      always_open: z.boolean(),
      windows: windowsSchema,
      exceptions: exceptionsSchema,
    }).parse(v),
  )
  .handler(async ({ context, data }) => {
    const { supabase } = context;
    // Upsert schedule
    const { data: existing } = await supabase
      .from("availability_schedules")
      .select("id")
      .eq("owner_type", data.owner_type)
      .eq("owner_id", data.owner_id)
      .maybeSingle();

    let schedule_id = existing?.id ?? null;
    if (!schedule_id) {
      const { data: inserted, error } = await supabase
        .from("availability_schedules")
        .insert({
          owner_type: data.owner_type,
          owner_id: data.owner_id,
          company_id: data.company_id,
          timezone: data.timezone,
          always_open: data.always_open,
        })
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      schedule_id = inserted.id;
    } else {
      const { error } = await supabase
        .from("availability_schedules")
        .update({ timezone: data.timezone, always_open: data.always_open })
        .eq("id", schedule_id);
      if (error) throw new Error(error.message);
    }

    // Replace windows
    await supabase.from("availability_windows").delete().eq("schedule_id", schedule_id);
    if (data.windows.length > 0) {
      const rows = data.windows.map((w) => ({
        schedule_id,
        weekday: w.weekday,
        start_time: w.start_time,
        end_time: w.end_time,
      }));
      const { error } = await supabase.from("availability_windows").insert(rows);
      if (error) throw new Error(error.message);
    }
    // Replace exceptions
    await supabase.from("availability_exceptions").delete().eq("schedule_id", schedule_id);
    if (data.exceptions.length > 0) {
      const rows = data.exceptions.map((e) => ({
        schedule_id,
        date: e.date,
        is_open: e.is_open,
        start_time: e.start_time ?? null,
        end_time: e.end_time ?? null,
        note: e.note ?? null,
      }));
      const { error } = await supabase.from("availability_exceptions").insert(rows);
      if (error) throw new Error(error.message);
    }
    return { ok: true, schedule_id };
  });

/* --------------------------- Policy read/write ---------------------------- */

export const getMyPolicy = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((v: { company_id: string }) => z.object({ company_id: z.string().uuid() }).parse(v))
  .handler(async ({ context, data }): Promise<Policy> => {
    const { supabase } = context;
    const { data: row } = await supabase
      .from("availability_policies")
      .select("*")
      .eq("company_id", data.company_id)
      .maybeSingle();
    if (!row) {
      return {
        company_id: data.company_id,
        forwarding_enabled: false,
        off_hours_mode: "notify_then_forward",
        notify_timeout_min: 15,
        unanswered_timeout_min: 15,
        max_forward_hops: 5,
        preferred_partner_ids: [],
      };
    }
    return row as Policy;
  });

export const savePolicy = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((v: Policy) =>
    z.object({
      company_id: z.string().uuid(),
      forwarding_enabled: z.boolean(),
      off_hours_mode: z.enum(["auto_forward", "notify_then_forward", "manual_pick"]),
      notify_timeout_min: z.number().int().min(2).max(60),
      unanswered_timeout_min: z.number().int().min(2).max(60),
      max_forward_hops: z.number().int().min(1).max(20),
      preferred_partner_ids: z.array(z.string().uuid()).max(50),
    }).parse(v),
  )
  .handler(async ({ context, data }) => {
    const { supabase } = context;
    const { error } = await supabase
      .from("availability_policies")
      .upsert(data, { onConflict: "company_id" });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/* --------------------------- Pure helpers ---------------------------- */

/** Returns true if a schedule is open at the given time (local weekday/time in owner TZ). */
export function scheduleIsOpen(
  sched: {
    always_open: boolean;
    timezone: string;
    windows: { weekday: number; start_time: string; end_time: string }[];
    exceptions: { date: string; is_open: boolean; start_time: string | null; end_time: string | null }[];
  } | null,
  at: Date = new Date(),
): boolean {
  if (!sched) return true; // no schedule = always available (opt-in feature)
  if (sched.always_open) return true;
  // Compute local Y-M-D / weekday / HH:MM in TZ
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: sched.timezone || "UTC",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = Object.fromEntries(fmt.formatToParts(at).map((p) => [p.type, p.value]));
  const date = `${parts.year}-${parts.month}-${parts.day}`;
  const hhmm = `${parts.hour}:${parts.minute}`;
  const weekdayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const weekday = weekdayMap[parts.weekday] ?? 0;

  const exc = sched.exceptions.find((e) => e.date === date);
  if (exc) {
    if (!exc.is_open) return false;
    if (exc.start_time && exc.end_time) return hhmm >= exc.start_time.slice(0, 5) && hhmm < exc.end_time.slice(0, 5);
    return true;
  }
  return sched.windows.some(
    (w) => w.weekday === weekday && hhmm >= w.start_time.slice(0, 5) && hhmm < w.end_time.slice(0, 5),
  );
}

/** Public server fn: is a company currently open? */
export const isOwnerOpenNow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((v: { owner_type: "company" | "driver"; owner_id: string; at?: string }) =>
    z.object({
      owner_type: z.enum(["company", "driver"]),
      owner_id: z.string().uuid(),
      at: z.string().datetime().optional(),
    }).parse(v),
  )
  .handler(async ({ context, data }): Promise<{ open: boolean; has_schedule: boolean }> => {
    const { supabase } = context;
    const { data: sched } = await supabase
      .from("availability_schedules")
      .select("id, timezone, always_open")
      .eq("owner_type", data.owner_type)
      .eq("owner_id", data.owner_id)
      .maybeSingle();
    if (!sched) return { open: true, has_schedule: false };
    const [{ data: w }, { data: e }] = await Promise.all([
      supabase.from("availability_windows").select("weekday, start_time, end_time").eq("schedule_id", sched.id),
      supabase.from("availability_exceptions").select("date, is_open, start_time, end_time").eq("schedule_id", sched.id),
    ]);
    return {
      open: scheduleIsOpen(
        {
          always_open: sched.always_open,
          timezone: sched.timezone,
          windows: w ?? [],
          exceptions: (e ?? []).map((x) => ({
            date: x.date,
            is_open: x.is_open,
            start_time: x.start_time ?? null,
            end_time: x.end_time ?? null,
          })),
        },
        data.at ? new Date(data.at) : new Date(),
      ),
      has_schedule: true,
    };
  });

/* --------------------------- Forwarding audit ---------------------------- */

export const listForwardHistory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((v: { job_id: string }) => z.object({ job_id: z.string().uuid() }).parse(v))
  .handler(async ({ context, data }) => {
    const { supabase } = context;
    const { data: rows, error } = await supabase
      .from("dispatch_forward_events")
      .select("id, from_company_id, to_company_id, reason, points_charged, meta, created_at, from_company:from_company_id(name), to_company:to_company_id(name)")
      .eq("job_id", data.job_id)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return rows ?? [];
  });
