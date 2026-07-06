import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { getAdmin, checkRateLimit, verifyPaxJwt } from "@/lib/portal-token.server";

/**
 * Guest opts in to share own location OR view the driver's location.
 * Both default OFF for privacy. Auto-expires 30 min after trip completion.
 */
export const Route = createFileRoute("/api/public/track/$token/location")({
  server: {
    handlers: {
      POST: async ({ params, request }) => {
        const auth = request.headers.get("authorization") ?? "";
        const jwt = auth.startsWith("Bearer ") ? auth.slice(7) : "";
        const v = verifyPaxJwt(jwt);
        if (!v || v.token !== params.token) return Response.json({ error: "unauthorized" }, { status: 401 });
        if (!(await checkRateLimit(params.token, 30))) return Response.json({ error: "rate_limited" }, { status: 429 });

        const body = await request.json().catch(() => ({}));
        const parsed = z.object({
          share_own: z.boolean().optional(),
          show_driver: z.boolean().optional(),
          lat: z.number().optional(),
          lng: z.number().optional(),
        }).safeParse(body);
        if (!parsed.success) return Response.json({ error: "bad_input" }, { status: 400 });

        const admin = await getAdmin();
        const patch: any = {};
        const now = new Date();
        if (parsed.data.share_own === true) {
          patch.location_share_granted_at = now.toISOString();
          patch.location_share_expires_at = new Date(now.getTime() + 4 * 60 * 60 * 1000).toISOString();
        }
        if (parsed.data.share_own === false) {
          patch.location_share_granted_at = null;
          patch.location_share_expires_at = null;
        }
        if (typeof parsed.data.show_driver === "boolean") patch.show_driver_location = parsed.data.show_driver;
        if (Object.keys(patch).length)
          await admin.from("pax_tracking_tokens" as any).update(patch).eq("token", params.token);
        return Response.json({ ok: true });
      },
    },
  },
});
