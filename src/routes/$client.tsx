import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";

const ROOT_DOMAIN = "thecoordinator.org";

export const Route = createFileRoute("/$client")({
  ssr: false,
  head: () => ({
    meta: [{ title: "Client Portal — The Coordinators" }, { name: "robots", content: "noindex" }],
  }),
  component: ProfessionalClientPortalRoute,
});

function ProfessionalClientPortalRoute() {
  const { client } = Route.useParams();
  const [validHost, setValidHost] = useState(true);

  useEffect(() => {
    const hostname = window.location.hostname.toLowerCase();
    const suffix = `.${ROOT_DOMAIN}`;
    if (!hostname.endsWith(suffix)) {
      setValidHost(false);
      return;
    }
    const coordinator = hostname.slice(0, -suffix.length);
    if (!coordinator || coordinator.includes(".")) {
      setValidHost(false);
      return;
    }
    window.location.replace(
      `/api/public/portal/by-company/${encodeURIComponent(coordinator)}/${encodeURIComponent(client)}`,
    );
  }, [client]);

  return (
    <div className="grid min-h-screen place-items-center bg-slate-950 p-8 text-center text-white">
      <div>
        <div className="text-xs uppercase tracking-[0.25em] text-teal-300">Client Portal</div>
        <p className="mt-3 text-sm text-white/75">
          {validHost ? "Opening your secure workspace…" : "This portal address is not active."}
        </p>
        {!validHost && <ButtonLink />}
      </div>
    </div>
  );
}

function ButtonLink() {
  return (
    <Link
      to="/client-portal"
      className="mt-5 inline-flex h-10 items-center rounded-md bg-teal-500 px-4 text-sm font-medium text-slate-950"
    >
      Open Client Portal sign in
    </Link>
  );
}
