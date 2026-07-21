/**
 * Driver "On The Go" trip creation.
 *
 * A driver in the field can start a trip themselves — grab passengers, add
 * more stops, drive on. Every OTG job is flagged `created_by_driver` and
 * `needs_review` so the coordinator sees it and cleans it up afterwards.
 *
 * Authentication is via the same magic-link token used for the rest of the
 * driver app (`resolveToken(token, "driver")`) — no Supabase session.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

// Reverse-geocode {lat,lng} → street/place name via the Google Maps
// connector gateway. Returns null on any failure so callers can fall
// back to a generic label without breaking the OTG flow.
async function reverseGeocode(lat: number, lng: number): Promise<{ address: string; place_id: string | null } | null> {
  try {
    const LOVABLE_API_KEY = process.env.LOVABLE_API_KEY;
    const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY;
    if (!LOVABLE_API_KEY || !GOOGLE_MAPS_API_KEY) return null;
    const url = `https://connector-gateway.lovable.dev/google_maps/maps/api/geocode/json?latlng=${lat},${lng}&language=en`;
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "X-Connection-Api-Key": GOOGLE_MAPS_API_KEY,
      },
    });
    if (!res.ok) return null;
    const j: any = await res.json();
    const first = j?.results?.[0];
    if (!first) return null;
    return {
      address: (first.formatted_address as string) ?? "",
      place_id: (first.place_id as string) ?? null,
    };
  } catch { return null; }
}


async function requireDriver(token: string) {
  const supabaseAdmin = await admin();
  const { data } = await supabaseAdmin.from("magic_links")
    .select("id, company_id, kind, subject_id, expires_at, revoked_at")
    .eq("token", token).is("revoked_at", null).maybeSingle();
  if (!data) throw new Error("invalid_or_expired_link");
  if ((data as any).kind !== "driver") throw new Error("invalid_or_expired_link");
  if ((data as any).expires_at && new Date((data as any).expires_at) < new Date()) throw new Error("invalid_or_expired_link");
  if (!(data as any).subject_id) throw new Error("driver_required");
  return data as { id: string; company_id: string; subject_id: string };
}

async function ensureOwnsJob(supabaseAdmin: Awaited<ReturnType<typeof admin>>, jobId: string, driverId: string) {
  const { data: job } = await supabaseAdmin.from("jobs")
    .select("id, company_id, driver_id, created_by_driver, group_id")
    .eq("id", jobId).maybeSingle();
  if (!job) throw new Error("job_not_found");
  if ((job as any).driver_id !== driverId) throw new Error("not_your_job");
  return job as { id: string; company_id: string; driver_id: string; created_by_driver: boolean; group_id: string | null };
}

async function ensureGroup(supabaseAdmin: Awaited<ReturnType<typeof admin>>, jobId: string, driverId: string) {
  const { data: existing } = await supabaseAdmin.from("groups")
    .select("id").eq("job_id", jobId).maybeSingle();
  if (existing?.id) return (existing as any).id as string;
  const { data: created, error } = await supabaseAdmin.from("groups")
    .insert({ job_id: jobId, name: "OTG trip", driver_id: driverId, status: "active" as never } as any)
    .select("id").single();
  if (error) throw new Error(error.message);
  await supabaseAdmin.from("jobs").update({ group_id: (created as any).id } as never).eq("id", jobId);
  return (created as any).id as string;
}


async function logMap(companyId: string, jobId: string, driverId: string, eventType: string, notes: string, meta: Record<string, unknown>, lat?: number, lng?: number) {
  try {
    const supabaseAdmin = await admin();
    const { insertTripMapEvent } = await import("@/lib/trip-map.server");
    await insertTripMapEvent(supabaseAdmin, {
      jobId, companyId, driverId, eventType: eventType as any, notes, meta,
      ...(typeof lat === "number" && typeof lng === "number" ? { lat, lng } : {}),
    });
  } catch { /* metering must not break the flow */ }
}

