import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { maltaWallTimeToUtcIso } from "./time";

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

async function assertFeatureEnabled(companyId: string, feature: string) {
  const supabaseAdmin = await getAdminClient();
  const { data: ent } = await supabaseAdmin
    .from("company_feature_entitlements")
    .select("enabled, expires_at")
    .eq("company_id", companyId)
    .eq("feature", feature)
    .maybeSingle();
  if (!ent) return; // default enabled
  const expired = ent.expires_at ? new Date(ent.expires_at).getTime() <= Date.now() : false;
  if (!ent.enabled || expired) {
    throw new Error(`This feature ("${feature}") has been disabled by the administrator.`);
  }
}



function makePickupIso(date: string, time: string) {
  try {
    return maltaWallTimeToUtcIso(date, time);
  } catch {
    throw new Error("Invalid pickup date or time");
  }
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
    const cols = "id, company_id, executor_company_id, dispatch_chain_company_ids, from_location, to_location, date, time, pickup_at, flightorship, from_flight, to_flight, flight_status, flight_status_note, flight_status_updated_at, flight_scheduled_at, flight_estimated_at, tracking_enabled, qr_strict_mode, status, driver_id, vehicle, contact_phone, clientcompanyname, driver_accepted_at, deletion_requested_at, payment_status, grouped_count, grouped_at, group_id, group_name, group_note, client_confirmed_at, client_link_token, source, coord_approved_at, parent_job_id, drivers(name,vehicle,phone,seats_available,availability_note), pax(id,name,status,boarded_at), job_labels(trip_labels(id,name,color))";

    let mineQ = supabaseAdmin.from("jobs").select(cols)
      .eq("company_id", c.id).order("pickup_at", { ascending: true });
    if (data.from) mineQ = mineQ.gte("date", data.from);
    if (data.to) mineQ = mineQ.lte("date", data.to);

    let outQ = supabaseAdmin.from("jobs").select(cols + ", executor:executor_company_id(id,name), origin:origin_company_id(id,name)")
      .contains("dispatch_chain_company_ids", [c.id])
      .neq("company_id", c.id)
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
      // I created it — am I still executor, or did I hand it off?
      chain_role: (r.executor_company_id && r.executor_company_id !== c.id) ? "creator_watching" : "executor",
      labels: Array.isArray(r.job_labels) ? r.job_labels.map((j: any) => j.trip_labels).filter(Boolean) : [],
    }));
    const out = (outRes.data ?? []).map((r: any) => {
      const executorName = r.executor?.name ?? "Partner";
      const realDriver = r.drivers?.name ?? null;
      const isExecutor = r.executor_company_id === c.id;
      return {
        ...r,
        external: !isExecutor,
        chain_role: isExecutor ? "executor" : "hop_watching",
        executor_name: executorName,
        origin_name: r.origin?.name ?? null,
        external_driver_name: realDriver,
        // On the watcher board, route through partner lane; when I'm executor, keep real driver.
        driver_id: isExecutor ? r.driver_id : (partnerMap[r.executor_company_id ?? ""] ?? null),
        drivers: isExecutor
          ? r.drivers
          : (realDriver ? { name: `${executorName} → ${realDriver}` } : { name: executorName }),
        labels: Array.isArray(r.job_labels) ? r.job_labels.map((j: any) => j.trip_labels).filter(Boolean) : [],
      };
    });

    const combined: any[] = [...mine, ...out];

    // ---- Multi-hop expansion: creator sees a card in EVERY partner lane the trip has visited.
    const originJobIds = combined
      .filter((r) => r.company_id === c.id && Array.isArray(r.dispatch_chain_company_ids) && r.dispatch_chain_company_ids.length >= 2)
      .map((r) => r.id);
    const hopsByJob = new Map<string, any[]>();
    if (originJobIds.length) {
      const { data: hops } = await supabaseAdmin.from("job_dispatch_hops")
        .select("job_id, hop_index, from_company_id, to_company_id, status, note, decided_at")
        .in("job_id", originJobIds)
        .order("hop_index", { ascending: true });
      for (const h of hops ?? []) {
        if (!hopsByJob.has(h.job_id)) hopsByJob.set(h.job_id, []);
        hopsByJob.get(h.job_id)!.push(h);
      }
    }

    // Resolve names for ALL chain company ids across all rows (for breadcrumb) + hop targets.
    const allCompanyIds = new Set<string>();
    for (const r of combined) {
      for (const id of (r.dispatch_chain_company_ids ?? [])) allCompanyIds.add(id);
      if (r.executor_company_id) allCompanyIds.add(r.executor_company_id);
    }
    for (const list of hopsByJob.values()) for (const h of list) allCompanyIds.add(h.to_company_id);
    allCompanyIds.delete(c.id);
    const nameMap: Record<string, string> = { [c.id]: c.name };
    if (allCompanyIds.size) {
      const { data: comps } = await supabaseAdmin.from("companies")
        .select("id, name").in("id", Array.from(allCompanyIds));
      for (const co of comps ?? []) nameMap[co.id] = co.name;
    }

    // Attach chain_names to every row.
    for (const r of combined) {
      const ids: string[] = Array.isArray(r.dispatch_chain_company_ids) ? r.dispatch_chain_company_ids : [];
      r.chain_names = ids.map((id) => id === c.id ? "You" : (nameMap[id] ?? "Partner"));
      r.dispatch_status = r.dispatch_status ?? null;
    }

    if (originJobIds.length) {
      const extras: any[] = [];
      for (const base of combined) {
        if (!originJobIds.includes(base.id)) continue;
        const list = hopsByJob.get(base.id) ?? [];
        // Emit one synthetic card per non-final hop (final hop = current executor, already rendered).
        for (let i = 0; i < list.length - 1; i++) {
          const h = list[i];
          const partnerLaneDriver = partnerMap[h.to_company_id] ?? null;
          if (!partnerLaneDriver) continue; // no lane on my board, skip
          extras.push({
            ...base,
            id: `${base.id}::hop-${h.hop_index}`, // synthetic id
            _origin_job_id: base.id,
            _hop_index: h.hop_index,
            _hop_status: h.status,
            external: true,
            chain_role: "hop_watching",
            executor_name: nameMap[h.to_company_id] ?? "Partner",
            driver_id: partnerLaneDriver,
            drivers: { name: `${nameMap[h.to_company_id] ?? "Partner"} · handed off` },
          });
        }
      }
      combined.push(...extras);
    }

    return combined;
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

