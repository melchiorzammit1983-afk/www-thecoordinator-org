import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

/**
 * Returns a base64-encoded PNG data URL for a small static route map
 * between two addresses (pickup A → dropoff B), optionally with a live
 * driver marker. Called from `RouteThumb` on trip cards.
 *
 * Uses the Google Static Maps API through the Lovable Google Maps
 * connector gateway. The `<img>` tag can't send the gateway auth headers
 * directly, so we proxy the request and return the bytes inline.
 *
 * Response is small (<= ~12 KB PNG), so inlining is cheaper than signing
 * a per-request URL.
 */
export const getRouteThumb = createServerFn({ method: "POST" })
  .inputValidator((i: unknown) =>
    z
      .object({
        from: z.string().min(2).max(300),
        to: z.string().min(2).max(300),
        driver: z
          .object({
            lat: z.number().gte(-90).lte(90),
            lng: z.number().gte(-180).lte(180),
          })
          .nullable()
          .optional(),
        width: z.number().int().min(80).max(400).default(192),
        height: z.number().int().min(60).max(300).default(112),
        scale: z.union([z.literal(1), z.literal(2)]).default(2),
      })
      .parse(i),
  )
  .handler(async ({ data }) => {
    const LOVABLE_API_KEY = process.env.LOVABLE_API_KEY;
    const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY;
    if (!LOVABLE_API_KEY || !GOOGLE_MAPS_API_KEY) {
      return { ok: false as const, reason: "static_map_unavailable" };
    }

    const params = new URLSearchParams();
    params.set("size", `${data.width}x${data.height}`);
    params.set("scale", String(data.scale));
    params.set("maptype", "roadmap");
    // Soft, low-contrast style so the pins/path pop
    params.append("style", "feature:poi|visibility:off");
    params.append("style", "feature:transit|visibility:off");
    params.append("style", "feature:administrative|element:labels|visibility:simplified");
    // A (pickup) — green, B (dropoff) — red
    params.append("markers", `color:0x10b981|label:A|${data.from}`);
    params.append("markers", `color:0xef4444|label:B|${data.to}`);
    if (data.driver) {
      params.append(
        "markers",
        `color:0x2563eb|size:small|${data.driver.lat},${data.driver.lng}`,
      );
    }
    // Straight geodesic line between A and B (subtle blue)
    params.append(
      "path",
      `color:0x2563ebcc|weight:3|geodesic:true|${data.from}|${data.to}`,
    );

    const url = `https://connector-gateway.lovable.dev/google_maps/maps/api/staticmap?${params.toString()}`;
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "X-Connection-Api-Key": GOOGLE_MAPS_API_KEY,
      },
    });
    if (!res.ok) {
      return { ok: false as const, reason: `static_map_${res.status}` };
    }
    const buf = new Uint8Array(await res.arrayBuffer());
    // base64-encode
    let binary = "";
    const chunk = 0x8000;
    for (let i = 0; i < buf.length; i += chunk) {
      binary += String.fromCharCode(...buf.subarray(i, i + chunk));
    }
    const b64 = btoa(binary);
    return { ok: true as const, dataUrl: `data:image/png;base64,${b64}` };
  });
