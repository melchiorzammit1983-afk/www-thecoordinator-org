import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { resolvePortalByToken, checkRateLimit, getAdmin } from "@/lib/portal-token.server";

/**
 * Chat between the hotel and either the coordinator or the passenger.
 * Hotel sees: hotel_coord + hotel_pax threads for their bookings.
 * Never returns messages from coord_pax threads (that's private to coord+pax).
 */
export const Route = createFileRoute("/api/public/portal/$token/messages")({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        const r = await resolvePortalByToken(params.token);
        if (!r.ok) return Response.json({ error: r.error }, { status: r.status });
        const url = new URL(request.url);
        const bookingId = url.searchParams.get("booking_id");
        const scope = url.searchParams.get("scope");
        if (!bookingId || !scope || !["hotel_coord", "hotel_pax"].includes(scope))
          return Response.json({ error: "bad_input" }, { status: 400 });

        const admin = await getAdmin();
        const { data: b } = await admin.from("portal_bookings" as any)
          .select("id, portal_company_id").eq("id", bookingId).maybeSingle();
        if (!b || (b as any).portal_company_id !== r.portal.id)
          return Response.json({ error: "not_found" }, { status: 404 });

        const { data: t } = await admin.from("portal_threads" as any)
          .select("id").eq("portal_booking_id", bookingId).eq("scope", scope).maybeSingle();
        if (!t) return Response.json({ messages: [] });
        const { data: msgs } = await admin.from("portal_messages" as any)
          .select("id, sender_role, sender_label, body, created_at")
          .eq("thread_id", (t as any).id)
          .order("created_at", { ascending: true });
        return Response.json({ messages: msgs ?? [], thread_id: (t as any).id });
      },
      POST: async ({ params, request }) => {
        const r = await resolvePortalByToken(params.token);
        if (!r.ok) return Response.json({ error: r.error }, { status: r.status });
        if (!(await checkRateLimit(params.token))) return Response.json({ error: "rate_limited" }, { status: 429 });
        const body = await request.json().catch(() => ({}));
        const parsed = z.object({
          booking_id: z.string().uuid(),
          scope: z.enum(["hotel_coord", "hotel_pax"]),
          body: z.string().min(1).max(4000),
        }).safeParse(body);
        if (!parsed.success) return Response.json({ error: "bad_input" }, { status: 400 });

        const admin = await getAdmin();
        const { data: b } = await admin.from("portal_bookings" as any)
          .select("id, job_id, portal_company_id").eq("id", parsed.data.booking_id).maybeSingle();
        if (!b || (b as any).portal_company_id !== r.portal.id)
          return Response.json({ error: "not_found" }, { status: 404 });

        let { data: t } = await admin.from("portal_threads" as any).select("id")
          .eq("portal_booking_id", parsed.data.booking_id).eq("scope", parsed.data.scope).maybeSingle();
        if (!t) {
          const { data: nt } = await admin.from("portal_threads" as any).insert({
            portal_booking_id: parsed.data.booking_id,
            portal_company_id: r.portal.id,
            job_id: (b as any).job_id,
            scope: parsed.data.scope,
          } as any).select("id").single();
          t = nt;
        }
        const label = parsed.data.scope === "hotel_pax"
          ? (r.portal.display_name_for_passenger ?? r.portal.name)
          : r.portal.name;
        const { error } = await admin.from("portal_messages" as any).insert({
          thread_id: (t as any).id,
          sender_role: "portal",
          sender_label: label,
          body: parsed.data.body,
        } as any);
        if (error) return Response.json({ error: error.message }, { status: 500 });
        return Response.json({ ok: true, thread_id: (t as any).id });
      },
    },
  },
});
