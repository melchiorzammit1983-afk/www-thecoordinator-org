import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertAdmin } from "@/lib/admin.functions";

/**
 * Admin-only read model for the Flight Schedule foundation. Import parsing,
 * activation, and provider integrations intentionally arrive in later phases.
 */
export const getFlightScheduleOverview = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const sb = await assertAdmin(context);
    const [{ data: active, error: activeError }, { data: imports, error: importsError }] =
      await Promise.all([
        sb
          .from("flight_schedule_versions")
          .select("id, name, status, effective_from, coverage_start, coverage_end, created_at")
          .eq("status", "active")
          .maybeSingle(),
        sb
          .from("flight_schedule_imports")
          .select("id, source_filename, status, created_at, schedule_version_id")
          .order("created_at", { ascending: false })
          .limit(10),
      ]);
    if (activeError) throw new Error(activeError.message);
    if (importsError) throw new Error(importsError.message);
    return { active, imports: imports ?? [] };
  });
