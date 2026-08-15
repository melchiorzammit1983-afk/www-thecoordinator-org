import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { resolvePortalByToken, checkRateLimit, getAdmin } from "@/lib/portal-token.server";
import { crewRowToLegs } from "@/lib/parse-crew";
import { autoCreateOrGroupCrewTrip, pickMaltaLeg } from "@/lib/crew-trip-auto-create";

export const CrewInput = z.object({
  name: z.string().trim().min(1).max(80),
  surname: z.string().trim().min(1).max(80),
  phone: z.string().trim().max(40).optional().or(z.literal("")),
  email: z.string().trim().email().max(255),
  nationality: z.string().trim().max(80).optional().or(z.literal("")),
  ship: z.string().trim().max(120).optional().or(z.literal("")),
  date: z.string().trim().max(20).optional().or(z.literal("")),
  from: z.string().trim().max(200).optional().or(z.literal("")),
  to: z.string().trim().max(200).optional().or(z.literal("")),
  flight1: z.string().trim().max(20).optional().or(z.literal("")),
  flight2: z.string().trim().max(20).optional().or(z.literal("")),
  flight3: z.string().trim().max(20).optional().or(z.literal("")),
  flight_from1: z.string().trim().max(200).optional().or(z.literal("")),
  flight_from2: z.string().trim().max(200).optional().or(z.literal("")),
  flight_from3: z.string().trim().max(200).optional().or(z.literal("")),
  arrival_date: z.string().trim().max(20).optional().or(z.literal("")),
  arrival_time: z.string().trim().max(10).optional().or(z.literal("")),
});

/**
 * GET  /api/public/portal/$token/crew — list this portal's crew (active only)
 * POST /api/public/portal/$token/crew — bulk-save crew rows (partial success:
 *   each input row is validated/saved independently so one bad row doesn't
 *   block the rest).
 */
export const Route = createFileRoute("/api/public/portal/$token/crew/")({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        const r = await resolvePortalByToken(params.token, request);
        if (!r.ok) return Response.json({ error: r.error }, { status: r.status });
        const admin = await getAdmin();
        const { data: crew, error } = await admin
          .from("crew_members" as any)
          .select("*")
          .eq("portal_company_id", r.portal.id)
          .is("deleted_at", null)
          .order("created_at", { ascending: false });
        if (error) return Response.json({ error: error.message }, { status: 500 });

        const ids = (crew ?? []).map((c: any) => c.id);
        const legsByCrew: Record<string, any[]> = {};
        if (ids.length) {
          const { data: legs } = await admin
            .from("crew_itineraries" as any)
            .select("*")
            .in("crew_member_id", ids)
            .order("leg_number", { ascending: true });
          for (const leg of (legs ?? []) as any[]) {
            (legsByCrew[leg.crew_member_id] ??= []).push(leg);
          }
        }
        return Response.json({
          crew: (crew ?? []).map((c: any) => ({ ...c, legs: legsByCrew[c.id] ?? [] })),
        });
      },

      POST: async ({ params, request }) => {
        const r = await resolvePortalByToken(params.token, request);
        if (!r.ok) return Response.json({ error: r.error }, { status: r.status });
        if (!(await checkRateLimit(params.token, 30))) return Response.json({ error: "rate_limited" }, { status: 429 });

        const body = await request.json().catch(() => ({}));
        const parsed = z.object({ rows: z.array(CrewInput).min(1).max(300) }).safeParse(body);
        if (!parsed.success) return Response.json({ error: "bad_input" }, { status: 400 });

        const admin = await getAdmin();

        // Reject in-payload duplicate emails up front (case-insensitive).
        const seen = new Map<string, number>();
        const results: { index: number; ok: boolean; error?: string; crew?: any }[] = [];
        const toInsert: { index: number; row: z.infer<typeof CrewInput> }[] = [];
        parsed.data.rows.forEach((row, index) => {
          const key = row.email.toLowerCase();
          if (seen.has(key)) {
            results[index] = { index, ok: false, error: `Duplicate email in this batch: ${row.email}` };
            return;
          }
          seen.set(key, index);
          toInsert.push({ index, row });
        });

        if (toInsert.length) {
          // Fetch all active emails for this portal and compare case-insensitively in JS —
          // Postgres `.in()` is case-sensitive, but the DB's uniqueness check is on lower(email).
          const { data: existing } = await admin
            .from("crew_members" as any)
            .select("email")
            .eq("portal_company_id", r.portal.id)
            .is("deleted_at", null);
          const existingEmails = new Set(((existing ?? []) as any[]).map((e) => String(e.email).toLowerCase()));

          for (const { index, row } of toInsert) {
            if (existingEmails.has(row.email.toLowerCase())) {
              results[index] = { index, ok: false, error: `Email already exists for this company: ${row.email}` };
              continue;
            }
            const { data: crewRow, error: cErr } = await admin
              .from("crew_members" as any)
              .insert({
                portal_company_id: r.portal.id,
                name: row.name,
                surname: row.surname,
                phone: row.phone || null,
                email: row.email,
                nationality: row.nationality || null,
                ship_name: row.ship || null,
              } as any)
              .select("*")
              .single();
            if (cErr || !crewRow) {
              results[index] = { index, ok: false, error: cErr?.message ?? "insert_failed" };
              continue;
            }

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
            if (legs.length) {
              const { data: insertedLegs } = await admin
                .from("crew_itineraries" as any)
                .insert(legs.map((l) => ({ ...l, crew_member_id: (crewRow as any).id })) as any)
                .select("*");

              // Best-effort: a leg landing in Malta with a known arrival date/time
              // auto-creates (or joins) a trip for the coordinator to review.
              const maltaLeg = pickMaltaLeg((insertedLegs ?? []) as any[]);
              if (maltaLeg) {
                try {
                  await autoCreateOrGroupCrewTrip(admin, {
                    portalCompanyId: r.portal.id,
                    crewMemberId: (crewRow as any).id,
                    crewFullName: `${row.name} ${row.surname}`.trim(),
                    leg: maltaLeg,
                  });
                } catch (e) {
                  console.error("auto-create crew trip failed", e);
                }
              }
            }
            results[index] = { index, ok: true, crew: crewRow };
          }
        }

        return Response.json({
          saved: results.filter((r) => r?.ok).length,
          failed: results.filter((r) => r && !r.ok).length,
          results,
        });
      },
    },
  },
});
