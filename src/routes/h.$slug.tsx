import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";

/**
 * `/h/$slug` — branded company portal link.
 *
 * Coordinators share links like `https://thecoordinator.org/h/grand-hotel`.
 * This route resolves the slug to the portal's magic token and redirects
 * to `/portal/<token>`, which is the real portal page.
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
  const [msg, setMsg] = useState("Opening your portal…");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(`/api/public/portal/by-slug/${encodeURIComponent(slug)}`);
        if (cancelled) return;
        if (!r.ok) { setMsg("This portal link is no longer active."); return; }
        const j = await r.json();
        if (!j.token) { setMsg("This portal link is no longer active."); return; }
        window.location.replace(`/portal/${j.token}`);
      } catch {
        if (!cancelled) setMsg("Could not open portal. Please try again.");
      }
    })();
    return () => { cancelled = true; };
  }, [slug]);

  return (
    <div className="min-h-screen grid place-items-center p-8 text-center">
      <div>
        <p className="text-sm text-muted-foreground">{msg}</p>
      </div>
    </div>
  );
}
