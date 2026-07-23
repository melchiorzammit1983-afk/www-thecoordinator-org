import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/admin/ai-lessons")({
  beforeLoad: () => {
    throw redirect({ to: "/admin" });
  },
});
