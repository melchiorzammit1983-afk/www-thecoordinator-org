import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

/**
 * Compute a live, traffic-aware driving route from the driver's current
 * coordinates to a destination address using Google Routes API v2
 * (computeRoutes) via the Lovable Google Maps connector gateway.
 *
 * Returns the primary route plus (up to two) alternatives so the client can
 * detect meaningful traffic delays and swap the displayed polyline when a
 * faster path exists.
 */
export const computeDriverRoute = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z
      .object({
        origin: z.object({
          latitude: z.number().min(-90).max(90),
          longitude: z.number().min(-180).max(180),
        }),
        destination_address: z.string().min(2).max(500),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const LOVABLE_API_KEY = process.env.LOVABLE_API_KEY;
    const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY;
    if (!LOVABLE_API_KEY || !GOOGLE_MAPS_API_KEY) {
      throw new Error("routing_unavailable");
    }

    const url = "https://connector-gateway.lovable.dev/google_maps/routes/directions/v2:computeRoutes";
    const body = {
      origin: { location: { latLng: data.origin } },
      destination: { address: data.destination_address },
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
      const firstStep = r.legs?.[0]?.steps?.[0];
      return {
        duration_sec: toSec(r.duration),
        static_duration_sec: toSec(r.staticDuration),
        distance_m: r.distanceMeters ?? null,
        polyline: r.polyline?.encodedPolyline ?? null,
        next_instruction: firstStep?.navigationInstruction?.instructions ?? null,
        next_maneuver: firstStep?.navigationInstruction?.maneuver ?? null,
        next_step_distance_m: firstStep?.distanceMeters ?? null,
      };
    };

    return {
      primary: normalize(routes[0]),
      alternatives: routes.slice(1, 3).map(normalize),
    };
  });
