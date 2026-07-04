export type FeatureKey =
  | "dispatch"
  | "pending"
  | "drivers"
  | "portal_links"
  | "labels"
  | "statements"
  | "collaborate"
  | "my_driving"
  | "live_tracking"
  | "flight_tracking"
  | "bulk_paste"
  | "chat"
  | "ai_extraction"
  | "ai_group_suggestions"
  | "client_trip_portal"
  | "client_push_notifications"
  | "client_eta"
  | "client_sos"
  | "client_offline_mode"
  | "branding_advert";

export const FEATURE_CATALOG: { key: FeatureKey; label: string; description: string }[] = [
  { key: "dispatch",        label: "Dispatch calendar", description: "Main calendar / dispatch board" },
  { key: "pending",         label: "Pending approvals", description: "Client booking modifications queue" },
  { key: "drivers",         label: "Drivers",           description: "Manage the driver roster" },
  { key: "portal_links",    label: "Portal links",      description: "Generate magic links for drivers & clients" },
  { key: "labels",          label: "Trip labels",       description: "Create colored labels for trips" },
  { key: "statements",      label: "Statements",        description: "Report builder / CSV exports" },
  { key: "collaborate",     label: "Collaborate",       description: "Partner connections & multi-hop dispatch" },
  { key: "my_driving",      label: "My driving",        description: "Self-driving portal for coordinator" },
  { key: "live_tracking",   label: "Live GPS tracking", description: "Live driver map on trip cards" },
  { key: "flight_tracking", label: "Flight tracking",   description: "AviationStack flight status" },
  { key: "bulk_paste",      label: "Bulk paste",        description: "WhatsApp bulk trip import" },
  { key: "chat",            label: "Trip chat",         description: "Coordinator ↔ driver chat on trips" },
  { key: "ai_extraction",   label: "AI trip extraction", description: "Understand pasted messages (any language) into trips using AI" },
  { key: "ai_group_suggestions", label: "AI auto-group suggestions", description: "Suggest groupings of unassigned trips by time & route" },
  { key: "client_trip_portal", label: "Client trip portal", description: "Per-trip client link with chat, live tracking, share location & rebook" },
  { key: "client_push_notifications", label: "Client push alerts", description: "Browser/PWA push notifications for driver assigned, en-route, arriving" },
  { key: "client_eta",      label: "Client live ETA",   description: "Traffic-aware ETA countdown on client portal from driver location" },
  { key: "client_sos",      label: "Client SOS button", description: "Emergency SOS on client portal with location broadcast to coordinator" },
  { key: "client_offline_mode", label: "Client offline mode", description: "Cache last trip data so the portal works with no signal" },
  { key: "branding_advert",  label: "Branding & advert",   description: "Coordinator logo + advert banner shown at bottom of driver and client apps" },
];

export const FEATURE_KEYS = FEATURE_CATALOG.map((f) => f.key) as FeatureKey[];
