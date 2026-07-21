import { createFileRoute, Outlet } from "@tanstack/react-router";

// Layout route for the driver mobile app under /m/driver/$token/*.
// The leaf (dashboard) lives in m.driver.$token.index.tsx; child pages
// like /settings render inside this <Outlet />.
export const Route = createFileRoute("/m/driver/$token")({
  component: () => <Outlet />,
});
