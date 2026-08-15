import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/coordinator/portal-creator")({
  head: () => ({ meta: [{ title: "Portal Creator — Coordinator" }] }),
  beforeLoad: () => { throw redirect({ to: "/coordinator/portal-links" }); },
});
