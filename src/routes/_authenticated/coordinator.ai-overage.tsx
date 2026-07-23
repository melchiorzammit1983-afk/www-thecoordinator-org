import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/coordinator/ai-overage")({
  beforeLoad: () => {
    throw redirect({ to: "/coordinator/billing" });
  },
});
