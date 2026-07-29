import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { getAdmin, checkRateLimit, verifyPaxJwt, isChangeLocked } from "@/lib/portal-token.server";

/**
 * Passenger-initiated edit/reschedule/cancel on their own portal booking.
 * Reuses the exact same portal_change_requests → decideChangeRequest
 * pipeline the HR side already uses (change-requests.ts under
 * /api/public/portal/$token/) — every request still needs the
 * coordinator's approval before anything actually changes. Locked once a
 * driver is assigned and pickup is within the 3-hour cutoff.
 */
export const Route = createFileRoute("/api/public/track/$token/change-requests")({
  server: {
    handlers: {
      POST: async ({ params, request }) => {
        const auth = request.headers.get("authorization") ?? "";
        const jwt = auth.startsWith("Bearer ") ? auth.slice(7) : "";
        const v = verifyPaxJwt(jwt);
        if (!v || v.token !== params.token) return Response.json({ error: "unauthorized" }, { status: 401 });
        if (!(await checkRateLimit(params.token))) return Response.json({ error: "rate_limited" }, { status: 429 });

        const body = await request.json().catch(() => ({}));
        const parsed = z.object({
          kind: z.enum(["edit", "cancel", "reschedule"]),
          requested_changes: z.record(z.string(), z.any()).optional(),
        }).safeParse(body);
        if (!parsed.success) return Response.json({ error: "bad_input" }, { status: 400 });

        const admin = await getAdmin();
        const { data: tok } = await admin.from("pax_tracking_tokens" as any)
          .select("job_id, portal_booking_id").eq("token", params.token).maybeSingle();
        if (!tok || !(tok as any).portal_booking_id) return Response.json({ error: "not_found" }, { status: 404 });

        const { data: b } = await admin.from("portal_bookings" as any)
          .select("id, job_id, status").eq("id", (tok as any).portal_booking_id).maybeSingle();
        if (!b) return Response.json({ error: "not_found" }, { status: 404 });
        if (!["pending", "accepted"].includes((b as any).status))
          return Response.json({ error: "not_editable" }, { status: 409 });

        if ((b as any).job_id) {
          const { data: job } = await admin.from("jobs").select("driver_id, pickup_at").eq("id", (b as any).job_id).maybeSingle();
          if (isChangeLocked(job as any)) return Response.json({ error: "too_close_to_pickup" }, { status: 409 });
        }

        const { error } = await admin.from("portal_change_requests" as any).insert({
          portal_booking_id: (b as any).id,
          job_id: (b as any).job_id,
          kind: parsed.data.kind,
          requested_changes: parsed.data.requested_changes ?? {},
        } as any);
        if (error) return Response.json({ error: error.message }, { status: 500 });

        await admin.from("portal_bookings" as any)
          .update({ status: "change_requested" } as any).eq("id", (b as any).id);
        return Response.json({ ok: true });
      },
    },
  },
});