// ── Start an OTG trip ────────────────────────────────────────────────────
// ── List coordinators this driver can dispatch to ───────────────────────
export const listOtgCoordinators = createServerFn({ method: "GET" })
  .inputValidator((i: unknown) => z.object({ token: z.string().min(8).max(128) }).parse(i))
  .handler(async ({ data }) => {
    const link = await requireDriver(data.token);
    const supabaseAdmin = await admin();
    // Driver's home coordinator + any partner companies via active connections.
    const { data: driverRow } = await supabaseAdmin.from("drivers")
      .select("linked_company_id").eq("id", link.subject_id).maybeSingle();
    const homeId = (driverRow as any)?.linked_company_id ?? link.company_id;
    const { data: conns } = await supabaseAdmin.from("coordinator_connections")
      .select("owner_company_id, partner_company_id, status")
      .eq("status", "active")
      .or(`owner_company_id.eq.${homeId},partner_company_id.eq.${homeId}`);
    const ids = new Set<string>([homeId]);
    for (const c of (conns ?? []) as any[]) {
      if (c.owner_company_id !== homeId) ids.add(c.owner_company_id);
      if (c.partner_company_id !== homeId) ids.add(c.partner_company_id);
    }
    const { data: companies } = await supabaseAdmin.from("companies")
      .select("id, name").in("id", Array.from(ids));
    return {
      home_company_id: homeId,
      coordinators: ((companies ?? []) as any[]).map((c) => ({ id: c.id as string, name: (c.name as string) ?? "Company" })),
    };
  });

