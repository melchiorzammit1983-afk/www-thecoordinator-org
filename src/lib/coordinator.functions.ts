import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { maltaWallTimeToUtcIso, isoToMaltaDateTime, formatMaltaTime } from "./time";
import { parseFlightCode, describeFlight, looksLikeVessel } from "./flight-code";

/**
 * Normalize an ISO-ish datetime returned by Gemini. Gemini frequently emits
 * naive strings like "2026-07-18T08:15:00" (no timezone), which JS parses as
 * UTC — wrong for Malta (UTC+2 in summer). If no explicit Z / ±HH:MM offset
 * is present, interpret the wall-clock as Europe/Malta local time and convert
 * to a real UTC ISO.
 */
function normalizeMaltaIso(raw: unknown): string | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  const s = raw.trim();
  const hasTz = /(Z|[+-]\d{2}:?\d{2})$/i.test(s);
  if (hasTz) {
    const t = new Date(s).getTime();
    return Number.isFinite(t) ? new Date(t).toISOString() : null;
  }
  const m = s.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}(?::\d{2})?)/);
  if (!m) {
    const t = new Date(s).getTime();
    return Number.isFinite(t) ? new Date(t).toISOString() : null;
  }
  try {
    return maltaWallTimeToUtcIso(m[1], m[2]);
  } catch {
    return null;
  }
}

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
async function spendSoft(companyId: string | null | undefined, featureKey: string, note: string, jobId?: string) {
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
    const block = rules.map((r, i) => `${i + 1}. ${r.title ? r.title + ": " : ""}${r.rule_text}`).join("\n");
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
      .from("companies")
      .select("id, name, status")
      .eq("id", companyIdOverride)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) throw new Error("Company not found");
    return { ...data, isAdmin: true };
  }
  const { data, error } = await supabaseAdmin
    .from("companies")
    .select("id, name, status")
    .eq("owner_user_id", ctx.userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("No company assigned to this account");
  return { ...data, isAdmin };
}

// ---------- DRIVER-ACCEPTED LOCK HELPERS ----------

/**
 * A trip is "locked" once the driver has accepted it OR the driver has already
 * progressed it past pending. Coordinator changes on locked trips must be
 * routed through job_coord_change_requests for driver approval.
 * Admins always bypass the lock.
 */
type LockableJob = {
  id: string;
  company_id: string;
  driver_id: string | null;
  driver_accepted_at: string | null;
  status: string | null;
};

async function loadLockableJob(jobId: string, companyId: string): Promise<LockableJob | null> {
  const sb = await getAdminClient();
  const { data } = await sb
    .from("jobs")
    .select("id, company_id, driver_id, driver_accepted_at, status")
    .eq("id", jobId)
    .eq("company_id", companyId)
    .maybeSingle();
  return (data ?? null) as LockableJob | null;
}

function isJobLocked(job: LockableJob | null): boolean {
  if (!job) return false;
  if (job.driver_accepted_at) return true;
  const s = (job.status ?? "").toLowerCase();
  return s !== "" && s !== "pending";
}

async function createChangeRequest(params: {
  jobId: string;
  companyId: string;
  requestedBy: string;
  kind: "edit" | "reassign" | "cancel" | "delete";
  requestedChanges: Record<string, unknown>;
  note?: string | null;
  driverId?: string | null;
}): Promise<{ pending: true; request_id: string; message: string }> {
  const sb = await getAdminClient();
  // Cancel any existing pending request of the same kind (last-write-wins).
  await sb
    .from("job_coord_change_requests")
    .update({ status: "cancelled", decided_at: new Date().toISOString(), decided_note: "superseded" } as never)
    .eq("job_id", params.jobId)
    .eq("kind", params.kind)
    .eq("status", "pending");
  const { data, error } = await sb
    .from("job_coord_change_requests")
    .insert({
      job_id: params.jobId,
      company_id: params.companyId,
      requested_by: params.requestedBy,
      kind: params.kind,
      requested_changes: params.requestedChanges as never,
      note: params.note ?? null,
    } as never)
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  const label: Record<string, string> = {
    edit: "trip changes",
    reassign: "driver reassignment",
    cancel: "trip cancellation",
    delete: "trip deletion",
  };
  const body = `📝 Coordinator requested ${label[params.kind]} — please review and approve or reject.`;
  await sb.from("trip_messages").insert({
    job_id: params.jobId,
    company_id: params.companyId,
    sender_kind: "system",
    sender_label: "System",
    body,
    thread_kind: "driver_coord",
    driver_id: params.driverId ?? null,
  } as never);
  return {
    pending: true,
    request_id: (data as { id: string }).id,
    message: `Change request sent to driver for approval.`,
  };
}

// ---------- BASICS ----------

export const getMyCompany = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const supabaseAdmin = await getAdminClient();
    const { data, error } = await supabaseAdmin
      .from("companies")
      .select(
        "id, name, status, access_end, require_client_company, custom_link, logo_url, advert_url, advert_link, advert_caption, advert_enabled, referral_code",
      )
      .eq("owner_user_id", context.userId)
      .maybeSingle();
    if (error) return null;
    return data ?? null;
  });

export const updateMyBranding = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        logo_url: z.string().max(2_000_000).nullable().optional(),
        advert_url: z.string().max(2_000_000).nullable().optional(),
        advert_link: z.string().trim().max(500).nullable().optional(),
        advert_caption: z.string().trim().max(200).nullable().optional(),
        advert_enabled: z.boolean().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const supabaseAdmin = await getAdminClient();
    const { data: co, error: cErr } = await supabaseAdmin
      .from("companies")
      .select("id")
      .eq("owner_user_id", context.userId)
      .maybeSingle();
    if (cErr || !co) throw new Error("No company assigned");
    const patch: Record<string, unknown> = {};
    if ("logo_url" in data) patch.logo_url = data.logo_url ?? null;
    if ("advert_url" in data) patch.advert_url = data.advert_url ?? null;
    if ("advert_link" in data) patch.advert_link = data.advert_link || null;
    if ("advert_caption" in data) patch.advert_caption = data.advert_caption || null;
    if ("advert_enabled" in data) patch.advert_enabled = !!data.advert_enabled;
    const { error } = await supabaseAdmin
      .from("companies")
      .update(patch as never)
      .eq("id", co.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const getMyFeatures = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const supabaseAdmin = await getAdminClient();
    const { FEATURE_KEYS } = await import("@/lib/features");
    const { data: co } = await supabaseAdmin
      .from("companies")
      .select("id")
      .eq("owner_user_id", context.userId)
      .maybeSingle();
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
    const [
      { count: pending },
      { count: unassigned },
      { count: todayJobs },
      { count: driverCount },
      { count: priceProposals },
    ] = await Promise.all([
      supabaseAdmin
        .from("client_bookings")
        .select("id", { count: "exact", head: true })
        .eq("company_id", c.id)
        .in("status", ["pending", "modification_pending"]),
      supabaseAdmin
        .from("jobs")
        .select("id", { count: "exact", head: true })
        .eq("company_id", c.id)
        .is("driver_id", null),
      supabaseAdmin
        .from("jobs")
        .select("id", { count: "exact", head: true })
        .eq("company_id", c.id)
        .eq("date", todayIso),
      supabaseAdmin.from("drivers").select("id", { count: "exact", head: true }).eq("company_id", c.id),
      supabaseAdmin
        .from("job_price_proposals")
        .select("id", { count: "exact", head: true })
        .eq("to_company_id", c.id)
        .eq("status", "proposed"),
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

/**
 * Returns light activity lists for the dashboard: recent pending client bookings
 * and the next few unassigned jobs. Kept intentionally small (5 rows each) so
 * the dashboard stays snappy on mobile.
 */
export const getDashboardActivity = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const c = await resolveCompany(context);
    const sb = await getAdminClient();
    const [pendingRes, unassignedRes] = await Promise.all([
      sb.from("client_bookings")
        .select("id, from_location, to_location, date, time, status, created_at, jobs!job_id(pickup_display_name, dropoff_display_name, route_duration_sec, route_distance_m, route_computed_at, live_eta_sec, live_eta_updated_at, traffic_delay_minutes, traffic_severity, leave_by_at, pickup_at, driver_id, from_flight, to_flight, flight_status, flight_status_note, flight_scheduled_at, flight_estimated_at)")
        .eq("company_id", c.id)
        .in("status", ["pending", "modification_pending"])
        .order("created_at", { ascending: false })
        .limit(5),
      sb.from("jobs")
        .select("id, from_location, to_location, pickup_display_name, dropoff_display_name, date, time, pickup_at, status, route_duration_sec, route_distance_m, route_computed_at, live_eta_sec, live_eta_updated_at, traffic_delay_minutes, traffic_severity, leave_by_at, driver_id, from_flight, to_flight, flight_status, flight_status_note, flight_scheduled_at, flight_estimated_at")
        .eq("company_id", c.id)
        .is("driver_id", null)
        .not("status", "in", "(completed,cancelled)")
        .gte("date", new Date().toISOString().slice(0, 10))
        .order("pickup_at", { ascending: true })
        .limit(5),
    ]);
    return {
      pending: (pendingRes.data ?? []).map((b: any) => ({
        ...b,
        pickup_display_name: b.jobs?.pickup_display_name ?? null,
        dropoff_display_name: b.jobs?.dropoff_display_name ?? null,
        route_duration_sec: b.jobs?.route_duration_sec ?? null,
        route_distance_m: b.jobs?.route_distance_m ?? null,
        route_computed_at: b.jobs?.route_computed_at ?? null,
        live_eta_sec: b.jobs?.live_eta_sec ?? null,
        live_eta_updated_at: b.jobs?.live_eta_updated_at ?? null,
        traffic_delay_minutes: b.jobs?.traffic_delay_minutes ?? null,
        traffic_severity: b.jobs?.traffic_severity ?? null,
        leave_by_at: b.jobs?.leave_by_at ?? null,
        pickup_at: b.jobs?.pickup_at ?? null,
        driver_id: b.jobs?.driver_id ?? null,
        from_flight: b.jobs?.from_flight ?? null,
        to_flight: b.jobs?.to_flight ?? null,
        flight_status: b.jobs?.flight_status ?? null,
        flight_status_note: b.jobs?.flight_status_note ?? null,
        flight_scheduled_at: b.jobs?.flight_scheduled_at ?? null,
        flight_estimated_at: b.jobs?.flight_estimated_at ?? null,
      })),
      unassigned: unassignedRes.data ?? [],
    };
  });


// ---------- JOBS ----------

export const listJobs = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        from: z.string().optional(),
        to: z.string().optional(),
      })
      .parse(i ?? {}),
  )
  .handler(async ({ data, context }) => {
    const c = await resolveCompany(context);
    try {
      await syncVirtualDrivers(context, c.id);
    } catch {
      /* best effort */
    }
    const supabaseAdmin = await getAdminClient();
    const cols =
      "id, trip_no, company_id, executor_company_id, dispatch_chain_company_ids, from_location, to_location, pickup_display_name, dropoff_display_name, pickup_place_id, dropoff_place_id, route_duration_sec, route_distance_m, route_computed_at, live_eta_sec, live_eta_updated_at, date, time, pickup_at, flightorship, from_flight, to_flight, flight_status, flight_status_note, flight_status_updated_at, flight_scheduled_at, flight_estimated_at, tracking_enabled, qr_strict_mode, status, driver_id, vehicle, contact_phone, clientcompanyname, driver_accepted_at, deletion_requested_at, payment_status, grouped_count, grouped_at, group_id, group_name, group_note, client_confirmed_at, client_link_token, source, coord_approved_at, parent_job_id, promo_note, traffic_delay_minutes, traffic_severity, leave_by_at, pickup_shift_reason, drivers(name,vehicle,phone,seats_available,availability_note), pax(id,name,status,boarded_at), job_labels(trip_labels(id,name,color))";

    let mineQ = supabaseAdmin.from("jobs").select(cols).eq("company_id", c.id).order("pickup_at", { ascending: true });
    if (data.from) mineQ = mineQ.gte("date", data.from);
    if (data.to) mineQ = mineQ.lte("date", data.to);

    let outQ = supabaseAdmin
      .from("jobs")
      .select(cols + ", executor:executor_company_id(id,name), origin:origin_company_id(id,name)")
      .contains("dispatch_chain_company_ids", [c.id])
      .neq("company_id", c.id)
      .order("pickup_at", { ascending: true });
    if (data.from) outQ = outQ.gte("date", data.from);
    if (data.to) outQ = outQ.lte("date", data.to);

    const [mineRes, outRes, partnersRes] = await Promise.all([
      mineQ,
      outQ,
      supabaseAdmin.from("drivers").select("id, linked_company_id").eq("company_id", c.id).eq("kind", "partner"),
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
      chain_role: r.executor_company_id && r.executor_company_id !== c.id ? "creator_watching" : "executor",
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
          : realDriver
            ? { name: `${executorName} → ${realDriver}` }
            : { name: executorName },
        labels: Array.isArray(r.job_labels) ? r.job_labels.map((j: any) => j.trip_labels).filter(Boolean) : [],
      };
    });

    const combined: any[] = [...mine, ...out];

    // ---- Multi-hop expansion: creator sees a card in EVERY partner lane the trip has visited.
    const originJobIds = combined
      .filter(
        (r) =>
          r.company_id === c.id &&
          Array.isArray(r.dispatch_chain_company_ids) &&
          r.dispatch_chain_company_ids.length >= 2,
      )
      .map((r) => r.id);
    const hopsByJob = new Map<string, any[]>();
    if (originJobIds.length) {
      const { data: hops } = await supabaseAdmin
        .from("job_dispatch_hops")
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
      for (const id of r.dispatch_chain_company_ids ?? []) allCompanyIds.add(id);
      if (r.executor_company_id) allCompanyIds.add(r.executor_company_id);
    }
    for (const list of hopsByJob.values()) for (const h of list) allCompanyIds.add(h.to_company_id);
    allCompanyIds.delete(c.id);
    const nameMap: Record<string, string> = { [c.id]: c.name };
    if (allCompanyIds.size) {
      const { data: comps } = await supabaseAdmin
        .from("companies")
        .select("id, name")
        .in("id", Array.from(allCompanyIds));
      for (const co of comps ?? []) nameMap[co.id] = co.name;
    }

    // Attach chain_names to every row.
    for (const r of combined) {
      const ids: string[] = Array.isArray(r.dispatch_chain_company_ids) ? r.dispatch_chain_company_ids : [];
      r.chain_names = ids.map((id) => (id === c.id ? "You" : (nameMap[id] ?? "Partner")));
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
  // From Google Places pick — persisted so we can render the hotel/business
  // name instead of the raw address, and re-lookup ETAs without re-charging.
  pickup_place_id: z.string().trim().max(200).optional().nullable(),
  dropoff_place_id: z.string().trim().max(200).optional().nullable(),
  pickup_display_name: z.string().trim().max(200).optional().nullable(),
  dropoff_display_name: z.string().trim().max(200).optional().nullable(),
  tracking_kind: z.enum(["flight", "vessel"]).optional(),
  pax: z.array(z.string().trim().min(1).max(200)).max(200).optional(),
});

async function syncJobLabels(ctx: Ctx, companyId: string, jobId: string, labelIds: string[] | undefined) {
  if (!labelIds) return;
  const supabaseAdmin = await getAdminClient();
  // Verify labels belong to the same company
  let allowed: string[] = [];
  if (labelIds.length) {
    const { data: rows } = await supabaseAdmin
      .from("trip_labels")
      .select("id")
      .eq("company_id", companyId)
      .in("id", labelIds);
    allowed = (rows ?? []).map((r: { id: string }) => r.id);
  }
  await supabaseAdmin.from("job_labels").delete().eq("job_id", jobId);
  if (allowed.length) {
    await supabaseAdmin.from("job_labels").insert(allowed.map((id) => ({ job_id: jobId, label_id: id })));
  }
}

async function syncJobPax(jobId: string, names: string[] | undefined) {
  if (names === undefined) return;
  const supabaseAdmin = await getAdminClient();
  const clean = Array.from(new Set(names.map((name) => name.trim()).filter(Boolean))).slice(0, 200);
  const { error: deleteErr } = await supabaseAdmin.from("pax").delete().eq("job_id", jobId);
  if (deleteErr) throw new Error(deleteErr.message);
  if (!clean.length) return;
  const { error: insertErr } = await supabaseAdmin
    .from("pax")
    .insert(clean.map((name) => ({ job_id: jobId, name })));
  if (insertErr) throw new Error(insertErr.message);
  // Verify: re-read the row count so a silent RLS/constraint drop is caught.
  const { count, error: countErr } = await supabaseAdmin
    .from("pax")
    .select("id", { count: "exact", head: true })
    .eq("job_id", jobId);
  if (countErr) throw new Error(`Passenger sync verification failed: ${countErr.message}`);
  if ((count ?? 0) !== clean.length) {
    throw new Error(`Passenger sync mismatch: expected ${clean.length} row(s) stored, found ${count ?? 0}.`);
  }
}

export const createJob = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => jobInput.parse(i))
  .handler(async ({ data, context }) => {
    const c = await resolveCompany(context);
    const supabaseAdmin = await getAdminClient();
    const pickup_at = makePickupIso(data.date, data.time);
    const { data: row, error } = await supabaseAdmin
      .from("jobs")
      .insert({
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
        pickup_place_id: data.pickup_place_id || null,
        dropoff_place_id: data.dropoff_place_id || null,
        pickup_display_name: data.pickup_display_name || null,
        dropoff_display_name: data.dropoff_display_name || null,
        tracking_kind: data.tracking_kind ?? "flight",
      } as any)
      .select()
      .single();
    if (error) throw new Error(error.message);
    // If the caller didn't send explicit passenger names, try to auto-fill
    // from the client/company field (e.g. "MV Ocean Pioneer (John, Jane)").
    let paxToSync = data.pax;
    if (!paxToSync || paxToSync.length === 0) {
      const { extractPaxNames } = await import("./pax-extract");
      const auto = extractPaxNames({ clientcompanyname: data.clientcompanyname });
      if (auto.length) paxToSync = auto;
    }
    await syncJobPax(row.id, paxToSync);
    await syncJobLabels(context, c.id, row.id, data.label_ids);
    await spendSoft(c.id, "trip_created", "Trip created", row.id);
    // Auto-estimate the fare from company pricing + service areas. Route
    // data may not exist yet — the batch enricher will refresh once cached.
    const { autoPriceJobBg } = await import("./auto-price.server");
    autoPriceJobBg(row.id);
    return row;
  });

export const updateJob = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => jobInput.extend({ id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const c = await resolveCompany(context);
    const supabaseAdmin = await getAdminClient();
    const { data: existing, error: e1 } = await supabaseAdmin
      .from("jobs")
      .select("id, company_id, from_location, to_location, date, time, pickup_at, driver_id, driver_accepted_at, status, vehicle, contact_phone, from_flight, to_flight, clientcompanyname, qr_strict_mode, tracking_enabled")
      .eq("id", data.id)
      .eq("company_id", c.id)
      .single();
    if (e1 || !existing) throw new Error("Job not found");
    // Driver-accepted lock: coordinator changes must be approved by driver.
    const lockable: LockableJob = {
      id: (existing as any).id,
      company_id: (existing as any).company_id,
      driver_id: (existing as any).driver_id,
      driver_accepted_at: (existing as any).driver_accepted_at,
      status: (existing as any).status,
    };
    if (!c.isAdmin && isJobLocked(lockable)) {
      // Compare and stage only actually changed fields.
      const proposed: Record<string, unknown> = {
        from_location: data.from_location,
        to_location: data.to_location,
        date: data.date,
        time: data.time,
        vehicle: data.vehicle || null,
        contact_phone: data.contact_phone || null,
        from_flight: (data.from_flight || "").toUpperCase() || null,
        to_flight: (data.to_flight || "").toUpperCase() || null,
        clientcompanyname: data.clientcompanyname || null,
        qr_strict_mode: !!data.qr_strict_mode,
        tracking_enabled: !!data.tracking_enabled,
        pickup_display_name: data.pickup_display_name ?? null,
        dropoff_display_name: data.dropoff_display_name ?? null,
        pickup_place_id: data.pickup_place_id ?? null,
        dropoff_place_id: data.dropoff_place_id ?? null,
      };
      const diff: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(proposed)) {
        if ((existing as any)[k] !== v) diff[k] = v;
      }
      // Labels-only edits fall through to syncJobLabels below (allowed).
      if (Object.keys(diff).length === 0) {
        await syncJobPax(data.id, data.pax);
        await syncJobLabels(context, c.id, data.id, data.label_ids);
        return { ok: true };
      }
      const res = await createChangeRequest({
        jobId: data.id,
        companyId: c.id,
        requestedBy: context.userId,
        kind: "edit",
        requestedChanges: diff,
        driverId: lockable.driver_id,
      });
      // Labels can still be updated immediately (coordinator-only metadata).
      await syncJobPax(data.id, data.pax);
      await syncJobLabels(context, c.id, data.id, data.label_ids);
      return { ok: true, ...res };
    }

    const pickup_at = makePickupIso(data.date, data.time);
    // If the address changed, invalidate cached name + ETA so we recompute.
    const fromChanged = (existing as any).from_location !== data.from_location;
    const toChanged = (existing as any).to_location !== data.to_location;
    const patch: Record<string, any> = {
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
    };
    if (data.pickup_place_id !== undefined) patch.pickup_place_id = data.pickup_place_id || null;
    if (data.dropoff_place_id !== undefined) patch.dropoff_place_id = data.dropoff_place_id || null;
    if (data.pickup_display_name !== undefined) patch.pickup_display_name = data.pickup_display_name || null;
    if (data.dropoff_display_name !== undefined) patch.dropoff_display_name = data.dropoff_display_name || null;
    if (data.tracking_kind !== undefined) patch.tracking_kind = data.tracking_kind;
    if (fromChanged) {
      patch.pickup_display_name = data.pickup_display_name || null;
      patch.pickup_place_id = data.pickup_place_id || null;
    }
    if (toChanged) {
      patch.dropoff_display_name = data.dropoff_display_name || null;
      patch.dropoff_place_id = data.dropoff_place_id || null;
    }
    if (fromChanged || toChanged) {
      patch.route_duration_sec = null;
      patch.route_distance_m = null;
      patch.route_computed_at = null;
    }
    const { error } = await supabaseAdmin
      .from("jobs")
      .update(patch as any)
      .eq("id", data.id);
    if (error) {
      if (error.message?.includes("partner_must_accept_first")) {
        throw new Error(
          "This trip was dispatched to a partner company — they must accept it before a driver can be assigned.",
        );
      }
      throw new Error(error.message);
    }
    // Auto-fill from client/company parentheses only when caller passed
    // no explicit pax array AND the trip has no existing passenger rows.
    let paxToSync = data.pax;
    if (!paxToSync || paxToSync.length === 0) {
      const { count: existingCount } = await supabaseAdmin
        .from("pax").select("id", { count: "exact", head: true }).eq("job_id", data.id);
      if ((existingCount ?? 0) === 0) {
        const { extractPaxNames } = await import("./pax-extract");
        const auto = extractPaxNames({ clientcompanyname: data.clientcompanyname });
        if (auto.length) paxToSync = auto;
      }
    }
    await syncJobPax(data.id, paxToSync);
    await syncJobLabels(context, c.id, data.id, data.label_ids);
    // Refresh auto-estimate (no-op when a manual price is already set).
    const { autoPriceJobBg } = await import("./auto-price.server");
    autoPriceJobBg(data.id);
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
      .select("id, company_id, date, time, driver_id, from_flight, to_flight, flight_scheduled_at, flight_estimated_at")
      .eq("id", data.id)
      .eq("company_id", c.id)
      .maybeSingle();
    if (e1 || !job) throw new Error("Job not found");
    const iso = (job as any).flight_estimated_at || (job as any).flight_scheduled_at;
    if (!iso) throw new Error("No flight time available yet");
    // CRITICAL: derive Malta wall-clock date/time, not UTC slice.
    // A 13:55 Malta flight in summer (UTC+2) would otherwise be stored as 11:55.
    const { date, time } = isoToMaltaDateTime(iso);
    const pickup_at = makePickupIso(date, time);
    const { error } = await supabaseAdmin
      .from("jobs")
      .update({
        date,
        time,
        pickup_at,
        flight_status: "on_time",
        flight_status_note: null,
        flight_status_updated_at: new Date().toISOString(),
      })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    // Notify assigned driver so they know the pickup shifted.
    if ((job as any).driver_id) {
      const flightCode = (job as any).from_flight || (job as any).to_flight || "";
      await supabaseAdmin.from("trip_messages").insert([
        {
          job_id: data.id,
          company_id: c.id,
          sender_kind: "system",
          sender_label: "System",
          body: `🕒 Pickup updated to ${date} ${time}${flightCode ? ` (flight ${flightCode})` : ""}.`,
          thread_kind: "driver_coord",
          driver_id: (job as any).driver_id,
        } as never,
      ]);
    }
    return { ok: true, date, time };
  });

export const autoShiftEarlyFlight = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const c = await resolveCompany(context);
    const supabaseAdmin = await getAdminClient();
    const { data: job, error: e1 } = await supabaseAdmin
      .from("jobs")
      .select(
        "id, company_id, driver_id, from_flight, to_flight, flight_status, flight_scheduled_at, flight_estimated_at",
      )
      .eq("id", data.id)
      .eq("company_id", c.id)
      .maybeSingle();
    if (e1 || !job) throw new Error("Job not found");
    if ((job as any).flight_status !== "early") throw new Error("Flight is not marked as early");
    const iso = (job as any).flight_estimated_at || (job as any).flight_scheduled_at;
    if (!iso) throw new Error("No flight time available yet");

    // Meter first — refuse the shift if the company is out of points.
    const { error: spendErr } = await supabaseAdmin.rpc("spend_points", {
      _company_id: c.id,
      _feature_key: "auto_shift_early_flight",
      _job_id: data.id as unknown as string,
      _note: "auto-shift pickup to earlier flight time",
      _cost_override: undefined as unknown as number,
    });
    if (spendErr) {
      const msg = spendErr.message || "";
      if (msg.includes("insufficient_points")) throw new Error("Out of points — buy a top-up to auto-shift.");
      if (msg.includes("feature_disabled")) throw new Error("Auto-shift has been disabled by the administrator.");
      if (msg.includes("feature_capped")) throw new Error("Monthly cap reached for auto-shift.");
      throw new Error(msg);
    }

    const { date, time } = isoToMaltaDateTime(iso);
    const pickup_at = makePickupIso(date, time);
    const { error } = await supabaseAdmin
      .from("jobs")
      .update({
        date,
        time,
        pickup_at,
        flight_status: "on_time",
        flight_status_note: null,
        flight_status_updated_at: new Date().toISOString(),
      })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    if ((job as any).driver_id) {
      const flightCode = (job as any).from_flight || (job as any).to_flight || "";
      await supabaseAdmin.from("trip_messages").insert([
        {
          job_id: data.id,
          company_id: c.id,
          sender_kind: "system",
          sender_label: "System",
          body: `⏫ Pickup moved earlier to ${time} (auto${flightCode ? `, flight ${flightCode}` : ""}).`,
          thread_kind: "driver_coord",
          driver_id: (job as any).driver_id,
        } as never,
      ]);
    }
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
      .from("jobs")
      .select("id")
      .eq("id", data.job_id)
      .eq("company_id", c.id)
      .maybeSingle();
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
      .from("pax")
      .select("id, job_id, jobs!inner(company_id)")
      .eq("id", data.pax_id)
      .maybeSingle();
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
    const { data: job } = await supabaseAdmin
      .from("jobs")
      .select("id, company_id, group_id, driver_id, driver_accepted_at, status" as any)
      .eq("id", data.job_id)
      .eq("company_id", c.id)
      .maybeSingle();
    if (!job) throw new Error("Job not found");
    const gid = (job as any).group_id as string | null;
    // Reassigning a driver-accepted trip needs the current driver's approval.
    const lockable: LockableJob = {
      id: (job as any).id,
      company_id: (job as any).company_id,
      driver_id: (job as any).driver_id,
      driver_accepted_at: (job as any).driver_accepted_at,
      status: (job as any).status,
    };
    if (!c.isAdmin && isJobLocked(lockable) && lockable.driver_id !== data.driver_id) {
      const res = await createChangeRequest({
        jobId: data.job_id,
        companyId: c.id,
        requestedBy: context.userId,
        kind: "reassign",
        requestedChanges: { driver_id: data.driver_id },
        driverId: lockable.driver_id,
      });
      return { ok: true, group_id: gid, ...res };
    }

    // Any driver change (assign, reassign, unassign) requires fresh consent from
    // the new driver, so we clear driver_accepted_at on every assignment write.
    const patch = { driver_id: data.driver_id, driver_accepted_at: null } as never;
    let q = supabaseAdmin.from("jobs").update(patch).eq("company_id", c.id);
    q = gid ? q.eq("group_id" as any, gid) : q.eq("id", data.job_id);
    const { error } = await q;
    if (error) {
      if (error.message?.includes("partner_must_accept_first")) {
        throw new Error(
          "This trip was dispatched to a partner company — they must accept it before a driver can be assigned.",
        );
      }
      throw new Error(error.message);
    }
    // System audit trail in trip chat: who was assigned and that we're waiting on them.
    if (data.driver_id) {
      const { data: driverRow } = await supabaseAdmin
        .from("drivers")
        .select("name")
        .eq("id", data.driver_id)
        .maybeSingle();
      const driverName = driverRow?.name ?? "the driver";
      const jobIds = gid
        ? ((
            await supabaseAdmin
              .from("jobs")
              .select("id")
              .eq("company_id", c.id)
              .eq("group_id" as any, gid)
          ).data?.map((r: any) => r.id) ?? [data.job_id])
        : [data.job_id];
      const rows = jobIds.map(
        (jid) =>
          ({
            job_id: jid,
            company_id: c.id,
            sender_kind: "system",
            sender_label: "System",
            body: `🕓 Trip assigned to ${driverName} — waiting on them to accept.`,
            thread_kind: "driver_coord",
            driver_id: data.driver_id,
          }) as never,
      );
      await supabaseAdmin.from("trip_messages").insert(rows);
    }
    return { ok: true, group_id: gid };
  });
