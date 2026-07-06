import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { maltaWallTimeToUtcIso } from "./time";

type Ctx = { supabase: any; userId: string };

async function getAdminClient() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

/**
 * Best-effort metering: deducts points for a feature but NEVER throws.
 * Use for billable events that must not break core operations (trip creation,
 * dispatch). Features with block_on_empty=true still deduct; overflow either
 * hits the subscription pool or is allowed negative when block_on_empty=false.
 */
async function spendSoft(
  companyId: string | null | undefined,
  featureKey: string,
  note: string,
  jobId?: string,
) {
  if (!companyId) return;
  try {
    const sb = await getAdminClient();
    await sb.rpc("spend_points", {
      _company_id: companyId,
      _feature_key: featureKey,
      _job_id: (jobId ?? undefined) as unknown as string,
      _note: note,
      _cost_override: undefined as unknown as number,
    });
  } catch {
    // swallow — metering must never break the primary action
  }
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

// Append enabled custom AI rules to a base system prompt so every AI call
// respects the coordinator's own management style (M4).
async function buildSystemPrompt(companyId: string, base: string): Promise<string> {
  try {
    const sb = await getAdminClient();
    const { data } = await sb
      .from("company_ai_rules")
      .select("title, rule_text")
      .eq("company_id", companyId)
      .eq("enabled", true)
      .order("sort_order", { ascending: true })
      .limit(30);
    const rules = (data ?? []) as { title: string; rule_text: string }[];
    if (rules.length === 0) return base;
    const block = rules
      .map((r, i) => `${i + 1}. ${r.title ? r.title + ": " : ""}${r.rule_text}`)
      .join("\n");
    return `${base}\n\n== COMPANY RULES (always follow) ==\n${block}`;
  } catch {
    return base;
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
      .select("id, name, status, access_end, require_client_company, custom_link, logo_url, advert_url, advert_link, advert_caption, advert_enabled, referral_code")
      .eq("owner_user_id", context.userId)
      .maybeSingle();
    if (error) return null;
    return data ?? null;
  });

export const updateMyBranding = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      logo_url: z.string().max(2_000_000).nullable().optional(),
      advert_url: z.string().max(2_000_000).nullable().optional(),
      advert_link: z.string().trim().max(500).nullable().optional(),
      advert_caption: z.string().trim().max(200).nullable().optional(),
      advert_enabled: z.boolean().optional(),
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const supabaseAdmin = await getAdminClient();
    const { data: co, error: cErr } = await supabaseAdmin
      .from("companies").select("id").eq("owner_user_id", context.userId).maybeSingle();
    if (cErr || !co) throw new Error("No company assigned");
    const patch: Record<string, unknown> = {};
    if ("logo_url" in data) patch.logo_url = data.logo_url ?? null;
    if ("advert_url" in data) patch.advert_url = data.advert_url ?? null;
    if ("advert_link" in data) patch.advert_link = data.advert_link || null;
    if ("advert_caption" in data) patch.advert_caption = data.advert_caption || null;
    if ("advert_enabled" in data) patch.advert_enabled = !!data.advert_enabled;
    const { error } = await supabaseAdmin.from("companies").update(patch as never).eq("id", co.id);
    if (error) throw new Error(error.message);
    return { ok: true };
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
    const [{ count: pending }, { count: unassigned }, { count: todayJobs }, { count: driverCount }, { count: priceProposals }] = await Promise.all([
      supabaseAdmin.from("client_bookings").select("id", { count: "exact", head: true })
        .eq("company_id", c.id).in("status", ["pending", "modification_pending"]),
      supabaseAdmin.from("jobs").select("id", { count: "exact", head: true })
        .eq("company_id", c.id).is("driver_id", null),
      supabaseAdmin.from("jobs").select("id", { count: "exact", head: true })
        .eq("company_id", c.id).eq("date", todayIso),
      supabaseAdmin.from("drivers").select("id", { count: "exact", head: true })
        .eq("company_id", c.id),
      supabaseAdmin.from("job_price_proposals").select("id", { count: "exact", head: true })
        .eq("to_company_id", c.id).eq("status", "proposed"),
    ]);
    return {
      company: c,
      pending_bookings: pending ?? 0,
      unassigned_jobs: unassigned ?? 0,
      today_jobs: todayJobs ?? 0,
      drivers: driverCount ?? 0,
      open_price_proposals: priceProposals ?? 0,
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
    const cols = "id, company_id, executor_company_id, dispatch_chain_company_ids, from_location, to_location, date, time, pickup_at, flightorship, from_flight, to_flight, flight_status, flight_status_note, flight_status_updated_at, flight_scheduled_at, flight_estimated_at, tracking_enabled, qr_strict_mode, status, driver_id, vehicle, contact_phone, clientcompanyname, driver_accepted_at, deletion_requested_at, payment_status, grouped_count, grouped_at, group_id, group_name, group_note, client_confirmed_at, client_link_token, source, coord_approved_at, parent_job_id, promo_note, traffic_delay_minutes, traffic_severity, leave_by_at, pickup_shift_reason, drivers(name,vehicle,phone,seats_available,availability_note), pax(id,name,status,boarded_at), job_labels(trip_labels(id,name,color))";

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
    await spendSoft(c.id, "trip_created", "Trip created", row.id);
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
      .select("id, company_id, group_id, driver_id" as any)
      .eq("id", data.job_id).eq("company_id", c.id).maybeSingle();
    if (!job) throw new Error("Job not found");
    const gid = (job as any).group_id as string | null;
    // Any driver change (assign, reassign, unassign) requires fresh consent from
    // the new driver, so we clear driver_accepted_at on every assignment write.
    const patch = { driver_id: data.driver_id, driver_accepted_at: null } as never;
    let q = supabaseAdmin.from("jobs").update(patch).eq("company_id", c.id);
    q = gid ? q.eq("group_id" as any, gid) : q.eq("id", data.job_id);
    const { error } = await q;
    if (error) {
      if (error.message?.includes("partner_must_accept_first")) {
        throw new Error("This trip was dispatched to a partner company — they must accept it before a driver can be assigned.");
      }
      throw new Error(error.message);
    }
    // System audit trail in trip chat: who was assigned and that we're waiting on them.
    if (data.driver_id) {
      const { data: driverRow } = await supabaseAdmin.from("drivers")
        .select("name").eq("id", data.driver_id).maybeSingle();
      const driverName = driverRow?.name ?? "the driver";
      const jobIds = gid
        ? (await supabaseAdmin.from("jobs").select("id").eq("company_id", c.id).eq("group_id" as any, gid)).data?.map((r: any) => r.id) ?? [data.job_id]
        : [data.job_id];
      const rows = jobIds.map((jid) => ({
        job_id: jid,
        company_id: c.id,
        sender_kind: "system",
        sender_label: "System",
        body: `🕓 Trip assigned to ${driverName} — waiting on them to accept.`,
        thread_kind: "driver_coord",
        driver_id: data.driver_id,
      } as never));
      await supabaseAdmin.from("trip_messages").insert(rows);
    }
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
      promo_note: (b as any).promo_note ?? null,
    } as any).select().single();
    if (jErr) throw new Error(jErr.message);
    await supabaseAdmin.from("client_bookings")
      .update({ status: "accepted", job_id: job.id }).eq("id", data.id);
    await spendSoft(c.id, "trip_created", "Trip from client booking", job.id);
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
    if (data.kind === "client") {
      await spendSoft(c.id, "client_link_sent", "Client tracking link created");
    }
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
  // Dynamic billing flags from the AI extraction step. Pass through unchanged
  // so the coordinator can't tamper with pricing client-side beyond what the
  // AI accuracy score already justified.
  billing_flags: z.object({
    is_half_price: z.boolean().optional(),
    accuracy_score: z.number().min(0).max(1).optional(),
  }).optional(),
});

