import { createFileRoute } from "@tanstack/react-router";
import { resolvePortalByToken, getAdmin } from "@/lib/portal-token.server";

/**
 * GET /api/public/portal/$token/trip-location?job_id=...
 * Everything the HR-side Trips-tab map needs for one of this portal's own
 * accepted trips: pickup/dropoff pins, the driver's live position, their
 * breadcrumb track so far, event pins (movement/boarding milestones), and
 * the latest ETA the driver's device pushed. job_id is only ever trusted
 * after confirming it belongs to a portal_booking under this exact portal.
 */

// Only movement/boarding events are appropriate for an external portal — no
// waiting (billing-adjacent), driver-ops (GPS snaps, nav, calls), safety
// (incident data), or internal correction events. This is the sole
// enforcement point since the portal reads via the service-role client and
// bypasses RLS.
const PORTAL_VISIBLE_EVENT_TYPES = [
  "en_route", "arrived_pickup", "in_progress", "completed", "actual_dropoff",
  "pax_boarded", "boarding_approved", "boarding_rejected", "pax_no_show", "pax_cancelled",
];

export const Route = createFileRoute("/api/public/portal/$token/trip-location")({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        const r = await resolvePortalByToken(params.token, request);
        if (!r.ok) return Response.json({ error: r.error }, { status: r.status });

        const url = new URL(request.url);
        const jobId = url.searchParams.get("job_id");
        if (!jobId) return Response.json({ error: "bad_input" }, { status: 400 });

        const admin = await getAdmin();
        const { data: booking } = await admin.from("portal_bookings" as any)
          .select("id").eq("portal_company_id", r.portal.id).eq("job_id", jobId).maybeSingle();
        if (!booking) return Response.json({ error: "not_found" }, { status: 404 });

        const { data: job } = await admin.from("jobs")
          .select("driver_id, status, pickup_lat, pickup_lng, pickup_display_name, dropoff_lat, dropoff_lng, dropoff_display_name, live_eta_sec, live_eta_updated_at")
          .eq("id", jobId).maybeSingle();
        if (!job) return Response.json({ error: "not_found" }, { status: 404 });

        const pickup = (job as any).pickup_lat != null && (job as any).pickup_lng != null
          ? { lat: (job as any).pickup_lat, lng: (job as any).pickup_lng, label: (job as any).pickup_display_name ?? null }
          : null;
        const dropoff = (job as any).dropoff_lat != null && (job as any).dropoff_lng != null
          ? { lat: (job as any).dropoff_lat, lng: (job as any).dropoff_lng, label: (job as any).dropoff_display_name ?? null }
          : null;

        if (!(job as any).driver_id) {
          return Response.json({ driver: null, breadcrumb: [], pickup, dropoff, eta_sec: null, job_status: (job as any).status, events: [] });
        }

        const { data: crumbs } = await admin.from("driver_locations")
          .select("latitude, longitude, captured_at")
          .eq("job_id", jobId)
          .order("captured_at", { ascending: true }).limit(1000);
        const breadcrumb = (crumbs ?? []).map((p: any) => ({ lat: p.latitude, lng: p.longitude, t: p.captured_at }));
        const latest = crumbs && crumbs.length ? (crumbs as any)[crumbs.length - 1] : null;
        const driver = latest ? { latitude: latest.latitude, longitude: latest.longitude, captured_at: latest.captured_at } : null;

        const { data: events } = await admin.from("trip_map_events" as any)
          .select("id, event_type, lat, lng, occurred_at, notes")
          .eq("job_id", jobId)
          .in("event_type", PORTAL_VISIBLE_EVENT_TYPES)
          .order("occurred_at", { ascending: true });

        return Response.json({
          driver, breadcrumb, pickup, dropoff,
          eta_sec: (job as any).live_eta_sec ?? null,
          eta_updated_at: (job as any).live_eta_updated_at ?? null,
          job_status: (job as any).status,
          events: events ?? [],
        });
      },
    },
  },
});