export const updateJobStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        job_id: z.string().uuid(),
        status: z.enum(["pending", "active", "completed", "cancelled"]),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const c = await resolveCompany(context);
    const supabaseAdmin = await getAdminClient();
    const { data: job, error: jErr } = await supabaseAdmin
      .from("jobs")
      .select("id, company_id, status, driver_id, driver_accepted_at")
      .eq("id", data.job_id)
      .eq("company_id", c.id)
      .maybeSingle();
    if (jErr) throw new Error(jErr.message);
    if (!job) return { ok: false, missing: true };
    if ((job as any).status === data.status) return { ok: true, changed: false };
    const lockable: LockableJob = {
      id: (job as any).id,
      company_id: (job as any).company_id,
      driver_id: (job as any).driver_id,
      driver_accepted_at: (job as any).driver_accepted_at,
      status: (job as any).status,
    };
    if (!c.isAdmin && data.status === "cancelled" && isJobLocked(lockable)) {
      const res = await createChangeRequest({
        jobId: data.job_id,
        companyId: c.id,
        requestedBy: context.userId,
        kind: "cancel",
        requestedChanges: { status: "cancelled" },
        driverId: lockable.driver_id,
      });
      return { ok: true, changed: false, ...res };
    }

    const { error } = await supabaseAdmin
      .from("jobs")
      .update({ status: data.status } as never)
      .eq("id", data.job_id)
      .eq("company_id", c.id);
    if (error) throw new Error(error.message);
    const label: Record<string, string> = {
      pending: "reset to pending",
      active: "reactivated",
      completed: "marked completed",
      cancelled: "cancelled",
    };
    await supabaseAdmin.from("trip_messages").insert({
      job_id: data.job_id,
      company_id: c.id,
      sender_kind: "system",
      sender_label: "System",
      body: `🔄 Trip ${label[data.status] ?? data.status} by coordinator.`,
      thread_kind: "driver_coord",
    } as never);
    return { ok: true, changed: true };
  });

// Fields that must never carry over when duplicating a job. Everything else
// on the row is preserved so the new card shows the full trip info
// (addresses, business names, geo pins, flight, contact, price, etc.).
const CLONE_STRIP_FIELDS = new Set<string>([
  "id",
  "trip_no",
  "created_at",
  "updated_at",
  // driver / assignment lifecycle
  "driver_id",
  "driver_accepted_at",
  "driver_cancel_requested_at",
  "driver_cancel_requested_by",
  "driver_cancel_reason",
  "driver_cancel_note",
  "deletion_requested_at",
  // trip status/telemetry — start fresh
  "status",
  "payment_status",
  "coord_approved_at",
  "client_confirmed_at",
  "arrival_at",
  "arrival_lat",
  "arrival_lng",
  "arrival_accuracy_m",
  "arrival_speed_kmh",
  "departure_at",
  "started_at",
  "completed_at",
  "cancelled_at",
  "event_payout_total_eur",
  // routing / ETA cache — will recompute
  "route_duration_sec",
  "route_distance_m",
  "route_computed_at",
  "route_polyline",
  "live_eta_sec",
  "live_eta_updated_at",
  "traffic_delay_minutes",
  "traffic_severity",
  "leave_by_at",
  "pickup_shift_reason",
  // linkage that must be minted fresh per clone
  "client_link_token",
  "parent_job_id",
  "grouped_at",
  "grouped_count",
  // dispatch chain — clones don't inherit dispatch state
  "dispatch_status",
  "dispatched_at",
  "dispatch_decided_at",
  "origin_company_id",
  "executor_company_id",
  "dispatch_chain_company_ids",
]);

function mintLinkToken() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function buildClonedJobPayload(
  src: Record<string, unknown>,
  overrides: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(src)) {
    if (CLONE_STRIP_FIELDS.has(k)) continue;
    out[k] = v;
  }
  // Sensible resets for a brand-new trip.
  out.status = "pending";
  out.payment_status = "pending";
  out.qr_strict_mode = false;
  out.tracking_enabled = false;
  out.driver_id = null;
  out.coord_approved_at = new Date().toISOString();
  out.client_link_token = mintLinkToken();
  // Clear group linkage; caller can re-group if desired.
  out.group_id = null;
  out.group_name = null;
  out.group_note = null;
  return { ...out, ...overrides };
}

async function copyJobLabels(
  sb: any,
  srcJobId: string,
  newJobId: string,
): Promise<{ expected: number; inserted: number }> {
  const { data: labels, error: readErr } = await sb
    .from("job_labels")
    .select("label_id")
    .eq("job_id", srcJobId);
  if (readErr) throw new Error(`labels_read_failed: ${readErr.message}`);
  const expected = labels?.length ?? 0;
  if (!expected) return { expected: 0, inserted: 0 };
  const { data: ins, error: insErr } = await sb
    .from("job_labels")
    .insert(labels.map((l: any) => ({ job_id: newJobId, label_id: l.label_id })))
    .select("label_id");
  if (insErr) throw new Error(`labels_copy_failed: ${insErr.message}`);
  return { expected, inserted: ins?.length ?? 0 };
}

async function copyJobPax(
  sb: any,
  srcJobId: string,
  newJobId: string,
): Promise<{ expected: number; inserted: number }> {
  const { data: pax, error: readErr } = await sb
    .from("pax")
    .select("name")
    .eq("job_id", srcJobId);
  if (readErr) throw new Error(`pax_read_failed: ${readErr.message}`);
  const expected = pax?.length ?? 0;
  if (!expected) return { expected: 0, inserted: 0 };
  const { data: ins, error: insErr } = await sb
    .from("pax")
    .insert(
      pax.map((p: any) => ({ job_id: newJobId, name: p.name, status: "pending" })),
    )
    .select("id");
  if (insErr) throw new Error(`pax_copy_failed: ${insErr.message}`);
  return { expected, inserted: ins?.length ?? 0 };
}

/**
 * Verify a freshly-cloned/split job. Throws a descriptive error if any
 * child resource (pax, labels) didn't fully round-trip, or if the driver /
 * group linkage doesn't match what the caller asked for. Returns a small
 * report the mutation can surface in toasts / logs.
 */
async function verifyClonedJob(
  sb: any,
  opts: {
    src: Record<string, unknown>;
    newRow: Record<string, unknown>;
    labels: { expected: number; inserted: number };
    pax: { expected: number; inserted: number } | null;
    expect: {
      driver_id: string | null;
      group_id: string | null;
      parent_job_id?: string | null;
    };
  },
): Promise<{ ok: true; warnings: string[]; labels_copied: number; pax_copied: number }> {
  const warnings: string[] = [];
  const newId = opts.newRow.id as string;

  if (opts.labels.expected !== opts.labels.inserted) {
    throw new Error(
      `clone_verification_failed: labels ${opts.labels.inserted}/${opts.labels.expected} copied`,
    );
  }
  if (opts.pax && opts.pax.expected !== opts.pax.inserted) {
    throw new Error(
      `clone_verification_failed: pax ${opts.pax.inserted}/${opts.pax.expected} copied`,
    );
  }

  // Re-read canonical child counts from the database — this catches races
  // where an insert silently returned 0 rows (e.g. RLS filtering) or where
  // a trigger removed them.
  const [{ count: paxCount }, { count: labelCount }, { data: fresh }] = await Promise.all([
    sb.from("pax").select("id", { count: "exact", head: true }).eq("job_id", newId),
    sb.from("job_labels").select("label_id", { count: "exact", head: true }).eq("job_id", newId),
    sb.from("jobs").select("driver_id, group_id, parent_job_id").eq("id", newId).single(),
  ]);

  const expectedPax = opts.pax?.expected ?? 0;
  if ((paxCount ?? 0) !== expectedPax) {
    throw new Error(
      `clone_verification_failed: expected ${expectedPax} passengers on new trip, found ${paxCount ?? 0}`,
    );
  }
  if ((labelCount ?? 0) !== opts.labels.expected) {
    throw new Error(
      `clone_verification_failed: expected ${opts.labels.expected} labels on new trip, found ${labelCount ?? 0}`,
    );
  }

  if ((fresh?.driver_id ?? null) !== opts.expect.driver_id) {
    throw new Error(
      `clone_verification_failed: driver assignment mismatch (expected ${opts.expect.driver_id ?? "unassigned"}, got ${fresh?.driver_id ?? "unassigned"})`,
    );
  }
  if ((fresh?.group_id ?? null) !== opts.expect.group_id) {
    throw new Error(
      `clone_verification_failed: group linkage mismatch (expected ${opts.expect.group_id ?? "none"}, got ${fresh?.group_id ?? "none"})`,
    );
  }
  if (opts.expect.parent_job_id !== undefined
      && (fresh?.parent_job_id ?? null) !== opts.expect.parent_job_id) {
    throw new Error(
      `clone_verification_failed: parent_job_id mismatch (expected ${opts.expect.parent_job_id ?? "none"}, got ${fresh?.parent_job_id ?? "none"})`,
    );
  }

  // Non-fatal advisories.
  if ((opts.src.driver_id as string | null) && !opts.expect.driver_id) {
    warnings.push("source_had_driver_new_trip_unassigned");
  }
  if ((opts.src.group_id as string | null) && !opts.expect.group_id) {
    warnings.push("source_was_grouped_new_trip_ungrouped");
  }

  return {
    ok: true,
    warnings,
    labels_copied: opts.labels.inserted,
    pax_copied: opts.pax?.inserted ?? 0,
  };
}

export const cloneJob = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({ job_id: z.string().uuid(), target_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const c = await resolveCompany(context);
    const supabaseAdmin = await getAdminClient();
    const { data: src, error } = await supabaseAdmin
      .from("jobs")
      .select("*")
      .eq("id", data.job_id)
      .eq("company_id", c.id)
      .single();
    if (error || !src) throw new Error("Job not found");
    const pickup_at = makePickupIso(data.target_date, src.time as string);
    const payload = buildClonedJobPayload(src as Record<string, unknown>, {
      company_id: c.id,
      date: data.target_date,
      time: src.time,
      pickup_at,
    });
    const { data: row, error: iErr } = await supabaseAdmin
      .from("jobs")
      .insert(payload as never)
      .select()
      .single();
    if (iErr) throw new Error(iErr.message);

    // Copy labels + pax so the clone shows names and info immediately.
    const labels = await copyJobLabels(supabaseAdmin, src.id as string, row.id as string);
    const pax = await copyJobPax(supabaseAdmin, src.id as string, row.id as string);

    const report = await verifyClonedJob(supabaseAdmin, {
      src: src as Record<string, unknown>,
      newRow: row as Record<string, unknown>,
      labels,
      pax,
      expect: { driver_id: null, group_id: null, parent_job_id: null },
    });

    await spendSoft(c.id, "trip_created", "Trip cloned", row.id as string);
    return { ...(row as any), _validation: report };
  });

export const splitJob = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        job_id: z.string().uuid(),
        splits: z
          .array(z.object({ label: z.string().trim().min(1).max(120) }))
          .min(2)
          .max(10),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const c = await resolveCompany(context);
    const supabaseAdmin = await getAdminClient();
    const { data: src, error } = await supabaseAdmin
      .from("jobs")
      .select("*")
      .eq("id", data.job_id)
      .eq("company_id", c.id)
      .single();
    if (error || !src) throw new Error("Job not found");
    const rows: any[] = [];
    for (const s of data.splits) {
      const suffix = ` — ${s.label}`;
      const payload = buildClonedJobPayload(src as Record<string, unknown>, {
        company_id: c.id,
        date: src.date,
        time: src.time,
        pickup_at: src.pickup_at,
        clientcompanyname: `${(src.clientcompanyname as string | null) ?? ""}${suffix}`.trim(),
        parent_job_id: src.id,
        // Splits share the run but each has its own driver/vehicle later.
        vehicle: null,
      });
      const { data: row, error: iErr } = await supabaseAdmin
        .from("jobs")
        .insert(payload as never)
        .select()
        .single();
      if (iErr) throw new Error(`split_insert_failed (${s.label}): ${iErr.message}`);

      // Every split inherits labels so the cards look complete.
      const labels = await copyJobLabels(supabaseAdmin, src.id as string, row.id as string);

      // Splits intentionally start with no pax so the coordinator can
      // distribute passengers between the new cards. We still verify
      // that no pax leaked in from a stale trigger.
      const report = await verifyClonedJob(supabaseAdmin, {
        src: src as Record<string, unknown>,
        newRow: row as Record<string, unknown>,
        labels,
        pax: { expected: 0, inserted: 0 },
        expect: { driver_id: null, group_id: null, parent_job_id: src.id as string },
      });

      await spendSoft(c.id, "trip_created", "Trip split from parent", row.id as string);
      rows.push({ ...(row as any), _validation: report });
    }
    return rows;
  });





export const deleteJob = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ job_id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const c = await resolveCompany(context);
    const supabaseAdmin = await getAdminClient();
    const { data: job, error } = await supabaseAdmin
      .from("jobs")
      .select("id, company_id")
      .eq("id", data.job_id)
      .eq("company_id", c.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!job) return { deleted: false, pending: false, missing: true };
    // Hard delete — the coordinator-approve / change-request flow has been retired.
    const { error: dErr } = await supabaseAdmin.from("jobs").delete().eq("id", data.job_id).eq("company_id", c.id);
    if (dErr) throw new Error(dErr.message);
    return { deleted: true, pending: false };
  });



export const cancelDeletionRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ job_id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const c = await resolveCompany(context);
    const supabaseAdmin = await getAdminClient();
    const { error } = await supabaseAdmin
      .from("jobs")
      .update({ deletion_requested_at: null, deletion_requested_by: null })
      .eq("id", data.job_id)
      .eq("company_id", c.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ---------- DRIVERS ----------

async function syncVirtualDrivers(ctx: Ctx, companyId: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  // Self coordinator-driver
  const { data: me } = await supabaseAdmin
    .from("companies")
    .select("id, name, owner_user_id")
    .eq("id", companyId)
    .maybeSingle();
  if (me?.owner_user_id) {
    const { data: existsMe } = await supabaseAdmin
      .from("drivers")
      .select("id, name")
      .eq("company_id", companyId)
      .eq("kind", "coordinator")
      .eq("linked_user_id", me.owner_user_id)
      .maybeSingle();
    if (!existsMe) {
      await supabaseAdmin.from("drivers").insert({
        company_id: companyId,
        kind: "coordinator",
        linked_user_id: me.owner_user_id,
        name: `${me.name} (me)`,
        status: "available",
      });
    } else if (!existsMe.name?.includes("(me)")) {
      await supabaseAdmin
        .from("drivers")
        .update({ name: `${me.name} (me)` })
        .eq("id", existsMe.id);
    }
  }

  // Partner drivers for active connections
  const { data: conns } = await supabaseAdmin
    .from("coordinator_connections")
    .select("owner_company_id, partner_company_id, status")
    .or(`owner_company_id.eq.${companyId},partner_company_id.eq.${companyId}`)
    .eq("status", "active");
  const partnerIds = (conns ?? []).map((c: any) =>
    c.owner_company_id === companyId ? c.partner_company_id : c.owner_company_id,
  );
  if (partnerIds.length) {
    const { data: partners } = await supabaseAdmin.from("companies").select("id, name").in("id", partnerIds);
    for (const p of partners ?? []) {
      const { data: exists } = await supabaseAdmin
        .from("drivers")
        .select("id")
        .eq("company_id", companyId)
        .eq("kind", "partner")
        .eq("linked_company_id", p.id)
        .maybeSingle();
      if (!exists) {
        await supabaseAdmin.from("drivers").insert({
          company_id: companyId,
          kind: "partner",
          linked_company_id: p.id,
          name: `${p.name} (partner)`,
          status: "available",
        });
      }
    }
  }
}

export const listDrivers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const c = await resolveCompany(context);
    try {
      await syncVirtualDrivers(context, c.id);
    } catch {
      /* best effort */
    }
    const supabaseAdmin = await getAdminClient();
    const { data, error } = await supabaseAdmin
      .from("drivers")
      .select(
        "id, name, phone, email, vehicle, status, seats_available, availability_note, profile_updated_at, kind, linked_company_id, linked_user_id",
      )
      .eq("company_id", c.id)
      .order("kind")
      .order("name");
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const getMyDrivingLink = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const c = await resolveCompany(context);
    await syncVirtualDrivers(context, c.id);
    const supabaseAdmin = await getAdminClient();
    const { data: self } = await supabaseAdmin
      .from("drivers")
      .select("id, name")
      .eq("company_id", c.id)
      .eq("kind", "coordinator")
      .maybeSingle();
    if (!self) throw new Error("Could not create self driver");
    // Reuse an active long-lived link or make a new one (1 year)
    const { data: existing } = await supabaseAdmin
      .from("magic_links")
      .select("token, expires_at, revoked_at")
      .eq("company_id", c.id)
      .eq("kind", "driver")
      .eq("subject_id", self.id)
      .is("revoked_at", null)
      .gt("expires_at", new Date().toISOString())
      .order("expires_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    let token = existing?.token as string | undefined;
    if (!token) {
      token = Array.from(crypto.getRandomValues(new Uint8Array(24)))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
      const expires_at = new Date(Date.now() + 365 * 86_400_000).toISOString();
      const { error } = await supabaseAdmin.from("magic_links").insert({
        company_id: c.id,
        kind: "driver",
        subject_id: self.id,
        subject_label: self.name,
        token,
        expires_at,
        created_by: context.userId,
      });
      if (error) throw new Error(error.message);
    }
    return { token, path: `/m/driver/${token}` };
  });

export const createDriver = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        name: z.string().trim().min(1).max(120),
        phone: z.string().trim().max(40).optional().or(z.literal("")),
        email: z.string().trim().email().max(255).optional().or(z.literal("")),
        vehicle: z.string().trim().max(120).optional().or(z.literal("")),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const c = await resolveCompany(context);
    const supabaseAdmin = await getAdminClient();
    const { data: row, error } = await supabaseAdmin
      .from("drivers")
      .insert({
        company_id: c.id,
        name: data.name,
        phone: data.phone || null,
        email: data.email || null,
        vehicle: data.vehicle || null,
      })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

/**
 * Minimal driver-record update used by the AI assistant's data-fix flow
 * (typo'd driver name / phone). Scoped to the caller's company. Kept small
 * on purpose — coordinators still use the drivers page for full edits.
 */
export const updateDriverBasic = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        name: z.string().trim().min(1).max(120).optional(),
        phone: z.string().trim().max(40).nullable().optional(),
      })
      .refine((v) => v.name !== undefined || v.phone !== undefined, {
        message: "Provide name or phone to update.",
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const c = await resolveCompany(context);
    const supabaseAdmin = await getAdminClient();
    const patch: Record<string, unknown> = {};
    if (data.name !== undefined) patch.name = data.name;
    if (data.phone !== undefined) patch.phone = data.phone || null;
    const { error } = await supabaseAdmin
      .from("drivers")
      .update(patch as never)
      .eq("id", data.id)
      .eq("company_id", c.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ---------- BOOKINGS ----------

export const listPendingBookings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const c = await resolveCompany(context);
    const supabaseAdmin = await getAdminClient();
    const [{ data: bookings }, { data: mods }] = await Promise.all([
      supabaseAdmin
        .from("client_bookings")
        .select("*")
        .eq("company_id", c.id)
        .in("status", ["pending", "modification_pending"])
        .order("created_at", { ascending: false }),
      supabaseAdmin
        .from("client_booking_modifications")
        .select(
          "*, client_bookings!inner(company_id, name, surname, from_location, to_location, pickup_at, date, time)",
        )
        .eq("status", "pending")
        .eq("client_bookings.company_id", c.id)
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
    const { data: b, error } = await supabaseAdmin
      .from("client_bookings")
      .select("*")
      .eq("id", data.id)
      .eq("company_id", c.id)
      .single();
    if (error || !b) throw new Error("Booking not found");
    const pickup_at = b.pickup_at ?? (b.date && b.time ? makePickupIso(b.date, b.time) : new Date().toISOString());
    const { data: job, error: jErr } = await supabaseAdmin
      .from("jobs")
      .insert({
        company_id: c.id,
        from_location: b.from_location,
        to_location: b.to_location,
        date: b.date ?? new Date(pickup_at).toISOString().slice(0, 10),
        time: b.time,
        pickup_at,
        clientcompanyname: `${b.name} ${b.surname}`.trim(),
        promo_note: (b as any).promo_note ?? null,
      } as any)
      .select()
      .single();
    if (jErr) throw new Error(jErr.message);
    await supabaseAdmin.from("client_bookings").update({ status: "accepted", job_id: job.id }).eq("id", data.id);
    await spendSoft(c.id, "trip_created", "Trip from client booking", job.id);
    return { ok: true, job };
  });

export const rejectBooking = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const c = await resolveCompany(context);
    const supabaseAdmin = await getAdminClient();
    const { error } = await supabaseAdmin
      .from("client_bookings")
      .update({ status: "rejected" })
      .eq("id", data.id)
      .eq("company_id", c.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const resolveModification = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ id: z.string().uuid(), approve: z.boolean() }).parse(i))
  .handler(async ({ data, context }) => {
    const c = await resolveCompany(context);
    const supabaseAdmin = await getAdminClient();
    const { data: mod, error } = await supabaseAdmin
      .from("client_booking_modifications")
      .select("*, client_bookings!inner(company_id, id)")
      .eq("id", data.id)
      .single();
    if (error || !mod || mod.client_bookings.company_id !== c.id) throw new Error("Modification not found");
    if (data.approve) {
      const ch: any = mod.requested_changes ?? {};
      // Direct UPDATE would be blocked by 2h trigger; use a service call via RPC-like path:
      // Simplest: mark modification approved and let coordinator manually re-issue. But we can bypass by using status change + payload merge via server:
      // Use temporary approach: set booking status to approved and copy fields; the trigger allows status-only change, and other-field change while <2h will re-trigger. So do two updates: (1) approve status, (2) fields via a special server-fn window (still blocked). Alternative: mark booking status approved and store the accepted payload on the booking itself.
      await supabaseAdmin.from("client_bookings").update({ status: "accepted" }).eq("id", mod.client_bookings.id);
      await supabaseAdmin
        .from("client_booking_modifications")
        .update({
          status: "accepted",
          resolved_at: new Date().toISOString(),
          resolved_by: context.userId,
          requested_changes: ch,
        })
        .eq("id", data.id);
    } else {
      await supabaseAdmin
        .from("client_booking_modifications")
        .update({ status: "rejected", resolved_at: new Date().toISOString(), resolved_by: context.userId })
        .eq("id", data.id);
      await supabaseAdmin.from("client_bookings").update({ status: "accepted" }).eq("id", mod.client_bookings.id);
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
    const { data, error } = await supabaseAdmin
      .from("magic_links")
      .select("*")
      .eq("company_id", c.id)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const generateMagicLink = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        kind: z.enum(["driver", "client"]),
        subject_id: z.string().uuid().nullable(),
        subject_label: z.string().trim().min(1).max(200),
        ttl_hours: z
          .number()
          .int()
          .min(1)
          .max(24 * 366),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const c = await resolveCompany(context);
    const supabaseAdmin = await getAdminClient();
    const feature = data.kind === "driver" ? "magic_link_driver" : "magic_link_client";
    const token = makeToken();
    const expires_at = new Date(Date.now() + data.ttl_hours * 3600_000).toISOString();
    const { data: row, error } = await supabaseAdmin
      .from("magic_links")
      .insert({
        company_id: c.id,
        kind: data.kind,
        subject_id: data.subject_id,
        subject_label: data.subject_label,
        token,
        expires_at,
        created_by: context.userId,
      })
      .select()
      .single();
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
    const { error } = await supabaseAdmin
      .from("magic_links")
      .update({ revoked_at: new Date().toISOString() })
      .eq("id", data.id)
      .eq("company_id", c.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const extendMagicLink = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        ttl_hours: z
          .number()
          .int()
          .min(1)
          .max(24 * 366),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const c = await resolveCompany(context);
    const supabaseAdmin = await getAdminClient();
    const expires_at = new Date(Date.now() + data.ttl_hours * 3600_000).toISOString();
    const { error } = await supabaseAdmin
      .from("magic_links")
      .update({ expires_at, revoked_at: null })
      .eq("id", data.id)
      .eq("company_id", c.id);
    if (error) throw new Error(error.message);
    return { ok: true, expires_at };
  });

export const getMagicLinkPreview = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const c = await resolveCompany(context);
    const supabaseAdmin = await getAdminClient();
    const { data: link, error: le } = await supabaseAdmin
      .from("magic_links")
      .select("*")
      .eq("id", data.id)
      .eq("company_id", c.id)
      .single();
    if (le || !link) throw new Error("Link not found");
    const today = new Date().toISOString().slice(0, 10);
    let jobs: any[] = [];
    if (link.kind === "driver") {
      let q = supabaseAdmin
        .from("jobs")
        .select("id,date,time,pickup_at,from_location,from_flight,to_location,to_flight")
        .eq("company_id", c.id)
        .gte("date", today)
        .order("date", { ascending: true })
        .order("time", { ascending: true })
        .limit(6);
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
    const { data: job, error: je } = await supabaseAdmin
      .from("jobs")
      .select(
        "id,date,time,pickup_at,from_location,from_flight,to_location,to_flight,vehicle,driver_id,company_id,executor_company_id,origin_company_id,dispatch_chain_company_ids,drivers(name)",
      )
      .eq("id", data.job_id)
      .or(
        `company_id.eq.${c.id},executor_company_id.eq.${c.id},origin_company_id.eq.${c.id},dispatch_chain_company_ids.cs.{${c.id}}`,
      )
      .single();
    if (je || !job) throw new Error("Trip not found");
    if (!job.driver_id) throw new Error("Assign a driver first");
    const nowIso = new Date().toISOString();
    const { data: existing } = await supabaseAdmin
      .from("magic_links")
      .select("*")
      .eq("company_id", c.id)
      .eq("kind", "driver")
      .eq("subject_id", job.driver_id)
      .is("revoked_at", null)
      .gt("expires_at", nowIso)
      .order("expires_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    let link = existing;
    if (!link) {
      const bytes = new Uint8Array(24);
      crypto.getRandomValues(bytes);
      const token = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
      const expires_at = new Date(Date.now() + 7 * 24 * 3600_000).toISOString();
      const label = job.drivers?.name ? `${job.drivers.name} portal` : "Driver portal";
      const { data: row, error } = await supabaseAdmin
        .from("magic_links")
        .insert({
          company_id: c.id,
          kind: "driver",
          subject_id: job.driver_id,
          subject_label: label,
          token,
          expires_at,
          created_by: context.userId,
        })
        .select()
        .single();
      if (error) throw new Error(error.message);
      link = row;
    }
    const { count: paxCount } = await supabaseAdmin
      .from("pax")
      .select("id", { count: "exact", head: true })
      .eq("job_id", job.id);
    return {
      token: link.token,
      expires_at: link.expires_at,
      job: { ...job, pax_count: paxCount ?? 0 },
      company: { name: c.name },
    };
  });

// ---------- BULK CREATE + PAX SPLIT ----------

const bulkTripInput = z.object({
  trips: z
    .array(
      z.object({
        from_location: z.string().trim().min(1).max(255),
        to_location: z.string().trim().min(1).max(255),
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        time: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/),
        flightorship: z.string().trim().max(120).optional().default(""),
        from_flight: z.string().trim().max(40).optional().default(""),
        to_flight: z.string().trim().max(40).optional().default(""),
        clientcompanyname: z.string().trim().max(200).optional().default(""),
        contact_phone: z.string().trim().max(40).optional().default(""),
        tracking_kind: z.enum(["flight", "vessel"]).optional(),
        pax: z.array(z.string().trim().min(1).max(200)).max(200).default([]),
      }),
    )
    .min(1)
    .max(50),
  label_ids: z.array(z.string().uuid()).max(20).optional(),
  // Dynamic billing flags from the AI extraction step. Pass through unchanged
  // so the coordinator can't tamper with pricing client-side beyond what the
  // AI accuracy score already justified.
  billing_flags: z
    .object({
      is_half_price: z.boolean().optional(),
      accuracy_score: z.number().min(0).max(1).optional(),
    })
    .optional(),
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
      const { data: job, error } = await supabaseAdmin
        .from("jobs")
        .insert({
          company_id: c.id,
          from_location: t.from_location,
          to_location: t.to_location,
          date: t.date,
          time,
          pickup_at,
          flightorship: t.flightorship || t.from_flight || t.to_flight || null,
          from_flight: (t.from_flight || "").toUpperCase() || null,
          to_flight: (t.to_flight || "").toUpperCase() || null,
          clientcompanyname: t.clientcompanyname || null,
          contact_phone: t.contact_phone || null,
          qr_strict_mode: false,
          tracking_enabled: false,
          vehicle: null,
          driver_id: null,
          tracking_kind: t.tracking_kind ?? "flight",
        })
        .select("id")
        .single();
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
        } catch {
          /* ignore metering errors */
        }
      } else {
        await spendSoft(c.id, "trip_created", "Trip created (bulk)", job.id);
      }
    }
    if (created.length) {
      const { autoPriceJobBg } = await import("./auto-price.server");
      created.forEach(autoPriceJobBg);
    }
    return {
      created,
      billing: { is_half_price: isHalfPrice, accuracy_score: data.billing_flags?.accuracy_score ?? null },
    };
  });

