/**
 * Static description + toggleable classification for every feature_key
 * referenced by application code. Descriptions are shown in tooltips on
 * both admin and coordinator toggle UIs. `toggleable: true` means the
 * feature appears in the coordinator's Settings → Feature usage page.
 *
 * Kept as a plain static table so descriptions never lag behind reality —
 * update this file when you add a new paid feature call site.
 */

export type FeatureMeta = {
  key: string;
  label: string;
  description: string;
  toggleable: boolean;
  group: "assistant" | "flights" | "routing" | "extraction" | "ops" | "other";
};

export const FEATURE_META: FeatureMeta[] = [
  // Assistant family — one master key gates all sub-actions (assistant_qa etc.)
  { key: "ai_coordinator_assist", label: "AI coordinator assistant", group: "assistant", toggleable: true,
    description: "The floating chat that answers questions, drafts trips, and applies data fixes on your behalf." },

  // Extraction / bulk paste / voice
  { key: "ai_extraction", label: "AI trip extraction (text)", group: "extraction", toggleable: true,
    description: "Parses pasted crew-change messages into trip cards using AI." },
  { key: "ai_extraction_media", label: "AI trip extraction (files/URLs)", group: "extraction", toggleable: true,
    description: "Parses uploaded files or shared URLs into trip cards using AI (higher cost per call)." },
  { key: "ai_voice_to_trip", label: "Voice-note → trip", group: "extraction", toggleable: true,
    description: "Transcribes a voice recording and extracts trips from it." },

  // Auto-coordinate / daily plan / reply drafter
  { key: "ai_auto_coordinate", label: "AI Auto-Coordinate", group: "ops", toggleable: true,
    description: "Reviews the unassigned backlog and proposes groupings + driver/partner assignments." },
  { key: "ai_daily_plan", label: "AI daily plan", group: "ops", toggleable: true,
    description: "Orders a driver's day to minimise idle time and backtracking." },
  { key: "ai_reply_drafter", label: "AI chat reply drafts", group: "ops", toggleable: true,
    description: "Drafts 2–3 chat replies in the client's language and tone." },

  // Flight / vessel tracking (Lovable AI — web-grounded)
  { key: "flight_lookup_bundle", label: "Flight lookup — trip bundle", group: "flights", toggleable: true,
    description: "Charged once per trip when a flight code is attached. Covers the initial lookup and the automatic recheck ~30 min before pickup." },
  { key: "flight_lookup_refresh", label: "Flight lookup — manual refresh", group: "flights", toggleable: true,
    description: "Per-tap price when the coordinator or driver presses Refresh after the cached AI answer goes stale (>10 min old)." },
  { key: "flight_lookup_vessel", label: "Vessel lookup", group: "flights", toggleable: true,
    description: "Web-grounded AI lookup for cruise-ship / vessel arrivals. Charged per lookup." },
  { key: "flight_vessel_tracking", label: "Flight & vessel tracking", group: "flights", toggleable: true,
    description: "Master switch for all flight/vessel lookups. Turn off to disable creation-time and manual lookups entirely." },
  { key: "auto_shift_early_flight", label: "Auto-shift early flight", group: "flights", toggleable: true,
    description: "When the AI reports an inbound flight landing early, propose a pickup-time shift." },
  // Legacy keys kept for historical reporting — no longer charged.
  { key: "flight_status_extra_lookup", label: "Flight extra lookup (legacy)", group: "flights", toggleable: false,
    description: "Legacy key from the AeroDataBox era. Replaced by flight_lookup_refresh — kept for historical reporting only." },

  // Routing / live
  { key: "route_optimization", label: "Group route optimization", group: "routing", toggleable: true,
    description: "Suggests the best pickup order for a multi-stop group using Google Distance Matrix + AI." },
  { key: "live_eta_refresh", label: "Live ETA polling", group: "routing", toggleable: true,
    description: "Refreshes dashboard ETAs from Google Routes with live traffic every minute." },
  { key: "address_name_resolve", label: "Address name lookup", group: "routing", toggleable: true,
    description: "Resolves plus-codes and coordinates to a hotel or business name via Google Places." },

  // Watchtower / auto-forward
  { key: "ai_watchtower_scan", label: "Operations monitor scan", group: "ops", toggleable: false,
    description: "Deterministic background checks for delays, ETAs, schedule conflicts and missing trip data." },
  { key: "trip_auto_forward", label: "Off-hours auto-forward", group: "ops", toggleable: true,
    description: "Forwards trips that arrive outside your opening hours to the next available partner." },

  // Free / always-on — shown in tooltips but NOT in the toggle page
  { key: "trip_created", label: "Trip created", group: "other", toggleable: false,
    description: "Core dispatch operation. Always on." },
  { key: "trip_dispatched", label: "Trip dispatched", group: "other", toggleable: false,
    description: "Core dispatch operation. Always on." },
  { key: "client_link_sent", label: "Client tracking link", group: "other", toggleable: false,
    description: "Sends the per-trip client link when a driver is assigned." },
  { key: "portal_booking", label: "Portal booking", group: "other", toggleable: false,
    description: "Booking created via a hotel/company portal." },
  { key: "ai_char_overage", label: "AI long-message overage", group: "other", toggleable: false,
    description: "Per-character billing for AI messages beyond the free threshold. Managed on the AI overage page." },
];

export const FEATURE_META_BY_KEY: Record<string, FeatureMeta> = Object.fromEntries(
  FEATURE_META.map((f) => [f.key, f]),
);

/** Active paid services shown to coordinators while the optional AI module is inactive. */
const DEACTIVATED_AI_USAGE_KEYS = new Set([
  "ai_coordinator_assist",
  "ai_extraction",
  "ai_extraction_media",
  "ai_voice_to_trip",
  "ai_auto_coordinate",
  "ai_daily_plan",
  "ai_reply_drafter",
  "flight_lookup_bundle",
  "flight_lookup_refresh",
  "flight_lookup_vessel",
  "flight_vessel_tracking",
  "auto_shift_early_flight",
  "route_optimization",
]);

export const TOGGLEABLE_FEATURES = FEATURE_META.filter(
  (f) => f.toggleable && !DEACTIVATED_AI_USAGE_KEYS.has(f.key),
);
