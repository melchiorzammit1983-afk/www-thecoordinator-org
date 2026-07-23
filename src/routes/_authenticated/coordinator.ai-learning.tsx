import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/coordinator/ai-learning")({
  beforeLoad: () => {
    throw redirect({ to: "/coordinator" });
  },
});
