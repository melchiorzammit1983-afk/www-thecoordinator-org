import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { resolvePortalByToken, checkRateLimit, getAdmin } from "@/lib/portal-token.server";

/**
 * GET /api/public/portal/$token  — returns the hotel dashboard bootstrap
 * (portal profile + bookings + recent activity), scoped to this token only.
 */
export const Route = createFileRoute("/api/public/portal/$token/")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const r = await resolvePortalByToken(params.token);
        if (!r.ok) return Response.json({ error: r.error }, { status: r.status });
        const admin = await getAdmin();
        const { data: bookings } = await admin
          .from("portal_bookings" as any)
          .select("id, status, payload, agreed_price, currency, created_at, accepted_at, job_id")
          .eq("portal_company_id", r.portal.id)
          .order("created_at", { ascending: false })
          .limit(200);

        // for accepted bookings, join minimal job status
        const jobIds = (bookings ?? []).map((b: any) => b.job_id).filter(Boolean);
        let jobs: any[] = [];
        if (jobIds.length) {
          const { data } = await admin.from("jobs")
            .select("id, status, pickup_at, driver_id, drivers(name, car_make_model, plate)")
            .in("id", jobIds);
          jobs = data ?? [];
        }

        return Response.json({
          portal: {
            id: r.portal.id,
            name: r.portal.name,
            kind: r.portal.kind,
            logo_url: r.portal.logo_url,
            brand_color: r.portal.brand_color,
            display_name_for_passenger: r.portal.display_name_for_passenger ?? r.portal.name,
            link_expires_at: r.portal.link_expires_at,
          },
          bookings: bookings ?? [],
          jobs,
        });
      },
      POST: async ({ params, request }) => {
        // Toggle link off from hotel side (they can turn their own link off)
        const r = await resolvePortalByToken(params.token);
        if (!r.ok) return Response.json({ error: r.error }, { status: r.status });
        if (!(await checkRateLimit(params.token))) return Response.json({ error: "rate_limited" }, { status: 429 });
        const body = await request.json().catch(() => ({}));
        const parsed = z.object({
          action: z.enum(["disable_link", "set_expiry"]),
          expires_at: z.string().datetime().nullable().optional(),
        }).safeParse(body);
        if (!parsed.success) return Response.json({ error: "bad_input" }, { status: 400 });
        const admin = await getAdmin();
        const patch = parsed.data.action === "disable_link"
          ? { link_enabled: false }
          : { link_expires_at: parsed.data.expires_at ?? null };
        await admin.from("portal_companies" as any).update(patch as any).eq("id", r.portal.id);
        await admin.from("portal_link_events" as any).insert({
          portal_company_id: r.portal.id, actor_kind: "hotel", event: parsed.data.action, detail: patch as any,
        } as any);
        return Response.json({ ok: true });
      },
    },
  },
});
