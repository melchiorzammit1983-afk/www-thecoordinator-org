import { createFileRoute } from "@tanstack/react-router";

/**
 * Auto-forwarding sweeper: called by pg_cron every minute.
 * Uses the shared CRON_SECRET header pattern.
 */
export const Route = createFileRoute("/api/public/cron/auto-forward")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const expected = process.env.CRON_SECRET ?? "";
        if (!expected) return new Response("Cron secret not configured", { status: 500 });
        const header = request.headers.get("x-cron-secret")
          ?? (request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "");
        if (header !== expected) return new Response("Unauthorized", { status: 401 });
        const { sweepAutoForward } = await import("@/lib/availability.server");
        try {
          const result = await sweepAutoForward();
          return Response.json({ ok: true, ...result });
        } catch (e: any) {
          return new Response(e?.message ?? "sweep failed", { status: 500 });
        }
      },
    },
  },
});