export const rescheduleJobToFlight = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const c = await resolveCompany(context);
    const supabaseAdmin = await getAdminClient();
    const { data: job, error: e1 } = await supabaseAdmin
      .from("jobs")
      .select("id, company_id, date, time, flight_scheduled_at, flight_estimated_at")
      .eq("id", data.id).eq("company_id", c.id).maybeSingle();
    if (e1 || !job) throw new Error("Job not found");
    const iso = (job as any).flight_estimated_at || (job as any).flight_scheduled_at;
    if (!iso) throw new Error("No flight time available yet");
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) throw new Error("Invalid flight time");
    const date = d.toISOString().slice(0, 10);
    const time = d.toISOString().slice(11, 16);
    const pickup_at = makePickupIso(date, time);
    const { error } = await supabaseAdmin.from("jobs").update({
      date, time, pickup_at,
      flight_status: "on_time",
      flight_status_note: null,
      flight_status_updated_at: new Date().toISOString(),
    }).eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true, date, time };
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
    const { data: job } = await supabaseAdmin.from("jobs")
      .select("id, company_id, group_id" as any)
      .eq("id", data.job_id).eq("company_id", c.id).maybeSingle();
    if (!job) throw new Error("Job not found");
    const gid = (job as any).group_id as string | null;
    let q = supabaseAdmin.from("jobs").update({ driver_id: data.driver_id }).eq("company_id", c.id);
    q = gid ? q.eq("group_id" as any, gid) : q.eq("id", data.job_id);
    const { error } = await q;
    if (error) throw new Error(error.message);
    return { ok: true, group_id: gid };
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
      .eq("id", data.job_id).eq("company_id", c.id).maybeSingle();
    if (error) throw new Error(error.message);
    if (!job) return { deleted: false, pending: false, missing: true };
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
    await assertFeatureEnabled(c.id, "bulk_paste");
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
  // Board shows Malta local time — anchor to the pickup's Malta calendar date
  // and combine with the HH:MM as Malta wall-clock, then store as UTC ISO.
  const maltaParts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Malta", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(base);
  const get = (t: string) => maltaParts.find((p) => p.type === t)!.value;
  const dateStr = `${get("year")}-${get("month")}-${get("day")}`;
  const hh = String(Number(m[1])).padStart(2, "0");
  const mm = String(Number(m[2])).padStart(2, "0");
  try {
    return maltaWallTimeToUtcIso(dateStr, `${hh}:${mm}`);
  } catch {
    return null;
  }
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
    flight_terminal: row.terminal ?? null,
    flight_gate: row.gate ?? null,
    flight_baggage_belt: (row as any).baggage_belt ?? (row as any).belt ?? null,
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
      .select("id")
      .eq("id", data.job_id)
      .or(`company_id.eq.${c.id},executor_company_id.eq.${c.id},origin_company_id.eq.${c.id},dispatch_chain_company_ids.cs.{${c.id}}`)
      .maybeSingle();
    if (jErr) throw new Error(jErr.message);
    if (!job) return [];
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
      .select("*").eq("id", data.source_job_id).single();
    if (error || !src) throw new Error("Job not found");
    const isOwner = src.company_id === c.id;
    const isExecutor = src.executor_company_id === c.id;
    if (!isOwner && !isExecutor) throw new Error("Job not found");

    // Mint a fresh per-child client link token so moved pax only see their split.
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    const childToken = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

    // If the caller is a partner-executor of a dispatched trip, inherit the chain
    // so the creator continues to see the split children in the same partner lane.
    const inheritsChain = !isOwner && isExecutor;
    const insertPayload: Record<string, unknown> = {
      // Trip core
      company_id: inheritsChain ? src.company_id : c.id,
      from_location: src.from_location, to_location: src.to_location,
      date: src.date, time: src.time, pickup_at: src.pickup_at,
      flightorship: src.flightorship, clientcompanyname: src.clientcompanyname,
      qr_strict_mode: false, tracking_enabled: false,
      vehicle: data.vehicle || null, driver_id: data.driver_id ?? null,
      parent_job_id: src.id,
      // Flight context
      from_flight: src.from_flight ?? null,
      to_flight: src.to_flight ?? null,
      flight_status: src.flight_status ?? null,
      flight_status_note: src.flight_status_note ?? null,
      flight_status_updated_at: src.flight_status_updated_at ?? null,
      flight_scheduled_at: src.flight_scheduled_at ?? null,
      flight_estimated_at: src.flight_estimated_at ?? null,
      // Contact + grouping + approval + provenance
      contact_phone: src.contact_phone ?? null,
      group_id: src.group_id ?? null,
      group_name: src.group_name ?? null,
      group_note: src.group_note ?? null,
      grouped_count: src.grouped_count ?? null,
      grouped_at: src.grouped_at ?? null,
      coord_approved_at: src.coord_approved_at ?? new Date().toISOString(),
      source: src.source ?? null,
      // Per-child client portal token
      client_link_token: childToken,
    };
    if (inheritsChain) {
      insertPayload.origin_company_id = src.origin_company_id ?? src.company_id;
      insertPayload.executor_company_id = c.id;
      insertPayload.dispatch_chain_company_ids = src.dispatch_chain_company_ids ?? [src.company_id, c.id];
      insertPayload.dispatch_status = "accepted";
      insertPayload.dispatched_at = src.dispatched_at ?? new Date().toISOString();
      insertPayload.dispatch_decided_at = new Date().toISOString();
    }
    const { data: job, error: iErr } = await supabaseAdmin.from("jobs")
      .insert(insertPayload as never).select("id").single();
    if (iErr) throw new Error(iErr.message);

    if (inheritsChain) {
      // Mirror the accepted hop so chain timelines / statements reflect the split child.
      await supabaseAdmin.from("job_dispatch_hops").insert({
        job_id: job.id,
        hop_index: 0,
        from_company_id: src.origin_company_id ?? src.company_id,
        to_company_id: c.id,
        status: "accepted",
        note: "split from parent trip",
        decided_at: new Date().toISOString(),
      });
    }

    // Copy labels from parent → child so the card is visually complete.
    const { data: parentLabels } = await supabaseAdmin.from("job_labels")
      .select("label_id").eq("job_id", src.id);
    if (parentLabels && parentLabels.length) {
      await supabaseAdmin.from("job_labels").insert(
        parentLabels.map((l: any) => ({ job_id: job.id, label_id: l.label_id })),
      );
    }

    // Move the selected pax to the child.
    const { error: uErr } = await supabaseAdmin.from("pax")
      .update({ job_id: job.id })
      .in("id", data.pax_ids).eq("job_id", data.source_job_id);
    if (uErr) throw new Error(uErr.message);

    // Rebind any client-link identities tied to those pax to the child's token,
    // so the moved passengers' portal link resolves to the split they're on.
    if (src.client_link_token) {
      await supabaseAdmin.from("client_link_identities")
        .update({ token: childToken } as never)
        .eq("token", src.client_link_token)
        .in("pax_id", data.pax_ids);
    }

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

