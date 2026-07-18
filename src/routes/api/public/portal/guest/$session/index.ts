/**
 * Guest session endpoint. GET bootstraps the mini-portal (zones, addons,
 * offers, my bookings). POST creates a booking for the current session.
 */
import { createFileRoute } from "@tanstack/react-router";
import { resolveGuestSession, loadGuestBootstrap, createGuestBooking, GuestBookingInput } from "@/lib/portal-hotel.server";
import { checkRateLimit } from "@/lib/portal-token.server";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

export const Route = createFileRoute("/api/public/portal/guest/$session")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const r = await resolveGuestSession(params.session);
        if (!r.ok) return json({ error: r.error }, r.status);
        const boot = await loadGuestBootstrap(r.portal.id, (r.session as any).id);
        return json({
          portal: {
            id: r.portal.id, name: r.portal.name, slug: r.portal.slug, logo_url: r.portal.logo_url,
            brand_color: r.portal.brand_color, display_name_for_passenger: r.portal.display_name_for_passenger,
            currency: r.portal.currency, pricing_mode: r.portal.pricing_mode,
          },
          guest: {
            name: (r.session as any).guest_name,
            email: (r.session as any).email,
            phone: (r.session as any).phone,
            expires_at: (r.session as any).expires_at,
          },
          ...boot,
        });
      },
      POST: async ({ params, request }) => {
        if (!(await checkRateLimit(`sess:${params.session}`, 20))) return json({ error: "rate_limited" }, 429);
        const body = await request.json().catch(() => null);
        const parsed = GuestBookingInput.safeParse(body);
        if (!parsed.success) return json({ error: "bad_body", issues: parsed.error.issues }, 400);
        const r = await createGuestBooking(params.session, parsed.data);
        if (!r.ok) return json({ error: r.error }, r.status);
        return json({ ok: true, booking: r.booking });
      },
    },
  },
});
