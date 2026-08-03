import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { isoToMaltaDateTime } from "@/lib/time";
import { normalizeBookingEndpointTypes, resolveBookingJourney } from "@/lib/journey-resolver";


/**
 * Coordinator-side server functions for the Company Portal.
 * All are auth-gated via requireSupabaseAuth; RLS ensures the current
 * user only sees their own portal companies.
 */

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

// Priority matches the canonical coordinator resolver (resolveCompany in
// coordinator.functions.ts): owner_user_id first, driver-link fallback
// second — so a user who both owns a company and is linked as a driver
// elsewhere resolves to the same company across every path.
async function myCompanyId(userId: string) {
  const a = await admin();
  const { data: c } = await a.from("companies").select("id").eq("owner_user_id", userId).maybeSingle();
  if (c?.id) return c.id as string;
  const { data } = await a.from("drivers").select("company_id").eq("linked_user_id", userId).maybeSingle();
  return (data?.company_id ?? null) as string | null;
}

// Mirrors the crew-notification email pattern (crew-trip-auto-create.ts):
// same enqueue_email/transactional_emails shape, just a different label so
// it's distinguishable in the queue. Best-effort — callers should swallow
// failures rather than let a notification blip fail the booking action.
async function enqueuePortalNotificationEmail(adminClient: any, to: string, subject: string, text: string, label: string) {
  await adminClient.rpc("enqueue_email", {
    queue_name: "transactional_emails",
    payload: {
      to,
      from: "The Coordinator <noreply@thecoordinator.org>",
      sender_domain: "thecoordinator.org",
      subject,
      text,
      html: `<p>${text.replace(/\n/g, "<br/>")}</p>`,
      purpose: "transactional",
      label,
      idempotency_key: `${label}-${to}-${Date.now()}`,
      message_id: crypto.randomUUID(),
    },
  });
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
    kind: z.enum(["hotel", "agent", "company_agent"]).default("hotel"),
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
  .inputValidator((d) => z.object({
    booking_id: z.string().uuid(),
    // What the portal/company is billed for this booking — set by the
    // coordinator at approval time (guests never propose their own price).
    // Feeds the statement's revenue total; optional so approving without a
    // price still works exactly as before.
    agreed_price: z.number().min(0).max(100_000).optional(),
    currency: z.string().max(6).optional(),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const cid = await myCompanyId(context.userId);
    if (!cid) throw new Error("no_company");
    const a = await admin();
    const { data: b } = await a.from("portal_bookings" as any)
      .select("*, portal_companies!inner(name,coordinator_company_id,points_per_booking,notification_email,contact_email)")
      .eq("id", data.booking_id).maybeSingle();
    if (!b) throw new Error("not_found");
    if ((b as any).portal_companies.coordinator_company_id !== cid) throw new Error("forbidden");
    if ((b as any).status !== "pending") throw new Error("not_pending");

    const payload = (b as any).payload ?? {};
    const endpointTypes = normalizeBookingEndpointTypes(payload, { defaultMissingToLocal: true });
    const journey = resolveBookingJourney(endpointTypes.fromLocationType, endpointTypes.toLocationType);
    const fullName = `${payload.name ?? ""} ${payload.surname ?? ""}`.trim();
    // create a job
    const { data: job, error: jerr } = await a.from("jobs").insert({
      company_id: cid,
      origin_company_id: cid,
      executor_company_id: cid,
      from_location: payload.from_location,
      to_location: payload.to_location,
      from_location_type: endpointTypes.fromLocationType,
      to_location_type: endpointTypes.toLocationType,
      pickup_lat: payload.from_lat ?? null,
      pickup_lng: payload.from_lng ?? null,
      pickup_display_name: payload.from_display_name || payload.from_location || null,
      dropoff_lat: payload.to_lat ?? null,
      dropoff_lng: payload.to_lng ?? null,
      dropoff_display_name: payload.to_display_name || payload.to_location || null,
      pickup_at: payload.pickup_at ?? null,
      date: payload.date ?? (payload.pickup_at ? isoToMaltaDateTime(payload.pickup_at).date : new Date().toISOString().slice(0, 10)),
      time: payload.time ?? (payload.pickup_at ? isoToMaltaDateTime(payload.pickup_at).time : "12:00"),

      // The "Company" field on the trip card/sign board should identify who
      // this trip is for (the HR/corporate account the coordinator set up),
      // not the guest's own name — the guest already has their own name
      // shown separately via the pax rows seeded below.
      clientcompanyname: (b as any).portal_companies.name || null,
      from_flight: (payload.flight_number || "").toUpperCase() || null,
      flightorship: payload.flight_number || null,
      contact_phone: payload.client_phone ?? null,
      vehicle: payload.vehicle || null,
      notes: payload.notes || null,
      source: `portal:${(b as any).portal_company_id}`,
      status: "pending",
    } as any).select("id").single();
    if (jerr) throw new Error(jerr.message);

    if (payload.flight_number) {
      const { applyLiveStatusToJobBg } = await import("./coordinator.functions");
      applyLiveStatusToJobBg((job as any).id);
    }

    const bookingPatch: Record<string, unknown> = {
      status: "accepted", job_id: (job as any).id, accepted_at: new Date().toISOString(),
    };
    if (data.agreed_price != null) bookingPatch.agreed_price = data.agreed_price;
    if (data.currency) bookingPatch.currency = data.currency;
    await a.from("portal_bookings" as any).update(bookingPatch as any).eq("id", data.booking_id);

    try {
      const notifyEmail = (b as any).portal_companies.notification_email || (b as any).portal_companies.contact_email;
      if (notifyEmail) {
        const priceLine = data.agreed_price != null
          ? ` Agreed price: ${data.currency ?? "EUR"} ${data.agreed_price.toFixed(2)}.`
          : "";
        await enqueuePortalNotificationEmail(
          a, notifyEmail, "Booking approved",
          `Your booking for ${fullName || "your guest"} (${payload.from_location} → ${payload.to_location}) has been approved.${priceLine}`,
          "portal_booking_accepted",
        );
      }
    } catch (e) {
      console.error("acceptPortalBooking: notification email failed", e);
    }

    // Seed pax rows so the driver has verifiable slots. Combine supplied
    // pax_names + names parsed from the client field / notes, then pad
    // with "Guest N" up to pax_count.
    let primaryPaxId: string | null = null;
    {
      const { extractPaxNames, padWithGuests } = await import("./pax-extract");
      const supplied: string[] = Array.isArray((payload as any).pax_names)
        ? (payload as any).pax_names.map((n: any) => String(n || "").trim()).filter(Boolean)
        : [];
      const extracted = extractPaxNames({
        clientcompanyname: fullName,
        notes: (payload as any).notes ?? (payload as any).note ?? null,
        portalPaxNames: supplied,
      });
      const primary = fullName || "Guest";
      const seed = extracted.length ? extracted : [primary];
      const count = Math.max(1, Math.min(20, Number((payload as any).pax_count) || seed.length));
      const names = padWithGuests(seed, count);
      if (names.length) {
        const { data: paxRows } = await a.from("pax")
          .insert(names.map((name) => ({ job_id: (job as any).id, name })) as any)
          .select("id");
        // The first pax row stands in for "the booking" when the tracking
        // link's holder wants a private driver_client thread — one tracking
        // link is shared by the whole booking, not per-individual-guest.
        primaryPaxId = (paxRows as any)?.[0]?.id ?? null;
      }
    }

    // create tracking token
    await a.from("pax_tracking_tokens" as any).insert({
      job_id: (job as any).id,
      portal_booking_id: data.booking_id,
      pax_id: primaryPaxId,
      phone_last4: payload.client_phone ? String(payload.client_phone).replace(/\D/g, "").slice(-4) : null,
      booking_ref: (job as any).id.slice(0, 8),
    } as any);

    {
      const { autoPriceJobBg } = await import("./auto-price.server");
      autoPriceJobBg((job as any).id);
    }
    return { ok: true, job_id: (job as any).id, journey };
  });

export const rejectPortalBooking = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ booking_id: z.string().uuid(), reason: z.string().max(500).optional() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("portal_bookings" as any).update({ status: "rejected" } as any).eq("id", data.booking_id);
    if (error) throw new Error(error.message);

    try {
      const a = await admin();
      const { data: b } = await a.from("portal_bookings" as any)
        .select("payload, portal_companies!inner(notification_email,contact_email)")
        .eq("id", data.booking_id).maybeSingle();
      const notifyEmail = (b as any)?.portal_companies?.notification_email || (b as any)?.portal_companies?.contact_email;
      if (notifyEmail) {
        const payload = (b as any)?.payload ?? {};
        const fullName = `${payload.name ?? ""} ${payload.surname ?? ""}`.trim() || "your guest";
        const reasonLine = data.reason ? ` Reason: ${data.reason}` : "";
        await enqueuePortalNotificationEmail(
          a, notifyEmail, "Booking rejected",
          `Your booking for ${fullName} (${payload.from_location ?? ""} → ${payload.to_location ?? ""}) was rejected.${reasonLine}`,
          "portal_booking_rejected",
        );
      }
    } catch (e) {
      console.error("rejectPortalBooking: notification email failed", e);
    }
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
    const bookingId = (cr as any).portal_booking_id as string;
    const hasJob = !!(cr as any).job_id;

    if (data.decision === "approved") {
      const changes = (cr as any).requested_changes ?? {};
      if ((cr as any).kind === "cancel") {
        if (hasJob) await a.from("jobs").update({ status: "cancelled" } as any).eq("id", (cr as any).job_id);
        await a.from("portal_bookings" as any).update({ status: "cancelled" } as any).eq("id", bookingId);
      } else if (hasJob) {
        // from/to/pickup_at/notes are real `jobs` columns — passenger
        // counts/names live on portal_bookings.payload and the `pax` table
        // instead (real passenger count is however many `pax` rows exist).
        const {
          from_location, to_location, pickup_at, notes, pax_names, pax_count,
          from_lat, from_lng, to_lat, to_lng, from_display_name, to_display_name,
        } = changes as {
          from_location?: string; to_location?: string; pickup_at?: string | null;
          notes?: string | null; pax_names?: string[] | null; pax_count?: number | null;
          from_lat?: number | null; from_lng?: number | null; to_lat?: number | null; to_lng?: number | null;
          from_display_name?: string | null; to_display_name?: string | null;
        };
        const jobPatch: Record<string, unknown> = {};
        if (from_location != null) { jobPatch.from_location = from_location; jobPatch.pickup_display_name = from_display_name || from_location; }
        if (to_location != null) { jobPatch.to_location = to_location; jobPatch.dropoff_display_name = to_display_name || to_location; }
        if (pickup_at !== undefined) jobPatch.pickup_at = pickup_at;
        if (notes !== undefined) jobPatch.notes = notes;
        // Refresh the map pins whenever the address actually changed —
        // otherwise a reschedule would silently leave stale pickup/dropoff
        // pins pointing at the old address while the text label updates.
        if (from_lat !== undefined) jobPatch.pickup_lat = from_lat;
        if (from_lng !== undefined) jobPatch.pickup_lng = from_lng;
        if (to_lat !== undefined) jobPatch.dropoff_lat = to_lat;
        if (to_lng !== undefined) jobPatch.dropoff_lng = to_lng;
        if (Object.keys(jobPatch).length) {
          await a.from("jobs").update(jobPatch as any).eq("id", (cr as any).job_id);
        }

        const { data: booking } = await a.from("portal_bookings" as any).select("payload").eq("id", bookingId).maybeSingle();
        const payloadPatch: Record<string, unknown> = {};
        if (notes !== undefined) payloadPatch.notes = notes;
        if (pax_names !== undefined) payloadPatch.pax_names = pax_names;
        if (pax_count !== undefined) payloadPatch.pax_count = pax_count;
        if (Object.keys(payloadPatch).length) {
          const mergedPayload = { ...((booking as any)?.payload ?? {}), ...payloadPatch };
          await a.from("portal_bookings" as any).update({ payload: mergedPayload } as any).eq("id", bookingId);
        }

        // Add any newly-named passengers to the job's pax rows. Additive
        // only, never delete-and-reinsert: pax_tracking_tokens has an
        // ON DELETE CASCADE on pax_id, so removing an existing pax row would
        // silently invalidate a tracking link already sent to that
        // passenger. Worst case here is a harmless extra placeholder row,
        // not a broken link someone's actively using.
        if (pax_names !== undefined || pax_count !== undefined) {
          const { extractPaxNames, padWithGuests } = await import("./pax-extract");
          const finalPayload = { ...((booking as any)?.payload ?? {}), ...payloadPatch };
          const supplied: string[] = Array.isArray(finalPayload.pax_names)
            ? finalPayload.pax_names.map((n: any) => String(n || "").trim()).filter(Boolean)
            : [];
          const fullName = `${finalPayload.name ?? ""} ${finalPayload.surname ?? ""}`.trim();
          const extracted = extractPaxNames({ clientcompanyname: fullName, notes: finalPayload.notes ?? null, portalPaxNames: supplied });
          const seed = extracted.length ? extracted : [fullName || "Guest"];
          const count = Math.max(1, Math.min(20, Number(finalPayload.pax_count) || seed.length));
          const targetNames = padWithGuests(seed, count);

          const { data: existingPax } = await a.from("pax").select("name").eq("job_id", (cr as any).job_id);
          const existingKeys = new Set(((existingPax ?? []) as any[]).map((p) => String(p.name).trim().toLowerCase()));
          const toAdd = targetNames.filter((name) => !existingKeys.has(name.trim().toLowerCase()));
          if (toAdd.length) {
            await a.from("pax").insert(toAdd.map((name) => ({ job_id: (cr as any).job_id, name })) as any);
          }
        }

        await a.from("portal_bookings" as any).update({ status: "accepted" } as any).eq("id", bookingId);
      } else {
        // The booking never became a job yet (still pending when the edit
        // was requested) — merge the edits into its payload and put it back
        // in the coordinator's normal approval queue.
        const { data: booking } = await a.from("portal_bookings" as any).select("payload").eq("id", bookingId).maybeSingle();
        const mergedPayload = { ...((booking as any)?.payload ?? {}), ...changes };
        await a.from("portal_bookings" as any).update({ payload: mergedPayload, status: "pending" } as any).eq("id", bookingId);
      }
    } else {
      // Rejected — put the booking back where it was before the change was
      // requested. Only two prior states are possible here: accepted (had a
      // job already) or still pending.
      await a.from("portal_bookings" as any).update({ status: hasJob ? "accepted" : "pending" } as any).eq("id", bookingId);
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
    // Admins see the full config (RLS allows). Everyone else only needs the
    // urgency thresholds used by the coordinator calendar — fetch just those
    // via the admin client and never leak the rest of the internal config.
    const { data } = await context.supabase.from("admin_portal_settings" as any).select("*").eq("id", 1).maybeSingle();
    if (data) return data;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: safe } = await supabaseAdmin
      .from("admin_portal_settings" as any)
      .select("urgency_green_min, urgency_orange_min, urgency_red_min")
      .eq("id", 1)
      .maybeSingle();
    return safe;
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
    urgency_green_min: z.number().int().min(1).max(240).optional(),
    urgency_orange_min: z.number().int().min(1).max(240).optional(),
    urgency_red_min: z.number().int().min(1).max(240).optional(),
    default_ai_monthly_cap: z.number().min(0).max(1_000_000).optional(),
    default_ai_fallback_to_general: z.boolean().optional(),
    ai_cap_behavior: z.enum(["block", "fallback", "warn"]).optional(),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase.from("admin_portal_settings" as any)
      .update({ ...data, updated_at: new Date().toISOString() } as any).eq("id", 1).select("*").single();
    if (error) throw new Error(error.message);
    return row;
  });

