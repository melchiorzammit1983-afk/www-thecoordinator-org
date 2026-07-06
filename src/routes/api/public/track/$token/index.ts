import { createFileRoute } from "@tanstack/react-router";
import { getAdmin } from "@/lib/portal-token.server";

/**
 * GET /api/public/track/$token — public read of the passenger tracking page.
 * Returns ONLY the passenger-audience projection: hotel branding + trip status
 * + minimal driver info once assigned. Never coordinator identity.
 */
export const Route = createFileRoute("/api/public/track/$token/")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        if (!params.token || params.token.length < 20) return Response.json({ error: "bad_token" }, { status: 400 });
        const admin = await getAdmin();
        const { data: tok } = await admin.from("pax_tracking_tokens" as any)
          .select("id, job_id, portal_booking_id, revoked_at, show_driver_location, location_share_expires_at")
          .eq("token", params.token).maybeSingle();
        if (!tok || (tok as any).revoked_at)
          return Response.json({ error: "not_found" }, { status: 404 });

        const [{ data: job }, { data: booking }] = await Promise.all([
          admin.from("jobs")
            .select("id, status, pickup_at, from_location, to_location, driver_id, drivers(name, car_make_model, plate)")
            .eq("id", (tok as any).job_id).maybeSingle(),
          (tok as any).portal_booking_id
            ? admin.from("portal_bookings" as any)
                .select("portal_companies!inner(name, logo_url, brand_color, display_name_for_passenger)")
                .eq("id", (tok as any).portal_booking_id).maybeSingle()
            : Promise.resolve({ data: null }),
        ]);
        if (!job) return Response.json({ error: "not_found" }, { status: 404 });

        const pc = (booking as any)?.portal_companies ?? null;
        const brand = pc ? {
          name: pc.display_name_for_passenger ?? pc.name,
          logo_url: pc.logo_url,
          brand_color: pc.brand_color,
        } : null;

        const driver = (job as any).drivers ? {
          first_name: String((job as any).drivers.name ?? "").split(" ")[0] || "Driver",
          vehicle: (job as any).drivers.car_make_model,
          plate: (job as any).drivers.plate,
        } : null;

        return Response.json({
          brand,
          status: (job as any).status,
          pickup_at: (job as any).pickup_at,
          from: (job as any).from_location,
          to: (job as any).to_location,
          driver,
          show_driver_location: (tok as any).show_driver_location === true,
        });
      },
    },
  },
});