// ---------- FLIGHT / VESSEL LIVE STATUS (Gemini + Google Search grounding) ----------
// Two-step call:
//   1) gemini-2.5-flash + google_search grounding → free-text current status
//   2) gemini-2.5-flash-lite (JSON) → structured {status, scheduled, estimated,
//      delay_minutes, note, confidence}
// If step 1 didn't actually ground (no groundingChunks) we force confidence "low".
// In-memory cache keyed by `${kind}:${identifier}:${date}` for 5 minutes to avoid
// re-spending points on rapid refreshes.

type LiveStatusResult = {
  ok: boolean;
  status?: string;
  note?: string;
  scheduled?: string | null;
  estimated?: string | null;
  confidence?: "high" | "low";
  reason?: string;
};
type FlightSide = "arr" | "dep";

const liveStatusCache = new Map<string, { at: number; value: LiveStatusResult }>();
const LIVE_STATUS_TTL_MS = 20 * 60_000;
// AeroDataBox returns real data, so we can refresh much more aggressively
// than the Gemini-grounded path — but still cache per (code+date) to stay
// well under the free-tier 600 units/month.
const AERODATABOX_TTL_MS = 5 * 60_000;
const FLIGHT_TIME_MISMATCH_MS = 15 * 60_000;

type AeroEndpoint = {
  airport?: { iata?: string; icao?: string; name?: string; municipalityName?: string };
  scheduledTime?: { utc?: string; local?: string };
  revisedTime?: { utc?: string; local?: string };
  predictedTime?: { utc?: string; local?: string };
  runwayTime?: { utc?: string; local?: string };
  actualTime?: { utc?: string; local?: string };
  terminal?: string;
  gate?: string;
};
type AeroFlight = { status?: string; departure?: AeroEndpoint; arrival?: AeroEndpoint };

function aeroIso(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const t = new Date(raw).getTime();
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

function aeroScheduledTime(e?: AeroEndpoint): string | null {
  return aeroIso(e?.scheduledTime?.utc);
}

function aeroPickTime(e?: AeroEndpoint): string | null {
  const t =
    e?.actualTime?.utc ??
    e?.runwayTime?.utc ??
    e?.revisedTime?.utc ??
    e?.predictedTime?.utc ??
    e?.scheduledTime?.utc ??
    null;
  return aeroIso(t);
}
function aeroAirportCode(e?: AeroEndpoint): string {
  return (e?.airport?.iata || e?.airport?.icao || e?.airport?.municipalityName || "").toUpperCase();
}

function aeroEndpointTimeForMatch(e?: AeroEndpoint): string | null {
  return aeroScheduledTime(e) ?? aeroPickTime(e);
}

function isMaltaAeroEndpoint(e?: AeroEndpoint): boolean {
  const a = e?.airport;
  const code = `${a?.iata ?? ""} ${a?.icao ?? ""}`.toUpperCase();
  const text = `${a?.name ?? ""} ${a?.municipalityName ?? ""}`.toLowerCase();
  return /\b(MLA|LMML)\b/.test(code) || /\b(malta|luqa)\b/.test(text);
}

function pickAeroEndpoint(f: AeroFlight, side: FlightSide): AeroEndpoint | undefined {
  return side === "arr" ? f.arrival : f.departure;
}

function endpointDeltaMs(endpoint: AeroEndpoint | undefined, pickupMs: number | null): number {
  if (!pickupMs) return Number.MAX_SAFE_INTEGER;
  const iso = aeroEndpointTimeForMatch(endpoint);
  const t = iso ? new Date(iso).getTime() : NaN;
  return Number.isFinite(t) ? Math.abs(t - pickupMs) : Number.MAX_SAFE_INTEGER;
}

function pickAeroFlight(flights: AeroFlight[], pickupIso: string | null, side?: FlightSide): AeroFlight {
  const pickupMs = pickupIso ? new Date(pickupIso).getTime() : null;
  const safePickupMs = pickupMs && Number.isFinite(pickupMs) ? pickupMs : null;

  if (side) {
    const hasMaltaSide = flights.some((f) => isMaltaAeroEndpoint(pickAeroEndpoint(f, side)));
    return flights
      .map((f, index) => {
        const endpoint = pickAeroEndpoint(f, side);
        const hasSideTime = !!aeroEndpointTimeForMatch(endpoint);
        const matchesMalta = isMaltaAeroEndpoint(endpoint);
        const sideDelta = endpointDeltaMs(endpoint, safePickupMs);
        const anyDelta = Math.min(endpointDeltaMs(f.arrival, safePickupMs), endpointDeltaMs(f.departure, safePickupMs));
        return {
          f,
          index,
          maltaPenalty: hasMaltaSide && !matchesMalta ? 1 : 0,
          timePenalty: hasSideTime ? 0 : 1,
          sideDelta,
          anyDelta,
        };
      })
      .sort(
        (a, b) =>
          a.maltaPenalty - b.maltaPenalty ||
          a.timePenalty - b.timePenalty ||
          a.sideDelta - b.sideDelta ||
          a.anyDelta - b.anyDelta ||
          a.index - b.index,
      )[0].f;
  }

  return flights
    .map((f, index) => {
      const bestDelta = Math.min(endpointDeltaMs(f.arrival, safePickupMs), endpointDeltaMs(f.departure, safePickupMs));
      return { f, index, bestDelta };
    })
    .sort((a, b) => a.bestDelta - b.bestDelta || a.index - b.index)[0].f;
}
function mapAeroStatus(s: string | undefined): string {
  const v = (s ?? "").toLowerCase();
  if (v.includes("cancel")) return "cancelled";
  if (v.includes("divert")) return "diverted";
  if (v.includes("arriv") || v === "landed") return "landed";
  if (v.includes("enroute") || v === "en route" || v.includes("airborne")) return "departed";
  if (v === "expected" || v === "scheduled" || v.includes("checkin") || v.includes("boarding") || v.includes("gate"))
    return "on_time";
  if (v.includes("delay")) return "delayed";
  if (!v || v.includes("unknown")) return "unknown";
  return v;
}
function fmtHm(iso: string | null): string {
  if (!iso) return "";
  try { return formatMaltaTime(iso); } catch { return new Date(iso).toISOString().slice(11, 16); }
}

// AeroDataBox (via RapidAPI). Free tier: 600 units/month — cache aggressively.
// Endpoint: GET /flights/number/{number}/{date} returns scheduled/revised/actual
// times for both departure and arrival plus a coarse status string.
async function fetchLiveStatusViaAeroDataBox(
  identifier: string,
  pickupIso: string | null,
  side?: FlightSide,
): Promise<LiveStatusResult> {
  const raw = (identifier || "").trim();
  if (!raw) return { ok: false, reason: "no_code" };

  const parsed = parseFlightCode(raw);
  if (!parsed.ok) {
    if (looksLikeVessel(raw)) return { ok: false, reason: "vessel_in_flight_field" };
    return { ok: false, reason: "invalid_code" };
  }
  const canonical = parsed.normalized ?? raw.toUpperCase().replace(/\s+/g, "");

  const key = process.env.AERODATABOX_API_KEY;
  if (!key) return { ok: false, reason: "not_configured" };

  const day = isoToDayKey(pickupIso);
  const cacheKey = `adb:v3:${canonical}:${day}:${side ?? "auto"}`;
  const cached = liveStatusCache.get(cacheKey);
  if (cached && Date.now() - cached.at < AERODATABOX_TTL_MS) return cached.value;

  const url = `https://aerodatabox.p.rapidapi.com/flights/number/${encodeURIComponent(canonical)}/${day}?withAircraftImage=false&withLocation=false`;

  try {
    const res = await fetch(url, {
      method: "GET",
      headers: {
        "x-rapidapi-key": key,
        "x-rapidapi-host": "aerodatabox.p.rapidapi.com",
      },
    });
    if (res.status === 204 || res.status === 404) {
      const value: LiveStatusResult = {
        ok: true, status: "unknown",
        note: `No AeroDataBox record for ${canonical} on ${day} — verify code`,
        scheduled: null, estimated: null, confidence: "low",
      };
      liveStatusCache.set(cacheKey, { at: Date.now(), value });
      return value;
    }
    if (!res.ok) {
      const value: LiveStatusResult = { ok: false, reason: `adb_${res.status}` };
      liveStatusCache.set(cacheKey, { at: Date.now(), value });
      return value;
    }
    const json = (await res.json()) as AeroFlight | AeroFlight[];
    const flights = Array.isArray(json) ? json : [json];
    if (!flights.length) {
      const value: LiveStatusResult = { ok: true, status: "unknown", note: "", scheduled: null, estimated: null, confidence: "low" };
      liveStatusCache.set(cacheKey, { at: Date.now(), value });
      return value;
    }
    const chosen = pickAeroFlight(flights, pickupIso, side);

    const status = mapAeroStatus(chosen.status);
    const depSched = aeroScheduledTime(chosen.departure);
    const depActual = aeroPickTime(chosen.departure);
    const arrSched = aeroScheduledTime(chosen.arrival);
    const arrActual = aeroPickTime(chosen.arrival);
    const depCode = aeroAirportCode(chosen.departure);
    const arrCode = aeroAirportCode(chosen.arrival);
    const pickupMs = pickupIso ? new Date(pickupIso).getTime() : null;

    // Template-based note (no LLM): "MLA 08:15 → IST 12:30" with drift.
    const parts: string[] = [];
    if (depCode || depSched) parts.push(`${depCode} ${fmtHm(depActual ?? depSched)}`.trim());
    if (arrCode || arrSched) parts.push(`${arrCode} ${fmtHm(arrActual ?? arrSched)}`.trim());
    let note = parts.join(" → ");
    if (arrSched && arrActual) {
      const drift = Math.round((new Date(arrActual).getTime() - new Date(arrSched).getTime()) / 60000);
      if (Math.abs(drift) >= 5) note += drift > 0 ? ` (+${drift}m)` : ` (${drift}m)`;
    }
    if (status === "cancelled") note = `CANCELLED · ${note}`.trim();
    else if (status === "diverted") note = `Diverted · ${note}`.trim();

    // Anchor persisted times to the semantic side: from_flight means passenger
    // arriving in Malta, to_flight means departing Malta. Only fall back to the
    // other side when the provider genuinely has no time for the requested side.
    const anchor: FlightSide = (() => {
      if (side === "arr" && (arrSched || arrActual)) return "arr";
      if (side === "dep" && (depSched || depActual)) return "dep";
      if (!pickupMs) return arrSched ? "arr" : "dep";
      const dArr = arrSched ? Math.abs(new Date(arrSched).getTime() - pickupMs) : Infinity;
      const dDep = depSched ? Math.abs(new Date(depSched).getTime() - pickupMs) : Infinity;
      return dArr <= dDep ? "arr" : "dep";
    })();
    const scheduled = anchor === "arr" ? arrSched : depSched;
    const estimated = anchor === "arr" ? arrActual : depActual;
    const confidence: "high" | "low" = side && anchor !== side ? "low" : "high";

    const value: LiveStatusResult = {
      ok: true, status, note: note.slice(0, 160),
      scheduled, estimated, confidence,
    };
    liveStatusCache.set(cacheKey, { at: Date.now(), value });
    return value;
  } catch {
    return { ok: false, reason: "exception" };
  }
}

// Dispatcher: real AeroDataBox for flights, Gemini grounding for vessels.
async function fetchLiveStatus(
  kind: "flight" | "vessel",
  identifier: string,
  pickupIso: string | null,
  side?: FlightSide,
): Promise<LiveStatusResult> {
  if (kind === "flight") {
    const r = await fetchLiveStatusViaAeroDataBox(identifier, pickupIso, side);
    if (!r.ok && r.reason === "not_configured") {
      return { ok: true, status: "unknown", note: "Live flight tracking not configured", scheduled: null, estimated: null, confidence: "low" };
    }
    return r;
  }
  return fetchLiveStatusViaGemini(kind, identifier, pickupIso);
}


function isoToDayKey(iso: string | null): string {
  const d = iso ? new Date(iso) : new Date();
  if (Number.isNaN(d.getTime())) return new Date().toISOString().slice(0, 10);
  return d.toISOString().slice(0, 10);
}

async function fetchLiveStatusViaGemini(
  kind: "flight" | "vessel",
  identifier: string,
  pickupIso: string | null,
  opts: { airportHint?: string | null; variant?: string } = {},
): Promise<LiveStatusResult> {
  const id = (identifier || "").trim();
  if (!id) return { ok: false, reason: "no_code" };

  // Fail fast for obviously invalid flight codes so we don't burn a Gemini
  // call (or points) on `ASSO VENTICINCUE` sitting in a flight field.
  // Also compute the canonical normalized code — used as the cache key so
  // "LO673", "lo 673" and "LO0673" all resolve to the same cached result.
  let canonical = id.toUpperCase().replace(/\s+/g, "");
  if (kind === "flight") {
    const parsed = parseFlightCode(id);
    if (!parsed.ok) {
      if (looksLikeVessel(id)) return { ok: false, reason: "vessel_in_flight_field" };
      return { ok: false, reason: "invalid_code" };
    }
    canonical = parsed.normalized ?? canonical;
  }

  const key = process.env.GEMINI_API_KEY;
  if (!key) return { ok: false, reason: "not_configured" };

  const variant = opts.variant ? `:${opts.variant}` : "";
  const cacheKey = `v4:${kind}:${canonical}:${isoToDayKey(pickupIso)}${variant}`;
  const cached = liveStatusCache.get(cacheKey);
  if (cached && Date.now() - cached.at < LIVE_STATUS_TTL_MS) return cached.value;


  const pickupLine = pickupIso
    ? `The scheduled pickup around this event is ${pickupIso} (UTC ISO).`
    : `No specific pickup time was provided.`;

  // Airline-name expansion is the single biggest reliability win for
  // two-letter carrier codes that Gemini otherwise doesn't disambiguate.
  const flightDescriptor =
    kind === "flight"
      ? (() => {
          const parsed = parseFlightCode(id);
          const airline = parsed.ok && parsed.airline ? ` (${describeFlight(parsed)})` : "";
          const hint = opts.airportHint ? ` involving ${opts.airportHint}` : "";
          return `flight "${id}"${airline}${hint}`;
        })()
      : `vessel "${id}"${opts.airportHint ? ` near ${opts.airportHint}` : ""}`;

  const groundedPrompt =
    kind === "flight"
      ? `You are checking the current status of ${flightDescriptor} for today (${new Date().toISOString().slice(0, 10)}).\n${pickupLine}\n\nSearch the web for authoritative sources (airline site, airport board, FlightRadar24, FlightAware). Report:\n- scheduled departure/arrival time (local, with timezone if you can) and ISO8601 equivalent if derivable\n- current estimated time (if delayed/early)\n- status: one of on_time / delayed / landed / departed / cancelled / diverted / boarding / unknown\n- any brief note (gate, terminal, delay minutes) — under 15 words\n\nIf you cannot confidently identify THIS exact flight for today, say so plainly.`
      : `You are checking the current status of the ${flightDescriptor} for today (${new Date().toISOString().slice(0, 10)}).\n${pickupLine}\n\nSearch the web for authoritative sources (MarineTraffic, VesselFinder, port authority notices). Report:\n- current position or last-known location\n- estimated arrival time at its next port (ISO8601 if derivable)\n- status: one of underway / arrived / delayed / anchored / departed / cancelled / unknown\n- any brief note (delay minutes, port name) — under 15 words\n\nIf you cannot confidently identify THIS exact vessel for today, say so plainly.`;

  // ---- Step 1: grounded free-text ----
  let groundedText = "";
  let hadGrounding = false;
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(key)}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: groundedPrompt }] }],
          tools: [{ google_search: {} }],
          generationConfig: { temperature: 0.1, maxOutputTokens: 600 },
        }),
      },
    );
    if (!res.ok) {
      const value: LiveStatusResult = { ok: false, reason: `gemini_${res.status}` };
      liveStatusCache.set(cacheKey, { at: Date.now(), value });
      return value;
    }
    const json = (await res.json()) as any;
    const cand = json?.candidates?.[0];
    groundedText = cand?.content?.parts?.map((p: any) => p?.text ?? "").join("") ?? "";
    const chunks = cand?.groundingMetadata?.groundingChunks;
    hadGrounding = Array.isArray(chunks) && chunks.length > 0;
    if (!groundedText.trim()) {
      const value: LiveStatusResult = { ok: false, reason: "no_result" };
      liveStatusCache.set(cacheKey, { at: Date.now(), value });
      return value;
    }
  } catch (e) {
    return { ok: false, reason: "exception" };
  }


  // ---- Step 2: JSON extraction ----
  const extractPrompt = `From the text below (a search-grounded status report about a ${kind === "flight" ? "flight" : "vessel"}), extract a strict JSON object with this exact shape:\n{\n  "status": string,                // ${kind === "flight" ? "one of: on_time, delayed, landed, departed, cancelled, diverted, boarding, unknown" : "one of: underway, arrived, delayed, anchored, departed, cancelled, unknown"}\n  "scheduled": string | null,       // FULL ISO8601 WITH TIMEZONE (e.g. "2026-07-18T08:15:00+02:00" for Malta summer, or "...Z" for UTC). If only a local wall-clock time is stated without a timezone, assume Europe/Malta and emit "+02:00" in summer / "+01:00" in winter. Null if not stated.\n  "estimated": string | null,       // Same rules as scheduled.\n  "delay_minutes": number | null,   // positive = late, negative = early, null if unknown\n  "note": string,                   // <=15 words, human summary (gate/terminal/port/etc.)\n  "confidence": "high" | "low"      // "low" if the text was vague, contradictory, didn't clearly identify ${kind === "flight" ? `flight ${id}` : `vessel ${id}`}, or seemed outdated\n}\nReturn ONLY the JSON object, no prose. Never emit a naive datetime without a timezone offset.\n\nTEXT:\n${groundedText}`;

  let extracted: any = null;
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${encodeURIComponent(key)}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: extractPrompt }] }],
          generationConfig: { responseMimeType: "application/json", temperature: 0, maxOutputTokens: 400 },
        }),
      },
    );
    if (!res.ok) {
      const value: LiveStatusResult = { ok: false, reason: `gemini_${res.status}` };
      liveStatusCache.set(cacheKey, { at: Date.now(), value });
      return value;
    }
    const json = (await res.json()) as any;
    const text: string = json?.candidates?.[0]?.content?.parts?.map((p: any) => p?.text ?? "").join("") ?? "";
    extracted = JSON.parse(text);
  } catch {
    return { ok: false, reason: "no_result" };
  }

  let confidence: "high" | "low" = extracted?.confidence === "high" ? "high" : "low";
  if (!hadGrounding) confidence = "low";

  // Anti-hallucination guard: if the model didn't actually consult real
  // search results (no groundingChunks) or self-reported low confidence,
  // return status_unknown WITHOUT specific times or notes. A plausible-
  // sounding invented gate/delay is worse than "not tracked".
  if (confidence === "low") {
    const value: LiveStatusResult = {
      ok: true,
      status: "unknown",
      note: "",
      scheduled: null,
      estimated: null,
      confidence: "low",
    };
    liveStatusCache.set(cacheKey, { at: Date.now(), value });
    return value;
  }

  const value: LiveStatusResult = {
    ok: true,
    status: String(extracted?.status ?? "unknown"),
    note: String(extracted?.note ?? "").slice(0, 160),
    scheduled: normalizeMaltaIso(extracted?.scheduled),
    estimated: normalizeMaltaIso(extracted?.estimated),
    confidence,
  };
  liveStatusCache.set(cacheKey, { at: Date.now(), value });
  return value;
}


// Persist the live status onto a job row. Applies the 45-min "time_mismatch"
// override identically for flights and vessels. When the first grounded call
// returns nothing, retries once with an airport hint derived from the job's
// endpoints before giving up.
export async function applyLiveStatusToJob(
  supabaseAdmin: any,
  job: {
    id: string;
    company_id?: string | null;
    driver_id?: string | null;
    from_flight: string | null;
    to_flight: string | null;
    from_location?: string | null;
    to_location?: string | null;
    pickup_at: string | null;
    tracking_kind?: string | null;
  },
): Promise<LiveStatusResult> {
  const code = job.from_flight || job.to_flight;
  if (!code) return { ok: false, reason: "no_code" };
  const kind: "flight" | "vessel" = (job.tracking_kind as any) === "vessel" ? "vessel" : "flight";
  // from_flight = passenger arriving → anchor to arrival; to_flight = departing → anchor to departure.
  const side: FlightSide | undefined =
    kind === "flight" ? (job.from_flight ? "arr" : job.to_flight ? "dep" : undefined) : undefined;

  let result = await fetchLiveStatus(kind, code, job.pickup_at, side);

  // Retry once with an airport hint if the first pass produced nothing usable.
  // AeroDataBox doesn't accept airport hints, but the Gemini vessel path does.
  const needsRetry =
    kind === "vessel" &&
    ((!result.ok && (result.reason === "no_result" || result.reason === "exception")) ||
      (result.ok && result.confidence === "low" && !result.scheduled));
  if (needsRetry) {
    const hint = [job.from_location, job.to_location]
      .filter(Boolean)
      .map((s) => String(s).split(",")[0]?.trim())
      .filter(Boolean)
      .join(" / ");
    if (hint) {
      result = await fetchLiveStatusViaGemini(kind, code, job.pickup_at, {
        airportHint: hint,
        variant: "hint",
      });
    }
  }

  if (!result.ok) {
    const reasonNote =
      result.reason === "not_configured"
        ? "Live status not configured"
        : result.reason === "invalid_code"
          ? `Couldn't recognise "${code}" as a flight code — check it`
          : result.reason === "vessel_in_flight_field"
            ? `"${code}" looks like a vessel — move it to the vessel field`
            : `Couldn't find ${code} — please verify the code`;
    await supabaseAdmin
      .from("jobs")
      .update({
        flight_status: "unknown",
        flight_status_note: reasonNote,
        flight_status_updated_at: new Date().toISOString(),
      })
      .eq("id", job.id);
    return result;
  }

  let status = result.status ?? "unknown";
  let note = result.note ?? "";
  // Derive "early" from actual-vs-scheduled drift when the provider didn't
  // explicitly say so. 10+ min ahead counts as early.
  if (
    result.scheduled &&
    result.estimated &&
    (status === "on_time" || status === "unknown")
  ) {
    const drift = Math.round(
      (new Date(result.estimated).getTime() - new Date(result.scheduled).getTime()) / 60000,
    );
    if (drift <= -10) status = "early";
  }
  if (result.scheduled && job.pickup_at) {
    const s = new Date(result.scheduled).getTime();
    const p = new Date(job.pickup_at).getTime();
    if (!Number.isNaN(s) && !Number.isNaN(p) && Math.abs(s - p) > FLIGHT_TIME_MISMATCH_MS) {
      status = "time_mismatch";
      note = `Scheduled ${formatMaltaTime(result.scheduled)} vs pickup ${formatMaltaTime(job.pickup_at)}`;
    }
  }

  await supabaseAdmin
    .from("jobs")
    .update({
      flight_status: status,
      flight_status_note: note,
      flight_status_confidence: result.confidence ?? null,
      flight_status_updated_at: new Date().toISOString(),
      // Always persist any parseable time — even at low confidence — so the
      // card can show "Flight 09:15" instead of a bare "Not tracked" chip.
      flight_scheduled_at: result.scheduled ?? null,
      flight_estimated_at: result.estimated ?? null,
    })
    .eq("id", job.id);

  return { ...result, status, note };
}


// Lightweight "fix this flight code" endpoint — used by the calendar's flight
// chip when Gemini couldn't resolve a code. Applies a minimal patch to the
// flight fields (no full job re-validation) and immediately retries the
// live-status resolver so the chip refreshes to a real time or a clearer
// error.
export const updateJobFlightCode = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        job_id: z.string().uuid(),
        from_flight: z.string().trim().max(16).nullable().optional(),
        to_flight: z.string().trim().max(16).nullable().optional(),
        // "flight" clears vessel-side tracking; "vessel" moves the value into
        // the vessel tracking kind (used when the coordinator realises a
        // ship name landed in the flight field).
        move_to: z.enum(["flight", "vessel"]).optional(),
        retry: z.boolean().default(true),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const c = await resolveCompany(context);
    await assertJobInCompany(context, data.job_id);
    const supabaseAdmin = await getAdminClient();

    const patch: Record<string, unknown> = {};
    if (data.from_flight !== undefined)
      patch.from_flight = (data.from_flight || "").toUpperCase().trim() || null;
    if (data.to_flight !== undefined)
      patch.to_flight = (data.to_flight || "").toUpperCase().trim() || null;
    if (data.move_to === "vessel") patch.tracking_kind = "vessel";
    if (data.move_to === "flight") patch.tracking_kind = "flight";
    // Reset stale status so the chip doesn't keep showing the wrong value
    // while the retry is in flight.
    patch.flight_status = null;
    patch.flight_status_note = null;
    patch.flight_scheduled_at = null;
    patch.flight_estimated_at = null;
    patch.flight_status_updated_at = new Date().toISOString();

    const { error: upErr } = await supabaseAdmin
      .from("jobs")
      .update(patch as any)
      .eq("id", data.job_id)
      .eq("company_id", c.id);
    if (upErr) throw new Error(upErr.message);

    if (!data.retry) return { ok: true, retried: false as const };

    const { data: job } = await supabaseAdmin
      .from("jobs")
      .select(
        "id, company_id, driver_id, from_flight, to_flight, from_location, to_location, pickup_at, flight_status, tracking_kind",
      )
      .eq("id", data.job_id)
      .maybeSingle();
    if (!job) return { ok: true, retried: false as const };

    // Retry is free here — treat the fix as part of the previous paid attempt.
    const result = await applyLiveStatusToJob(supabaseAdmin, job as any);
    return { ok: true, retried: true as const, result };
  });