export const applyAiWalletDefaultsToAllCompanies = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({
    apply_cap: z.boolean().default(true),
    apply_fallback: z.boolean().default(true),
    only_unset: z.boolean().default(false),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: userData } = await supabaseAdmin.auth.admin.getUserById((context as any).userId);
    const email = userData?.user?.email?.toLowerCase();
    const { data: adminRows } = await supabaseAdmin.from("admin_emails").select("email");
    const isAdmin = !!email && (adminRows ?? []).some((r: any) => r.email?.toLowerCase() === email);
    if (!isAdmin) throw new Error("Forbidden: admin only");
    const { data: settings } = await supabaseAdmin
      .from("admin_portal_settings" as any)
      .select("default_ai_monthly_cap, default_ai_fallback_to_general")
      .eq("id", 1)
      .maybeSingle();
    if (!settings) throw new Error("Settings not found");
    const patch: Record<string, unknown> = {};
    if (data.apply_cap) patch.ai_monthly_cap = (settings as any).default_ai_monthly_cap ?? 0;
    if (data.apply_fallback) patch.ai_fallback_to_general = (settings as any).default_ai_fallback_to_general ?? true;
    if (Object.keys(patch).length === 0) return { updated: 0 };
    let q: any = (supabaseAdmin.from("companies") as any).update(patch);
    if (data.only_unset && data.apply_cap) {
      q = q.or("ai_monthly_cap.is.null,ai_monthly_cap.eq.0");
    }
    const { error, count } = await q.select("id", { count: "exact", head: true });
    if (error) throw new Error(error.message);
    return { updated: count ?? 0 };
  });
