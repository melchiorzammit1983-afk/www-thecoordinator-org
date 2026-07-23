import { createFileRoute } from "@tanstack/react-router";

const unavailable = () =>
  Response.json({ error: "not_found" }, { status: 404 });

export const Route = createFileRoute("/api/help-chat")({
  server: { handlers: { POST: unavailable } },
});
