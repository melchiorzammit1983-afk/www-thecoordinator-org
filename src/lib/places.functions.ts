// Google Places (New) proxy — all requests go through the Lovable Google
// Maps connector gateway so the API key never touches the browser.
//
// Exposes three server functions:
//   placesAutocomplete  — typeahead suggestions (session-token billed)
//   placesDetails       — resolve a place_id → {address, lat, lng}
//   resolveAddresses    — batch best-match lookup used by the bulk paste
//                          auto-fix flow.
//
// Bias defaults to Malta (35.9375, 14.3754) with 60km radius so airports,
// cruise ports, and hotels in the archipelago rank first, while foreign
// airports/hotels still surface further down the list.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const GATEWAY = "https://connector-gateway.lovable.dev/google_maps";

const MALTA_CENTER = { latitude: 35.9375, longitude: 14.3754 };
const DEFAULT_RADIUS_M = 50_000;
const MAX_RADIUS_M = 50_000; // Places (New) autocomplete hard cap.

type Bias = {
  lat?: number;
  lng?: number;
  radius_m?: number;
  region?: string;
  language?: string;
};

function biasBody(bias?: Bias) {
  const lat = bias?.lat ?? MALTA_CENTER.latitude;
  const lng = bias?.lng ?? MALTA_CENTER.longitude;
  const radius = Math.max(1000, Math.min(bias?.radius_m ?? DEFAULT_RADIUS_M, MAX_RADIUS_M));
  return {
    locationBias: {
      circle: { center: { latitude: lat, longitude: lng }, radius },
    },
    languageCode: bias?.language ?? "en",
    regionCode: bias?.region ?? "MT",
  };
}

function assertKeys() {
  const LOVABLE_API_KEY = process.env.LOVABLE_API_KEY;
  const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY;
  if (!LOVABLE_API_KEY || !GOOGLE_MAPS_API_KEY) {
    throw new Error("places_unavailable");
  }
  return { LOVABLE_API_KEY, GOOGLE_MAPS_API_KEY };
}

const BiasSchema = z
  .object({
    lat: z.number().min(-90).max(90).optional(),
    lng: z.number().min(-180).max(180).optional(),
    radius_m: z.number().min(1000).max(500_000).optional().transform((v) => (v == null ? v : Math.min(v, 50_000))),
    region: z.string().min(2).max(4).optional(),
    language: z.string().min(2).max(8).optional(),
  })
  .optional();

export const placesAutocomplete = createServerFn({ method: "POST" })
  /* public: driver signboard uses this without a supabase session */
  .inputValidator((input: unknown) =>
    z
      .object({
        input: z.string().trim().min(1).max(200),
        session_token: z.string().trim().min(4).max(80).optional(),
        bias: BiasSchema,
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { LOVABLE_API_KEY, GOOGLE_MAPS_API_KEY } = assertKeys();
    const body = {
      input: data.input,
      sessionToken: data.session_token,
      ...biasBody(data.bias),
    };
    const res = await fetch(`${GATEWAY}/places/v1/places:autocomplete`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "X-Connection-Api-Key": GOOGLE_MAPS_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const err = await res.text();
      console.error(`[placesAutocomplete] ${res.status}: ${err}`);
      throw new Error(`places_${res.status}`);
    }
    const json = (await res.json()) as {
      suggestions?: Array<{
        placePrediction?: {
          placeId?: string;
          text?: { text?: string };
          structuredFormat?: {
            mainText?: { text?: string };
            secondaryText?: { text?: string };
          };
        };
      }>;
    };
    const items = (json.suggestions ?? [])
      .map((s) => s.placePrediction)
      .filter((p): p is NonNullable<typeof p> => !!p?.placeId)
      .map((p) => ({
        place_id: p.placeId!,
        text: p.text?.text ?? p.structuredFormat?.mainText?.text ?? "",
        main: p.structuredFormat?.mainText?.text ?? "",
        secondary: p.structuredFormat?.secondaryText?.text ?? "",
      }));
    return { items };
  });

export const placesDetails = createServerFn({ method: "POST" })
  /* public: driver signboard uses this without a supabase session */
  .inputValidator((input: unknown) =>
    z
      .object({
        place_id: z.string().trim().min(4).max(200),
        session_token: z.string().trim().min(4).max(80).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { LOVABLE_API_KEY, GOOGLE_MAPS_API_KEY } = assertKeys();
    const qs = data.session_token
      ? `?sessionToken=${encodeURIComponent(data.session_token)}`
      : "";
    const res = await fetch(
      `${GATEWAY}/places/v1/places/${encodeURIComponent(data.place_id)}${qs}`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "X-Connection-Api-Key": GOOGLE_MAPS_API_KEY,
          "X-Goog-FieldMask": "id,formattedAddress,displayName,location",
        },
      },
    );
    if (!res.ok) {
      const err = await res.text();
      console.error(`[placesDetails] ${res.status}: ${err}`);
      throw new Error(`places_${res.status}`);
    }
    const json = (await res.json()) as {
      id?: string;
      formattedAddress?: string;
      displayName?: { text?: string };
      location?: { latitude?: number; longitude?: number };
    };
    return {
      place_id: json.id ?? data.place_id,
      address: json.formattedAddress ?? json.displayName?.text ?? "",
      display_name: json.displayName?.text ?? null,
      lat: json.location?.latitude ?? null,
      lng: json.location?.longitude ?? null,
    };
  });

