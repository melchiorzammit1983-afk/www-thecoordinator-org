/**
 * Server-only CRUD for the extended hotel portal (rooms, zones, promos,
 * add-ons, offers, pricing settings). Called from token-scoped admin route
 * and from guest routes. All inputs validated with zod.
 */
import { z } from "zod";
import { getAdmin } from "./portal-token.server";

// ---------- Schemas ----------
export const RoomInput = z.object({
  id: z.string().uuid().optional(),
  room_number: z.string().min(1).max(40),
  label: z.string().max(120).optional().nullable(),
  active: z.boolean().optional(),
});
export const ZoneInput = z.object({
  id: z.string().uuid().optional(),
  name: z.string().min(1).max(80),
  sort_order: z.number().int().optional(),
  active: z.boolean().optional(),
});
export const FareInput = z.object({
  id: z.string().uuid().optional(),
  zone_id: z.string().uuid(),
  pax_tier: z.string().min(1).max(20),
  price: z.number().nonnegative(),
  coordinator_base_price: z.number().nonnegative().nullable().optional(),
  markup: z.number().nullable().optional(),
});
export const PromoInput = z.object({
  id: z.string().uuid().optional(),
  code: z.string().min(2).max(40).transform((s) => s.toUpperCase().trim()),
  kind: z.enum(["percent", "amount"]),
  value: z.number().nonnegative(),
  min_price: z.number().nonnegative().nullable().optional(),
  applies_to: z.enum(["transport", "offers", "both"]).default("transport"),
  starts_at: z.string().datetime().nullable().optional(),
  ends_at: z.string().datetime().nullable().optional(),
  max_uses: z.number().int().positive().nullable().optional(),
  active: z.boolean().optional(),
});
export const AddonInput = z.object({
  id: z.string().uuid().optional(),
  title: z.string().min(1).max(120),
  description: z.string().max(500).optional().nullable(),
  price: z.number().nonnegative().nullable().optional(),
  category: z.string().max(60).optional().nullable(),
  image_url: z.string().url().max(1000).nullable().optional(),
  active: z.boolean().optional(),
  sort_order: z.number().int().optional(),
});
export const OfferInput = z.object({
  id: z.string().uuid().optional(),
  title: z.string().min(1).max(120),
  description: z.string().max(1000).optional().nullable(),
  image_url: z.string().url().max(1000).nullable().optional(),
  price: z.number().nonnegative().nullable().optional(),
  cta_label: z.string().max(60).optional().nullable(),
  cta_url: z.string().url().max(500).optional().nullable(),
  sort_order: z.number().int().optional(),
  active: z.boolean().optional(),
});
export const SettingsInput = z.object({
  pricing_mode: z.enum(["coordinator", "hotel", "hotel_markup"]).optional(),
  currency: z.string().length(3).optional(),
  logo_url: z.string().url().nullable().optional(),
  brand_color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  display_name_for_passenger: z.string().max(120).nullable().optional(),
});

const TABLES = {
  rooms: "portal_rooms",
  zones: "portal_zones",
  fares: "portal_zone_fares",
  promos: "portal_promos",
  addons: "portal_addons",
  offers: "portal_offers",
} as const;

type Resource = keyof typeof TABLES;

// ---------- List everything the hotel dashboard needs ----------
export async function loadHotelAdminData(portalId: string) {
  const admin = await getAdmin();
  const [rooms, zones, fares, promos, addons, offers] = await Promise.all([
    admin.from("portal_rooms" as any).select("*").eq("portal_company_id", portalId).order("room_number"),
    admin.from("portal_zones" as any).select("*").eq("portal_company_id", portalId).order("sort_order"),
    admin.from("portal_zone_fares" as any).select("*, portal_zones!inner(portal_company_id)").eq("portal_zones.portal_company_id", portalId),
    admin.from("portal_promos" as any).select("*").eq("portal_company_id", portalId).order("created_at", { ascending: false }),
    admin.from("portal_addons" as any).select("*").eq("portal_company_id", portalId).order("sort_order"),
    admin.from("portal_offers" as any).select("*").eq("portal_company_id", portalId).order("sort_order"),
  ]);
  return {
    rooms: rooms.data ?? [],
    zones: zones.data ?? [],
    fares: fares.data ?? [],
    promos: promos.data ?? [],
    addons: addons.data ?? [],
    offers: offers.data ?? [],
  };
}

