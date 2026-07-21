import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { checkRateLimit, getAdmin } from "@/lib/portal-token.server";
import { resolvePublicPortal } from "./index";

const Input = z.object({
  visitor_id: z.string().min(8).max(80),
  from_location: z.string().min(1).max(200),
  to_location: z.string().min(1).max(200),
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
        const admin = await getAdmin();
        const { data, error } = await admin
          .from("public_booking_requests" as any)
          .insert({
            portal_id: r.portal.id,
            visitor_id,
            payload,
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
