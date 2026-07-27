import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { getAdmin, requireCrewSession, mintFreshCrewSession, checkRateLimit } from "@/lib/crew-token.server";
import { CREW_STATUS_ACTIONS, type CrewStatus } from "@/lib/crew-status";

/**
 * POST /api/crew-portal/status — crew taps a status update for a leg (or the
 * overall trip, leg_number omitted). Requires a valid crew session.
 */
export const Route = createFileRoute("/api/crew-portal/status")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const session = requireCrewSession(request);
        if (!session) return Response.json({ error: "unauthorized" }, { status: 401 });
        if (!(await checkRateLimit(`crew-status:${session.crewId}`, 30))) {
          return Response.json({ error: "rate_limited" }, { status: 429 });
        }

        const body = await request.json().catch(() => ({}));
        const parsed = z.object({
          leg_number: z.number().int().min(1).max(3).nullable().optional(),
          status: z.enum(CREW_STATUS_ACTIONS as [CrewStatus, ...CrewStatus[]]),
        }).safeParse(body);
        if (!parsed.success) return Response.json({ error: "bad_input" }, { status: 400 });

        const admin = await getAdmin();
        const { data: crew } = await admin
          .from("crew_members" as any)
          .select("id, link_token, deleted_at")
          .eq("id", session.crewId)
          .maybeSingle();
        if (!crew || (crew as any).deleted_at || (crew as any).link_token !== session.linkToken) {
          return Response.json({ error: "not_found" }, { status: 404 });
        }

        const { data: row, error } = await admin
          .from("crew_status_log" as any)
          .insert({
            crew_member_id: session.crewId,
            leg_number: parsed.data.leg_number ?? null,
            status: parsed.data.status,
            updated_by: "crew",
          } as any)
          .select("*")
          .single();
        if (error) return Response.json({ error: error.message }, { status: 500 });

        const refreshed = mintFreshCrewSession(session.crewId, session.linkToken);
        return Response.json({
          ok: true,
          status: row,
          session_token: refreshed.jwt,
          expires_in: refreshed.expires_in,
        });
      },
    },
  },
});