// ---------- Generic upsert / delete gated by portalId ----------
export async function upsertResource(portalId: string, resource: Resource, payload: any) {
  const admin = await getAdmin();
  const table = TABLES[resource];

  // Fares belong to a zone; validate zone belongs to this portal
  if (resource === "fares") {
    const { data: z } = await admin.from("portal_zones" as any).select("id").eq("id", payload.zone_id).eq("portal_company_id", portalId).maybeSingle();
    if (!z) throw new Error("zone_not_in_portal");
  } else {
    payload.portal_company_id = portalId;
  }

  if (payload.id) {
    // Verify row belongs to this portal before update
    if (resource === "fares") {
      const { data: exists } = await admin
        .from("portal_zone_fares" as any)
        .select("id, portal_zones!inner(portal_company_id)")
        .eq("id", payload.id)
        .eq("portal_zones.portal_company_id", portalId)
        .maybeSingle();
      if (!exists) throw new Error("not_found");
    } else {
      const { data: exists } = await admin.from(table as any).select("id").eq("id", payload.id).eq("portal_company_id", portalId).maybeSingle();
      if (!exists) throw new Error("not_found");
    }
  }

  const { data, error } = await admin.from(table as any).upsert(payload).select().single();
  if (error) throw new Error(error.message);
  return data;
}

export async function deleteResource(portalId: string, resource: Resource, id: string) {
  const admin = await getAdmin();
  const table = TABLES[resource];
  if (resource === "fares") {
    const { data: exists } = await admin
      .from("portal_zone_fares" as any)
      .select("id, portal_zones!inner(portal_company_id)")
      .eq("id", id)
      .eq("portal_zones.portal_company_id", portalId)
      .maybeSingle();
    if (!exists) throw new Error("not_found");
  } else {
    const { data: exists } = await admin.from(table as any).select("id").eq("id", id).eq("portal_company_id", portalId).maybeSingle();
    if (!exists) throw new Error("not_found");
  }
  const { error } = await admin.from(table as any).delete().eq("id", id);
  if (error) throw new Error(error.message);
  return { ok: true };
}

export async function updateSettings(portalId: string, patch: z.infer<typeof SettingsInput>) {
  const admin = await getAdmin();
  const { data, error } = await admin.from("portal_companies" as any).update(patch).eq("id", portalId).select().single();
  if (error) throw new Error(error.message);
  return data;
}

export async function rotateRoomQr(portalId: string, roomId: string) {
  const admin = await getAdmin();
  const { data: room } = await admin.from("portal_rooms" as any).select("id").eq("id", roomId).eq("portal_company_id", portalId).maybeSingle();
  if (!room) throw new Error("not_found");
  // rely on gen_random_bytes at insert time; generate here
  const { randomBytes } = await import("node:crypto");
  const token = randomBytes(18).toString("hex");
  const { error } = await admin.from("portal_rooms" as any).update({ qr_token: token }).eq("id", roomId);
  if (error) throw new Error(error.message);
  return { qr_token: token };
}

export async function bulkCreateRooms(portalId: string, entries: Array<{ room_number: string; label?: string | null }>) {
  const admin = await getAdmin();
  const rows = entries
    .map((e) => ({ room_number: String(e.room_number).trim(), label: e.label ?? null }))
    .filter((e) => e.room_number.length > 0 && e.room_number.length <= 40);
  if (rows.length === 0) return { inserted: 0 };
  const payload = rows.map((r) => ({ portal_company_id: portalId, room_number: r.room_number, label: r.label }));
  const { data, error } = await admin.from("portal_rooms" as any).upsert(payload, { onConflict: "portal_company_id,room_number", ignoreDuplicates: true }).select("id");
  if (error) throw new Error(error.message);
  return { inserted: data?.length ?? 0 };
}

