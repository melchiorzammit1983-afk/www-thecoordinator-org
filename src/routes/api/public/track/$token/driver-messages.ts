import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { getAdmin, checkRateLimit, verifyPaxJwt } from "@/lib/portal-token.server";

/**
 * Passenger ↔ driver chat for portal-sourced bookings.
 *
 * Deliberately writes into the SAME `trip_messages` table (thread_kind
 * "driver_client", scoped by job_id + pax_id) that the driver's own app
 * already reads via listTripMessages/postTripMessage
 * (coordinator-public.functions.ts) for direct job-link clients — so the
 * driver sees and can reply to these with no driver-app changes needed.
 */

async function resolveToken(token: string, request: Request) {
  const auth = request.headers.get("authorization") ?? "";
  const jwt = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  const v = verifyPaxJwt(jwt);
  if (!v || v.token !== token) return null;
  const admin = await getAdmin();
  const { data: tok } = await admin.from("pax_tracking_tokens" as any)
    .select("job_id, pax_id").eq("token", token).maybeSingle();
  if (!tok || !(tok as any).job_id) return null;
  return { admin, jobId: (tok as any).job_id as string, paxId: (tok as any).pax_id as string | null };
}

export const Route = createFileRoute("/api/public/track/$token/driver-messages")({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        const resolved = await resolveToken(params.token, request);
        if (!resolved) return Response.json({ error: "unauthorized" }, { status: 401 });
        const { admin, jobId, paxId } = resolved;

        let q = admin.from("trip_messages")
          .select("sender_kind, sender_label, body, created_at")
          .eq("job_id", jobId).eq("thread_kind", "driver_client")
          .order("created_at", { ascending: true });
        if (paxId) q = q.eq("pax_id", paxId);
        const { data: msgs } = await q;
        return Response.json({ messages: msgs ?? [] });
      },
      POST: async ({ params, request }) => {
        const resolved = await resolveToken(params.token, request);
        if (!resolved) return Response.json({ error: "unauthorized" }, { status: 401 });
        if (!(await checkRateLimit(params.token, 30))) return Response.json({ error: "rate_limited" }, { status: 429 });
        const { admin, jobId, paxId } = resolved;

        const body = await request.json().catch(() => ({}));
        const parsed = z.object({ body: z.string().min(1).max(2000) }).safeParse(body);
        if (!parsed.success) return Response.json({ error: "bad_input" }, { status: 400 });

        const { data: job } = await admin.from("jobs").select("company_id, driver_id").eq("id", jobId).maybeSingle();
        if (!(job as any)?.driver_id) return Response.json({ error: "no_driver_assigned" }, { status: 409 });

        await admin.from("trip_messages").insert({
          job_id: jobId,
          company_id: (job as any).company_id,
          sender_kind: "client",
          sender_label: "Passenger",
          thread_kind: "driver_client",
          pax_id: paxId,
          driver_id: (job as any).driver_id,
          body: parsed.data.body,
        } as any);
        return Response.json({ ok: true });
      },
    },
  },
});