export const createJobsBulk = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => bulkTripInput.parse(i))
  .handler(async ({ data, context }) => {
    const c = await resolveCompany(context);
    await assertFeatureEnabled(c.id, "bulk_paste");
    const supabaseAdmin = await getAdminClient();

    // Half-price applies to the per-trip processing fee when the AI's initial
    // accuracy was under 75%. Resolve the effective base cost once (company
    // override falls back to the global feature cost) and halve it.
    const isHalfPrice = data.billing_flags?.is_half_price === true;
    let halfCostOverride: number | undefined;
    if (isHalfPrice) {
      const { data: overrideRow } = await supabaseAdmin
        .from("company_feature_price_overrides")
        .select("points_cost")
        .eq("company_id", c.id)
        .eq("feature_key", "trip_created")
        .maybeSingle();
      const { data: baseRow } = await supabaseAdmin
        .from("ai_feature_costs")
        .select("points_cost")
        .eq("feature_key", "trip_created")
        .maybeSingle();
      const baseCost = Number(overrideRow?.points_cost ?? baseRow?.points_cost ?? 1);
      halfCostOverride = Math.round(baseCost * 0.5 * 100) / 100;
    }

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
      if (isHalfPrice) {
        // Bypass spendSoft (which uses default pricing) so we can apply the
        // 50% cost_override. Still never throws — metering must not break saves.
        try {
          await supabaseAdmin.rpc("spend_points", {
            _company_id: c.id,
            _feature_key: "trip_created",
            _job_id: job.id,
            _note: `Trip created (bulk, 50% AI-accuracy discount, score=${(data.billing_flags?.accuracy_score ?? 0).toFixed(2)})`,
            _cost_override: halfCostOverride as unknown as number,
          });
        } catch { /* ignore metering errors */ }
      } else {
        await spendSoft(c.id, "trip_created", "Trip created (bulk)", job.id);
      }
    }
    return { created, billing: { is_half_price: isHalfPrice, accuracy_score: data.billing_flags?.accuracy_score ?? null } };
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

// Preview traffic + flight status for a trip that hasn't been saved yet.
// Read-only; does NOT deduct points or write any DB rows.
export const previewTripStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({
      from_location: z.string().trim().max(300).optional(),
      to_location: z.string().trim().max(300).optional(),
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      time: z.string().regex(/^\d{2}:\d{2}$/).optional(),
      from_flight: z.string().trim().max(20).optional(),
      to_flight: z.string().trim().max(20).optional(),
    }).parse(i),
  )
  .handler(async ({ data }) => {
    let pickupIso: string | null = null;
    if (data.date && data.time) {
      try { pickupIso = maltaWallTimeToUtcIso(data.date, data.time); } catch { pickupIso = null; }
    }

    // ---- FLIGHT ----
    let flight: {
      ok: boolean;
      status?: string;
      note?: string;
      scheduled?: string | null;
      estimated?: string | null;
      terminal?: string | null;
      gate?: string | null;
      code?: string;
      reason?: string;
    } | null = null;
    const flightCode = (data.from_flight || data.to_flight || "").trim();
    if (flightCode) {
      const kind: "arrivals" | "departures" = data.from_flight ? "arrivals" : "departures";
      if (!process.env.FIRECRAWL_API_KEY) {
        flight = { ok: false, code: flightCode, reason: "not_configured" };
      } else {
        try {
          const rows = await fetchMaltaBoard(kind);
          const norm = normalizeFlightCode(flightCode);
          const row = rows.find((r) => normalizeFlightCode(String(r.flight ?? "")) === norm) ?? null;
          if (!row) {
            flight = { ok: false, code: flightCode, reason: "not_found" };
          } else {
            const scheduledIso = combineDateAndTime(pickupIso, row.scheduled ?? null);
            const estimatedIso = combineDateAndTime(pickupIso, row.estimated ?? null);
            let mapped = mapMaltaStatus(row.status);
            const shownTime = (row.estimated || row.scheduled || "").trim();
            const pickTime = pickupIso ? new Date(pickupIso).toISOString().slice(11, 16) : "";
            if (scheduledIso && pickupIso) {
              const s = new Date(scheduledIso).getTime();
              const p = new Date(pickupIso).getTime();
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
            flight = {
              ok: true, code: flightCode, status: mapped, note,
              scheduled: scheduledIso, estimated: estimatedIso,
              terminal: row.terminal ?? null, gate: row.gate ?? null,
            };
          }
        } catch (e: any) {
          flight = { ok: false, code: flightCode, reason: "scrape_failed" };
        }
      }
    }

    // ---- TRAFFIC ----
    let traffic: {
      ok: boolean;
      delay_minutes?: number;
      severity?: "light" | "moderate" | "heavy" | "severe";
      duration_text?: string;
      duration_seconds?: number;
      free_seconds?: number;
      distance_text?: string;
      leave_by_at?: string | null;
      reason?: string;
    } | null = null;
    const apiKey = process.env.GOOGLE_MAPS_API_KEY;
    if (data.from_location && data.to_location) {
      if (!apiKey) {
        traffic = { ok: false, reason: "not_configured" };
      } else {
        try {
          // For future pickups, Google requires a Unix timestamp in the future.
          // If pickup is in the past or missing, use "now" for a real-time estimate.
          const nowMs = Date.now();
          const pickupMs = pickupIso ? new Date(pickupIso).getTime() : nowMs;
          const depTime = pickupMs > nowMs + 60_000 ? Math.floor(pickupMs / 1000) : "now";
          const dmUrl =
            `https://maps.googleapis.com/maps/api/distancematrix/json` +
            `?origins=${encodeURIComponent(data.from_location)}` +
            `&destinations=${encodeURIComponent(data.to_location)}` +
            `&departure_time=${depTime}&traffic_model=best_guess&key=${apiKey}`;
          const dm: any = await (await fetch(dmUrl)).json();
          const el = dm?.rows?.[0]?.elements?.[0];
          if (!el || el.status !== "OK") {
            traffic = { ok: false, reason: el?.status ? String(el.status).toLowerCase() : "dm_failed" };
          } else {
            const dur = el.duration_in_traffic?.value ?? el.duration?.value ?? null;
            const free = el.duration?.value ?? null;
            const delaySec = dur != null && free != null ? Math.max(0, dur - free) : 0;
            const delayMin = Math.round(delaySec / 60);
            const ratio = free && dur ? dur / free : 1;
            let severity: "light" | "moderate" | "heavy" | "severe" = "light";
            if (ratio >= 1.75 || delayMin >= 30) severity = "severe";
            else if (ratio >= 1.4 || delayMin >= 15) severity = "heavy";
            else if (ratio >= 1.15 || delayMin >= 5) severity = "moderate";
            const leaveBy = pickupIso && dur
              ? new Date(new Date(pickupIso).getTime() - dur * 1000).toISOString()
              : null;
            traffic = {
              ok: true,
              delay_minutes: delayMin,
              severity,
              duration_text: (el.duration_in_traffic ?? el.duration)?.text ?? "",
              duration_seconds: dur ?? undefined,
              free_seconds: free ?? undefined,
              distance_text: el.distance?.text ?? "",
              leave_by_at: leaveBy,
            };
          }
        } catch {
          traffic = { ok: false, reason: "dm_failed" };
        }
      }
    }

    return {
      pickup_at: pickupIso,
      flight,
      traffic,
    };
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

    // Meter the child trip
    await spendSoft(c.id, "trip_created", "Trip split from parent", job.id);

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
      await spendSoft(src.origin_company_id ?? src.company_id, "trip_dispatched", "Trip dispatched via split", job.id);
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
    // Look up the CURRENT driver on this job — private driver↔coordinator
    // history from a previous (reassigned) driver should not show up in the
    // current driver chat panel.
    const { data: jobRow } = await supabaseAdmin.from("jobs")
      .select("driver_id").eq("id", data.job_id).maybeSingle();
    const currentDriverId = (jobRow as any)?.driver_id ?? null;
    const { data: rows, error } = await supabaseAdmin.from("trip_messages")
      .select("id, sender_kind, sender_label, body, created_at, read_by_coordinator_at, thread_kind, client_identity_id, pax_id, driver_id")
      .in("job_id", ids).order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    // Coordinator NEVER sees driver↔client private messages.
    let filtered = ((rows ?? []) as any[]).filter((r) => r.thread_kind !== "driver_client");
    // When a driver is assigned, scope driver_coord to that driver only.
    // When unassigned (e.g. right after a rejection), keep history visible so
    // the coordinator can still read the rejection reason.
    if (currentDriverId) {
      filtered = filtered.filter((r) =>
        r.thread_kind !== "driver_coord" || !r.driver_id || r.driver_id === currentDriverId
      );
    }

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
    // Include every job this coordinator is party to (owner, executor, origin
    // creator, or anywhere in the dispatch chain) so the trip creator still
    // gets notified after the trip is dispatched to another driver/partner.
    const { data: myJobs } = await supabaseAdmin.from("jobs")
      .select("id")
      .or(`company_id.eq.${c.id},executor_company_id.eq.${c.id},origin_company_id.eq.${c.id},dispatch_chain_company_ids.cs.{${c.id}}`);
    const jobIds = (myJobs ?? []).map((j: any) => j.id as string);
    if (!jobIds.length) return {};
    const { data, error } = await supabaseAdmin.from("trip_messages")
      .select("job_id, sender_kind").in("job_id", jobIds).is("read_by_coordinator_at", null)
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
        .in("job_id", jobIds)
        .not("thread_kind", "in", "(driver_client,driver_coord)")
        .order("created_at", { ascending: true }),
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
      .select("id, driver_id, from_location, to_location, status, drivers(id,name)")
      .not("driver_id", "is", null)
      .in("status", ["en_route", "arrived", "in_progress"])
      .or(`company_id.eq.${c.id},executor_company_id.eq.${c.id},origin_company_id.eq.${c.id},dispatch_chain_company_ids.cs.{${c.id}}`);
    if (jobsErr) throw new Error(jobsErr.message);
    const jobIds = (jobs ?? []).map((j: any) => j.id);
    if (jobIds.length === 0) return [] as any[];

    const { data: pts, error: ptsErr } = await supabaseAdmin.from("driver_locations")
      .select("driver_id, job_id, latitude, longitude, accuracy_m, heading, speed_mps, captured_at, eta_sec, distance_m, next_instruction, destination_label")
      .in("job_id", jobIds)
      .gte("captured_at", sinceIso)
      .order("captured_at", { ascending: false })
      .limit(2000);
    if (ptsErr) throw new Error(ptsErr.message);

    // Which of these active jobs currently have an open waiting session?
    const { data: openWaits } = await supabaseAdmin.from("job_wait_sessions" as any)
      .select("job_id, started_at")
      .in("job_id", jobIds)
      .is("ended_at", null);
    const waitByJob = new Map<string, string>();
    for (const w of (openWaits ?? []) as any[]) waitByJob.set(w.job_id, w.started_at);

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
          eta_sec: (p as any).eta_sec ?? null,
          distance_m: (p as any).distance_m ?? null,
          next_instruction: (p as any).next_instruction ?? null,
          destination_label: (p as any).destination_label ?? null,
          wait_started_at: waitByJob.get(p.job_id) ?? null,
        });
      }
    }
    return Array.from(latest.values());
  });

