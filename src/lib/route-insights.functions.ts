import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Coordinator "trip route insights" data source.
 *
 * Returns two route legs for a trip so the coordinator screen can show:
 *  - PRE-ACCEPTANCE (always): the planned pickup → dropoff leg using the
 *    trip's stored addresses. Duration, distance and traffic delay.
 *  - POST-ACCEPTANCE (when a driver has accepted and we have a fresh GPS
 *    ping): driver's live GPS → pickup. Duration, distance and traffic.
 *
 * All Google calls go through the Lovable Maps connector gateway.
 */
type LatLng = { lat: number; lng: number };
type Leg = {
  duration_sec: number | null;
  static_duration_sec: number | null;
  distance_m: number | null;
  traffic_delay_sec: number | null;
  origin_label: string | null;
  destination_label: string | null;
} | null;

async function computeLeg(params: {
  origin: LatLng | { address: string };
  destination_address: string;
}): Promise<Leg> {
  const LOVABLE_API_KEY = process.env.LOVABLE_API_KEY;
  const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY;
  if (!LOVABLE_API_KEY || !GOOGLE_MAPS_API_KEY) return null;

  const origin =
    "address" in params.origin
      ? { address: params.origin.address }
      : { location: { latLng: { latitude: params.origin.lat, longitude: params.origin.lng } } };

  const res = await fetch(
    "https://connector-gateway.lovable.dev/google_maps/routes/directions/v2:computeRoutes",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "X-Connection-Api-Key": GOOGLE_MAPS_API_KEY,
        "Content-Type": "application/json",
        "X-Goog-FieldMask":
          "routes.duration,routes.staticDuration,routes.distanceMeters",
      },
      body: JSON.stringify({
        origin,
        destination: { address: params.destination_address },
        travelMode: "DRIVE",
        routingPreference: "TRAFFIC_AWARE",
        languageCode: "en-GB",
        units: "METRIC",
      }),
    },
  );
  if (!res.ok) return null;
  const json = (await res.json()) as {
    routes?: Array<{
      duration?: string;
      staticDuration?: string;
      distanceMeters?: number;
    }>;
  };
  const r = json.routes?.[0];
  if (!r) return null;
  const toSec = (s?: string) => (s && s.endsWith("s") ? Number(s.slice(0, -1)) : null);
  const dur = toSec(r.duration);
  const stat = toSec(r.staticDuration);
  return {
    duration_sec: dur,
    static_duration_sec: stat,
    distance_m: r.distanceMeters ?? null,
    traffic_delay_sec: dur != null && stat != null ? Math.max(0, dur - stat) : null,
    origin_label: null,
    destination_label: null,
  };
}

export const getTripRouteInsights = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ job_id: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Auth scope: caller must be able to see the job (owner, executor, origin,
    // or somewhere in the dispatch chain). The public.jobs RLS already enforces
    // this for the RLS-scoped client on context.supabase, so try that first.
    const { data: job, error } = await context.supabase
      .from("jobs")
      .select(
        "id, driver_id, driver_accepted_at, status, from_location, to_location, pickup_display_name, dropoff_display_name, pickup_lat, pickup_lng, dropoff_lat, dropoff_lng",
      )
      .eq("id", data.job_id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!job) throw new Error("Trip not found or access denied");

    const pickupLabel = job.pickup_display_name || job.from_location;
    const dropoffLabel = job.dropoff_display_name || job.to_location;
    const pickupAddress = job.from_location as string;
    const dropoffAddress = job.to_location as string;

    // Planned pickup → dropoff (always shown).
    const plannedOrigin: LatLng | { address: string } =
      job.pickup_lat != null && job.pickup_lng != null
        ? { lat: Number(job.pickup_lat), lng: Number(job.pickup_lng) }
        : { address: pickupAddress };
    const planned = await computeLeg({
      origin: plannedOrigin,
      destination_address: dropoffAddress,
    });
    if (planned) {
      planned.origin_label = pickupLabel;
      planned.destination_label = dropoffLabel;
    }

    // Post-acceptance driver → pickup, only after driver has accepted and
    // before pickup is completed. Uses the latest driver_locations ping.
    let toPickup: Leg = null;
    let driverPing:
      | { lat: number; lng: number; captured_at: string; accuracy_m: number | null }
      | null = null;
    const acceptedPhase =
      !!job.driver_accepted_at &&
      job.driver_id &&
      ["pending", "en_route"].includes((job.status ?? "").toLowerCase());
    if (acceptedPhase) {
      const { data: pts } = await supabaseAdmin
        .from("driver_locations")
        .select("latitude, longitude, captured_at, accuracy_m")
        .eq("job_id", job.id)
        .order("captured_at", { ascending: false })
        .limit(1);
      const p = pts?.[0];
      if (p && p.latitude != null && p.longitude != null) {
        driverPing = {
          lat: Number(p.latitude),
          lng: Number(p.longitude),
          captured_at: p.captured_at as string,
          accuracy_m: p.accuracy_m ?? null,
        };
        toPickup = await computeLeg({
          origin: { lat: driverPing.lat, lng: driverPing.lng },
          destination_address: pickupAddress,
        });
        if (toPickup) {
          toPickup.origin_label = "Driver's current location";
          toPickup.destination_label = pickupLabel;
        }
      }
    }

    return {
      phase: (job.driver_accepted_at ? "post" : "pre") as "pre" | "post",
      status: (job.status ?? null) as string | null,
      planned,
      toPickup,
      driverPing,
    };
  });
