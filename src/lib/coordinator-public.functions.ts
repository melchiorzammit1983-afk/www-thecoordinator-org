import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { maltaWallTimeToUtcIso } from "./time";
import { DEFAULT_ARRIVAL_RADIUS_M } from "./gps.constants";
import { BOARDING_OVERRIDE_MS } from "./boarding.constants";
import {
  EMERGENCY_OVERRIDE_ACTION_LABELS,
  EMERGENCY_OVERRIDE_ACTIONS,
  EMERGENCY_OVERRIDE_REASON_LABELS,
  EMERGENCY_OVERRIDE_REASONS,
  EMERGENCY_OVERRIDE_TO_STATUS,
  isBackwardStatusTransition,
} from "./emergency-override";

async function getAdminClient() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

/**
 * Loads the coordinator's branding (logo + optional advert) for a company,
 * respecting both the coordinator's on/off switch AND the admin
 * `branding_advert` feature entitlement. Returns null when nothing should
 * be shown.
 */
async function loadCompanyBranding(companyId: string) {
  const supabaseAdmin = await getAdminClient();
  const [{ data: co }, { data: ent }] = await Promise.all([
    supabaseAdmin.from("companies")
      .select("id, name, logo_url, advert_url, advert_link, advert_caption, advert_enabled, custom_link")
      .eq("id", companyId).maybeSingle(),
    supabaseAdmin.from("company_feature_entitlements")
      .select("enabled, expires_at")
      .eq("company_id", companyId).eq("feature", "branding_advert").maybeSingle(),
  ]);
  if (!co) return null;
  const now = Date.now();
  const adminAllows = !ent
    ? true
    : !!ent.enabled && (!ent.expires_at || new Date(ent.expires_at).getTime() > now);
  const advertOn = adminAllows && !!(co as any).advert_enabled && !!(co as any).advert_url;
  return {
    company_name: (co as any).name as string,
    logo_url: ((co as any).logo_url as string | null) ?? null,
    advert_url: advertOn ? ((co as any).advert_url as string | null) : null,
    advert_link: advertOn ? ((co as any).advert_link as string | null) : null,
    advert_caption: advertOn ? ((co as any).advert_caption as string | null) : null,
    booking_token: ((co as any).custom_link as string | null) ?? null,
  };
}

/**
 * Returns the company's feature map (same shape as `getMyFeatures`) so public
 * portals can hide widgets when admin toggles a feature off. Defaults every
 * catalog key to `true`; entries in `company_feature_entitlements` override.
 */
async function loadCompanyFeatures(companyId: string): Promise<Record<string, boolean>> {
  const supabaseAdmin = await getAdminClient();
  const { FEATURE_KEYS } = await import("@/lib/features");
  const features: Record<string, boolean> = {};
  for (const k of FEATURE_KEYS) features[k] = true;
  const { data: rows } = await supabaseAdmin
    .from("company_feature_entitlements")
    .select("feature, enabled, expires_at")
    .eq("company_id", companyId);
  const now = Date.now();
  for (const r of rows ?? []) {
    const expired = r.expires_at ? new Date(r.expires_at).getTime() <= now : false;
    features[r.feature as string] = !!r.enabled && !expired;
  }
  return features;
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

    // Driver manifest is always scoped to jobs assigned to this driver row
    // (including virtual coordinator/partner drivers — they see only trips
    // that were explicitly assigned to them, not every company job).
    type DriverRow = {
      id: string; name: string; kind: string | null;
      phone: string | null;
      seats_available: number | null; availability_note: string | null;
      profile_updated_at: string | null;
      onboarded_at: string | null;
      car_make_model: string | null;
      plate: string | null;
    };
    let driverRow: DriverRow | null = null;
    if (link.subject_id) {
      const { data: drv } = await supabaseAdmin.from("drivers")
        .select("id, name, kind, phone, seats_available, availability_note, profile_updated_at, onboarded_at, car_make_model, plate")
        .eq("id", link.subject_id).maybeSingle();
      driverRow = (drv as DriverRow | null) ?? null;
    }

    let q = supabaseAdmin.from("jobs")
      .select("id, from_location, to_location, pickup_display_name, dropoff_display_name, pickup_lat, pickup_lng, dropoff_lat, dropoff_lng, date, time, pickup_at, flightorship, from_flight, to_flight, flight_status, flight_status_note, flight_status_updated_at, vehicle, qr_strict_mode, tracking_enabled, clientcompanyname, driver_accepted_at, deletion_requested_at, driver_cancel_requested_at, driver_cancel_reason, driver_cancel_note, status, payment_status, driver_id, driver_hidden_at, grouped_count, grouped_at, group_id, group_name, group_note, created_by_driver, needs_review, drivers(name), pax(id,name,status,boarded_at), job_labels(trip_labels(id,name,color))")
      .order("pickup_at", { ascending: true, nullsFirst: false })
      .order("date", { ascending: true })
      .order("time", { ascending: true });
    if (link.subject_id) {
      q = q.eq("driver_id", link.subject_id);
    } else {
      q = q.or(`company_id.eq.${link.company_id},executor_company_id.eq.${link.company_id},origin_company_id.eq.${link.company_id},dispatch_chain_company_ids.cs.{${link.company_id}}`);
    }
    // Keep the driver's list light: only include active trips + recently
    // finished/cancelled ones (last 48h). Older completed history is not
    // sent to the phone — the driver can still un-hide via server tools if
    // needed. Hard cap the result set to keep manifest fetches bounded.
    const recentCutoff = new Date(Date.now() - 48 * 60 * 60_000).toISOString();
    q = q.or(
      `status.not.in.(completed,cancelled),pickup_at.gte.${recentCutoff}`,
    ).limit(200);

    const { data: jobsRaw, error } = await q;
    if (error) throw new Error(error.message);



    // Backfill missing hotel/business names so the driver never sees a raw
    // street address when a place lookup would resolve one. Best-effort:
    // silently no-ops on missing keys / feature disabled / insufficient
    // points (falls back to the raw address).
    const needsName = (jobsRaw ?? [])
      .filter((j: any) =>
        (!j.pickup_display_name && j.from_location) ||
        (!j.dropoff_display_name && j.to_location),
      )
      .map((j: any) => j.id as string);
    if (needsName.length) {
      try {
        const { backfillJobNamesServer } = await import("@/lib/places.functions");
        await backfillJobNamesServer(needsName);
        const { data: refreshed } = await supabaseAdmin
          .from("jobs")
          .select("id, pickup_display_name, dropoff_display_name")
          .in("id", needsName);
        const byId = new Map<string, any>((refreshed ?? []).map((r: any) => [r.id, r]));
        for (const j of jobsRaw ?? []) {
          const patch = byId.get((j as any).id);
          if (patch) {
            (j as any).pickup_display_name = patch.pickup_display_name ?? (j as any).pickup_display_name;
            (j as any).dropoff_display_name = patch.dropoff_display_name ?? (j as any).dropoff_display_name;
          }
        }
      } catch { /* best-effort */ }
    }

    const jobs = (jobsRaw ?? []).map((j: any) => ({
      ...j,
      labels: Array.isArray(j.job_labels) ? j.job_labels.map((x: any) => x.trip_labels).filter(Boolean) : [],
    }));
    const driver = driverRow
      ? {
          id: driverRow.id, name: driverRow.name,
          phone: driverRow.phone,
          seats_available: driverRow.seats_available,
          availability_note: driverRow.availability_note,
          profile_updated_at: driverRow.profile_updated_at,
          onboarded_at: driverRow.onboarded_at,
          car_make_model: driverRow.car_make_model,
          plate: driverRow.plate,
        }
      : null;
    // Unread coordinator messages per job
    const jobIds = (jobs ?? []).map((j: { id: string }) => j.id);
    let unread: Record<string, number> = {};
    if (jobIds.length) {
      // Skip driver_coord rows tied to a different driver (i.e. a previous
      // driver on a since-reassigned trip) so a new driver never inherits
      // the old driver's unread counter.
      const { data: msgs } = await supabaseAdmin.from("trip_messages")
        .select("job_id, thread_kind, driver_id")
        .in("job_id", jobIds).eq("sender_kind", "coordinator").is("read_by_driver_at", null);
      const filteredMsgs = (msgs ?? []).filter((m: any) =>
        m.thread_kind !== "driver_coord" || !m.driver_id || m.driver_id === link.subject_id
      );
      unread = filteredMsgs.reduce((acc: Record<string, number>, m: { job_id: string }) => {
        acc[m.job_id] = (acc[m.job_id] ?? 0) + 1; return acc;
      }, {});
    }
    const jobsWithUnread = (jobs ?? []).map((j: { id: string }) => ({ ...j, unread_messages: unread[j.id] ?? 0 }));
    const [branding, features, companySettings] = await Promise.all([
      loadCompanyBranding(link.company_id),
      loadCompanyFeatures(link.company_id),
      supabaseAdmin.from("companies")
        .select("safety_mode_threshold_kmh, safety_mode_enabled, safety_mode_allow_override, auto_next_job_enabled, arrival_radius_m")
        .eq("id", link.company_id)
        .maybeSingle(),
    ]);
    return {
      link,
      jobs: jobsWithUnread,
      driver,
      branding,
      features,
      companySettings: {
        safety_mode_threshold_kmh: (companySettings.data as any)?.safety_mode_threshold_kmh ?? 10,
        safety_mode_enabled: (companySettings.data as any)?.safety_mode_enabled ?? true,
        safety_mode_allow_override: (companySettings.data as any)?.safety_mode_allow_override ?? true,
        auto_next_job_enabled: (companySettings.data as any)?.auto_next_job_enabled ?? true,
        arrival_radius_m: (companySettings.data as any)?.arrival_radius_m ?? DEFAULT_ARRIVAL_RADIUS_M,
      },
    };
  });

// ---------- Trip messages (driver side) ----------

export const listTripMessages = createServerFn({ method: "GET" })
  .inputValidator((i: unknown) =>
    z.object({
      token: z.string().min(8).max(128),
      job_id: z.string().uuid(),
      thread_kind: z.enum(["group", "driver_client", "driver_coord"]).optional().default("group"),
      pax_id: z.string().uuid().nullish(),
    }).parse(i),
  )
  .handler(async ({ data }) => {
    const { link, job, supabaseAdmin } = await loadDriverJob(data.token, data.job_id);
    let ids: string[] = [data.job_id];
    const gid = (job as any).group_id as string | null;
    if (gid) {
      const { data: sibs } = await supabaseAdmin.from("jobs").select("id").eq("group_id" as any, gid);
      const sibIds = (sibs ?? []).map((s: any) => s.id as string);
      if (sibIds.length) ids = sibIds;
    }
    let q = supabaseAdmin.from("trip_messages")
      .select("id, sender_kind, sender_label, body, created_at, read_by_driver_at, thread_kind, client_identity_id, pax_id")
      .in("job_id", ids).order("created_at", { ascending: true });
    if (data.thread_kind === "driver_client") {
      q = q.eq("thread_kind", "driver_client");
      // Private driver↔client thread is scoped to the driver — reassigned
      // drivers never see the previous driver's private conversation.
      if (link.subject_id) q = q.eq("driver_id" as any, link.subject_id);
      if (data.pax_id) {
        // Scope to just this passenger's private thread with the driver.
        const { data: idents } = await supabaseAdmin
          .from("client_link_identities").select("id").eq("pax_id", data.pax_id);
        const idIds = (idents ?? []).map((r: any) => r.id as string);
        const orParts: string[] = [`pax_id.eq.${data.pax_id}`];
        for (const i of idIds) orParts.push(`client_identity_id.eq.${i}`);
        q = q.or(orParts.join(","));
      }
    } else if (data.thread_kind === "driver_coord") {
      q = q.eq("thread_kind", "driver_coord");
      // Same for driver↔coordinator private thread.
      if (link.subject_id) q = q.eq("driver_id" as any, link.subject_id);
    } else {
      // group: legacy null + explicit group; exclude the two private side-channels
      q = q.or("thread_kind.is.null,thread_kind.eq.group");
    }
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    const unreadIds = (rows ?? []).filter((r) => r.sender_kind !== "driver" && !r.read_by_driver_at).map((r) => r.id);
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
      thread_kind: z.enum(["group", "driver_client", "driver_coord"]).optional().default("group"),
      pax_id: z.string().uuid().nullish(),
    }).parse(i),
  )
  .handler(async ({ data }) => {
    const { link, job, supabaseAdmin } = await loadDriverJob(data.token, data.job_id);
    let clientIdentityId: string | null = null;
    let paxId: string | null = null;
    if (data.thread_kind === "driver_client" && data.pax_id) {
      paxId = data.pax_id;
      const { data: ident } = await supabaseAdmin
        .from("client_link_identities")
        .select("id").eq("pax_id", data.pax_id)
        .order("last_seen_at", { ascending: false }).limit(1).maybeSingle();
      clientIdentityId = (ident as any)?.id ?? null;
    }
    const isPrivateDriverThread =
      data.thread_kind === "driver_client" || data.thread_kind === "driver_coord";
    const { error } = await supabaseAdmin.from("trip_messages").insert({
      job_id: data.job_id,
      company_id: job.company_id,
      sender_kind: "driver",
      sender_label: link.subject_label ?? "Driver",
      body: data.body,
      thread_kind: data.thread_kind,
      client_identity_id: clientIdentityId,
      pax_id: paxId,
      driver_id: isPrivateDriverThread ? link.subject_id ?? null : null,
    } as never);
    if (error) throw new Error(error.message);
    return { ok: true };
  });