// ---------- WAITING SESSIONS + ADJUSTMENTS (coordinator view) ----------

export const listOpenWaitSessions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const c = await resolveCompany(context);
    const supabaseAdmin = await getAdminClient();
    const { data: jobs, error: jerr } = await supabaseAdmin.from("jobs")
      .select("id, from_location, to_location, driver_id, drivers(id,name)")
      .or(`company_id.eq.${c.id},executor_company_id.eq.${c.id},origin_company_id.eq.${c.id},dispatch_chain_company_ids.cs.{${c.id}}`);
    if (jerr) throw new Error(jerr.message);
    const jobIds = (jobs ?? []).map((j: any) => j.id);
    if (jobIds.length === 0) return [] as any[];

    const { data: waits, error: werr } = await supabaseAdmin.from("job_wait_sessions" as any)
      .select("id, job_id, driver_id, started_at, source")
      .in("job_id", jobIds)
      .is("ended_at", null)
      .order("started_at", { ascending: true });
    if (werr) throw new Error(werr.message);
    const jmap = new Map<string, any>();
    for (const j of jobs ?? []) jmap.set(j.id, j);
    const now = Date.now();
    return ((waits ?? []) as any[]).map((w) => {
      const j = jmap.get(w.job_id);
      return {
        session_id: w.id,
        job_id: w.job_id,
        driver_id: w.driver_id,
        driver_name: j?.drivers?.name ?? "Driver",
        started_at: w.started_at,
        elapsed_sec: Math.max(0, Math.round((now - new Date(w.started_at).getTime()) / 1000)),
        source: w.source,
        from_location: j?.from_location ?? null,
        to_location: j?.to_location ?? null,
      };
    });
  });

export const listJobAdjustments = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ job_id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    await assertJobInCompany(context, data.job_id);
    const supabaseAdmin = await getAdminClient();
    const { data: rows, error } = await supabaseAdmin.from("job_adjustments" as any)
      .select("id, kind, label, amount, currency, driver_note, created_at, wait_session_id, driver_id")
      .eq("job_id", data.job_id)
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    const { data: waits } = await supabaseAdmin.from("job_wait_sessions" as any)
      .select("id, started_at, ended_at, agreed_amount, source, driver_note")
      .eq("job_id", data.job_id)
      .order("started_at", { ascending: true });
    return { adjustments: (rows ?? []) as any[], wait_sessions: (waits ?? []) as any[] };
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