// Batch resolver used by bulk paste. For each input string we call the
// Places autocomplete endpoint and pick the top suggestion when it looks
// confident (single result, or first result's main text overlaps the input).
// The caller decides whether to swap the text.
export const resolveAddresses = createServerFn({ method: "POST" })
  /* public: driver signboard uses this without a supabase session */
  .inputValidator((input: unknown) =>
    z
      .object({
        items: z
          .array(
            z.object({
              key: z.string().min(1).max(64),
              text: z.string().trim().min(1).max(200),
            }),
          )
          .min(1)
          .max(200),
        bias: BiasSchema,
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { LOVABLE_API_KEY, GOOGLE_MAPS_API_KEY } = assertKeys();
    const bias = biasBody(data.bias);

    async function lookup(text: string) {
      const res = await fetch(`${GATEWAY}/places/v1/places:autocomplete`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "X-Connection-Api-Key": GOOGLE_MAPS_API_KEY,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ input: text, ...bias }),
      });
      if (!res.ok) return null;
      const json = (await res.json()) as any;
      const first = json?.suggestions?.[0]?.placePrediction;
      if (!first?.placeId) return null;
      // Fetch details for coords + clean address.
      const det = await fetch(
        `${GATEWAY}/places/v1/places/${encodeURIComponent(first.placeId)}`,
        {
          headers: {
            Authorization: `Bearer ${LOVABLE_API_KEY}`,
            "X-Connection-Api-Key": GOOGLE_MAPS_API_KEY,
            "X-Goog-FieldMask": "id,formattedAddress,displayName,location",
          },
        },
      );
      if (!det.ok) return null;
      const d = (await det.json()) as any;
      return {
        place_id: d.id ?? first.placeId,
        address: d.formattedAddress ?? first.text?.text ?? text,
        display_name: d.displayName?.text ?? null,
        lat: d.location?.latitude ?? null,
        lng: d.location?.longitude ?? null,
      };
    }

    // Cap concurrency at 8 so we don't hammer the gateway.
    const results: Record<string, {
      place_id: string; address: string; display_name: string | null;
      lat: number | null; lng: number | null;
    } | null> = {};
    const queue = [...data.items];
    async function worker() {
      while (queue.length) {
        const it = queue.shift()!;
        try { results[it.key] = await lookup(it.text); }
        catch { results[it.key] = null; }
      }
    }
    await Promise.all(Array.from({ length: 8 }, worker));
    return { results };
  });