// ---------- Guest resolve + book ----------
export async function resolveRoomByQr(qr: string) {
  if (!qr || qr.length < 20 || qr.length > 80) return { ok: false as const, status: 400, error: "invalid_token" };
  const admin = await getAdmin();
  const { data: room } = await admin
    .from("portal_rooms" as any)
    .select("id, room_number, label, active, portal_company_id, portal_companies!inner(id, name, slug, magic_token, logo_url, brand_color, display_name_for_passenger, active, link_enabled, currency, pricing_mode)")
    .eq("qr_token", qr)
    .maybeSingle();
  if (!room) return { ok: false as const, status: 404, error: "not_found" };
  const pc = (room as any).portal_companies;
  if (!(room as any).active) return { ok: false as const, status: 403, error: "room_disabled" };
  if (!pc?.active || !pc?.link_enabled) return { ok: false as const, status: 403, error: "portal_disabled" };
  return { ok: true as const, room: { id: (room as any).id, room_number: (room as any).room_number, label: (room as any).label }, portal: pc };
}

export async function resolveGuestSession(sessionToken: string) {
  if (!sessionToken || sessionToken.length < 20) return { ok: false as const, status: 400, error: "invalid_token" };
  const admin = await getAdmin();
  const { data: s } = await admin
    .from("portal_guest_sessions" as any)
    .select("*, portal_companies!inner(id, name, slug, logo_url, brand_color, display_name_for_passenger, currency, pricing_mode, active, link_enabled)")
    .eq("session_token", sessionToken)
    .maybeSingle();
  if (!s) return { ok: false as const, status: 404, error: "not_found" };
  if (new Date((s as any).expires_at).getTime() < Date.now()) return { ok: false as const, status: 403, error: "expired" };
  const pc = (s as any).portal_companies;
  if (!pc?.active || !pc?.link_enabled) return { ok: false as const, status: 403, error: "portal_disabled" };
  // touch last_seen
  await admin.from("portal_guest_sessions" as any).update({ last_seen_at: new Date().toISOString() }).eq("id", (s as any).id);
  return { ok: true as const, session: s, portal: pc };
}

export async function loadGuestBootstrap(portalId: string, sessionId: string) {
  const admin = await getAdmin();
  const [zones, fares, addons, offers, bookings] = await Promise.all([
    admin.from("portal_zones" as any).select("*").eq("portal_company_id", portalId).eq("active", true).order("sort_order"),
    admin.from("portal_zone_fares" as any).select("*, portal_zones!inner(portal_company_id)").eq("portal_zones.portal_company_id", portalId),
    admin.from("portal_addons" as any).select("*").eq("portal_company_id", portalId).eq("active", true).order("sort_order"),
    admin.from("portal_offers" as any).select("*").eq("portal_company_id", portalId).eq("active", true).order("sort_order"),
    admin.from("portal_bookings" as any).select("id, status, payload, agreed_price, currency, created_at, job_id, jobs(id, status, pickup_at, driver_id, drivers(name, car_make_model, plate))").eq("guest_session_id", sessionId).order("created_at", { ascending: false }).limit(50),
  ]);
  return {
    zones: zones.data ?? [],
    fares: fares.data ?? [],
    addons: addons.data ?? [],
    offers: offers.data ?? [],
    bookings: bookings.data ?? [],
  };
}

export const GuestBookingInput = z.object({
  zone_id: z.string().uuid().optional(),
  pax_tier: z.string().max(20).optional(),
  from_location: z.string().min(1).max(200),
  to_location: z.string().min(1).max(200),
  pickup_at: z.string().datetime(),
  pax_count: z.number().int().min(1).max(20).default(1),
  pax_names: z.array(z.string().trim().min(1).max(120)).max(20).optional(),
  flight_number: z.string().max(20).optional().nullable(),
  notes: z.string().max(1000).optional().nullable(),
  promo_code: z.string().max(40).optional().nullable(),
  addon_ids: z.array(z.string().uuid()).max(20).optional(),
});

