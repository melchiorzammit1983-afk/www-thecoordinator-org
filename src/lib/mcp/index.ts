import { auth, defineMcp } from "@lovable.dev/mcp-js";
import listUpcomingTrips from "./tools/list_upcoming_trips";
import getTrip from "./tools/get_trip";
import listDrivers from "./tools/list_drivers";

// Issuer MUST be the direct Supabase host. Reading from
// import.meta.env.VITE_SUPABASE_PROJECT_ID (Vite inlines it at build time) —
// SUPABASE_URL is rewritten to the .lovable.cloud proxy on publish and mcp-js
// rejects that as an issuer mismatch.
const projectRef = import.meta.env.VITE_SUPABASE_PROJECT_ID ?? "project-ref-unset";

export default defineMcp({
  name: "the-coordinator-mcp",
  title: "The Coordinator",
  version: "0.1.0",
  instructions:
    "Read-only tools for The Coordinator dispatch app. Use list_upcoming_trips to see what's coming up, get_trip to look up a specific trip by its number, and list_drivers to see the coordinator's drivers. All tools act as the signed-in coordinator via OAuth.",
  auth: auth.oauth.issuer({
    issuer: `https://${projectRef}.supabase.co/auth/v1`,
    acceptedAudiences: "authenticated",
  }),
  tools: [listUpcomingTrips, getTrip, listDrivers],
});