export const setJobGrouped = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({
      job_id: z.string().uuid(),
      count: z.number().int().min(0).max(500),
    }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const c = await resolveCompany(context);
    const supabaseAdmin = await getAdminClient();
    const { data: job, error } = await supabaseAdmin.from("jobs")
      .select("id, company_id, executor_company_id, grouped_count")
      .eq("id", data.job_id).maybeSingle();
    if (error) throw new Error(error.message);
    if (!job || (job.company_id !== c.id && job.executor_company_id !== c.id)) {
      throw new Error("Job not found");
    }
    const existing = (job as any).grouped_count ?? 0;
    const total = Math.max(existing, 0) + data.count;
    const patch = total >= 2
      ? { grouped_count: total, grouped_at: new Date().toISOString() }
      : { grouped_count: null, grouped_at: null };
    const { error: uErr } = await supabaseAdmin.from("jobs")
      .update(patch as never).eq("id", data.job_id);
    if (uErr) throw new Error(uErr.message);
    return { ok: true, grouped_count: total };
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

// ---------- Trip pricing (coordinator only) ----------
// Reads and writes the sensitive price/payment fields on jobs. Access is
// bulletproofed by:
//   1. `requireSupabaseAuth` — must be a signed-in coordinator/admin.
//   2. `assertJobInCompany` — job must be owned by, dispatched to, or in the
//      dispatch chain of the caller's company. Every coordinator in the chain
//      can therefore see the price, per product requirement.
//   3. Explicit column projection — we never send price data to driver/client
//      endpoints (`getDriverManifest`, `getDriverStatement`, `getClientTripPortal`
//      all list explicit columns; grep for those to verify).
export const getTripPricing = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ job_id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    await assertJobInCompany(context, data.job_id);
    const supabaseAdmin = await getAdminClient();
    const { data: row, error } = await supabaseAdmin.from("jobs")
      .select("id, price_amount, price_currency, payment_method, payment_status, price_set_by, price_set_at, driver_started_at, driver_completed_at, driver_actual_minutes, driver_reported_km, driver_note")
      .eq("id", data.job_id).maybeSingle();
    if (error) throw new Error(error.message);
    return row ?? null;
  });

export const coordinatorSetTripPrice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({
    job_id: z.string().uuid(),
    price_amount: z.number().nonnegative().max(1_000_000).nullable(),
    price_currency: z.string().trim().min(3).max(4).optional(),
    payment_method: z.enum(["cash", "invoice"]).nullable().optional(),
  }).parse(i))
  .handler(async ({ data, context }) => {
    await assertJobInCompany(context, data.job_id);
    const supabaseAdmin = await getAdminClient();
    const patch: Record<string, unknown> = {
      price_amount: data.price_amount,
      price_currency: (data.price_currency ?? "EUR").toUpperCase(),
      price_set_by: "coordinator",
      price_set_at: new Date().toISOString(),
    };
    if (data.payment_method !== undefined) {
      patch.payment_method = data.payment_method;
      if (data.payment_method === "cash") patch.payment_status = "paid";
      if (data.payment_method === "invoice") patch.payment_status = "pending";
    }
    const { error } = await supabaseAdmin.from("jobs")
      .update(patch as never).eq("id", data.job_id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });



async function siblingGroupJobIds(supabaseAdmin: Awaited<ReturnType<typeof getAdminClient>>, jobId: string): Promise<string[]> {
  const { data: row } = await supabaseAdmin.from("jobs")
    .select("group_id" as any).eq("id", jobId).maybeSingle();
  const gid = (row as any)?.group_id as string | null;
  if (!gid) return [jobId];
  const { data: sibs } = await supabaseAdmin.from("jobs")
    .select("id").eq("group_id" as any, gid);
  const ids = (sibs ?? []).map((s: any) => s.id as string);
  return ids.length ? ids : [jobId];
}

export const listTripMessagesCoord = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({
    job_id: z.string().uuid(),
    identity_id: z.string().uuid().nullish(),
    pax_id: z.string().uuid().nullish(),
    thread_kind: z.enum(["all", "private", "group", "driver"]).optional().default("all"),
  }).parse(i))
  .handler(async ({ data, context }) => {
    await assertJobInCompany(context, data.job_id);
    const supabaseAdmin = await getAdminClient();
    const ids = await siblingGroupJobIds(supabaseAdmin, data.job_id);
    const { data: rows, error } = await supabaseAdmin.from("trip_messages")
      .select("id, sender_kind, sender_label, body, created_at, read_by_coordinator_at, thread_kind, client_identity_id, pax_id")
      .in("job_id", ids).order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    // Coordinator NEVER sees driver↔client private messages.
    let filtered = ((rows ?? []) as any[]).filter((r) => r.thread_kind !== "driver_client");

    // If a pax_id was provided but no identity_id, look up the identity tied to that pax.
    let effectiveIdentityId: string | null = data.identity_id ?? null;
    if (data.pax_id && !effectiveIdentityId) {
      const { data: ident } = await supabaseAdmin
        .from("client_link_identities")
        .select("id").eq("pax_id", data.pax_id).order("last_seen_at", { ascending: false }).limit(1).maybeSingle();
      effectiveIdentityId = (ident as any)?.id ?? null;
    }

    if (data.thread_kind === "driver") {
      filtered = filtered.filter((r) => r.thread_kind === "driver_coord");
    } else if (data.thread_kind === "private" && (effectiveIdentityId || data.pax_id)) {
      filtered = filtered.filter((r) =>
        (effectiveIdentityId && r.client_identity_id === effectiveIdentityId) ||
        (data.pax_id && r.pax_id === data.pax_id) ||
        (r.sender_kind === "coordinator" && (r.thread_kind === "group" || r.thread_kind == null) && !r.client_identity_id && !r.pax_id)
      );
    } else if (data.thread_kind === "group") {
      filtered = filtered.filter((r) =>
        r.thread_kind !== "driver_coord" && (
          (r.sender_kind === "driver" && (r.thread_kind === "group" || r.thread_kind == null)) ||
          ((r.thread_kind === "group" || r.thread_kind == null) && !r.pax_id)
        )
      );
    } else {
      // "all" — hide the driver-only private channel too
      filtered = filtered.filter((r) => r.thread_kind !== "driver_coord");
    }
    const unreadIds = filtered.filter((r) =>
      (r.sender_kind === "driver" || r.sender_kind === "client") && !r.read_by_coordinator_at).map((r) => r.id);
    if (unreadIds.length) {
      await supabaseAdmin.from("trip_messages")
        .update({ read_by_coordinator_at: new Date().toISOString() })
        .in("id", unreadIds);
    }
    return filtered;
  });


