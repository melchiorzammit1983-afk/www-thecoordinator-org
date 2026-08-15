import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { resolvePortalByToken, getAdmin, checkRateLimit } from "@/lib/portal-token.server";

const QuerySchema = z.object({
  period_start: z.string().datetime(),
  period_end: z.string().datetime(),
});

/**
 * GET /api/public/portal/$token/statement?period_start=...&period_end=...
 *
 * Self-service statement for the company/hotel/agent itself — same totals
 * shape as the coordinator-side generatePortalStatement (portal.functions.ts),
 * just token-scoped instead of auth-scoped. Also inserts a portal_statements
 * row for the coordinator's records, same as the coordinator-triggered path.
 */
export const Route = createFileRoute("/api/public/portal/$token/statement")({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        const r = await resolvePortalByToken(params.token, request);
        if (!r.ok) return Response.json({ error: r.error }, { status: r.status });
        if (!(await checkRateLimit(params.token, 20))) return Response.json({ error: "rate_limited" }, { status: 429 });

        const url = new URL(request.url);
        const parsed = QuerySchema.safeParse({
          period_start: url.searchParams.get("period_start"),
          period_end: url.searchParams.get("period_end"),
        });
        if (!parsed.success) return Response.json({ error: "bad_input" }, { status: 400 });

        const admin = await getAdmin();
        const { data: bookings } = await admin.from("portal_bookings" as any)
          .select("id, status, agreed_price, currency, created_at, accepted_at, payload")
          .eq("portal_company_id", r.portal.id)
          .gte("created_at", parsed.data.period_start)
          .lte("created_at", parsed.data.period_end);
        const rows = (bookings ?? []) as any[];
        const totals = {
          bookings_count: rows.length,
          accepted: rows.filter((row) => row.status === "accepted").length,
          cancelled: rows.filter((row) => row.status === "cancelled").length,
          revenue: rows.filter((row) => row.status === "accepted").reduce((s, row) => s + Number(row.agreed_price ?? 0), 0),
        };

        const { data: stmt, error } = await admin.from("portal_statements" as any).insert({
          portal_company_id: r.portal.id,
          period_start: parsed.data.period_start,
          period_end: parsed.data.period_end,
          totals,
        } as any).select("*").single();
        if (error) return Response.json({ error: error.message }, { status: 500 });

        await admin.from("portal_link_events" as any).insert({
          portal_company_id: r.portal.id, actor_kind: "hotel", event: "statement_generated",
          detail: { period_start: parsed.data.period_start, period_end: parsed.data.period_end } as any,
        } as any);

        return Response.json({ statement: stmt, rows });
      },
    },
  },
});
