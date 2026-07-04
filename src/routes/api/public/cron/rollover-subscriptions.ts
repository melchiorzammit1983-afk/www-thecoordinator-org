import { createFileRoute } from "@tanstack/react-router";

// Called by pg_cron to roll over monthly subscriptions and per-feature usage counters.
// Uses Supabase publishable/anon key in the `apikey` header (public /api/public/*).
export const Route = createFileRoute("/api/public/cron/rollover-subscriptions")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const apiKey = request.headers.get("apikey") ?? "";
        const expected = process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_ANON_KEY ?? "";
        if (!expected || apiKey !== expected) {
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
