import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";

/**
 * `/portal` — subdomain landing page.
 *
 * When a coordinator has connected wildcard DNS for `*.thecoordinator.org`,
 * a hotel receives a branded URL like `grand-hotel.thecoordinator.org/portal`.
 * This route reads the subdomain, resolves it to the portal's magic token,
 * and redirects to the real `/portal/<token>` page.
 */
export const Route = createFileRoute("/portal/")({
  ssr: false,
  head: () => ({ meta: [{ title: "Company Portal" }, { name: "robots", content: "noindex" }] }),
  component: PortalLanding,
});

function PortalLanding() {
  const [msg, setMsg] = useState("Loading…");
  useEffect(() => {
    const host = window.location.hostname;
    // Extract subdomain (e.g. "grand-hotel" from "grand-hotel.thecoordinator.org")
    const parts = host.split(".");
    const isRoot = parts.length < 3 || parts[0] === "www" || parts[0] === "id-preview--39452616-a23d-4f77-ba69-7d9cca7056b0";
    const slug = isRoot ? null : parts[0];
    if (!slug) {
      setMsg("Open your branded link — e.g. yourhotel.thecoordinator.org");
      return;
    }
    fetch(`/api/public/portal/by-slug/${encodeURIComponent(slug)}`)
      .then(async (r) => {
        if (!r.ok) { setMsg("This portal link is not available."); return; }
        const j = await r.json();
        if (!j.token) { setMsg("This portal link is not available."); return; }
        window.location.replace(`/portal/${j.token}`);
      })
      .catch(() => setMsg("Could not open portal."));
  }, []);
  return (
    <div className="min-h-screen grid place-items-center p-8 text-center">
      <p className="text-sm text-muted-foreground">{msg}</p>
    </div>
  );
}
