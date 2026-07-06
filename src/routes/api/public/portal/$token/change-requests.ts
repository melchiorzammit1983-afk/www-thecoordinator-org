import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { resolvePortalByToken, checkRateLimit, getAdmin } from "@/lib/portal-token.server";

export const Route = createFileRoute("/api/public/portal/$token/change-requests")({
  server: {
    handlers: {
      POST: async ({ params, request }) => {
        const r = await resolvePortalByToken(params.token);
        if (!r.ok) return Response.json({ error: r.error }, { status: r.status });
        if (!(await checkRateLimit(params.token))) return Response.json({ error: "rate_limited" }, { status: 429 });

        const body = await request.json().catch(() => ({}));
        const parsed = z.object({
          booking_id: z.string().uuid(),
          kind: z.enum(["edit", "cancel", "reschedule"]),
          requested_changes: z.record(z.string(), z.any()).optional(),
        }).safeParse(body);
        if (!parsed.success) return Response.json({ error: "bad_input" }, { status: 400 });

        const admin = await getAdmin();
        // verify the booking belongs to this portal
        const { data: b } = await admin.from("portal_bookings" as any)
          .select("id, job_id, portal_company_id").eq("id", parsed.data.booking_id).maybeSingle();
        if (!b || (b as any).portal_company_id !== r.portal.id)
          return Response.json({ error: "not_found" }, { status: 404 });

        const { error } = await admin.from("portal_change_requests" as any).insert({
          portal_booking_id: parsed.data.booking_id,
          job_id: (b as any).job_id,
          kind: parsed.data.kind,
          requested_changes: parsed.data.requested_changes ?? {},
        } as any);
        if (error) return Response.json({ error: error.message }, { status: 500 });

        await admin.from("portal_bookings" as any)
          .update({ status: "change_requested" } as any).eq("id", parsed.data.booking_id);
        return Response.json({ ok: true });
      },
    },
  },
});
