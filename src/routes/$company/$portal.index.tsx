import { createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";

/**
 * `/<coordinator>/<portal>` — clean branded portal link.
 *
 * Resolution happens server-side: the browser is sent to the public API
 * endpoint, which replies with a 302 to `/portal/<magic-token>`. The token
 * is never exposed to client-side JavaScript.
 */
export const Route = createFileRoute("/$company/$portal/")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Company Portal" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: BrandedPortalRedirect,
});

function BrandedPortalRedirect() {
  const { company, portal } = Route.useParams();

  useEffect(() => {
    window.location.replace(
      `/api/public/portal/by-path/${encodeURIComponent(company)}/${encodeURIComponent(portal)}`,
    );
  }, [company, portal]);

  return (
    <div className="min-h-screen grid place-items-center p-8 text-center">
      <p className="text-sm text-muted-foreground">Opening your portal…</p>
    </div>
  );
}
