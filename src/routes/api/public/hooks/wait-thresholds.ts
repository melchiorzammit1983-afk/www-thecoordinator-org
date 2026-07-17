import { createFileRoute } from "@tanstack/react-router";

const THRESHOLDS = [15, 60] as const;

/**
 * Wait-threshold notification sweep — called by pg_cron on a schedule.
 *
 * Auth: requires the server-only `CRON_SECRET` env var in either the
 * `x-cron-secret` header or an `Authorization: Bearer <CRON_SECRET>` header.
 * Previously this endpoint was completely unauthenticated, letting anyone
 * spam trip_messages with "driver waiting" system notes.
 */
export const Route = createFileRoute("/api/public/hooks/wait-thresholds")({
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
        const { data: open, error } = await supabaseAdmin
          .from("job_wait_sessions" as any)
          .select("id, job_id, driver_id, started_at, notified_thresholds")
          .is("ended_at", null);
        if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });

        const now = Date.now();
        let sent = 0;

        for (const row of ((open ?? []) as any[])) {
          const startedMs = new Date(row.started_at).getTime();
          const elapsedMin = Math.floor((now - startedMs) / 60000);
          const already: number[] = row.notified_thresholds ?? [];
          const due = THRESHOLDS.filter((t) => elapsedMin >= t && !already.includes(t));
          if (due.length === 0) continue;

          const { data: job } = await supabaseAdmin.from("jobs")
            .select("id, company_id, from_location, drivers(name)")
            .eq("id", row.job_id).maybeSingle();
          if (!job) continue;

          for (const t of due) {
            const label = (job as any).drivers?.name ?? "Driver";
            const at = (job as any).from_location ?? "the pickup";
            const body = `⏱ ${label} has been waiting ${t} minutes at ${at}.`;
            await supabaseAdmin.from("trip_messages" as any).insert({
              job_id: (job as any).id,
              company_id: (job as any).company_id,
              sender_kind: "coordinator",
              sender_label: "System",
              body,
              thread_kind: "group",
              thread: "chain",
            } as never);
            sent += 1;
          }

          await supabaseAdmin.from("job_wait_sessions" as any)
            .update({ notified_thresholds: Array.from(new Set([...already, ...due])) } as never)
            .eq("id", row.id);
        }

        return Response.json({ ok: true, checked: (open ?? []).length, sent });
      },
    },
  },
});
