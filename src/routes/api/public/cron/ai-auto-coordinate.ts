import { createFileRoute } from "@tanstack/react-router";

/**
 * Daily AI Auto-Coordinate pass across all companies that opted in.
 *
 * Auth: requires the server-only `CRON_SECRET` env var in one of:
 *   - `x-cron-secret` header
 *   - `Authorization: Bearer <CRON_SECRET>` header
 *
 * The Supabase publishable/anon key is NOT a secret (it ships in every
 * browser bundle) and must never be used to gate write-heavy or
 * cost-incurring endpoints.
 */
export const Route = createFileRoute("/api/public/cron/ai-auto-coordinate")({
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
        const { data: rows, error } = await supabaseAdmin
          .from("ai_configuration")
          .select("company_id")
          .eq("auto_coordinate_enabled", true);
        if (error) return new Response(error.message, { status: 500 });

        const results: Array<{ company_id: string; ok: boolean; note?: string }> = [];
        for (const r of rows ?? []) {
          try {
            const mod = await import("@/lib/coordinator.functions");
            const plan = await mod.runAutoCoordinate((r as any).company_id);
            results.push({ company_id: (r as any).company_id, ok: true, note: `${plan.proposals.length} proposals` });
          } catch (e) {
            results.push({ company_id: (r as any).company_id, ok: false, note: (e as Error).message });
          }
        }
        return Response.json({ ok: true, processed: results.length, results });
      },
    },
  },
});