// ---------- Billing helpers (shared, only used in server handlers) ----------

async function _admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

async function _companyIdForUser(userId: string): Promise<string | null> {
  const sb = await _admin();
  const { data: d } = await sb.from("drivers").select("company_id").eq("linked_user_id", userId).maybeSingle();
  if (d?.company_id) return d.company_id as string;
  const { data: c } = await sb.from("companies").select("id").eq("owner_user_id", userId).maybeSingle();
  return (c?.id ?? null) as string | null;
}

// Feature-gate + point charge. Returns { charged: true } on success or
// { charged: false, reason } when the feature is disabled/entitlement off/no
// funds. Callers should skip the enrichment silently and fall back gracefully.
async function _tryCharge(
  companyId: string,
  featureKey: "address_name_resolve" | "route_eta",
  note: string,
  jobId?: string,
): Promise<{ charged: true } | { charged: false; reason: string }> {
  try {
    const sb = await _admin();
    // Feature entitlement gate — table column is `feature`, not `feature_key`.
    const { data: ent } = await sb.from("company_feature_entitlements")
      .select("enabled, expires_at")
      .eq("company_id", companyId).eq("feature", featureKey).maybeSingle();
    if (ent && ent.enabled === false) return { charged: false, reason: "feature_disabled" };
    if (ent?.expires_at && new Date(ent.expires_at).getTime() < Date.now()) {
      return { charged: false, reason: "feature_expired" };
    }
    // Per-coordinator opt-out (user_feature_preferences)
    const { data: pref } = await sb.from("user_feature_preferences")
      .select("enabled")
      .eq("company_id", companyId).eq("feature_key", featureKey).maybeSingle();
    if (pref && pref.enabled === false) return { charged: false, reason: "feature_disabled_by_user" };
    const { error } = await sb.rpc("spend_points" as any, {
      _company_id: companyId,
      _feature_key: featureKey,
      _job_id: (jobId ?? undefined) as unknown as string,
      _note: note,
      _cost_override: undefined as unknown as number,
    } as any);
    if (error) return { charged: false, reason: error.message || "spend_failed" };
    return { charged: true };
  } catch (e: any) {
    return { charged: false, reason: e?.message ?? "charge_error" };
  }
}

