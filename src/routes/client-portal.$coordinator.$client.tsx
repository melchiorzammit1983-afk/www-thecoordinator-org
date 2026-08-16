import { createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";

export const Route = createFileRoute("/client-portal/$coordinator/$client")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Opening client portal — The Coordinators" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: ClientPortalRedirect,
});

function ClientPortalRedirect() {
  const { coordinator, client } = Route.useParams();
  useEffect(() => {
    window.location.replace(
      `/api/public/portal/by-company/${encodeURIComponent(coordinator)}/${encodeURIComponent(client)}`,
    );
  }, [client, coordinator]);

  return (
    <div className="grid min-h-screen place-items-center bg-slate-950 p-8 text-center text-white">
      <div>
        <div className="text-xs uppercase tracking-[0.25em] text-teal-300">Client Portal</div>
        <p className="mt-3 text-sm text-white/75">Opening your secure workspace…</p>
      </div>
    </div>
  );
}
