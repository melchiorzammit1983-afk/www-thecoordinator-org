import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { checkRateLimit, getAdmin } from "@/lib/portal-token.server";
import { resolvePublicPortal } from "./index";

export const Route = createFileRoute("/api/public/b/$token/messages")({
  server: {
    handlers: {
      POST: async ({ params, request }) => {
        const r = await resolvePublicPortal(params.token);
        if (!r.ok) return Response.json({ error: r.error }, { status: r.status });
        if (!(await checkRateLimit(`bmsg:${params.token}`, 30))) {
          return Response.json({ error: "rate_limited" }, { status: 429 });
        }
        const body = await request.json().catch(() => ({}));
        const parsed = z.object({
          visitor_id: z.string().min(8).max(80),
          request_id: z.string().uuid().nullable().optional(),
          body: z.string().min(1).max(4000),
        }).safeParse(body);
        if (!parsed.success) return Response.json({ error: "bad_input" }, { status: 400 });
        const admin = await getAdmin();
        const { error } = await admin.from("public_booking_messages" as any).insert({
          portal_id: r.portal.id,
          visitor_id: parsed.data.visitor_id,
          request_id: parsed.data.request_id ?? null,
          sender_role: "visitor",
          body: parsed.data.body,
        } as any);
        if (error) return Response.json({ error: error.message }, { status: 500 });
        return Response.json({ ok: true });
      },
    },
  },
});