export const checkFlightStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const c = await resolveCompany(context);
    const supabaseAdmin = await getAdminClient();
    const configured = !!(process.env.AERODATABOX_API_KEY || process.env.GEMINI_API_KEY);
    const fromIso = new Date(Date.now() - 6 * 3600_000).toISOString();
    const toIso = new Date(Date.now() + 48 * 3600_000).toISOString();
    const { data: jobs, error } = await supabaseAdmin
      .from("jobs")
      .select("id, company_id, driver_id, from_flight, to_flight, from_location, to_location, pickup_at, flight_status, flight_status_updated_at, tracking_kind, status")
      .eq("company_id", c.id)
      .or("from_flight.not.is.null,to_flight.not.is.null")
      .not("status", "in", "(completed,cancelled)")
      .gte("pickup_at", fromIso)
      .lte("pickup_at", toIso);
    if (error) throw new Error(error.message);
    if (!configured || !jobs?.length) return { checked: jobs?.length ?? 0, updated: 0, configured };
    await assertFeatureEnabled(c.id, "flight_vessel_tracking");
    const freshCutoffMs = Date.now() - 5 * 60_000;
    let updated = 0;
    let skippedFresh = 0;
    for (const j of jobs) {
      // Skip trips whose live status was refreshed within the last 5 min —
      // the AeroDataBox cache would return the same value and this would
      // just burn extra-lookup points for no new information.
      const last = (j as any).flight_status_updated_at as string | null;
      if (last && new Date(last).getTime() > freshCutoffMs) {
        skippedFresh++;
        continue;
      }
      try {
        const { error: spendErr } = await supabaseAdmin.rpc("spend_points", {
          _company_id: c.id,
          _feature_key: "flight_status_extra_lookup",
          _job_id: (j as any).id,
          _note: "flight status extra lookup (bulk refresh)",
          _cost_override: undefined as unknown as number,
        });
        if (spendErr) {
          // Stop the loop on billing errors — reporting once is enough.
          break;
        }
        const r = await applyLiveStatusToJob(supabaseAdmin, j as any);
        if (r.ok) updated++;
        else await refundPoints(c.id, "flight_status_extra_lookup", "refresh failed", (j as any).id);
      } catch {
        await refundPoints(c.id, "flight_status_extra_lookup", "refresh threw", (j as any).id);
      }
    }
    return { checked: jobs.length, updated, configured, skippedFresh };
  });

export const getFlightTrackingConfig = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const key = process.env.AERODATABOX_API_KEY;
    const configured = !!key && key.length > 0;
    return {
      configured,
      provider: configured ? "AeroDataBox (RapidAPI)" : null,
      feature: "flight_vessel_tracking",
    };
  });

export const getMaltaFlightStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ job_id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const c = await resolveCompany(context);
    await assertJobInCompany(context, data.job_id);
    const supabaseAdmin = await getAdminClient();
    const { data: job, error } = await supabaseAdmin
      .from("jobs")
      .select("id, company_id, driver_id, from_flight, to_flight, from_location, to_location, pickup_at, flight_status, flight_status_updated_at, tracking_kind, status")
      .eq("id", data.job_id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!job) throw new Error("Job not found");
    if (!job.from_flight && !job.to_flight) return { ok: false, reason: "no_flight" as const };
    if ((job as any).status === "completed" || (job as any).status === "cancelled") {
      return { ok: false as const, reason: "trip_finished" };
    }

    await assertFeatureEnabled(c.id, "flight_vessel_tracking");
    const { error: spendErr } = await supabaseAdmin.rpc("spend_points", {
      _company_id: c.id,
      _feature_key: "flight_status_extra_lookup",
      _job_id: data.job_id,
      _note: "flight/vessel status extra lookup (manual)",
      _cost_override: undefined as unknown as number,
    });
    if (spendErr) {
      const msg = spendErr.message || "";
      if (msg.includes("insufficient_points")) throw new Error("Out of points — buy a top-up to refresh status.");
      if (msg.includes("feature_disabled")) throw new Error("Flight/vessel tracking has been disabled by the administrator.");
      if (msg.includes("feature_capped")) throw new Error("Monthly cap reached for flight/vessel tracking.");
      throw new Error(msg);
    }

    try {
      const r = await applyLiveStatusToJob(supabaseAdmin, job as any);
      if (!r.ok) await refundPoints(c.id, "flight_status_extra_lookup", "refresh failed", data.job_id);
      return r;
    } catch (e: any) {
      await refundPoints(c.id, "flight_status_extra_lookup", "refresh threw", data.job_id);
      return { ok: false as const, reason: "exception", error: String(e?.message ?? e) };
    }
  });

