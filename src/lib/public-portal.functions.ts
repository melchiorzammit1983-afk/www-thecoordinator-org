import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { isoToMaltaDateTime } from "@/lib/time";

/**
 * Coordinator-side server functions for the PUBLIC Booking Portal
 * (open link the coordinator can share anywhere — anyone can book without
 * an account, and submissions are pending until the coordinator accepts).
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

function randomToken() {
  return [...crypto.getRandomValues(new Uint8Array(24))]
    .map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ---------- Portals CRUD ----------

export const listPublicPortals = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const cid = await myCompanyId(context.userId);
    if (!cid) return [];
    const { data, error } = await context.supabase
      .from("public_booking_portals" as any)
      .select("*")
      .eq("coordinator_company_id", cid)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const createPublicPortal = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({
    name: z.string().min(1).max(120),
    expires_at: z.string().datetime().nullable().optional(),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const cid = await myCompanyId(context.userId);
    if (!cid) throw new Error("no_company");
    const expiresAt = data.expires_at === undefined
      ? new Date(Date.now() + 24 * 3600_000).toISOString()
      : data.expires_at;
    const { data: row, error } = await context.supabase
      .from("public_booking_portals" as any)
      .insert({
        coordinator_company_id: cid,
        name: data.name,
        token: randomToken(),
        expires_at: expiresAt,
      } as any)
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

export const updatePublicPortal = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({
    id: z.string().uuid(),
    patch: z.object({
      name: z.string().min(1).max(120).optional(),
      enabled: z.boolean().optional(),
      expires_at: z.string().datetime().nullable().optional(),
    }),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase
      .from("public_booking_portals" as any)
      .update(data.patch as any).eq("id", data.id).select("*").single();
    if (error) throw new Error(error.message);
    return row;
  });

export const rotatePublicPortal = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase
      .from("public_booking_portals" as any)
      .update({ token: randomToken() } as any).eq("id", data.id).select("*").single();
    if (error) throw new Error(error.message);
    return row;
  });

export const deletePublicPortal = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("public_booking_portals" as any).delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ---------- Requests inbox ----------

export const listPublicBookingRequests = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({
    portal_id: z.string().uuid().optional(),
    status: z.enum(["pending", "accepted", "rejected", "cancelled"]).optional(),
  }).parse(d).catch?.(() => ({})) ?? {})
  .handler(async ({ data, context }) => {
    const cid = await myCompanyId(context.userId);
    if (!cid) return [];
    let q = context.supabase
      .from("public_booking_requests" as any)
      .select("*, public_booking_portals!inner(id,name,coordinator_company_id)")
      .order("created_at", { ascending: false })
      .limit(200);
    if (data?.portal_id) q = q.eq("portal_id", data.portal_id);
    if (data?.status) q = q.eq("status", data.status);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return (rows ?? []).filter(
      (r: any) => r.public_booking_portals?.coordinator_company_id === cid,
    );
  });

export const acceptPublicBookingRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({
    id: z.string().uuid(),
    patch: z.record(z.string(), z.any()).optional(),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const cid = await myCompanyId(context.userId);
    if (!cid) throw new Error("no_company");
    const a = await admin();

    const { data: req } = await a
      .from("public_booking_requests" as any)
      .select("*, public_booking_portals!inner(coordinator_company_id)")
      .eq("id", data.id).maybeSingle();
    if (!req) throw new Error("not_found");
    if ((req as any).public_booking_portals.coordinator_company_id !== cid) throw new Error("forbidden");
    if ((req as any).status !== "pending") throw new Error("not_pending");

    const payload: any = { ...((req as any).payload ?? {}), ...(data.patch ?? {}) };
    const fullName = `${payload.name ?? ""} ${payload.surname ?? ""}`.trim();

    const { data: job, error: jerr } = await a.from("jobs").insert({
      company_id: cid,
      origin_company_id: cid,
      executor_company_id: cid,
      from_location: payload.from_location,
      to_location: payload.to_location,
      pickup_at: payload.pickup_at ?? null,
      date: payload.date ?? (payload.pickup_at
        ? isoToMaltaDateTime(payload.pickup_at).date
        : new Date().toISOString().slice(0, 10)),
      time: payload.time ?? (payload.pickup_at
        ? isoToMaltaDateTime(payload.pickup_at).time
        : "12:00"),
      clientcompanyname: fullName || null,
      contact_phone: payload.client_phone ?? null,
      from_flight: (payload.flight_number || "").toUpperCase() || null,
      flightorship: payload.flight_number || null,
      source: `public_portal:${(req as any).portal_id}`,
      status: "pending",
    } as any).select("id").single();
    if (jerr) throw new Error(jerr.message);

    try {
      await a.rpc("spend_points" as any, {
        _company_id: cid,
        _feature_key: "trip_created",
        _job_id: (job as any).id,
        _note: `Public portal booking accepted (${(req as any).portal_id})`,
      } as any);
    } catch (e: any) {
      await a.from("jobs").delete().eq("id", (job as any).id);
      throw new Error(e?.message ?? "spend_failed");
    }

    await a.from("public_booking_requests" as any).update({
      status: "accepted",
      job_id: (job as any).id,
      decided_at: new Date().toISOString(),
      payload,
    } as any).eq("id", data.id);

    // Seed pax
    try {
      const { extractPaxNames, padWithGuests } = await import("./pax-extract");
      const supplied: string[] = Array.isArray(payload.pax_names)
        ? payload.pax_names.map((n: any) => String(n || "").trim()).filter(Boolean) : [];
      const extracted = extractPaxNames({
        clientcompanyname: fullName,
        notes: payload.notes ?? null,
        portalPaxNames: supplied,
      });
      const primary = fullName || "Guest";
      const seed = extracted.length ? extracted : [primary];
      const count = Math.max(1, Math.min(20, Number(payload.pax_count) || seed.length));
      const names = padWithGuests(seed, count);
      if (names.length) {
        await a.from("pax").insert(names.map((name) => ({ job_id: (job as any).id, name })) as any);
      }
    } catch { /* pax seeding is best-effort */ }

    await a.from("pax_tracking_tokens" as any).insert({
      job_id: (job as any).id,
      phone_last4: payload.client_phone
        ? String(payload.client_phone).replace(/\D/g, "").slice(-4) : null,
      booking_ref: (job as any).id.slice(0, 8),
    } as any);

    try {
      const { autoPriceJobBg } = await import("./auto-price.server");
      autoPriceJobBg((job as any).id);
    } catch {}

    return { ok: true, job_id: (job as any).id };
  });

export const rejectPublicBookingRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({
    id: z.string().uuid(), reason: z.string().max(500).optional(),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("public_booking_requests" as any)
      .update({
        status: "rejected",
        decided_at: new Date().toISOString(),
        decided_reason: data.reason ?? null,
      } as any)
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ---------- Messages (coordinator side) ----------

export const listPublicBookingMessages = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({
    portal_id: z.string().uuid(), visitor_id: z.string().min(1).max(80),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("public_booking_messages" as any)
      .select("*")
      .eq("portal_id", data.portal_id)
      .eq("visitor_id", data.visitor_id)
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const sendPublicBookingReply = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({
    portal_id: z.string().uuid(),
    visitor_id: z.string().min(1).max(80),
    request_id: z.string().uuid().nullable().optional(),
    body: z.string().min(1).max(4000),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("public_booking_messages" as any)
      .insert({
        portal_id: data.portal_id,
        visitor_id: data.visitor_id,
        request_id: data.request_id ?? null,
        sender_role: "coordinator",
        body: data.body,
      } as any);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
