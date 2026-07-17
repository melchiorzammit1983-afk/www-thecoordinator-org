import { createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";

/**
 * `/h/$slug` — branded company portal link.
 *
 * Coordinators share links like `https://thecoordinator.org/h/grand-hotel`.
 * The resolution now happens server-side: we redirect the browser to the
 * public API endpoint, which itself replies with a 302 to `/portal/<token>`.
 * The magic token is never exposed to client-side JavaScript.
 */
export const Route = createFileRoute("/h/$slug")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Company Portal" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: BrandedRedirect,
});

function BrandedRedirect() {
  const { slug } = Route.useParams();

  useEffect(() => {
    window.location.replace(`/api/public/portal/by-slug/${encodeURIComponent(slug)}`);
  }, [slug]);

  return (
    <div className="min-h-screen grid place-items-center p-8 text-center">
      <p className="text-sm text-muted-foreground">Opening your portal…</p>
    </div>
  );
}