// ── Start an OTG trip ────────────────────────────────────────────────────
// New behaviour: the trip enters the normal driver lifecycle at
// `en_route`. The driver then presses the same Arrived / Waiting /
// Boarded / Complete buttons as any assigned trip. Destination is optional
// at start — the driver can set it later before completing.
export const startOnTheGoTrip = createServerFn({ method: "POST" })
  .inputValidator((i: unknown) =>
    z.object({
      token: z.string().min(8).max(128),
      coordinator_company_id: z.string().uuid().optional(),
      lat: z.number().gte(-90).lte(90).optional(),
      lng: z.number().gte(-180).lte(180).optional(),
      pickup_label: z.string().max(200).optional(),
      to_location: z.string().max(200).optional(),
      dropoff_place_id: z.string().max(200).optional(),
      dropoff_lat: z.number().gte(-90).lte(90).optional(),
      dropoff_lng: z.number().gte(-180).lte(180).optional(),
      note: z.string().max(500).optional(),
    }).parse(i),
  )
  .handler(async ({ data }) => {
    const link = await requireDriver(data.token);
    const supabaseAdmin = await admin();

    // Guard: one on-the-go trip in flight at a time. Driver must finish
    // (or delete) the current OTG before starting another.
    const { data: openOtg } = await supabaseAdmin.from("jobs")
      .select("id, status")
      .eq("driver_id", link.subject_id)
      .eq("created_by_driver", true)
      .not("status", "in", "(completed,cancelled)")
      .limit(1);
    if (openOtg && openOtg.length > 0) {
      throw new Error("Finish or delete your current on-the-go trip before starting another.");
    }

    let coordinatorId = data.coordinator_company_id ?? link.company_id;
    if (data.coordinator_company_id && data.coordinator_company_id !== link.company_id) {
      const { data: driverRow } = await supabaseAdmin.from("drivers")
        .select("linked_company_id").eq("id", link.subject_id).maybeSingle();
      const homeId = (driverRow as any)?.linked_company_id ?? link.company_id;
      const { data: conn } = await supabaseAdmin.from("coordinator_connections")
        .select("id").eq("status", "active")
        .or(`and(owner_company_id.eq.${homeId},partner_company_id.eq.${data.coordinator_company_id}),and(owner_company_id.eq.${data.coordinator_company_id},partner_company_id.eq.${homeId})`)
        .maybeSingle();
      if (!conn && data.coordinator_company_id !== homeId) throw new Error("coordinator_not_permitted");
      coordinatorId = data.coordinator_company_id;
    }

    const now = new Date();
    const date = now.toISOString().slice(0, 10);
    const time = now.toISOString().slice(11, 16);
    let pickupLabel = data.pickup_label?.trim() || "";
    let pickupPlaceId: string | null = null;
    if (!pickupLabel && typeof data.lat === "number" && typeof data.lng === "number") {
      const rg = await reverseGeocode(data.lat, data.lng);
      if (rg?.address) { pickupLabel = rg.address; pickupPlaceId = rg.place_id; }
    }
    if (!pickupLabel) {
      pickupLabel = (typeof data.lat === "number" && typeof data.lng === "number")
        ? `Driver location (${data.lat.toFixed(5)}, ${data.lng.toFixed(5)})`
        : "Driver current location";
    }

    const { data: row, error } = await supabaseAdmin.from("jobs").insert({
      company_id: coordinatorId,
      driver_id: link.subject_id,
      from_location: pickupLabel,
      pickup_place_id: pickupPlaceId,
      pickup_display_name: pickupPlaceId ? pickupLabel : null,
      to_location: data.to_location?.trim() || "TBD — set by driver",
      dropoff_place_id: data.dropoff_place_id || null,
      date, time,
      pickup_at: now.toISOString(),
      // Enter the normal lifecycle at en_route — driver uses the same
      // Arrived / Waiting / Boarded / Complete buttons as any other trip.
      status: "en_route" as never,
      driver_accepted_at: now.toISOString(),
      driver_started_at: now.toISOString(),
      created_by_driver: true,
      needs_review: true,
      tracking_enabled: true,
      qr_strict_mode: false,
      source: "driver_otg",
    } as any).select("id").single();
    if (error) throw new Error(error.message);
    const jobId = (row as any).id as string;

    // First stop = current location. Do NOT pre-set arrived_at — the
    // driver presses "Arrived at pickup" when they get there, matching
    // the normal flow (and starting the wait timer at that moment).
    const groupId = await ensureGroup(supabaseAdmin, jobId, link.subject_id!);
    await supabaseAdmin.from("group_stops").insert({
      group_id: groupId,
      stop_index: 0,
      address: pickupLabel,
      lat: data.lat ?? null,
      lng: data.lng ?? null,
    } as any);

    // Meter the trip creation on the coordinator's account (as today).
    try {
      await supabaseAdmin.rpc("spend_points", {
        _company_id: coordinatorId,
        _feature_key: "trip_created",
        _job_id: jobId as unknown as string,
        _note: "Driver on-the-go trip",
        _cost_override: undefined as unknown as number,
      });
    } catch { /* soft-meter */ }

    await logMap(coordinatorId, jobId, link.subject_id!, "en_route",
      data.note ?? "Driver started on-the-go trip",
      { source: "driver_otg" }, data.lat, data.lng);

    return { job_id: jobId };
  });

