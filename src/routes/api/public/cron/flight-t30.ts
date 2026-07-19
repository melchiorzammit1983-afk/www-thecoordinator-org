import { createFileRoute } from "@tanstack/react-router";

/**
 * T-30 flight-status sweep. Runs every 2 minutes.
 * For each active trip whose pickup is 25-35 min away, has a flight/vessel
 * code, hasn't already had this scheduled check, and hasn't had a very
 * recent lookup (>10 min ago), runs applyLiveStatusToJob once — free of
 * charge (bundled with the trip). Sets flight_t30_checked so it never
 * fires twice for the same trip.
 */
export const Route = createFileRoute("/api/public/cron/flight-t30")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const expected = process.env.CRON_SECRET ?? "";
        if (!expected) return new Response("Cron secret not configured", { status: 500 });
        const header =
          request.headers.get("x-cron-secret") ??
          (request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "");
        if (header !== expected) return new Response("Unauthorized", { status: 401 });

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { applyLiveStatusToJob } = await import("@/lib/coordinator.functions");

        const now = Date.now();
        const fromIso = new Date(now + 25 * 60_000).toISOString();
        const toIso = new Date(now + 35 * 60_000).toISOString();
        const freshCutoff = new Date(now - 10 * 60_000).toISOString();

        const { data: jobs, error } = await supabaseAdmin
          .from("jobs")
          .select(
            "id, company_id, driver_id, from_flight, to_flight, from_location, to_location, pickup_at, flight_status, flight_status_updated_at, tracking_kind, status",
          )
          .or("from_flight.not.is.null,to_flight.not.is.null")
          .eq("flight_t30_checked", false)
          .not("status", "in", "(completed,cancelled)")
          .gte("pickup_at", fromIso)
          .lte("pickup_at", toIso)
          .limit(50);
        if (error) return new Response(error.message, { status: 500 });

        let checked = 0;
        let skipped = 0;
        for (const j of jobs ?? []) {
          const last = (j as any).flight_status_updated_at as string | null;
          const isFresh = last && last > freshCutoff;
          try {
            if (!isFresh) {
              await applyLiveStatusToJob(supabaseAdmin, j as any);
              checked++;
            } else {
              skipped++;
            }
          } catch {
            /* ignore per-job failures */
          }
          // Mark regardless so we never re-fire for this trip.
          await supabaseAdmin
            .from("jobs")
            .update({ flight_t30_checked: true, flight_t30_checked_at: new Date().toISOString() })
            .eq("id", (j as any).id);
        }

        return Response.json({ ok: true, candidates: jobs?.length ?? 0, checked, skipped });
      },
    },
  },
});
