import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Coordinator-side server functions for the Company Portal.
 * All are auth-gated via requireSupabaseAuth; RLS ensures the current
 * user only sees their own portal companies.
 */

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

async function myCompanyId(userId: string) {
  const a = await admin();
  const { data } = await a.from("drivers").select("company_id").eq("linked_user_id", userId).maybeSingle();
  if (data?.company_id) return data.company_id as string;
  const { data: c } = await a.from("companies").select("id").eq("owner_user_id", userId).maybeSingle();
  return (c?.id ?? null) as string | null;
}

// ---------- Portal companies (hotels) ----------

export const listPortals = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const cid = await myCompanyId(context.userId);
    if (!cid) return [];
    const { data, error } = await context.supabase
      .from("portal_companies" as any)
      .select("*")
      .eq("coordinator_company_id", cid)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;
const RESERVED_SLUGS = new Set([
  "www", "admin", "api", "app", "id-preview", "project", "mail", "auth",
  "preview", "portal", "track", "static", "assets", "cdn", "help", "docs",
]);

export function slugify(input: string): string {
  const base = (input || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-+|-+$)/g, "");
  const trimmed = base.length > 38 ? base.slice(0, 38) : base;
  return trimmed.length >= 3 ? trimmed : `${trimmed}co`;
}

export const checkSlugAvailable = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ slug: z.string(), excludeId: z.string().uuid().optional() }).parse(d))
  .handler(async ({ data, context }) => {
    const s = data.slug.trim().toLowerCase();
    if (!SLUG_RE.test(s)) return { ok: false as const, reason: "invalid" };
    if (RESERVED_SLUGS.has(s)) return { ok: false as const, reason: "reserved" };
    let q = context.supabase.from("portal_companies" as any).select("id").eq("slug", s).limit(1);
    if (data.excludeId) q = q.neq("id", data.excludeId);
    const { data: rows } = await q;
    if (rows && rows.length > 0) return { ok: false as const, reason: "taken" };
    return { ok: true as const };
  });

export const createPortal = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({
    name: z.string().min(1).max(120),
    slug: z.string().regex(SLUG_RE).optional(),
    kind: z.enum(["hotel", "agent", "corporate"]).default("hotel"),
    contact_email: z.string().email().optional().nullable(),
    contact_phone: z.string().max(40).optional().nullable(),
    points_per_booking: z.number().min(0).max(100).optional(),
    display_name_for_passenger: z.string().max(120).optional().nullable(),
    brand_color: z.string().max(20).optional().nullable(),
    link_expires_at: z.string().datetime().optional().nullable(),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const cid = await myCompanyId(context.userId);
    if (!cid) throw new Error("no_company");
    // Ensure a unique slug (auto-suggest + dedup)
    let baseSlug = (data.slug ?? slugify(data.name)).toLowerCase();
    if (RESERVED_SLUGS.has(baseSlug)) baseSlug = `${baseSlug}-portal`;
    const a = await admin();
    let attempt = baseSlug, n = 1;
    while (n <= 20) {
      const { data: exists } = await a.from("portal_companies" as any).select("id").eq("slug", attempt).limit(1);
      if (!exists || exists.length === 0) break;
      n += 1;
      attempt = `${baseSlug.slice(0, 36)}-${n}`;
    }
    const { data: row, error } = await context.supabase
      .from("portal_companies" as any)
      .insert({ ...data, slug: attempt, coordinator_company_id: cid } as any)
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

export const updatePortal = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({
    id: z.string().uuid(),
    patch: z.object({
      name: z.string().min(1).max(120).optional(),
      slug: z.string().regex(SLUG_RE).optional(),
      contact_email: z.string().email().nullable().optional(),
      contact_phone: z.string().max(40).nullable().optional(),
      notification_email: z.string().email().nullable().optional(),
      logo_url: z.string().url().nullable().optional(),
      brand_color: z.string().max(20).nullable().optional(),
      display_name_for_passenger: z.string().max(120).nullable().optional(),
      points_per_booking: z.number().min(0).max(100).optional(),
      monthly_seat_points: z.number().min(0).max(1000).optional(),
      active: z.boolean().optional(),
      link_enabled: z.boolean().optional(),
      link_expires_at: z.string().datetime().nullable().optional(),
    }),
  }).parse(d))
  .handler(async ({ data, context }) => {
    if (data.patch.slug && RESERVED_SLUGS.has(data.patch.slug.toLowerCase())) {
      throw new Error("slug_reserved");
    }
    const { error, data: row } = await context.supabase
      .from("portal_companies" as any)
      .update(data.patch as any)
      .eq("id", data.id)
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    // audit
    await context.supabase.from("portal_link_events" as any).insert({
      portal_company_id: data.id,
      actor_user_id: context.userId,
      actor_kind: "coordinator",
      event: "portal_updated",
      detail: data.patch as any,
    } as any);
    return row;
  });

export const rotatePortalToken = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const a = await admin();
    const token = [...crypto.getRandomValues(new Uint8Array(24))]
      .map((b) => b.toString(16).padStart(2, "0")).join("");
    const { data: row, error } = await context.supabase
      .from("portal_companies" as any)
      .update({ magic_token: token } as any)
      .eq("id", data.id)
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    await a.from("portal_link_events" as any).insert({
      portal_company_id: data.id, actor_user_id: context.userId, actor_kind: "coordinator", event: "token_rotated",
    } as any);
    return row;
  });