export const postTripMessageCoord = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({
      job_id: z.string().uuid(),
      body: z.string().trim().min(1).max(4000),
      identity_id: z.string().uuid().nullish(),
      pax_id: z.string().uuid().nullish(),
      thread_kind: z.enum(["group", "private", "driver"]).optional().default("group"),
    }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const { company } = await assertJobInCompany(context, data.job_id);
    await assertFeatureEnabled(company.id, "chat");
    const supabaseAdmin = await getAdminClient();
    const { data: userRow } = await supabaseAdmin.auth.admin.getUserById(context.userId);
    const label = userRow?.user?.email ?? "Coordinator";

    if (data.thread_kind === "driver") {
      const { error } = await supabaseAdmin.from("trip_messages").insert({
        job_id: data.job_id,
        company_id: company.id,
        sender_kind: "coordinator",
        sender_label: label,
        body: data.body,
        thread_kind: "driver_coord",
      } as any);
      if (error) throw new Error(error.message);
      return { ok: true };
    }

    // Resolve identity from pax_id if not provided (so once a passenger picks
    // their name the private thread continues seamlessly).
    let identityId: string | null = data.identity_id ?? null;
    if (data.pax_id && !identityId) {
      const { data: ident } = await supabaseAdmin
        .from("client_link_identities")
        .select("id").eq("pax_id", data.pax_id).order("last_seen_at", { ascending: false }).limit(1).maybeSingle();
      identityId = (ident as any)?.id ?? null;
    }

    const isPrivate = data.thread_kind === "private" && (!!identityId || !!data.pax_id);
    const { error } = await supabaseAdmin.from("trip_messages").insert({
      job_id: data.job_id,
      company_id: company.id,
      sender_kind: "coordinator",
      sender_label: label,
      body: data.body,
      thread_kind: isPrivate ? "private" : "group",
      client_identity_id: isPrivate ? identityId : null,
      pax_id: isPrivate ? (data.pax_id ?? null) : null,
    } as any);
    if (error) throw new Error(error.message);
    return { ok: true };
  });


export const getUnreadCountsCoord = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const c = await resolveCompany(context);
    const supabaseAdmin = await getAdminClient();
    const { data, error } = await supabaseAdmin.from("trip_messages")
      .select("job_id, sender_kind").eq("company_id", c.id).is("read_by_coordinator_at", null)
      .in("sender_kind", ["driver", "client"])
      .not("thread_kind", "eq", "driver_client");
    if (error) throw new Error(error.message);
    const acc: Record<string, { driver: number; client: number; total: number }> = {};
    for (const m of (data ?? []) as { job_id: string; sender_kind: string }[]) {
      const row = (acc[m.job_id] ??= { driver: 0, client: 0, total: 0 });
      if (m.sender_kind === "client") row.client += 1;
      else row.driver += 1;
      row.total += 1;
    }
    return acc;
  });

export const getClientPresenceCoord = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => {
    const parsed = z.object({ job_ids: z.array(z.string()).max(500) }).parse(i);
    const uuid = z.string().uuid();
    return { job_ids: Array.from(new Set(parsed.job_ids.filter((id) => uuid.safeParse(id).success))) };
  })
  .handler(async ({ data, context }) => {
    await resolveCompany(context);
    if (!data.job_ids.length) return {} as Record<string, string>;
    const supabaseAdmin = await getAdminClient();
    // join via jobs.client_link_token -> identities.token
    const { data: jobs } = await supabaseAdmin.from("jobs")
      .select("id, client_link_token").in("id", data.job_ids);
    const tokens = (jobs ?? []).map((j) => j.client_link_token).filter(Boolean) as string[];
    if (!tokens.length) return {};
    const { data: idents } = await supabaseAdmin.from("client_link_identities")
      .select("token, last_seen_at").in("token", tokens);
    const bestByToken: Record<string, string> = {};
    for (const r of (idents ?? []) as { token: string; last_seen_at: string | null }[]) {
      if (!r.last_seen_at) continue;
      if (!bestByToken[r.token] || bestByToken[r.token] < r.last_seen_at) bestByToken[r.token] = r.last_seen_at;
    }
    const out: Record<string, string> = {};
    for (const j of jobs ?? []) {
      if (j.client_link_token && bestByToken[j.client_link_token]) out[j.id] = bestByToken[j.client_link_token];
    }
    return out;
  });

