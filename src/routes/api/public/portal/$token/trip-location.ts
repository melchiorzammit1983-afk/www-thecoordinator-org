import { createFileRoute } from "@tanstack/react-router";
import { resolvePortalByToken, getAdmin } from "@/lib/portal-token.server";

/**
 * GET /api/public/portal/$token/trip-location?job_id=...
 * Live driver position for one of this portal's own accepted trips, for the
 * map on the HR-side Trips tab. job_id is only ever trusted after confirming
 * it belongs to a portal_booking under this exact portal.
 */
export const Route = createFileRoute("/api/public/portal/$token/trip-location")({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        const r = await resolvePortalByToken(params.token);
        if (!r.ok) return Response.json({ error: r.error }, { status: r.status });

        const url = new URL(request.url);
        const jobId = url.searchParams.get("job_id");
        if (!jobId) return Response.json({ error: "bad_input" }, { status: 400 });

        const admin = await getAdmin();
        const { data: booking } = await admin.from("portal_bookings" as any)
          .select("id").eq("portal_company_id", r.portal.id).eq("job_id", jobId).maybeSingle();
        if (!booking) return Response.json({ error: "not_found" }, { status: 404 });

        const { data: job } = await admin.from("jobs").select("driver_id, status").eq("id", jobId).maybeSingle();
        if (!(job as any)?.driver_id) return Response.json({ driver: null, job_status: (job as any)?.status ?? null });

        const { data: point } = await admin.from("driver_locations")
          .select("latitude, longitude, captured_at, heading, speed_mps")
          .eq("job_id", jobId)
          .order("captured_at", { ascending: false }).limit(1).maybeSingle();
        return Response.json({ driver: point ?? null, job_status: (job as any).status });
      },
    },
  },
});
