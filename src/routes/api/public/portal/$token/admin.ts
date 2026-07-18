/**
 * Hotel-token admin endpoint. Same auth model as the other `$token/*` routes:
 * the magic token identifies the hotel and gates all reads/writes. Rate-limited.
 */
import { createFileRoute } from "@tanstack/react-router";
import { resolvePortalByToken, checkRateLimit } from "@/lib/portal-token.server";
import {
  loadHotelAdminData,
  upsertResource,
  deleteResource,
  updateSettings,
  rotateRoomQr,
  bulkCreateRooms,
  RoomInput,
  ZoneInput,
  FareInput,
  PromoInput,
  AddonInput,
  OfferInput,
  SettingsInput,
} from "@/lib/portal-hotel.server";
import { z } from "zod";

const VALIDATORS: Record<string, any> = {
  rooms: RoomInput,
  zones: ZoneInput,
  fares: FareInput,
  promos: PromoInput,
  addons: AddonInput,
  offers: OfferInput,
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

export const Route = createFileRoute("/api/public/portal/$token/admin")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const r = await resolvePortalByToken(params.token);
        if (!r.ok) return json({ error: r.error }, r.status);
        const data = await loadHotelAdminData(r.portal.id);
        return json(data);
      },
      POST: async ({ params, request }) => {
        const r = await resolvePortalByToken(params.token);
        if (!r.ok) return json({ error: r.error }, r.status);
        if (!(await checkRateLimit(params.token, 120))) return json({ error: "rate_limited" }, 429);
        const body = (await request.json().catch(() => null)) as any;
        if (!body || typeof body !== "object") return json({ error: "bad_body" }, 400);

        try {
          const action = String(body.action || "");
          if (action === "settings") {
            const patch = SettingsInput.parse(body.data ?? {});
            const row = await updateSettings(r.portal.id, patch);
            return json({ ok: true, portal: row });
          }
          if (action === "bulk_rooms") {
            const entries = z.array(z.object({ room_number: z.string().min(1), label: z.string().optional().nullable() })).max(500).parse(body.data ?? []);
            const res = await bulkCreateRooms(r.portal.id, entries);
            return json({ ok: true, ...res });
          }
          if (action === "rotate_qr") {
            const id = z.string().uuid().parse(body.id);
            const res = await rotateRoomQr(r.portal.id, id);
            return json({ ok: true, ...res });
          }
          if (action === "upsert" || action === "delete") {
            const resource = String(body.resource || "");
            if (!VALIDATORS[resource]) return json({ error: "bad_resource" }, 400);
            if (action === "upsert") {
              const payload = VALIDATORS[resource].parse(body.data ?? {});
              const row = await upsertResource(r.portal.id, resource as any, payload);
              return json({ ok: true, row });
            }
            const id = z.string().uuid().parse(body.id);
            await deleteResource(r.portal.id, resource as any, id);
            return json({ ok: true });
          }
          return json({ error: "bad_action" }, 400);
        } catch (e: any) {
          const msg = e?.message ?? "error";
          console.error("portal admin error", msg);
          const status = msg === "not_found" ? 404 : msg === "zone_not_in_portal" ? 400 : 400;
          return json({ error: msg }, status);
        }
      },
    },
  },
});
