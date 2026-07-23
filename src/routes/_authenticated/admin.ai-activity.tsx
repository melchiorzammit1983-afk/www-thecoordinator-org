import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/admin/ai-activity")({
  beforeLoad: () => {
    throw redirect({ to: "/admin/activity" });
  },
});