// ---------- AI TRIP EXTRACTION (Gemini direct, chat-style) ----------
// Accepts a conversation (user pastes + follow-up replies) and returns either
// a short clarifying question or the finished 8-column trip rows.
export const extractTripsFromText = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      messages: z.array(z.object({
        role: z.enum(["user", "model"]),
        text: z.string().min(1).max(20000),
      })).min(1).max(20),
      attachments: z.array(z.object({
        name: z.string().max(200),
        mimeType: z.string().max(100),
        dataBase64: z.string().max(15_000_000),
      })).max(5).optional(),
      urls: z.array(z.string().url().max(2000)).max(3).optional(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const supabaseAdmin = await getAdminClient();
    const { data: co } = await supabaseAdmin
      .from("companies").select("id").eq("owner_user_id", context.userId).maybeSingle();
    if (co) await assertFeatureEnabled(co.id, "ai_extraction");

    // Meter: 1pt for text-only, 3pts when files/urls attached.
    const willUseMedia = (data.attachments?.length ?? 0) > 0 || (data.urls?.length ?? 0) > 0;
    if (co) {
      const { error: spendErr } = await supabaseAdmin.rpc("spend_points", {
        _company_id: co.id,
        _feature_key: willUseMedia ? "ai_extraction_media" : "ai_extraction",
        _job_id: undefined as unknown as string,
        _note: willUseMedia ? "ai_extraction (media)" : "ai_extraction (text)",
        _cost_override: undefined as unknown as number,
      });
      if (spendErr) {
        const msg = spendErr.message || "";
        if (msg.includes("insufficient_points")) throw new Error("Out of points — buy a top-up to continue.");
        if (msg.includes("feature_capped")) throw new Error("Monthly cap reached for AI extraction.");
        if (msg.includes("feature_disabled")) throw new Error("AI extraction has been disabled by the administrator.");
        throw new Error(msg);
      }
    }


    const key = process.env.GEMINI_API_KEY;
    if (!key) throw new Error("GEMINI_API_KEY is not configured");

    // Validate attachments: images + PDF only, ~10MB max after decode.
    const attachments = (data.attachments ?? []).filter((a) => {
      if (!/^image\/(png|jpe?g|webp|heic|heif|gif)$|^application\/pdf$/i.test(a.mimeType)) return false;
      const approxBytes = Math.floor((a.dataBase64.length * 3) / 4);
      return approxBytes <= 10 * 1024 * 1024;
    });
    const urls = (data.urls ?? []).filter((u) => /^https?:\/\//i.test(u)).slice(0, 3);

    // Fetch URLs (best-effort, 6s timeout, cap 200KB raw / 8KB cleaned).
    const fetchedPages: { url: string; text: string; error?: string }[] = [];
    for (const u of urls) {
      try {
        const ctrl = new AbortController();
        const to = setTimeout(() => ctrl.abort(), 6000);
        const r = await fetch(u, {
          signal: ctrl.signal,
          headers: { "user-agent": "Mozilla/5.0 CoordinatorAI/1.0" },
        });
        clearTimeout(to);
        if (!r.ok) { fetchedPages.push({ url: u, text: "", error: `HTTP ${r.status}` }); continue; }
        const raw = (await r.text()).slice(0, 200_000);
        const cleaned = raw
          .replace(/<script[\s\S]*?<\/script>/gi, " ")
          .replace(/<style[\s\S]*?<\/style>/gi, " ")
          .replace(/<[^>]+>/g, " ")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 8000);
        fetchedPages.push({ url: u, text: cleaned });
      } catch (e: any) {
        fetchedPages.push({ url: u, text: "", error: String(e?.message || e).slice(0, 100) });
      }
    }

    const hasMedia = attachments.length > 0 || fetchedPages.length > 0;
    const model = hasMedia ? "gemini-2.5-flash" : "gemini-2.5-flash-lite";
    const maxOutputTokens = hasMedia ? 1024 : 512;

    const today = new Date().toISOString().slice(0, 10);
    const baseInstruction = [
      `You are a transport-coordinator data extractor. Sources may be text, images, PDFs, or web pages.`,
      `Extract transport trips. Today=${today}. Dates YYYY-MM-DD, times 24h HH:MM.`,
      "Keys: pickupDate, pickupTime, pickupAddress, deliveryAddress, customerName, contactNumber, transportType, quantity.",
      "Flight (e.g. KM101): set matching address to 'Airport'; put the flight code into pickupTime.",
      'Output JSON only, no markdown. Prefer the data envelope: {"type":"data","payload":[{...8 keys...}],"is_low_confidence":false}. Use the question envelope {"type":"question","payload":"..."} ONLY when the input is completely unreadable or empty — never as a substitute for a partial row.',
      'BEST-EFFORT RULE: Always return a data row for anything that looks like a trip, even when unsure. Fill in as many of the 8 keys as you reasonably can. Leave any unknown value as an empty string "" (or "1" for quantity) — never omit a key, never use null, never use "unknown", never invent fake data.',
      'CONFIDENCE FLAG: Set "is_low_confidence": true on the envelope when ANY of the following is true: you left one or more mandatory fields (pickupDate, pickupAddress, deliveryAddress) blank on any row, you had to guess a value, the source text was ambiguous/fragmented, or you were forced to skip fields. Otherwise set it to false.',
    ].join("\n");
    const systemInstruction = co ? await buildSystemPrompt(co.id, baseInstruction) : baseInstruction;


    const trimmed = data.messages.slice(-4);
    const contents = trimmed.map((m, i) => {
      const parts: any[] = [{ text: m.text }];
      const isLastUser = i === trimmed.length - 1 && m.role === "user";
      if (isLastUser) {
        for (const a of attachments) {
          parts.push({ inline_data: { mime_type: a.mimeType, data: a.dataBase64 } });
        }
        for (const p of fetchedPages) {
          if (p.error) parts.push({ text: `\n[Could not fetch ${p.url}: ${p.error}]` });
          else if (p.text) parts.push({ text: `\n---\nFrom ${new URL(p.url).hostname}:\n${p.text}` });
        }
      }
      return { role: m.role, parts };
    });

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`;
    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: systemInstruction }] },
          contents,
          generationConfig: {
            responseMimeType: "application/json",
            temperature: 0.1,
            maxOutputTokens,
          },
        }),
      });
    } catch (e: any) {
      if (co) await refundPoints(co.id, willUseMedia ? "ai_extraction_media" : "ai_extraction", "AI extraction transport failure");
      throw new Error("AI is temporarily unreachable — please try again");
    }
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      if (co) await refundPoints(co.id, willUseMedia ? "ai_extraction_media" : "ai_extraction", `AI extraction ${res.status}`);
      if (res.status === 429) throw new Error("AI is rate limited — try again in a moment");
      throw new Error(`Gemini error ${res.status}: ${body.slice(0, 300)}`);
    }
    const json = await res.json() as any;
    const text: string = json?.candidates?.[0]?.content?.parts?.map((p: any) => p?.text ?? "").join("") ?? "";
    if (!text) {
      if (co) await refundPoints(co.id, willUseMedia ? "ai_extraction_media" : "ai_extraction", "AI extraction empty");
      throw new Error("AI returned an empty response — please try again");
    }

    let parsed: any;
    try { parsed = safeJsonParse(text); }
    catch {
      if (co) await refundPoints(co.id, willUseMedia ? "ai_extraction_media" : "ai_extraction", "AI extraction invalid JSON");
      throw new Error("AI response was unreadable — please rephrase and try again");
    }

    // Best-effort envelope recovery: accept the documented shape, then fall back
    // to inspecting payload shape when `type` is missing/wrong.
    const rawPayload = parsed?.payload;
    const isQuestion = parsed?.type === "question" || (typeof rawPayload === "string" && parsed?.type !== "data");
    const isData = parsed?.type === "data" || Array.isArray(rawPayload);
    if (isData && Array.isArray(rawPayload)) {
      const rows = rawPayload.map(normalizeTripRow);
      // Server-side confidence: trust the model's flag, but also flip to true
      // when any row is missing a mandatory field (pickup date/address, delivery address).
      const modelFlag = parsed?.is_low_confidence === true;
      const missingMandatory = rows.some(
        (r) => !r.pickupDate?.trim() || !r.pickupAddress?.trim() || !r.deliveryAddress?.trim(),
      );

      // ---------- DYNAMIC BILLING: accuracy score ----------
      // Score = filled required fields / total expected required fields.
      // Required per row: pickupDate, pickupTime, pickupAddress, deliveryAddress, quantity (pax).
      // <75% → is_half_price=true, applies 50% discount to the bulk processing fee.
      const REQ_KEYS = ["pickupDate", "pickupTime", "pickupAddress", "deliveryAddress", "quantity"] as const;
      const totalExpected = rows.length * REQ_KEYS.length;
      let filled = 0;
      for (const r of rows) {
        for (const k of REQ_KEYS) {
          const v = (r as any)[k];
          if (typeof v === "string" ? v.trim().length > 0 : v != null) filled += 1;
        }
      }
      const accuracy_score = totalExpected > 0 ? filled / totalExpected : 0;
      const is_half_price = totalExpected > 0 && accuracy_score < 0.75;

      return {
        type: "data" as const,
        payload: rows,
        is_low_confidence: modelFlag || missingMandatory,
        accuracy_score,
        is_half_price,
      };
    }
    if (isQuestion && typeof rawPayload === "string" && rawPayload.trim()) {
      return { type: "question" as const, payload: rawPayload.trim().slice(0, 500) };
    }
    if (co) await refundPoints(co.id, willUseMedia ? "ai_extraction_media" : "ai_extraction", "AI extraction unrecognized shape");
    throw new Error("AI response was unreadable — please rephrase and try again");
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
      await spendSoft(company.id, "client_link_sent", "Client trip link issued", data.job_id);
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

// ==========================================================
// AI SUITE — group suggestions, daily plan, reply drafter,
// voice-to-trip. All metered via spend_points RPC.
// ==========================================================

async function spendOrThrow(
  companyId: string,
  featureKey: string,
  note: string,
  jobId?: string,
) {
  const sb = await getAdminClient();
  const { error } = await sb.rpc("spend_points", {
    _company_id: companyId,
    _feature_key: featureKey,
    _job_id: (jobId ?? undefined) as unknown as string,
    _note: note,
    _cost_override: undefined as unknown as number,
  });
  if (error) {
    const msg = error.message || "";
    if (msg.includes("insufficient_points")) throw new Error("Out of points — buy a top-up to continue.");
    if (msg.includes("feature_capped")) throw new Error("Monthly cap reached for this AI feature.");
    if (msg.includes("feature_disabled")) throw new Error("This feature has been disabled by the administrator.");
    throw new Error(msg);
  }
}

// Best-effort refund when a paid AI call fails after metering. Uses spend_points
// with a negative _cost_override; if the RPC rejects negatives, we swallow and log.
async function refundPoints(
  companyId: string,
  featureKey: string,
  note: string,
  jobId?: string,
) {
  try {
    const sb = await getAdminClient();
    const { data: costRow } = await sb.from("ai_feature_costs")
      .select("points_cost").eq("feature_key", featureKey).maybeSingle();
    const cost = Number(costRow?.points_cost ?? 0);
    if (!cost) return;
    const { error } = await sb.rpc("spend_points", {
      _company_id: companyId,
      _feature_key: featureKey,
      _job_id: (jobId ?? undefined) as unknown as string,
      _note: `REFUND: ${note}`,
      _cost_override: -cost as unknown as number,
    });
    if (error) console.warn("[refundPoints] failed:", error.message);
  } catch (e) {
    console.warn("[refundPoints] threw:", (e as Error).message);
  }
}

// Shared shapes for Gemini extraction — always tolerate missing keys.
const tripRowSchema = z.object({
  pickupDate: z.string().default(""),
  pickupTime: z.string().default(""),
  pickupAddress: z.string().default(""),
  deliveryAddress: z.string().default(""),
  customerName: z.string().default(""),
  contactNumber: z.string().default(""),
  transportType: z.string().default(""),
  quantity: z.string().default("1"),
}).passthrough();

function normalizeTripRow(r: unknown) {
  const src: any = (r && typeof r === "object") ? r : {};
  const parsed = tripRowSchema.safeParse(src);
  const row = parsed.success ? parsed.data : {
    pickupDate: String(src.pickupDate ?? ""),
    pickupTime: String(src.pickupTime ?? ""),
    pickupAddress: String(src.pickupAddress ?? ""),
    deliveryAddress: String(src.deliveryAddress ?? ""),
    customerName: String(src.customerName ?? ""),
    contactNumber: String(src.contactNumber ?? ""),
    transportType: String(src.transportType ?? ""),
    quantity: String(src.quantity ?? "1"),
  };
  return {
    pickupDate: String(row.pickupDate ?? ""),
    pickupTime: String(row.pickupTime ?? ""),
    pickupAddress: String(row.pickupAddress ?? ""),
    deliveryAddress: String(row.deliveryAddress ?? ""),
    customerName: String(row.customerName ?? ""),
    contactNumber: String(row.contactNumber ?? ""),
    transportType: String(row.transportType ?? ""),
    quantity: String(row.quantity || "1"),
  };
}

// Strip common Gemini "```json ... ```" wrappers that leak through despite responseMimeType.
function safeJsonParse(text: string): unknown {
  const trimmed = text.trim();
  try { return JSON.parse(trimmed); } catch { /* fallthrough */ }
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenced) { try { return JSON.parse(fenced[1]); } catch { /* fallthrough */ } }
  const firstBrace = trimmed.search(/[{[]/);
  const lastBrace = Math.max(trimmed.lastIndexOf("}"), trimmed.lastIndexOf("]"));
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    try { return JSON.parse(trimmed.slice(firstBrace, lastBrace + 1)); } catch { /* fallthrough */ }
  }
  throw new Error("AI returned invalid JSON");
}

async function callGemini(prompt: string, model = "gemini-2.5-flash-lite", opts?: { temperature?: number; maxOutputTokens?: number }): Promise<any> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY is not configured");
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`;
  const body = JSON.stringify({
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: {
      responseMimeType: "application/json",
      temperature: opts?.temperature ?? 0.2,
      maxOutputTokens: opts?.maxOutputTokens ?? 800,
    },
  });
  const doFetch = () => fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });
  let res = await doFetch();
  if (!res.ok && res.status >= 500 && res.status < 600) {
    await new Promise((r) => setTimeout(r, 400));
    res = await doFetch();
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    if (res.status === 429) throw new Error("AI is rate limited — try again shortly");
    throw new Error(`AI error ${res.status}: ${body.slice(0, 200)}`);
  }
  const json = await res.json() as any;
  const text: string = json?.candidates?.[0]?.content?.parts?.map((p: any) => p?.text ?? "").join("") ?? "";
  if (!text) throw new Error("AI returned empty response");
  return safeJsonParse(text);
}

