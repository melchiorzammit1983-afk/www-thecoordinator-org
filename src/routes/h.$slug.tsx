import { createFileRoute, Outlet } from "@tanstack/react-router";

/**
 * `/h/$slug` — layout for branded portal + room QR children.
 * The actual slug redirect lives in `h.$slug.index.tsx`, so that visiting
 * `/h/$slug/r/$qr` mounts the room-landing child instead of triggering
 * the by-slug redirect.
 */
export const Route = createFileRoute("/h/$slug")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Company Portal" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: () => <Outlet />,
});
