import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Trip map / replay data source.
 *
 * Returns everything the coordinator sheet needs to draw the "live + history"
 * layer on top of the base A→B map:
 *   - planned pickup / drop-off coordinates + display names
 *   - all recorded map events (arrived, in-progress, actual drop-off, snaps,
 *     emergency overrides) for pin markers
 *   - the driver's breadcrumb polyline for this job (from driver_locations)
 *   - the latest live ETA the driver's device pushed while en route
 *
 * Access is enforced by RLS on `trip_map_events` and `driver_locations`.
 */
export const getTripMap = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ job_id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { supabase } = context;

    const jobRes = await supabase
      .from("jobs")
      .select(
        "id, from_location, to_location, pickup_display_name, dropoff_display_name, pickup_lat, pickup_lng, dropoff_lat, dropoff_lng, route_duration_sec, route_computed_at, live_eta_sec, live_eta_updated_at, live_eta_from_lat, live_eta_from_lng, status, driver_id",
      )
      .eq("id", data.job_id)
      .maybeSingle();
    if (jobRes.error) throw new Error(jobRes.error.message);
    if (!jobRes.data) throw new Error("job_not_found");
    const job = jobRes.data as any;

    const [eventsRes, crumbsRes] = await Promise.all([
      supabase
        .from("trip_map_events")
        .select(
          "id, event_type, lat, lng, accuracy_m, notes, meta, occurred_at",
        )
        .eq("job_id", data.job_id)
        .order("occurred_at", { ascending: true }),
      job.driver_id
        ? supabase
            .from("driver_locations")
            .select("latitude, longitude, captured_at")
            .eq("job_id", data.job_id)
            .order("captured_at", { ascending: true })
            .limit(2000)
        : Promise.resolve({ data: [], error: null } as any),
    ]);
    if (eventsRes.error) throw new Error(eventsRes.error.message);
    if (crumbsRes.error) throw new Error(crumbsRes.error.message);

    return {
      job: {
        id: job.id,
        pickup_label: job.pickup_display_name || job.from_location,
        dropoff_label: job.dropoff_display_name || job.to_location,
        pickup_lat: job.pickup_lat,
        pickup_lng: job.pickup_lng,
        dropoff_lat: job.dropoff_lat,
        dropoff_lng: job.dropoff_lng,
        planned_duration_sec: job.route_duration_sec ?? null,
        planned_updated_at: job.route_computed_at ?? null,
        live_eta_sec: job.live_eta_sec ?? null,
        live_eta_updated_at: job.live_eta_updated_at ?? null,
        live_eta_from_lat: job.live_eta_from_lat ?? null,
        live_eta_from_lng: job.live_eta_from_lng ?? null,
        status: job.status,
      },
      events: (eventsRes.data ?? []).map((r: any) => ({
        id: r.id as string,
        event_type: r.event_type as string,
        lat: r.lat as number | null,
        lng: r.lng as number | null,
        accuracy_m: r.accuracy_m as number | null,
        notes: r.notes as string | null,
        meta: (r.meta ?? null) as string | null,
        occurred_at: r.occurred_at as string,
      })),
      breadcrumb: (crumbsRes.data ?? []).map((p: any) => ({
        lat: p.latitude,
        lng: p.longitude,
        t: p.captured_at,
      })),
    };
  });

/**
 * Refresh the driver's live ETA to the current next stop. Called by the
 * driver client only on significant movement (>500 m) or every 2 min while
 * the trip is en route / in progress. Metered by `live_eta_refresh`.
 */
export const refreshLiveEta = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        job_id: z.string().uuid(),
        lat: z.number().gte(-90).lte(90),
        lng: z.number().gte(-180).lte(180),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;

    // Load job + confirm caller is the assigned driver.
    const { data: job, error: jerr } = await supabase
      .from("jobs")
      .select(
        "id, company_id, executor_company_id, driver_id, status, from_location, to_location, dropoff_lat, dropoff_lng, dropoff_display_name, pickup_lat, pickup_lng",
      )
      .eq("id", data.job_id)
      .maybeSingle();
    if (jerr) throw new Error(jerr.message);
    if (!job) throw new Error("job_not_found");

    // Destination = drop-off if past arrival, else pickup.
    const status = String((job as any).status ?? "");
    const goingToDropoff = status === "in_progress" || status === "arrived";
    const destAddress = goingToDropoff
      ? (job as any).dropoff_display_name || (job as any).to_location
      : (job as any).from_location;
    if (!destAddress) return { ok: false, reason: "no_destination" };

    // Meter feature (0.1 pts by default, non-blocking).
    try {
      await supabase.rpc("spend_points", {
        _company_id: (job as any).executor_company_id ?? (job as any).company_id,
        _feature_key: "live_eta_refresh",
        _job_id: data.job_id,
      });
    } catch {
      /* metering failures shouldn't hide the ETA */
    }

    // Ask Google Routes v2 through the gateway.
    const LOVABLE_API_KEY = process.env.LOVABLE_API_KEY;
    const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY;
    if (!LOVABLE_API_KEY || !GOOGLE_MAPS_API_KEY) {
      return { ok: false, reason: "routing_unavailable" };
    }
    const res = await fetch(
      "https://connector-gateway.lovable.dev/google_maps/routes/directions/v2:computeRoutes",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "X-Connection-Api-Key": GOOGLE_MAPS_API_KEY,
          "Content-Type": "application/json",
          "X-Goog-FieldMask": "routes.duration",
        },
        body: JSON.stringify({
          origin: { location: { latLng: { latitude: data.lat, longitude: data.lng } } },
          destination: { address: destAddress },
          travelMode: "DRIVE",
          routingPreference: "TRAFFIC_AWARE",
        }),
      },
    );
    if (!res.ok) return { ok: false, reason: `routes_${res.status}` };
    const json = (await res.json()) as { routes?: Array<{ duration?: string }> };
    const dur = json.routes?.[0]?.duration;
    const sec = dur && dur.endsWith("s") ? Number(dur.slice(0, -1)) : null;
    if (!sec || !Number.isFinite(sec)) return { ok: false, reason: "no_route" };

    await supabase
      .from("jobs")
      .update({
        live_eta_sec: Math.round(sec),
        live_eta_updated_at: new Date().toISOString(),
        live_eta_from_lat: data.lat,
        live_eta_from_lng: data.lng,
      } as never)
      .eq("id", data.job_id);

    return { ok: true, live_eta_sec: Math.round(sec) };
  });