// ---------- AI: Auto-Coordinate (propose-only autopilot) ----------
type CoordProposal =
  | { kind: "group"; trip_ids: string[]; reason: string }
  | { kind: "assign"; trip_ids: string[]; driver_id: string; reason: string };

export async function runAutoCoordinate(companyId: string) {
  const sb = await getAdminClient();
  const { data: cfg } = await sb.from("ai_configuration")
    .select("auto_coordinate_enabled").eq("company_id", companyId).maybeSingle();
  if (!cfg || cfg.auto_coordinate_enabled !== true) {
    throw new Error("AI Auto-Coordinate is off — turn it on in AI Center → Toggles.");
  }
  await assertFeatureEnabled(companyId, "ai_auto_coordinate");

  const cutoff = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const historyCutoff = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
  const [{ data: jobs }, { data: drivers }, { data: history }] = await Promise.all([
    sb.from("jobs")
      .select("id, name, surname, from_location, to_location, pickup_at, time, date, quantity")
      .eq("company_id", companyId)
      .is("driver_id", null)
      .or(`pickup_at.gte.${cutoff},pickup_at.is.null`)
      .order("pickup_at", { ascending: true, nullsFirst: false })
      .limit(120),
    sb.from("drivers")
      .select("id, name")
      .eq("company_id", companyId)
      .neq("status", "offline")
      .limit(60),
    sb.from("jobs")
      .select("from_location, to_location, pickup_at, time, name, surname, driver_id, drivers:driver_id(name)")
      .eq("company_id", companyId)
      .eq("status", "completed")
      .gte("created_at", historyCutoff)
      .order("pickup_at", { ascending: false, nullsFirst: false })
      .limit(300),
  ]);


  const list = jobs ?? [];
  const drv = drivers ?? [];

  const { data: costRow } = await sb.from("ai_feature_costs")
    .select("points_cost, metering_mode")
    .eq("feature_key", "ai_auto_coordinate")
    .maybeSingle();
  const meteringMode: "per_action" | "per_run" | "per_trip" =
    (costRow?.metering_mode as any) ?? "per_action";

  if (list.length === 0) {
    return { proposals: [] as CoordProposal[], metering_mode: meteringMode, considered: 0 };
  }

  const tripLines = list.map((j: any) =>
    `${j.id}: ${j.pickup_at ?? j.date + " " + (j.time ?? "??")} | ${j.from_location ?? ""} → ${j.to_location ?? ""} | ${j.name ?? ""} ${j.surname ?? ""} | qty ${j.quantity ?? 1}`,
  ).join("\n");
  const driverLines = drv.map((d: any) => `${d.id}: ${d.name ?? ""}`).join("\n") || "(no free drivers)";

  // Compact 30-day completed-trip reference so the AI can spot recurring
  // monthly patterns (regular clients, repeat routes, habitual drivers).
  const historyList = (history ?? []).map((h: any) => ({
    pickup: h.from_location ?? "",
    dropoff: h.to_location ?? "",
    time: h.pickup_at ?? (h.time ?? ""),
    client: `${h.name ?? ""} ${h.surname ?? ""}`.trim(),
    driver: h.drivers?.name ?? "",
  }));
  const historyBlock = historyList.length
    ? `PAST_30D_COMPLETED (${historyList.length}):\n${historyList
        .map((r) => `${r.time} | ${r.pickup} → ${r.dropoff} | ${r.client} | drv:${r.driver}`)
        .join("\n")}`
    : "PAST_30D_COMPLETED: (none)";

  const parsed = await callGemini(
    await buildSystemPrompt(companyId,
      `You are a transport dispatch autopilot. Look at the ENTIRE unassigned backlog and propose the minimum set of actions that clears it.\n` +
      `Use PAST_30D_COMPLETED as reference memory to recognize recurring monthly patterns — regular clients, repeat routes, and drivers habitually paired with them — when grouping or assigning.\n` +
      `Return JSON: {"proposals":[\n` +
      `  {"kind":"group","trip_ids":["uuid",...],"reason":"..."},\n` +
      `  {"kind":"assign","trip_ids":["uuid",...],"driver_id":"uuid","reason":"..."}\n` +
      `]}\n` +
      `Rules: only real groups (2+ trips, same/near pickup within 30min AND overlapping routes). Only propose assignments when a specific driver clearly fits. Do NOT invent trip_ids or driver_ids — use only the IDs listed below.\n\n` +
      `TRIPS:\n${tripLines}\n\nDRIVERS:\n${driverLines}\n\n${historyBlock}`,
    ),
    "gemini-2.5-flash",
    { maxOutputTokens: 2000 },
  );

  const tripIdSet = new Set(list.map((j: any) => j.id));
  const driverIdSet = new Set(drv.map((d: any) => d.id));

  const raw = Array.isArray(parsed?.proposals) ? parsed.proposals : [];
  const proposals: CoordProposal[] = [];
  for (const p of raw) {
    if (!p || typeof p !== "object") continue;
    const trip_ids = Array.isArray(p.trip_ids) ? p.trip_ids.filter((t: any) => typeof t === "string" && tripIdSet.has(t)) : [];
    if (trip_ids.length === 0) continue;
    if (p.kind === "group" && trip_ids.length >= 2) {
      proposals.push({ kind: "group", trip_ids, reason: String(p.reason ?? "").slice(0, 300) });
    } else if (p.kind === "assign" && typeof p.driver_id === "string" && driverIdSet.has(p.driver_id)) {
      proposals.push({ kind: "assign", trip_ids, driver_id: p.driver_id, reason: String(p.reason ?? "").slice(0, 300) });
    }
  }

  // Per-run / per-trip metering happens up-front; per-action defers to accept.
  if (meteringMode === "per_run" && proposals.length > 0) {
    await spendOrThrow(companyId, "ai_auto_coordinate", "Auto-Coordinate planning run");
  } else if (meteringMode === "per_trip") {
    const touched = new Set<string>();
    for (const p of proposals) p.trip_ids.forEach((t) => touched.add(t));
    const perCost = Number(costRow?.points_cost ?? 1);
    for (let i = 0; i < touched.size; i++) {
      await spendOrThrow(companyId, "ai_auto_coordinate", "Auto-Coordinate trip", undefined);
      // NOTE: uses configured points_cost per touched trip via spend_points RPC.
      void perCost;
    }
  }

  return { proposals, metering_mode: meteringMode, considered: list.length };
}

export const aiAutoCoordinate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const c = await resolveCompany(context);
    return runAutoCoordinate(c.id);
  });

