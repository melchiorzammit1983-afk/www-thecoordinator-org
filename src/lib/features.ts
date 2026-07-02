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
  | "ai_group_suggestions";

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
];

export const FEATURE_KEYS = FEATURE_CATALOG.map((f) => f.key) as FeatureKey[];
