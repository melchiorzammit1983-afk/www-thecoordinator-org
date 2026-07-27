import { createFileRoute } from "@tanstack/react-router";
import { resolvePortalByToken, checkRateLimit, getAdmin } from "@/lib/portal-token.server";

/**
 * DELETE /api/public/portal/$token/crew/$crewId — soft-delete a crew member
 * (keeps the row + itinerary history for audit; scoped to this portal only).
 */
export const Route = createFileRoute("/api/public/portal/$token/crew/$crewId")({
  server: {
    handlers: {
      DELETE: async ({ params }) => {
        const r = await resolvePortalByToken(params.token);
        if (!r.ok) return Response.json({ error: r.error }, { status: r.status });
        if (!(await checkRateLimit(params.token, 30))) return Response.json({ error: "rate_limited" }, { status: 429 });

        const admin = await getAdmin();
        const { data: existing } = await admin
          .from("crew_members" as any)
          .select("id")
          .eq("id", params.crewId)
          .eq("portal_company_id", r.portal.id)
          .is("deleted_at", null)
          .maybeSingle();
        if (!existing) return Response.json({ error: "not_found" }, { status: 404 });

        const { error } = await admin
          .from("crew_members" as any)
          .update({ deleted_at: new Date().toISOString() } as any)
          .eq("id", params.crewId);
        if (error) return Response.json({ error: error.message }, { status: 500 });
        return Response.json({ ok: true });
      },
    },
  },
});