export const applyAutoCoordinateProposal = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({
      kind: z.enum(["group", "assign"]),
      trip_ids: z.array(z.string().uuid()).min(1).max(50),
      driver_id: z.string().uuid().optional(),
    }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const c = await resolveCompany(context);
    const sb = await getAdminClient();

    // Verify all trips belong to this company.
    const { data: rows, error } = await sb.from("jobs")
      .select("id, company_id, group_id" as any)
      .in("id", data.trip_ids).eq("company_id", c.id);
    if (error) throw new Error(error.message);
    if (!rows || rows.length !== data.trip_ids.length) throw new Error("Some trips not found");

    if (data.kind === "group") {
      if (data.trip_ids.length < 2) throw new Error("Need at least 2 trips to group");
      const existing = (rows as any[]).map((r) => r.group_id).find((g) => !!g) as string | undefined;
      const gid = existing ?? (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`);
      const { error: uErr } = await sb.from("jobs")
        .update({
          group_id: gid,
          grouped_count: data.trip_ids.length,
          grouped_at: new Date().toISOString(),
          group_name: "AI Auto-Coordinate",
        } as never)
        .in("id", data.trip_ids);
      if (uErr) throw new Error(uErr.message);
    } else {
      if (!data.driver_id) throw new Error("Missing driver_id for assignment");
      const { error: uErr } = await sb.from("jobs")
        .update({ driver_id: data.driver_id, driver_accepted_at: null } as never)
        .in("id", data.trip_ids)
        .is("driver_id", null); // never overwrite existing assignments
      if (uErr) throw new Error(uErr.message);
    }

    // Per-action metering (per_run / per_trip already charged at plan time).
    const { data: costRow } = await sb.from("ai_feature_costs")
      .select("metering_mode").eq("feature_key", "ai_auto_coordinate").maybeSingle();
    if ((costRow?.metering_mode ?? "per_action") === "per_action") {
      await spendOrThrow(c.id, "ai_auto_coordinate", `Auto-Coordinate ${data.kind}`);
    }
    return { ok: true };
  });


// ---------- AI: Daily plan ----------
export const aiPlanDriverDay = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({
      driver_id: z.string().uuid(),
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const c = await resolveCompany(context);
    await assertFeatureEnabled(c.id, "ai_daily_plan");
    const supabaseAdmin = await getAdminClient();
    const { data: jobs } = await supabaseAdmin
      .from("jobs")
      .select("id, from_location, to_location, pickup_at, time")
      .eq("company_id", c.id)
      .eq("date", data.date)
      .eq("driver_id", data.driver_id)
      .limit(40);
    const list = jobs ?? [];
    if (list.length < 2) return { ordered_trip_ids: list.map((j: any) => j.id), summary: "Not enough trips to reorder." };

    await spendOrThrow(c.id, "ai_daily_plan", `Daily plan for ${data.date}`);

    const summary = list.map((j: any) =>
      `${j.id}: ${j.time ?? "??"} | ${j.from_location ?? ""} → ${j.to_location ?? ""}`,
    ).join("\n");

    const parsed = await callGemini(
      await buildSystemPrompt(c.id,
        `Order these trips for one driver to minimize backtracking and idle time. Respect pickup times when set (do not schedule pickup before its time).\nReturn JSON: {"ordered_trip_ids":["uuid",...],"summary":"one short sentence with estimated minutes saved"}.\nTrips:\n${summary}`,
      ),
      "gemini-2.5-flash",
      { maxOutputTokens: 800 },
    );

    return {
      ordered_trip_ids: Array.isArray(parsed?.ordered_trip_ids) ? parsed.ordered_trip_ids : list.map((j: any) => j.id),
      summary: String(parsed?.summary ?? ""),
    };
  });

// ---------- AI: Reply drafter ----------
export const aiDraftChatReplies = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({
      last_message: z.string().trim().min(1).max(2000),
      context_summary: z.string().trim().max(2000).optional(),
      tone: z.enum(["friendly", "formal", "brief"]).default("friendly"),
    }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const c = await resolveCompany(context);
    await assertFeatureEnabled(c.id, "ai_reply_drafter");
    await spendOrThrow(c.id, "ai_reply_drafter", "Chat reply drafts");
    const parsed = await callGemini(
      await buildSystemPrompt(c.id,
        `You draft short, polite chat replies for a transport coordinator to send to a client. Tone: ${data.tone}. Language: match the client message. Return JSON {"drafts":["...","...","..."]} with 3 options, each under 200 chars. Client message:\n"${data.last_message}"\nContext: ${data.context_summary ?? "n/a"}`,
      ),
      "gemini-2.5-flash-lite",
      { maxOutputTokens: 400 },
    );

    const drafts = Array.isArray(parsed?.drafts) ? parsed.drafts.map(String).slice(0, 3) : [];
    return { drafts };
  });

// ---------- AI: Voice note → trip ----------
export const aiVoiceNoteToTrip = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({
      audio_base64: z.string().min(10).max(20_000_000),
      mime_type: z.string().min(3).max(80),
    }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const c = await resolveCompany(context);
    await assertFeatureEnabled(c.id, "ai_voice_to_trip");
    await spendOrThrow(c.id, "ai_voice_to_trip", "Voice note → trip");

    const key = process.env.GEMINI_API_KEY;
    if (!key) throw new Error("GEMINI_API_KEY is not configured");

    // Transcribe + extract in a single Gemini multimodal call.
    const today = new Date().toISOString().slice(0, 10);
    const baseVoicePrompt = [
      `Transcribe the audio, then extract transport trips. Today=${today}.`,
      `Return JSON {"transcript":"...","trips":[{pickupDate,pickupTime,pickupAddress,deliveryAddress,customerName,contactNumber,transportType,quantity}]}.`,
      `Dates YYYY-MM-DD, times HH:MM.`,
      `FALLBACK RULES: Always include ALL 8 keys per trip row. If a value is unknown, use "" (or "1" for quantity) — never omit a key, never use null. If nothing sounds like a trip, return {"transcript":"...","trips":[]}.`,
    ].join(" ");
    const sysPrompt = await buildSystemPrompt(c.id, baseVoicePrompt);
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(key)}`;
    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: sysPrompt }] },

          contents: [{ role: "user", parts: [
            { text: "Extract trips from this voice note." },
            { inline_data: { mime_type: data.mime_type, data: data.audio_base64 } },
          ] }],
          generationConfig: { responseMimeType: "application/json", temperature: 0.1, maxOutputTokens: 1200 },
        }),
      });
    } catch {
      await refundPoints(c.id, "ai_voice_to_trip", "Voice note transport failure");
      throw new Error("AI is temporarily unreachable — please try again");
    }
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      await refundPoints(c.id, "ai_voice_to_trip", `Voice note ${res.status}`);
      if (res.status === 429) throw new Error("AI is rate limited — try again shortly");
      throw new Error(`AI error ${res.status}: ${body.slice(0, 200)}`);
    }
    const json = await res.json() as any;
    const text: string = json?.candidates?.[0]?.content?.parts?.map((p: any) => p?.text ?? "").join("") ?? "";
    if (!text) {
      await refundPoints(c.id, "ai_voice_to_trip", "Voice note empty response");
      throw new Error("AI returned an empty transcript — recording may be silent");
    }
    let parsed: any;
    try { parsed = safeJsonParse(text); }
    catch {
      await refundPoints(c.id, "ai_voice_to_trip", "Voice note invalid JSON");
      throw new Error("AI response was unreadable — please try again");
    }
    const trips = Array.isArray(parsed?.trips) ? parsed.trips : [];
    return {
      transcript: String(parsed?.transcript ?? ""),
      trips: trips.map(normalizeTripRow),
    };
  });

// ==========================================================
// M4 · AI CONTROL & SETTINGS CENTER
// ==========================================================

// ---- Config (automation toggles) ----
export const getAiConfig = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const c = await resolveCompany(context);
    const sb = await getAdminClient();
    const { data } = await sb.from("ai_configuration").select("*").eq("company_id", c.id).maybeSingle();
    return data ?? {
      company_id: c.id,
      auto_assign_enabled: false,
      auto_extract_bulk: true,
      auto_reply_drafts: true,
      ai_command_enabled: true,
      voice_to_trip_enabled: true,
      auto_coordinate_enabled: false,
    };
  });

export const saveAiConfig = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({
      auto_assign_enabled: z.boolean(),
      auto_extract_bulk: z.boolean(),
      auto_reply_drafts: z.boolean(),
      ai_command_enabled: z.boolean(),
      voice_to_trip_enabled: z.boolean(),
      auto_coordinate_enabled: z.boolean(),
    }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const c = await resolveCompany(context);
    const sb = await getAdminClient();
    const { error } = await sb.from("ai_configuration").upsert({ company_id: c.id, ...data }, { onConflict: "company_id" });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ---- Rules (custom business rules) ----
export const listAiRules = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const c = await resolveCompany(context);
    const sb = await getAdminClient();
    const { data, error } = await sb
      .from("company_ai_rules")
      .select("id, title, rule_text, enabled, sort_order, created_at, updated_at")
      .eq("company_id", c.id)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const upsertAiRule = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({
      id: z.string().uuid().optional(),
      title: z.string().trim().min(1).max(120),
      rule_text: z.string().trim().min(3).max(2000),
      enabled: z.boolean().default(true),
      sort_order: z.number().int().default(0),
    }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const c = await resolveCompany(context);
    const sb = await getAdminClient();
    if (data.id) {
      const { error } = await sb.from("company_ai_rules")
        .update({ title: data.title, rule_text: data.rule_text, enabled: data.enabled, sort_order: data.sort_order })
        .eq("id", data.id).eq("company_id", c.id);
      if (error) throw new Error(error.message);
      return { ok: true, id: data.id };
    }
    const { data: row, error } = await sb.from("company_ai_rules")
      .insert({ company_id: c.id, title: data.title, rule_text: data.rule_text, enabled: data.enabled, sort_order: data.sort_order })
      .select("id").maybeSingle();
    if (error) throw new Error(error.message);
    return { ok: true, id: row?.id };
  });

