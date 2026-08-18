import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { checkRateLimit, getAdmin } from "@/lib/portal-token.server";
import { resolveBookingJourney } from "@/lib/journey-resolver";
import { assertTokenPortSelection } from "@/lib/port-directory-token.server";
import { resolvePublicPortal } from "./index";

const Input = z.object({
  visitor_id: z.string().min(8).max(80),
  from_location: z.string().min(1).max(200),
  to_location: z.string().min(1).max(200),
  from_location_type: z.enum(["airport", "port", "local"]),
  to_location_type: z.enum(["airport", "port", "local"]),
  from_port_id: z.string().uuid().nullable().optional(),
  from_berth_id: z.string().uuid().nullable().optional(),
  to_port_id: z.string().uuid().nullable().optional(),
  to_berth_id: z.string().uuid().nullable().optional(),
  immigration_required: z.enum(["yes", "no", "unknown"]).optional(),
  pickup_at: z.string().datetime().nullable().optional(),
  date: z.string().nullable().optional(),
  time: z.string().nullable().optional(),
  name: z.string().max(80).nullable().optional(),
  surname: z.string().max(80).nullable().optional(),
  client_email: z.string().email().nullable().optional(),
  client_phone: z.string().max(40).nullable().optional(),
  flight_number: z.string().max(20).nullable().optional(),
  pax_count: z.number().int().min(1).max(20).nullable().optional(),
  pax_names: z.array(z.string().max(120)).max(20).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
});

export const Route = createFileRoute("/api/public/b/$token/submit")({
  server: {
    handlers: {
      POST: async ({ params, request }) => {
        const r = await resolvePublicPortal(params.token);
        if (!r.ok) return Response.json({ error: r.error }, { status: r.status });
        if (!(await checkRateLimit(`b:${params.token}`, 15))) {
          return Response.json({ error: "rate_limited" }, { status: 429 });
        }
        const body = await request.json().catch(() => ({}));
        const parsed = Input.safeParse(body);
        if (!parsed.success) return Response.json({ error: "bad_input" }, { status: 400 });
        const { visitor_id, ...payload } = parsed.data;
        const journey = resolveBookingJourney(payload.from_location_type, payload.to_location_type);
        const admin = await getAdmin();
        const fromPort = await assertTokenPortSelection(admin, r.portal.coordinator_company_id, payload.from_port_id, payload.from_berth_id);
        const toPort = await assertTokenPortSelection(admin, r.portal.coordinator_company_id, payload.to_port_id, payload.to_berth_id);
        if (fromPort && payload.from_location_type !== "port") return Response.json({ error: "port_endpoint_type_required" }, { status: 400 });
        if (toPort && payload.to_location_type !== "port") return Response.json({ error: "port_endpoint_type_required" }, { status: 400 });
        const { data, error } = await admin
          .from("public_booking_requests" as any)
          .insert({
            portal_id: r.portal.id,
            visitor_id,
            payload: {
              ...payload,
              from_location: fromPort?.address ?? payload.from_location,
              to_location: toPort?.address ?? payload.to_location,
              journey_type: journey.journeyType,
            },
            status: "pending",
          } as any)
          .select("id")
          .single();
        if (error) return Response.json({ error: error.message }, { status: 500 });
        return Response.json({ ok: true, id: (data as any).id, ref: (data as any).id.slice(0, 8) });
      },
    },
  },
});
