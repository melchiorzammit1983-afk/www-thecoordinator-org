import { createFileRoute } from "@tanstack/react-router";
import { resolvePortalRecordByHandles } from "@/lib/portal-token.server";

/**
 * GET /api/public/portal/by-path/$company/$portal
 *
 * Resolves a clean branded link (`/<coordinator-slug>/<portal-slug>`) to the
 * portal's magic-token URL and issues a 302. The magic token is never in a
 * response body, so client-side JS cannot read it from a guessed path.
 */
const SEGMENT_RE = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;

export const Route = createFileRoute("/api/public/portal/by-path/$company/$portal")({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        const company = (params.company || "").toLowerCase();
        const portal = (params.portal || "").toLowerCase();
        if (!SEGMENT_RE.test(company) || !SEGMENT_RE.test(portal)) {
          return new Response("Invalid link", { status: 400 });
        }
        const notActive = () =>
          new Response("This portal link is no longer active.", {
            status: 404,
            headers: { "content-type": "text/plain; charset=utf-8" },
          });

        const resolved = await resolvePortalRecordByHandles(company, portal);
        if (!resolved.ok || !resolved.portal.magic_token) return notActive();

        const url = new URL(request.url);
        return new Response(null, {
          status: 302,
          headers: {
            Location: `${url.origin}/portal/${encodeURIComponent(resolved.portal.magic_token)}`,
            "Cache-Control": "no-store",
            "Referrer-Policy": "no-referrer",
          },
        });
      },
    },
  },
});
