import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Compute a live, traffic-aware driving route for a specific job.
 *
 * Authorization: the caller must EITHER
 *   (a) present a valid driver link token bound to the job (mobile driver
 *       app running on a tokenized route), OR
 *   (b) be an authenticated Supabase user who owns/collaborates on the
 *       job's company (coordinator/admin previews).
 *
 * The destination is ALWAYS resolved server-side from the job row — the
 * caller never supplies an arbitrary destination string, which prevents the
 * paid Google Routes API from being used as an open proxy.
 *
 * The origin is either the driver's live coordinates or a request to route
 * from the job's pickup address (used for the pre-acceptance preview).
 */
export const computeDriverRoute = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z
      .object({
        job_id: z.string().uuid(),
        driver_token: z.string().min(8).max(128).optional(),
        // Which leg of the trip to route to (pickup vs dropoff).
        leg: z.enum(["to_pickup", "to_dropoff"]).default("to_dropoff"),
        // Optional origin override:
        //   { latitude, longitude } → driver's current GPS fix
        //   { from_pickup: true }   → use the job's pickup address
        // If omitted we default to "from_pickup" so the preview keeps working.
        origin: z
          .union([
            z.object({
              latitude: z.number().min(-90).max(90),
              longitude: z.number().min(-180).max(180),
            }),
            z.object({ from_pickup: z.literal(true) }),
          ])
          .optional(),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const LOVABLE_API_KEY = process.env.LOVABLE_API_KEY;
    const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY;
    if (!LOVABLE_API_KEY || !GOOGLE_MAPS_API_KEY) {
      throw new Error("routing_unavailable");
    }

    // ---- Authorize the caller against the job -------------------------------
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: job, error: jobErr } = await supabaseAdmin
      .from("jobs")
      .select("id, company_id, executor_company_id, driver_id, from_location, to_location")
      .eq("id", data.job_id)
      .maybeSingle();
    if (jobErr || !job) throw new Error("Trip not found");

    let authorized = false;

    if (data.driver_token) {
      // Token path — validate the driver link and confirm it covers this job.
      const { resolveToken } = await import("@/lib/portal-token.server");
      const link = await resolveToken(data.driver_token, "driver");
      if (link) {
        if (link.subject_id) {
          if ((job as any).driver_id === link.subject_id) authorized = true;
        } else {
          const owners = [(job as any).company_id, (job as any).executor_company_id].filter(Boolean);
          if (owners.includes(link.company_id)) authorized = true;
        }
      }
    }

    if (!authorized) {
      // Fallback: authenticated Supabase user must be tied to the job's company.
      const { getRequest } = await import("@tanstack/react-start/server");
      const req = getRequest();
      const authHeader = req?.headers.get("authorization") ?? "";
      const token = authHeader.toLowerCase().startsWith("bearer ")
        ? authHeader.slice(7).trim()
        : "";
      if (!token) throw new Error("Unauthorized");
      const { createClient } = await import("@supabase/supabase-js");
      const authClient = createClient(
        process.env.SUPABASE_URL!,
        process.env.SUPABASE_PUBLISHABLE_KEY!,
        { auth: { persistSession: false, autoRefreshToken: false }, global: { headers: { Authorization: `Bearer ${token}` } } },
      );
      const { data: userRes } = await authClient.auth.getUser();
      const userId = userRes?.user?.id;
      if (!userId) throw new Error("Unauthorized");
      // Owner of the job's company or executor company?
      const companyIds = [(job as any).company_id, (job as any).executor_company_id].filter(Boolean);
      if (companyIds.length) {
        const { data: cos } = await supabaseAdmin
          .from("companies").select("id").eq("owner_user_id", userId).in("id", companyIds);
        if (cos && cos.length) authorized = true;
      }
      if (!authorized) {
        // Also allow the assigned driver's linked user.
        if ((job as any).driver_id) {
          const { data: drv } = await supabaseAdmin
            .from("drivers").select("linked_user_id").eq("id", (job as any).driver_id).maybeSingle();
          if ((drv as any)?.linked_user_id === userId) authorized = true;
        }
      }
      if (!authorized) throw new Error("Forbidden");
    }

    // ---- Build origin/destination from the job ------------------------------
    const destinationAddress =
      data.leg === "to_pickup" ? (job as any).from_location : (job as any).to_location;
    if (!destinationAddress) throw new Error("Trip has no destination address");

    let originField: unknown;
    if (data.origin && "latitude" in data.origin) {
      originField = { location: { latLng: data.origin } };
    } else {
      const pickup = (job as any).from_location;
      if (!pickup) throw new Error("Trip has no pickup address");
      originField = { address: pickup };
    }

    const url = "https://connector-gateway.lovable.dev/google_maps/routes/directions/v2:computeRoutes";
    const body = {
      origin: originField,
      destination: { address: destinationAddress },
      travelMode: "DRIVE",
      routingPreference: "TRAFFIC_AWARE",
      computeAlternativeRoutes: true,
      languageCode: "en-GB",
      units: "METRIC",
    };


    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "X-Connection-Api-Key": GOOGLE_MAPS_API_KEY,
        "Content-Type": "application/json",
        "X-Goog-FieldMask": [
          "routes.duration",
          "routes.staticDuration",
          "routes.distanceMeters",
          "routes.polyline.encodedPolyline",
          "routes.legs.steps.navigationInstruction",
          "routes.legs.steps.distanceMeters",
          "routes.legs.steps.polyline.encodedPolyline",
          "routes.legs.steps.startLocation",
          "routes.legs.steps.endLocation",
        ].join(","),
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`routes_api_${res.status}: ${text.slice(0, 200)}`);
    }

    const json = (await res.json()) as {
      routes?: Array<{
        duration?: string;
        staticDuration?: string;
        distanceMeters?: number;
        polyline?: { encodedPolyline?: string };
        legs?: Array<{
          steps?: Array<{
            navigationInstruction?: { instructions?: string; maneuver?: string };
            distanceMeters?: number;
            polyline?: { encodedPolyline?: string };
            startLocation?: { latLng?: { latitude: number; longitude: number } };
            endLocation?: { latLng?: { latitude: number; longitude: number } };
          }>;
        }>;
      }>;
    };

    const routes = json.routes ?? [];
    if (routes.length === 0) return { primary: null, alternatives: [] };

    const toSec = (s?: string) =>
      s && s.endsWith("s") ? Number(s.slice(0, -1)) : null;

    const normalize = (r: (typeof routes)[number]) => {
      const stepsRaw = r.legs?.[0]?.steps ?? [];
      const steps = stepsRaw
        .map((s) => {
          const end = s.endLocation?.latLng;
          return {
            maneuver: s.navigationInstruction?.maneuver ?? null,
            instruction: s.navigationInstruction?.instructions ?? null,
            distance_m: s.distanceMeters ?? null,
            polyline: s.polyline?.encodedPolyline ?? null,
            end: end ? { lat: end.latitude, lng: end.longitude } : null,
          };
        })
        .filter((s) => s.end != null);
      const firstStep = stepsRaw[0];
      return {
        duration_sec: toSec(r.duration),
        static_duration_sec: toSec(r.staticDuration),
        distance_m: r.distanceMeters ?? null,
        polyline: r.polyline?.encodedPolyline ?? null,
        next_instruction: firstStep?.navigationInstruction?.instructions ?? null,
        next_maneuver: firstStep?.navigationInstruction?.maneuver ?? null,
        next_step_distance_m: firstStep?.distanceMeters ?? null,
        steps,
      };
    };

    // Marker used by the requireSupabaseAuth wrapper. This function does its
    // own authorization above (driver-token OR authenticated user), so we
    // intentionally don't attach the standard middleware.
    void requireSupabaseAuth;

    return {
      primary: normalize(routes[0]),
      alternatives: routes.slice(1, 3).map(normalize),
    };
  });
