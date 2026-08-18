import { createFileRoute } from "@tanstack/react-router";
import { checkRateLimit, resolvePortalRecordByHandles } from "@/lib/portal-token.server";

export const Route = createFileRoute("/api/public/portal/by-company/$coordinator/$client")({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        const key = `${params.coordinator}:${params.client}`.toLowerCase();
        if (!(await checkRateLimit(`portal-address:${key}`, 30))) {
          return new Response("Please wait before trying again.", { status: 429 });
        }
        const resolved = await resolvePortalRecordByHandles(params.coordinator, params.client);
        if (!resolved.ok) {
          return new Response("This portal address is not active.", {
            status: resolved.status === 500 ? 500 : 404,
            headers: { "content-type": "text/plain; charset=utf-8" },
          });
        }
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