export const deletePortal = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("portal_companies" as any).delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ---------- Bookings inbox ----------

export const listPortalBookings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({
    portal_id: z.string().uuid().optional(),
    status: z.enum(["pending", "accepted", "rejected", "change_requested", "cancelled"]).optional(),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const cid = await myCompanyId(context.userId);
    if (!cid) return [];
    let q = context.supabase.from("portal_bookings" as any).select("*, portal_companies!inner(id,name,coordinator_company_id,logo_url,brand_color)").order("created_at", { ascending: false }).limit(200);
    if (data.portal_id) q = q.eq("portal_company_id", data.portal_id);
    if (data.status) q = q.eq("status", data.status);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const acceptPortalBooking = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ booking_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const cid = await myCompanyId(context.userId);
    if (!cid) throw new Error("no_company");
    const a = await admin();
    const { data: b } = await a.from("portal_bookings" as any)
      .select("*, portal_companies!inner(coordinator_company_id,points_per_booking)")
      .eq("id", data.booking_id).maybeSingle();
    if (!b) throw new Error("not_found");
    if ((b as any).portal_companies.coordinator_company_id !== cid) throw new Error("forbidden");
    if ((b as any).status !== "pending") throw new Error("not_pending");

    const payload = (b as any).payload ?? {};
    const fullName = `${payload.name ?? ""} ${payload.surname ?? ""}`.trim();
    // create a job
    const { data: job, error: jerr } = await a.from("jobs").insert({
      company_id: cid,
      origin_company_id: cid,
      executor_company_id: cid,
      from_location: payload.from_location,
      to_location: payload.to_location,
      pickup_at: payload.pickup_at ?? null,
      date: payload.date ?? (payload.pickup_at ? new Date(payload.pickup_at).toISOString().slice(0, 10) : null),
      time: payload.time ?? null,
      clientcompanyname: fullName || null,
      from_flight: (payload.flight_number || "").toUpperCase() || null,
      flightorship: payload.flight_number || null,
      contact_phone: payload.client_phone ?? null,
      source: `portal:${(b as any).portal_company_id}`,
      status: "pending",
    } as any).select("id").single();
    if (jerr) throw new Error(jerr.message);

    // spend points (may throw insufficient_points → we roll back the job)
    const cost = Number((b as any).portal_companies.points_per_booking ?? 3);
    try {
      await a.rpc("spend_points" as any, {
        _company_id: cid,
        _feature_key: "portal_booking",
        _job_id: (job as any).id,
        _note: `Portal booking accepted (${(b as any).portal_company_id})`,
        _cost_override: cost,
      } as any);
    } catch (e: any) {
      await a.from("jobs").delete().eq("id", (job as any).id);
      throw new Error(e?.message ?? "spend_failed");
    }

    await a.from("portal_bookings" as any).update({
      status: "accepted", job_id: (job as any).id, accepted_at: new Date().toISOString(),
    } as any).eq("id", data.booking_id);

    // create tracking token
    await a.from("pax_tracking_tokens" as any).insert({
      job_id: (job as any).id,
      portal_booking_id: data.booking_id,
      phone_last4: payload.client_phone ? String(payload.client_phone).replace(/\D/g, "").slice(-4) : null,
      booking_ref: (job as any).id.slice(0, 8),
    } as any);

    return { ok: true, job_id: (job as any).id };
  });

