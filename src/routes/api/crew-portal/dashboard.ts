import { createFileRoute } from "@tanstack/react-router";
import { getAdmin, requireCrewSession, mintFreshCrewSession } from "@/lib/crew-token.server";

/**
 * GET /api/crew-portal/dashboard — requires a valid crew session (Bearer JWT).
 * Returns the crew profile, itinerary legs, latest status per leg, and a
 * refreshed session token (sliding 1-hour inactivity expiry).
 */
export const Route = createFileRoute("/api/crew-portal/dashboard")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const session = requireCrewSession(request);
        if (!session) return Response.json({ error: "unauthorized" }, { status: 401 });

        const admin = await getAdmin();
        const { data: crew, error: crewErr } = await admin
          .from("crew_members" as any)
          .select("id, name, surname, phone, email, nationality, ship_name, preferred_language, link_token, deleted_at")
          .eq("id", session.crewId)
          .maybeSingle();
        if (crewErr) return Response.json({ error: crewErr.message }, { status: 500 });
        if (!crew || (crew as any).deleted_at || (crew as any).link_token !== session.linkToken) {
          return Response.json({ error: "not_found" }, { status: 404 });
        }

        const { data: legs, error: legsErr } = await admin
          .from("crew_itineraries" as any)
          .select("*")
          .eq("crew_member_id", session.crewId)
          .order("leg_number", { ascending: true });
        if (legsErr) return Response.json({ error: legsErr.message }, { status: 500 });

        const { data: statusRows, error: statusErr } = await admin
          .from("crew_status_log" as any)
          .select("*")
          .eq("crew_member_id", session.crewId)
          .order("created_at", { ascending: false })
          .limit(50);
        if (statusErr) return Response.json({ error: statusErr.message }, { status: 500 });

        // Latest status per leg_number (null leg_number = overall trip status), most recent first already.
        const latestByLeg: Record<string, any> = {};
        for (const row of (statusRows ?? []) as any[]) {
          const key = String(row.leg_number ?? "overall");
          if (!latestByLeg[key]) latestByLeg[key] = row;
        }

        const refreshed = mintFreshCrewSession(session.crewId, session.linkToken);
        return Response.json({
          crew,
          legs: legs ?? [],
          latest_status_by_leg: latestByLeg,
          history: statusRows ?? [],
          // Crew driver assignment lands in a later phase; always null for now.
          driver: null,
          session_token: refreshed.jwt,
          expires_in: refreshed.expires_in,
        });
      },
    },
  },
});