// ---------- Route ETA (from → to) ----------
//
// Uses the Google Maps Distance Matrix API through the connector gateway to
// compute a live traffic-aware duration + distance between two addresses.
// Billed via the "route_eta" feature. When the trip is saved, the caller
// caches the result on the jobs row (route_duration_sec / route_distance_m)
// so we don't re-charge on every render.
export const estimateRouteEta = createServerFn({ method: "POST" })
  /* public: driver signboard uses this without a supabase session */
  .inputValidator((input: unknown) =>
    z.object({
      from: z.string().trim().min(2).max(300),
      to: z.string().trim().min(2).max(300),
      job_id: z.string().uuid().optional(),
      cache_on_job: z.boolean().default(false),
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { LOVABLE_API_KEY, GOOGLE_MAPS_API_KEY } = assertKeys();
    const companyId = await _companyIdForUser(context.userId);
    if (!companyId) throw new Error("no_company");

    const gate = await _tryCharge(companyId, "route_eta", "From→To ETA", data.job_id);
    if (!gate.charged) {
      return { ok: false as const, reason: gate.reason };
    }

    try {
      const url =
        `${GATEWAY}/maps/api/distancematrix/json` +
        `?origins=${encodeURIComponent(data.from)}` +
        `&destinations=${encodeURIComponent(data.to)}` +
        `&departure_time=now&traffic_model=best_guess`;
      const res = await fetch(url, {
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "X-Connection-Api-Key": GOOGLE_MAPS_API_KEY,
        },
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        console.error(`[estimateRouteEta] ${res.status}: ${body.slice(0, 300)}`);
        return { ok: false as const, reason: `dm_${res.status}` };
      }
      const dm: any = await res.json();
      const el = dm?.rows?.[0]?.elements?.[0];
      if (!el || el.status !== "OK") {
        return { ok: false as const, reason: el?.status?.toLowerCase() ?? "no_route" };
      }
      const durationSec: number = el.duration_in_traffic?.value ?? el.duration?.value ?? 0;
      const distanceM: number = el.distance?.value ?? 0;

      if (data.cache_on_job && data.job_id) {
        const sb = await _admin();
        await sb.from("jobs").update({
          route_duration_sec: durationSec,
          route_distance_m: distanceM,
          route_computed_at: new Date().toISOString(),
        } as any).eq("id", data.job_id);
        const { autoPriceJobBg } = await import("./auto-price.server");
        autoPriceJobBg(data.job_id);
      }

      return {
        ok: true as const,
        duration_sec: durationSec,
        distance_m: distanceM,
        duration_text: (el.duration_in_traffic ?? el.duration)?.text ?? "",
        distance_text: el.distance?.text ?? "",
      };
    } catch (e: any) {
      console.error("[estimateRouteEta] exception", e);
      return { ok: false as const, reason: "exception" };
    }
  });

// ---------- Background name resolver ----------
//
// For a given job id, fill in pickup_display_name / dropoff_display_name when
// missing. Billed once per lookup via "address_name_resolve". Uses cached
// place_id when we have it; otherwise runs an autocomplete on the raw address
// text and takes the top match.
export const resolveJobPlaceNames = createServerFn({ method: "POST" })
  /* public: driver signboard uses this without a supabase session */
  .inputValidator((input: unknown) =>
    z.object({ job_id: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { LOVABLE_API_KEY, GOOGLE_MAPS_API_KEY } = assertKeys();
    const companyId = await _companyIdForUser(context.userId);
    if (!companyId) throw new Error("no_company");
    const sb = await _admin();
    const { data: job } = await sb.from("jobs")
      .select("id, company_id, from_location, to_location, pickup_place_id, dropoff_place_id, pickup_display_name, dropoff_display_name")
      .eq("id", data.job_id).maybeSingle();
    if (!job) throw new Error("not_found");
    if ((job as any).company_id !== companyId) throw new Error("forbidden");

    async function lookupByText(text: string): Promise<{ place_id: string | null; display_name: string | null; address: string } | null> {
      if (!text) return null;
      try {
        const r = await fetch(`${GATEWAY}/places/v1/places:autocomplete`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${LOVABLE_API_KEY}`,
            "X-Connection-Api-Key": GOOGLE_MAPS_API_KEY,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ input: text, ...biasBody(undefined) }),
        });
        if (!r.ok) return null;
        const j: any = await r.json();
        const first = j?.suggestions?.[0]?.placePrediction;
        if (!first?.placeId) return null;
        const det = await fetch(`${GATEWAY}/places/v1/places/${encodeURIComponent(first.placeId)}`, {
          headers: {
            Authorization: `Bearer ${LOVABLE_API_KEY}`,
            "X-Connection-Api-Key": GOOGLE_MAPS_API_KEY,
            "X-Goog-FieldMask": "id,formattedAddress,displayName",
          },
        });
        if (!det.ok) return null;
        const d: any = await det.json();
        return {
          place_id: d.id ?? first.placeId,
          display_name: d.displayName?.text ?? first.structuredFormat?.mainText?.text ?? null,
          address: d.formattedAddress ?? text,
        };
      } catch { return null; }
    }

    async function lookupById(placeId: string): Promise<{ display_name: string | null; address: string } | null> {
      try {
        const det = await fetch(`${GATEWAY}/places/v1/places/${encodeURIComponent(placeId)}`, {
          headers: {
            Authorization: `Bearer ${LOVABLE_API_KEY}`,
            "X-Connection-Api-Key": GOOGLE_MAPS_API_KEY,
            "X-Goog-FieldMask": "id,formattedAddress,displayName",
          },
        });
        if (!det.ok) return null;
        const d: any = await det.json();
        return {
          display_name: d.displayName?.text ?? null,
          address: d.formattedAddress ?? "",
        };
      } catch { return null; }
    }

    const patch: Record<string, any> = {};
    const needPickup = !(job as any).pickup_display_name && !!(job as any).from_location;
    const needDropoff = !(job as any).dropoff_display_name && !!(job as any).to_location;

    for (const side of ["pickup", "dropoff"] as const) {
      const need = side === "pickup" ? needPickup : needDropoff;
      if (!need) continue;
      const gate = await _tryCharge(companyId, "address_name_resolve", `Resolve ${side} name`, data.job_id);
      if (!gate.charged) continue;
      const placeId = side === "pickup" ? (job as any).pickup_place_id : (job as any).dropoff_place_id;
      const text = side === "pickup" ? (job as any).from_location : (job as any).to_location;
      const result = placeId ? await lookupById(placeId) : await lookupByText(text);
      if (!result) continue;
      if (side === "pickup") {
        patch.pickup_display_name = result.display_name;
        if ("place_id" in (result as any) && (result as any).place_id) patch.pickup_place_id = (result as any).place_id;
      } else {
        patch.dropoff_display_name = result.display_name;
        if ("place_id" in (result as any) && (result as any).place_id) patch.dropoff_place_id = (result as any).place_id;
      }
    }

    if (Object.keys(patch).length) {
      await sb.from("jobs").update(patch as any).eq("id", data.job_id);
    }
    return { ok: true, patch };
  });

// ---------- Server-side helper: name-only backfill (no auth middleware) ----------
//
// Used by public token flows (driver manifest, client tracker) so raw street
// addresses get replaced with the resolved hotel/business name even before a
// coordinator opens the trip. Charges the trip's owning company via the same
// `address_name_resolve` feature so pricing stays consistent.
export async function backfillJobNamesServer(jobIds: string[]): Promise<number> {
  if (!jobIds.length) return 0;
  let keys: { LOVABLE_API_KEY: string; GOOGLE_MAPS_API_KEY: string };
  try { keys = assertKeys(); } catch { return 0; }
  const { LOVABLE_API_KEY, GOOGLE_MAPS_API_KEY } = keys;
  const sb = await _admin();
  const { data: rows } = await sb
    .from("jobs")
    .select("id, company_id, from_location, to_location, pickup_place_id, dropoff_place_id, pickup_display_name, dropoff_display_name")
    .in("id", jobIds);
  const jobs = (rows ?? []) as any[];
  if (!jobs.length) return 0;

  const nameCache = new Map<string, { display_name: string | null; place_id: string | null } | null>();
  async function resolveName(text: string, placeId: string | null) {
    const cacheKey = (placeId ?? text).toLowerCase();
    if (nameCache.has(cacheKey)) return nameCache.get(cacheKey)!;
    try {
      let pid = placeId;
      if (!pid) {
        const r = await fetch(`${GATEWAY}/places/v1/places:autocomplete`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${LOVABLE_API_KEY}`,
            "X-Connection-Api-Key": GOOGLE_MAPS_API_KEY,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ input: text, ...biasBody(undefined) }),
        });
        if (!r.ok) { nameCache.set(cacheKey, null); return null; }
        const j: any = await r.json();
        pid = j?.suggestions?.[0]?.placePrediction?.placeId ?? null;
        if (!pid) { nameCache.set(cacheKey, null); return null; }
      }
      const det = await fetch(`${GATEWAY}/places/v1/places/${encodeURIComponent(pid)}`, {
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "X-Connection-Api-Key": GOOGLE_MAPS_API_KEY,
          "X-Goog-FieldMask": "id,displayName",
        },
      });
      if (!det.ok) { nameCache.set(cacheKey, null); return null; }
      const d: any = await det.json();
      const result = { display_name: d.displayName?.text ?? null, place_id: pid };
      nameCache.set(cacheKey, result);
      return result;
    } catch { nameCache.set(cacheKey, null); return null; }
  }

  let updated = 0;
  const queue = [...jobs];
  async function worker() {
    while (queue.length) {
      const j = queue.shift()!;
      if (!j.company_id) continue;
      const patch: Record<string, any> = {};
      if (!j.pickup_display_name && j.from_location) {
        const gate = await _tryCharge(j.company_id, "address_name_resolve", "Backfill pickup name (public)", j.id);
        if (gate.charged) {
          const r = await resolveName(j.from_location, j.pickup_place_id);
          if (r?.display_name) {
            patch.pickup_display_name = r.display_name;
            if (r.place_id && !j.pickup_place_id) patch.pickup_place_id = r.place_id;
          }
        }
      }
      if (!j.dropoff_display_name && j.to_location) {
        const gate = await _tryCharge(j.company_id, "address_name_resolve", "Backfill dropoff name (public)", j.id);
        if (gate.charged) {
          const r = await resolveName(j.to_location, j.dropoff_place_id);
          if (r?.display_name) {
            patch.dropoff_display_name = r.display_name;
            if (r.place_id && !j.dropoff_place_id) patch.dropoff_place_id = r.place_id;
          }
        }
      }
      if (Object.keys(patch).length) {
        await sb.from("jobs").update(patch as any).eq("id", j.id);
        updated++;
      }
    }
  }
  await Promise.all(Array.from({ length: 4 }, worker));
  return updated;
}

