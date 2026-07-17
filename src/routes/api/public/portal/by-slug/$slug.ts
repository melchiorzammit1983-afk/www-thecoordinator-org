import { createFileRoute } from "@tanstack/react-router";
import { getAdmin } from "@/lib/portal-token.server";

/**
 * GET /api/public/portal/by-slug/$slug
 *
 * Resolves a branded portal slug (e.g. `grand-hotel`) to the portal's
 * magic-token URL and issues a 302 redirect. The magic token is NEVER
 * returned in the response body, so client-side JS cannot read it just
 * by knowing/guessing a slug — enumeration only lands the visitor on the
 * portal page itself, same as clicking a shared link.
 */
export const Route = createFileRoute("/api/public/portal/by-slug/$slug")({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        const slug = (params.slug || "").toLowerCase();
        if (!/^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/.test(slug)) {
          return new Response("Invalid slug", { status: 400 });
        }
        const admin = await getAdmin();
        const { data } = await admin
          .from("portal_companies" as any)
          .select("magic_token, link_enabled, active, link_expires_at")
          .eq("slug", slug)
          .maybeSingle();

        const d = data as any | null;
        const expired = d?.link_expires_at ? new Date(d.link_expires_at).getTime() < Date.now() : false;
        if (!d || !d.magic_token || d.link_enabled === false || d.active === false || expired) {
          // Generic response — do not disclose whether the slug exists.
          return new Response("This portal link is no longer active.", {
            status: 404,
            headers: { "content-type": "text/plain; charset=utf-8" },
          });
        }

        const url = new URL(request.url);
        const target = `${url.origin}/portal/${encodeURIComponent(d.magic_token)}`;
        return new Response(null, {
          status: 302,
          headers: {
            Location: target,
            "Cache-Control": "no-store",
            "Referrer-Policy": "no-referrer",
          },
        });
      },
    },
  },
});
