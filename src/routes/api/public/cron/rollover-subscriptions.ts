import { createFileRoute } from "@tanstack/react-router";

/**
 * Called by pg_cron to roll over monthly subscriptions and per-feature usage counters.
 *
 * Auth: requires the server-only `CRON_SECRET` env var in one of:
 *   - `x-cron-secret` header
 *   - `Authorization: Bearer <CRON_SECRET>` header
 */
export const Route = createFileRoute("/api/public/cron/rollover-subscriptions")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const expected = process.env.CRON_SECRET ?? "";
        if (!expected) return new Response("Cron secret not configured", { status: 500 });
        const header = request.headers.get("x-cron-secret")
          ?? (request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "");
        if (header !== expected) {
          return new Response("Unauthorized", { status: 401 });
        }
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data, error } = await supabaseAdmin.rpc("rollover_subscriptions");
        if (error) return new Response(error.message, { status: 500 });
        return Response.json({ ok: true, rolled: data });
      },
    },
  },
});
