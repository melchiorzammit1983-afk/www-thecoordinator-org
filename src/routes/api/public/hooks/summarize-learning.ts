import { createFileRoute } from "@tanstack/react-router";

const unavailable = () =>
  Response.json({ error: "not_found" }, { status: 404 });

export const Route = createFileRoute("/api/public/hooks/summarize-learning")({
  server: { handlers: { POST: unavailable } },
});