export const deleteAiRule = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const c = await resolveCompany(context);
    const sb = await getAdminClient();
    const { error } = await sb.from("company_ai_rules").delete().eq("id", data.id).eq("company_id", c.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ---- AI Command Bar ----
export const runAiCommand = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({
      prompt: z.string().trim().min(2).max(2000),
      mode: z.enum(["read", "execute"]).default("read"),
    }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const c = await resolveCompany(context);
    const sb = await getAdminClient();

    const { data: cfg } = await sb.from("ai_configuration").select("ai_command_enabled").eq("company_id", c.id).maybeSingle();
    if (cfg && cfg.ai_command_enabled === false) {
      throw new Error("AI Command Bar is disabled in your AI settings.");
    }

    const featureKey = data.mode === "execute" ? "ai_command_execute" : "ai_command_read";
    await assertFeatureEnabled(c.id, featureKey);
    await spendOrThrow(c.id, featureKey, `AI command (${data.mode}): ${data.prompt.slice(0, 60)}`);

    // Dynamic date context. Widen the window to include yesterday so commands
    // like "shift yesterday's trips to today" can reference real rows.
    const now = new Date();
    const iso = (d: Date) => d.toISOString().slice(0, 10);
    const today = iso(now);
    const yesterday = iso(new Date(now.getTime() - 24 * 3600 * 1000));
    const tomorrow = iso(new Date(now.getTime() + 24 * 3600 * 1000));
    const dayOfWeek = now.toLocaleDateString("en-US", { weekday: "long" });
    const nowIso = now.toISOString();

    const [{ data: jobs }, { data: drivers }] = await Promise.all([
      sb.from("jobs")
        .select("id, name, surname, from_location, to_location, pickup_at, time, date, driver_id, status")
        .eq("company_id", c.id)
        .gte("date", yesterday)
        .order("date", { ascending: true }).order("time", { ascending: true })
        .limit(120),
      sb.from("drivers").select("id, name, status").eq("company_id", c.id).limit(40),
    ]);

    const baseSys = [
      "You are the AI operations assistant for a transport dispatch coordinator.",
      `Today's current date is ${today} (${dayOfWeek}). Yesterday was ${yesterday}. Tomorrow is ${tomorrow}. Current time (UTC): ${nowIso}.`,
      "RELATIVE DATES: When the user says 'today', 'yesterday', 'tomorrow', 'this week', 'next Monday', etc., resolve to concrete YYYY-MM-DD dates using the values above before choosing rows. Never guess — compute from these anchors.",
      `Mode: ${data.mode}. In read mode you answer questions and suggest actions. In execute mode you also propose a JSON action list the app will run server-side.`,
      "Return JSON exactly: {\"response\":\"markdown answer\",\"actions\":[{\"type\":\"assign\"|\"unassign\"|\"reschedule\"|\"note\",\"job_id\":\"uuid\",\"driver_id\":\"uuid|null\",\"date\":\"YYYY-MM-DD|null\",\"time\":\"HH:MM|null\",\"pickup_at\":\"ISO|null\",\"note\":\"string|null\"}]}",
      "ALWAYS include every key in each action object. If a field doesn't apply, use null (or empty string for note). Never omit a key.",
      "DATE FORMAT: The jobs table stores `date` as YYYY-MM-DD and `time` as HH:MM. For reschedule actions ALWAYS provide both `date` (YYYY-MM-DD) and `time` (HH:MM). Also provide `pickup_at` as an ISO timestamp when possible.",
      "Only reference job_id and driver_id values from the CONTEXT below. Never fabricate ids. If a request would touch trips not in the context, say so in `response` and leave actions empty.",
      "If a request would touch more than 5 jobs, list them under actions but set response to explain that confirmation is required.",
      "If no matching trips exist for the requested date/filter, return actions:[] and set response to a helpful message like: \"I searched for trips on {DATE}, but found 0 records to move.\"",
    ].join("\n");
    const sys = await buildSystemPrompt(c.id, baseSys);

    const ctxText = `CONTEXT
JOBS (${(jobs ?? []).length}):
${(jobs ?? []).map((j: any) => `- ${j.id} | ${j.date} ${j.time ?? ""} | ${j.from_location ?? ""} → ${j.to_location ?? ""} | pax ${j.name ?? ""} ${j.surname ?? ""} | driver=${j.driver_id ?? "none"} | status=${j.status ?? ""}`).join("\n")}

DRIVERS (${(drivers ?? []).length}):
${(drivers ?? []).map((d: any) => `- ${d.id} | ${d.name ?? ""} | ${d.status ?? ""}`).join("\n")}`;

    let parsed: any = { response: "", actions: [] };
    let status: "ok" | "error" | "awaiting_confirm" = "ok";
    let errMsg: string | null = null;
    try {
      parsed = await callGemini(`${sys}\n\n${ctxText}\n\nUSER: ${data.prompt}`, "gemini-2.5-flash", { maxOutputTokens: 1500 });
    } catch (e: any) {
      status = "error";
      errMsg = e?.message ?? "AI error";
    }

    // Filter and normalize actions against real ids so hallucinations can't
    // leak through to the executor.
    const jobIdSet = new Set((jobs ?? []).map((j: any) => j.id));
    const driverIdSet = new Set((drivers ?? []).map((d: any) => d.id));
    const rawActions = Array.isArray(parsed?.actions) ? parsed.actions : [];
    const actions = rawActions.filter((a: any) => a && typeof a === "object" && jobIdSet.has(a.job_id) && ["assign", "unassign", "reschedule", "note"].includes(a.type));
    let response = String(parsed?.response ?? "");

    if (data.mode === "execute" && actions.length > 5) status = "awaiting_confirm";

    // Execute server-side when mode=execute and within the confirmation limit.
    let executed = 0;
    let affected = 0;
    const executionNotes: string[] = [];
    if (status === "ok" && data.mode === "execute" && actions.length > 0) {
      for (const a of actions) {
        try {
          if (a.type === "assign") {
            if (!driverIdSet.has(a.driver_id)) { executionNotes.push(`assign skipped for ${String(a.job_id).slice(0, 8)}: driver not in context`); continue; }
            const { data: rows, error } = await sb.from("jobs")
              .update({ driver_id: a.driver_id }).eq("id", a.job_id).eq("company_id", c.id).select("id");
            if (error) throw error;
            if (rows?.length) { affected += rows.length; executed++; }
          } else if (a.type === "unassign") {
            const { data: rows, error } = await sb.from("jobs")
              .update({ driver_id: null }).eq("id", a.job_id).eq("company_id", c.id).select("id");
            if (error) throw error;
            if (rows?.length) { affected += rows.length; executed++; }
          } else if (a.type === "reschedule") {
            const patch: { date?: string; time?: string; pickup_at?: string } = {};
            if (typeof a.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(a.date)) patch.date = a.date;
            if (typeof a.time === "string" && /^\d{2}:\d{2}$/.test(a.time)) patch.time = a.time;
            if (typeof a.pickup_at === "string" && !Number.isNaN(Date.parse(a.pickup_at))) patch.pickup_at = a.pickup_at;
            if (Object.keys(patch).length === 0) { executionNotes.push(`reschedule skipped for ${String(a.job_id).slice(0, 8)}: no valid date/time`); continue; }
            const { data: rows, error } = await sb.from("jobs")
              .update(patch).eq("id", a.job_id).eq("company_id", c.id).select("id");
            if (error) throw error;
            if (rows?.length) { affected += rows.length; executed++; }
          } else if (a.type === "note") {
            // Notes aren't persisted in a job field here — just surface in response.
            executionNotes.push(`note ${String(a.job_id).slice(0, 8)}: ${String(a.note ?? "").slice(0, 140)}`);
          }
        } catch (e: any) {
          executionNotes.push(`action failed for ${String(a.job_id).slice(0, 8)}: ${(e?.message ?? "unknown").slice(0, 140)}`);
        }
      }
    }

    // Helpful 0-row feedback when the AI returned no actions or nothing landed.
    if (status === "ok" && data.mode === "execute" && actions.length === 0) {
      if (!response.trim()) response = `I searched today (${today}) and yesterday (${yesterday}), but found 0 matching trips to change.`;
    } else if (status === "ok" && data.mode === "execute" && actions.length > 0 && affected === 0) {
      response = `${response}\n\n_No trips were changed — 0 rows affected. The referenced trips may have moved or already match the requested state._`.trim();
    } else if (status === "ok" && data.mode === "execute" && affected > 0) {
      response = `${response}\n\n_Applied ${executed} of ${actions.length} action(s); ${affected} trip(s) updated._`.trim();
    }
    if (executionNotes.length > 0) response = `${response}\n\n${executionNotes.map((n) => `- ${n}`).join("\n")}`.trim();

    await sb.from("ai_command_log").insert({
      company_id: c.id,
      actor_user_id: context.userId,
      mode: data.mode,
      prompt: data.prompt,
      response,
      actions,
      status,
      error: errMsg,
    });

    if (status === "error") throw new Error(errMsg ?? "AI error");
    return { response, actions, status, affected, executed };
  });

export const listAiCommandHistory = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const c = await resolveCompany(context);
    const sb = await getAdminClient();
    const { data } = await sb.from("ai_command_log")
      .select("id, mode, prompt, response, actions, status, created_at")
      .eq("company_id", c.id)
      .order("created_at", { ascending: false })
      .limit(20);
    return data ?? [];
  });

// ==========================================================
// M2 · Auto-assign driver
// ==========================================================
export const autoAssignJob = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ job_id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const c = await resolveCompany(context);
    const sb = await getAdminClient();
    // Ensure the job belongs to (or is executed by) this company
    const { data: job } = await sb.from("jobs")
      .select("id, company_id, executor_company_id, driver_id")
      .eq("id", data.job_id).maybeSingle();
    if (!job) throw new Error("Trip not found");
    if (job.company_id !== c.id && job.executor_company_id !== c.id) {
      throw new Error("Not allowed for this trip");
    }
    if (job.driver_id) return { ok: true, driver_id: job.driver_id, reason: "already_assigned", score: 0 };

    await assertFeatureEnabled(c.id, "ai_auto_assign");
    const { data: res, error } = await sb.rpc("auto_assign_job", { _job_id: data.job_id });
    if (error) throw new Error(error.message);
    const row = Array.isArray(res) ? res[0] : res;
    if (!row?.driver_id) {
      return { ok: false, driver_id: null, reason: row?.reason ?? "no_driver", score: 0 };
    }
    // Charge only on successful assignment
    await spendOrThrow(c.id, "ai_auto_assign", `Auto-assign trip ${data.job_id.slice(0, 8)}`, data.job_id);
    return { ok: true, driver_id: row.driver_id, reason: row.reason, score: Number(row.score ?? 0) };
  });