// ---------- Batch enrichment for visible trip cards ----------
//
// Called by the coordinator calendar / dashboard once per screen load with
// the ids currently on-screen. Fills missing pickup_display_name /
// dropoff_display_name AND route_duration_sec in one round-trip, deduped by
// (from_location, to_location) inside the batch so cards sharing the same
// hotel don't double-charge. Silently no-ops per side when a feature is
// disabled or points are out — callers just render the raw fallback.
export const backfillJobEnrichment = createServerFn({ method: "POST" })
  /* public: driver signboard uses this without a supabase session */
  .inputValidator((input: unknown) =>
    z.object({
      job_ids: z.array(z.string().uuid()).min(1).max(50),
      names: z.boolean().default(true),
      etas: z.boolean().default(true),
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { LOVABLE_API_KEY, GOOGLE_MAPS_API_KEY } = assertKeys();
    const companyId = await _companyIdForUser(context.userId);
    if (!companyId) return { ok: false as const, reason: "no_company" };
    const sb = await _admin();

    const { data: rows } = await sb
      .from("jobs")
      .select("id, company_id, from_location, to_location, pickup_place_id, dropoff_place_id, pickup_display_name, dropoff_display_name, route_duration_sec, route_computed_at")
      .in("id", data.job_ids)
      .eq("company_id", companyId);
    const jobs = (rows ?? []) as any[];
    if (!jobs.length) return { ok: true as const, updated: 0 };

    const nameCache = new Map<string, { display_name: string | null; place_id: string | null } | null>();
    async function resolveName(text: string, placeId: string | null) {
      const cacheKey = (placeId ?? text).toLowerCase();
      if (nameCache.has(cacheKey)) return nameCache.get(cacheKey)!;
      try {
        let pid = placeId;
        if (!pid) {
          const r = await fetch(`${GATEWAY}/places/v1/places:autocomplete`, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${LOVABLE_API_KEY}`,
              "X-Connection-Api-Key": GOOGLE_MAPS_API_KEY,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ input: text, ...biasBody(undefined) }),
          });
          if (!r.ok) { nameCache.set(cacheKey, null); return null; }
          const j: any = await r.json();
          pid = j?.suggestions?.[0]?.placePrediction?.placeId ?? null;
          if (!pid) { nameCache.set(cacheKey, null); return null; }
        }
        const det = await fetch(`${GATEWAY}/places/v1/places/${encodeURIComponent(pid)}`, {
          headers: {
            Authorization: `Bearer ${LOVABLE_API_KEY}`,
            "X-Connection-Api-Key": GOOGLE_MAPS_API_KEY,
            "X-Goog-FieldMask": "id,displayName",
          },
        });
        if (!det.ok) { nameCache.set(cacheKey, null); return null; }
        const d: any = await det.json();
        const result = { display_name: d.displayName?.text ?? null, place_id: pid };
        nameCache.set(cacheKey, result);
        return result;
      } catch { nameCache.set(cacheKey, null); return null; }
    }

    const etaCache = new Map<string, { duration_sec: number; distance_m: number } | null>();
    async function resolveEta(from: string, to: string) {
      const key = `${from}||${to}`.toLowerCase();
      if (etaCache.has(key)) return etaCache.get(key)!;
      try {
        const url =
          `${GATEWAY}/maps/api/distancematrix/json` +
          `?origins=${encodeURIComponent(from)}` +
          `&destinations=${encodeURIComponent(to)}` +
          `&departure_time=now&traffic_model=best_guess`;
        const res = await fetch(url, {
          headers: {
            Authorization: `Bearer ${LOVABLE_API_KEY}`,
            "X-Connection-Api-Key": GOOGLE_MAPS_API_KEY,
          },
        });
        if (!res.ok) { etaCache.set(key, null); return null; }
        const dm: any = await res.json();
        const el = dm?.rows?.[0]?.elements?.[0];
        if (!el || el.status !== "OK") { etaCache.set(key, null); return null; }
        const value = {
          duration_sec: el.duration_in_traffic?.value ?? el.duration?.value ?? 0,
          distance_m: el.distance?.value ?? 0,
        };
        etaCache.set(key, value);
        return value;
      } catch { etaCache.set(key, null); return null; }
    }

    let updated = 0;
    const STALE_MS = 30 * 60_000;
    const queue = [...jobs];
    async function worker() {
      while (queue.length) {
        const j = queue.shift()!;
        const patch: Record<string, any> = {};

        if (data.names) {
          if (!j.pickup_display_name && j.from_location) {
            const gate = await _tryCharge(companyId!, "address_name_resolve", "Backfill pickup name", j.id);
            if (gate.charged) {
              const r = await resolveName(j.from_location, j.pickup_place_id);
              if (r?.display_name) {
                patch.pickup_display_name = r.display_name;
                if (r.place_id && !j.pickup_place_id) patch.pickup_place_id = r.place_id;
              }
            }
          }
          if (!j.dropoff_display_name && j.to_location) {
            const gate = await _tryCharge(companyId!, "address_name_resolve", "Backfill dropoff name", j.id);
            if (gate.charged) {
              const r = await resolveName(j.to_location, j.dropoff_place_id);
              if (r?.display_name) {
                patch.dropoff_display_name = r.display_name;
                if (r.place_id && !j.dropoff_place_id) patch.dropoff_place_id = r.place_id;
              }
            }
          }
        }

        if (data.etas && j.from_location && j.to_location) {
          const stale = !j.route_computed_at
            || (Date.now() - new Date(j.route_computed_at).getTime()) > STALE_MS;
          const missing = !j.route_duration_sec || j.route_duration_sec <= 0;
          if (stale || missing) {
            const gate = await _tryCharge(companyId!, "route_eta", "Backfill ETA", j.id);
            if (gate.charged) {
              const e = await resolveEta(j.from_location, j.to_location);
              if (e) {
                patch.route_duration_sec = e.duration_sec;
                patch.route_distance_m = e.distance_m;
                patch.route_computed_at = new Date().toISOString();
              }
            }
          }
        }

        if (Object.keys(patch).length) {
          await sb.from("jobs").update(patch as any).eq("id", j.id);
          updated++;
          if (patch.route_duration_sec != null || patch.pickup_display_name || patch.dropoff_display_name) {
            const { autoPriceJobBg } = await import("./auto-price.server");
            autoPriceJobBg(j.id);
          }
        }
      }
    }
    await Promise.all(Array.from({ length: 4 }, worker));
    return { ok: true as const, updated };
  });