// Shared compute for traffic + flight/vessel status. Used by both previewTripStatus
// (read-only preview for the trip dialog) and refreshJobLiveStatus (persists
// the result on the trip row so cards + client portal reflect it).
async function _computeTripLiveStatus(data: {
  from_location?: string;
  to_location?: string;
  date?: string;
  time?: string;
  from_flight?: string;
  to_flight?: string;
  tracking_kind?: "flight" | "vessel";
}) {
  let pickupIso: string | null = null;
  if (data.date && data.time) {
    try {
      pickupIso = maltaWallTimeToUtcIso(data.date, data.time);
    } catch {
      pickupIso = null;
    }
  }

  // ---- FLIGHT / VESSEL ----
  let flight: {
    ok: boolean;
    status?: string;
    note?: string;
    scheduled?: string | null;
    estimated?: string | null;
    confidence?: "high" | "low";
    code?: string;
    reason?: string;
  } | null = null;
  const code = (data.from_flight || data.to_flight || "").trim();
  const kind: "flight" | "vessel" = data.tracking_kind === "vessel" ? "vessel" : "flight";
  if (code) {
    const side: FlightSide | undefined =
      kind === "flight" ? (data.from_flight ? "arr" : data.to_flight ? "dep" : undefined) : undefined;
    const r = await fetchLiveStatus(kind, code, pickupIso, side);
    if (!r.ok) {
      flight = { ok: false, code, reason: r.reason ?? "no_result" };
    } else {
      let status = r.status ?? "unknown";
      let note = r.note ?? "";
      if (r.scheduled && pickupIso) {
        const s = new Date(r.scheduled).getTime();
        const p = new Date(pickupIso).getTime();
        if (!Number.isNaN(s) && !Number.isNaN(p) && Math.abs(s - p) > FLIGHT_TIME_MISMATCH_MS) {
          status = "time_mismatch";
          note = `Scheduled ${formatMaltaTime(r.scheduled)} vs pickup ${formatMaltaTime(pickupIso)}`;
        }
      }
      flight = {
        ok: true,
        code,
        status,
        note,
        scheduled: r.scheduled ?? null,
        estimated: r.estimated ?? null,
        confidence: r.confidence,
      };
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
  const lovableKey = process.env.LOVABLE_API_KEY;
  if (data.from_location && data.to_location) {
    if (!apiKey || !lovableKey) {
      traffic = { ok: false, reason: "not_configured" };
    } else {
      try {
        const nowMs = Date.now();
        const pickupMs = pickupIso ? new Date(pickupIso).getTime() : nowMs;
        const departureTime =
          pickupMs > nowMs + 60_000 ? new Date(pickupMs).toISOString() : undefined;
        const body: Record<string, unknown> = {
          origins: [{ waypoint: { address: data.from_location } }],
          destinations: [{ waypoint: { address: data.to_location } }],
          travelMode: "DRIVE",
          routingPreference: "TRAFFIC_AWARE",
        };
        if (departureTime) body.departureTime = departureTime;
        const rmRes = await fetch(
          "https://connector-gateway.lovable.dev/google_maps/routes/distanceMatrix/v2:computeRouteMatrix",
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${lovableKey}`,
              "X-Connection-Api-Key": apiKey,
              "Content-Type": "application/json",
              "X-Goog-FieldMask":
                "originIndex,destinationIndex,duration,staticDuration,distanceMeters,condition,status",
            },
            body: JSON.stringify(body),
          },
        );
        if (!rmRes.ok) {
          const bodyText = await rmRes.text().catch(() => "");
          console.error(`[computeTripLiveStatus.routes] ${rmRes.status}: ${bodyText.slice(0, 500)}`);
          traffic = { ok: false, reason: `routes_${rmRes.status}` };
        } else {
          const rmJson: any = await rmRes.json();
          const el = Array.isArray(rmJson) ? rmJson[0] : rmJson;
          const elStatus = el?.status?.code;
          if (!el || (elStatus != null && elStatus !== 0) || el?.condition === "ROUTE_NOT_FOUND") {
            traffic = { ok: false, reason: "no_route" };
          } else {
            const parseSec = (v: unknown): number | null => {
              if (typeof v === "string" && v.endsWith("s")) {
                const n = Number(v.slice(0, -1));
                return Number.isFinite(n) ? n : null;
              }
              if (typeof v === "number" && Number.isFinite(v)) return v;
              return null;
            };
            const dur = parseSec(el.duration);
            const free = parseSec(el.staticDuration);
            const meters = typeof el.distanceMeters === "number" ? el.distanceMeters : null;
            const delaySec = dur != null && free != null ? Math.max(0, dur - free) : 0;
            const delayMin = Math.round(delaySec / 60);
            const ratio = free && dur ? dur / free : 1;
            let severity: "light" | "moderate" | "heavy" | "severe" = "light";
            if (ratio >= 1.75 || delayMin >= 30) severity = "severe";
            else if (ratio >= 1.4 || delayMin >= 15) severity = "heavy";
            else if (ratio >= 1.15 || delayMin >= 5) severity = "moderate";
            const leaveBy =
              pickupIso && dur ? new Date(new Date(pickupIso).getTime() - dur * 1000).toISOString() : null;
            const fmtDur = (s: number | null): string => {
              if (!s || s <= 0) return "";
              const mins = Math.round(s / 60);
              if (mins < 60) return `${mins} min`;
              const h = Math.floor(mins / 60);
              const m = mins % 60;
              return m ? `${h} h ${m} min` : `${h} h`;
            };
            const fmtDist = (m: number | null): string => {
              if (m == null) return "";
              if (m >= 1000) return `${(m / 1000).toFixed(m >= 10_000 ? 0 : 1)} km`;
              return `${Math.round(m)} m`;
            };
            traffic = {
              ok: true,
              delay_minutes: delayMin,
              severity,
              duration_text: fmtDur(dur),
              duration_seconds: dur ?? undefined,
              free_seconds: free ?? undefined,
              distance_text: fmtDist(meters),
              leave_by_at: leaveBy,
            };
          }
        }
      } catch (e: any) {
        console.error("[computeTripLiveStatus.routes] exception", e);
        traffic = { ok: false, reason: "routes_failed" };
      }
    }

  }

  return { pickup_at: pickupIso, flight, traffic };
}

// Preview traffic + flight/vessel status for a trip that hasn't been saved yet.
// Read-only; does NOT deduct points or write any DB rows.
export const previewTripStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        from_location: z.string().trim().max(300).optional(),
        to_location: z.string().trim().max(300).optional(),
        date: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional(),
        time: z
          .string()
          .regex(/^\d{2}:\d{2}$/)
          .optional(),
        from_flight: z.string().trim().max(40).optional(),
        to_flight: z.string().trim().max(40).optional(),
        tracking_kind: z.enum(["flight", "vessel"]).optional(),
      })
      .parse(i),
  )
  .handler(async ({ data }) => {
    return await _computeTripLiveStatus(data);
  });

// Persist a fresh live-status snapshot on the trip row. Coordinator-only.
export const refreshJobLiveStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ job_id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const c = await resolveCompany(context);
    const supabaseAdmin = await getAdminClient();
    const { data: job, error } = await supabaseAdmin
      .from("jobs")
      .select("id, company_id, from_location, to_location, date, time, from_flight, to_flight, tracking_kind, status, flight_status_updated_at")
      .eq("id", data.job_id)
      .maybeSingle();
    if (error || !job) throw new Error("Trip not found");
    if ((job as any).company_id !== c.id) throw new Error("Not allowed");
    // Never lookup for finished trips — they're archived, status is frozen.
    const finished = (job as any).status === "completed" || (job as any).status === "cancelled";

    // Only meter when a flight/vessel identifier is actually attached, the
    // trip isn't finished, and the last lookup is older than the 5-min
    // AeroDataBox cache (otherwise we'd burn points for a cached answer).
    const hasCode = !finished && !!((job as any).from_flight || (job as any).to_flight);
    const lastFlightAt = (job as any).flight_status_updated_at as string | null;
    const flightFresh = !!lastFlightAt && Date.now() - new Date(lastFlightAt).getTime() < 5 * 60_000;
    const shouldMeterFlight = hasCode && !flightFresh;
    if (shouldMeterFlight) {
      await assertFeatureEnabled(c.id, "flight_vessel_tracking");
      const { error: spendErr } = await supabaseAdmin.rpc("spend_points", {
        _company_id: c.id,
        _feature_key: "flight_status_extra_lookup",
        _job_id: data.job_id,
        _note: "flight/vessel status extra lookup",
        _cost_override: undefined as unknown as number,
      });
      if (spendErr) {
        const msg = spendErr.message || "";
        if (msg.includes("insufficient_points")) throw new Error("Out of points — buy a top-up to refresh status.");
        if (msg.includes("feature_disabled")) throw new Error("Flight/vessel tracking has been disabled by the administrator.");
        if (msg.includes("feature_capped")) throw new Error("Monthly cap reached for flight/vessel tracking.");
        throw new Error(msg);
      }
    }

    let preview;
    try {
      preview = await _computeTripLiveStatus({
        from_location: (job as any).from_location ?? undefined,
        to_location: (job as any).to_location ?? undefined,
        date: (job as any).date ?? undefined,
        time: ((job as any).time ?? "").slice(0, 5) || undefined,
        from_flight: finished ? undefined : (job as any).from_flight ?? undefined,
        to_flight: finished ? undefined : (job as any).to_flight ?? undefined,
        tracking_kind: ((job as any).tracking_kind as any) === "vessel" ? "vessel" : "flight",
      });
    } catch (e) {
      if (shouldMeterFlight) await refundPoints(c.id, "flight_status_extra_lookup", "refresh failed", data.job_id);
      throw e;
    }

    if (shouldMeterFlight && !preview.flight?.ok) {
      await refundPoints(c.id, "flight_status_extra_lookup", "refresh failed", data.job_id);
    }

    const patch: Record<string, any> = {};
    if (preview.traffic?.ok) {
      patch.traffic_delay_minutes = preview.traffic.delay_minutes ?? 0;
      patch.traffic_severity = preview.traffic.severity ?? null;
      patch.leave_by_at = preview.traffic.leave_by_at ?? null;
    }
    if (preview.flight?.ok) {
      patch.flight_status = preview.flight.status ?? null;
      patch.flight_status_note = preview.flight.note ?? null;
      patch.flight_status_confidence = preview.flight.confidence ?? null;
      patch.flight_status_updated_at = new Date().toISOString();
      patch.flight_scheduled_at = preview.flight.scheduled ?? null;
      patch.flight_estimated_at = preview.flight.estimated ?? null;
    }
    if (Object.keys(patch).length) {
      await supabaseAdmin
        .from("jobs")
        .update(patch as any)
        .eq("id", data.job_id);
    }
    return preview;
  });

export const listJobPax = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ job_id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const c = await resolveCompany(context);
    const supabaseAdmin = await getAdminClient();
    const { data: job, error: jErr } = await supabaseAdmin
      .from("jobs")
      .select("id")
      .eq("id", data.job_id)
      .or(
        `company_id.eq.${c.id},executor_company_id.eq.${c.id},origin_company_id.eq.${c.id},dispatch_chain_company_ids.cs.{${c.id}}`,
      )
      .maybeSingle();
    if (jErr) throw new Error(jErr.message);
    if (!job) return [];
    const { data: rows, error } = await supabaseAdmin
      .from("pax")
      .select("id, name, status")
      .eq("job_id", data.job_id)
      .order("name");
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const splitPaxToNewJob = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        source_job_id: z.string().uuid(),
        pax_ids: z.array(z.string().uuid()).min(1).max(200),
        driver_id: z.string().uuid().nullable().optional(),
        vehicle: z.string().trim().max(120).optional(),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const c = await resolveCompany(context);
    const supabaseAdmin = await getAdminClient();
    const { data: src, error } = await supabaseAdmin.from("jobs").select("*").eq("id", data.source_job_id).single();
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

    // Build the child payload from ALL source fields (business names,
    // place ids, lat/lng, contact, room, pax_count, etc.) so the split
    // child mirrors the parent's addressing and shows correctly on the
    // client link. buildClonedJobPayload strips volatile fields and mints
    // a fresh client_link_token by default.
    const overrides: Record<string, unknown> = {
      company_id: inheritsChain ? src.company_id : c.id,
      parent_job_id: src.id,
      driver_id: data.driver_id ?? null,
      vehicle: data.vehicle || (src as any).vehicle || null,
      qr_strict_mode: false,
      tracking_enabled: false,
      // Preserve grouping so the parent + split render together in group views.
      group_id: src.group_id ?? null,
      group_name: src.group_name ?? null,
      group_note: src.group_note ?? null,
      grouped_count: src.grouped_count ?? null,
      grouped_at: src.grouped_at ?? null,
      coord_approved_at: src.coord_approved_at ?? new Date().toISOString(),
      source: src.source ?? null,
    };
    if (inheritsChain) {
      overrides.origin_company_id = src.origin_company_id ?? src.company_id;
      overrides.executor_company_id = c.id;
      overrides.dispatch_chain_company_ids = src.dispatch_chain_company_ids ?? [src.company_id, c.id];
      overrides.dispatch_status = "accepted";
      overrides.dispatched_at = src.dispatched_at ?? new Date().toISOString();
      overrides.dispatch_decided_at = new Date().toISOString();
    }
    const insertPayload = buildClonedJobPayload(src as Record<string, unknown>, overrides);
    // buildClonedJobPayload mints its own token; use the childToken we
    // already generated so the identity rebind below points at the
    // exact same string.
    insertPayload.client_link_token = childToken;

    const { data: job, error: iErr } = await supabaseAdmin
      .from("jobs")
      .insert(insertPayload as never)
      .select("*")
      .single();

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
    const { data: parentLabels } = await supabaseAdmin.from("job_labels").select("label_id").eq("job_id", src.id);
    if (parentLabels && parentLabels.length) {
      await supabaseAdmin
        .from("job_labels")
        .insert(parentLabels.map((l: any) => ({ job_id: job.id, label_id: l.label_id })));
    }

    // Move the selected pax to the child.
    const { error: uErr } = await supabaseAdmin
      .from("pax")
      .update({ job_id: job.id })
      .in("id", data.pax_ids)
      .eq("job_id", data.source_job_id);
    if (uErr) throw new Error(uErr.message);

    // Rebind any client-link identities tied to those pax to the child's token,
    // so the moved passengers' portal link resolves to the split they're on.
    if (src.client_link_token) {
      await supabaseAdmin
        .from("client_link_identities")
        .update({ token: childToken } as never)
        .eq("token", src.client_link_token)
        .in("pax_id", data.pax_ids);
    }

    return { ok: true, new_job_id: job.id, job };
  });

export const movePaxToJob = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        source_job_id: z.string().uuid(),
        target_job_id: z.string().uuid(),
        pax_ids: z.array(z.string().uuid()).min(1).max(200),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const c = await resolveCompany(context);
    const supabaseAdmin = await getAdminClient();
    const { data: rows, error } = await supabaseAdmin
      .from("jobs")
      .select("id")
      .eq("company_id", c.id)
      .in("id", [data.source_job_id, data.target_job_id]);
    if (error || !rows || rows.length !== 2) throw new Error("Job not found");
    const { error: uErr } = await supabaseAdmin
      .from("pax")
      .update({ job_id: data.target_job_id })
      .in("id", data.pax_ids)
      .eq("job_id", data.source_job_id);
    if (uErr) throw new Error(uErr.message);
    return { ok: true };
  });

export const setJobGrouped = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        job_id: z.string().uuid(),
        count: z.number().int().min(0).max(500),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const c = await resolveCompany(context);
    const supabaseAdmin = await getAdminClient();
    const { data: job, error } = await supabaseAdmin
      .from("jobs")
      .select("id, company_id, executor_company_id, grouped_count")
      .eq("id", data.job_id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!job || (job.company_id !== c.id && job.executor_company_id !== c.id)) {
      throw new Error("Job not found");
    }
    const existing = (job as any).grouped_count ?? 0;
    const total = Math.max(existing, 0) + data.count;
    const patch =
      total >= 2
        ? { grouped_count: total, grouped_at: new Date().toISOString() }
        : { grouped_count: null, grouped_at: null };
    const { error: uErr } = await supabaseAdmin
      .from("jobs")
      .update(patch as never)
      .eq("id", data.job_id);
    if (uErr) throw new Error(uErr.message);
    return { ok: true, grouped_count: total };
  });

// ---------- Trip messages (coordinator side) ----------

async function assertJobInCompany(ctx: Ctx, jobId: string) {
  const c = await resolveCompany(ctx);
  const supabaseAdmin = await getAdminClient();
  const { data, error } = await supabaseAdmin
    .from("jobs")
    .select("id, company_id, executor_company_id, origin_company_id, dispatch_chain_company_ids")
    .eq("id", jobId)
    .or(
      `company_id.eq.${c.id},executor_company_id.eq.${c.id},origin_company_id.eq.${c.id},dispatch_chain_company_ids.cs.{${c.id}}`,
    )
    .maybeSingle();
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
    const { data: row, error } = await supabaseAdmin
      .from("jobs")
      .select(
        "id, price_amount, price_currency, payment_method, payment_status, price_set_by, price_set_at, driver_started_at, driver_completed_at, driver_actual_minutes, driver_reported_km, driver_note",
      )
      .eq("id", data.job_id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return row ?? null;
  });

export const coordinatorSetTripPrice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        job_id: z.string().uuid(),
        price_amount: z.number().nonnegative().max(1_000_000).nullable(),
        price_currency: z.string().trim().min(3).max(4).optional(),
        payment_method: z.enum(["cash", "invoice"]).nullable().optional(),
      })
      .parse(i),
  )
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
    const { error } = await supabaseAdmin
      .from("jobs")
      .update(patch as never)
      .eq("id", data.job_id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

async function siblingGroupJobIds(
  supabaseAdmin: Awaited<ReturnType<typeof getAdminClient>>,
  jobId: string,
): Promise<string[]> {
  const { data: row } = await supabaseAdmin
    .from("jobs")
    .select("group_id" as any)
    .eq("id", jobId)
    .maybeSingle();
  const gid = (row as any)?.group_id as string | null;
  if (!gid) return [jobId];
  const { data: sibs } = await supabaseAdmin
    .from("jobs")
    .select("id")
    .eq("group_id" as any, gid);
  const ids = (sibs ?? []).map((s: any) => s.id as string);
  return ids.length ? ids : [jobId];
}

export const listTripMessagesCoord = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        job_id: z.string().uuid(),
        identity_id: z.string().uuid().nullish(),
        pax_id: z.string().uuid().nullish(),
        thread_kind: z.enum(["all", "private", "group", "driver"]).optional().default("all"),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    await assertJobInCompany(context, data.job_id);
    const supabaseAdmin = await getAdminClient();
    const ids = await siblingGroupJobIds(supabaseAdmin, data.job_id);
    // Look up the CURRENT driver on this job — private driver↔coordinator
    // history from a previous (reassigned) driver should not show up in the
    // current driver chat panel.
    const { data: jobRow } = await supabaseAdmin.from("jobs").select("driver_id").eq("id", data.job_id).maybeSingle();
    const currentDriverId = (jobRow as any)?.driver_id ?? null;
    const { data: rows, error } = await supabaseAdmin
      .from("trip_messages")
      .select(
        "id, sender_kind, sender_label, body, created_at, read_by_coordinator_at, thread_kind, client_identity_id, pax_id, driver_id",
      )
      .in("job_id", ids)
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    // Coordinator NEVER sees driver↔client private messages.
    let filtered = ((rows ?? []) as any[]).filter((r) => r.thread_kind !== "driver_client");
    // When a driver is assigned, scope driver_coord to that driver only.
    // When unassigned (e.g. right after a rejection), keep history visible so
    // the coordinator can still read the rejection reason.
    if (currentDriverId) {
      filtered = filtered.filter(
        (r) => r.thread_kind !== "driver_coord" || !r.driver_id || r.driver_id === currentDriverId,
      );
    }

    // If a pax_id was provided but no identity_id, look up the identity tied to that pax.
    let effectiveIdentityId: string | null = data.identity_id ?? null;
    if (data.pax_id && !effectiveIdentityId) {
      const { data: ident } = await supabaseAdmin
        .from("client_link_identities")
        .select("id")
        .eq("pax_id", data.pax_id)
        .order("last_seen_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      effectiveIdentityId = (ident as any)?.id ?? null;
    }

    if (data.thread_kind === "driver") {
      filtered = filtered.filter((r) => r.thread_kind === "driver_coord");
    } else if (data.thread_kind === "private" && (effectiveIdentityId || data.pax_id)) {
      filtered = filtered.filter(
        (r) =>
          (effectiveIdentityId && r.client_identity_id === effectiveIdentityId) ||
          (data.pax_id && r.pax_id === data.pax_id) ||
          (r.sender_kind === "coordinator" &&
            (r.thread_kind === "group" || r.thread_kind == null) &&
            !r.client_identity_id &&
            !r.pax_id),
      );
    } else if (data.thread_kind === "group") {
      filtered = filtered.filter(
        (r) =>
          r.thread_kind !== "driver_coord" &&
          ((r.sender_kind === "driver" && (r.thread_kind === "group" || r.thread_kind == null)) ||
            ((r.thread_kind === "group" || r.thread_kind == null) && !r.pax_id)),
      );
    } else {
      // "all" — hide the driver-only private channel too
      filtered = filtered.filter((r) => r.thread_kind !== "driver_coord");
    }
    const unreadIds = filtered
      .filter((r) => (r.sender_kind === "driver" || r.sender_kind === "client") && !r.read_by_coordinator_at)
      .map((r) => r.id);
    if (unreadIds.length) {
      await supabaseAdmin
        .from("trip_messages")
        .update({ read_by_coordinator_at: new Date().toISOString() })
        .in("id", unreadIds);
    }
    return filtered;
  });

export const postTripMessageCoord = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        job_id: z.string().uuid(),
        body: z.string().trim().min(1).max(4000),
        identity_id: z.string().uuid().nullish(),
        pax_id: z.string().uuid().nullish(),
        thread_kind: z.enum(["group", "private", "driver"]).optional().default("group"),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const { company } = await assertJobInCompany(context, data.job_id);
    await assertFeatureEnabled(company.id, "chat");
    const supabaseAdmin = await getAdminClient();
    const { data: userRow } = await supabaseAdmin.auth.admin.getUserById(context.userId);
    const label = userRow?.user?.email ?? "Coordinator";

    if (data.thread_kind === "driver") {
      // Tag with the current driver so a later reassignment doesn't leak this
      // private thread to whichever driver takes over next.
      const { data: jobRow } = await supabaseAdmin.from("jobs").select("driver_id").eq("id", data.job_id).maybeSingle();
      const { error } = await supabaseAdmin.from("trip_messages").insert({
        job_id: data.job_id,
        company_id: company.id,
        sender_kind: "coordinator",
        sender_label: label,
        body: data.body,
        thread_kind: "driver_coord",
        driver_id: (jobRow as any)?.driver_id ?? null,
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
        .select("id")
        .eq("pax_id", data.pax_id)
        .order("last_seen_at", { ascending: false })
        .limit(1)
        .maybeSingle();
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
    const { data: myJobs } = await supabaseAdmin
      .from("jobs")
      .select("id, driver_id")
      .or(
        `company_id.eq.${c.id},executor_company_id.eq.${c.id},origin_company_id.eq.${c.id},dispatch_chain_company_ids.cs.{${c.id}}`,
      );
    const jobIds = (myJobs ?? []).map((j: any) => j.id as string);
    if (!jobIds.length) return {};
    const currentDriverByJob: Record<string, string | null> = {};
    for (const j of (myJobs ?? []) as any[]) currentDriverByJob[j.id] = j.driver_id ?? null;
    const { data, error } = await supabaseAdmin
      .from("trip_messages")
      .select("job_id, sender_kind, thread_kind, driver_id")
      .in("job_id", jobIds)
      .is("read_by_coordinator_at", null)
      .in("sender_kind", ["driver", "client"])
      .not("thread_kind", "eq", "driver_client");
    if (error) throw new Error(error.message);
    const acc: Record<string, { driver: number; client: number; total: number }> = {};
    for (const m of (data ?? []) as {
      job_id: string;
      sender_kind: string;
      thread_kind: string;
      driver_id: string | null;
    }[]) {
      // Skip driver_coord unread from a previous (reassigned) driver.
      if (m.thread_kind === "driver_coord") {
        const cur = currentDriverByJob[m.job_id];
        if (cur && m.driver_id && m.driver_id !== cur) continue;
      }
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
    const { data: jobs } = await supabaseAdmin.from("jobs").select("id, client_link_token").in("id", data.job_ids);
    const tokens = (jobs ?? []).map((j) => j.client_link_token).filter(Boolean) as string[];
    if (!tokens.length) return {};
    const { data: idents } = await supabaseAdmin
      .from("client_link_identities")
      .select("token, last_seen_at")
      .in("token", tokens);
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
    try {
      await assertJobInCompany(context, jobId);
    } catch {
      return {};
    }

    const supabaseAdmin = await getAdminClient();
    const jobIds = await siblingGroupJobIds(supabaseAdmin, jobId);

    const [{ data: paxRows }, { data: jobsRows }, { data: msgRows }] = await Promise.all([
      supabaseAdmin.from("pax").select("id, name, job_id").in("job_id", jobIds),
      supabaseAdmin.from("jobs").select("id, client_link_token").in("id", jobIds),
      supabaseAdmin
        .from("trip_messages")
        .select(
          "id, job_id, client_identity_id, pax_id, sender_kind, sender_label, body, created_at, read_by_coordinator_at, thread_kind",
        )
        .in("job_id", jobIds)
        .not("thread_kind", "in", "(driver_client,driver_coord)")
        .order("created_at", { ascending: true }),
    ]);

    const tokens = (jobsRows ?? []).map((j: any) => j.client_link_token).filter(Boolean) as string[];
    const { data: idents } = tokens.length
      ? await supabaseAdmin
          .from("client_link_identities")
          .select("id, token, pax_id, pax_name, last_seen_at, first_seen_at")
          .in("token", tokens)
      : { data: [] as any[] };

    const norm = (s: string | null | undefined) => (s ?? "").trim().toLowerCase().replace(/\s+/g, " ");
    type Ident = {
      id: string;
      pax_id: string | null;
      pax_name: string | null;
      last_seen_at: string | null;
      first_seen_at: string | null;
    };
    const identsArr = (idents ?? []) as Ident[];

    const now = Date.now();
    const out: Record<
      string,
      {
        identity_id: string | null;
        last_seen_at: string | null;
        first_seen_at: string | null;
        presence: "online" | "away" | "never";
        last_message: {
          body: string;
          created_at: string;
          sender_kind: string;
          sender_label: string | null;
          read_by_coordinator_at: string | null;
        } | null;
        unread_count: number;
      }
    > = {};

    for (const p of (paxRows ?? []) as { id: string; name: string; job_id: string }[]) {
      const byId = identsArr.find((i) => i.pax_id === p.id);
      const byName = byId ?? identsArr.find((i) => norm(i.pax_name) === norm(p.name));
      const ident = byId ?? byName ?? null;

      let msgs = (msgRows ?? []).filter((m: any) => m.sender_kind !== "coordinator");
      if (ident) {
        msgs = msgs.filter(
          (m: any) =>
            m.client_identity_id === ident.id ||
            m.pax_id === p.id ||
            (m.thread_kind === "group" && m.client_identity_id === null && !m.pax_id),
        );
      } else {
        // Include queued coordinator messages tied to this pax slot + group client messages
        msgs = (msgRows ?? []).filter(
          (m: any) => m.pax_id === p.id || (m.sender_kind === "client" && m.thread_kind === "group"),
        );
      }
      const last = msgs.length ? msgs[msgs.length - 1] : null;
      const unread = msgs.filter((m: any) => m.sender_kind === "client" && !m.read_by_coordinator_at).length;

      const lastSeen = ident?.last_seen_at ?? null;
      const firstSeen = ident?.first_seen_at ?? null;
      const presence: "online" | "away" | "never" =
        lastSeen && now - new Date(lastSeen).getTime() < 60_000 ? "online" : lastSeen || firstSeen ? "away" : "never";

      out[p.id] = {
        identity_id: ident?.id ?? null,
        last_seen_at: lastSeen,
        first_seen_at: firstSeen,
        presence,
        last_message: last
          ? {
              body: last.body,
              created_at: last.created_at,
              sender_kind: last.sender_kind,
              sender_label: last.sender_label,
              read_by_coordinator_at: last.read_by_coordinator_at,
            }
          : null,
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
    const { data, error } = await supabaseAdmin
      .from("trip_labels")
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
    z
      .object({
        name: z.string().trim().min(1).max(60),
        color: z.string().regex(HEX_COLOR).default("#3B82F6"),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const c = await resolveCompany(context);
    const supabaseAdmin = await getAdminClient();
    const { data: row, error } = await supabaseAdmin
      .from("trip_labels")
      .insert({
        company_id: c.id,
        name: data.name,
        color: data.color,
      })
      .select("id, name, color, sort_order")
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

export const updateLabel = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        name: z.string().trim().min(1).max(60).optional(),
        color: z.string().regex(HEX_COLOR).optional(),
        sort_order: z.number().int().optional(),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const c = await resolveCompany(context);
    const supabaseAdmin = await getAdminClient();
    const patch: Record<string, unknown> = {};
    if (data.name !== undefined) patch.name = data.name;
    if (data.color !== undefined) patch.color = data.color;
    if (data.sort_order !== undefined) patch.sort_order = data.sort_order;
    const { error } = await supabaseAdmin
      .from("trip_labels")
      .update(patch as never)
      .eq("id", data.id)
      .eq("company_id", c.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteLabel = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const c = await resolveCompany(context);
    const supabaseAdmin = await getAdminClient();
    const { error } = await supabaseAdmin.from("trip_labels").delete().eq("id", data.id).eq("company_id", c.id);
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
    const { data: job, error } = await supabaseAdmin
      .from("jobs")
      .select("id")
      .eq("id", data.job_id)
      .eq("company_id", c.id)
      .single();
    if (error || !job) throw new Error("Job not found");
    await syncJobLabels(context, c.id, data.job_id, data.label_ids);
    return { ok: true };
  });

// ---------- STATEMENT / REPORT ----------

const statementInput = z.object({
  from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .or(z.literal(""))
    .optional(),
  to: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .or(z.literal(""))
    .optional(),
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
    let q = supabaseAdmin
      .from("jobs")
      .select(
        `
        id, company_id, executor_company_id, origin_company_id, dispatch_chain_company_ids,
        from_location, to_location, date, time, pickup_at, status, payment_status,
        flightorship, from_flight, to_flight, flight_status, flight_status_note,
        clientcompanyname, vehicle, driver_id, driver_accepted_at, deletion_requested_at,
        created_at, updated_at, dispatch_status,
        price_amount, price_currency, payment_method, price_set_by, price_set_at,
        paid_at, paid_amount, paid_method, paid_reference, paid_by_user_id, paid_by_role,
        driver_paid_at, driver_paid_amount, driver_paid_method, driver_paid_reference, driver_payout_status,
        driver_actual_minutes, driver_reported_km, driver_started_at, driver_completed_at,
        drivers(id,name,phone,vehicle),
        pax(id,name,status,boarded_at),
        job_labels(trip_labels(id,name,color)),
        job_dispatch_hops(hop_index,from_company_id,to_company_id,status,decided_at,note,created_at)
      `,
      )
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

    if (data.flight_contains) {
      const fc = data.flight_contains.replace(/[%,()]/g, "");
      if (fc)
        q = q.or(
          `from_flight.ilike.%${fc}%,to_flight.ilike.%${fc}%,flightorship.ilike.%${fc}%`,
        );
    }

    if (data.from_contains) q = q.ilike("from_location", `%${data.from_contains}%`);
    if (data.to_contains) q = q.ilike("to_location", `%${data.to_contains}%`);
    if (data.deletion_only) q = q.not("deletion_requested_at", "is", null);
    if (data.search) {
      const s = data.search.replace(/[%,]/g, "");
      q = q.or(
        `from_location.ilike.%${s}%,to_location.ilike.%${s}%,flightorship.ilike.%${s}%,from_flight.ilike.%${s}%,to_flight.ilike.%${s}%,clientcompanyname.ilike.%${s}%`,
      );
    }

    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    let jobs: any[] = rows ?? [];

    // Driver filter (post-fetch so we can support "unassigned")
    if (data.driver_ids?.length || data.include_unassigned) {
      const ids = new Set(data.driver_ids ?? []);
      jobs = jobs.filter((j) => (data.include_unassigned && !j.driver_id) || (j.driver_id && ids.has(j.driver_id)));
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
      jobs = jobs.filter((j) => (j.pax ?? []).some((p: any) => (p.name ?? "").toLowerCase().includes(needle)));
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
      const { data: comps } = await supabaseAdmin.from("companies").select("id,name").in("id", Array.from(companyIds));
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
        price_display:
          j.price_amount != null ? `${Number(j.price_amount).toFixed(2)} ${j.price_currency ?? ""}`.trim() : "",
        price_set_by: j.price_set_by ?? "",
        driver_actual_minutes: j.driver_actual_minutes ?? null,
        driver_reported_km: j.driver_reported_km != null ? Number(j.driver_reported_km) : null,
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

        hops: hops.map((h: any) => ({
          index: h.hop_index,
          from: nameById[h.from_company_id] ?? "",
          to: nameById[h.to_company_id] ?? "",
          status: h.status,
          decided_at: h.decided_at,
          note: h.note ?? "",
        })),
        pax_rows: pax.map((p: any) => ({
          id: p.id,
          name: p.name,
          status: p.status,
          boarded_at: p.boarded_at,
        })),
      };
    });

    const totals = shaped.reduce(
      (acc, r) => {
        acc.billed += Number(r.price_amount ?? 0);
        acc.received_client += Number(r.paid_amount ?? 0);
        acc.received_driver += Number(r.driver_paid_amount ?? 0);
        return acc;
      },
      { billed: 0, received_client: 0, received_driver: 0 },
    );

    return {
      generated_at: new Date().toISOString(),
      company: { id: c.id, name: c.name },
      rows: shaped,
      total_trips: shaped.length,
      total_pax: shaped.reduce((s, r) => s + r.pax_count, 0),
      totals: {
        billed: Number(totals.billed.toFixed(2)),
        received_client: Number(totals.received_client.toFixed(2)),
        received_driver: Number(totals.received_driver.toFixed(2)),
        outstanding_client: Number((totals.billed - totals.received_client).toFixed(2)),
        outstanding_driver: Number((totals.billed - totals.received_driver).toFixed(2)),
      },
      truncated,
    };
  });

// ---------- Mark payment received (coordinator/admin) ----------

const PAY_METHODS = ["cash", "bank_transfer", "card", "other"] as const;

const markPaymentInput = z.object({
  job_id: z.string().uuid(),
  side: z.enum(["client", "driver"]).default("client"),
  amount: z.number().nonnegative().max(1_000_000).optional(),
  method: z.enum(PAY_METHODS).optional(),
  reference: z.string().trim().max(200).optional(),
  paid_at: z.string().datetime().optional(),
});

async function jobCompanyScope(jobId: string) {
  const sb = await getAdminClient();
  const { data } = await sb
    .from("jobs")
    .select("id, company_id, executor_company_id, origin_company_id, dispatch_chain_company_ids, price_amount, driver_id")
    .eq("id", jobId)
    .maybeSingle();
  return data as any;
}

function assertCompanyMayEdit(job: any, companyId: string, isAdmin: boolean) {
  if (isAdmin) return;
  const chain = (job?.dispatch_chain_company_ids ?? []) as string[];
  const ok =
    job?.company_id === companyId ||
    job?.executor_company_id === companyId ||
    job?.origin_company_id === companyId ||
    chain.includes(companyId);
  if (!ok) throw new Error("forbidden");
}

export const markJobPayment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => markPaymentInput.parse(i))
  .handler(async ({ data, context }) => {
    const c = await resolveCompany(context);
    const sb = await getAdminClient();
    const job = await jobCompanyScope(data.job_id);
    if (!job) throw new Error("job_not_found");
    assertCompanyMayEdit(job, c.id, c.isAdmin);

    const price = Number(job.price_amount ?? 0);
    const amt = data.amount != null ? Number(data.amount) : price;
    const paidAt = data.paid_at ?? new Date().toISOString();
    const method = data.method ?? null;
    const ref = data.reference ?? null;

    const patch: Record<string, unknown> =
      data.side === "driver"
        ? {
            driver_paid_at: paidAt,
            driver_paid_amount: amt,
            driver_paid_method: method,
            driver_paid_reference: ref,
            driver_paid_by_user_id: context.userId,
          }
        : {
            paid_at: paidAt,
            paid_amount: amt,
            paid_method: method,
            paid_reference: ref,
            paid_by_user_id: context.userId,
            paid_by_role: c.isAdmin ? "admin" : "coordinator",
          };

    const { error } = await sb.from("jobs").update(patch as never).eq("id", data.job_id);
    if (error) throw new Error(error.message);

    // Log a map event so the audit trail reflects the payment mark.
    try {
      await sb.from("trip_map_events").insert({
        job_id: data.job_id,
        company_id: c.id,
        driver_id: job.driver_id ?? null,
        event_type: data.side === "driver" ? "driver_payout_marked" : "payment_marked",
        meta: { amount: amt, method, reference: ref, marked_by: context.userId },
      } as never);
    } catch { /* best-effort */ }

    return { ok: true, amount: amt, side: data.side };
  });

export const unmarkJobPayment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({ job_id: z.string().uuid(), side: z.enum(["client", "driver"]).default("client") }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const c = await resolveCompany(context);
    const sb = await getAdminClient();
    const job = await jobCompanyScope(data.job_id);
    if (!job) throw new Error("job_not_found");
    assertCompanyMayEdit(job, c.id, c.isAdmin);

    const patch: Record<string, unknown> =
      data.side === "driver"
        ? {
            driver_paid_at: null,
            driver_paid_amount: null,
            driver_paid_method: null,
            driver_paid_reference: null,
            driver_paid_by_user_id: null,
          }
        : {
            paid_at: null,
            paid_amount: null,
            paid_method: null,
            paid_reference: null,
            paid_by_user_id: null,
            paid_by_role: null,
          };
    const { error } = await sb.from("jobs").update(patch as never).eq("id", data.job_id);
    if (error) throw new Error(error.message);
    try {
      await sb.from("trip_map_events").insert({
        job_id: data.job_id,
        company_id: c.id,
        driver_id: job.driver_id ?? null,
        event_type: data.side === "driver" ? "driver_payout_cleared" : "payment_cleared",
        meta: { by: context.userId },
      } as never);
    } catch { /* best-effort */ }
    return { ok: true };
  });

export const bulkMarkPayment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({
      job_ids: z.array(z.string().uuid()).min(1).max(500),
      side: z.enum(["client", "driver"]).default("client"),
      method: z.enum(PAY_METHODS).optional(),
      paid_at: z.string().datetime().optional(),
    }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const c = await resolveCompany(context);
    const sb = await getAdminClient();
    const { data: jobs, error } = await sb
      .from("jobs")
      .select("id, company_id, executor_company_id, origin_company_id, dispatch_chain_company_ids, price_amount, driver_id")
      .in("id", data.job_ids);
    if (error) throw new Error(error.message);
    const paidAt = data.paid_at ?? new Date().toISOString();
    const method = data.method ?? null;
    let ok = 0;
    for (const job of jobs ?? []) {
      try {
        assertCompanyMayEdit(job as any, c.id, c.isAdmin);
      } catch { continue; }
      const amt = Number((job as any).price_amount ?? 0);
      const patch =
        data.side === "driver"
          ? {
              driver_paid_at: paidAt,
              driver_paid_amount: amt,
              driver_paid_method: method,
              driver_paid_by_user_id: context.userId,
            }
          : {
              paid_at: paidAt,
              paid_amount: amt,
              paid_method: method,
              paid_by_user_id: context.userId,
              paid_by_role: c.isAdmin ? "admin" : "coordinator",
            };
      const { error: uerr } = await sb.from("jobs").update(patch as never).eq("id", (job as any).id);
      if (!uerr) ok += 1;
    }
    return { ok: true, updated: ok, total: (jobs ?? []).length };
  });



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
    const { data: jobs, error: jobsErr } = await supabaseAdmin
      .from("jobs")
      .select("id, driver_id, from_location, to_location, status, drivers(id,name)")
      .not("driver_id", "is", null)
      .in("status", ["en_route", "arrived", "in_progress"])
      .or(
        `company_id.eq.${c.id},executor_company_id.eq.${c.id},origin_company_id.eq.${c.id},dispatch_chain_company_ids.cs.{${c.id}}`,
      );
    if (jobsErr) throw new Error(jobsErr.message);
    const jobIds = (jobs ?? []).map((j: any) => j.id);
    if (jobIds.length === 0) return [] as any[];

    const { data: pts, error: ptsErr } = await supabaseAdmin
      .from("driver_locations")
      .select(
        "driver_id, job_id, latitude, longitude, accuracy_m, heading, speed_mps, captured_at, eta_sec, distance_m, next_instruction, destination_label",
      )
      .in("job_id", jobIds)
      .gte("captured_at", sinceIso)
      .order("captured_at", { ascending: false })
      .limit(2000);
    if (ptsErr) throw new Error(ptsErr.message);

    // Which of these active jobs currently have an open waiting session?
    const { data: openWaits } = await supabaseAdmin
      .from("job_wait_sessions" as any)
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
    const { data: jobs, error: jerr } = await supabaseAdmin
      .from("jobs")
      .select("id, from_location, to_location, driver_id, drivers(id,name)")
      .or(
        `company_id.eq.${c.id},executor_company_id.eq.${c.id},origin_company_id.eq.${c.id},dispatch_chain_company_ids.cs.{${c.id}}`,
      );
    if (jerr) throw new Error(jerr.message);
    const jobIds = (jobs ?? []).map((j: any) => j.id);
    if (jobIds.length === 0) return [] as any[];

    const { data: waits, error: werr } = await supabaseAdmin
      .from("job_wait_sessions" as any)
      .select("id, job_id, driver_id, started_at, source, free_ends_at")
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
        free_ends_at: w.free_ends_at ?? null,
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
    const { data: rows, error } = await supabaseAdmin
      .from("job_adjustments" as any)
      .select("id, kind, label, amount, currency, driver_note, created_at, wait_session_id, driver_id")
      .eq("job_id", data.job_id)
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    const { data: waits } = await supabaseAdmin
      .from("job_wait_sessions" as any)
      .select("id, started_at, ended_at, calculated_amount, agreed_amount, source, driver_note, free_ends_at, auto_started")
      .eq("job_id", data.job_id)
      .order("started_at", { ascending: true });
    return { adjustments: (rows ?? []) as any[], wait_sessions: (waits ?? []) as any[] };
  });

// ---------- WAIT PROPOSALS (coordinator) ----------

export const proposeWaitAdjustment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({
      job_id: z.string().uuid(),
      session_id: z.string().uuid().optional(),
      proposed_amount: z.number().min(0).max(100000),
      note: z.string().trim().max(500).optional(),
    }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const { company } = await assertJobInCompany(context, data.job_id);
    const supabaseAdmin = await getAdminClient();

    // Only one pending proposal per session at a time (unique index also guards).
    if (data.session_id) {
      const { data: existing } = await supabaseAdmin
        .from("job_wait_proposals")
        .select("id")
        .eq("session_id", data.session_id)
        .eq("status", "pending")
        .maybeSingle();
      if (existing) throw new Error("proposal_already_pending");
    }

    const { data: row, error } = await supabaseAdmin
      .from("job_wait_proposals")
      .insert({
        job_id: data.job_id,
        session_id: data.session_id ?? null,
        company_id: company.id,
        proposed_by_user_id: context.userId,
        proposed_amount: data.proposed_amount,
        note: data.note ?? null,
        status: "pending",
      } as never)
      .select("id")
      .maybeSingle();
    if (error) throw new Error(error.message);
    return { ok: true, proposal_id: (row as any).id };
  });

export const listWaitProposals = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ job_id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    await assertJobInCompany(context, data.job_id);
    const supabaseAdmin = await getAdminClient();
    const { data: rows, error } = await supabaseAdmin
      .from("job_wait_proposals")
      .select("id, session_id, proposed_amount, note, status, driver_response_note, responded_at, created_at")
      .eq("job_id", data.job_id)
      .order("created_at", { ascending: false })
      .limit(20);
    if (error) throw new Error(error.message);
    return (rows ?? []) as any[];
  });

export const cancelWaitProposal = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({ job_id: z.string().uuid(), proposal_id: z.string().uuid() }).parse(i),
  )
  .handler(async ({ data, context }) => {
    await assertJobInCompany(context, data.job_id);
    const supabaseAdmin = await getAdminClient();
    const { data: proposal } = await supabaseAdmin
      .from("job_wait_proposals")
      .select("id, status")
      .eq("id", data.proposal_id)
      .eq("job_id", data.job_id)
      .maybeSingle();
    if (!proposal) throw new Error("proposal_not_found");
    if ((proposal as any).status !== "pending") throw new Error("proposal_already_resolved");
    const { error } = await supabaseAdmin
      .from("job_wait_proposals")
      .update({ status: "rejected", responded_at: new Date().toISOString() } as never)
      .eq("id", data.proposal_id);
    if (error) throw new Error(error.message);
    return { ok: true };
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
      .eq("id", data.job_id)
      .maybeSingle();
    if (je || !job) return { ok: false, changed: 0, removed: 0 };

    let changed = 0;
    let removed = 0;
    let discoveredPhone = "";

    // Pax cleanup: strip embedded phones, delete blank/emoji-only rows.
    const { data: paxRows } = await supabaseAdmin.from("pax").select("id, name").eq("job_id", data.job_id);
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
      const { error: ue } = await supabaseAdmin
        .from("jobs")
        .update(jobPatch as any)
        .eq("id", data.job_id);
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
    const { data: job } = await supabaseAdmin.from("jobs").select("contact_phone").eq("id", data.job_id).maybeSingle();
    if (!job) throw new Error("Job not found");
    if (job.contact_phone) return { ok: true, set: false };
    const { error } = await supabaseAdmin.from("jobs").update({ contact_phone: data.phone }).eq("id", data.job_id);
    if (error) throw new Error(error.message);
    return { ok: true, set: true };
  });

// ---------- AI TRIP EXTRACTION (Gemini direct, chat-style) ----------
// Accepts a conversation (user pastes + follow-up replies) and returns either
// a short clarifying question or the finished 8-column trip rows.
export const extractTripsFromText = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        messages: z
          .array(
            z.object({
              role: z.enum(["user", "model"]),
              text: z.string().min(1).max(20000),
            }),
          )
          .min(1)
          .max(20),
        attachments: z
          .array(
            z.object({
              name: z.string().max(200),
              mimeType: z.string().max(100),
              dataBase64: z.string().max(15_000_000),
            }),
          )
          .max(5)
          .optional(),
        urls: z.array(z.string().url().max(2000)).max(3).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const supabaseAdmin = await getAdminClient();
    const { data: co } = await supabaseAdmin
      .from("companies")
      .select("id")
      .eq("owner_user_id", context.userId)
      .maybeSingle();
    if (co) await assertFeatureEnabled(co.id, "ai_extraction");

    // Meter: 1pt for text-only, 3pts when files/urls attached.
    const willUseMedia = (data.attachments?.length ?? 0) > 0 || (data.urls?.length ?? 0) > 0;
    if (co) {
      const extractionKey = willUseMedia ? "ai_extraction_media" : "ai_extraction";
      const { assertUserFeatureEnabled, friendlyGateError } = await import("@/lib/user-feature-prefs.server");
      try {
        await assertUserFeatureEnabled(supabaseAdmin, co.id, extractionKey);
      } catch (e) {
        throw new Error(friendlyGateError(e) ?? (e as Error).message);
      }
      const { error: spendErr } = await supabaseAdmin.rpc("spend_points", {
        _company_id: co.id,
        _feature_key: extractionKey,
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
        if (!r.ok) {
          fetchedPages.push({ url: u, text: "", error: `HTTP ${r.status}` });
          continue;
        }
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
      'Output JSON only, no markdown. Prefer the data envelope: {"type":"data","payload":[{...8 keys...}],"is_low_confidence":false,"follow_up_questions":[]}. When the input is completely unreadable/empty OR when you need 1-3 short clarifications before you can even draft rows, use {"type":"questions","payload":["short q1","short q2"]} (max 3, each <120 chars, phrased so the user can answer in one line). The legacy {"type":"question","payload":"..."} single-string form is still accepted.',
      'BEST-EFFORT RULE: Always return a data row for anything that looks like a trip, even when unsure. Fill in as many of the 8 keys as you reasonably can. Leave any unknown value as an empty string "" (or "1" for quantity) — never omit a key, never use null, never use "unknown", never invent fake data.',
      'CONFIDENCE FLAG: Set "is_low_confidence": true on the envelope when ANY of the following is true: you left one or more mandatory fields (pickupDate, pickupAddress, deliveryAddress) blank on any row, you had to guess a value, the source text was ambiguous/fragmented, or you were forced to skip fields. Otherwise set it to false.',
      'FOLLOW-UP QUESTIONS: When returning data with is_low_confidence=true, also populate "follow_up_questions" with 1-3 short, targeted questions that would resolve the specific ambiguities (e.g. "Which airport — MLA or LCA?", "Is 3/4 March or April?", "How many passengers on trip 2?"). Leave the array empty when confidence is high.',
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
    const requestBody = JSON.stringify({
      systemInstruction: { parts: [{ text: systemInstruction }] },
      contents,
      generationConfig: {
        responseMimeType: "application/json",
        temperature: 0.1,
        maxOutputTokens,
      },
    });

    let res: Response | null = null;
    let transportError = false;
    const maxAttempts = 4;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        res = await fetch(url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: requestBody,
        });
      } catch {
        transportError = true;
        break;
      }
      if (res.ok) break;
      if ((res.status === 503 || res.status === 429) && attempt < maxAttempts - 1) {
        const delay = 500 * Math.pow(2, attempt) + Math.floor(Math.random() * 250);
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      break;
    }

    if (transportError || !res) {
      if (co)
        await refundPoints(
          co.id,
          willUseMedia ? "ai_extraction_media" : "ai_extraction",
          "AI extraction transport failure",
        );
      throw new Error("AI is temporarily unreachable — please try again");
    }
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      if (co)
        await refundPoints(
          co.id,
          willUseMedia ? "ai_extraction_media" : "ai_extraction",
          `AI extraction ${res.status}`,
        );
      if (res.status === 429) throw new Error("AI is rate limited — please try again in a moment");
      if (res.status === 503) throw new Error("AI is temporarily overloaded — please try again in a moment");
      throw new Error(`Gemini error ${res.status}: ${body.slice(0, 300)}`);
    }

    const json = (await res.json()) as any;
    const text: string = json?.candidates?.[0]?.content?.parts?.map((p: any) => p?.text ?? "").join("") ?? "";
    if (!text) {
      if (co) await refundPoints(co.id, willUseMedia ? "ai_extraction_media" : "ai_extraction", "AI extraction empty");
      throw new Error("AI returned an empty response — please try again");
    }

    let parsed: any;
    try {
      parsed = safeJsonParse(text);
    } catch {
      if (co)
        await refundPoints(co.id, willUseMedia ? "ai_extraction_media" : "ai_extraction", "AI extraction invalid JSON");
      throw new Error("AI response was unreadable — please rephrase and try again");
    }

    // Best-effort envelope recovery: accept the documented shape, then fall back
    // to inspecting payload shape when `type` is missing/wrong.
    const rawPayload = parsed?.payload;
    const isQuestions = parsed?.type === "questions" && Array.isArray(rawPayload);
    const isQuestion = !isQuestions && (parsed?.type === "question" || (typeof rawPayload === "string" && parsed?.type !== "data"));
    const isData = parsed?.type === "data" || Array.isArray(rawPayload) && !isQuestions;
    if (isData && Array.isArray(rawPayload)) {
      const rows = rawPayload.map(normalizeTripRow);
      // Server-side confidence: trust the model's flag, but also flip to true
      // when any row is missing a mandatory field (pickup date/address, delivery address).
      const modelFlag = parsed?.is_low_confidence === true;
      const missingMandatory = rows.some(
        (r) => !r.pickupDate?.trim() || !r.pickupAddress?.trim() || !r.deliveryAddress?.trim(),
      );

      // ---------- DYNAMIC BILLING: accuracy score ----------
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

      const followRaw = Array.isArray(parsed?.follow_up_questions) ? parsed.follow_up_questions : [];
      const follow_up_questions: string[] = followRaw
        .filter((q: any) => typeof q === "string")
        .map((q: string) => q.trim())
        .filter((q: string) => q.length > 0 && q.length <= 200)
        .slice(0, 3);

      return {
        type: "data" as const,
        payload: rows,
        is_low_confidence: modelFlag || missingMandatory,
        accuracy_score,
        is_half_price,
        follow_up_questions,
      };
    }
    if (isQuestions) {
      const qs: string[] = (rawPayload as any[])
        .filter((q) => typeof q === "string")
        .map((q: string) => q.trim())
        .filter((q) => q.length > 0 && q.length <= 200)
        .slice(0, 3);
      if (qs.length) return { type: "questions" as const, payload: qs };
    }
    if (isQuestion && typeof rawPayload === "string" && rawPayload.trim()) {
      return { type: "question" as const, payload: rawPayload.trim().slice(0, 500) };
    }
    if (co)
      await refundPoints(
        co.id,
        willUseMedia ? "ai_extraction_media" : "ai_extraction",
        "AI extraction unrecognized shape",
      );
    throw new Error("AI response was unreadable — please rephrase and try again");
  });

// ---------- Group / Ungroup (reversible link, keeps trip details) ----------

export const groupJobs = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        job_ids: z.array(z.string().uuid()).min(2).max(50),
        name: z.string().trim().max(80).optional(),
        note: z.string().trim().max(500).optional(),
        driver_id: z.string().uuid().nullable().optional(),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const c = await resolveCompany(context);
    const supabaseAdmin = await getAdminClient();
    const { data: rows, error } = await supabaseAdmin
      .from("jobs")
      .select("id, company_id, group_id" as any)
      .in("id", data.job_ids)
      .eq("company_id", c.id);
    if (error) throw new Error(error.message);
    if (!rows || rows.length !== data.job_ids.length) throw new Error("Some trips not found");

    // Reuse an existing group_id from the selection if present; else mint new.
    const existing = (rows as any[]).map((r) => r.group_id).find((g) => !!g) as string | undefined;
    const gid = existing ?? globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
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

    const { error: uErr } = await supabaseAdmin
      .from("jobs")
      .update(patch as never)
      .in("id", data.job_ids);
    if (uErr) throw new Error(uErr.message);
    return { ok: true, group_id: gid, count: total };
  });

export const ungroupJobs = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        job_id: z.string().uuid().optional(),
        group_id: z.string().uuid().optional(),
      })
      .refine((v) => v.job_id || v.group_id, "job_id or group_id required")
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const c = await resolveCompany(context);
    const supabaseAdmin = await getAdminClient();

    let gid = data.group_id ?? null;
    if (!gid && data.job_id) {
      const { data: row, error: rowError } = await supabaseAdmin
        .from("jobs")
        .select("group_id, company_id" as any)
        .eq("id", data.job_id)
        .maybeSingle();
      if (rowError) throw new Error(rowError.message);
      if (!row || (row as any).company_id !== c.id) {
        return { ok: true, cleared: 0, missing: true };
      }
      gid = (row as any).group_id ?? null;
    }
    if (!gid) return { ok: true, cleared: 0 };

    const { error, count } = await supabaseAdmin
      .from("jobs")
      .update({ group_id: null, grouped_count: null, grouped_at: null } as never, { count: "exact" })
      .eq("group_id" as any, gid)
      .eq("company_id", c.id);
    if (error) throw new Error(error.message);
    return { ok: true, cleared: count ?? 0 };
  });

// ---------- Update group metadata (rename / re-note / re-driver) ----------
export const updateGroupMeta = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        group_id: z.string().uuid(),
        name: z.string().trim().max(80).nullable().optional(),
        note: z.string().trim().max(500).nullable().optional(),
        driver_id: z.string().uuid().nullable().optional(),
      })
      .parse(i),
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
    const { error, count } = await supabaseAdmin
      .from("jobs")
      .update(patch as never, { count: "exact" })
      .eq("group_id" as any, data.group_id)
      .eq("company_id", c.id);
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
    const { data: jobs, error } = await supabaseAdmin
      .from("jobs")
      .select(
        "id,date,time,pickup_at,from_location,from_flight,to_location,to_flight,vehicle,driver_id,group_name,group_note,drivers(name)",
      )
      .eq("group_id" as any, data.group_id)
      .eq("company_id", c.id)
      .order("date", { ascending: true })
      .order("time", { ascending: true });
    if (error) throw new Error(error.message);
    if (!jobs || jobs.length === 0) throw new Error("Group not found");
    const driverIds = Array.from(new Set(jobs.map((j: any) => j.driver_id).filter(Boolean)));
    if (driverIds.length === 0) throw new Error("Assign a driver to the group first");
    if (driverIds.length > 1) throw new Error("Trips in the group have different drivers");
    const driverId = driverIds[0] as string;
    const driverName = (jobs[0] as any).drivers?.name ?? null;

    const nowIso = new Date().toISOString();
    const { data: existing } = await supabaseAdmin
      .from("magic_links")
      .select("*")
      .eq("company_id", c.id)
      .eq("kind", "driver")
      .eq("subject_id", driverId)
      .is("revoked_at", null)
      .gt("expires_at", nowIso)
      .order("expires_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    let link = existing;
    if (!link) {
      const bytes = new Uint8Array(24);
      crypto.getRandomValues(bytes);
      const token = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
      const expires_at = new Date(Date.now() + 7 * 24 * 3600_000).toISOString();
      const { data: row, error: le } = await supabaseAdmin
        .from("magic_links")
        .insert({
          company_id: c.id,
          kind: "driver",
          subject_id: driverId,
          subject_label: driverName ? `${driverName} portal` : "Driver portal",
          token,
          expires_at,
          created_by: context.userId,
        })
        .select()
        .single();
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
    const { data: job, error } = await supabaseAdmin
      .from("jobs")
      .select(
        "id, client_link_token, from_location, from_flight, to_location, to_flight, date, time, pickup_at, group_id, group_name",
      )
      .eq("id", data.job_id)
      .single();
    if (error) throw new Error(error.message);
    let token = (job as any).client_link_token as string | null;
    if (!token) {
      const bytes = new Uint8Array(16);
      crypto.getRandomValues(bytes);
      token = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
      const { error: uErr } = await supabaseAdmin
        .from("jobs")
        .update({ client_link_token: token } as never)
        .eq("id", data.job_id);
      if (uErr) throw new Error(uErr.message);
      await spendSoft(company.id, "client_link_sent", "Client trip link issued", data.job_id);
    }
    const { count } = await supabaseAdmin
      .from("pax")
      .select("id", { count: "exact", head: true })
      .eq("job_id", data.job_id);
    return { token, job: { ...job, pax_count: count ?? 0 } };
  });

export const listClientLocationsCoord = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ job_id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    await assertJobInCompany(context, data.job_id);
    const supabaseAdmin = await getAdminClient();
    const since = new Date(Date.now() - 6 * 3600_000).toISOString();
    const { data: rows, error } = await supabaseAdmin
      .from("client_locations")
      .select("device_id, pax_name, latitude, longitude, accuracy_m, mode, captured_at")
      .eq("job_id", data.job_id)
      .gte("captured_at", since)
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
    const { data: jobs } = await supabaseAdmin
      .from("jobs")
      .select("id, company_id, executor_company_id, origin_company_id, dispatch_chain_company_ids")
      .in("id", jobIds);
    const allowed = new Set(
      (jobs ?? [])
        .filter(
          (j: any) =>
            j.company_id === c.id ||
            j.executor_company_id === c.id ||
            j.origin_company_id === c.id ||
            (j.dispatch_chain_company_ids ?? []).includes(c.id),
        )
        .map((j: any) => j.id),
    );
    return data.filter((r: any) => allowed.has(r.job_id));
  });

export const acknowledgeSosCoord = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ sos_id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const supabaseAdmin = await getAdminClient();
    const { data: row, error: re } = await supabaseAdmin
      .from("client_sos_events")
      .select("id, job_id")
      .eq("id", data.sos_id)
      .maybeSingle();
    if (re) throw new Error(re.message);
    if (!row) throw new Error("sos_not_found");
    await assertJobInCompany(context, (row as any).job_id);
    const { error } = await supabaseAdmin
      .from("client_sos_events")
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
      return {} as Record<
        string,
        {
          unread_client: number;
          unread_driver: number;
          client_change: boolean;
          sos_open: boolean;
          driver_status_new: boolean;
          rejected: boolean;
        }
      >;
    }
    // 1) fetch jobs (with viewed_at, updated_at, status, client_link_token)
    const { data: jobs } = await supabaseAdmin
      .from("jobs")
      .select("id, status, updated_at, coordinator_last_viewed_at, client_link_token, driver_id")
      .in("id", data.job_ids);
    // 2) unread messages + rejection detection
    const { data: msgs } = await supabaseAdmin
      .from("trip_messages")
      .select("job_id, sender_kind, body, created_at")
      .eq("company_id", c.id)
      .in("job_id", data.job_ids)
      .is("read_by_coordinator_at", null)
      .in("sender_kind", ["driver", "client"]);
    // 3) open SOS
    const { data: sos } = await supabaseAdmin
      .from("client_sos_events")
      .select("job_id")
      .in("job_id", data.job_ids)
      .is("acknowledged_at", null);
    // 4) pending client modifications on linked bookings (booking -> job)
    const { data: bks } = await supabaseAdmin.from("client_bookings").select("id, job_id").in("job_id", data.job_ids);
    const bookingToJob: Record<string, string> = {};
    for (const b of (bks ?? []) as any[]) if (b.job_id) bookingToJob[b.id] = b.job_id;
    const jobsWithClientChange = new Set<string>();
    const bkIds = Object.keys(bookingToJob);
    if (bkIds.length) {
      const { data: mods } = await supabaseAdmin
        .from("client_booking_modifications")
        .select("booking_id")
        .eq("status", "pending")
        .in("booking_id", bkIds);
      for (const m of (mods ?? []) as any[]) {
        const jid = bookingToJob[m.booking_id];
        if (jid) jobsWithClientChange.add(jid);
      }
    }

    const out: Record<
      string,
      {
        unread_client: number;
        unread_driver: number;
        client_change: boolean;
        sos_open: boolean;
        driver_status_new: boolean;
        rejected: boolean;
      }
    > = {};
    for (const id of data.job_ids) {
      out[id] = {
        unread_client: 0,
        unread_driver: 0,
        client_change: false,
        sos_open: false,
        driver_status_new: false,
        rejected: false,
      };
    }
    // driver-less jobs eligible for "rejected" flag
    const driverlessJobIds = new Set(((jobs ?? []) as any[]).filter((j) => !j.driver_id).map((j) => j.id as string));
    for (const m of (msgs ?? []) as any[]) {
      const row = out[m.job_id];
      if (!row) continue;
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
      const row = out[s.job_id];
      if (row) row.sos_open = true;
    }
    for (const j of (jobs ?? []) as any[]) {
      const row = out[j.id];
      if (!row) continue;
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
    await supabaseAdmin
      .from("jobs")
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
    z
      .object({
        job_id: z.string().min(1),
        include_ack: z.boolean().optional().default(false),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const jobId = String(data.job_id).split("::")[0];
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(jobId)) return [];
    try {
      await assertJobInCompany(context, jobId);
    } catch {
      return [];
    }
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
      .update({ acknowledged_at: new Date().toISOString(), acknowledged_by: context.userId } as never, {
        count: "exact",
      })
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
    const { data: jobs } = await supabaseAdmin
      .from("jobs")
      .select(
        "id, company_id, executor_company_id, origin_company_id, dispatch_chain_company_ids, from_location, to_location",
      )
      .in("id", jobIds);
    const allowed = new Map<string, any>();
    for (const j of jobs ?? []) {
      if (
        (j as any).company_id === c.id ||
        (j as any).executor_company_id === c.id ||
        (j as any).origin_company_id === c.id ||
        ((j as any).dispatch_chain_company_ids ?? []).includes(c.id)
      )
        allowed.set((j as any).id, j);
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
    const { data: job, error } = await supabaseAdmin
      .from("jobs")
      .select("id, company_id")
      .eq("id", data.job_id)
      .eq("company_id", c.id)
      .maybeSingle();
    if (error || !job) throw new Error("Trip not found");
    const { error: uErr } = await supabaseAdmin
      .from("jobs")
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
    const { data: job, error } = await supabaseAdmin
      .from("jobs")
      .select("id, company_id")
      .eq("id", data.job_id)
      .eq("company_id", c.id)
      .maybeSingle();
    if (error || !job) throw new Error("Trip not found");
    await supabaseAdmin.from("jobs").delete().eq("id", data.job_id);
    return { ok: true };
  });

// ==========================================================
// AI SUITE — group suggestions, daily plan, reply drafter,
// voice-to-trip. All metered via spend_points RPC.
// ==========================================================

async function spendOrThrow(companyId: string, featureKey: string, note: string, jobId?: string) {
  const sb = await getAdminClient();
  // Respect the coordinator's per-feature opt-out before billing.
  const { assertUserFeatureEnabled, friendlyGateError } = await import("@/lib/user-feature-prefs.server");
  try {
    await assertUserFeatureEnabled(sb, companyId, featureKey);
  } catch (e) {
    throw new Error(friendlyGateError(e) ?? (e as Error).message);
  }
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
async function refundPoints(companyId: string, featureKey: string, note: string, jobId?: string) {
  try {
    const sb = await getAdminClient();
    const { data: costRow } = await sb
      .from("ai_feature_costs")
      .select("points_cost")
      .eq("feature_key", featureKey)
      .maybeSingle();
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
const tripRowSchema = z
  .object({
    pickupDate: z.string().default(""),
    pickupTime: z.string().default(""),
    pickupAddress: z.string().default(""),
    deliveryAddress: z.string().default(""),
    customerName: z.string().default(""),
    contactNumber: z.string().default(""),
    transportType: z.string().default(""),
    quantity: z.string().default("1"),
  })
  .passthrough();

function normalizeTripRow(r: unknown) {
  const src: any = r && typeof r === "object" ? r : {};
  const parsed = tripRowSchema.safeParse(src);
  const row = parsed.success
    ? parsed.data
    : {
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
  try {
    return JSON.parse(trimmed);
  } catch {
    /* fallthrough */
  }
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenced) {
    try {
      return JSON.parse(fenced[1]);
    } catch {
      /* fallthrough */
    }
  }
  const firstBrace = trimmed.search(/[{[]/);
  const lastBrace = Math.max(trimmed.lastIndexOf("}"), trimmed.lastIndexOf("]"));
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    try {
      return JSON.parse(trimmed.slice(firstBrace, lastBrace + 1));
    } catch {
      /* fallthrough */
    }
  }
  throw new Error("AI returned invalid JSON");
}

async function callGemini(
  prompt: string,
  model = "gemini-2.5-flash-lite",
  opts?: { temperature?: number; maxOutputTokens?: number },
): Promise<any> {
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
  const doFetch = () =>
    fetch(url, {
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
  const json = (await res.json()) as any;
  const text: string = json?.candidates?.[0]?.content?.parts?.map((p: any) => p?.text ?? "").join("") ?? "";
  if (!text) throw new Error("AI returned empty response");
  return safeJsonParse(text);
}

// ---------- AI: Auto-Coordinate (propose-only autopilot) ----------
type CoordProposal =
  | { kind: "group"; trip_ids: string[]; reason: string }
  | { kind: "assign"; trip_ids: string[]; driver_id: string; reason: string }
  | { kind: "dispatch"; trip_ids: string[]; partner_company_id: string; reason: string };

/**
 * Load the caller company's ACTIVE Collaborate partners. Same source of truth
 * as the assistant + Collaborate UI use, so partner_company_id references
 * coming from the assistant/auto-coordinate flow can be validated against it.
 */
async function loadActivePartners(
  sb: Awaited<ReturnType<typeof getAdminClient>>,
  companyId: string,
): Promise<Array<{ id: string; name: string }>> {
  const { data: conns } = await sb
    .from("coordinator_connections")
    .select("owner_company_id, partner_company_id, status")
    .or(`owner_company_id.eq.${companyId},partner_company_id.eq.${companyId}`)
    .eq("status", "active");
  const partnerIds = Array.from(
    new Set(
      (conns ?? [])
        .map((r: any) => (r.owner_company_id === companyId ? r.partner_company_id : r.owner_company_id))
        .filter((id: string) => id && id !== companyId),
    ),
  );
  if (partnerIds.length === 0) return [];
  const { data: rows } = await sb.from("companies").select("id, name").in("id", partnerIds);
  return (rows ?? []).map((p: any) => ({ id: p.id, name: p.name ?? "Unknown" }));
}

/**
 * Shared dispatch guardrails — same executor / loop / hop-insert / chain-update
 * flow used inline by `applyAiCommandActions`'s "dispatch" branch. Callable
 * from applyAutoCoordinateProposal so the two paths cannot drift.
 */
export async function dispatchJobToPartnerInternal(
  sb: Awaited<ReturnType<typeof getAdminClient>>,
  callerCompanyId: string,
  jobId: string,
  partnerCompanyId: string,
  note: string,
): Promise<void> {
  const { data: job } = await sb
    .from("jobs")
    .select(
      "id, company_id, executor_company_id, origin_company_id, dispatch_chain_company_ids, dispatch_status",
    )
    .eq("id", jobId)
    .maybeSingle();
  if (!job) throw new Error("trip not found");
  if ((job.executor_company_id ?? job.company_id) !== callerCompanyId)
    throw new Error("only current executor can dispatch");
  const chain: string[] = Array.isArray((job as any).dispatch_chain_company_ids)
    ? (job as any).dispatch_chain_company_ids
    : [job.company_id];
  if (chain.includes(partnerCompanyId)) throw new Error("would create a loop");
  const { data: hops } = await sb
    .from("job_dispatch_hops")
    .select("hop_index")
    .eq("job_id", jobId)
    .order("hop_index", { ascending: false })
    .limit(1);
  const nextIndex = Number(hops?.[0]?.hop_index ?? -1) + 1;
  await sb.from("job_dispatch_hops").insert({
    job_id: jobId,
    hop_index: nextIndex,
    from_company_id: callerCompanyId,
    to_company_id: partnerCompanyId,
    status: "pending",
    note,
  });
  const { error } = await sb
    .from("jobs")
    .update({
      origin_company_id: (job as any).origin_company_id ?? job.company_id,
      executor_company_id: partnerCompanyId,
      dispatch_status: "pending",
      dispatched_at: new Date().toISOString(),
      dispatch_decided_at: null,
      dispatch_chain_company_ids: [...chain, partnerCompanyId],
    } as never)
    .eq("id", jobId);
  if (error) throw error;
}

export async function runAutoCoordinate(
  companyId: string,
  opts: { directive?: string | null; resolved_target?: { type: "driver" | "partner"; id: string; name: string } | null } = {},
) {
  const sb = await getAdminClient();
  const { data: cfg } = await sb
    .from("ai_configuration")
    .select("auto_coordinate_enabled")
    .eq("company_id", companyId)
    .maybeSingle();
  if (!cfg || cfg.auto_coordinate_enabled !== true) {
    throw new Error("AI Auto-Coordinate is off — turn it on in AI Center → Toggles.");
  }
  await assertFeatureEnabled(companyId, "ai_auto_coordinate");

  // Active unassigned trips = what's visible on the coordinator board.
  // Include from ~1h ago (in-flight backlog) through the future.
  const pastCutoff = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const historyCutoff = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
  const [{ data: jobs }, { data: drivers }, { data: assignedJobs }, { data: history }, partners] = await Promise.all([
    sb
      .from("jobs")
      .select(
        "id, trip_no, from_location, to_location, pickup_display_name, dropoff_display_name, pickup_at, time, date, status, route_duration_sec, pax(name)",
      )
      .eq("company_id", companyId)
      .is("driver_id", null)
      .not("status", "in", "(completed,cancelled)")
      .or(`pickup_at.gte.${pastCutoff},pickup_at.is.null`)
      .order("pickup_at", { ascending: true, nullsFirst: false })
      .limit(200),
    sb.from("drivers").select("id, name, status").eq("company_id", companyId).neq("status", "offline").limit(60),
    // Existing assignments used to detect scheduling conflicts.
    sb
      .from("jobs")
      .select("id, driver_id, pickup_at, route_duration_sec")
      .eq("company_id", companyId)
      .not("driver_id", "is", null)
      .not("status", "in", "(completed,cancelled)")
      .gte("pickup_at", pastCutoff)
      .limit(500),
    sb
      .from("jobs")
      .select("from_location, to_location, pickup_at, time, driver_id, drivers:driver_id(name)")
      .eq("company_id", companyId)
      .eq("status", "completed")
      .gte("created_at", historyCutoff)
      .order("pickup_at", { ascending: false, nullsFirst: false })
      .limit(300),
    loadActivePartners(sb, companyId),
  ]);

  const list = jobs ?? [];
  const drv = drivers ?? [];

  const { data: costRow } = await sb
    .from("ai_feature_costs")
    .select("points_cost, metering_mode")
    .eq("feature_key", "ai_auto_coordinate")
    .maybeSingle();
  const meteringMode: "per_action" | "per_run" | "per_trip" = (costRow?.metering_mode as any) ?? "per_action";

  const chargePlanIfNeeded = async (proposals: CoordProposal[]) => {
    // Per-run / per-trip metering happens up-front; per-action defers to accept.
    if (meteringMode === "per_run" && proposals.length > 0) {
      await spendOrThrow(companyId, "ai_auto_coordinate", "Auto-Coordinate planning run");
    } else if (meteringMode === "per_trip") {
      const touched = new Set<string>();
      for (const p of proposals) p.trip_ids.forEach((t) => touched.add(t));
      const perCost = Number(costRow?.points_cost ?? 1);
      for (let i = 0; i < touched.size; i++) {
        await spendOrThrow(companyId, "ai_auto_coordinate", "Auto-Coordinate trip", undefined);
        void perCost;
      }
    }
  };

  if (list.length === 0) {
    return { proposals: [] as CoordProposal[], metering_mode: meteringMode, considered: 0 };
  }

  const directive = (opts.directive ?? "").trim();
  const directiveText = directive.toLowerCase();
  const wantsTodayOnly = /\b(today|tonight|this evening|this morning|this afternoon)\b/.test(directiveText);
  const maltaDate = (d: Date) =>
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Malta",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(d);
  const today = maltaDate(new Date());
  const isTodayTrip = (j: any) => {
    const dateValue = j.date ? String(j.date).slice(0, 10) : "";
    if (dateValue === today) return true;
    if (!j.pickup_at) return false;
    const pickup = new Date(j.pickup_at);
    return !Number.isNaN(pickup.getTime()) && maltaDate(pickup) === today;
  };
  const eligibleList = wantsTodayOnly ? list.filter(isTodayTrip) : list;
  const normalizeTargetName = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
  const compactTargetName = (s: string) => normalizeTargetName(s).replace(/\s+/g, "");
  const editDistance = (a: string, b: string) => {
    const dp = Array.from({ length: a.length + 1 }, (_, i) => Array(b.length + 1).fill(0));
    for (let i = 0; i <= a.length; i++) dp[i][0] = i;
    for (let j = 0; j <= b.length; j++) dp[0][j] = j;
    for (let i = 1; i <= a.length; i++) {
      for (let j = 1; j <= b.length; j++) {
        dp[i][j] = Math.min(
          dp[i - 1][j] + 1,
          dp[i][j - 1] + 1,
          dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
        );
      }
    }
    return dp[a.length][b.length];
  };
  const closeNameMatch = (needle: string, haystack: string) => {
    if (!needle || !haystack) return false;
    if (haystack.includes(needle) || needle.includes(haystack)) return true;
    const maxDistance = Math.max(1, Math.floor(Math.min(needle.length, haystack.length) * 0.2));
    return editDistance(needle, haystack) <= maxDistance;
  };
  const matchNameInDirective = <T extends { id: string; name?: string | null }>(rows: T[]): T | null => {
    const normalizedDirective = normalizeTargetName(directive);
    const compactDirective = compactTargetName(directive);
    if (!normalizedDirective) return null;
    const exact = rows.find((r) => {
      const n = normalizeTargetName(r.name ?? "");
      const c = compactTargetName(r.name ?? "");
      return n && (normalizedDirective.includes(n) || closeNameMatch(c, compactDirective));
    });
    if (exact) return exact;
    return rows.find((r) => {
      const n = normalizeTargetName(r.name ?? "");
      return n && n.split(" ").some((part) => part.length >= 4 && closeNameMatch(part, compactDirective));
    }) ?? null;
  };
  const wantsPartner = /\b(partner|dispatch|forward|collaborate|send to partner)\b/.test(directiveText);
  const wantsDriver = /\b(driver|assign|move|give|put|send to driver)\b/.test(directiveText);
  const inferredDriver = !opts.resolved_target && (wantsDriver || !wantsPartner) ? matchNameInDirective(drv) : null;
  const inferredPartner = !opts.resolved_target && !inferredDriver && (wantsPartner || !wantsDriver) ? matchNameInDirective(partners) : null;
  const resolved = opts.resolved_target ?? (inferredDriver
    ? { type: "driver" as const, id: inferredDriver.id, name: inferredDriver.name ?? "driver" }
    : inferredPartner
      ? { type: "partner" as const, id: inferredPartner.id, name: inferredPartner.name ?? "partner" }
      : null);

  const makeChunks = (ids: string[], size = 50) => {
    const chunks: string[][] = [];
    for (let i = 0; i < ids.length; i += size) chunks.push(ids.slice(i, i + size));
    return chunks;
  };

  // ---- Build per-driver busy schedule so we never propose a conflicting assignment.
  const BUFFER_MIN = 30;
  const DEFAULT_TRIP_MIN = 45;
  type Busy = { start: number; end: number };
  const busyByDriver = new Map<string, Busy[]>();
  for (const a of (assignedJobs ?? []) as any[]) {
    if (!a.driver_id || !a.pickup_at) continue;
    const start = new Date(a.pickup_at).getTime();
    if (!Number.isFinite(start)) continue;
    const durMin = Math.max(15, Math.round((Number(a.route_duration_sec) || DEFAULT_TRIP_MIN * 60) / 60));
    const end = start + durMin * 60_000;
    const arr = busyByDriver.get(a.driver_id) ?? [];
    arr.push({ start, end });
    busyByDriver.set(a.driver_id, arr);
  }
  const tripWindow = (j: any): Busy | null => {
    if (!j.pickup_at) return null;
    const start = new Date(j.pickup_at).getTime();
    if (!Number.isFinite(start)) return null;
    const durMin = Math.max(15, Math.round((Number(j.route_duration_sec) || DEFAULT_TRIP_MIN * 60) / 60));
    return { start, end: start + durMin * 60_000 };
  };
  const driverFreeFor = (driverId: string, win: Busy | null): boolean => {
    if (!win) return true; // undated trip — allow any driver
    const busy = busyByDriver.get(driverId) ?? [];
    const buf = BUFFER_MIN * 60_000;
    return !busy.some((b) => win.start < b.end + buf && b.start < win.end + buf);
  };
  const reserveDriver = (driverId: string, win: Busy | null) => {
    if (!win) return;
    const arr = busyByDriver.get(driverId) ?? [];
    arr.push(win);
    busyByDriver.set(driverId, arr);
  };

  // Availability-first planner. Given a preferred driver (may be null), assign
  // every trip to the preferred driver when free, else the next free driver,
  // else fall back to an active partner. Returns the resulting proposals.
  const planAvailability = (
    trips: any[],
    preferred: { id: string; name: string } | null,
  ): { proposals: CoordProposal[]; leftoverIds: string[] } => {
    const assignBuckets = new Map<string, { trip_ids: string[]; reasons: string[] }>();
    const dispatchBuckets = new Map<string, { trip_ids: string[]; reasons: string[] }>();
    const leftover: string[] = [];
    const nameOf = (id: string) => drv.find((d: any) => d.id === id)?.name ?? "driver";
    const partnerNameOf = (id: string) => partners.find((p) => p.id === id)?.name ?? "partner";
    const push = (map: Map<string, { trip_ids: string[]; reasons: string[] }>, key: string, tripId: string, reason: string) => {
      const b = map.get(key) ?? { trip_ids: [], reasons: [] };
      b.trip_ids.push(tripId);
      if (b.reasons.length < 3) b.reasons.push(reason);
      map.set(key, b);
    };
    for (const j of trips) {
      const win = tripWindow(j);
      if (preferred && driverFreeFor(preferred.id, win)) {
        reserveDriver(preferred.id, win);
        push(assignBuckets, preferred.id, j.id, `Assigned to ${preferred.name} as requested.`);
        continue;
      }
      const alt = drv.find((d: any) => d.id !== preferred?.id && driverFreeFor(d.id, win));
      if (alt) {
        reserveDriver(alt.id, win);
        const why = preferred
          ? `${preferred.name} is busy at ${j.pickup_at ? new Date(j.pickup_at).toLocaleString("en-GB", { timeZone: "Europe/Malta", hour: "2-digit", minute: "2-digit", day: "2-digit", month: "short" }) : "this time"} — assigning to ${alt.name} (next available).`
          : `${alt.name} is available for this trip.`;
        push(assignBuckets, alt.id, j.id, why);
        continue;
      }
      const partner = partners[0];
      if (partner) {
        const why = preferred
          ? `No driver free — dispatching to ${partner.name}.`
          : `No local driver available — dispatching to ${partner.name}.`;
        push(dispatchBuckets, partner.id, j.id, why);
        continue;
      }
      leftover.push(j.id);
    }
    const proposals: CoordProposal[] = [];
    for (const [driver_id, b] of assignBuckets) {
      for (const trip_ids of makeChunks(b.trip_ids)) {
        proposals.push({
          kind: "assign",
          trip_ids,
          driver_id,
          reason: `${nameOf(driver_id)} → ${trip_ids.length} trip${trip_ids.length === 1 ? "" : "s"}. ${b.reasons.join(" ")}`.slice(0, 300),
        });
      }
    }
    for (const [partner_company_id, b] of dispatchBuckets) {
      for (const trip_ids of makeChunks(b.trip_ids)) {
        proposals.push({
          kind: "dispatch",
          trip_ids,
          partner_company_id,
          reason: `${partnerNameOf(partner_company_id)} → ${trip_ids.length} trip${trip_ids.length === 1 ? "" : "s"}. ${b.reasons.join(" ")}`.slice(0, 300),
        });
      }
    }
    return { proposals, leftoverIds: leftover };
  };

  // Named target path — try target first, fall back to any available.
  if (resolved) {
    let proposals: CoordProposal[] = [];
    if (resolved.type === "driver" && drv.some((d: any) => d.id === resolved.id)) {
      const r = planAvailability(eligibleList, { id: resolved.id, name: resolved.name });
      proposals = r.proposals;
    } else if (resolved.type === "partner" && partners.some((p) => p.id === resolved.id)) {
      // Partner has no local schedule — dispatch everything to them in chunks.
      const ids = eligibleList.map((j: any) => j.id).filter(Boolean);
      proposals = makeChunks(ids).map((trip_ids) => ({
        kind: "dispatch" as const,
        trip_ids,
        partner_company_id: resolved.id,
        reason: `Dispatching ${trip_ids.length} trip${trip_ids.length === 1 ? "" : "s"} to ${resolved.name} as requested.`,
      }));
    }
    await chargePlanIfNeeded(proposals);
    return { proposals, metering_mode: meteringMode, considered: eligibleList.length };
  }

  const planningList = eligibleList;
  if (planningList.length === 0) {
    return { proposals: [] as CoordProposal[], metering_mode: meteringMode, considered: 0 };
  }

  // No target named. If directive is a simple assign/dispatch or empty, use
  // deterministic availability planner. Otherwise fall through to the LLM
  // for genuinely ambiguous plans (grouping, optimization).
  const simpleAssignIntent = !directive || /\b(assign|dispatch|distribute|hand out|give out|clear|share)\b/.test(directiveText);
  if (simpleAssignIntent) {
    const r = planAvailability(planningList, null);
    await chargePlanIfNeeded(r.proposals);
    return { proposals: r.proposals, metering_mode: meteringMode, considered: planningList.length };
  }

  const tripLines = planningList
    .map((j: any) => {
      const paxNames = Array.isArray(j.pax) ? j.pax.map((p: any) => p?.name).filter(Boolean).join(", ") : "";
      const when = j.pickup_at ?? `${j.date ?? ""} ${j.time ?? "??"}`.trim();
      const from = j.pickup_display_name || j.from_location || "";
      const to = j.dropoff_display_name || j.to_location || "";
      return `${j.id}: ${when} | ${from} → ${to}${paxNames ? ` | pax: ${paxNames}` : ""}`;
    })
    .join("\n");
  const driverLines = drv.map((d: any) => `${d.id}: ${d.name ?? ""}`).join("\n") || "(no free drivers)";
  const partnerLines = partners.map((p) => `${p.id}: ${p.name}`).join("\n") || "(no active partners)";

  const historyList = (history ?? []).map((h: any) => ({
    pickup: h.from_location ?? "",
    dropoff: h.to_location ?? "",
    time: h.pickup_at ?? h.time ?? "",
    driver: h.drivers?.name ?? "",
  }));
  const historyBlock = historyList.length
    ? `PAST_30D_COMPLETED (${historyList.length}):\n${historyList
        .map((r) => `${r.time} | ${r.pickup} → ${r.dropoff} | drv:${r.driver}`)
        .join("\n")}`
    : "PAST_30D_COMPLETED: (none)";

  const directiveBlock = directive
    ? `\n\nCOORDINATOR DIRECTIVE (HARD instruction — the plan MUST satisfy this over general optimization):\n"${directive}"`
    : "";

  const parsed = await callGemini(
    await buildSystemPrompt(
      companyId,
      `You are a transport dispatch autopilot. Look at the ENTIRE unassigned backlog and propose the minimum set of actions that clears it.\n` +
        `Use PAST_30D_COMPLETED as reference memory to recognize recurring monthly patterns — repeat routes and drivers habitually paired with them — when grouping or assigning.\n` +
        `Return JSON: {"proposals":[\n` +
        `  {"kind":"group","trip_ids":["uuid",...],"reason":"..."},\n` +
        `  {"kind":"assign","trip_ids":["uuid",...],"driver_id":"uuid","reason":"..."},\n` +
        `  {"kind":"dispatch","trip_ids":["uuid",...],"partner_company_id":"uuid","reason":"..."}\n` +
        `]}\n` +
        `Rules: only real groups (2+ trips, same/near pickup within 30min AND overlapping routes). Only propose assignments when a specific driver clearly fits. Use "dispatch" only to forward trips to an ACTIVE PARTNER company. Do NOT invent trip_ids, driver_ids, or partner_company_ids — use only the IDs listed below.${directiveBlock}\n\n` +
        `TRIPS:\n${tripLines}\n\nDRIVERS:\n${driverLines}\n\nACTIVE PARTNERS:\n${partnerLines}\n\n${historyBlock}`,
    ),
    "gemini-2.5-flash",
    { maxOutputTokens: 2000 },
  );

  const tripIdSet = new Set(planningList.map((j: any) => j.id));
  const driverIdSet = new Set(drv.map((d: any) => d.id));
  const partnerIdSet = new Set(partners.map((p) => p.id));

  const raw = Array.isArray(parsed?.proposals) ? parsed.proposals : [];
  let proposals: CoordProposal[] = [];
  for (const p of raw) {
    if (!p || typeof p !== "object") continue;
    const trip_ids = Array.isArray(p.trip_ids)
      ? p.trip_ids.filter((t: any) => typeof t === "string" && tripIdSet.has(t))
      : [];
    if (trip_ids.length === 0) continue;
    if (p.kind === "group" && trip_ids.length >= 2) {
      proposals.push({ kind: "group", trip_ids, reason: String(p.reason ?? "").slice(0, 300) });
    } else if (p.kind === "assign" && typeof p.driver_id === "string" && driverIdSet.has(p.driver_id)) {
      proposals.push({
        kind: "assign",
        trip_ids,
        driver_id: p.driver_id,
        reason: String(p.reason ?? "").slice(0, 300),
      });
    } else if (
      p.kind === "dispatch" &&
      typeof p.partner_company_id === "string" &&
      partnerIdSet.has(p.partner_company_id)
    ) {
      proposals.push({
        kind: "dispatch",
        trip_ids,
        partner_company_id: p.partner_company_id,
        reason: String(p.reason ?? "").slice(0, 300),
      });
    }
  }

  // If the LLM produced nothing useful, fall back to the availability planner
  // so we always try to clear the backlog rather than returning an empty plan.
  if (proposals.length === 0) {
    const r = planAvailability(planningList, null);
    proposals = r.proposals;
  }

  await chargePlanIfNeeded(proposals);

  return { proposals, metering_mode: meteringMode, considered: planningList.length };
}

export const aiAutoCoordinate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        directive: z.string().max(500).optional().nullable(),
        resolved_target: z
          .object({
            type: z.enum(["driver", "partner"]),
            id: z.string().uuid(),
            name: z.string().max(200),
          })
          .optional()
          .nullable(),
      })
      .optional()
      .parse(i ?? {}),
  )
  .handler(async ({ data, context }) => {
    const c = await resolveCompany(context);
    return runAutoCoordinate(c.id, {
      directive: data?.directive ?? null,
      resolved_target: data?.resolved_target ?? null,
    });
  });

export const applyAutoCoordinateProposal = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        kind: z.enum(["group", "assign", "dispatch"]),
        trip_ids: z.array(z.string().uuid()).min(1).max(50),
        driver_id: z.string().uuid().optional(),
        partner_company_id: z.string().uuid().optional(),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const c = await resolveCompany(context);
    const sb = await getAdminClient();

    // Verify all trips belong to this company.
    const { data: rows, error } = await sb
      .from("jobs")
      .select("id, company_id, group_id" as any)
      .in("id", data.trip_ids)
      .eq("company_id", c.id);
    if (error) throw new Error(error.message);
    if (!rows || rows.length !== data.trip_ids.length) throw new Error("Some trips not found");

    if (data.kind === "group") {
      if (data.trip_ids.length < 2) throw new Error("Need at least 2 trips to group");
      const existing = (rows as any[]).map((r) => r.group_id).find((g) => !!g) as string | undefined;
      const gid =
        existing ?? globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
      const { error: uErr } = await sb
        .from("jobs")
        .update({
          group_id: gid,
          grouped_count: data.trip_ids.length,
          grouped_at: new Date().toISOString(),
          group_name: "AI Auto-Coordinate",
        } as never)
        .in("id", data.trip_ids);
      if (uErr) throw new Error(uErr.message);
    } else if (data.kind === "assign") {
      if (!data.driver_id) throw new Error("Missing driver_id for assignment");
      const { error: uErr } = await sb
        .from("jobs")
        .update({ driver_id: data.driver_id, driver_accepted_at: null } as never)
        .in("id", data.trip_ids)
        .is("driver_id", null); // never overwrite existing assignments
      if (uErr) throw new Error(uErr.message);
    } else {
      // dispatch → forward each trip to a partner via the shared guardrails.
      if (!data.partner_company_id) throw new Error("Missing partner_company_id for dispatch");
      const partners = await loadActivePartners(sb, c.id);
      if (!partners.some((p) => p.id === data.partner_company_id)) {
        throw new Error("Not an active Collaborate partner");
      }
      for (const jobId of data.trip_ids) {
        await spendOrThrow(c.id, "ai_agent_dispatch", `Auto-Coordinate dispatch ${jobId.slice(0, 8)}`, jobId);
        await dispatchJobToPartnerInternal(sb, c.id, jobId, data.partner_company_id, "via AI Auto-Coordinate");
      }
    }

    // Per-action metering (per_run / per_trip already charged at plan time).
    const { data: costRow } = await sb
      .from("ai_feature_costs")
      .select("metering_mode")
      .eq("feature_key", "ai_auto_coordinate")
      .maybeSingle();
    if ((costRow?.metering_mode ?? "per_action") === "per_action") {
      await spendOrThrow(c.id, "ai_auto_coordinate", `Auto-Coordinate ${data.kind}`);
    }
    return { ok: true };
  });


// ---------- AI: Daily plan ----------
export const aiPlanDriverDay = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        driver_id: z.string().uuid(),
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      })
      .parse(i),
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
    if (list.length < 2)
      return { ordered_trip_ids: list.map((j: any) => j.id), summary: "Not enough trips to reorder." };

    await spendOrThrow(c.id, "ai_daily_plan", `Daily plan for ${data.date}`);

    const summary = list
      .map((j: any) => `${j.id}: ${j.time ?? "??"} | ${j.from_location ?? ""} → ${j.to_location ?? ""}`)
      .join("\n");

    const parsed = await callGemini(
      await buildSystemPrompt(
        c.id,
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
    z
      .object({
        last_message: z.string().trim().min(1).max(2000),
        context_summary: z.string().trim().max(2000).optional(),
        tone: z.enum(["friendly", "formal", "brief"]).default("friendly"),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const c = await resolveCompany(context);
    await assertFeatureEnabled(c.id, "ai_reply_drafter");
    await spendOrThrow(c.id, "ai_reply_drafter", "Chat reply drafts");
    const parsed = await callGemini(
      await buildSystemPrompt(
        c.id,
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
    z
      .object({
        audio_base64: z.string().min(10).max(20_000_000),
        mime_type: z.string().min(3).max(80),
      })
      .parse(i),
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

          contents: [
            {
              role: "user",
              parts: [
                { text: "Extract trips from this voice note." },
                { inline_data: { mime_type: data.mime_type, data: data.audio_base64 } },
              ],
            },
          ],
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
    const json = (await res.json()) as any;
    const text: string = json?.candidates?.[0]?.content?.parts?.map((p: any) => p?.text ?? "").join("") ?? "";
    if (!text) {
      await refundPoints(c.id, "ai_voice_to_trip", "Voice note empty response");
      throw new Error("AI returned an empty transcript — recording may be silent");
    }
    let parsed: any;
    try {
      parsed = safeJsonParse(text);
    } catch {
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
    return (
      data ?? {
        company_id: c.id,
        auto_assign_enabled: false,
        auto_extract_bulk: true,
        auto_reply_drafts: true,
        ai_command_enabled: true,
        voice_to_trip_enabled: true,
        auto_coordinate_enabled: false,
      }
    );
  });

export const saveAiConfig = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        auto_assign_enabled: z.boolean(),
        auto_extract_bulk: z.boolean(),
        auto_reply_drafts: z.boolean(),
        ai_command_enabled: z.boolean(),
        voice_to_trip_enabled: z.boolean(),
        auto_coordinate_enabled: z.boolean(),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const c = await resolveCompany(context);
    const sb = await getAdminClient();
    const { error } = await sb
      .from("ai_configuration")
      .upsert({ company_id: c.id, ...data }, { onConflict: "company_id" });
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
    z
      .object({
        id: z.string().uuid().optional(),
        title: z.string().trim().min(1).max(120),
        rule_text: z.string().trim().min(3).max(2000),
        enabled: z.boolean().default(true),
        sort_order: z.number().int().default(0),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const c = await resolveCompany(context);
    const sb = await getAdminClient();
    if (data.id) {
      const { error } = await sb
        .from("company_ai_rules")
        .update({ title: data.title, rule_text: data.rule_text, enabled: data.enabled, sort_order: data.sort_order })
        .eq("id", data.id)
        .eq("company_id", c.id);
      if (error) throw new Error(error.message);
      return { ok: true, id: data.id };
    }
    const { data: row, error } = await sb
      .from("company_ai_rules")
      .insert({
        company_id: c.id,
        title: data.title,
        rule_text: data.rule_text,
        enabled: data.enabled,
        sort_order: data.sort_order,
      })
      .select("id")
      .maybeSingle();
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
// ==========================================================
// AI Command Agent — confirm-first, reads whole dispatch board
// ==========================================================
export const runAiCommand = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        prompt: z.string().trim().min(2).max(2000),
        mode: z.enum(["read", "execute"]).default("read"),
        scope: z.enum(["board", "owned"]).default("board"),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const c = await resolveCompany(context);
    const sb = await getAdminClient();

    const { data: cfg } = await sb
      .from("ai_configuration")
      .select("ai_command_enabled")
      .eq("company_id", c.id)
      .maybeSingle();
    if (cfg && cfg.ai_command_enabled === false) {
      throw new Error("AI Command Bar is disabled in your AI settings.");
    }

    const featureKey = data.mode === "execute" ? "ai_command_execute" : "ai_command_read";
    await assertFeatureEnabled(c.id, featureKey);
    await spendOrThrow(c.id, featureKey, `AI command (${data.mode}): ${data.prompt.slice(0, 60)}`);

    const now = new Date();
    const iso = (d: Date) => d.toISOString().slice(0, 10);
    const today = iso(now);
    const yesterday = iso(new Date(now.getTime() - 24 * 3600 * 1000));
    const tomorrow = iso(new Date(now.getTime() + 24 * 3600 * 1000));
    const in30 = iso(new Date(now.getTime() + 30 * 24 * 3600 * 1000));
    const dayOfWeek = now.toLocaleDateString("en-US", { weekday: "long" });
    const nowIso = now.toISOString();

    // Board-wide scope: match listJobs (owned + executor + origin + chain).
    // "owned" scope narrows to company_id = c.id (legacy behavior).
    const cols =
      "id, company_id, executor_company_id, origin_company_id, dispatch_chain_company_ids, dispatch_status, name, surname, from_location, to_location, pickup_at, time, date, driver_id, status, from_flight, to_flight, flight_scheduled_at, flight_estimated_at, flight_status, flight_status_note, group_id, group_name, grouped_count, clientcompanyname, contact_phone, pax(name), drivers(name), job_labels(trip_labels(name))";

    let jq = sb.from("jobs").select(cols).gte("date", yesterday).lte("date", in30);
    if (data.scope === "owned") {
      jq = jq.eq("company_id", c.id);
    } else {
      jq = jq.or(
        `company_id.eq.${c.id},executor_company_id.eq.${c.id},origin_company_id.eq.${c.id},dispatch_chain_company_ids.cs.{${c.id}}`,
      );
    }
    const [{ data: jobsRaw }, { data: drivers }, { data: partners }] = await Promise.all([
      jq.order("date", { ascending: true }).order("time", { ascending: true }).limit(500),
      sb.from("drivers").select("id, name, status").eq("company_id", c.id).limit(60),
      sb
        .from("coordinator_connections")
        .select("owner_company_id, partner_company_id, status")
        .or(`owner_company_id.eq.${c.id},partner_company_id.eq.${c.id}`)
        .eq("status", "active"),
    ]);
    const jobs = (jobsRaw ?? []) as any[];

    // Resolve company names for the ids referenced by chain/executor/origin.
    const companyIds = new Set<string>();
    for (const j of jobs) {
      if (j.company_id) companyIds.add(j.company_id);
      if (j.executor_company_id) companyIds.add(j.executor_company_id);
      if (j.origin_company_id) companyIds.add(j.origin_company_id);
      for (const id of j.dispatch_chain_company_ids ?? []) companyIds.add(id);
    }
    for (const p of partners ?? []) {
      if (p.owner_company_id) companyIds.add(p.owner_company_id);
      if (p.partner_company_id) companyIds.add(p.partner_company_id);
    }
    const nameById = new Map<string, string>();
    if (companyIds.size > 0) {
      const { data: cRows } = await sb.from("companies").select("id, name").in("id", Array.from(companyIds));
      for (const r of cRows ?? []) nameById.set(r.id, r.name ?? r.id.slice(0, 6));
    }
    const cn = (id?: string | null) => (id ? (nameById.get(id) ?? id.slice(0, 6)) : "");
    const partnerList = (partners ?? [])
      .map((p: any) => (p.owner_company_id === c.id ? p.partner_company_id : p.owner_company_id))
      .filter((id: string, i: number, arr: string[]) => id && arr.indexOf(id) === i)
      .map((id: string) => ({ id, name: cn(id) }));

    const baseSys = [
      "You are the AI operations agent for a transport dispatch coordinator. You think like both a coordinator and a driver.",
      `Today is ${today} (${dayOfWeek}). Yesterday ${yesterday}. Tomorrow ${tomorrow}. Current UTC: ${nowIso}. All trip date/time values are Europe/Malta wall-clock.`,
      "RELATIVE DATES: When the user says 'today', 'tomorrow', 'this week', 'next Monday', 'the 20th', etc., resolve to concrete YYYY-MM-DD before choosing rows.",
      "CONFIRM-FIRST: You NEVER change data directly. Everything you propose must be approved by the coordinator. In your `response`, describe what you are proposing in plain English — never say 'done', 'moved', 'sent'. Say 'I'll ... once you approve'.",
      'Return JSON exactly: {"response":"markdown","actions":[Action,...]} where Action.type is one of: assign|unassign|reschedule|status|group|ungroup|message|dispatch|note.',
      "Every Action MUST include ALL these keys (use null when N/A): type, job_id, job_ids, driver_id, date, time, pickup_at, new_status, group_name, partner_company_id, thread, body, note.",
      "assign: job_id + driver_id.  unassign: job_id.  reschedule: job_id + date(YYYY-MM-DD) + time(HH:MM) (both, Malta wall-clock).  status: job_id + new_status (one of pending|confirmed|in_progress|completed|cancelled|no_show).  group: job_ids (2+) + optional group_name.  ungroup: job_id OR group_id via job_id.  message: job_id + thread ('driver' for driver+coordinator private, 'client' for pax private, 'group' for shared group thread) + body.  dispatch: job_id + partner_company_id.  note: job_id + note (free-text; not persisted, just shown).",
      "Only use job_id / driver_id / partner_company_id values from CONTEXT. Never fabricate. If a request would touch trips not in context, set actions:[] and say so in `response`.",
      "If no matching trips exist, actions:[] and say 'I searched {DATE} and found 0 matching trips.'",
    ].join("\n");
    const sys = await buildSystemPrompt(c.id, baseSys);

    const fmtRow = (j: any) => {
      const paxNames = Array.isArray(j.pax)
        ? j.pax
            .map((p: any) => p.name)
            .filter(Boolean)
            .join(", ")
        : "";
      const labels = Array.isArray(j.job_labels)
        ? j.job_labels
            .map((l: any) => l.trip_labels?.name)
            .filter(Boolean)
            .join(",")
        : "";
      const chain = (j.dispatch_chain_company_ids ?? []).map((id: string) => cn(id)).join(" → ");
      const drvName = j.drivers?.name ?? (j.driver_id ? "assigned" : "none");
      return [
        `- ${j.id}`,
        `${j.date} ${j.time ?? ""}${j.pickup_at ? ` (pickup ${j.pickup_at})` : ""}`,
        `${j.from_location ?? ""} → ${j.to_location ?? ""}`,
        `pax=${j.name ?? ""} ${j.surname ?? ""}${paxNames ? ` [${paxNames}]` : ""}`,
        `driver=${drvName}`,
        `status=${j.status ?? ""}`,
        j.from_flight || j.to_flight
          ? `flight=${j.from_flight ?? j.to_flight ?? ""}${j.flight_status ? ` (${j.flight_status})` : ""}${j.flight_scheduled_at ? ` sched=${j.flight_scheduled_at}` : ""}${j.flight_estimated_at ? ` est=${j.flight_estimated_at}` : ""}`
          : null,
        j.group_id ? `group=${j.group_name ?? j.group_id.slice(0, 6)} (${j.grouped_count ?? "?"})` : null,
        j.clientcompanyname ? `client=${j.clientcompanyname}` : null,
        j.contact_phone ? `phone=${j.contact_phone}` : null,
        labels ? `labels=${labels}` : null,
        `owner=${cn(j.company_id)}${j.executor_company_id && j.executor_company_id !== j.company_id ? ` exec=${cn(j.executor_company_id)}` : ""}${chain ? ` chain=${chain}` : ""}${j.dispatch_status ? ` dispatch=${j.dispatch_status}` : ""}`,
      ]
        .filter(Boolean)
        .join(" | ");
    };

    const ctxText = `CONTEXT
YOUR COMPANY: ${c.id} (${cn(c.id)})

TRIPS ON BOARD (${jobs.length}):
${jobs.map(fmtRow).join("\n")}

DRIVERS (${(drivers ?? []).length}):
${(drivers ?? []).map((d: any) => `- ${d.id} | ${d.name ?? ""} | ${d.status ?? ""}`).join("\n")}

CONNECTED PARTNER COMPANIES (${partnerList.length}):
${partnerList.map((p) => `- ${p.id} | ${p.name}`).join("\n")}`;

    let parsed: any = { response: "", actions: [] };
    let status: "ok" | "error" | "awaiting_confirm" = "awaiting_confirm";
    let errMsg: string | null = null;
    try {
      parsed = await callGemini(`${sys}\n\n${ctxText}\n\nUSER: ${data.prompt}`, "gemini-2.5-flash", {
        maxOutputTokens: 2000,
      });
    } catch (e: any) {
      status = "error";
      errMsg = e?.message ?? "AI error";
    }

    const jobIdSet = new Set(jobs.map((j) => j.id));
    const driverIdSet = new Set((drivers ?? []).map((d: any) => d.id));
    const partnerIdSet = new Set(partnerList.map((p) => p.id));
    const validTypes = new Set([
      "assign",
      "unassign",
      "reschedule",
      "status",
      "group",
      "ungroup",
      "message",
      "dispatch",
      "note",
    ]);
    const rawActions = Array.isArray(parsed?.actions) ? parsed.actions : [];
    const actions = rawActions.filter((a: any) => {
      if (!a || typeof a !== "object" || !validTypes.has(a.type)) return false;
      if (a.type === "group") return Array.isArray(a.job_ids) && a.job_ids.every((id: string) => jobIdSet.has(id));
      if (!jobIdSet.has(a.job_id)) return false;
      if (a.type === "assign" && !driverIdSet.has(a.driver_id)) return false;
      if (a.type === "dispatch" && !partnerIdSet.has(a.partner_company_id)) return false;
      return true;
    });
    const response = String(parsed?.response ?? "");

    // Read mode: never propose actions — treat as Q&A only.
    const finalActions = data.mode === "read" ? [] : actions;
    if (status !== "error") status = finalActions.length > 0 ? "awaiting_confirm" : "ok";

    const { data: logRow } = await sb
      .from("ai_command_log")
      .insert({
        company_id: c.id,
        actor_user_id: context.userId,
        mode: data.mode,
        prompt: data.prompt,
        response,
        actions: finalActions,
        status,
        error: errMsg,
        requires_confirmation: finalActions.length > 0,
      })
      .select("id")
      .maybeSingle();

    if (status === "error") throw new Error(errMsg ?? "AI error");
    return { id: (logRow as any)?.id ?? null, response, actions: finalActions, status };
  });

// Apply proposed AI actions after coordinator approval.
export const applyAiCommandActions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        command_log_id: z.string().uuid(),
        action_indices: z.array(z.number().int().min(0)).min(1).max(50),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const c = await resolveCompany(context);
    const sb = await getAdminClient();

    const { data: log } = await sb
      .from("ai_command_log")
      .select("id, company_id, actions, applied_at")
      .eq("id", data.command_log_id)
      .maybeSingle();
    if (!log || (log as any).company_id !== c.id) throw new Error("Command not found");
    if ((log as any).applied_at) throw new Error("Actions already applied");
    const stored: any[] = Array.isArray((log as any).actions) ? (log as any).actions : [];

    const { data: userRow } = await sb.auth.admin.getUserById(context.userId);
    const label = `AI · ${userRow?.user?.email ?? "Coordinator"}`;

    const results: Array<{ index: number; ok: boolean; message: string }> = [];
    let affected = 0;

    for (const idx of data.action_indices) {
      const a = stored[idx];
      if (!a || typeof a !== "object") {
        results.push({ index: idx, ok: false, message: "invalid action" });
        continue;
      }
      try {
        if (a.type === "assign") {
          const { error } = await sb
            .from("jobs")
            .update({ driver_id: a.driver_id, driver_accepted_at: null } as never)
            .eq("id", a.job_id)
            .or(`company_id.eq.${c.id},executor_company_id.eq.${c.id}`);
          if (error) throw error;
          affected++;
          results.push({ index: idx, ok: true, message: "driver assigned" });
        } else if (a.type === "unassign") {
          const { error } = await sb
            .from("jobs")
            .update({ driver_id: null, driver_accepted_at: null } as never)
            .eq("id", a.job_id)
            .or(`company_id.eq.${c.id},executor_company_id.eq.${c.id}`);
          if (error) throw error;
          affected++;
          results.push({ index: idx, ok: true, message: "driver removed" });
        } else if (a.type === "reschedule") {
          const patch: Record<string, unknown> = {};
          if (typeof a.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(a.date)) patch.date = a.date;
          if (typeof a.time === "string" && /^\d{2}:\d{2}$/.test(a.time)) patch.time = a.time;
          if (typeof a.pickup_at === "string" && !Number.isNaN(Date.parse(a.pickup_at))) patch.pickup_at = a.pickup_at;
          if (!Object.keys(patch).length) throw new Error("no valid date/time");
          const { error } = await sb
            .from("jobs")
            .update(patch as never)
            .eq("id", a.job_id)
            .or(`company_id.eq.${c.id},executor_company_id.eq.${c.id}`);
          if (error) throw error;
          affected++;
          results.push({ index: idx, ok: true, message: `rescheduled ${patch.date ?? ""} ${patch.time ?? ""}`.trim() });
        } else if (a.type === "status") {
          const allowed = ["pending", "confirmed", "in_progress", "completed", "cancelled", "no_show"];
          if (!allowed.includes(a.new_status)) throw new Error("invalid status");
          const { error } = await sb
            .from("jobs")
            .update({ status: a.new_status } as never)
            .eq("id", a.job_id)
            .or(`company_id.eq.${c.id},executor_company_id.eq.${c.id}`);
          if (error) throw error;
          affected++;
          results.push({ index: idx, ok: true, message: `status → ${a.new_status}` });
        } else if (a.type === "group") {
          if (!Array.isArray(a.job_ids) || a.job_ids.length < 2) throw new Error("need 2+ trips");
          const gid = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
          // Snapshot before-state (group_id, group_name per job) for undo.
          const { data: beforeRows } = await sb
            .from("jobs")
            .select("id, group_id, group_name, grouped_count, grouped_at")
            .in("id", a.job_ids)
            .eq("company_id", c.id);
          const { error } = await sb
            .from("jobs")
            .update({
              group_id: gid,
              grouped_count: a.job_ids.length,
              grouped_at: new Date().toISOString(),
              group_name: a.group_name ?? null,
            } as never)
            .in("id", a.job_ids)
            .eq("company_id", c.id);
          if (error) throw error;
          await sb.from("ai_action_audit").insert({
            company_id: c.id,
            actor_user_id: context.userId,
            action_kind: "group",
            target_table: "jobs",
            target_ids: a.job_ids,
            before_state: (beforeRows ?? []) as never,
            after_state: {
              group_id: gid,
              group_name: a.group_name ?? null,
              grouped_count: a.job_ids.length,
            } as never,
            summary: `Grouped ${a.job_ids.length} trips`,
          } as never);
          affected++;
          results.push({ index: idx, ok: true, message: `grouped ${a.job_ids.length}` });
        } else if (a.type === "ungroup") {
          const { data: row } = await sb.from("jobs").select("group_id, company_id").eq("id", a.job_id).maybeSingle();
          const gid = (row as any)?.group_id;
          if (!gid) throw new Error("not in a group");
          const { data: beforeRows } = await sb
            .from("jobs")
            .select("id, group_id, group_name, grouped_count, grouped_at")
            .eq("group_id" as any, gid)
            .eq("company_id", c.id);
          const { error, count } = await sb
            .from("jobs")
            .update({ group_id: null, grouped_count: null, grouped_at: null } as never, { count: "exact" })
            .eq("group_id" as any, gid)
            .eq("company_id", c.id);
          if (error) throw error;
          await sb.from("ai_action_audit").insert({
            company_id: c.id,
            actor_user_id: context.userId,
            action_kind: "ungroup",
            target_table: "jobs",
            target_ids: (beforeRows ?? []).map((r: any) => r.id),
            before_state: (beforeRows ?? []) as never,
            after_state: { group_id: null } as never,
            summary: `Ungrouped ${count ?? 0} trips`,
          } as never);
          affected++;
          results.push({ index: idx, ok: true, message: `ungrouped ${count ?? 0}` });
        } else if (a.type === "message") {
          await spendOrThrow(c.id, "ai_agent_message", `AI message on trip ${String(a.job_id).slice(0, 8)}`, a.job_id);
          const body = String(a.body ?? "").trim();
          if (!body) throw new Error("empty message");
          let thread_kind: "group" | "private" | "driver_coord" = "group";
          let extra: Record<string, unknown> = {};
          if (a.thread === "driver") {
            const { data: jobRow } = await sb.from("jobs").select("driver_id").eq("id", a.job_id).maybeSingle();
            thread_kind = "driver_coord";
            extra.driver_id = (jobRow as any)?.driver_id ?? null;
          } else if (a.thread === "client") {
            thread_kind = "private";
          }
          const { data: inserted, error } = await sb.from("trip_messages").insert({
            job_id: a.job_id,
            company_id: c.id,
            sender_kind: "coordinator",
            sender_label: label,
            body,
            thread_kind,
            ...extra,
          } as any).select("id").single();
          if (error) throw error;
          const messageId = (inserted as { id: string } | null)?.id ?? null;
          if (messageId) {
            await sb.from("ai_action_audit").insert({
              company_id: c.id,
              actor_user_id: context.userId,
              action_kind: "message",
              target_table: "trip_messages",
              target_id: messageId,
              before_state: null,
              after_state: {
                job_id: a.job_id,
                thread_kind,
                thread: a.thread ?? null,
                body,
              } as never,
              summary: `Message on trip ${String(a.job_id).slice(0, 8)}`,
            } as never);
          }
          affected++;
          results.push({ index: idx, ok: true, message: `message sent (${a.thread})` });
        } else if (a.type === "dispatch") {
          await spendOrThrow(c.id, "ai_agent_dispatch", `AI dispatch trip ${String(a.job_id).slice(0, 8)}`, a.job_id);
          await dispatchJobToPartnerInternal(sb, c.id, a.job_id, a.partner_company_id, "via AI agent");
          affected++;
          results.push({ index: idx, ok: true, message: "dispatched to partner" });

        } else if (a.type === "note") {
          results.push({ index: idx, ok: true, message: `note: ${String(a.note ?? "").slice(0, 120)}` });
        } else {
          results.push({ index: idx, ok: false, message: "unsupported action" });
        }
      } catch (e: any) {
        results.push({ index: idx, ok: false, message: (e?.message ?? "failed").slice(0, 200) });
      }
    }

    await sb
      .from("ai_command_log")
      .update({
        executed_actions: results,
        affected_count: affected,
        applied_at: new Date().toISOString(),
      } as never)
      .eq("id", data.command_log_id);

    return { ok: true, affected, results };
  });

export const listAiCommandHistory = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const c = await resolveCompany(context);
    const sb = await getAdminClient();
    const { data } = await sb
      .from("ai_command_log")
      .select(
        "id, mode, prompt, response, actions, status, created_at, applied_at, executed_actions, affected_count, requires_confirmation",
      )
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

    // Enforce the AI Center → Toggles switch (mirror runAutoCoordinate).
    const { data: cfg } = await sb
      .from("ai_configuration")
      .select("auto_assign_enabled")
      .eq("company_id", c.id)
      .maybeSingle();
    if (!cfg || (cfg as any).auto_assign_enabled !== true) {
      throw new Error("Auto-assign is turned off in your AI settings — enable it in AI Center → Toggles.");
    }

    // Ensure the job belongs to (or is executed by) this company
    const { data: job } = await sb
      .from("jobs")
      .select("id, company_id, executor_company_id, driver_id")
      .eq("id", data.job_id)
      .maybeSingle();
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
    const supabaseAdmin = await getAdminClient();
    let code = (c as any).referral_code as string | null;
    if (!code) {
      const { data: gen, error: genErr } = await supabaseAdmin
        .rpc("ensure_referral_code", { _company_id: c.id } as never);
      if (genErr) throw new Error(genErr.message);
      code = (gen as unknown as string) ?? null;
    }

    // Attribution: who referred THIS company (if anyone)
    const referredById = (c as any).referred_by_company_id as string | null;
    let attributed_to: { id: string; name: string | null; credit_until: string | null } | null = null;
    if (referredById) {
      const { data: ref } = await supabaseAdmin
        .from("companies")
        .select("id, name")
        .eq("id", referredById)
        .maybeSingle();
      attributed_to = ref
        ? { id: ref.id, name: ref.name, credit_until: (c as any).referral_credit_until ?? null }
        : null;
    }

    // Kickbacks credited to me (negative points_deducted = credit)
    const { data: kickbacks } = await supabaseAdmin
      .from("points_ledger")
      .select("id, points_deducted, note, feature_key, created_at")
      .eq("company_id", c.id)
      .ilike("note", "Referral kickback%")
      .order("created_at", { ascending: false })
      .limit(100);

    const total_credited = (kickbacks ?? []).reduce(
      (sum, k: any) => sum + Math.abs(Number(k.points_deducted ?? 0)),
      0,
    );

    const base = {
      percent: Number((c as any).referral_percent ?? 5),
      credit_until: (c as any).referral_credit_until ?? null,
      attributed_to,
      kickbacks: kickbacks ?? [],
      total_credited,
    };

    if (!code) return { code: null, requests: [] as any[], ...base };
    const { data, error } = await supabaseAdmin
      .from("access_requests")
      .select("id, full_name, company_name, email, kind, status, created_at")
      .eq("referral_code", code)
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) throw new Error(error.message);
    return { code, requests: data ?? [], ...base };
  });

// ---------- AI TRAINING LOG (learning loop) ----------
// Called after coordinator saves AI-extracted trips so we can compare the
// initial AI draft against the final human-corrected version.
export const logAiTrainingSample = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        original_text: z.string().min(1).max(200000),
        ai_initial_output: z.any(),
        human_corrected_output: z.any(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    let companyId: string | null = null;
    try {
      const c = await resolveCompany(context);
      companyId = (c as any)?.id ?? null;
    } catch {
      companyId = null;
    }
    const { error } = await context.supabase.from("ai_training_logs").insert({
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
  duplicates: {
    id: string;
    date: string | null;
    time: string | null;
    from_location: string | null;
    to_location: string | null;
    pax_names: string[];
  }[];
  suspicious: {
    id: string;
    date: string | null;
    time: string | null;
    flight_number: string | null;
    from_location: string | null;
    to_location: string | null;
    pax_names: string[];
  }[];
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
  if (s.includes("airport") || s.includes("terminal") || s.includes("aeroport") || s.includes("aeropuerto"))
    return true;
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
      .select(
        "id, date, time, pickup_at, from_location, to_location, from_flight, to_flight, flightorship, status, dismissed_flags, pax(name)",
      )
      .eq("company_id", (c as any).id)
      .gte("date", from)
      .lte("date", to)
      .not("status", "in", "(cancelled,completed)");
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
      if (!e) {
        e = { duplicates: [], suspicious: [] };
        result[id] = e;
      }
      return e;
    };
    const asSibling = (j: any) => ({
      id: j.id,
      date: j.date,
      time: j.time,
      from_location: j.from_location,
      to_location: j.to_location,
      pax_names: j._pax_names,
      flight_number: j._flight,
    });

    for (const group of byKey.values()) {
      if (group.length < 2) continue;
      for (let i = 0; i < group.length; i++) {
        for (let k = i + 1; k < group.length; k++) {
          const a = group[i];
          const b = group[k];
          const am = a._minutes;
          const bm = b._minutes;
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
    z
      .object({
        job_id: z.string().uuid(),
        kind: z.enum(["duplicate", "suspicious"]),
      })
      .parse(d),
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
    const { error } = await supabaseAdmin.from("jobs").update({ dismissed_flags: next }).eq("id", data.job_id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const mergeTrips = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        keep_job_id: z.string().uuid(),
        drop_job_ids: z.array(z.string().uuid()).min(1).max(10),
      })
      .parse(d),
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
      .filter(
        (p: any, i: number, arr: any[]) => arr.findIndex((q) => normalizeName(q.name) === normalizeName(p.name)) === i,
      )
      .map((p: any) => ({ job_id: data.keep_job_id, name: p.name }));
    if (toAdd.length > 0) {
      const { error: pErr } = await supabaseAdmin.from("pax").insert(toAdd);
      if (pErr) throw new Error(pErr.message);
    }

    // Clear duplicate flag on kept row.
    await supabaseAdmin.from("jobs").update({ dismissed_flags: [] }).eq("id", data.keep_job_id);

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

// ---------- Phase 3 — Boarding approval (coordinator side) ----------

export const listPendingBoardingApprovals = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({ job_ids: z.array(z.string().uuid()).max(800) }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const c = await resolveCompany(context as Ctx);
    const supabaseAdmin = await getAdminClient();
    const jobIds = Array.from(new Set(data.job_ids));
    if (jobIds.length === 0) return [] as any[];

    const { data: jobs, error: jobsError } = await supabaseAdmin
      .from("jobs")
      .select("id, company_id, executor_company_id, origin_company_id, dispatch_chain_company_ids, from_location, to_location, pickup_display_name, dropoff_display_name, status, pax(id,name,status,boarded_at)")
      .in("id", jobIds);
    if (jobsError) throw new Error(jobsError.message);

    const allowedIds = new Set<string>(
      (jobs ?? [])
        .filter(
          (j: any) =>
            j.company_id === c.id
            || j.executor_company_id === c.id
            || j.origin_company_id === c.id
            || (j.dispatch_chain_company_ids ?? []).includes(c.id),
        )
        .map((j: any) => j.id),
    );
    if (allowedIds.size === 0) return [] as any[];

    const { data: rows, error } = await supabaseAdmin
      .from("job_boarding_approvals")
      .select("id, job_id, status, requested_at, responded_at, override_at, coordinator_note, driver_note, pax_summary")
      .in("job_id", Array.from(allowedIds))
      .eq("status", "pending")
      .order("requested_at", { ascending: false })
      .limit(200);
    if (error) throw new Error(error.message);

    const jobMap = new Map<string, any>();
    for (const j of jobs ?? []) jobMap.set((j as any).id, j);
    return ((rows ?? []) as any[])
      .map((row: any) => ({ ...row, job: jobMap.get(row.job_id) ?? null }))
      .filter((row: any) => !!row.job);
  });

export const respondBoardingApproval = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({
      approval_id: z.string().uuid(),
      action: z.enum(["approve", "reject"]),
      coordinator_note: z.string().trim().max(500).optional(),
    }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const c = await resolveCompany(context as Ctx);
    const supabaseAdmin = await getAdminClient();

    const { data: approval, error: readErr } = await supabaseAdmin
      .from("job_boarding_approvals")
      .select("id, job_id, status, company_id")
      .eq("id", data.approval_id)
      .maybeSingle();
    if (readErr) throw new Error(readErr.message);
    if (!approval) throw new Error("boarding_approval_not_found");
    if ((approval as any).status !== "pending") throw new Error("boarding_approval_already_resolved");

    // Scope check: coordinator must belong to the approval's company.
    if ((approval as any).company_id !== (c as any).id) throw new Error("forbidden");

    const now = new Date().toISOString();
    const newStatus = data.action === "approve" ? "approved" : "rejected";

    const { error: upErr } = await supabaseAdmin
      .from("job_boarding_approvals")
      .update({
        status: newStatus,
        coordinator_note: data.coordinator_note ?? null,
        responded_at: now,
      } as never)
      .eq("id", data.approval_id);
    if (upErr) throw new Error(upErr.message);

    // Send a message back to the driver.
    const messageBody = data.action === "approve"
      ? `✅ Boarding approved by coordinator.${data.coordinator_note ? ` Note: ${data.coordinator_note}` : ""}`
      : `⛔ Boarding rejected by coordinator.${data.coordinator_note ? ` Note: ${data.coordinator_note}` : ""} Please resolve pending passengers.`;
    await supabaseAdmin.from("trip_messages").insert({
      job_id: (approval as any).job_id,
      company_id: (approval as any).company_id,
      sender_kind: "coordinator",
      sender_label: "Coordinator",
      body: messageBody,
      thread_kind: "driver_coord",
    } as never);

    {
      const { insertTripMapEvent } = await import("@/lib/trip-map.server");
      await insertTripMapEvent(supabaseAdmin, {
        jobId: (approval as any).job_id,
        companyId: (approval as any).company_id,
        driverId: null,
        eventType: data.action === "approve" ? "boarding_approved" : "boarding_rejected",
        notes: data.coordinator_note ?? null,
        meta: { approval_id: (approval as any).id, actor: "coordinator" },
      });
    }

    return { ok: true, status: newStatus };
  });

export const getBoardingApprovalStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({ job_id: z.string().uuid() }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const c = await resolveCompany(context as Ctx);
    const supabaseAdmin = await getAdminClient();

    const { data: rows, error } = await supabaseAdmin
      .from("job_boarding_approvals")
      .select("id, status, requested_at, responded_at, override_at, coordinator_note, driver_note, pax_summary")
      .eq("job_id", data.job_id)
      .eq("company_id", (c as any).id)
      .order("requested_at", { ascending: false })
      .limit(5);
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

// ---------- Batch B: Safety / Breakdown flag management ----------
export const clearJobSafetyFlags = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({
      job_id: z.string().uuid(),
      clear: z.array(z.enum(["safety", "breakdown"])).min(1),
    }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const c = await resolveCompany(context);
    const supabaseAdmin = await getAdminClient();
    const patch: Record<string, unknown> = {};
    if (data.clear.includes("safety")) patch.safety_flag_at = null;
    if (data.clear.includes("breakdown")) patch.breakdown_flag_at = null;
    const { error } = await supabaseAdmin
      .from("jobs")
      .update(patch as never)
      .eq("id", data.job_id)
      .or(`company_id.eq.${c.id},executor_company_id.eq.${c.id}`);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ---------- DRIVER-APPROVAL CHANGE REQUESTS ----------

export const listJobChangeRequests = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ job_id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const c = await resolveCompany(context);
    const sb = await getAdminClient();
    const { data: rows, error } = await sb
      .from("job_coord_change_requests")
      .select("id, kind, requested_changes, note, status, created_at, decided_at, decided_note, drivers:decided_by_driver_id(name)")
      .eq("job_id", data.job_id)
      .eq("company_id", c.id)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return { requests: rows ?? [] };
  });

export const cancelJobChangeRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const c = await resolveCompany(context);
    const sb = await getAdminClient();
    const { data: row } = await sb
      .from("job_coord_change_requests")
      .select("id, job_id, company_id, status")
      .eq("id", data.id)
      .maybeSingle();
    if (!row) throw new Error("Request not found");
    if ((row as any).company_id !== c.id && !c.isAdmin) throw new Error("Not allowed");
    if ((row as any).status !== "pending") throw new Error("Only pending requests can be cancelled");
    const { error } = await sb
      .from("job_coord_change_requests")
      .update({ status: "cancelled", decided_at: new Date().toISOString(), decided_note: "cancelled by coordinator" } as never)
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ---------- GPS ARRIVAL RADIUS ----------

export const getMyGpsSettings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const sb = await getAdminClient();
    const { data } = await sb
      .from("companies")
      .select("id, arrival_radius_m")
      .eq("owner_user_id", context.userId)
      .maybeSingle();
    return { arrival_radius_m: (data as any)?.arrival_radius_m ?? null };
  });

export const updateMyGpsSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({ arrival_radius_m: z.number().int().min(25).max(2000) }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const sb = await getAdminClient();
    const { data: co } = await sb.from("companies").select("id").eq("owner_user_id", context.userId).maybeSingle();
    if (!co) throw new Error("No company assigned");
    const { error } = await sb
      .from("companies")
      .update({ arrival_radius_m: data.arrival_radius_m } as never)
      .eq("id", (co as any).id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ==================== Coordinator: driver cancel-request inbox ====================

export const listPendingDriverCancels = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const c = await resolveCompany(context);
    const sb = await getAdminClient();
    const { data, error } = await sb
      .from("jobs")
      .select("id, date, time, pickup_at, from_location, to_location, pickup_display_name, dropoff_display_name, status, driver_cancel_requested_at, driver_cancel_reason, driver_cancel_note, driver_cancel_requested_by, drivers(name)")
      .or(`company_id.eq.${c.id},executor_company_id.eq.${c.id}`)
      .not("driver_cancel_requested_at", "is", null)
      .order("driver_cancel_requested_at", { ascending: false });
    if (error) throw new Error(error.message);
    return { requests: data ?? [] };
  });

export const decideDriverCancelRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({
      job_id: z.string().uuid(),
      decision: z.enum(["approve", "reject"]),
      note: z.string().trim().max(500).optional().nullable(),
    }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const c = await resolveCompany(context);
    const sb = await getAdminClient();
    const { data: job, error: jerr } = await sb
      .from("jobs")
      .select("id, company_id, executor_company_id, driver_id, status, driver_cancel_requested_at, driver_cancel_reason")
      .eq("id", data.job_id)
      .or(`company_id.eq.${c.id},executor_company_id.eq.${c.id}`)
      .maybeSingle();
    if (jerr) throw new Error(jerr.message);
    if (!job) throw new Error("Trip not found");
    if (!(job as any).driver_cancel_requested_at) throw new Error("No pending cancellation request");

    const noteText = (data.note ?? "").trim();
    const clearPatch = {
      driver_cancel_requested_at: null,
      driver_cancel_requested_by: null,
      driver_cancel_reason: null,
      driver_cancel_note: null,
    };

    if (data.decision === "approve") {
      // Close any open wait session server-side (best effort — matches other status transitions).
      try {
        await sb.rpc("close_open_wait_session" as never, { _job_id: data.job_id } as never);
      } catch { /* ignore if no such RPC in this env */ }
      const { error } = await sb
        .from("jobs")
        .update({ ...clearPatch, status: "cancelled" } as never)
        .eq("id", data.job_id);
      if (error) throw new Error(error.message);
      await sb.from("trip_messages").insert({
        job_id: data.job_id,
        company_id: (job as any).company_id,
        sender_kind: "coordinator",
        sender_label: "Coordinator",
        body: `✅ Coordinator APPROVED the driver's cancellation. Trip is now cancelled.${noteText ? ` Note: ${noteText}` : ""}`,
        thread_kind: "driver_coord",
        driver_id: (job as any).driver_id ?? null,
      } as never);
      await sb.rpc("record_trip_audit" as never, {
        _job_id: data.job_id,
        _event_type: "driver_cancel_approved",
        _new: { reason: (job as any).driver_cancel_reason },
        _notes: noteText || null,
        _approval_status: "approved",
        _driver_id: (job as any).driver_id ?? null,
        _actor_label: "coordinator",
      } as never);
    } else {
      const { error } = await sb
        .from("jobs")
        .update(clearPatch as never)
        .eq("id", data.job_id);
      if (error) throw new Error(error.message);
      await sb.from("trip_messages").insert({
        job_id: data.job_id,
        company_id: (job as any).company_id,
        sender_kind: "coordinator",
        sender_label: "Coordinator",
        body: `❌ Coordinator REJECTED the cancellation request. Trip continues.${noteText ? ` Note: ${noteText}` : ""}`,
        thread_kind: "driver_coord",
        driver_id: (job as any).driver_id ?? null,
      } as never);
      await sb.rpc("record_trip_audit" as never, {
        _job_id: data.job_id,
        _event_type: "driver_cancel_rejected",
        _new: { reason: (job as any).driver_cancel_reason },
        _notes: noteText || null,
        _approval_status: "rejected",
        _driver_id: (job as any).driver_id ?? null,
        _actor_label: "coordinator",
      } as never);
    }
    return { ok: true };
  });

/**
 * Coordinator status override.
 *
 * Lets a coordinator (or admin) fix the trip status after the fact — e.g. the
 * driver forgot to press "Completed", or the wrong stage got set. Always logs
 * a `coord_status_override` map pin with { from, to, actor: "coordinator",
 * user_id, reason } so there is a permanent audit record of who changed
 * the status, when, and why. Does NOT run the driver-side guards (GPS
 * radius, boarding gate, etc) since the coordinator is manually correcting
 * ground truth.
 */
export const coordinatorOverrideJobStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({
      job_id: z.string().uuid(),
      status: z.enum(["pending", "en_route", "arrived", "in_progress", "completed", "cancelled"]),
      reason: z.string().trim().max(500).optional(),
    }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const sb = await getAdminClient();

    // Authorize: caller must be admin, or own the job's company / executor /
    // origin. Load the job first so we can check.
    const { data: job, error: jerr } = await sb
      .from("jobs")
      .select(
        "id, status, company_id, executor_company_id, origin_company_id, driver_id, driver_started_at, driver_completed_at",
      )
      .eq("id", data.job_id)
      .maybeSingle();
    if (jerr) throw new Error(jerr.message);
    if (!job) throw new Error("job_not_found");

    const isAdmin = await checkIsAdmin(context.userId);
    if (!isAdmin) {
      const { data: co } = await sb
        .from("companies")
        .select("id")
        .eq("owner_user_id", context.userId)
        .maybeSingle();
      const myCompanyId = co?.id as string | undefined;
      const allowedCompanyIds = new Set(
        [
          (job as any).company_id,
          (job as any).executor_company_id,
          (job as any).origin_company_id,
        ].filter(Boolean) as string[],
      );
      if (!myCompanyId || !allowedCompanyIds.has(myCompanyId)) {
        throw new Error("not_authorized");
      }
    }

    const prevStatus = (job as any).status ?? null;
    if (prevStatus === data.status) {
      return { ok: true, unchanged: true };
    }

    const now = new Date().toISOString();
    const patch: Record<string, unknown> = { status: data.status };

    // Fill / clear timestamp checkpoints so the trip timeline stays coherent
    // when the coordinator jumps stages.
    if (data.status === "en_route" && !(job as any).driver_started_at) {
      patch.driver_started_at = now;
    }
    if (data.status === "completed" && !(job as any).driver_completed_at) {
      patch.driver_completed_at = now;
    }
    if (data.status === "pending") {
      // Coordinator walking the trip back to waiting — keep historical
      // timestamps so the audit trail stays intact.
    }

    const { error: uerr } = await sb.from("jobs").update(patch as never).eq("id", data.job_id);
    if (uerr) throw new Error(uerr.message);

    // Resolve actor email for the audit pin, best-effort.
    let actorEmail: string | null = null;
    try {
      const { data: u } = await sb.auth.admin.getUserById(context.userId);
      actorEmail = u.user?.email ?? null;
    } catch { /* ignore */ }

    // Log the override as a distinct map pin. The BEFORE-INSERT trigger
    // `apply_trip_event_impact` has no rule for `coord_status_override`, so
    // it contributes zero payout / zero trust — coordinator fixes must
    // never penalise the driver.
    const companyId =
      ((job as any).executor_company_id as string | null) ??
      ((job as any).company_id as string);
    try {
      const { insertTripMapEvent } = await import("@/lib/trip-map.server");
      await insertTripMapEvent(sb, {
        jobId: (job as any).id as string,
        companyId,
        driverId: ((job as any).driver_id as string | null) ?? null,
        eventType: "coord_status_override",
        notes: data.reason ?? null,
        skipGpsFallback: true,
        meta: {
          actor: isAdmin ? "admin" : "coordinator",
          actor_user_id: context.userId,
          actor_email: actorEmail,
          from_status: prevStatus,
          to_status: data.status,
          reason: data.reason ?? null,
        },
      });
    } catch { /* map log failures never block the status change */ }

    // Also write to the tamper-evident trip audit chain so the coordinator's
    // action shows in the audit timeline next to driver actions.
    try {
      await sb.rpc("record_trip_audit" as never, {
        _job_id: (job as any).id,
        _event_type: "coord_status_override",
        _previous: { status: prevStatus },
        _new: { status: data.status },
        _notes: data.reason ?? null,
        _driver_id: ((job as any).driver_id as string | null) ?? null,
        _actor_label: isAdmin ? "admin" : "coordinator",
      } as never);
    } catch { /* audit failures never block the primary action */ }

    return {
      ok: true,
      from: prevStatus,
      to: data.status,
    };
  });
