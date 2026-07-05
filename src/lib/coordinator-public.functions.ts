import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { maltaWallTimeToUtcIso } from "./time";

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
      .select("id, from_location, to_location, date, time, pickup_at, flightorship, from_flight, to_flight, flight_status, flight_status_note, flight_status_updated_at, vehicle, qr_strict_mode, tracking_enabled, clientcompanyname, driver_accepted_at, deletion_requested_at, status, payment_status, driver_id, driver_hidden_at, grouped_count, grouped_at, group_id, group_name, group_note, drivers(name), pax(id,name,status,boarded_at), job_labels(trip_labels(id,name,color))")
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
      const { data: msgs } = await supabaseAdmin.from("trip_messages")
        .select("job_id").in("job_id", jobIds).eq("sender_kind", "coordinator").is("read_by_driver_at", null);
      unread = (msgs ?? []).reduce((acc: Record<string, number>, m: { job_id: string }) => {
        acc[m.job_id] = (acc[m.job_id] ?? 0) + 1; return acc;
      }, {});
    }
    const jobsWithUnread = (jobs ?? []).map((j: { id: string }) => ({ ...j, unread_messages: unread[j.id] ?? 0 }));
    const [branding, features] = await Promise.all([
      loadCompanyBranding(link.company_id),
      loadCompanyFeatures(link.company_id),
    ]);
    return { link, jobs: jobsWithUnread, driver, branding, features };
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
    const { job, supabaseAdmin } = await loadDriverJob(data.token, data.job_id);
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
    const { error } = await supabaseAdmin.from("trip_messages").insert({
      job_id: data.job_id,
      company_id: job.company_id,
      sender_kind: "driver",
      sender_label: link.subject_label ?? "Driver",
      body: data.body,
      thread_kind: data.thread_kind,
      client_identity_id: clientIdentityId,
      pax_id: paxId,
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
    if (data.flight_contains) q = q.or(`from_flight.ilike.%${data.flight_contains}%,to_flight.ilike.%${data.flight_contains}%,flightorship.ilike.%${data.flight_contains}%`);
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
      };
    });
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
    // Withdraw any still-open price proposals from this driver on this job.
    if (link.subject_id) {
      await supabaseAdmin.from("job_price_proposals").update({
        status: "recalled", responded_at: new Date().toISOString(),
      } as never)
        .eq("job_id", data.job_id)
        .eq("from_driver_id", link.subject_id)
        .in("status", ["proposed", "countered"]);
    }
    return { ok: true };
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
      .select("id, name, surname, client_email, from_location, to_location, date, time, pickup_at, status, room_number")
      .eq("company_id", link.company_id)
      .order("pickup_at", { ascending: true, nullsFirst: false });
    const filtered = link.subject_label
      ? q.eq("client_email", link.subject_label)
      : q;
    const { data: bookings, error } = await filtered;
    if (error) throw new Error(error.message);
    const branding = await loadCompanyBranding(link.company_id);
    return { link, bookings: bookings ?? [], branding };
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
    // First "on the way" transition starts the trip timer.
    if (data.status === "en_route" && !(job as any).driver_started_at) {
      patch.driver_started_at = new Date().toISOString();
    }
    if (data.status === "completed") {
      // Legacy merge-grouped counter still clears on this trip.
      patch.grouped_count = null;
      patch.grouped_at = null;
      if (!(job as any).driver_completed_at) {
        patch.driver_completed_at = new Date().toISOString();
      }
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
      .update({ status: "noshow" as never })
      .eq("id", data.pax_id).eq("job_id", data.job_id);
    if (error) throw new Error(error.message);
    await supabaseAdmin.from("trip_messages").insert({
      job_id: data.job_id,
      company_id: job.company_id,
      sender_kind: "driver",
      sender_label: link.subject_label ?? "Driver",
      body: `🚫 No-show: ${(paxRow as any).name}`,
      thread_kind: "driver_coord",
    } as never);
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
      .update({ status: "pending" as never, boarded_at: null, boarded_method: null })
      .eq("id", data.pax_id).eq("job_id", data.job_id);
    if (error) throw new Error(error.message);
    return { ok: true };
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

    // Prefer a currently-active trip; if none, fall back to the driver's next
    // assigned (non-terminal) job so manual "Share my location now" still
    // sends useful data (e.g. the driver's on the way but hasn't updated status yet).
    const { data: activeJobs } = await supabaseAdmin.from("jobs")
      .select("id, company_id, pickup_at, status")
      .eq("driver_id", link.subject_id)
      .in("status", ["en_route", "arrived", "in_progress"])
      .order("pickup_at", { ascending: false })
      .limit(1);
    let active = activeJobs?.[0] as { id: string; company_id: string } | undefined;
    if (!active) {
      const { data: fallback } = await supabaseAdmin.from("jobs")
        .select("id, company_id, pickup_at, status")
        .eq("driver_id", link.subject_id)
        .not("status", "in", "(completed,cancelled)")
        .order("pickup_at", { ascending: true })
        .limit(1);
      active = fallback?.[0] as { id: string; company_id: string } | undefined;
    }
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

    const [branding, features] = await Promise.all([
      loadCompanyBranding(job.company_id),
      loadCompanyFeatures(job.company_id),
    ]);

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
      branding,
      features,
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