export async function createGuestBooking(sessionToken: string, input: z.infer<typeof GuestBookingInput>) {
  const r = await resolveGuestSession(sessionToken);
  if (!r.ok) return r;
  const admin = await getAdmin();
  const s: any = r.session;
  const p: any = r.portal;

  // Resolve fare
  let base_price: number | null = null;
  let coord_base: number | null = null;
  let markup: number | null = null;
  let zoneName: string | null = null;
  if (input.zone_id) {
    const { data: fare } = await admin
      .from("portal_zone_fares" as any)
      .select("price, coordinator_base_price, markup, portal_zones!inner(id, name, portal_company_id)")
      .eq("zone_id", input.zone_id)
      .eq("pax_tier", input.pax_tier ?? "1-3")
      .eq("portal_zones.portal_company_id", p.id)
      .maybeSingle();
    if (fare) {
      base_price = Number((fare as any).price);
      coord_base = (fare as any).coordinator_base_price != null ? Number((fare as any).coordinator_base_price) : null;
      markup = (fare as any).markup != null ? Number((fare as any).markup) : null;
      zoneName = (fare as any).portal_zones?.name ?? null;
    }
  }

  // Validate promo
  let promo_discount = 0;
  let applied_promo: string | null = null;
  if (input.promo_code) {
    const code = input.promo_code.toUpperCase().trim();
    const { data: promo } = await admin
      .from("portal_promos" as any)
      .select("*")
      .eq("portal_company_id", p.id)
      .eq("code", code)
      .eq("active", true)
      .maybeSingle();
    if (promo) {
      const now = Date.now();
      const ok =
        (!(promo as any).starts_at || new Date((promo as any).starts_at).getTime() <= now) &&
        (!(promo as any).ends_at || new Date((promo as any).ends_at).getTime() >= now) &&
        (!(promo as any).max_uses || (promo as any).uses_count < (promo as any).max_uses) &&
        ((promo as any).applies_to === "transport" || (promo as any).applies_to === "both") &&
        (base_price == null || !(promo as any).min_price || base_price >= Number((promo as any).min_price));
      if (ok && base_price != null) {
        promo_discount =
          (promo as any).kind === "percent"
            ? Math.round(base_price * Number((promo as any).value)) / 100
            : Number((promo as any).value);
        promo_discount = Math.min(promo_discount, base_price);
        applied_promo = code;
        await admin.from("portal_promos" as any).update({ uses_count: ((promo as any).uses_count ?? 0) + 1 }).eq("id", (promo as any).id);
      }
    }
  }

  // Add-ons
  let addon_selections: any[] = [];
  if (input.addon_ids?.length) {
    const { data: addons } = await admin.from("portal_addons" as any).select("id, title, price").in("id", input.addon_ids).eq("portal_company_id", p.id);
    addon_selections = (addons ?? []).map((a: any) => ({ id: a.id, title: a.title, price: a.price != null ? Number(a.price) : null }));
  }

  const agreed_price = base_price != null ? Math.max(0, base_price - promo_discount) : null;

  const payload = {
    name: (s.guest_name || "Guest").split(" ")[0] ?? "Guest",
    surname: (s.guest_name || "").split(" ").slice(1).join(" ") || "-",
    client_phone: s.phone ?? null,
    client_email: s.email ?? null,
    room_number: s.room_id ? undefined : null,
    from_location: input.from_location,
    to_location: input.to_location,
    pickup_at: input.pickup_at,
    pax_count: input.pax_count,
    flight_number: input.flight_number ?? null,
    notes: input.notes ?? null,
    zone_name: zoneName,
    addons: addon_selections,
  };

  // Fetch room_number if we have room_id
  let room_number_str: string | null = null;
  if (s.room_id) {
    const { data: room } = await admin.from("portal_rooms" as any).select("room_number").eq("id", s.room_id).maybeSingle();
    room_number_str = (room as any)?.room_number ?? null;
    payload.room_number = room_number_str as any;
  }

  const { data: booking, error } = await admin
    .from("portal_bookings" as any)
    .insert({
      portal_company_id: p.id,
      status: "pending",
      payload,
      created_by_email: s.email ?? null,
      created_by_name: s.guest_name ?? null,
      agreed_price,
      currency: p.currency ?? "EUR",
      guest_session_id: s.id,
      room_id: s.room_id,
      zone_id: input.zone_id ?? null,
      promo_code: applied_promo,
      addon_selections,
      fare_breakdown: {
        base_price,
        coord_base,
        markup,
        promo_discount,
        addons_total: addon_selections.reduce((n: number, a: any) => n + (Number(a.price) || 0), 0),
        pricing_mode: p.pricing_mode,
        currency: p.currency,
      },
    })
    .select()
    .single();
  if (error) return { ok: false as const, status: 500, error: error.message };
  return { ok: true as const, booking };
}
