import { createFileRoute } from "@tanstack/react-router";
import { resolvePortalByToken, checkRateLimit, getAdmin } from "@/lib/portal-token.server";
import { crewRowToLegs } from "@/lib/parse-crew";
import { autoCreateOrGroupCrewTrip, detachCrewFromAutoTrips, pickMaltaLeg } from "@/lib/crew-trip-auto-create";
import { CrewInput } from "./index";

/**
 * DELETE /api/public/portal/$token/crew/$crewId — soft-delete a crew member
 * (keeps the row + itinerary history for audit; scoped to this portal only).
 *
 * PATCH /api/public/portal/$token/crew/$crewId — edit a crew member's profile
 * and/or itinerary. Itinerary legs are replaced wholesale, and any auto-created
 * trip this crew member was grouped into is detached and re-evaluated against
 * the new itinerary (so a changed flight moves them to the right trip, or
 * creates a new one, rather than leaving stale trip membership behind).
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

        try {
          await detachCrewFromAutoTrips(admin, params.crewId);
        } catch (e) {
          console.error("detachCrewFromAutoTrips failed on delete", e);
        }

        const { error } = await admin
          .from("crew_members" as any)
          .update({ deleted_at: new Date().toISOString() } as any)
          .eq("id", params.crewId);
        if (error) return Response.json({ error: error.message }, { status: 500 });
        return Response.json({ ok: true });
      },

      PATCH: async ({ params, request }) => {
        const r = await resolvePortalByToken(params.token);
        if (!r.ok) return Response.json({ error: r.error }, { status: r.status });
        if (!(await checkRateLimit(params.token, 30))) return Response.json({ error: "rate_limited" }, { status: 429 });

        const body = await request.json().catch(() => ({}));
        // Email is the crew member's identity for login — not editable here.
        const parsed = CrewInput.omit({ email: true }).safeParse(body);
        if (!parsed.success) return Response.json({ error: "bad_input" }, { status: 400 });
        const row = parsed.data;

        const admin = await getAdmin();
        const { data: existing } = await admin
          .from("crew_members" as any)
          .select("id, name, surname, email")
          .eq("id", params.crewId)
          .eq("portal_company_id", r.portal.id)
          .is("deleted_at", null)
          .maybeSingle();
        if (!existing) return Response.json({ error: "not_found" }, { status: 404 });

        try {
          await detachCrewFromAutoTrips(admin, params.crewId);
        } catch (e) {
          console.error("detachCrewFromAutoTrips failed on edit", e);
        }

        const { error: uErr } = await admin
          .from("crew_members" as any)
          .update({
            name: row.name,
            surname: row.surname,
            phone: row.phone || null,
            nationality: row.nationality || null,
            ship_name: row.ship || null,
          } as any)
          .eq("id", params.crewId);
        if (uErr) return Response.json({ error: uErr.message }, { status: 500 });

        await admin.from("crew_itineraries" as any).delete().eq("crew_member_id", params.crewId);

        const legs = crewRowToLegs({
          date: row.date ?? "",
          from: row.from ?? "",
          to: row.to ?? "",
          flight1: row.flight1 ?? "",
          flight2: row.flight2 ?? "",
          flight3: row.flight3 ?? "",
          flight_from1: row.flight_from1 ?? "",
          flight_from2: row.flight_from2 ?? "",
          flight_from3: row.flight_from3 ?? "",
          arrival_date: row.arrival_date ?? "",
          arrival_time: row.arrival_time ?? "",
        }).filter((l) => l.from_location || l.to_location || l.flight_number);
        let maltaLeg: any = null;
        if (legs.length) {
          const { data: insertedLegs } = await admin
            .from("crew_itineraries" as any)
            .insert(legs.map((l) => ({ ...l, crew_member_id: params.crewId })) as any)
            .select("*");
          maltaLeg = pickMaltaLeg((insertedLegs ?? []) as any[]);
        }

        if (maltaLeg) {
          try {
            await autoCreateOrGroupCrewTrip(admin, {
              portalCompanyId: r.portal.id,
              crewMemberId: params.crewId,
              crewFullName: `${row.name} ${row.surname}`.trim(),
              leg: maltaLeg,
            });
          } catch (e) {
            console.error("auto-create crew trip failed on edit", e);
          }
        }

        return Response.json({ ok: true });
      },
    },
  },
});