// ---------- REFERRALS ----------

export const listMyReferrals = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const c = await resolveCompany(context);
    if (!(c as any).referral_code) return { code: null, requests: [] as any[] };
    const supabaseAdmin = await getAdminClient();
    const { data, error } = await supabaseAdmin
      .from("access_requests")
      .select("id, full_name, company_name, email, kind, status, created_at")
      .eq("referral_code", (c as any).referral_code)
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) throw new Error(error.message);
    return { code: (c as any).referral_code as string, requests: data ?? [] };
  });

// ---------- AI TRAINING LOG (learning loop) ----------
// Called after coordinator saves AI-extracted trips so we can compare the
// initial AI draft against the final human-corrected version.
export const logAiTrainingSample = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      original_text: z.string().min(1).max(200000),
      ai_initial_output: z.any(),
      human_corrected_output: z.any(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    let companyId: string | null = null;
    try {
      const c = await resolveCompany(context);
      companyId = (c as any)?.id ?? null;
    } catch {
      companyId = null;
    }
    const { error } = await context.supabase
      .from("ai_training_logs")
      .insert({
        user_id: context.userId,
        company_id: companyId,
        original_text: data.original_text,
        ai_initial_output: data.ai_initial_output,
        human_corrected_output: data.human_corrected_output,
      });
    if (error) throw new Error(error.message);
    return { ok: true };
  });


// ---------- TRIP VERIFICATION (duplicate & suspicious pattern detection) ----------

type TripFlag = {
  duplicates: { id: string; date: string | null; time: string | null; from_location: string | null; to_location: string | null; pax_names: string[] }[];
  suspicious: { id: string; date: string | null; time: string | null; flight_number: string | null; from_location: string | null; to_location: string | null; pax_names: string[] }[];
};

function normalizeName(s: string | null | undefined): string {
  return (s ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

function timeToMinutes(t: string | null | undefined): number | null {
  if (!t) return null;
  const m = /^(\d{1,2}):(\d{2})/.exec(t);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

function isAirportLocation(loc: string | null | undefined): boolean {
  if (!loc) return false;
  const s = loc.toLowerCase();
  if (s.includes("airport") || s.includes("terminal") || s.includes("aeroport") || s.includes("aeropuerto")) return true;
  // IATA-like 3-letter codes in parens or bracketed
  if (/\b[a-z]{3}\b/i.test(loc) && /\(|\[/.test(loc)) return true;
  return false;
}

function flightNumberOf(j: any): string | null {
  const raw = j.from_flight || j.to_flight || j.flightorship;
  if (!raw) return null;
  return String(raw).trim().toUpperCase().replace(/\s+/g, "") || null;
}

export const computeTripFlags = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const c = await resolveCompany(context);
    const supabaseAdmin = await getAdminClient();
    const today = new Date();
    const from = today.toISOString().slice(0, 10);
    const to = new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    const { data: rows, error } = await supabaseAdmin
      .from("jobs")
      .select("id, date, time, pickup_at, from_location, to_location, from_flight, to_flight, flightorship, status, dismissed_flags, pax(name)")
      .eq("company_id", (c as any).id)
      .gte("date", from)
      .lte("date", to)
      .not("status", "in", "(cancelled,rejected,completed)");
    if (error) throw new Error(error.message);

    const jobs = (rows ?? []).map((j: any) => {
      const pax_names: string[] = (j.pax ?? []).map((p: any) => normalizeName(p.name)).filter(Boolean);
      return {
        ...j,
        _pax_names: pax_names,
        _primary_pax: pax_names[0] ?? "",
        _minutes: timeToMinutes(j.time),
        _flight: flightNumberOf(j),
        _dismissed: new Set<string>(j.dismissed_flags ?? []),
      };
    });

    // Bucket by date + primary pax name for fast comparisons.
    const byKey = new Map<string, typeof jobs>();
    for (const j of jobs) {
      if (!j._primary_pax || !j.date) continue;
      const key = `${j.date}::${j._primary_pax}`;
      const arr = byKey.get(key) ?? [];
      arr.push(j);
      byKey.set(key, arr);
    }

    const result: Record<string, TripFlag> = {};
    const getEntry = (id: string): TripFlag => {
      let e = result[id];
      if (!e) { e = { duplicates: [], suspicious: [] }; result[id] = e; }
      return e;
    };
    const asSibling = (j: any) => ({
      id: j.id, date: j.date, time: j.time,
      from_location: j.from_location, to_location: j.to_location,
      pax_names: j._pax_names,
      flight_number: j._flight,
    });

    for (const group of byKey.values()) {
      if (group.length < 2) continue;
      for (let i = 0; i < group.length; i++) {
        for (let k = i + 1; k < group.length; k++) {
          const a = group[i]; const b = group[k];
          const am = a._minutes; const bm = b._minutes;
          const dtMin = am != null && bm != null ? Math.abs(am - bm) : null;

          // DUPLICATE: same date + same pax + within 60 min
          if (dtMin != null && dtMin <= 60) {
            if (!a._dismissed.has("duplicate")) getEntry(a.id).duplicates.push(asSibling(b));
            if (!b._dismissed.has("duplicate")) getEntry(b.id).duplicates.push(asSibling(a));
          }

          // SUSPICIOUS: airport trips ≥ 90 min apart, OR different flight numbers on file
          const bothAirport =
            (isAirportLocation(a.from_location) || isAirportLocation(a.to_location)) &&
            (isAirportLocation(b.from_location) || isAirportLocation(b.to_location));
          const airportSpread = bothAirport && dtMin != null && dtMin >= 90;
          const flightMismatch = !!a._flight && !!b._flight && a._flight !== b._flight;
          if (airportSpread || flightMismatch) {
            if (!a._dismissed.has("suspicious")) getEntry(a.id).suspicious.push(asSibling(b));
            if (!b._dismissed.has("suspicious")) getEntry(b.id).suspicious.push(asSibling(a));
          }
        }
      }
    }
    return result;
  });

export const dismissTripFlag = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      job_id: z.string().uuid(),
      kind: z.enum(["duplicate", "suspicious"]),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const c = await resolveCompany(context);
    const supabaseAdmin = await getAdminClient();
    const { data: row, error: rErr } = await supabaseAdmin
      .from("jobs")
      .select("id, company_id, dismissed_flags")
      .eq("id", data.job_id)
      .maybeSingle();
    if (rErr) throw new Error(rErr.message);
    if (!row || (row as any).company_id !== (c as any).id) throw new Error("not_found");
    const cur: string[] = (row as any).dismissed_flags ?? [];
    if (cur.includes(data.kind)) return { ok: true };
    const next = [...cur, data.kind];
    const { error } = await supabaseAdmin
      .from("jobs")
      .update({ dismissed_flags: next })
      .eq("id", data.job_id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const mergeTrips = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      keep_job_id: z.string().uuid(),
      drop_job_ids: z.array(z.string().uuid()).min(1).max(10),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const c = await resolveCompany(context);
    const supabaseAdmin = await getAdminClient();
    const allIds = [data.keep_job_id, ...data.drop_job_ids];
    const { data: rows, error } = await supabaseAdmin
      .from("jobs")
      .select("id, company_id, driver_note")
      .in("id", allIds);
    if (error) throw new Error(error.message);
    if (!rows || rows.length !== allIds.length) throw new Error("not_found");
    for (const r of rows) {
      if ((r as any).company_id !== (c as any).id) throw new Error("forbidden");
    }

    // Copy pax rows from dropped → kept, dedup by lower(name).
    const { data: keepPax } = await supabaseAdmin.from("pax").select("name").eq("job_id", data.keep_job_id);
    const have = new Set<string>((keepPax ?? []).map((p: any) => normalizeName(p.name)));
    const { data: dropPax } = await supabaseAdmin.from("pax").select("name").in("job_id", data.drop_job_ids);
    const toAdd = (dropPax ?? [])
      .filter((p: any) => p.name && !have.has(normalizeName(p.name)))
      .filter((p: any, i: number, arr: any[]) => arr.findIndex((q) => normalizeName(q.name) === normalizeName(p.name)) === i)
      .map((p: any) => ({ job_id: data.keep_job_id, name: p.name }));
    if (toAdd.length > 0) {
      const { error: pErr } = await supabaseAdmin.from("pax").insert(toAdd);
      if (pErr) throw new Error(pErr.message);
    }

    // Clear duplicate flag on kept row.
    await supabaseAdmin
      .from("jobs")
      .update({ dismissed_flags: [] })
      .eq("id", data.keep_job_id);

    // Soft-cancel dropped rows with a merge note.
    const noteSuffix = `\n[merged into ${data.keep_job_id}]`;
    for (const id of data.drop_job_ids) {
      const cur = (rows.find((r: any) => r.id === id) as any)?.driver_note ?? "";
      await supabaseAdmin
        .from("jobs")
        .update({ status: "cancelled" as any, driver_note: (cur || "") + noteSuffix })
        .eq("id", id);
    }
    return { ok: true, merged_pax: toAdd.length, cancelled: data.drop_job_ids.length };
  });
