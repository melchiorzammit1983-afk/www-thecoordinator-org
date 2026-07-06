import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { getAdmin, mintPaxJwt, verifyPaxJwt, checkRateLimit } from "@/lib/portal-token.server";

/** POST /api/public/track/$token/verify — check last-4 or booking ref, mint 2h JWT. */
export const Route = createFileRoute("/api/public/track/$token/verify")({
  server: {
    handlers: {
      POST: async ({ params, request }) => {
        if (!(await checkRateLimit(params.token, 10)))
          return Response.json({ error: "rate_limited" }, { status: 429 });
        const body = await request.json().catch(() => ({}));
        const parsed = z.object({
          phone_last4: z.string().length(4).regex(/^\d{4}$/).optional(),
          booking_ref: z.string().min(4).max(40).optional(),
        }).refine((d) => d.phone_last4 || d.booking_ref, { message: "need one" }).safeParse(body);
        if (!parsed.success) return Response.json({ error: "bad_input" }, { status: 400 });

        const admin = await getAdmin();
        const { data: tok } = await admin.from("pax_tracking_tokens" as any)
          .select("job_id, phone_last4, booking_ref, revoked_at")
          .eq("token", params.token).maybeSingle();
        if (!tok || (tok as any).revoked_at)
          return Response.json({ error: "not_found" }, { status: 404 });

        const okPhone = parsed.data.phone_last4 && (tok as any).phone_last4
          && parsed.data.phone_last4 === (tok as any).phone_last4;
        const okRef = parsed.data.booking_ref && (tok as any).booking_ref
          && parsed.data.booking_ref.toLowerCase() === String((tok as any).booking_ref).toLowerCase();
        if (!okPhone && !okRef)
          return Response.json({ error: "verify_failed" }, { status: 401 });

        const jwt = mintPaxJwt({
          token: params.token,
          jobId: (tok as any).job_id,
          exp: Math.floor(Date.now() / 1000) + 60 * 60 * 2,
        });
        return Response.json({ jwt, expires_in: 7200 });
      },
    },
  },
});

export function verifyRequest(request: Request, token: string): { ok: true; jobId: string } | null {
  const auth = request.headers.get("authorization") ?? "";
  const jwt = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  const v = verifyPaxJwt(jwt);
  if (!v || v.token !== token) return null;
  return { ok: true, jobId: v.jobId };
}
