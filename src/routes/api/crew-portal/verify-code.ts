import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { resolveCrewByLinkToken, checkRateLimit, getAdmin, mintFreshCrewSession } from "@/lib/crew-token.server";

/**
 * POST /api/crew-portal/verify-code — crew enters the 6-digit code emailed by
 * /login. On success, mints a 1-hour session JWT and returns the crew profile.
 */
export const Route = createFileRoute("/api/crew-portal/verify-code")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const body = await request.json().catch(() => ({}));
        const parsed = z.object({
          token: z.string().min(10).max(128),
          email: z.string().trim().email().max(255),
          code: z.string().trim().length(6),
          preferred_language: z.enum(["en", "fil"]).optional(),
        }).safeParse(body);
        if (!parsed.success) return Response.json({ error: "bad_input" }, { status: 400 });

        const r = await resolveCrewByLinkToken(parsed.data.token);
        if (!r.ok) return Response.json({ error: r.error }, { status: r.status });

        if (!(await checkRateLimit(`crew-verify:${r.crew.id}`, 10))) {
          return Response.json({ error: "rate_limited" }, { status: 429 });
        }

        const email = parsed.data.email.toLowerCase();
        if (email !== r.crew.email.toLowerCase()) {
          return Response.json({ error: "invalid_code" }, { status: 401 });
        }

        const admin = await getAdmin();
        const { data: codeRow, error: codeErr } = await admin
          .from("crew_login_codes" as any)
          .select("id")
          .eq("crew_member_id", r.crew.id)
          .eq("code", parsed.data.code.trim())
          .is("consumed_at", null)
          .gt("expires_at", new Date().toISOString())
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (codeErr) return Response.json({ error: codeErr.message }, { status: 500 });
        if (!codeRow) return Response.json({ error: "invalid_code" }, { status: 401 });

        await admin
          .from("crew_login_codes" as any)
          .update({ consumed_at: new Date().toISOString() } as any)
          .eq("id", (codeRow as any).id);

        if (parsed.data.preferred_language && parsed.data.preferred_language !== r.crew.preferred_language) {
          await admin
            .from("crew_members" as any)
            .update({ preferred_language: parsed.data.preferred_language } as any)
            .eq("id", r.crew.id);
        }

        const session = mintFreshCrewSession(r.crew.id, r.crew.link_token);
        return Response.json({
          ...session,
          crew: {
            id: r.crew.id,
            name: r.crew.name,
            surname: r.crew.surname,
            preferred_language: parsed.data.preferred_language ?? r.crew.preferred_language,
          },
        });
      },
    },
  },
});
