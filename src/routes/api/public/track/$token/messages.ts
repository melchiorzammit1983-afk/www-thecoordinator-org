import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { getAdmin, checkRateLimit, verifyPaxJwt } from "@/lib/portal-token.server";

function verifyBearer(request: Request, token: string) {
  const auth = request.headers.get("authorization") ?? "";
  const jwt = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  const v = verifyPaxJwt(jwt);
  if (!v || v.token !== token) return null;
  return v;
}

/**
 * Passenger ↔ hotel chat only. Passenger never sees coordinator messages.
 * Uses the pax_tracking token in the URL + a short-lived JWT (post-verify) in Authorization.
 */
export const Route = createFileRoute("/api/public/track/$token/messages")({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        const v = verifyBearer(request, params.token);
        if (!v) return Response.json({ error: "unauthorized" }, { status: 401 });
        const admin = await getAdmin();
        const { data: tok } = await admin.from("pax_tracking_tokens" as any)
          .select("job_id, portal_booking_id").eq("token", params.token).maybeSingle();
        if (!tok) return Response.json({ error: "not_found" }, { status: 404 });
        const { data: t } = await admin.from("portal_threads" as any).select("id")
          .eq("portal_booking_id", (tok as any).portal_booking_id).eq("scope", "hotel_pax").maybeSingle();
        if (!t) return Response.json({ messages: [] });
        const { data: msgs } = await admin.from("portal_messages" as any)
          .select("sender_role, sender_label, body, created_at")
          .eq("thread_id", (t as any).id).order("created_at", { ascending: true });
        // Passenger sees hotel + own messages only (never coordinator label)
        const filtered = (msgs ?? []).filter((m: any) => m.sender_role !== "coordinator");
        return Response.json({ messages: filtered });
      },
      POST: async ({ params, request }) => {
        const v = verifyBearer(request, params.token);
        if (!v) return Response.json({ error: "unauthorized" }, { status: 401 });
        if (!(await checkRateLimit(params.token, 30)))
          return Response.json({ error: "rate_limited" }, { status: 429 });
        const body = await request.json().catch(() => ({}));
        const parsed = z.object({ body: z.string().min(1).max(2000) }).safeParse(body);
        if (!parsed.success) return Response.json({ error: "bad_input" }, { status: 400 });

        const admin = await getAdmin();
        const { data: tok } = await admin.from("pax_tracking_tokens" as any)
          .select("job_id, portal_booking_id").eq("token", params.token).maybeSingle();
        if (!tok) return Response.json({ error: "not_found" }, { status: 404 });

        const { data: b } = await admin.from("portal_bookings" as any)
          .select("id, portal_company_id").eq("id", (tok as any).portal_booking_id).maybeSingle();
        if (!b) return Response.json({ error: "not_found" }, { status: 404 });

        let { data: t } = await admin.from("portal_threads" as any).select("id")
          .eq("portal_booking_id", (b as any).id).eq("scope", "hotel_pax").maybeSingle();
        if (!t) {
          const { data: nt } = await admin.from("portal_threads" as any).insert({
            portal_booking_id: (b as any).id,
            portal_company_id: (b as any).portal_company_id,
            job_id: (tok as any).job_id,
            scope: "hotel_pax",
          } as any).select("id").single();
          t = nt;
        }
        await admin.from("portal_messages" as any).insert({
          thread_id: (t as any).id,
          sender_role: "passenger",
          sender_label: "Guest",
          body: parsed.data.body,
        } as any);
        return Response.json({ ok: true });
      },
    },
  },
});
