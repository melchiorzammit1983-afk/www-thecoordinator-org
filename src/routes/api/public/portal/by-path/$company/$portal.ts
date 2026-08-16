import { createFileRoute } from "@tanstack/react-router";
import { getAdmin } from "@/lib/portal-token.server";

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
        const admin = await getAdmin();
        const { data: coordinator } = await admin
          .from("companies")
          .select("id")
          .eq("slug", company)
          .maybeSingle();

        const notActive = () =>
          new Response("This portal link is no longer active.", {
            status: 404,
            headers: { "content-type": "text/plain; charset=utf-8" },
          });

        if (!coordinator?.id) return notActive();

        const { data } = await admin
          .from("portal_companies" as any)
          .select("magic_token, link_enabled, active, link_expires_at")
          .eq("coordinator_company_id", coordinator.id)
          .eq("portal_slug", portal)
          .maybeSingle();

        const d = data as any | null;
        const expired = d?.link_expires_at ? new Date(d.link_expires_at).getTime() < Date.now() : false;
        if (!d || !d.magic_token || d.link_enabled === false || d.active === false || expired) {
          return notActive();
        }

        const url = new URL(request.url);
        return new Response(null, {
          status: 302,
          headers: {
            Location: `${url.origin}/portal/${encodeURIComponent(d.magic_token)}`,
            "Cache-Control": "no-store",
            "Referrer-Policy": "no-referrer",
          },
        });
      },
    },
  },
});
