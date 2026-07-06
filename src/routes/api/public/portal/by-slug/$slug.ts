import { createFileRoute } from "@tanstack/react-router";
import { getAdmin } from "@/lib/portal-token.server";

/**
 * GET /api/public/portal/by-slug/$slug
 * Public endpoint that maps a branded slug (e.g. `grand-hotel`) to the
 * portal's magic token so the app can redirect from
 * `<slug>.thecoordinator.org/portal` to the working `/portal/<token>` URL.
 *
 * Returns only the token + on/off status — no PII.
 */
export const Route = createFileRoute("/api/public/portal/by-slug/$slug")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const slug = (params.slug || "").toLowerCase();
        if (!/^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/.test(slug)) {
          return Response.json({ error: "invalid_slug" }, { status: 400 });
        }
        const admin = await getAdmin();
        const { data } = await admin
          .from("portal_companies" as any)
          .select("magic_token, link_enabled, active, link_expires_at")
          .eq("slug", slug)
          .maybeSingle();
        if (!data) return Response.json({ error: "not_found" }, { status: 404 });
        const d = data as any;
        return Response.json({
          token: d.magic_token,
          link_enabled: d.link_enabled,
          active: d.active,
          link_expires_at: d.link_expires_at,
        });
      },
    },
  },
});
