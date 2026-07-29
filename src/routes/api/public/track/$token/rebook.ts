import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { getAdmin, checkRateLimit, verifyPaxJwt } from "@/lib/portal-token.server";

/**
 * "Book another trip" from the passenger tracker. Creates a new pending
 * portal_bookings row under the same portal company as the original
 * booking — goes through the exact same coordinator-approval queue as any
 * other portal booking, never a job directly (unlike the older direct
 * job-link "follow-up" flow, which was never review-gated).
 */
const RebookInput = z.object({
  from_location: z.string().trim().min(1).max(200),
  to_location: z.string().trim().min(1).max(200),
  pickup_at: z.string().datetime().nullable().optional(),
  pax_count: z.number().int().min(1).max(200).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
});

export const Route = createFileRoute("/api/public/track/$token/rebook")({
  server: {
    handlers: {
      POST: async ({ params, request }) => {
        const auth = request.headers.get("authorization") ?? "";
        const jwt = auth.startsWith("Bearer ") ? auth.slice(7) : "";
        const v = verifyPaxJwt(jwt);
        if (!v || v.token !== params.token) return Response.json({ error: "unauthorized" }, { status: 401 });
        if (!(await checkRateLimit(params.token, 20))) return Response.json({ error: "rate_limited" }, { status: 429 });

        const body = await request.json().catch(() => ({}));
        const parsed = RebookInput.safeParse(body);
        if (!parsed.success) return Response.json({ error: "bad_input" }, { status: 400 });

        const admin = await getAdmin();
        const { data: tok } = await admin.from("pax_tracking_tokens" as any)
          .select("portal_booking_id, pax_id").eq("token", params.token).maybeSingle();
        if (!tok || !(tok as any).portal_booking_id) return Response.json({ error: "not_found" }, { status: 404 });

        const [{ data: original }, { data: pax }] = await Promise.all([
          admin.from("portal_bookings" as any).select("portal_company_id, payload").eq("id", (tok as any).portal_booking_id).maybeSingle(),
          (tok as any).pax_id
            ? admin.from("pax").select("name").eq("id", (tok as any).pax_id).maybeSingle()
            : Promise.resolve({ data: null }),
        ]);
        if (!original) return Response.json({ error: "not_found" }, { status: 404 });
        const originalPayload = (original as any).payload ?? {};

        const payload = {
          name: originalPayload.name ?? null,
          surname: originalPayload.surname ?? null,
          pax_names: (pax as any)?.name ? [(pax as any).name] : (originalPayload.pax_names ?? null),
          client_phone: originalPayload.client_phone ?? null,
          client_email: originalPayload.client_email ?? null,
          from_location: parsed.data.from_location,
          to_location: parsed.data.to_location,
          pickup_at: parsed.data.pickup_at ?? null,
          pax_count: parsed.data.pax_count ?? originalPayload.pax_count ?? 1,
          notes: parsed.data.notes ?? null,
        };

        const { error } = await admin.from("portal_bookings" as any).insert({
          portal_company_id: (original as any).portal_company_id,
          payload,
          currency: "EUR",
          status: "pending",
          created_by_name: (pax as any)?.name ?? null,
          batch_id: crypto.randomUUID(),
        } as any);
        if (error) return Response.json({ error: error.message }, { status: 500 });

        try {
          const { data: portal } = await admin.from("portal_companies" as any)
            .select("name, coordinator_company_id").eq("id", (original as any).portal_company_id).maybeSingle();
          const { data: company } = await admin.from("companies").select("owner_user_id")
            .eq("id", (portal as any)?.coordinator_company_id).maybeSingle();
          if ((company as any)?.owner_user_id) {
            const { sendPushToUserImpl } = await import("@/lib/push.functions");
            await sendPushToUserImpl((company as any).owner_user_id, {
              title: `New booking request — ${(portal as any)?.name ?? "Portal"}`,
              body: "A passenger requested another trip. Awaiting your approval",
              category: "new_job",
              url: "/coordinator/calendar",
            });
          }
        } catch (e) {
          console.error("[rebook] coordinator push failed", e);
        }

        return Response.json({ ok: true });
      },
    },
  },
});