export const updateDriverProfile = createServerFn({ method: "POST" })
  .inputValidator((i: unknown) =>
    z.object({
      token: z.string().min(8).max(128),
      name: z.string().trim().min(1).max(120).optional(),
      phone: z.string().trim().min(1).max(40).optional(),
      car_make_model: z.string().trim().max(120).nullable().optional(),
      plate: z.string().trim().max(40).nullable().optional(),
      seats_available: z.number().int().min(0).max(200).nullable().optional(),
      availability_note: z.string().trim().max(500).nullable().optional(),
    }).parse(i),
  )
  .handler(async ({ data }) => {
    const link = await resolveToken(data.token, "driver");
    if (!link || !link.subject_id) throw new Error("driver_link_required");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const patch: Record<string, unknown> = {
      profile_updated_at: new Date().toISOString(),
      onboarded_at: new Date().toISOString(), // marks completion of first-time onboarding
    };
    if (data.name !== undefined) patch.name = data.name;
    if (data.phone !== undefined) patch.phone = data.phone;
    if (data.car_make_model !== undefined) patch.car_make_model = data.car_make_model;
    if (data.plate !== undefined) patch.plate = data.plate;
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

// Driver-side "trip finished" summary. Records final price, currency, payment
// method, distance and duration. Sets status=completed. Price info is stored
// on jobs and is ONLY exposed via coordinator server functions — driver &
// client endpoints use explicit column projections that omit these fields.
export const driverFinalizeTrip = createServerFn({ method: "POST" })
  .inputValidator((i: unknown) =>
    z.object({
      token: z.string().min(8).max(128),
      job_id: z.string().uuid(),
      price_amount: z.number().nonnegative().max(1_000_000).nullable().optional(),
      price_currency: z.string().trim().min(3).max(4).optional(),
      payment_method: z.enum(["cash", "invoice"]).nullable().optional(),
      driver_reported_km: z.number().nonnegative().max(100_000).nullable().optional(),
      note: z.string().trim().max(500).optional(),
    }).parse(i),
  )
  .handler(async ({ data }) => {
    const { job, link, supabaseAdmin } = await loadDriverJob(data.token, data.job_id);
    const now = new Date();
    const startedAt = (job as any).driver_started_at
      ?? (job as any).pickup_at
      ?? (job as any).created_at
      ?? now.toISOString();
    const startedMs = new Date(startedAt).getTime();
    const durMin = Number.isFinite(startedMs)
      ? Math.max(0, Math.round((now.getTime() - startedMs) / 60000))
      : null;

    const patch: Record<string, unknown> = {
      status: "completed",
      driver_completed_at: now.toISOString(),
      driver_actual_minutes: durMin,
      grouped_count: null,
      grouped_at: null,
    };
    if (data.price_amount !== undefined) {
      patch.price_amount = data.price_amount;
      patch.price_currency = (data.price_currency ?? "EUR").toUpperCase();
      patch.price_set_by = "driver";
      patch.price_set_at = now.toISOString();
    }
    if (data.payment_method !== undefined && data.payment_method !== null) {
      patch.payment_method = data.payment_method;
      // "cash" = paid on the spot by the client → mark payment as paid.
      // "invoice" = billed to the trip creator → keep payment pending until settled.
      patch.payment_status = data.payment_method === "cash" ? "paid" : "pending";
    }
    if (data.driver_reported_km !== undefined) {
      patch.driver_reported_km = data.driver_reported_km;
    }
    if (data.note !== undefined) {
      patch.driver_note = data.note ?? null;
    }


    const { error } = await supabaseAdmin.from("jobs")
      .update(patch as never).eq("id", data.job_id);
    if (error) throw new Error(error.message);

    // Log a short chat note so the coordinator sees the summary in-thread.
    // The chat body does NOT include the price — only the coordinator UI shows
    // the amount, sourced directly from jobs and gated by dispatch-chain RLS.
    const parts: string[] = ["✅ Trip completed"];
    if (durMin != null) parts.push(`~${durMin} min`);
    if (data.driver_reported_km) parts.push(`${data.driver_reported_km} km`);
    if (data.payment_method) parts.push(data.payment_method === "cash" ? "paid by client" : "invoice to company");
    if (data.note) parts.push(`— ${data.note}`);
    await supabaseAdmin.from("trip_messages").insert({
      job_id: data.job_id,
      company_id: job.company_id,
      sender_kind: "driver",
      sender_label: link.subject_label ?? "Driver",
      body: parts.join(" · "),
      thread_kind: "driver_coord",
      driver_id: link.subject_id ?? null,
    } as never);

    // Auto-dissolve group if all siblings done (same logic as updateJobStatus).
    const gid = (job as any).group_id as string | null | undefined;
    if (gid) {
      const { data: siblings } = await supabaseAdmin.from("jobs")
        .select("id, status").eq("group_id" as any, gid);
      const allDone = (siblings ?? []).every((s: any) =>
        s.id === data.job_id || s.status === "completed" || s.status === "cancelled");
      if (allDone) {
        await supabaseAdmin.from("jobs")
          .update({ group_id: null, grouped_count: null, grouped_at: null } as never)
          .eq("group_id" as any, gid);
      }
    }

    return { ok: true, driver_actual_minutes: durMin };
  });

// Read a specific set of numbers the driver needs to fill in the summary
// dialog. Excludes price/payment_method — the driver enters these fresh.
export const getDriverTripSummaryPrefill = createServerFn({ method: "GET" })
  .inputValidator((i: unknown) =>
    z.object({ token: z.string().min(8).max(128), job_id: z.string().uuid() }).parse(i),
  )
  .handler(async ({ data }) => {
    const { job } = await loadDriverJob(data.token, data.job_id);
    const j: any = job;
    return {
      pickup_at: j.pickup_at as string | null,
      driver_started_at: j.driver_started_at as string | null,
      created_at: j.created_at as string | null,
      from_location: j.from_location as string,
      to_location: j.to_location as string,
    };
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

export const getDriverStatement = createServerFn({ method: "POST" })
  .inputValidator((i: unknown) =>
    z.object({
      token: z.string().min(8).max(128),
      from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      payment: z.enum(["all", "paid", "pending"]).optional(),
      status: z.array(z.string()).optional(),
      flight_status: z.array(z.string()).optional(),
      flight_contains: z.string().trim().max(80).optional(),
      from_contains: z.string().trim().max(120).optional(),
      to_contains: z.string().trim().max(120).optional(),
      pax_contains: z.string().trim().max(120).optional(),
      search: z.string().trim().max(200).optional(),
    }).parse(i),
  )
  .handler(async ({ data }) => {
    const link = await resolveToken(data.token, "driver");
    if (!link) throw new Error("invalid_or_expired_link");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    let q = supabaseAdmin.from("jobs")
      .select(`
        id, date, time, pickup_at, status, payment_status,
        from_location, to_location, from_flight, to_flight, flightorship,
        flight_status, flight_status_note,
        clientcompanyname, vehicle,
        price_amount, price_currency, payment_method, price_set_by,
        paid_at, paid_amount, paid_method, paid_reference, paid_by_role,
        driver_paid_at, driver_paid_amount, driver_paid_method, driver_paid_reference, driver_payout_status,
        driver_actual_minutes, driver_reported_km,
        driver_accepted_at, deletion_requested_at, created_at,
        drivers(id,name,phone,vehicle),
        pax(id,name,status,boarded_at),
        job_labels(trip_labels(id,name,color))
      `)
      .order("date", { ascending: true }).order("time", { ascending: true })
      .limit(5000);
    if (link.subject_id) {
      q = q.eq("driver_id", link.subject_id);
    } else {
      q = q.or(`company_id.eq.${link.company_id},executor_company_id.eq.${link.company_id},origin_company_id.eq.${link.company_id},dispatch_chain_company_ids.cs.{${link.company_id}}`);
    }
    if (data.from) q = q.gte("date", data.from);
    if (data.to) q = q.lte("date", data.to);
    if (data.payment && data.payment !== "all") q = q.eq("payment_status", data.payment);
    if (data.status?.length) q = q.in("status", data.status as never);
    if (data.flight_status?.length) q = q.in("flight_status", data.flight_status as never);
    if (data.flight_contains) {
      const fc = data.flight_contains.replace(/[%,()]/g, "");
      if (fc) q = q.or(`from_flight.ilike.%${fc}%,to_flight.ilike.%${fc}%,flightorship.ilike.%${fc}%`);
    }

    if (data.from_contains) q = q.ilike("from_location", `%${data.from_contains}%`);
    if (data.to_contains) q = q.ilike("to_location", `%${data.to_contains}%`);
    if (data.search) {
      const s = data.search.replace(/[%,]/g, "");
      q = q.or(`from_location.ilike.%${s}%,to_location.ilike.%${s}%,flightorship.ilike.%${s}%,from_flight.ilike.%${s}%,to_flight.ilike.%${s}%,clientcompanyname.ilike.%${s}%`);
    }
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    let jobs = (rows ?? []) as any[];
    if (data.pax_contains) {
      const needle = data.pax_contains.toLowerCase();
      jobs = jobs.filter((j) =>
        (j.pax ?? []).some((p: any) => (p.name ?? "").toLowerCase().includes(needle))
      );
    }
    return jobs.map((j) => {
      const pax = j.pax ?? [];
      const labels = (j.job_labels ?? []).map((x: any) => x.trip_labels).filter(Boolean);
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
        clientcompanyname: j.clientcompanyname ?? "",
        vehicle: j.vehicle ?? "",
        driver_name: j.drivers?.name ?? "",
        driver_phone: j.drivers?.phone ?? "",
        driver_vehicle: j.drivers?.vehicle ?? "",
        pax_count: pax.length,
        pax_names: pax.map((p: any) => p.name).join(", "),
        pax_boarded: pax.filter((p: any) => !!p.boarded_at).length,
        labels: labels.map((l: any) => l.name).join(", "),
        price_amount: j.price_amount != null ? Number(j.price_amount) : null,
        price_currency: j.price_currency ?? "",
        price_display: j.price_amount != null
          ? `${Number(j.price_amount).toFixed(2)} ${j.price_currency ?? ""}`.trim()
          : "",
        payment_method: j.payment_method ?? "",
        price_set_by: j.price_set_by ?? "",
        driver_actual_minutes: j.driver_actual_minutes ?? null,
        driver_reported_km: j.driver_reported_km != null ? Number(j.driver_reported_km) : null,
        driver_accepted_at: j.driver_accepted_at,
        deletion_requested_at: j.deletion_requested_at,
        created_at: j.created_at,
        paid_at: j.paid_at ?? null,
        paid_amount: j.paid_amount != null ? Number(j.paid_amount) : null,
        paid_method: j.paid_method ?? "",
        paid_reference: j.paid_reference ?? "",
        paid_by_role: j.paid_by_role ?? "",
        driver_paid_at: j.driver_paid_at ?? null,
        driver_paid_amount: j.driver_paid_amount != null ? Number(j.driver_paid_amount) : null,
        driver_paid_method: j.driver_paid_method ?? "",
        driver_paid_reference: j.driver_paid_reference ?? "",
        driver_payout_status: j.driver_payout_status ?? "pending",
      };
    });
  });

// Driver marks their own payout received via magic-link token.
export const driverMarkPayoutReceived = createServerFn({ method: "POST" })
  .inputValidator((i: unknown) =>
    z.object({
      token: z.string().min(8).max(128),
      job_id: z.string().uuid(),
      amount: z.number().nonnegative().max(1_000_000).optional(),
      method: z.enum(["cash", "bank_transfer", "card", "other"]).optional(),
      reference: z.string().trim().max(200).optional(),
      clear: z.boolean().optional(),
    }).parse(i),
  )
  .handler(async ({ data }) => {
    const link = await resolveToken(data.token, "driver");
    if (!link || !link.subject_id) throw new Error("invalid_or_expired_link");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: job } = await supabaseAdmin
      .from("jobs")
      .select("id, driver_id, price_amount")
      .eq("id", data.job_id)
      .maybeSingle();
    if (!job || (job as any).driver_id !== link.subject_id) throw new Error("forbidden");
    if (data.clear) {
      const { error } = await supabaseAdmin
        .from("jobs")
        .update({
          driver_paid_at: null,
          driver_paid_amount: null,
          driver_paid_method: null,
          driver_paid_reference: null,
        } as never)
        .eq("id", data.job_id);
      if (error) throw new Error(error.message);
      return { ok: true, cleared: true };
    }
    const amt = data.amount != null ? Number(data.amount) : Number((job as any).price_amount ?? 0);
    const { error } = await supabaseAdmin
      .from("jobs")
      .update({
        driver_paid_at: new Date().toISOString(),
        driver_paid_amount: amt,
        driver_paid_method: data.method ?? null,
        driver_paid_reference: data.reference ?? null,
      } as never)
      .eq("id", data.job_id);
    if (error) throw new Error(error.message);
    return { ok: true, amount: amt };
  });



export const driverAcceptJob = createServerFn({ method: "POST" })
  .inputValidator((i: unknown) =>
    z.object({ token: z.string().min(8).max(128), job_id: z.string().uuid() }).parse(i),
  )
  .handler(async ({ data }) => {
    const link = await resolveToken(data.token, "driver");
    if (!link) throw new Error("invalid_or_expired_link");
    const { job, supabaseAdmin } = await loadDriverJob(data.token, data.job_id);

    // Cascade acceptance to every sibling in the same group_id that's still
    // assigned to this same driver and hasn't already been closed out. This
    // makes a grouped run a single "Accept" for the driver.
    const gid = (job as any).group_id as string | null | undefined;
    const driverId = (job as any).driver_id as string | null;
    let targetJobs: Array<{ id: string; driver_accepted_at: string | null }> = [
      { id: data.job_id, driver_accepted_at: (job as any).driver_accepted_at ?? null },
    ];
    if (gid && driverId) {
      const { data: sibs } = await supabaseAdmin.from("jobs")
        .select("id, driver_accepted_at, status")
        .eq("group_id" as any, gid)
        .eq("driver_id", driverId);
      const active = (sibs ?? []).filter((s: any) => s.status !== "completed" && s.status !== "cancelled");
      if (active.length) {
        targetJobs = active.map((s: any) => ({ id: s.id, driver_accepted_at: s.driver_accepted_at ?? null }));
      }
    }

    const nowIso = new Date().toISOString();
    const idsToStamp = targetJobs.filter((t) => !t.driver_accepted_at).map((t) => t.id);
    if (idsToStamp.length) {
      const { error } = await supabaseAdmin.from("jobs")
        .update({ driver_accepted_at: nowIso } as never)
        .in("id", idsToStamp);
      if (error) throw new Error(error.message);
    }

    // Announce once per newly-accepted leg so the coordinator chat reflects
    // each trip, not just the tapped one.
    for (const t of targetJobs) {
      if (t.driver_accepted_at) continue;
      await supabaseAdmin.from("trip_messages").insert({
        job_id: t.id,
        company_id: job.company_id,
        sender_kind: "system",
        sender_label: "System",
        body: `✅ ${link.subject_label ?? "Driver"} accepted this trip.`,
        thread_kind: "driver_coord",
        driver_id: link.subject_id ?? null,
      } as never);
    }

    // Withdraw any still-open price proposals from this driver on every
    // sibling — accepting one leg accepts the run.
    if (link.subject_id) {
      await supabaseAdmin.from("job_price_proposals").update({
        status: "recalled", responded_at: new Date().toISOString(),
      } as never)
        .in("job_id", targetJobs.map((t) => t.id))
        .eq("from_driver_id", link.subject_id)
        .in("status", ["proposed", "countered"]);
    }
    const cascadedIds = targetJobs.map((t) => t.id);
    await broadcastJobUpdate(
      [
        driverId ? `driver:${driverId}` : "",
        gid ? `group:${gid}` : "",
        ...cascadedIds.map((id) => `job:${id}`),
      ],
      { job_ids: cascadedIds, group_id: gid ?? null, kind: "accepted" },
    );
    return { ok: true, cascaded_ids: cascadedIds };
  });

export const driverRejectJob = createServerFn({ method: "POST" })
  .inputValidator((i: unknown) =>
    z.object({
      token: z.string().min(8).max(128),
      job_id: z.string().uuid(),
      reason: z.string().trim().max(500).optional(),
    }).parse(i),
  )
  .handler(async ({ data }) => {
    const link = await resolveToken(data.token, "driver");
    if (!link) throw new Error("invalid_or_expired_link");
    const { job, supabaseAdmin } = await loadDriverJob(data.token, data.job_id);
    const reason = data.reason?.trim() || "No reason given";
    // Unassign driver and clear acceptance so it lands back in the coordinator's Unassigned column.
    const { error } = await supabaseAdmin.from("jobs").update({
      driver_id: null,
      driver_accepted_at: null,
    } as never).eq("id", data.job_id);
    if (error) throw new Error(error.message);
    // Notify coordinator via trip chat so the alert surfaces on the card.
    await supabaseAdmin.from("trip_messages").insert({
      job_id: data.job_id,
      company_id: job.company_id,
      sender_kind: "driver",
      sender_label: link.subject_label ?? "Driver",
      body: `⚠️ Driver rejected this trip. Reason: ${reason}`,
      thread_kind: "driver_coord",
      driver_id: link.subject_id ?? null,
    } as never);
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
      .select("id, name, surname, client_email, from_location, to_location, date, time, pickup_at, status, room_number, jobs!job_id(pickup_display_name, dropoff_display_name)")
      .eq("company_id", link.company_id)
      .order("pickup_at", { ascending: true, nullsFirst: false });
    const filtered = link.subject_label
      ? q.eq("client_email", link.subject_label)
      : q;
    const { data: bookings, error } = await filtered;
    if (error) throw new Error(error.message);
    const branding = await loadCompanyBranding(link.company_id);
    // Promote display names from the linked job (if any) up to the booking object.
    type RawBooking = {
      jobs?: { pickup_display_name: string | null; dropoff_display_name: string | null } | null;
      [key: string]: unknown;
    };
    const normalised = (bookings as RawBooking[] ?? []).map((b) => ({
      ...b,
      pickup_display_name: b.jobs?.pickup_display_name ?? null,
      dropoff_display_name: b.jobs?.dropoff_display_name ?? null,
      jobs: undefined,
    }));
    return { link, bookings: normalised, branding };
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
      const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      const pickupIso = maltaWallTimeToUtcIso(dateStr, data.time);
      if (new Date(pickupIso).getTime() <= Date.now()) continue;
      rows.push({
        company_id: link.company_id,
        name: data.name,
        surname: data.surname,
        client_email: email,
        room_number: data.room_number || null,
        from_location: data.from_location,
        to_location: data.to_location,
        time: `${data.time}:00`,
        date: dateStr,
        pickup_at: pickupIso,
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
    // All drivers — including virtual coordinator/partner drivers — can only
    // act on jobs explicitly assigned to their driver row.
    if (job.driver_id !== link.subject_id) throw new Error("not_your_job");
  }

  return { link, job, supabaseAdmin };
}

/**
 * Record a driver-initiated action on the trip map so the coordinator can see
 * exactly what happened and where — no server-side automation, purely a
 * "carbon copy" of what the driver just did in the app. Falls back to the
 * driver's most recent `driver_locations` fix when the client can't provide
 * fresh coordinates. Never throws to the caller — logging must not block the
 * primary action.
 */
export const logDriverAction = createServerFn({ method: "POST" })
  .inputValidator((i: unknown) =>
    z.object({
      token: z.string().min(8).max(128),
      job_id: z.string().uuid(),
      action: z.enum([
        "en_route", "arrived_pickup", "in_progress", "completed", "back_to_waiting",
        "wait_started", "wait_ended",
        "boarding_requested", "boarding_approved",
        "pax_no_show", "pax_cancelled",
        "navigate_opened", "passenger_called",
      ]),
      lat: z.number().gte(-90).lte(90).optional(),
      lng: z.number().gte(-180).lte(180).optional(),
      accuracy_m: z.number().nonnegative().optional(),
      notes: z.string().max(400).optional(),
      meta: z.record(z.string(), z.any()).optional(),
    }).parse(i),
  )
  .handler(async ({ data }) => {
    try {
      const { job, supabaseAdmin } = await loadDriverJob(data.token, data.job_id);
      let lat = data.lat ?? null;
      let lng = data.lng ?? null;
      let acc = data.accuracy_m ?? null;
      if ((lat == null || lng == null) && (job as any).driver_id) {
        const { data: last } = await supabaseAdmin
          .from("driver_locations")
          .select("latitude, longitude, accuracy_m")
          .eq("driver_id", (job as any).driver_id)
          .eq("job_id", data.job_id)
          .order("captured_at", { ascending: false })
          .limit(1);
        const p = last?.[0];
        if (p) { lat = p.latitude as number; lng = p.longitude as number; acc = (p.accuracy_m as number) ?? acc; }
      }
      await supabaseAdmin.from("trip_map_events").insert({
        job_id: data.job_id,
        company_id: (job as any).executor_company_id ?? (job as any).company_id,
        driver_id: (job as any).driver_id,
        event_type: data.action,
        lat, lng, accuracy_m: acc,
        notes: data.notes ?? null,
        meta: (data.meta ?? {}) as any,
      } as any);
      return { ok: true };
    } catch (e: any) {
      // Never block the primary action if logging fails.
      return { ok: false, error: String(e?.message ?? e) };
    }
  });


export const listJobPaxDriver = createServerFn({ method: "GET" })
  .inputValidator((i: unknown) =>
    z.object({ token: z.string().min(8).max(128), job_id: z.string().uuid() }).parse(i),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await loadDriverJob(data.token, data.job_id);
    const { data: pax, error } = await supabaseAdmin.from("pax")
      .select("id, name, status, boarded_at, boarded_method, noshow_at, cancelled_at")
      .eq("job_id", data.job_id).order("name");
    if (error) throw new Error(error.message);
    return pax ?? [];
  });

const DRIVER_RETURN_TO_WAITING_STATUSES = new Set(["en_route", "arrived"]);
const DRIVER_EMERGENCY_OVERRIDE_ALLOWED_STATUSES = new Set(["pending", "en_route", "arrived", "in_progress", "active"]);

/** Radius (metres) inside which "Arrived at pickup" is silently accepted. */
const ARRIVAL_PICKUP_RADIUS_M = 150;

const ARRIVAL_OVERRIDE_REASONS = [
  "wrong_pin",
  "blocked_access",
  "passenger_meeting_elsewhere",
  "other",
] as const;

function haversineMetersLL(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

/**
 * Broadcast a job/group update to the Supabase Realtime broadcast topic.
 * Bypasses RLS (broadcasts are unauthenticated by design) so magic-link
 * viewers (driver / client tracking page) receive push updates without
 * needing SELECT on `jobs`. Best-effort — never throws to the caller.
 */
async function broadcastJobUpdate(
  topics: string[],
  payload: { job_ids: string[]; group_id?: string | null; kind: string },
) {
  try {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) return;
    const uniqueTopics = Array.from(new Set(topics.filter(Boolean)));
    if (!uniqueTopics.length) return;
    await fetch(`${url}/realtime/v1/api/broadcast`, {
      method: "POST",
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messages: uniqueTopics.map((topic) => ({
          topic,
          event: "jobs_updated",
          payload,
          private: false,
        })),
      }),
    });
  } catch { /* never block */ }
}



export const updateJobStatus = createServerFn({ method: "POST" })
  .inputValidator((i: unknown) =>
    z.object({
      token: z.string().min(8).max(128),
      job_id: z.string().uuid(),
      status: z.enum(["pending", "en_route", "arrived", "in_progress", "active", "completed"]),
      lat: z.number().gte(-90).lte(90).optional(),
      lng: z.number().gte(-180).lte(180).optional(),
      accuracy_m: z.number().nonnegative().optional(),
      override_reason: z.enum(ARRIVAL_OVERRIDE_REASONS).optional(),
      override_note: z.string().max(400).optional(),
      correction_note: z.string().max(400).optional(),
    }).parse(i),
  )
  .handler(async ({ data }) => {
    const { job, supabaseAdmin } = await loadDriverJob(data.token, data.job_id);
    const prevStatus = job.status ?? null;
    const companyId: string = (job as any).executor_company_id ?? (job as any).company_id;
    const now = new Date().toISOString();
    const patch: Record<string, unknown> = { status: data.status };

    // Correction path — reverting to an earlier status. Do NOT wipe timestamps
    // (we keep them so history stays intact); log the correction to the map
    // so the coordinator sees the driver walked something back.
    const isCorrection = data.status === "pending" && prevStatus !== "pending";
    if (isCorrection) {
      if (!DRIVER_RETURN_TO_WAITING_STATUSES.has(prevStatus ?? "")) {
        throw new Error("trip_cannot_return_to_waiting");
      }
      // Keep driver_started_at / driver_completed_at as-is (audit trail).
    }
    // First "on the way" transition starts the trip timer.
    if (data.status === "en_route" && !(job as any).driver_started_at) {
      patch.driver_started_at = new Date().toISOString();
    }

    // ── Arrival GPS advisory ────────────────────────────────────────────────
    // Not a hard geofence — if the driver's device provides a fresh GPS fix
    // and we know the pickup coordinates, refuse the arrival unless they
    // pick an explicit override reason. Missing/stale GPS or missing pickup
    // coords means we can't advise, so we accept.
    if (data.status === "arrived" && !data.override_reason) {
      const pLat = (job as any).pickup_lat as number | null;
      const pLng = (job as any).pickup_lng as number | null;
      if (
        pLat != null && pLng != null &&
        data.lat != null && data.lng != null
      ) {
        const distance = haversineMetersLL(data.lat, data.lng, pLat, pLng);
        if (distance > ARRIVAL_PICKUP_RADIUS_M) {
          const err: any = new Error(
            `too_far_from_pickup:${Math.round(distance)}:${ARRIVAL_PICKUP_RADIUS_M}`,
          );
          err.code = "too_far_from_pickup";
          err.distance_m = Math.round(distance);
          err.radius_m = ARRIVAL_PICKUP_RADIUS_M;
          throw err;
        }
      }
    }

    // ── Phase 3 — Boarding gate: only fires on the → in_progress transition ──
    if (data.status === "in_progress") {
      const { data: paxRows } = await supabaseAdmin
        .from("pax")
        .select("id, status")
        .eq("job_id", data.job_id);
      const hasPendingPax = (paxRows ?? []).some((p: any) => p.status === "pending");
      if (hasPendingPax) {
        const { data: approval } = await supabaseAdmin
          .from("job_boarding_approvals")
          .select("id, status")
          .eq("job_id", data.job_id)
          .in("status", ["approved", "overridden"])
          .limit(1)
          .maybeSingle();
        if (!approval) {
          throw new Error("partial_boarding_needs_approval");
        }
      }
    }

    if (data.status === "completed") {
      patch.grouped_count = null;
      patch.grouped_at = null;
      if (!(job as any).driver_completed_at) {
        patch.driver_completed_at = new Date().toISOString();
      }
    }
    const { error } = await supabaseAdmin.from("jobs")
      .update(patch as never).eq("id", data.job_id);
    if (error) throw new Error(error.message);

    // Auto-emit trip map pins for the transitions the DB trigger doesn't
    // already cover (en_route + back_to_waiting), so a pin lands even if the
    // driver's client-side logDriverAction call fails.
    if (data.status === "en_route" || (isCorrection && data.status === "pending")) {
      const { insertTripMapEvent } = await import("@/lib/trip-map.server");
      await insertTripMapEvent(supabaseAdmin, {
        jobId: job.id,
        companyId,
        driverId: (job as any).driver_id ?? null,
        eventType: data.status === "en_route" ? "en_route" : "back_to_waiting",
        lat: data.lat ?? null,
        lng: data.lng ?? null,
        accuracyM: data.accuracy_m ?? null,
        meta: { from: prevStatus, to: data.status },
      });
    }

    // ── Correction / arrival-override map event ────────────────────────────
    // Record the walk-back or the "I really am here" override as a distinct
    // pin so the coordinator sees the correction without us destroying the
    // primary status log written by the DB trigger.
    if (isCorrection || (data.status === "arrived" && data.override_reason)) {
      try {
        await supabaseAdmin.from("trip_map_events").insert({
          job_id: job.id,
          company_id: companyId,
          driver_id: (job as any).driver_id ?? null,
          event_type: isCorrection ? "status_corrected" : "arrived_pickup_override",
          lat: data.lat ?? null,
          lng: data.lng ?? null,
          accuracy_m: data.accuracy_m ?? null,
          notes: isCorrection
            ? (data.correction_note ?? null)
            : (data.override_note ?? null),
          meta: isCorrection
            ? { from: prevStatus, to: data.status }
            : {
                reason: data.override_reason,
                distance_m:
                  (job as any).pickup_lat != null && (job as any).pickup_lng != null && data.lat != null && data.lng != null
                    ? Math.round(haversineMetersLL(data.lat, data.lng, (job as any).pickup_lat, (job as any).pickup_lng))
                    : null,
              },
        } as any);
      } catch { /* map event failures never block the primary action */ }
    }

    // ── Phase 2 — Waiting system hooks ─────────────────────────────────────
    if (data.status === "arrived") {
      // Auto-start a wait session anchored to max(now, pickup_at) so a driver
      // arriving early doesn't accrue billable waiting time before the
      // scheduled pickup.
      const { data: existing } = await supabaseAdmin
        .from("job_wait_sessions")
        .select("id")
        .eq("job_id", job.id)
        .is("ended_at", null)
        .limit(1)
        .maybeSingle();
      if (!existing) {
        const { freeWaitMinutes } = await loadWaitPolicy(supabaseAdmin, companyId);
        const arrivedAt = now;
        const pickupAt = (job as any).pickup_at as string | null;
        const chargeableFrom = pickupAt && new Date(pickupAt).getTime() > new Date(arrivedAt).getTime()
          ? pickupAt
          : arrivedAt;
        const freeEndsAt = freeWaitMinutes > 0
          ? new Date(new Date(chargeableFrom).getTime() + freeWaitMinutes * 60000).toISOString()
          : null;
        await supabaseAdmin.from("job_wait_sessions").insert({
          job_id: job.id,
          driver_id: (job as any).driver_id ?? null,
          company_id: companyId,
          source: "manual",
          auto_started: true,
          started_at: chargeableFrom, // billing anchor
          arrived_at: arrivedAt,
          chargeable_from: chargeableFrom,
          free_ends_at: freeEndsAt,
        } as never);
      }
    }

    if (data.status === "en_route" || data.status === "in_progress" || data.status === "completed") {
      await closeOpenWaitSession(
        supabaseAdmin,
        job.id,
        (job as any).driver_id ?? null,
        companyId,
        now,
      );
    }

    // If the driver reverts a mistaken arrival, do NOT delete the open wait
    // session — close it as zero so we keep the audit trace.
    if (isCorrection) {
      const { data: openWait } = await supabaseAdmin
        .from("job_wait_sessions")
        .select("id")
        .eq("job_id", job.id)
        .is("ended_at", null)
        .limit(1)
        .maybeSingle();
      if (openWait) {
        await supabaseAdmin
          .from("job_wait_sessions")
          .update({
            ended_at: now,
            calculated_amount: 0,
            agreed_amount: 0,
            driver_note: "reverted by driver correction",
          } as never)
          .eq("id", (openWait as any).id);
      }
    }

    // ── Cascade transition to sibling legs in the same group ──────────────
    // A grouped run behaves as one trip for the driver: tapping "On the way",
    // "Arrived", "Start trip", or the walk-back correction on any leg fans
    // out to the other legs assigned to this same driver. Per-leg controls
    // (Complete stop, boarding) stay per-leg and don't cascade here.
    const cascadeGid = (job as any).group_id as string | null | undefined;
    const cascadeDriverId = (job as any).driver_id as string | null;
    const cascadeStatuses = new Set(["en_route", "arrived", "in_progress", "pending"]);
    if (cascadeGid && cascadeDriverId && cascadeStatuses.has(data.status)) {
      const { data: sibs } = await supabaseAdmin.from("jobs")
        .select("id, status, driver_started_at, pickup_lat, pickup_lng, pickup_at")
        .eq("group_id" as any, cascadeGid)
        .eq("driver_id", cascadeDriverId)
        .neq("id", job.id);
      const statusOrder = ["pending", "en_route", "arrived", "in_progress", "active", "completed"];
      const newIdx = statusOrder.indexOf(data.status);
      const tappedPLat = (job as any).pickup_lat as number | null;
      const tappedPLng = (job as any).pickup_lng as number | null;
      for (const sib of (sibs ?? []) as any[]) {
        if (sib.status === "completed" || sib.status === "cancelled") continue;
        if (isCorrection) {
          if (!DRIVER_RETURN_TO_WAITING_STATUSES.has(sib.status ?? "")) continue;
        } else {
          const sibIdx = statusOrder.indexOf(sib.status ?? "pending");
          if (sibIdx >= newIdx) continue;
        }
        // For arrival / start-trip, only cascade to legs sharing a pickup
        // (within ~300 m). Different-pickup siblings still get en_route.
        if ((data.status === "arrived" || data.status === "in_progress")
            && tappedPLat != null && tappedPLng != null
            && sib.pickup_lat != null && sib.pickup_lng != null) {
          const d = haversineMetersLL(sib.pickup_lat, sib.pickup_lng, tappedPLat, tappedPLng);
          if (d > 300) continue;
        }

        // Boarding gate per sibling.
        if (data.status === "in_progress") {
          const { data: sibPax } = await supabaseAdmin
            .from("pax").select("id, status").eq("job_id", sib.id);
          const hasPending = (sibPax ?? []).some((p: any) => p.status === "pending");
          if (hasPending) {
            const { data: ok } = await supabaseAdmin.from("job_boarding_approvals")
              .select("id").eq("job_id", sib.id)
              .in("status", ["approved", "overridden"]).limit(1).maybeSingle();
            if (!ok) continue;
          }
        }

        const sibPatch: Record<string, unknown> = { status: data.status };
        if (data.status === "en_route" && !sib.driver_started_at) {
          sibPatch.driver_started_at = new Date().toISOString();
        }
        const { error: sibErr } = await supabaseAdmin.from("jobs")
          .update(sibPatch as never).eq("id", sib.id);
        if (sibErr) continue;

        // Map event pin per sibling.
        try {
          const evType = isCorrection ? "back_to_waiting"
            : data.status === "en_route" ? "en_route"
            : data.status === "arrived" ? (data.override_reason ? "arrived_pickup_override" : "arrived_pickup")
            : data.status === "in_progress" ? "in_progress"
            : data.status;
          await supabaseAdmin.from("trip_map_events").insert({
            job_id: sib.id,
            company_id: companyId,
            driver_id: cascadeDriverId,
            event_type: evType,
            lat: data.lat ?? null,
            lng: data.lng ?? null,
            accuracy_m: data.accuracy_m ?? null,
            meta: { from: sib.status, to: data.status, cascaded_from: job.id },
          } as any);
        } catch { /* logging never blocks */ }

        // Wait session bookkeeping mirrored per sibling.
        if (data.status === "arrived") {
          const { data: existing } = await supabaseAdmin
            .from("job_wait_sessions").select("id").eq("job_id", sib.id)
            .is("ended_at", null).limit(1).maybeSingle();
          if (!existing) {
            const { freeWaitMinutes } = await loadWaitPolicy(supabaseAdmin, companyId);
            const arrivedAt = now;
            const pickupAt = sib.pickup_at as string | null;
            const chargeableFrom = pickupAt && new Date(pickupAt).getTime() > new Date(arrivedAt).getTime()
              ? pickupAt : arrivedAt;
            const freeEndsAt = freeWaitMinutes > 0
              ? new Date(new Date(chargeableFrom).getTime() + freeWaitMinutes * 60000).toISOString()
              : null;
            await supabaseAdmin.from("job_wait_sessions").insert({
              job_id: sib.id, driver_id: cascadeDriverId, company_id: companyId,
              source: "manual", auto_started: true,
              started_at: chargeableFrom, arrived_at: arrivedAt,
              chargeable_from: chargeableFrom, free_ends_at: freeEndsAt,
            } as never);
          }
        }
        if (data.status === "en_route" || data.status === "in_progress") {
          await closeOpenWaitSession(supabaseAdmin, sib.id, cascadeDriverId, companyId, now);
        }
        if (isCorrection) {
          const { data: openWait } = await supabaseAdmin
            .from("job_wait_sessions").select("id").eq("job_id", sib.id)
            .is("ended_at", null).limit(1).maybeSingle();
          if (openWait) {
            await supabaseAdmin.from("job_wait_sessions").update({
              ended_at: now, calculated_amount: 0, agreed_amount: 0,
              driver_note: "reverted by driver correction (cascaded)",
            } as never).eq("id", (openWait as any).id);
          }
        }
      }
    }

    // Reversible-group auto-dissolve.
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

    // Push a realtime broadcast so magic-link viewers (driver manifest,
    // client tracking) refetch without waiting for their next poll.
    {
      const driverId = (job as any).driver_id as string | null;
      const gid = (job as any).group_id as string | null | undefined;
      const jobIds = new Set<string>([job.id]);
      if (gid && driverId) {
        const { data: sibs } = await supabaseAdmin.from("jobs")
          .select("id").eq("group_id" as any, gid).eq("driver_id", driverId);
        for (const s of (sibs ?? []) as any[]) jobIds.add(s.id);
      }
      const ids = Array.from(jobIds);
      await broadcastJobUpdate(
        [
          driverId ? `driver:${driverId}` : "",
          gid ? `group:${gid}` : "",
          ...ids.map((id) => `job:${id}`),
        ],
        { job_ids: ids, group_id: gid ?? null, kind: `status:${data.status}` },
      );
    }
    return { ok: true };
  });

export const emergencyOverrideJobStatus = createServerFn({ method: "POST" })
  .inputValidator((i: unknown) =>
    z.object({
      token: z.string().min(8).max(128),
      job_id: z.string().uuid(),
      action: z.enum(EMERGENCY_OVERRIDE_ACTIONS),
      reason: z.enum(EMERGENCY_OVERRIDE_REASONS),
      reason_note: z.string().trim().max(500).optional(),
      // Optional live telemetry from the driver's device at the moment of override.
      gps_lat: z.number().gte(-90).lte(90).optional(),
      gps_lng: z.number().gte(-180).lte(180).optional(),
      gps_accuracy_m: z.number().nonnegative().max(100000).optional(),
      // Optional photo, sent as data URL (image/jpeg or image/png), max ~5 MB.
      photo_data_url: z.string().max(7_500_000).optional(),
    }).parse(i),
  )
  .handler(async ({ data }) => {
    const link = await resolveToken(data.token, "driver");
    if (!link) throw new Error("invalid_or_expired_link");

    const { job, supabaseAdmin } = await loadDriverJob(data.token, data.job_id);
    const fromStatus = String((job as any).status ?? "");
    if (fromStatus === "completed" || fromStatus === "cancelled") {
      throw new Error("trip_not_active");
    }
    if (!DRIVER_EMERGENCY_OVERRIDE_ALLOWED_STATUSES.has(fromStatus)) {
      throw new Error("trip_not_overridable");
    }

    const toStatus = EMERGENCY_OVERRIDE_TO_STATUS[data.action];
    const now = new Date().toISOString();
    const companyId: string = (job as any).executor_company_id ?? (job as any).company_id;
    const driverId: string | null = (job as any).driver_id ?? link.subject_id ?? null;
    const patch: Record<string, unknown> = { status: toStatus };

    if (toStatus === "en_route" && !(job as any).driver_started_at) {
      patch.driver_started_at = now;
    }
    if (toStatus === "completed") {
      patch.grouped_count = null;
      patch.grouped_at = null;
      if (!(job as any).driver_completed_at) {
        patch.driver_completed_at = now;
      }
    }
    if (data.reason === "safety_concern") {
      patch.safety_flag_at = now;
    }
    if (data.reason === "breakdown") {
      patch.breakdown_flag_at = now;
    }

    const { error: updateError } = await supabaseAdmin
      .from("jobs")
      .update(patch as never)
      .eq("id", data.job_id);
    if (updateError) throw new Error(updateError.message);

    if (toStatus === "en_route" || toStatus === "completed") {
      const closeReason = toStatus === "en_route"
        ? `Closed by emergency override: ${EMERGENCY_OVERRIDE_ACTION_LABELS[data.action]} (driver en route)`
        : `Closed by emergency override: ${EMERGENCY_OVERRIDE_ACTION_LABELS[data.action]} (trip completed)`;
      await closeOpenWaitSession(
        supabaseAdmin,
        job.id,
        driverId,
        companyId,
        now,
        closeReason,
      );
    }

    if (toStatus === "in_progress") {
      await supabaseAdmin
        .from("job_boarding_approvals")
        .update({ status: "overridden", override_at: now, responded_at: now } as never)
        .eq("job_id", data.job_id)
        .eq("status", "pending");
    }

    if (toStatus === "completed") {
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

    // Prefer the fresh telemetry the driver sent with the override; fall back
    // to the latest driver_locations ping.
    let gpsLat = data.gps_lat ?? null;
    let gpsLng = data.gps_lng ?? null;
    let gpsAccuracy = data.gps_accuracy_m ?? null;
    let speedMps: number | null = null;

    if (driverId) {
      const { data: latestLocation } = await supabaseAdmin
        .from("driver_locations")
        .select("lat, lng, accuracy_m, speed_mps")
        .eq("driver_id", driverId)
        .eq("job_id", data.job_id)
        .order("captured_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      const loc: any = latestLocation ?? null;
      if (loc) {
        if (gpsLat == null) gpsLat = loc.lat ?? null;
        if (gpsLng == null) gpsLng = loc.lng ?? null;
        if (gpsAccuracy == null) gpsAccuracy = loc.accuracy_m ?? null;
        speedMps = loc.speed_mps ?? null;
      }
    }

    // Reverse-geocode (best-effort).
    let streetAddress: string | null = null;
    if (gpsLat != null && gpsLng != null) {
      const apiKey = process.env.GOOGLE_MAPS_API_KEY;
      if (apiKey) {
        try {
          const rj: any = await (
            await fetch(`https://maps.googleapis.com/maps/api/geocode/json?latlng=${gpsLat},${gpsLng}&key=${apiKey}`)
          ).json();
          streetAddress = rj?.results?.[0]?.formatted_address ?? null;
        } catch { /* best-effort */ }
      }
    }

    // Snapshot vehicle label + passenger count.
    let vehicleLabel: string | null = null;
    if (driverId) {
      const { data: drv } = await supabaseAdmin
        .from("drivers")
        .select("car_make_model, plate, name")
        .eq("id", driverId)
        .maybeSingle();
      const d: any = drv ?? {};
      const parts = [d?.car_make_model, d?.plate].filter(Boolean);
      vehicleLabel = parts.length ? parts.join(" · ") : (d?.name ?? null);
    }
    const { count: paxCount } = await supabaseAdmin
      .from("pax")
      .select("id", { count: "exact", head: true })
      .eq("job_id", data.job_id);

    // Upload photo (best-effort). Path scheme keeps audit under the company folder.
    let photoPath: string | null = null;
    let photoUrl: string | null = null;
    if (data.photo_data_url) {
      try {
        const match = /^data:(image\/(?:jpeg|jpg|png|webp));base64,(.+)$/i.exec(data.photo_data_url);
        if (match) {
          const contentType = match[1].toLowerCase().replace("image/jpg", "image/jpeg");
          const ext = contentType === "image/png" ? "png" : contentType === "image/webp" ? "webp" : "jpg";
          const bytes = Buffer.from(match[2], "base64");
          const key = `${companyId}/${data.job_id}/${crypto.randomUUID()}.${ext}`;
          const up = await supabaseAdmin.storage
            .from("override-photos")
            .upload(key, bytes, { contentType, upsert: false });
          if (!up.error) {
            photoPath = key;
            const signed = await supabaseAdmin.storage
              .from("override-photos")
              .createSignedUrl(key, 60 * 60 * 24 * 365);
            photoUrl = signed.data?.signedUrl ?? null;
          }
        }
      } catch { /* best-effort */ }
    }

    const { error: auditError } = await supabaseAdmin
      .from("job_emergency_overrides" as any)
      .insert({
        job_id: data.job_id,
        driver_id: driverId,
        company_id: companyId,
        from_status: fromStatus,
        to_status: toStatus,
        reason: data.reason,
        reason_note: data.reason_note?.trim() || null,
        speed_mps: speedMps,
        gps_lat: gpsLat,
        gps_lng: gpsLng,
        gps_accuracy_m: gpsAccuracy,
        street_address: streetAddress,
        vehicle_label: vehicleLabel,
        pax_count: paxCount ?? null,
        photo_path: photoPath,
        photo_url: photoUrl,
      } as never);
    if (auditError) throw new Error(auditError.message);

    const actionLabel = EMERGENCY_OVERRIDE_ACTION_LABELS[data.action];
    const reasonLabel = EMERGENCY_OVERRIDE_REASON_LABELS[data.reason];
    const backwardOverride = isBackwardStatusTransition(fromStatus, toStatus);
    const details = data.reason_note?.trim() ? ` Note: ${data.reason_note.trim()}` : "";
    const backward = backwardOverride ? " Backward override." : "";
    const location = streetAddress ? ` Near ${streetAddress}.` : "";
    const photo = photoUrl ? " Photo attached." : "";

    await supabaseAdmin.from("trip_messages").insert({
      job_id: data.job_id,
      company_id: companyId,
      sender_kind: "system",
      sender_label: "System",
      body: `⚠️ Emergency override — ${link.subject_label ?? "Driver"} used ${actionLabel}. Reason: ${reasonLabel}.${backward}${location}${photo}${details}`,
      thread_kind: "driver_coord",
      driver_id: driverId,
    } as never);

    // Auto-emit a map pin so the coordinator's TripEventsMap shows exactly
    // where the driver invoked the override (safety/breakdown/generic).
    {
      const pinType: "safety_concern" | "breakdown" | "emergency_override" =
        data.reason === "safety_concern"
          ? "safety_concern"
          : data.reason === "breakdown"
            ? "breakdown"
            : "emergency_override";
      const { insertTripMapEvent } = await import("@/lib/trip-map.server");
      await insertTripMapEvent(supabaseAdmin, {
        jobId: data.job_id,
        companyId,
        driverId,
        eventType: pinType,
        lat: gpsLat,
        lng: gpsLng,
        accuracyM: gpsAccuracy,
        notes: `${actionLabel} — ${reasonLabel}${data.reason_note?.trim() ? `. ${data.reason_note.trim()}` : ""}`,
        meta: {
          from_status: fromStatus,
          to_status: toStatus,
          reason: data.reason,
          action: data.action,
          backward: backwardOverride,
          street_address: streetAddress,
          photo_url: photoUrl,
        },
      });
    }

    return { ok: true, to_status: toStatus, photo_url: photoUrl };
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
    const link = await resolveToken(data.token, "driver");
    const { job, supabaseAdmin } = await loadDriverJob(data.token, data.job_id);
    if (data.method === "manual" && job.qr_strict_mode) {
      throw new Error("qr_required");
    }
    const { data: paxRow } = await supabaseAdmin.from("pax")
      .select("name").eq("id", data.pax_id).eq("job_id", data.job_id).maybeSingle();
    const { error } = await supabaseAdmin.from("pax")
      .update({
        status: "onboard" as never,
        boarded_at: new Date().toISOString(),
        boarded_method: data.method,
      })
      .eq("id", data.pax_id).eq("job_id", data.job_id);
    if (error) throw new Error(error.message);
    {
      const { insertTripMapEvent } = await import("@/lib/trip-map.server");
      await insertTripMapEvent(supabaseAdmin, {
        jobId: data.job_id,
        companyId: (job as any).executor_company_id ?? job.company_id,
        driverId: link?.subject_id ?? (job as any).driver_id ?? null,
        eventType: "pax_boarded",
        notes: `Boarded: ${(paxRow as any)?.name ?? "passenger"}`,
        meta: {
          pax_id: data.pax_id,
          pax_name: (paxRow as any)?.name ?? null,
          method: data.method,
        },
      });
    }
    return { ok: true };
  });

export const markPaxNoShow = createServerFn({ method: "POST" })
  .inputValidator((i: unknown) =>
    z.object({
      token: z.string().min(8).max(128),
      job_id: z.string().uuid(),
      pax_id: z.string().uuid(),
    }).parse(i),
  )
  .handler(async ({ data }) => {
    const link = await resolveToken(data.token, "driver");
    if (!link) throw new Error("invalid_or_expired_link");
    const { job, supabaseAdmin } = await loadDriverJob(data.token, data.job_id);
    const { data: paxRow } = await supabaseAdmin.from("pax")
      .select("name, status").eq("id", data.pax_id).eq("job_id", data.job_id).maybeSingle();
    if (!paxRow) throw new Error("pax_not_found");
    const { error } = await supabaseAdmin.from("pax")
      .update({ status: "noshow" as never, noshow_at: new Date().toISOString() })
      .eq("id", data.pax_id).eq("job_id", data.job_id);
    if (error) throw new Error(error.message);
    await supabaseAdmin.from("trip_messages").insert({
      job_id: data.job_id,
      company_id: job.company_id,
      sender_kind: "driver",
      sender_label: link.subject_label ?? "Driver",
      body: `🚫 No-show: ${(paxRow as any).name}`,
      thread_kind: "driver_coord",
      driver_id: link.subject_id ?? null,
    } as never);
    {
      const { insertTripMapEvent } = await import("@/lib/trip-map.server");
      await insertTripMapEvent(supabaseAdmin, {
        jobId: data.job_id,
        companyId: (job as any).executor_company_id ?? job.company_id,
        driverId: link.subject_id ?? (job as any).driver_id ?? null,
        eventType: "pax_no_show",
        notes: `No-show: ${(paxRow as any).name}`,
        meta: { pax_id: data.pax_id, pax_name: (paxRow as any).name },
      });
    }
    return { ok: true };
  });

export const markPaxPending = createServerFn({ method: "POST" })
  .inputValidator((i: unknown) =>
    z.object({
      token: z.string().min(8).max(128),
      job_id: z.string().uuid(),
      pax_id: z.string().uuid(),
    }).parse(i),
  )
  .handler(async ({ data }) => {
    const link = await resolveToken(data.token, "driver");
    if (!link) throw new Error("invalid_or_expired_link");
    await loadDriverJob(data.token, data.job_id);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("pax")
      .update({ status: "pending" as never, boarded_at: null, boarded_method: null, noshow_at: null, cancelled_at: null })
      .eq("id", data.pax_id).eq("job_id", data.job_id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

const PAX_CANCELLATION_ALLOWED_STATUSES = new Set(["arrived", "in_progress"]);

export const markPaxCancelled = createServerFn({ method: "POST" })
  .inputValidator((i: unknown) =>
    z.object({
      token: z.string().min(8).max(128),
      job_id: z.string().uuid(),
      pax_id: z.string().uuid(),
    }).parse(i),
  )
  .handler(async ({ data }) => {
    const link = await resolveToken(data.token, "driver");
    if (!link) throw new Error("invalid_or_expired_link");
    const { job, supabaseAdmin } = await loadDriverJob(data.token, data.job_id);
    if (!PAX_CANCELLATION_ALLOWED_STATUSES.has((job as any).status)) {
      throw new Error("cancellation_not_allowed_in_current_status");
    }
    const { data: paxRow } = await supabaseAdmin.from("pax")
      .select("name, status").eq("id", data.pax_id).eq("job_id", data.job_id).maybeSingle();
    if (!paxRow) throw new Error("pax_not_found");
    const { error } = await supabaseAdmin.from("pax")
      .update({ status: "cancelled" as never, cancelled_at: new Date().toISOString() })
      .eq("id", data.pax_id).eq("job_id", data.job_id);
    if (error) throw new Error(error.message);
    await supabaseAdmin.from("trip_messages").insert({
      job_id: data.job_id,
      company_id: (job as any).company_id,
      sender_kind: "driver",
      sender_label: link.subject_label ?? "Driver",
      body: `❌ Cancelled: ${(paxRow as any).name}`,
      thread_kind: "driver_coord",
      driver_id: link.subject_id ?? null,
    } as never);
    {
      const { insertTripMapEvent } = await import("@/lib/trip-map.server");
      await insertTripMapEvent(supabaseAdmin, {
        jobId: data.job_id,
        companyId: (job as any).executor_company_id ?? (job as any).company_id,
        driverId: link.subject_id ?? (job as any).driver_id ?? null,
        eventType: "pax_cancelled",
        notes: `Cancelled: ${(paxRow as any).name}`,
        meta: { pax_id: data.pax_id, pax_name: (paxRow as any).name },
      });
    }
    return { ok: true };
  });

export const requestBoardingApproval = createServerFn({ method: "POST" })
  .inputValidator((i: unknown) =>
    z.object({
      token: z.string().min(8).max(128),
      job_id: z.string().uuid(),
      driver_note: z.string().trim().max(500).optional(),
    }).parse(i),
  )
  .handler(async ({ data }) => {
    const link = await resolveToken(data.token, "driver");
    if (!link) throw new Error("invalid_or_expired_link");
    const { job, supabaseAdmin } = await loadDriverJob(data.token, data.job_id);
    // Approval must be requested while the job is in 'arrived' status — i.e. before
    // transitioning to in_progress. Once in_progress, all pax must already be resolved.
    if ((job as any).status !== "arrived") {
      throw new Error("boarding_approval_only_when_arrived");
    }

    // Check there is no existing open approval for this job.
    const { data: existing } = await supabaseAdmin
      .from("job_boarding_approvals")
      .select("id, status")
      .eq("job_id", data.job_id)
      .eq("status", "pending")
      .maybeSingle();
    if (existing) throw new Error("boarding_approval_already_pending");

    // Build pax summary snapshot.
    const { data: paxRows } = await supabaseAdmin
      .from("pax")
      .select("status")
      .eq("job_id", data.job_id);
    const paxSummary = (paxRows ?? []).reduce(
      (acc: Record<string, number>, p: any) => {
        const s: string = p.status ?? "pending";
        acc[s] = (acc[s] ?? 0) + 1;
        return acc;
      },
      {},
    );

    const companyId: string = (job as any).executor_company_id ?? (job as any).company_id;
    const now = new Date().toISOString();

    const { data: approval, error } = await supabaseAdmin
      .from("job_boarding_approvals")
      .insert({
        job_id: data.job_id,
        driver_id: link.subject_id ?? null,
        company_id: companyId,
        requested_by_user_id: null,
        status: "pending",
        requested_at: now,
        driver_note: data.driver_note ?? null,
        pax_summary: paxSummary,
      } as never)
      .select("id, requested_at")
      .single();
    if (error) throw new Error(error.message);

    // Notify coordinator via trip message.
    const pendingCount = paxSummary["pending"] ?? 0;
    await supabaseAdmin.from("trip_messages").insert({
      job_id: data.job_id,
      company_id: companyId,
      sender_kind: "driver",
      sender_label: link.subject_label ?? "Driver",
      body: `🚌 Boarding approval requested — ${pendingCount} passenger(s) still pending. Awaiting coordinator response.`,
      thread_kind: "driver_coord",
      driver_id: link.subject_id ?? null,
    } as never);

    {
      const { insertTripMapEvent } = await import("@/lib/trip-map.server");
      await insertTripMapEvent(supabaseAdmin, {
        jobId: data.job_id,
        companyId,
        driverId: link.subject_id ?? null,
        eventType: "boarding_requested",
        notes: `${pendingCount} passenger(s) pending`,
        meta: { approval_id: (approval as any).id, pax_summary: paxSummary, driver_note: data.driver_note ?? null },
      });
    }

    return { ok: true, approval_id: (approval as any).id, requested_at: (approval as any).requested_at };
  });

export const driverOverrideBoardingApproval = createServerFn({ method: "POST" })
  .inputValidator((i: unknown) =>
    z.object({
      token: z.string().min(8).max(128),
      job_id: z.string().uuid(),
      approval_id: z.string().uuid(),
    }).parse(i),
  )
  .handler(async ({ data }) => {
    const link = await resolveToken(data.token, "driver");
    if (!link) throw new Error("invalid_or_expired_link");
    const { supabaseAdmin } = await loadDriverJob(data.token, data.job_id);

    const { data: approval } = await supabaseAdmin
      .from("job_boarding_approvals")
      .select("id, status, requested_at, job_id")
      .eq("id", data.approval_id)
      .eq("job_id", data.job_id)
      .maybeSingle();
    if (!approval) throw new Error("boarding_approval_not_found");
    if ((approval as any).status !== "pending") throw new Error("boarding_approval_already_resolved");

    const requestedAt = new Date((approval as any).requested_at).getTime();
    const elapsedMs = Date.now() - requestedAt;
    if (elapsedMs < BOARDING_OVERRIDE_MS) {
      const remainingSeconds = Math.ceil((BOARDING_OVERRIDE_MS - elapsedMs) / 1000);
      throw new Error(`override_too_early:${remainingSeconds}`);
    }

    const now = new Date().toISOString();
    const { error } = await supabaseAdmin
      .from("job_boarding_approvals")
      .update({ status: "overridden", override_at: now, responded_at: now } as never)
      .eq("id", data.approval_id);
    if (error) throw new Error(error.message);

    return { ok: true };
  });

export const getBoardingApprovalStatusDriver = createServerFn({ method: "GET" })
  .inputValidator((i: unknown) =>
    z.object({
      token: z.string().min(8).max(128),
      job_id: z.string().uuid(),
    }).parse(i),
  )
  .handler(async ({ data }) => {
    const { job, supabaseAdmin } = await loadDriverJob(data.token, data.job_id);
    const companyId: string = (job as any).executor_company_id ?? (job as any).company_id;
    const { data: rows, error } = await supabaseAdmin
      .from("job_boarding_approvals")
      .select("id, status, requested_at, responded_at, override_at, coordinator_note, driver_note, pax_summary")
      .eq("job_id", data.job_id)
      .eq("company_id", companyId)
      .order("requested_at", { ascending: false })
      .limit(5);
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const driverReportLate = createServerFn({ method: "POST" })
  .inputValidator((i: unknown) =>
    z.object({
      token: z.string().min(8).max(128),
      job_id: z.string().uuid(),
      minutes: z.number().int().min(1).max(600),
      note: z.string().trim().max(300).optional(),
    }).parse(i),
  )
  .handler(async ({ data }) => {
    const link = await resolveToken(data.token, "driver");
    if (!link) throw new Error("invalid_or_expired_link");
    const { job, supabaseAdmin } = await loadDriverJob(data.token, data.job_id);
    const suffix = data.note?.trim() ? ` — ${data.note.trim()}` : "";
    await supabaseAdmin.from("trip_messages").insert({
      job_id: data.job_id,
      company_id: job.company_id,
      sender_kind: "driver",
      sender_label: link.subject_label ?? "Driver",
      body: `🕒 Running ~${data.minutes} min late${suffix}`,
      thread_kind: "driver_coord",
      driver_id: link.subject_id ?? null,
    } as never);
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
  eta_sec: z.number().int().nonnegative().max(86400).nullable().optional(),
  distance_m: z.number().int().nonnegative().max(10_000_000).nullable().optional(),
  next_instruction: z.string().max(500).nullable().optional(),
  destination_label: z.string().max(500).nullable().optional(),
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

    // Only accept pings while a trip is actively in motion. Once the driver
    // marks the trip completed (or it's cancelled), stale watchers stop leaking.
    const { data: activeJobs } = await supabaseAdmin.from("jobs")
      .select("id, company_id, pickup_at, status")
      .eq("driver_id", link.subject_id)
      .in("status", ["en_route", "arrived", "in_progress"])
      .order("pickup_at", { ascending: false })
      .limit(1);
    const active = activeJobs?.[0] as { id: string; company_id: string } | undefined;
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
      eta_sec: p.eta_sec ?? null,
      distance_m: p.distance_m ?? null,
      next_instruction: p.next_instruction ?? null,
      destination_label: p.destination_label ?? null,
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
      supabaseAdmin.from("pax").select("id, name, status, job_id").eq("job_id", job.id).order("name"),
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

    const [branding, features] = await Promise.all([
      loadCompanyBranding(job.company_id),
      loadCompanyFeatures(job.company_id),
    ]);

    const { loadPastTripsForJob } = await import("./client-history.server");
    const history = await loadPastTripsForJob(supabaseAdmin as any, job.id);

    return {
      job: {
        id: job.id, group_id: job.group_id, group_name: job.group_name,
        from_location: job.from_location, to_location: job.to_location,
        pickup_display_name: (job as any).pickup_display_name ?? null,
        dropoff_display_name: (job as any).dropoff_display_name ?? null,
        route_duration_sec: (job as any).route_duration_sec ?? null,
        route_distance_m: (job as any).route_distance_m ?? null,
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
        traffic_delay_minutes: (job as any).traffic_delay_minutes ?? null,
        traffic_severity: (job as any).traffic_severity ?? null,
        leave_by_at: (job as any).leave_by_at ?? null,
      },
      siblings: siblings ?? [],
      pax: pax ?? [],
      company,
      driver,
      driverLocations,
      identity,
      openSos: openSos ?? [],
      branding,
      features,
      history,
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
    const nowIso = new Date().toISOString();
    const { data: upserted, error } = await supabaseAdmin.from("client_link_identities").upsert({
      token: data.token, device_id: data.device_id,
      pax_id: data.pax_id, pax_name: data.pax_name,
      chosen_at: nowIso,
      last_seen_at: nowIso,
    } as never).select("id").single();
    if (error) throw new Error(error.message);
    const identityId = (upserted as any)?.id ?? null;
    // Attach any coordinator messages that were queued to this pax slot before
    // the passenger picked their name, so the private thread continues seamlessly.
    if (identityId && data.pax_id) {
      await supabaseAdmin.from("trip_messages")
        .update({ client_identity_id: identityId })
        .eq("pax_id", data.pax_id)
        .is("client_identity_id", null);
    }
    return { ok: true, identity_id: identityId };
  });

export const listClientTripMessages = createServerFn({ method: "GET" })
  .inputValidator((i: unknown) =>
    z.object({
      token: z.string().min(8).max(128),
      device_id: z.string().min(4).max(80).optional(),
      thread_kind: z.enum(["group", "private", "driver_client"]).default("group"),
    }).parse(i),
  )
  .handler(async ({ data }) => {
    const { job, supabaseAdmin } = await loadJobByClientToken(data.token);
    const ids = await siblingIds(supabaseAdmin, job);

    // resolve identity + pax_id for this device
    let identityId: string | null = null;
    let paxId: string | null = null;
    if (data.device_id) {
      const { data: id } = await supabaseAdmin.from("client_link_identities")
        .select("id, pax_id").eq("token", data.token).eq("device_id", data.device_id).maybeSingle();
      identityId = (id as any)?.id ?? null;
      paxId = (id as any)?.pax_id ?? null;
    }

    // Defense in depth: clients can never see anything but their own group
    // or private thread. Price proposals live in a separate table and are
    // never joined here. We whitelist columns, whitelist sender_kind, and
    // constrain thread_kind with .eq() so a stray driver_coord row (system
    // alerts, driver↔coordinator private notes, etc.) can never leak through.
    let q = supabaseAdmin.from("trip_messages")
      .select("id, sender_kind, sender_label, body, created_at, thread_kind, client_identity_id, pax_id, is_sos")
      .in("job_id", ids)
      .in("sender_kind", ["driver", "client", "coordinator"])
      .order("created_at", { ascending: true });

    const wantedKind: "group" | "private" | "driver_client" = data.thread_kind;
    if (wantedKind === "private") {
      if (!identityId && !paxId) return [];
      const orParts: string[] = [];
      if (identityId) orParts.push(`client_identity_id.eq.${identityId}`);
      if (paxId) orParts.push(`pax_id.eq.${paxId}`);
      q = q.eq("thread_kind", "private").or(orParts.join(","));
    } else if (wantedKind === "driver_client") {
      if (!identityId && !paxId) return [];
      const orParts: string[] = [];
      if (identityId) orParts.push(`client_identity_id.eq.${identityId}`);
      if (paxId) orParts.push(`pax_id.eq.${paxId}`);
      q = q.eq("thread_kind", "driver_client").or(orParts.join(","));
      // Only surface the current driver's private thread — if the trip was
      // reassigned, the previous driver's messages stay hidden from the client.
      if ((job as any).driver_id) q = q.eq("driver_id" as any, (job as any).driver_id);
      else return [];
    } else {
      q = q.eq("thread_kind", "group");
    }
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    // Belt-and-braces post-filter: never trust the DB round-trip; drop anything
    // whose thread_kind doesn't match the requested audience.
    const safe = (rows ?? []).filter((r: any) => r.thread_kind === wantedKind);
    return safe;
  });

export const postClientTripMessage = createServerFn({ method: "POST" })
  .inputValidator((i: unknown) =>
    z.object({
      token: z.string().min(8).max(128),
      device_id: z.string().min(4).max(80),
      body: z.string().trim().min(1).max(4000),
      thread_kind: z.enum(["group", "private", "driver_client"]).default("group"),
    }).parse(i),
  )
  .handler(async ({ data }) => {
    const { job, supabaseAdmin } = await loadJobByClientToken(data.token);
    const { data: id } = await supabaseAdmin.from("client_link_identities")
      .select("id, pax_id, pax_name").eq("token", data.token).eq("device_id", data.device_id).maybeSingle();
    const label = (id as any)?.pax_name ?? "Passenger";
    const identityId = (id as any)?.id ?? null;
    const paxId = (id as any)?.pax_id ?? null;
    let effectiveKind: "group" | "private" | "driver_client" = data.thread_kind;
    if (effectiveKind === "private" && !identityId) effectiveKind = "group";
    if (effectiveKind === "driver_client" && !identityId && !paxId) effectiveKind = "group";
    const scoped = effectiveKind === "private" || effectiveKind === "driver_client";
    const { error } = await supabaseAdmin.from("trip_messages").insert({
      job_id: job.id, company_id: job.company_id,
      sender_kind: "client", sender_label: label, body: data.body,
      thread_kind: effectiveKind,
      client_identity_id: scoped ? identityId : null,
      pax_id: scoped ? paxId : null,
      // Tag driver_client replies with the current driver so a future
      // reassignment doesn't leak this thread to a new driver.
      driver_id: effectiveKind === "driver_client" ? ((job as any).driver_id ?? null) : null,
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
    // Refuse writes once the trip is terminal so stale watchers can't leak points.
    if (job.status === "completed" || job.status === "cancelled") {
      return { ok: true, inserted: 0, reason: "trip_ended" as const };
    }
    const { data: id } = await supabaseAdmin.from("client_link_identities")
      .select("id, pax_id, pax_name").eq("token", data.token).eq("device_id", data.device_id).maybeSingle();
    const { error } = await supabaseAdmin.from("client_locations").insert({
      token: data.token, job_id: job.id, company_id: job.company_id,
      device_id: data.device_id, pax_id: id?.pax_id ?? null, pax_name: id?.pax_name ?? null,
      latitude: data.latitude, longitude: data.longitude,
      accuracy_m: data.accuracy_m ?? null, mode: data.mode,
    } as never);
    if (error) throw new Error(error.message);

    // Pin drops post a chat message so the driver gets a tappable Google Maps link.
    if (data.mode === "pin") {
      const lat = data.latitude.toFixed(6);
      const lng = data.longitude.toFixed(6);
      const mapsLink = `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
      const who = id?.pax_name ?? "Passenger";
      const scoped = !!(id?.id || id?.pax_id);
      const threadKind = scoped ? "driver_client" : "group";
      await supabaseAdmin.from("trip_messages").insert({
        job_id: job.id,
        company_id: job.company_id,
        sender_kind: "client",
        sender_label: who,
        body: `📍 ${who} shared their location — ${mapsLink}`,
        thread_kind: threadKind,
        client_identity_id: scoped ? ((id as any)?.id ?? null) : null,
        pax_id: scoped ? (id?.pax_id ?? null) : null,
      } as never);
    }
    return { ok: true };
  });

export const getClientLiveLocationDriver = createServerFn({ method: "GET" })
  .inputValidator((i: unknown) =>
    z.object({ token: z.string().min(8).max(128), job_id: z.string().uuid() }).parse(i),
  )
  .handler(async ({ data }) => {
    const { job, supabaseAdmin } = await loadDriverJob(data.token, data.job_id);
    // Hide live client pin as soon as the trip is over.
    if (job.status === "completed" || job.status === "cancelled") return null;
    const since = new Date(Date.now() - 3 * 60_000).toISOString();
    const { data: row, error } = await supabaseAdmin.from("client_locations")
      .select("latitude, longitude, accuracy_m, captured_at, pax_name, mode")
      .eq("job_id", job.id)
      .eq("mode", "live")
      .gte("captured_at", since)
      .order("captured_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return row ?? null;
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
    const pickup_at = maltaWallTimeToUtcIso(data.date, data.time);


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
    {
      const { autoPriceJobBg } = await import("./auto-price.server");
      autoPriceJobBg(newJob!.id);
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
    const nowIso = new Date().toISOString();
    // Preserve first_seen_at if row exists; set it on first heartbeat.
    const { data: existing } = await supabaseAdmin.from("client_link_identities")
      .select("first_seen_at").eq("token", data.token).eq("device_id", data.device_id).maybeSingle();
    await supabaseAdmin.from("client_link_identities").upsert({
      token: data.token,
      device_id: data.device_id,
      last_seen_at: nowIso,
      first_seen_at: (existing as any)?.first_seen_at ?? nowIso,
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

// ---------- Price proposals (driver side) ----------

// A driver proposes a price to the coordinator currently holding the trip
// (the executor company). The proposal is private to those two parties.
export const proposeDriverPrice = createServerFn({ method: "POST" })
  .inputValidator((i: unknown) =>
    z.object({
      token: z.string().min(8).max(128),
      job_id: z.string().uuid(),
      amount_eur: z.number().positive().max(99999.99),
      note: z.string().trim().max(300).optional(),
    }).parse(i),
  )
  .handler(async ({ data }) => {
    const { link, job, supabaseAdmin } = await loadDriverJob(data.token, data.job_id);
    if (!link.subject_id) throw new Error("driver_only");
    const toCompanyId = job.executor_company_id ?? job.company_id;
    if (!toCompanyId) throw new Error("no_receiver");
    // Supersede any prior open driver proposals for this job from this driver.
    await supabaseAdmin.from("job_price_proposals")
      .update({ status: "superseded", responded_at: new Date().toISOString() } as never)
      .eq("job_id", data.job_id)
      .eq("from_driver_id", link.subject_id)
      .in("status", ["proposed", "countered"]);
    const { data: row, error } = await supabaseAdmin.from("job_price_proposals").insert({
      job_id: data.job_id,
      from_party_kind: "driver",
      from_driver_id: link.subject_id,
      to_company_id: toCompanyId,
      amount_eur: data.amount_eur,
      status: "proposed",
      note: data.note ?? null,
    } as never).select("*").single();
    if (error) throw new Error(error.message);
    return row;
  });

// Driver responds to a coordinator counter-offer.
export const driverRespondToPrice = createServerFn({ method: "POST" })
  .inputValidator((i: unknown) =>
    z.object({
      token: z.string().min(8).max(128),
      proposal_id: z.string().uuid(),
      action: z.enum(["accept", "withdraw"]),
    }).parse(i),
  )
  .handler(async ({ data }) => {
    const link = await resolveToken(data.token, "driver");
    if (!link) throw new Error("invalid_or_expired_link");
    if (!link.subject_id) throw new Error("driver_only");
    const supabaseAdmin = await getAdminClient();
    const { data: prop, error: readErr } = await supabaseAdmin.from("job_price_proposals")
      .select("*").eq("id", data.proposal_id).maybeSingle();
    if (readErr) throw new Error(readErr.message);
    if (!prop) throw new Error("proposal_not_found");
    if (!["proposed", "countered"].includes(prop.status)) throw new Error("already_closed");

    // Recall rules — trip must still be open and not in progress.
    const { data: job } = await supabaseAdmin.from("jobs")
      .select("id, status, driver_id").eq("id", prop.job_id).maybeSingle();
    if (!job) throw new Error("job_not_found");
    if (["completed", "cancelled"].includes(job.status as string)) {
      throw new Error("trip_closed");
    }

    if (data.action === "accept") {
      // Driver accepting a coordinator counter-offer.
      if (prop.from_party_kind !== "company") throw new Error("not_a_counter_offer");
      if (prop.to_driver_id !== link.subject_id) throw new Error("forbidden");
      // Rule: driver must still be assigned to this job to accept the counter.
      if (job.driver_id !== link.subject_id) throw new Error("no_longer_assigned");
      const { error } = await supabaseAdmin.from("job_price_proposals").update({
        status: "accepted",
        responded_at: new Date().toISOString(),
      } as never).eq("id", data.proposal_id);
      if (error) throw new Error(error.message);
    } else {
      // Driver withdrawing their own proposal.
      if (prop.from_driver_id !== link.subject_id) throw new Error("forbidden");
      // Rule: can only withdraw while the offer is still open (proposed).
      // Once the coordinator counters, the original is closed automatically.
      if (prop.status !== "proposed") throw new Error("coordinator_already_responded");
      // Rule: the trip must not have started.
      if (["en_route", "arrived", "in_progress"].includes(job.status as string)) {
        throw new Error("trip_already_started");
      }
      const { error } = await supabaseAdmin.from("job_price_proposals").update({
        status: "recalled",
        responded_at: new Date().toISOString(),
      } as never).eq("id", data.proposal_id);
      if (error) throw new Error(error.message);
    }
    return { ok: true };
  });

// Returns the driver-side proposal thread for a job (only proposals visible
// to this driver — theirs plus counter-offers directed at them).
export const listMyDriverPriceThread = createServerFn({ method: "GET" })
  .inputValidator((i: unknown) =>
    z.object({ token: z.string().min(8).max(128), job_id: z.string().uuid() }).parse(i),
  )
  .handler(async ({ data }) => {
    const { link, supabaseAdmin } = await loadDriverJob(data.token, data.job_id);
    if (!link.subject_id) return [];
    const { data: rows, error } = await supabaseAdmin.from("job_price_proposals")
      .select("id, from_party_kind, from_company_id, from_driver_id, to_company_id, to_driver_id, amount_eur, status, parent_id, note, created_at, responded_at")
      .eq("job_id", data.job_id)
      .or(`from_driver_id.eq.${link.subject_id},to_driver_id.eq.${link.subject_id}`)
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

// ---------- Driver Sign Board (mobile/tablet greeting screen) ----------

/**
 * Returns everything the driver's fullscreen "Sign Board" needs for a given
 * job, scoped to the driver token. Includes the trip fields the driver can
 * one-tap onto the board (passenger, flight, client company), the
 * coordinator's saved `board_config` if present, and signed URLs for every
 * logo referenced (plus the company's primary logo as an anchor).
 */
export const getDriverSignBoard = createServerFn({ method: "GET" })
  .inputValidator((i: unknown) =>
    z.object({
      token: z.string().min(8).max(128),
      job_id: z.string().uuid(),
    }).parse(i),
  )
  .handler(async ({ data }) => {
    const link = await resolveToken(data.token, "driver");
    if (!link) throw new Error("Invalid or expired driver link");
    const supabaseAdmin = await getAdminClient();

    const { data: job, error } = await supabaseAdmin
      .from("jobs")
      .select(
        "id, company_id, executor_company_id, driver_id, from_flight, to_flight, flightorship, clientcompanyname, board_config, pax(id, name)",
      )
      .eq("id", data.job_id)
      .maybeSingle();
    if (error || !job) throw new Error("Trip not found");

    // Token-scoped access: driver token can only see jobs assigned to that
    // driver row (or, for company-wide tokens, jobs within the same company).
    if (link.subject_id) {
      if ((job as any).driver_id !== link.subject_id) {
        throw new Error("Not authorized for this trip");
      }
    } else {
      const owners = [
        (job as any).company_id,
        (job as any).executor_company_id,
      ].filter(Boolean);
      if (!owners.includes(link.company_id)) {
        throw new Error("Not authorized for this trip");
      }
    }

    const flightNumber =
      (job as any).from_flight ||
      (job as any).to_flight ||
      (job as any).flightorship ||
      "";
    const paxNames = ((job as any).pax ?? [])
      .map((p: any) => p.name)
      .filter(Boolean) as string[];

    const branding = await loadCompanyBranding(link.company_id);

    // Company logos (private bucket → signed URLs). Anchor logo = is_primary
    // then first available. board_config may reference logos by id, so we
    // sign every logo the company has and let the client map by id.
    const { data: logoRows } = await supabaseAdmin
      .from("company_logos")
      .select("id, storage_path, is_primary, is_background, label")
      .eq("company_id", link.company_id);

    const logos = await Promise.all(
      (logoRows ?? []).map(async (r: any) => {
        const { data: s } = await supabaseAdmin.storage
          .from("company-logos")
          .createSignedUrl(r.storage_path, 60 * 60 * 2);
        return {
          id: r.id as string,
          url: s?.signedUrl ?? "",
          is_primary: !!r.is_primary,
          is_background: !!r.is_background,
          label: (r.label as string | null) ?? null,
        };
      }),
    );

    const anchorLogo =
      logos.find((l) => l.is_primary && !l.is_background) ||
      logos.find((l) => !l.is_background) ||
      null;

    return {
      job: {
        id: (job as any).id as string,
        passenger_name: paxNames[0] ?? "",
        passenger_names: paxNames,
        flight_number: flightNumber as string,
        client_company_name: ((job as any).clientcompanyname as string | null) ?? "",
      },
      board_config: (job as any).board_config ?? null,
      company_name: branding?.company_name ?? "",
      anchor_logo_url: anchorLogo?.url ?? branding?.logo_url ?? null,
      logos,
    };
  });

// ============================================================
// WAITING TIME + DRIVER-ADDED TRIP ADJUSTMENTS
// ============================================================

const activeStatuses = ["arrived", "in_progress"] as const;

/** Load the waiting policy (free window + rate) for the company that owns/executes a job. */
async function loadWaitPolicy(supabaseAdmin: any, companyId: string) {
  const { data: co } = await supabaseAdmin
    .from("companies")
    .select("free_wait_minutes, waiting_rate_per_minute")
    .eq("id", companyId)
    .maybeSingle();
  return {
    freeWaitMinutes: Number((co as any)?.free_wait_minutes ?? 5),
    ratePerMinute: Number((co as any)?.waiting_rate_per_minute ?? 0),
  };
}

/** Compute the system-calculated waiting charge for a session. */
function computeCalculatedAmount(
  startedAt: string,
  endedAt: string,
  freeWaitMinutes: number,
  ratePerMinute: number,
  freeEndsAt?: string | null,
): { calculatedAmount: number; elapsedMinutes: number; chargeableMinutes: number } {
  const startMs = new Date(startedAt).getTime();
  const endMs = new Date(endedAt).getTime();
  const elapsedMinutes = Math.max(0, (endMs - startMs) / 60000);

  let chargeableMinutes: number;
  if (freeEndsAt) {
    const freeEndMs = new Date(freeEndsAt).getTime();
    chargeableMinutes = Math.max(0, (endMs - freeEndMs) / 60000);
  } else {
    chargeableMinutes = Math.max(0, elapsedMinutes - freeWaitMinutes);
  }

  const calculatedAmount = Math.round(chargeableMinutes * ratePerMinute * 100) / 100;
  return { calculatedAmount, elapsedMinutes: Math.round(elapsedMinutes), chargeableMinutes: Math.round(chargeableMinutes * 100) / 100 };
}

/**
 * Close an open wait session and write the calculated amount.
 * Also inserts a job_adjustments row. Returns null if no open session.
 */
async function closeOpenWaitSession(
  supabaseAdmin: any,
  jobId: string,
  driverId: string | null,
  companyId: string,
  endedAt: string,
  driverNote?: string | null,
): Promise<{ sessionId: string; calculatedAmount: number; elapsedMinutes: number } | null> {
  const { data: open } = await supabaseAdmin
    .from("job_wait_sessions")
    .select("id, started_at, free_ends_at, company_id")
    .eq("job_id", jobId)
    .is("ended_at", null)
    .limit(1)
    .maybeSingle();
  if (!open) return null;

  const sessionCompanyId = (open as any).company_id ?? companyId;
  const { freeWaitMinutes, ratePerMinute } = await loadWaitPolicy(supabaseAdmin, sessionCompanyId);
  const { calculatedAmount, elapsedMinutes, chargeableMinutes } = computeCalculatedAmount(
    (open as any).started_at,
    endedAt,
    freeWaitMinutes,
    ratePerMinute,
    (open as any).free_ends_at,
  );

  await supabaseAdmin
    .from("job_wait_sessions")
    .update({
      ended_at: endedAt,
      calculated_amount: calculatedAmount,
      agreed_amount: calculatedAmount,
      driver_note: driverNote ?? null,
    } as never)
    .eq("id", (open as any).id);

  const label = `Waiting time (${elapsedMinutes} min${chargeableMinutes > 0 && ratePerMinute > 0 ? `, ${chargeableMinutes} chargeable` : ""})`;
  await supabaseAdmin.from("job_adjustments").insert({
    job_id: jobId,
    driver_id: driverId,
    company_id: companyId,
    kind: "waiting",
    label,
    amount: calculatedAmount,
    wait_session_id: (open as any).id,
  } as never);

  // Auto-emit a wait_ended pin so the coordinator's map reflects any
  // automatic wait-session close (status transition, emergency override).
  try {
    const { insertTripMapEvent } = await import("@/lib/trip-map.server");
    await insertTripMapEvent(supabaseAdmin, {
      jobId,
      companyId,
      driverId,
      eventType: "wait_ended",
      notes: driverNote ?? null,
      meta: {
        auto: true,
        elapsed_minutes: elapsedMinutes,
        chargeable_minutes: chargeableMinutes,
        calculated_amount: calculatedAmount,
      },
    });
  } catch { /* logging must not block */ }

  return { sessionId: (open as any).id, calculatedAmount, elapsedMinutes };
}

export const startWaitSession = createServerFn({ method: "POST" })
  .inputValidator((i: unknown) =>
    z.object({
      token: z.string().min(8).max(128),
      job_id: z.string().uuid(),
      source: z.enum(["manual", "auto_stopped", "auto_airport"]).default("manual"),
    }).parse(i),
  )
  .handler(async ({ data }) => {
    const { job, supabaseAdmin } = await loadDriverJob(data.token, data.job_id);
    if (!activeStatuses.includes(job.status as any)) throw new Error("trip_not_active");

    // Refuse if there's already an open session (partial unique index also guards).
    const { data: open } = await supabaseAdmin.from("job_wait_sessions" as any)
      .select("id").eq("job_id", job.id).is("ended_at", null).limit(1).maybeSingle();
    if (open) return { ok: true, session_id: (open as any).id, already_open: true };

    const companyId: string = (job as any).executor_company_id ?? (job as any).company_id;
    const { freeWaitMinutes } = await loadWaitPolicy(supabaseAdmin, companyId);
    const startedAt = new Date().toISOString();
    const freeEndsAt = freeWaitMinutes > 0
      ? new Date(new Date(startedAt).getTime() + freeWaitMinutes * 60000).toISOString()
      : null;

    const { data: row, error } = await supabaseAdmin.from("job_wait_sessions" as any).insert({
      job_id: job.id,
      driver_id: job.driver_id,
      company_id: companyId,
      source: data.source,
      started_at: startedAt,
      free_ends_at: freeEndsAt,
    } as never).select("id, started_at, free_ends_at").maybeSingle();
    if (error) throw new Error(error.message);

    // Auto-emit wait_started pin.
    const { insertTripMapEvent } = await import("@/lib/trip-map.server");
    await insertTripMapEvent(supabaseAdmin, {
      jobId: job.id,
      companyId,
      driverId: (job as any).driver_id ?? null,
      eventType: "wait_started",
      meta: {
        source: data.source,
        started_at: (row as any).started_at,
        free_ends_at: (row as any).free_ends_at ?? null,
      },
    });

    return {
      ok: true,
      session_id: (row as any).id,
      started_at: (row as any).started_at,
      free_ends_at: (row as any).free_ends_at ?? null,
    };
  });

export const stopWaitSession = createServerFn({ method: "POST" })
  .inputValidator((i: unknown) =>
    z.object({
      token: z.string().min(8).max(128),
      job_id: z.string().uuid(),
      // agreed_amount is the driver's confirmed final charge (pre-filled with calculated, may be overridden).
      agreed_amount: z.number().min(0).max(100000),
      note: z.string().trim().max(500).optional(),
    }).parse(i),
  )
  .handler(async ({ data }) => {
    const { job, supabaseAdmin } = await loadDriverJob(data.token, data.job_id);
    const { data: open } = await supabaseAdmin.from("job_wait_sessions" as any)
      .select("id, started_at, free_ends_at, company_id").eq("job_id", job.id).is("ended_at", null).limit(1).maybeSingle();
    if (!open) throw new Error("no_open_wait_session");

    const endedAt = new Date().toISOString();
    const sessionCompanyId: string = (open as any).company_id ?? (job as any).executor_company_id ?? (job as any).company_id;
    const { freeWaitMinutes, ratePerMinute } = await loadWaitPolicy(supabaseAdmin, sessionCompanyId);
    const { calculatedAmount, elapsedMinutes, chargeableMinutes } = computeCalculatedAmount(
      (open as any).started_at,
      endedAt,
      freeWaitMinutes,
      ratePerMinute,
      (open as any).free_ends_at,
    );

    const { error: upErr } = await supabaseAdmin.from("job_wait_sessions" as any)
      .update({
        ended_at: endedAt,
        calculated_amount: calculatedAmount,
        agreed_amount: data.agreed_amount,
        driver_note: data.note ?? null,
      } as never)
      .eq("id", (open as any).id);
    if (upErr) throw new Error(upErr.message);

    // Log the waiting charge as an adjustment line item using agreed_amount (the confirmed final).
    const label = `Waiting time (${elapsedMinutes} min${chargeableMinutes > 0 && ratePerMinute > 0 ? `, ${chargeableMinutes} chargeable` : ""})`;
    const { error: adjErr } = await supabaseAdmin.from("job_adjustments" as any).insert({
      job_id: job.id,
      driver_id: job.driver_id,
      company_id: sessionCompanyId,
      kind: "waiting",
      label,
      amount: data.agreed_amount,
      wait_session_id: (open as any).id,
      driver_note: data.note ?? null,
    } as never);
    if (adjErr) throw new Error(adjErr.message);

    // Auto-emit wait_ended pin with the confirmed amount.
    const { insertTripMapEvent } = await import("@/lib/trip-map.server");
    await insertTripMapEvent(supabaseAdmin, {
      jobId: job.id,
      companyId: sessionCompanyId,
      driverId: (job as any).driver_id ?? null,
      eventType: "wait_ended",
      notes: data.note ?? null,
      meta: {
        elapsed_minutes: elapsedMinutes,
        chargeable_minutes: chargeableMinutes,
        calculated_amount: calculatedAmount,
        agreed_amount: data.agreed_amount,
      },
    });

    return { ok: true, elapsed_minutes: elapsedMinutes, calculated_amount: calculatedAmount, agreed_amount: data.agreed_amount };
  });

export const addTripAdjustment = createServerFn({ method: "POST" })
  .inputValidator((i: unknown) =>
    z.object({
      token: z.string().min(8).max(128),
      job_id: z.string().uuid(),
      kind: z.enum(["extra_stop", "toll", "other"]),
      amount: z.number().min(0).max(100000),
      label: z.string().trim().max(80).optional(),
      note: z.string().trim().max(500).optional(),
    }).parse(i),
  )
  .handler(async ({ data }) => {
    const { job, supabaseAdmin } = await loadDriverJob(data.token, data.job_id);
    if (job.status === "cancelled") throw new Error("trip_cancelled");
    const { data: row, error } = await supabaseAdmin.from("job_adjustments" as any).insert({
      job_id: job.id,
      driver_id: job.driver_id,
      company_id: job.executor_company_id ?? job.company_id,
      kind: data.kind,
      label: data.label ?? null,
      amount: data.amount,
      driver_note: data.note ?? null,
    } as never).select("id").maybeSingle();
    if (error) throw new Error(error.message);
    return { ok: true, id: (row as any).id };
  });

export const deleteTripAdjustment = createServerFn({ method: "POST" })
  .inputValidator((i: unknown) =>
    z.object({
      token: z.string().min(8).max(128),
      job_id: z.string().uuid(),
      adjustment_id: z.string().uuid(),
    }).parse(i),
  )
  .handler(async ({ data }) => {
    const { job, supabaseAdmin } = await loadDriverJob(data.token, data.job_id);
    if (job.status === "cancelled") throw new Error("trip_locked");
    const { data: row } = await supabaseAdmin.from("job_adjustments" as any)
      .select("id, kind, wait_session_id, driver_id")
      .eq("id", data.adjustment_id).eq("job_id", job.id).maybeSingle();
    if (!row) throw new Error("adjustment_not_found");
    if ((row as any).driver_id !== job.driver_id) throw new Error("not_your_adjustment");
    if ((row as any).kind === "waiting" && (row as any).wait_session_id) {
      throw new Error("waiting_adjustments_are_locked");
    }
    const { error } = await supabaseAdmin.from("job_adjustments" as any)
      .delete().eq("id", data.adjustment_id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const getDriverJobPricing = createServerFn({ method: "GET" })
  .inputValidator((i: unknown) =>
    z.object({ token: z.string().min(8).max(128), job_id: z.string().uuid() }).parse(i),
  )
  .handler(async ({ data }) => {
    const { job, supabaseAdmin } = await loadDriverJob(data.token, data.job_id);
    const { data: adj } = await supabaseAdmin.from("job_adjustments" as any)
      .select("id, kind, label, amount, driver_note, created_at, wait_session_id")
      .eq("job_id", job.id).order("created_at", { ascending: true });
    const { data: openWait } = await supabaseAdmin.from("job_wait_sessions" as any)
      .select("id, started_at, source, free_ends_at").eq("job_id", job.id).is("ended_at", null).limit(1).maybeSingle();

    const companyId: string = (job as any).executor_company_id ?? (job as any).company_id;
    const { freeWaitMinutes, ratePerMinute } = await loadWaitPolicy(supabaseAdmin, companyId);

    // Compute live charge for the open session (if any).
    let liveCharge = 0;
    if (openWait) {
      const nowIso = new Date().toISOString();
      const { calculatedAmount } = computeCalculatedAmount(
        (openWait as any).started_at,
        nowIso,
        freeWaitMinutes,
        ratePerMinute,
        (openWait as any).free_ends_at,
      );
      liveCharge = calculatedAmount;
    }

    const base = Number((job as any).price ?? (job as any).base_price ?? 0);
    const adjustments = (adj ?? []) as any[];
    const total = adjustments.reduce((s, a) => s + Number(a.amount ?? 0), base);
    return {
      base_price: base,
      currency: (job as any).currency ?? "EUR",
      adjustments,
      open_wait: openWait ? {
        id: (openWait as any).id,
        started_at: (openWait as any).started_at,
        source: (openWait as any).source,
        free_ends_at: (openWait as any).free_ends_at ?? null,
      } : null,
      free_wait_minutes: freeWaitMinutes,
      waiting_rate_per_minute: ratePerMinute,
      live_charge: liveCharge,
      total,
    };
  });

// ============================================================
// WAIT PROPOSALS — driver-facing (read + respond)
// ============================================================

export const getWaitProposalsForDriver = createServerFn({ method: "GET" })
  .inputValidator((i: unknown) =>
    z.object({ token: z.string().min(8).max(128), job_id: z.string().uuid() }).parse(i),
  )
  .handler(async ({ data }) => {
    const { job, supabaseAdmin } = await loadDriverJob(data.token, data.job_id);
    const { data: proposals } = await supabaseAdmin
      .from("job_wait_proposals")
      .select("id, session_id, proposed_amount, note, status, driver_response_note, responded_at, created_at")
      .eq("job_id", job.id)
      .order("created_at", { ascending: false })
      .limit(20);
    return (proposals ?? []) as any[];
  });

export const respondWaitProposal = createServerFn({ method: "POST" })
  .inputValidator((i: unknown) =>
    z.object({
      token: z.string().min(8).max(128),
      job_id: z.string().uuid(),
      proposal_id: z.string().uuid(),
      accept: z.boolean(),
      driver_note: z.string().trim().max(500).optional(),
    }).parse(i),
  )
  .handler(async ({ data }) => {
    const { job, supabaseAdmin } = await loadDriverJob(data.token, data.job_id);
    const { data: proposal } = await supabaseAdmin
      .from("job_wait_proposals")
      .select("id, session_id, proposed_amount, status")
      .eq("id", data.proposal_id)
      .eq("job_id", job.id)
      .maybeSingle();
    if (!proposal) throw new Error("proposal_not_found");
    if ((proposal as any).status !== "pending") throw new Error("proposal_already_resolved");

    const now = new Date().toISOString();
    const newStatus = data.accept ? "accepted" : "rejected";
    const { error: upErr } = await supabaseAdmin
      .from("job_wait_proposals")
      .update({
        status: newStatus,
        driver_response_note: data.driver_note ?? null,
        responded_at: now,
      } as never)
      .eq("id", data.proposal_id);
    if (upErr) throw new Error(upErr.message);

    if (data.accept) {
      const proposedAmount = Number((proposal as any).proposed_amount);
      // Update agreed_amount on the session — NEVER touches calculated_amount.
      if ((proposal as any).session_id) {
        await supabaseAdmin
          .from("job_wait_sessions")
          .update({ agreed_amount: proposedAmount } as never)
          .eq("id", (proposal as any).session_id);
      }
      // Update the linked adjustment row so the trip total reflects the accepted amount.
      const sessionId = (proposal as any).session_id;
      if (sessionId) {
        await supabaseAdmin
          .from("job_adjustments")
          .update({ amount: proposedAmount } as never)
          .eq("wait_session_id", sessionId)
          .eq("job_id", job.id);
      }
    }

    return { ok: true, status: newStatus };
  });

// ==================== Batch C — driver-token stop reorder ====================

export const listGroupStopsForDriver = createServerFn({ method: "GET" })
  .inputValidator((i: unknown) =>
    z.object({ token: z.string().min(8).max(128), group_id: z.string().uuid() }).parse(i),
  )
  .handler(async ({ data }) => {
    const link = await resolveToken(data.token, "driver");
    if (!link) return null;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: stops } = await supabaseAdmin
      .from("group_stops")
      .select("id, stop_index, address, display_name, pax_count")
      .eq("group_id", data.group_id)
      .order("stop_index", { ascending: true });
    const { data: pending } = await supabaseAdmin
      .from("group_stop_reorder_requests")
      .select("id, status, proposed_order, created_at")
      .eq("group_id", data.group_id)
      .eq("status", "pending")
      .order("created_at", { ascending: false })
      .limit(1);
    return { stops: stops ?? [], pending: pending?.[0] ?? null };
  });

export const requestStopReorderByDriver = createServerFn({ method: "POST" })
  .inputValidator((i: unknown) =>
    z
      .object({
        token: z.string().min(8).max(128),
        group_id: z.string().uuid(),
        proposed_order: z.array(z.string().uuid()).min(1),
      })
      .parse(i),
  )
  .handler(async ({ data }) => {
    const link = await resolveToken(data.token, "driver");
    if (!link) throw new Error("invalid_token");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Validate group belongs to the token's company and driver's job.
    const { data: group } = await supabaseAdmin
      .from("groups")
      .select("id, job_id, jobs:job_id(company_id, driver_id)")
      .eq("id", data.group_id)
      .maybeSingle();
    if (!group) throw new Error("group_not_found");
    const job = (group as any).jobs;
    if (!job || job.company_id !== link.company_id) throw new Error("forbidden");

    const { data: inserted, error } = await supabaseAdmin
      .from("group_stop_reorder_requests")
      .insert({
        group_id: data.group_id,
        requested_by_driver_id: job.driver_id ?? null,
        proposed_order: data.proposed_order,
        status: "pending",
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);

    await supabaseAdmin.rpc("record_trip_audit", {
      _job_id: group.job_id,
      _event_type: "stop_reorder_requested",
      _new: { request_id: inserted.id, proposed_order: data.proposed_order } as any,
      _group_id: data.group_id,
      _approval_status: "pending",
      _actor_label: "driver",
      _driver_id: job.driver_id ?? undefined,
    });

    return { ok: true, request_id: inserted.id };
  });

// ==================== Coordinator change-request approval (driver token) ====================

export const listPendingCoordChangesForDriver = createServerFn({ method: "GET" })
  .inputValidator((i: unknown) => z.object({ token: z.string().min(8).max(128) }).parse(i))
  .handler(async ({ data }) => {
    const link = await resolveToken(data.token, "driver");
    if (!link) return { requests: [] };
    const sb = await getAdminClient();
    // Get jobs assigned to this driver (or, for company-wide driver tokens, all company jobs).
    let jobQ = sb.from("jobs").select("id, from_location, to_location, date, time, pickup_display_name, dropoff_display_name, driver_id")
      .eq("company_id", link.company_id);
    if (link.subject_id) jobQ = jobQ.eq("driver_id", link.subject_id);
    const { data: jobs } = await jobQ;
    const jobIds = (jobs ?? []).map((j: any) => j.id);
    if (jobIds.length === 0) return { requests: [] };
    const { data: rows, error } = await sb
      .from("job_coord_change_requests")
      .select("id, job_id, kind, requested_changes, note, status, created_at")
      .in("job_id", jobIds)
      .eq("status", "pending")
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    const byId = new Map<string, any>((jobs ?? []).map((j: any) => [j.id, j]));
    return {
      requests: (rows ?? []).map((r: any) => ({
        ...r,
        job: byId.get(r.job_id) ?? null,
      })),
    };
  });

export const decideCoordChangeRequest = createServerFn({ method: "POST" })
  .inputValidator((i: unknown) =>
    z.object({
      token: z.string().min(8).max(128),
      request_id: z.string().uuid(),
      approve: z.boolean(),
      note: z.string().trim().max(500).optional(),
    }).parse(i),
  )
  .handler(async ({ data }) => {
    const link = await resolveToken(data.token, "driver");
    if (!link) throw new Error("Invalid token");
    const sb = await getAdminClient();
    const { data: req } = await sb
      .from("job_coord_change_requests")
      .select("id, job_id, company_id, kind, requested_changes, status")
      .eq("id", data.request_id)
      .maybeSingle();
    if (!req) throw new Error("Request not found");
    if ((req as any).company_id !== link.company_id) throw new Error("Not allowed");
    if ((req as any).status !== "pending") throw new Error("Request already decided");

    // Verify driver actually owns the job.
    const { data: job } = await sb
      .from("jobs")
      .select("id, company_id, driver_id, group_id")
      .eq("id", (req as any).job_id)
      .eq("company_id", link.company_id)
      .maybeSingle();
    if (!job) throw new Error("Job not found");
    if (link.subject_id && (job as any).driver_id !== link.subject_id) {
      throw new Error("Only the assigned driver can decide this request");
    }
    const driverId = link.subject_id ?? (job as any).driver_id ?? null;

    if (!data.approve) {
      await sb.from("job_coord_change_requests").update({
        status: "rejected",
        decided_at: new Date().toISOString(),
        decided_by_driver_id: driverId,
        decided_note: data.note ?? null,
      } as never).eq("id", data.request_id);
      // If this was a delete request, clear the legacy deletion flag on the job.
      if ((req as any).kind === "delete") {
        await sb.from("jobs").update({ deletion_requested_at: null, deletion_requested_by: null } as never)
          .eq("id", (req as any).job_id);
      }
      await sb.from("trip_messages").insert({
        job_id: (req as any).job_id,
        company_id: link.company_id,
        sender_kind: "system",
        sender_label: "System",
        body: `❌ Driver rejected coordinator's ${(req as any).kind} request${data.note ? ` — ${data.note}` : ""}.`,
        thread_kind: "driver_coord",
        driver_id: driverId,
      } as never);
      return { ok: true, approved: false };
    }

    // Apply the change.
    const changes = ((req as any).requested_changes ?? {}) as Record<string, unknown>;
    const kind = (req as any).kind as "edit" | "reassign" | "cancel" | "delete";

    if (kind === "delete") {
      await sb.from("jobs").delete().eq("id", (req as any).job_id).eq("company_id", link.company_id);
    } else if (kind === "cancel") {
      await sb.from("jobs").update({ status: "cancelled" } as never)
        .eq("id", (req as any).job_id).eq("company_id", link.company_id);
    } else if (kind === "reassign") {
      const newDriverId = (changes.driver_id as string | null | undefined) ?? null;
      const gid = (job as any).group_id as string | null;
      let q = sb.from("jobs").update({ driver_id: newDriverId, driver_accepted_at: null } as never)
        .eq("company_id", link.company_id);
      q = gid ? q.eq("group_id" as any, gid) : q.eq("id", (req as any).job_id);
      await q;
    } else {
      // edit — apply staged fields; recompute pickup_at if date/time changed
      const patch: Record<string, unknown> = { ...changes };
      if ("date" in changes || "time" in changes) {
        try {
          const { data: cur } = await sb.from("jobs").select("date, time").eq("id", (req as any).job_id).maybeSingle();
          const d = (changes.date as string) ?? (cur as any)?.date;
          const t = (changes.time as string) ?? (cur as any)?.time;
          if (d && t) patch.pickup_at = maltaWallTimeToUtcIso(d, t);
        } catch { /* ignore */ }
      }
      // Invalidate cached ETA when addresses changed
      if ("from_location" in changes || "to_location" in changes) {
        patch.route_duration_sec = null;
        patch.route_distance_m = null;
        patch.route_computed_at = null;
      }
      await sb.from("jobs").update(patch as never)
        .eq("id", (req as any).job_id).eq("company_id", link.company_id);
    }

    await sb.from("job_coord_change_requests").update({
      status: "approved",
      decided_at: new Date().toISOString(),
      decided_by_driver_id: driverId,
      decided_note: data.note ?? null,
    } as never).eq("id", data.request_id);

    await sb.from("trip_messages").insert({
      job_id: (req as any).job_id,
      company_id: link.company_id,
      sender_kind: "system",
      sender_label: "System",
      body: `✅ Driver approved coordinator's ${kind} request${data.note ? ` — ${data.note}` : ""}.`,
      thread_kind: "driver_coord",
      driver_id: driverId,
    } as never);

    return { ok: true, approved: true };
  });

// ==================== Driver: snap pickup coordinates ====================

export const driverSnapPickupToHere = createServerFn({ method: "POST" })
  .inputValidator((i: unknown) =>
    z.object({
      token: z.string().min(8).max(128),
      job_id: z.string().uuid(),
      lat: z.number().gte(-90).lte(90),
      lng: z.number().gte(-180).lte(180),
      accuracy_m: z.number().nonnegative().max(10000).nullable().optional(),
    }).parse(i),
  )
  .handler(async ({ data }) => {
    const link = await resolveToken(data.token, "driver");
    if (!link) throw new Error("Invalid token");
    const sb = await getAdminClient();
    const { data: job } = await sb
      .from("jobs")
      .select("id, company_id, driver_id, status")
      .eq("id", data.job_id)
      .eq("company_id", link.company_id)
      .maybeSingle();
    if (!job) throw new Error("Job not found");
    if (link.subject_id && (job as any).driver_id !== link.subject_id) {
      throw new Error("Only the assigned driver can adjust pickup");
    }
    const { error } = await sb
      .from("jobs")
      .update({
        pickup_lat: data.lat,
        pickup_lng: data.lng,
        // Invalidate cached route so next ETA fetch recomputes.
        route_duration_sec: null,
        route_distance_m: null,
        route_computed_at: null,
      } as never)
      .eq("id", data.job_id);
    if (error) throw new Error(error.message);
    await sb.from("trip_messages").insert({
      job_id: data.job_id,
      company_id: link.company_id,
      sender_kind: "system",
      sender_label: "System",
      body: `📍 Driver adjusted pickup coordinates to their current GPS position${data.accuracy_m ? ` (±${Math.round(data.accuracy_m)}m)` : ""}.`,
      thread_kind: "driver_coord",
      driver_id: (job as any).driver_id ?? null,
    } as never);
    // Drop a pin on the trip map so coordinators can see the snap in replay.
    await sb.from("trip_map_events").insert({
      job_id: data.job_id,
      company_id: link.company_id,
      driver_id: (job as any).driver_id ?? null,
      event_type: "pickup_snap",
      lat: data.lat,
      lng: data.lng,
      accuracy_m: data.accuracy_m ?? null,
      notes: "Driver snapped pickup to current GPS",
    } as never);
    return { ok: true };
  });

export const driverSnapDropoffToHere = createServerFn({ method: "POST" })
  .inputValidator((i: unknown) =>
    z.object({
      token: z.string().min(8).max(128),
      job_id: z.string().uuid(),
      lat: z.number().gte(-90).lte(90),
      lng: z.number().gte(-180).lte(180),
      accuracy_m: z.number().nonnegative().max(10000).nullable().optional(),
    }).parse(i),
  )
  .handler(async ({ data }) => {
    const link = await resolveToken(data.token, "driver");
    if (!link) throw new Error("Invalid token");
    const sb = await getAdminClient();
    const { data: job } = await sb
      .from("jobs")
      .select("id, company_id, driver_id, status")
      .eq("id", data.job_id)
      .eq("company_id", link.company_id)
      .maybeSingle();
    if (!job) throw new Error("Job not found");
    if (link.subject_id && (job as any).driver_id !== link.subject_id) {
      throw new Error("Only the assigned driver can adjust drop-off");
    }
    const { error } = await sb
      .from("jobs")
      .update({
        dropoff_lat: data.lat,
        dropoff_lng: data.lng,
        // Invalidate cached route so next ETA fetch recomputes.
        route_duration_sec: null,
        route_distance_m: null,
        route_computed_at: null,
      } as never)
      .eq("id", data.job_id);
    if (error) throw new Error(error.message);
    await sb.from("trip_messages").insert({
      job_id: data.job_id,
      company_id: link.company_id,
      sender_kind: "system",
      sender_label: "System",
      body: `🎯 Driver adjusted drop-off coordinates to their current GPS position${data.accuracy_m ? ` (±${Math.round(data.accuracy_m)}m)` : ""}.`,
      thread_kind: "driver_coord",
      driver_id: (job as any).driver_id ?? null,
    } as never);
    await sb.from("trip_map_events").insert({
      job_id: data.job_id,
      company_id: link.company_id,
      driver_id: (job as any).driver_id ?? null,
      event_type: "dropoff_snap",
      lat: data.lat,
      lng: data.lng,
      accuracy_m: data.accuracy_m ?? null,
      notes: "Driver snapped drop-off to current GPS",
    } as never);
    return { ok: true };
  });



// ==================== Driver: request cancellation (needs coord approval) ====================

export const driverRequestCancel = createServerFn({ method: "POST" })
  .inputValidator((i: unknown) =>
    z.object({
      token: z.string().min(8).max(128),
      job_id: z.string().uuid(),
      reason: z.string().trim().min(1).max(80),
      note: z.string().trim().max(500).optional().nullable(),
    }).parse(i),
  )
  .handler(async ({ data }) => {
    const { link, job, supabaseAdmin } = await loadDriverJob(data.token, data.job_id);
    if (job.status === "cancelled" || job.status === "completed") {
      throw new Error("Trip already " + job.status);
    }
    if (job.driver_cancel_requested_at) {
      throw new Error("A cancellation request is already pending");
    }
    const note = (data.note ?? "").trim() || null;
    const { error } = await supabaseAdmin.from("jobs").update({
      driver_cancel_requested_at: new Date().toISOString(),
      driver_cancel_requested_by: link.subject_id ?? null,
      driver_cancel_reason: data.reason,
      driver_cancel_note: note,
    } as never).eq("id", data.job_id);
    if (error) throw new Error(error.message);
    await supabaseAdmin.from("trip_messages").insert({
      job_id: data.job_id,
      company_id: job.company_id,
      sender_kind: "driver",
      sender_label: link.subject_label ?? "Driver",
      body: `🛑 Driver requested to CANCEL this trip. Reason: ${data.reason}${note ? ` — ${note}` : ""}. Waiting for coordinator approval.`,
      thread_kind: "driver_coord",
      driver_id: link.subject_id ?? null,
    } as never);
    await supabaseAdmin.rpc("record_trip_audit" as never, {
      _job_id: data.job_id,
      _event_type: "driver_cancel_requested",
      _previous: null,
      _new: { reason: data.reason, note },
      _notes: note,
      _approval_status: "pending",
      _driver_id: link.subject_id ?? null,
      _actor_label: "driver",
    } as never);
    return { ok: true };
  });

export const driverWithdrawCancelRequest = createServerFn({ method: "POST" })
  .inputValidator((i: unknown) =>
    z.object({
      token: z.string().min(8).max(128),
      job_id: z.string().uuid(),
    }).parse(i),
  )
  .handler(async ({ data }) => {
    const { link, job, supabaseAdmin } = await loadDriverJob(data.token, data.job_id);
    if (!job.driver_cancel_requested_at) throw new Error("No pending cancellation request");
    const { error } = await supabaseAdmin.from("jobs").update({
      driver_cancel_requested_at: null,
      driver_cancel_requested_by: null,
      driver_cancel_reason: null,
      driver_cancel_note: null,
    } as never).eq("id", data.job_id);
    if (error) throw new Error(error.message);
    await supabaseAdmin.from("trip_messages").insert({
      job_id: data.job_id,
      company_id: job.company_id,
      sender_kind: "driver",
      sender_label: link.subject_label ?? "Driver",
      body: `↩️ Driver withdrew the cancellation request. Trip continues.`,
      thread_kind: "driver_coord",
      driver_id: link.subject_id ?? null,
    } as never);
    await supabaseAdmin.rpc("record_trip_audit" as never, {
      _job_id: data.job_id,
      _event_type: "driver_cancel_withdrawn",
      _new: null,
      _approval_status: "not_required",
      _driver_id: link.subject_id ?? null,
      _actor_label: "driver",
    } as never);
    return { ok: true };
  });
