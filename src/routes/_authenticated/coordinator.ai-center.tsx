import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/coordinator/ai-center")({
  beforeLoad: () => {
    throw redirect({ to: "/coordinator" });
  },
});