export const rejectPortalBooking = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ booking_id: z.string().uuid(), reason: z.string().max(500).optional() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("portal_bookings" as any).update({ status: "rejected" } as any).eq("id", data.booking_id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ---------- Change requests ----------

export const listChangeRequests = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("portal_change_requests" as any)
      .select("*, portal_bookings!inner(payload, portal_company_id, portal_companies!inner(name))")
      .eq("status", "pending")
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const decideChangeRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid(), decision: z.enum(["approved", "rejected"]) }).parse(d))
  .handler(async ({ data, context }) => {
    const a = await admin();
    const { data: cr } = await a.from("portal_change_requests" as any).select("*").eq("id", data.id).maybeSingle();
    if (!cr) throw new Error("not_found");
    if (data.decision === "approved" && (cr as any).job_id) {
      const changes = (cr as any).requested_changes ?? {};
      if ((cr as any).kind === "cancel") {
        await a.from("jobs").update({ status: "cancelled" } as any).eq("id", (cr as any).job_id);
      } else {
        await a.from("jobs").update(changes as any).eq("id", (cr as any).job_id);
      }
    }
    await context.supabase.from("portal_change_requests" as any)
      .update({ status: data.decision, decided_by: context.userId, decided_at: new Date().toISOString() } as any)
      .eq("id", data.id);
    return { ok: true };
  });

// ---------- Chat & payments (coordinator side) ----------

export const listPortalThreadMessages = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ thread_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("portal_messages" as any).select("*").eq("thread_id", data.thread_id).order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const sendPortalMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({
    booking_id: z.string().uuid(),
    scope: z.enum(["hotel_coord", "coord_pax"]),
    body: z.string().min(1).max(4000),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const a = await admin();
    const { data: b } = await a.from("portal_bookings" as any).select("id, portal_company_id, job_id").eq("id", data.booking_id).maybeSingle();
    if (!b) throw new Error("not_found");
    // ensure thread exists
    const { data: existing } = await a.from("portal_threads" as any).select("id").eq("portal_booking_id", data.booking_id).eq("scope", data.scope).maybeSingle();
    let threadId = (existing as any)?.id;
    if (!threadId) {
      const { data: t } = await a.from("portal_threads" as any).insert({
        portal_booking_id: data.booking_id,
        portal_company_id: (b as any).portal_company_id,
        job_id: (b as any).job_id,
        scope: data.scope,
      } as any).select("id").single();
      threadId = (t as any).id;
    }
    const { error } = await context.supabase.from("portal_messages" as any).insert({
      thread_id: threadId, sender_role: "coordinator", sender_label: "Coordinator", body: data.body,
    } as any);
    if (error) throw new Error(error.message);
    return { ok: true, thread_id: threadId };
  });

// ---------- Statements ----------

export const generatePortalStatement = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({
    portal_id: z.string().uuid(),
    period_start: z.string().datetime(),
    period_end: z.string().datetime(),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: bookings } = await context.supabase.from("portal_bookings" as any)
      .select("id, status, agreed_price, currency, created_at, accepted_at, payload")
      .eq("portal_company_id", data.portal_id)
      .gte("created_at", data.period_start).lte("created_at", data.period_end);
    const rows = (bookings ?? []) as any[];
    const totals = {
      bookings_count: rows.length,
      accepted: rows.filter((r) => r.status === "accepted").length,
      cancelled: rows.filter((r) => r.status === "cancelled").length,
      revenue: rows.filter((r) => r.status === "accepted").reduce((s, r) => s + Number(r.agreed_price ?? 0), 0),
    };
    const { data: stmt, error } = await context.supabase.from("portal_statements" as any).insert({
      portal_company_id: data.portal_id,
      period_start: data.period_start,
      period_end: data.period_end,
      totals,
    } as any).select("*").single();
    if (error) throw new Error(error.message);
    return { statement: stmt, rows };
  });

// ---------- Admin settings ----------

export const getPortalSettings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data } = await context.supabase.from("admin_portal_settings" as any).select("*").eq("id", 1).maybeSingle();
    return data;
  });

export const updatePortalSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({
    default_points_per_booking: z.number().min(0).max(100).optional(),
    default_seat_points: z.number().min(0).max(1000).optional(),
    allow_bulk: z.boolean().optional(),
    require_approval_within_hours: z.number().min(0).max(48).optional(),
    max_link_duration_hours: z.number().min(1).max(87600).optional(),
    allow_coord_pax_chat: z.boolean().optional(),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase.from("admin_portal_settings" as any)
      .update({ ...data, updated_at: new Date().toISOString() } as any).eq("id", 1).select("*").single();
    if (error) throw new Error(error.message);
    return row;
  });
