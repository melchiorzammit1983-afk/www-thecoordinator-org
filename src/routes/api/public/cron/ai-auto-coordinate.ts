import { createFileRoute } from "@tanstack/react-router";

// Daily AI Auto-Coordinate pass across all companies that opted in.
// Called by pg_cron with the Supabase publishable/anon key in the `apikey` header.
export const Route = createFileRoute("/api/public/cron/ai-auto-coordinate")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const apiKey = request.headers.get("apikey") ?? "";
        const expected = process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_ANON_KEY ?? "";
        if (!expected || apiKey !== expected) {
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
            // Import the internal helper lazily to avoid pulling server-fn wrapper.
            const mod = await import("@/lib/coordinator.functions.server-helpers");
            const plan = await mod.runAutoCoordinateForCompany((r as any).company_id);
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
