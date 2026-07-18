/**
 * Guest QR entry point. GET returns the room + portal branding.
 * POST creates a guest session tied to a room.
 */
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { resolveRoomByQr } from "@/lib/portal-hotel.server";
import { getAdmin, checkRateLimit } from "@/lib/portal-token.server";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const Body = z.object({
  guest_name: z.string().min(1).max(120),
  email: z.string().email().max(200).optional().nullable(),
  phone: z.string().max(40).optional().nullable(),
  ttl_hours: z.number().int().min(1).max(24 * 14).optional(),
});

export const Route = createFileRoute("/api/public/portal/guest/room/$qr")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const r = await resolveRoomByQr(params.qr);
        if (!r.ok) return json({ error: r.error }, r.status);
        const { portal, room } = r;
        return json({
          room,
          portal: {
            id: portal.id, name: portal.name, slug: portal.slug, logo_url: portal.logo_url,
            brand_color: portal.brand_color, display_name_for_passenger: portal.display_name_for_passenger,
            currency: portal.currency, pricing_mode: portal.pricing_mode,
          },
        });
      },
      POST: async ({ params, request }) => {
        const r = await resolveRoomByQr(params.qr);
        if (!r.ok) return json({ error: r.error }, r.status);
        if (!(await checkRateLimit(`qr:${params.qr}`, 10))) return json({ error: "rate_limited" }, 429);
        const parsed = Body.safeParse(await request.json().catch(() => null));
        if (!parsed.success) return json({ error: "bad_body" }, 400);
        const admin = await getAdmin();
        const { randomBytes } = await import("node:crypto");
        const token = randomBytes(24).toString("hex");
        const ttlHours = parsed.data.ttl_hours ?? 72;
        const expires = new Date(Date.now() + ttlHours * 3600_000).toISOString();
        const { data, error } = await admin
          .from("portal_guest_sessions" as any)
          .insert({
            portal_company_id: r.portal.id,
            room_id: r.room.id,
            session_token: token,
            guest_name: parsed.data.guest_name.trim(),
            email: parsed.data.email ?? null,
            phone: parsed.data.phone ?? null,
            expires_at: expires,
          })
          .select("session_token, expires_at")
          .single();
        if (error) return json({ error: error.message }, 500);
        return json({ ok: true, session_token: (data as any).session_token, expires_at: (data as any).expires_at });
      },
    },
  },
});
