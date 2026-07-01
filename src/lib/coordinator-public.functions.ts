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
    const supabase = publicClient();
    const today = new Date().toISOString().slice(0, 10);
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    let q = supabase.from("jobs")
      .select("id, from_location, to_location, date, time, pickup_at, flightorship, vehicle, qr_strict_mode, tracking_enabled, clientcompanyname, driver_accepted_at, deletion_requested_at")
      .eq("company_id", link.company_id)
      .gte("date", today).lte("date", tomorrow)
      .order("pickup_at", { ascending: true });
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
