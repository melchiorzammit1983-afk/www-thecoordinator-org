import { createFileRoute } from "@tanstack/react-router";
import { getAdmin } from "@/lib/portal-token.server";

async function resolvePublicPortal(token: string) {
  if (!token || token.length < 20 || token.length > 128) {
    return { ok: false as const, status: 400, error: "invalid_token" };
  }
  const admin = await getAdmin();
  const { data, error } = await admin
    .from("public_booking_portals" as any)
    .select("id, coordinator_company_id, name, enabled, expires_at, token")
    .eq("token", token)
    .maybeSingle();
  if (error) return { ok: false as const, status: 500, error: "db_error" };
  if (!data) return { ok: false as const, status: 404, error: "not_found" };
  if (!(data as any).enabled) return { ok: false as const, status: 403, error: "link_disabled" };
  if ((data as any).expires_at && new Date((data as any).expires_at).getTime() < Date.now()) {
    return { ok: false as const, status: 403, error: "link_expired" };
  }
  return { ok: true as const, portal: data as any };
}

export const Route = createFileRoute("/api/public/b/$token/")({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        const r = await resolvePublicPortal(params.token);
        if (!r.ok) return Response.json({ error: r.error }, { status: r.status });
        const url = new URL(request.url);
        const visitorId = url.searchParams.get("visitor_id") ?? "";
        const admin = await getAdmin();
        let requests: any[] = [];
        let messages: any[] = [];
        let jobs: any[] = [];
        if (visitorId && visitorId.length <= 80) {
          const { data: reqs } = await admin
            .from("public_booking_requests" as any)
            .select("id, status, payload, created_at, decided_at, decided_reason, job_id")
            .eq("portal_id", r.portal.id)
            .eq("visitor_id", visitorId)
            .order("created_at", { ascending: false })
            .limit(50);
          requests = reqs ?? [];
          const { data: msgs } = await admin
            .from("public_booking_messages" as any)
            .select("id, body, sender_role, created_at, request_id")
            .eq("portal_id", r.portal.id)
            .eq("visitor_id", visitorId)
            .order("created_at", { ascending: true })
            .limit(500);
          messages = msgs ?? [];
          const jobIds = requests.map((x: any) => x.job_id).filter(Boolean);
          if (jobIds.length) {
            const { data: jrows } = await admin
              .from("jobs")
              .select("id, status, pickup_at, from_location, to_location")
              .in("id", jobIds);
            jobs = jrows ?? [];
          }
        }
        return Response.json({
          portal: { id: r.portal.id, name: r.portal.name, expires_at: r.portal.expires_at },
          requests, messages, jobs,
        });
      },
    },
  },
});

// Reuse resolver for sibling routes to avoid duplication.
export { resolvePublicPortal };