export const listPaxActivityCoord = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ job_id: z.string().min(1) }).parse(i))
  .handler(async ({ data, context }) => {
    const jobId = String(data.job_id).split("::")[0];
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(jobId)) return {};
    try { await assertJobInCompany(context, jobId); } catch { return {}; }

    const supabaseAdmin = await getAdminClient();
    const jobIds = await siblingGroupJobIds(supabaseAdmin, jobId);

    const [{ data: paxRows }, { data: jobsRows }, { data: msgRows }] = await Promise.all([
      supabaseAdmin.from("pax").select("id, name, job_id").in("job_id", jobIds),
      supabaseAdmin.from("jobs").select("id, client_link_token").in("id", jobIds),
      supabaseAdmin.from("trip_messages")
        .select("id, job_id, client_identity_id, pax_id, sender_kind, sender_label, body, created_at, read_by_coordinator_at, thread_kind")
        .in("job_id", jobIds).order("created_at", { ascending: true }),
    ]);

    const tokens = (jobsRows ?? []).map((j: any) => j.client_link_token).filter(Boolean) as string[];
    const { data: idents } = tokens.length
      ? await supabaseAdmin.from("client_link_identities")
          .select("id, token, pax_id, pax_name, last_seen_at, first_seen_at").in("token", tokens)
      : { data: [] as any[] };

    const norm = (s: string | null | undefined) => (s ?? "").trim().toLowerCase().replace(/\s+/g, " ");
    type Ident = { id: string; pax_id: string | null; pax_name: string | null; last_seen_at: string | null; first_seen_at: string | null };
    const identsArr = (idents ?? []) as Ident[];

    const now = Date.now();
    const out: Record<string, {
      identity_id: string | null;
      last_seen_at: string | null;
      first_seen_at: string | null;
      presence: "online" | "away" | "never";
      last_message: { body: string; created_at: string; sender_kind: string; sender_label: string | null; read_by_coordinator_at: string | null } | null;
      unread_count: number;
    }> = {};

    for (const p of (paxRows ?? []) as { id: string; name: string; job_id: string }[]) {
      const byId = identsArr.find((i) => i.pax_id === p.id);
      const byName = byId ?? identsArr.find((i) => norm(i.pax_name) === norm(p.name));
      const ident = byId ?? byName ?? null;

      let msgs = (msgRows ?? []).filter((m: any) => m.sender_kind !== "coordinator");
      if (ident) {
        msgs = msgs.filter((m: any) =>
          m.client_identity_id === ident.id ||
          m.pax_id === p.id ||
          (m.thread_kind === "group" && m.client_identity_id === null && !m.pax_id)
        );
      } else {
        // Include queued coordinator messages tied to this pax slot + group client messages
        msgs = (msgRows ?? []).filter((m: any) =>
          m.pax_id === p.id ||
          (m.sender_kind === "client" && m.thread_kind === "group")
        );
      }
      const last = msgs.length ? msgs[msgs.length - 1] : null;
      const unread = msgs.filter((m: any) => m.sender_kind === "client" && !m.read_by_coordinator_at).length;

      const lastSeen = ident?.last_seen_at ?? null;
      const firstSeen = ident?.first_seen_at ?? null;
      const presence: "online" | "away" | "never" =
        lastSeen && (now - new Date(lastSeen).getTime()) < 60_000 ? "online"
        : (lastSeen || firstSeen) ? "away"
        : "never";

      out[p.id] = {
        identity_id: ident?.id ?? null,
        last_seen_at: lastSeen,
        first_seen_at: firstSeen,
        presence,
        last_message: last ? {
          body: last.body, created_at: last.created_at,
          sender_kind: last.sender_kind, sender_label: last.sender_label,
          read_by_coordinator_at: last.read_by_coordinator_at,
        } : null,
        unread_count: unread,
      };
    }
    return out;
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
        price_amount, price_currency, payment_method, price_set_by, price_set_at,
        driver_actual_minutes, driver_reported_km, driver_started_at, driver_completed_at,
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
        price_amount: j.price_amount != null ? Number(j.price_amount) : null,
        price_currency: j.price_currency ?? "",
        payment_method: j.payment_method ?? "",
        price_display: j.price_amount != null
          ? `${Number(j.price_amount).toFixed(2)} ${j.price_currency ?? ""}`.trim()
          : "",
        price_set_by: j.price_set_by ?? "",
        driver_actual_minutes: j.driver_actual_minutes ?? null,
        driver_reported_km: j.driver_reported_km != null ? Number(j.driver_reported_km) : null,

        
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
    const { extractPhoneFromName, extractFlightCode, normalizePhone, isMeaningfulName } = await import("./parse-trips");
    const supabaseAdmin = await getAdminClient();
    const { data: job, error: je } = await supabaseAdmin
      .from("jobs")
      .select("id, contact_phone, from_flight, to_flight, from_location, to_location, flightorship")
      .eq("id", data.job_id).maybeSingle();
    if (je || !job) return { ok: false, changed: 0, removed: 0 };

    let changed = 0;
    let removed = 0;
    let discoveredPhone = "";

    // Pax cleanup: strip embedded phones, delete blank/emoji-only rows.
    const { data: paxRows } = await supabaseAdmin
      .from("pax").select("id, name").eq("job_id", data.job_id);
    for (const p of paxRows ?? []) {
      const { cleanName, phone } = extractPhoneFromName(p.name ?? "");
      if (phone && !discoveredPhone) discoveredPhone = phone;
      if (!isMeaningfulName(cleanName)) {
        await supabaseAdmin.from("pax").delete().eq("id", p.id);
        removed++;
        continue;
      }
      if (cleanName !== (p.name ?? "").trim()) {
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

    return { ok: true, changed, removed, phoneMoved: !!jobPatch.contact_phone };
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

// ---------- AI TRIP EXTRACTION ----------
export const extractTripsFromText = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ text: z.string().min(3).max(20000) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const supabaseAdmin = await getAdminClient();
    // Feature gate — admin can disable per company
    const { data: co } = await supabaseAdmin
      .from("companies").select("id").eq("owner_user_id", context.userId).maybeSingle();
    if (co) await assertFeatureEnabled(co.id, "ai_extraction");


    const key = process.env.LOVABLE_API_KEY;
    if (!key) throw new Error("AI is not configured");

    const { generateText, Output, NoObjectGeneratedError } = await import("ai");
    const { createLovableAiGatewayProvider } = await import("@/lib/ai-gateway.server");
    const gateway = createLovableAiGatewayProvider(key);
    const model = gateway("google/gemini-3-flash-preview");

    const today = new Date().toISOString().slice(0, 10);
    const schema = z.object({
      trips: z.array(z.object({
        from_location: z.string(),
        to_location: z.string(),
        pickup_date: z.string(), // YYYY-MM-DD
        pickup_time: z.string(), // HH:mm 24h
        flight_code: z.string().nullable(),
        contact_phone: z.string().nullable(),
        client_company: z.string().nullable(),
        notes: z.string().nullable(),
        passengers: z.array(z.string()),
      })),
    });

    const system = [
      "You extract crew-change transport trips from messages in ANY language (English, Italian, Spanish, French, Tagalog, etc.).",
      "Return one entry per distinct trip. Split multiple trips when dates/times/routes clearly differ.",
      "Rules:",
      `- Today's date is ${today}. Resolve relative words ("today"/"oggi", "tomorrow"/"domani") to YYYY-MM-DD.`,
      "- pickup_time must be 24h HH:mm.",
      "- flight_code: uppercase, no space (e.g. 'km 643' -> 'KM643'). null if none.",
      "- If a flight is present and location is missing, use 'Airport'.",
      "- contact_phone: extract any phone number in E.164-ish form. null if none.",
      "- passengers: array of clean human names only, no phone numbers, no emojis, no bullet chars.",
      "- Do NOT invent data. Leave string fields empty ('') and null nullable fields when unknown.",
    ].join("\n");

    try {
      const { output } = await generateText({
        model,
        system,
        prompt: data.text,
        output: Output.object({ schema }),
      });
      return output;
    } catch (err: any) {
      if (NoObjectGeneratedError.isInstance?.(err)) {
        throw new Error("AI could not extract trips from this text");
      }
      const msg = String(err?.message ?? err);
      if (msg.includes("429")) throw new Error("AI is rate limited — try again in a moment");
      if (msg.includes("402")) throw new Error("AI credits exhausted — add credits in Settings → Plans & credits");
      throw new Error(msg);
    }
  });

// ---------- Group / Ungroup (reversible link, keeps trip details) ----------

export const groupJobs = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({
      job_ids: z.array(z.string().uuid()).min(2).max(50),
      name: z.string().trim().max(80).optional(),
      note: z.string().trim().max(500).optional(),
      driver_id: z.string().uuid().nullable().optional(),
    }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const c = await resolveCompany(context);
    const supabaseAdmin = await getAdminClient();
    const { data: rows, error } = await supabaseAdmin.from("jobs")
      .select("id, company_id, group_id" as any)
      .in("id", data.job_ids).eq("company_id", c.id);
    if (error) throw new Error(error.message);
    if (!rows || rows.length !== data.job_ids.length) throw new Error("Some trips not found");

    // Reuse an existing group_id from the selection if present; else mint new.
    const existing = (rows as any[]).map((r) => r.group_id).find((g) => !!g) as string | undefined;
    const gid = existing ?? (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`);
    const total = rows.length;

    const patch: Record<string, unknown> = {
      group_id: gid,
      grouped_count: total,
      grouped_at: new Date().toISOString(),
    };
    if (data.name !== undefined) patch.group_name = data.name || null;
    if (data.note !== undefined) patch.group_note = data.note || null;
    if (data.driver_id !== undefined) {
      patch.driver_id = data.driver_id;
      // reset acceptance when driver changes
      patch.driver_accepted_at = null;
    }

    const { error: uErr } = await supabaseAdmin.from("jobs")
      .update(patch as never)
      .in("id", data.job_ids);
    if (uErr) throw new Error(uErr.message);
    return { ok: true, group_id: gid, count: total };
  });



export const ungroupJobs = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({
      job_id: z.string().uuid().optional(),
      group_id: z.string().uuid().optional(),
    }).refine((v) => v.job_id || v.group_id, "job_id or group_id required").parse(i),
  )
  .handler(async ({ data, context }) => {
    const c = await resolveCompany(context);
    const supabaseAdmin = await getAdminClient();

    let gid = data.group_id ?? null;
    if (!gid && data.job_id) {
      const { data: row, error: rowError } = await supabaseAdmin.from("jobs")
        .select("group_id, company_id" as any)
        .eq("id", data.job_id).maybeSingle();
      if (rowError) throw new Error(rowError.message);
      if (!row || (row as any).company_id !== c.id) {
        return { ok: true, cleared: 0, missing: true };
      }
      gid = (row as any).group_id ?? null;
    }
    if (!gid) return { ok: true, cleared: 0 };

    const { error, count } = await supabaseAdmin.from("jobs")
      .update({ group_id: null, grouped_count: null, grouped_at: null } as never, { count: "exact" })
      .eq("group_id" as any, gid).eq("company_id", c.id);
    if (error) throw new Error(error.message);
    return { ok: true, cleared: count ?? 0 };
  });

// ---------- Update group metadata (rename / re-note / re-driver) ----------
export const updateGroupMeta = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({
      group_id: z.string().uuid(),
      name: z.string().trim().max(80).nullable().optional(),
      note: z.string().trim().max(500).nullable().optional(),
      driver_id: z.string().uuid().nullable().optional(),
    }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const c = await resolveCompany(context);
    const supabaseAdmin = await getAdminClient();
    const patch: Record<string, unknown> = {};
    if (data.name !== undefined) patch.group_name = data.name || null;
    if (data.note !== undefined) patch.group_note = data.note || null;
    if (data.driver_id !== undefined) {
      patch.driver_id = data.driver_id;
      patch.driver_accepted_at = null;
    }
    if (Object.keys(patch).length === 0) return { ok: true, updated: 0 };
    const { error, count } = await supabaseAdmin.from("jobs")
      .update(patch as never, { count: "exact" })
      .eq("group_id" as any, data.group_id).eq("company_id", c.id);
    if (error) throw new Error(error.message);
    return { ok: true, updated: count ?? 0 };
  });

// ---------- Share entire group as one WhatsApp message / link ----------
export const shareGroupToDriver = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ group_id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const c = await resolveCompany(context);
    const supabaseAdmin = await getAdminClient();
    const { data: jobs, error } = await supabaseAdmin.from("jobs")
      .select("id,date,time,pickup_at,from_location,from_flight,to_location,to_flight,vehicle,driver_id,group_name,group_note,drivers(name)")
      .eq("group_id" as any, data.group_id).eq("company_id", c.id)
      .order("date", { ascending: true }).order("time", { ascending: true });
    if (error) throw new Error(error.message);
    if (!jobs || jobs.length === 0) throw new Error("Group not found");
    const driverIds = Array.from(new Set(jobs.map((j: any) => j.driver_id).filter(Boolean)));
    if (driverIds.length === 0) throw new Error("Assign a driver to the group first");
    if (driverIds.length > 1) throw new Error("Trips in the group have different drivers");
    const driverId = driverIds[0] as string;
    const driverName = (jobs[0] as any).drivers?.name ?? null;

    const nowIso = new Date().toISOString();
    const { data: existing } = await supabaseAdmin.from("magic_links")
      .select("*").eq("company_id", c.id).eq("kind", "driver").eq("subject_id", driverId)
      .is("revoked_at", null).gt("expires_at", nowIso)
      .order("expires_at", { ascending: false }).limit(1).maybeSingle();
    let link = existing;
    if (!link) {
      const bytes = new Uint8Array(24);
      crypto.getRandomValues(bytes);
      const token = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
      const expires_at = new Date(Date.now() + 7 * 24 * 3600_000).toISOString();
      const { data: row, error: le } = await supabaseAdmin.from("magic_links").insert({
        company_id: c.id, kind: "driver", subject_id: driverId,
        subject_label: driverName ? `${driverName} portal` : "Driver portal",
        token, expires_at, created_by: context.userId,
      }).select().single();
      if (le) throw new Error(le.message);
      link = row;
    }
    const ids = jobs.map((j: any) => j.id);
    const { data: paxRows } = await supabaseAdmin.from("pax").select("job_id").in("job_id", ids);
    const paxByJob: Record<string, number> = {};
    for (const p of paxRows ?? []) paxByJob[(p as any).job_id] = (paxByJob[(p as any).job_id] ?? 0) + 1;
    const totalPax = Object.values(paxByJob).reduce((a, b) => a + b, 0);
    const groupName = (jobs.find((j: any) => j.group_name) as any)?.group_name ?? null;
    const groupNote = (jobs.find((j: any) => j.group_note) as any)?.group_note ?? null;
    return {
      token: link.token,
      expires_at: link.expires_at,
      driver_name: driverName,
      group_name: groupName,
      group_note: groupNote,
      total_pax: totalPax,
      jobs: jobs.map((j: any) => ({ ...j, pax_count: paxByJob[j.id] ?? 0 })),
    };
  });



// ---------- CLIENT TRIP LINK (per-trip client portal) ----------

export const getClientTripLink = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ job_id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { company } = await assertJobInCompany(context, data.job_id);
    await assertFeatureEnabled(company.id, "client_trip_portal");
    const supabaseAdmin = await getAdminClient();
    const { data: job, error } = await supabaseAdmin.from("jobs")
      .select("id, client_link_token, from_location, from_flight, to_location, to_flight, date, time, pickup_at, group_id, group_name")
      .eq("id", data.job_id).single();
    if (error) throw new Error(error.message);
    let token = (job as any).client_link_token as string | null;
    if (!token) {
      const bytes = new Uint8Array(16);
      crypto.getRandomValues(bytes);
      token = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
      const { error: uErr } = await supabaseAdmin.from("jobs")
        .update({ client_link_token: token } as never).eq("id", data.job_id);
      if (uErr) throw new Error(uErr.message);
    }
    const { count } = await supabaseAdmin.from("pax")
      .select("id", { count: "exact", head: true }).eq("job_id", data.job_id);
    return { token, job: { ...job, pax_count: count ?? 0 } };
  });

export const listClientLocationsCoord = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ job_id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    await assertJobInCompany(context, data.job_id);
    const supabaseAdmin = await getAdminClient();
    const since = new Date(Date.now() - 6 * 3600_000).toISOString();
    const { data: rows, error } = await supabaseAdmin.from("client_locations")
      .select("device_id, pax_name, latitude, longitude, accuracy_m, mode, captured_at")
      .eq("job_id", data.job_id).gte("captured_at", since)
      .order("captured_at", { ascending: false });
    if (error) throw new Error(error.message);
    // Latest per device
    const seen = new Set<string>();
    const latest: any[] = [];
    for (const r of rows ?? []) {
      if (seen.has(r.device_id)) continue;
      seen.add(r.device_id);
      latest.push(r);
    }
    return latest;
  });

// ============================================================
// SOS EVENTS (coordinator side)
// ============================================================

export const listOpenSosCoord = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const c = await resolveCompany(context);
    const supabaseAdmin = await getAdminClient();
    const { data, error } = await supabaseAdmin
      .from("client_sos_events")
      .select("id, job_id, pax_name, latitude, longitude, note, created_at, acknowledged_at")
      .is("acknowledged_at", null)
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) throw new Error(error.message);
    if (!data?.length) return [];
    // filter to jobs visible to this company/chain
    const jobIds = Array.from(new Set(data.map((r: any) => r.job_id)));
    const { data: jobs } = await supabaseAdmin.from("jobs")
      .select("id, company_id, executor_company_id, origin_company_id, dispatch_chain_company_ids")
      .in("id", jobIds);
    const allowed = new Set(
      (jobs ?? []).filter((j: any) =>
        j.company_id === c.id ||
        j.executor_company_id === c.id ||
        j.origin_company_id === c.id ||
        (j.dispatch_chain_company_ids ?? []).includes(c.id),
      ).map((j: any) => j.id),
    );
    return data.filter((r: any) => allowed.has(r.job_id));
  });

export const acknowledgeSosCoord = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ sos_id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const supabaseAdmin = await getAdminClient();
    const { data: row, error: re } = await supabaseAdmin.from("client_sos_events")
      .select("id, job_id").eq("id", data.sos_id).maybeSingle();
    if (re) throw new Error(re.message);
    if (!row) throw new Error("sos_not_found");
    await assertJobInCompany(context, (row as any).job_id);
    const { error } = await supabaseAdmin.from("client_sos_events")
      .update({ acknowledged_at: new Date().toISOString(), acknowledged_by: context.userId } as never)
      .eq("id", data.sos_id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ============================================================
// CARD SIGNALS (unread + client changes + SOS + driver status)
// ============================================================
export const getCardSignalsCoord = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => {
    const parsed = z.object({ job_ids: z.array(z.string()).max(800) }).parse(i);
    const uuid = z.string().uuid();
    return { job_ids: Array.from(new Set(parsed.job_ids.filter((id) => uuid.safeParse(id).success))) };
  })
  .handler(async ({ data, context }) => {
    const c = await resolveCompany(context);
    const supabaseAdmin = await getAdminClient();
    if (!data.job_ids.length) {
      return {} as Record<string, {
        unread_client: number;
        unread_driver: number;
        client_change: boolean;
        sos_open: boolean;
        driver_status_new: boolean;
        rejected: boolean;
      }>;
    }
    // 1) fetch jobs (with viewed_at, updated_at, status, client_link_token)
    const { data: jobs } = await supabaseAdmin.from("jobs")
      .select("id, status, updated_at, coordinator_last_viewed_at, client_link_token, driver_id")
      .in("id", data.job_ids);
    // 2) unread messages + rejection detection
    const { data: msgs } = await supabaseAdmin.from("trip_messages")
      .select("job_id, sender_kind, body, created_at")
      .eq("company_id", c.id)
      .in("job_id", data.job_ids)
      .is("read_by_coordinator_at", null)
      .in("sender_kind", ["driver", "client"]);
    // 3) open SOS
    const { data: sos } = await supabaseAdmin.from("client_sos_events")
      .select("job_id").in("job_id", data.job_ids).is("acknowledged_at", null);
    // 4) pending client modifications on linked bookings (booking -> job)
    const { data: bks } = await supabaseAdmin.from("client_bookings")
      .select("id, job_id").in("job_id", data.job_ids);
    const bookingToJob: Record<string, string> = {};
    for (const b of (bks ?? []) as any[]) if (b.job_id) bookingToJob[b.id] = b.job_id;
    const jobsWithClientChange = new Set<string>();
    const bkIds = Object.keys(bookingToJob);
    if (bkIds.length) {
      const { data: mods } = await supabaseAdmin.from("client_booking_modifications")
        .select("booking_id").eq("status", "pending").in("booking_id", bkIds);
      for (const m of (mods ?? []) as any[]) {
        const jid = bookingToJob[m.booking_id]; if (jid) jobsWithClientChange.add(jid);
      }
    }

    const out: Record<string, {
      unread_client: number; unread_driver: number;
      client_change: boolean; sos_open: boolean; driver_status_new: boolean;
      rejected: boolean;
    }> = {};
    for (const id of data.job_ids) {
      out[id] = { unread_client: 0, unread_driver: 0, client_change: false, sos_open: false, driver_status_new: false, rejected: false };
    }
    // driver-less jobs eligible for "rejected" flag
    const driverlessJobIds = new Set(
      ((jobs ?? []) as any[]).filter((j) => !j.driver_id).map((j) => j.id as string),
    );
    for (const m of (msgs ?? []) as any[]) {
      const row = out[m.job_id]; if (!row) continue;
      if (m.sender_kind === "client") row.unread_client += 1;
      else row.unread_driver += 1;
      // Detect unread driver-rejection message on a currently-unassigned job.
      if (
        m.sender_kind === "driver" &&
        typeof m.body === "string" &&
        m.body.startsWith("⚠️ Driver rejected") &&
        driverlessJobIds.has(m.job_id)
      ) {
        row.rejected = true;
      }
    }
    for (const s of (sos ?? []) as any[]) {
      const row = out[s.job_id]; if (row) row.sos_open = true;
    }
    for (const j of (jobs ?? []) as any[]) {
      const row = out[j.id]; if (!row) continue;
      if (jobsWithClientChange.has(j.id)) row.client_change = true;
      // driver status changed since last view?
      const viewed = j.coordinator_last_viewed_at ? new Date(j.coordinator_last_viewed_at).getTime() : 0;
      const updated = j.updated_at ? new Date(j.updated_at).getTime() : 0;
      const isTerminal = j.status === "completed" || j.status === "cancelled";
      if (!isTerminal && updated > viewed + 500) row.driver_status_new = true;
    }
    return out;
  });


export const markJobViewedCoord = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ job_id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    await assertJobInCompany(context, data.job_id);
    const supabaseAdmin = await getAdminClient();
    await supabaseAdmin.from("jobs")
      .update({ coordinator_last_viewed_at: new Date().toISOString() } as never)
      .eq("id", data.job_id);
    return { ok: true };
  });

// ============================================================
// SOS: per-job detail + acknowledge-all + company-wide map points
// ============================================================

export const listSosForJob = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({
      job_id: z.string().min(1),
      include_ack: z.boolean().optional().default(false),
    }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const jobId = String(data.job_id).split("::")[0];
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(jobId)) return [];
    try { await assertJobInCompany(context, jobId); } catch { return []; }
    const supabaseAdmin = await getAdminClient();
    let q = supabaseAdmin
      .from("client_sos_events")
      .select("id, job_id, pax_name, latitude, longitude, note, created_at, acknowledged_at, acknowledged_by")
      .eq("job_id", jobId)
      .order("created_at", { ascending: false })
      .limit(100);
    if (!data.include_ack) q = q.is("acknowledged_at", null);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const acknowledgeAllSosForJob = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ job_id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    await assertJobInCompany(context, data.job_id);
    const supabaseAdmin = await getAdminClient();
    const { error, count } = await supabaseAdmin
      .from("client_sos_events")
      .update(
        { acknowledged_at: new Date().toISOString(), acknowledged_by: context.userId } as never,
        { count: "exact" },
      )
      .eq("job_id", data.job_id)
      .is("acknowledged_at", null);
    if (error) throw new Error(error.message);
    return { ok: true, cleared: count ?? 0 };
  });

/** Map points for currently-open SOS events across the company/chain. */
export const listActiveSosPoints = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const c = await resolveCompany(context);
    const supabaseAdmin = await getAdminClient();
    const { data, error } = await supabaseAdmin
      .from("client_sos_events")
      .select("id, job_id, pax_name, latitude, longitude, note, created_at")
      .is("acknowledged_at", null)
      .not("latitude", "is", null)
      .not("longitude", "is", null)
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) throw new Error(error.message);
    if (!data?.length) return [];
    const jobIds = Array.from(new Set(data.map((r: any) => r.job_id)));
    const { data: jobs } = await supabaseAdmin.from("jobs")
      .select("id, company_id, executor_company_id, origin_company_id, dispatch_chain_company_ids, from_location, to_location")
      .in("id", jobIds);
    const allowed = new Map<string, any>();
    for (const j of jobs ?? []) {
      if (
        (j as any).company_id === c.id ||
        (j as any).executor_company_id === c.id ||
        (j as any).origin_company_id === c.id ||
        ((j as any).dispatch_chain_company_ids ?? []).includes(c.id)
      ) allowed.set((j as any).id, j);
    }
    return (data as any[])
      .filter((r) => allowed.has(r.job_id))
      .map((r) => ({
        ...r,
        job_from: allowed.get(r.job_id)?.from_location ?? null,
        job_to: allowed.get(r.job_id)?.to_location ?? null,
      }));
  });

// ---------- CLIENT-SOURCED JOB APPROVAL ----------

export const approveClientJob = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ job_id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const c = await resolveCompany(context);
    const supabaseAdmin = await getAdminClient();
    const { data: job, error } = await supabaseAdmin.from("jobs")
      .select("id, company_id").eq("id", data.job_id).eq("company_id", c.id).maybeSingle();
    if (error || !job) throw new Error("Trip not found");
    const { error: uErr } = await supabaseAdmin.from("jobs")
      .update({ coord_approved_at: new Date().toISOString() } as never)
      .eq("id", data.job_id);
    if (uErr) throw new Error(uErr.message);
    return { ok: true };
  });

export const rejectClientJob = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ job_id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const c = await resolveCompany(context);
    const supabaseAdmin = await getAdminClient();
    const { data: job, error } = await supabaseAdmin.from("jobs")
      .select("id, company_id").eq("id", data.job_id).eq("company_id", c.id).maybeSingle();
    if (error || !job) throw new Error("Trip not found");
    await supabaseAdmin.from("jobs").delete().eq("id", data.job_id);
    return { ok: true };
  });
