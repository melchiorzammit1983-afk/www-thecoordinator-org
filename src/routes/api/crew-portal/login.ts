import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { resolveCrewByLinkToken, checkRateLimit, getAdmin } from "@/lib/crew-token.server";

function generateCode() {
  const arr = new Uint32Array(1);
  crypto.getRandomValues(arr);
  return String(100000 + (arr[0] % 900000));
}

/**
 * POST /api/crew-portal/login — crew enters their email on the /crew-portal
 * landing page; if it matches the invited crew profile, email a 6-digit code
 * (10 min TTL). Always returns { ok: true } to avoid confirming/denying which
 * email is on file for a given link.
 */
export const Route = createFileRoute("/api/crew-portal/login")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const body = await request.json().catch(() => ({}));
        const parsed = z.object({
          token: z.string().min(10).max(128),
          email: z.string().trim().email().max(255),
        }).safeParse(body);
        if (!parsed.success) return Response.json({ error: "bad_input" }, { status: 400 });

        const r = await resolveCrewByLinkToken(parsed.data.token);
        if (!r.ok) return Response.json({ error: r.error }, { status: r.status });

        if (!(await checkRateLimit(`crew-login:${r.crew.id}`, 5))) {
          return Response.json({ error: "rate_limited" }, { status: 429 });
        }

        const email = parsed.data.email.toLowerCase();
        if (email !== r.crew.email.toLowerCase()) {
          // Don't reveal whether the email matched — keep the response identical.
          return Response.json({ ok: true });
        }

        const admin = await getAdmin();
        const code = generateCode();
        const expires_at = new Date(Date.now() + 10 * 60_000).toISOString();
        const { error } = await admin.from("crew_login_codes" as any).insert({
          crew_member_id: r.crew.id,
          code,
          expires_at,
        } as any);
        if (error) return Response.json({ error: error.message }, { status: 500 });

        await admin.rpc("enqueue_email" as any, {
          queue_name: "auth_emails",
          payload: {
            to: r.crew.email,
            from: "The Coordinator <noreply@thecoordinator.org>",
            sender_domain: "thecoordinator.org",
            subject: "Your login code",
            text: `Enter this code to view your crew change itinerary: ${code}\n\nThis code expires in 10 minutes.`,
            html: `<p>Enter this code to view your crew change itinerary:</p><p style="font-size:28px;font-weight:600;letter-spacing:4px;">${code}</p><p>This code expires in 10 minutes.</p>`,
            purpose: "auth",
            label: "crew_login_code",
            idempotency_key: `crew-code-${r.crew.id}-${Date.now()}`,
            message_id: crypto.randomUUID(),
          },
        } as any);

        return Response.json({ ok: true });
      },
    },
  },
});
