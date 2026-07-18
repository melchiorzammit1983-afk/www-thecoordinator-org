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
  | "ai_auto_coordinate"
  | "ai_daily_plan"
  | "ai_reply_drafter"
  | "ai_voice_to_trip"
  | "client_trip_portal"
  | "client_push_notifications"
  | "client_eta"
  | "client_sos"
  | "client_offline_mode"
  | "branding_advert"
  | "address_name_resolve"
  | "route_eta"
  | "availability_autoforward"
  | "ai_coordinator_assist"
  | "ai_watchtower";

export const FEATURE_CATALOG: { key: FeatureKey; label: string; description: string; isAi?: boolean }[] = [
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
  { key: "ai_extraction",   label: "AI trip extraction", description: "Understand pasted messages, files, or links into trips using AI", isAi: true },
  { key: "ai_auto_coordinate", label: "AI Auto-Coordinate", description: "AI reviews the whole unassigned backlog and proposes groupings + driver assignments for one-click approval", isAi: true },
  { key: "ai_daily_plan",   label: "AI daily plan",     description: "Order a driver's trips to minimize idle time & backtracking", isAi: true },
  { key: "ai_reply_drafter", label: "AI reply drafter", description: "Draft 2–3 chat replies in the client's language & tone", isAi: true },
  { key: "ai_voice_to_trip", label: "AI voice-note → trip", description: "Record or upload a voice note; AI transcribes and extracts trips", isAi: true },
  { key: "client_trip_portal", label: "Client trip portal", description: "Per-trip client link with chat, live tracking, share location & rebook" },
  { key: "client_push_notifications", label: "Client push alerts", description: "Browser/PWA push notifications for driver assigned, en-route, arriving" },
  { key: "client_eta",      label: "Client live ETA",   description: "Traffic-aware ETA countdown on client portal from driver location" },
  { key: "client_sos",      label: "Client SOS button", description: "Emergency SOS on client portal with location broadcast to coordinator" },
  { key: "client_offline_mode", label: "Client offline mode", description: "Cache last trip data so the portal works with no signal" },
  { key: "branding_advert",  label: "Branding & advert",   description: "Coordinator logo + advert banner shown at bottom of driver and client apps" },
  { key: "address_name_resolve", label: "Address name lookup", description: "Show hotel / business name (from Google Places) instead of plus-codes or coordinates on cards, sheets, and client portal. Coordinates stay stored for routing." },
  { key: "route_eta",        label: "From → To ETA",      description: "Estimate driving time & distance between pickup and dropoff. Shown in the trip form, on calendar cards, and in the client portal." },
  { key: "availability_autoforward", label: "Availability & auto-forward", description: "Set opening hours for the company and each driver. Off-hours or unanswered trips auto-jump to the next available partner in your network. Admin charges a small per-forward fee." },
  { key: "ai_coordinator_assist", label: "AI coordinator assistant", description: "Floating chat that answers questions about your dispatch and drafts a single trip create/edit for one-tap confirmation.", isAi: true },
  { key: "ai_watchtower",   label: "AI Watchtower",     description: "Opt-in background scans that watch flights, driver ETAs, schedule conflicts and trip data — alerts you when something needs attention. Each scan costs points.", isAi: true },
];

export const FEATURE_KEYS = FEATURE_CATALOG.map((f) => f.key) as FeatureKey[];
export const AI_FEATURE_KEYS = FEATURE_CATALOG.filter((f) => f.isAi).map((f) => f.key) as FeatureKey[];
