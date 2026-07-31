import { createFileRoute } from "@tanstack/react-router";

// Runs on a schedule (e.g. every 5-10 min via pg_cron / external scheduler).
// Finds trips whose pickup is coming up within the next ~35 minutes and
// whose flight/vessel status hasn't been checked recently, then checks them.
// Billing: uses the same spend-then-refund pattern as manual refresh — a
// company is only charged when the lookup actually returns a result.
export const Route = createFileRoute("/api/public/cron/flight-t30")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const expected = process.env.CRON_SECRET ?? "";
        if (!expected) return new Response("Cron secret not configured", { status: 500 });
        const header =
          request.headers.get("x-cron-secret") ??
          request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
          "";
        if (header !== expected) return new Response("Unauthorized", { status: 401 });

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { applyLiveStatusToJobBg } = await import("@/lib/coordinator.functions");

        const from = new Date(Date.now() + 20 * 60_000).toISOString();
        const to = new Date(Date.now() + 35 * 60_000).toISOString();
        const staleCutoff = new Date(Date.now() - 15 * 60_000).toISOString();

        const { data: jobs, error } = await supabaseAdmin
          .from("jobs")
          .select("id, flight_status_updated_at")
          .or("from_flight.not.is.null,to_flight.not.is.null")
          .not("status", "in", "(completed,cancelled)")
          .gte("pickup_at", from)
          .lte("pickup_at", to);
        if (error) return new Response(error.message, { status: 500 });

        const due = (jobs ?? []).filter((j: any) => {
          const last = j.flight_status_updated_at as string | null;
          return !last || last < staleCutoff;
        });

        for (const j of due) {
          await applyLiveStatusToJobBg((j as any).id);
        }

        return Response.json({ ok: true, checked: due.length });
      },
    },
  },
});