// ── Driver-side delete for OTG trips awaiting coordinator review ────────
export const otgDeleteJob = createServerFn({ method: "POST" })
  .inputValidator((i: unknown) =>
    z.object({
      token: z.string().min(8).max(128),
      job_id: z.string().uuid(),
    }).parse(i),
  )
  .handler(async ({ data }) => {
    const link = await requireDriver(data.token);
    const supabaseAdmin = await admin();
    const { data: job } = await supabaseAdmin.from("jobs")
      .select("id, driver_id, created_by_driver, needs_review, company_id")
      .eq("id", data.job_id).maybeSingle();
    if (!job) throw new Error("job_not_found");
    if ((job as any).driver_id !== link.subject_id) throw new Error("not_your_job");
    if (!(job as any).created_by_driver) throw new Error("only_otg_deletable");
    if (!(job as any).needs_review) throw new Error("already_reviewed_ask_coordinator");
    const { error } = await supabaseAdmin.from("jobs").delete().eq("id", data.job_id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ── Add another pickup stop ─────────────────────────────────────────────
export const otgAddStop = createServerFn({ method: "POST" })
  .inputValidator((i: unknown) =>
    z.object({
      token: z.string().min(8).max(128),
      job_id: z.string().uuid(),
      lat: z.number().gte(-90).lte(90).optional(),
      lng: z.number().gte(-180).lte(180).optional(),
      address: z.string().max(200).optional(),
    }).parse(i),
  )
  .handler(async ({ data }) => {
    const link = await requireDriver(data.token);
    const supabaseAdmin = await admin();
    const job = await ensureOwnsJob(supabaseAdmin, data.job_id, link.subject_id!);
    const groupId = await ensureGroup(supabaseAdmin, job.id, link.subject_id!);
    const { data: last } = await supabaseAdmin.from("group_stops")
      .select("stop_index").eq("group_id", groupId).order("stop_index", { ascending: false }).limit(1).maybeSingle();
    const nextIndex = ((last as any)?.stop_index ?? -1) + 1;
    const label = data.address?.trim() || (data.lat && data.lng ? `Stop ${nextIndex + 1} (${data.lat.toFixed(5)}, ${data.lng.toFixed(5)})` : `Stop ${nextIndex + 1}`);
    const now = new Date().toISOString();
    const { data: stop, error } = await supabaseAdmin.from("group_stops").insert({
      group_id: groupId,
      stop_index: nextIndex,
      address: label,
      lat: data.lat ?? null,
      lng: data.lng ?? null,
      arrived_at: now,
    } as any).select("id").single();
    if (error) throw new Error(error.message);
    await logMap(job.company_id, job.id, link.subject_id!, "arrived_pickup", `Arrived at stop ${nextIndex + 1}`, { stop_index: nextIndex, address: label }, data.lat, data.lng);
    return { stop_id: (stop as any).id as string, stop_index: nextIndex };
  });

// ── Add a passenger to a stop ───────────────────────────────────────────
export const otgAddPassenger = createServerFn({ method: "POST" })
  .inputValidator((i: unknown) =>
    z.object({
      token: z.string().min(8).max(128),
      job_id: z.string().uuid(),
      stop_id: z.string().uuid().optional(),
      name: z.string().min(1).max(120),
      phone: z.string().max(40).optional(),
      note: z.string().max(300).optional(),
      mark_onboard: z.boolean().optional(),
      lat: z.number().gte(-90).lte(90).optional(),
      lng: z.number().gte(-180).lte(180).optional(),
    }).parse(i),
  )
  .handler(async ({ data }) => {
    const link = await requireDriver(data.token);
    const supabaseAdmin = await admin();
    const job = await ensureOwnsJob(supabaseAdmin, data.job_id, link.subject_id!);
    const groupId = await ensureGroup(supabaseAdmin, job.id, link.subject_id!);
    let stopId = data.stop_id;
    if (!stopId) {
      const { data: lastStop } = await supabaseAdmin.from("group_stops")
        .select("id").eq("group_id", groupId).order("stop_index", { ascending: false }).limit(1).maybeSingle();
      stopId = (lastStop as any)?.id ?? undefined;
    }
    const now = new Date().toISOString();
    const { data: pax, error } = await supabaseAdmin.from("pax").insert({
      job_id: job.id,
      group_id: groupId,
      stop_id: stopId ?? null,
      name: data.name.trim(),
      phone: data.phone?.trim() || null,
      note: data.note?.trim() || null,
      status: (data.mark_onboard ? "onboard" : "pending") as never,
      boarded_at: data.mark_onboard ? now : null,
      boarded_method: data.mark_onboard ? "manual" : null,
    } as any).select("id").single();
    if (error) throw new Error(error.message);
    if (stopId) {
      // Increment pax_count on the stop.
      const { data: cur } = await supabaseAdmin.from("group_stops").select("pax_count").eq("id", stopId).maybeSingle();
      await supabaseAdmin.from("group_stops").update({ pax_count: ((cur as any)?.pax_count ?? 0) + 1 } as never).eq("id", stopId);
    }
    await logMap(
      job.company_id, job.id, link.subject_id!,
      data.mark_onboard ? "pax_boarded" : "pax_added",
      data.mark_onboard ? `Boarded: ${data.name.trim()}` : `Added passenger: ${data.name.trim()}`,
      { pax_id: (pax as any).id, pax_name: data.name.trim(), stop_id: stopId ?? null },
      data.lat, data.lng,
    );
    return { pax_id: (pax as any).id as string };
  });

// ── Set the final destination + mark trip in-flight ─────────────────────
export const otgSetDestination = createServerFn({ method: "POST" })
  .inputValidator((i: unknown) =>
    z.object({
      token: z.string().min(8).max(128),
      job_id: z.string().uuid(),
      to_location: z.string().min(1).max(200),
      dropoff_place_id: z.string().max(200).optional(),
      dropoff_display_name: z.string().max(200).optional(),
      dropoff_lat: z.number().gte(-90).lte(90).optional(),
      dropoff_lng: z.number().gte(-180).lte(180).optional(),
    }).parse(i),
  )
  .handler(async ({ data }) => {
    const link = await requireDriver(data.token);
    const supabaseAdmin = await admin();
    const job = await ensureOwnsJob(supabaseAdmin, data.job_id, link.subject_id!);
    const { error } = await supabaseAdmin.from("jobs").update({
      to_location: data.to_location,
      dropoff_place_id: data.dropoff_place_id || null,
      dropoff_display_name: data.dropoff_display_name || null,
    } as never).eq("id", job.id);
    if (error) throw new Error(error.message);
    await logMap(job.company_id, job.id, link.subject_id!, "in_progress", `Destination set: ${data.to_location}`, { to_location: data.to_location }, data.dropoff_lat, data.dropoff_lng);
    return { ok: true };
  });

// ── Coordinator: mark an OTG trip as reviewed ───────────────────────────
export const markJobReviewed = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ job_id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    // Direct authenticated update — RLS ("Company owners manage jobs")
    // enforces that only the owning coordinator (or an admin) can flip
    // needs_review on their own trip. No SECURITY DEFINER RPC needed.
    const { error } = await context.supabase
      .from("jobs")
      .update({ needs_review: false } as never)
      .eq("id", data.job_id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ── Coordinator: list companies an OTG trip can be reassigned to ────────
// Used by JobFormDialog to render a "Coordinator company" picker while the
// OTG trip is still `created_by_driver && needs_review`. Returns the
// driver's home coordinator plus any active partner coordinators.
export const listOtgReassignTargets = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ job_id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const supabaseAdmin = await admin();
    const { data: job } = await supabaseAdmin.from("jobs")
      .select("id, company_id, driver_id, created_by_driver, needs_review")
      .eq("id", data.job_id).maybeSingle();
    if (!job) throw new Error("job_not_found");
    // Caller must own the trip (RLS-checked via context.supabase read).
    const { data: ownRead } = await context.supabase
      .from("jobs").select("id").eq("id", data.job_id).maybeSingle();
    if (!ownRead) throw new Error("forbidden");
    const driverId = (job as any).driver_id as string | null;
    let homeId = (job as any).company_id as string;
    if (driverId) {
      const { data: drv } = await supabaseAdmin.from("drivers")
        .select("linked_company_id, company_id").eq("id", driverId).maybeSingle();
      homeId = ((drv as any)?.linked_company_id ?? (drv as any)?.company_id ?? homeId) as string;
    }
    const { data: conns } = await supabaseAdmin.from("coordinator_connections")
      .select("owner_company_id, partner_company_id, status")
      .eq("status", "active")
      .or(`owner_company_id.eq.${homeId},partner_company_id.eq.${homeId}`);
    const ids = new Set<string>([homeId, (job as any).company_id]);
    for (const c of (conns ?? []) as any[]) {
      if (c.owner_company_id !== homeId) ids.add(c.owner_company_id);
      if (c.partner_company_id !== homeId) ids.add(c.partner_company_id);
    }
    const { data: companies } = await supabaseAdmin.from("companies")
      .select("id, name").in("id", Array.from(ids));
    return {
      home_company_id: homeId,
      current_company_id: (job as any).company_id as string,
      coordinators: ((companies ?? []) as any[]).map((c) => ({
        id: c.id as string,
        name: (c.name as string) ?? "Company",
      })),
    };
  });

