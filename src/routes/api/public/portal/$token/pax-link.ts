import { createFileRoute } from "@tanstack/react-router";
import { resolvePortalByToken, getAdmin } from "@/lib/portal-token.server";

export const Route = createFileRoute("/api/public/portal/$token/pax-link")({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        const r = await resolvePortalByToken(params.token);
        if (!r.ok) return Response.json({ error: r.error }, { status: r.status });
        const url = new URL(request.url);
        const bookingId = url.searchParams.get("booking_id");
        if (!bookingId) return Response.json({ error: "bad_input" }, { status: 400 });
        const admin = await getAdmin();
        const { data: b } = await admin.from("portal_bookings" as any)
          .select("id, portal_company_id, job_id").eq("id", bookingId).maybeSingle();
        if (!b || (b as any).portal_company_id !== r.portal.id)
          return Response.json({ error: "not_found" }, { status: 404 });
        const { data: tok } = await admin.from("pax_tracking_tokens" as any)
          .select("token").eq("portal_booking_id", bookingId).maybeSingle();
        if (!tok) return Response.json({ error: "not_ready" }, { status: 404 });
        return Response.json({ pax_token: (tok as any).token });
      },
    },
  },
});
