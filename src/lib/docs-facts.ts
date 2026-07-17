/**
 * Live facts pulled from the codebase. Docs render these via <Fact name="..." />
 * so when a constant changes, every article that references it updates on the
 * next build. Never hardcode these numbers in articles.
 */
import { SCHEDULING_CONSTANTS } from "./scheduling.functions";

export type TripEventInfo = {
  type: string;
  label: string;
  category: "movement" | "waiting" | "boarding" | "incident" | "override" | "system";
  payoutDeltaEur: number;
  trustDelta: number;
  description: string;
  who: "driver" | "coordinator" | "system" | "both";
};

/**
 * Human-facing catalog of every trip_map_event type. Kept alongside
 * TripMapEventType in trip-map.server.ts — when you add a new event
 * there, add a row here so docs + AI guide learn about it automatically.
 */
export const TRIP_EVENT_CATALOG: TripEventInfo[] = [
  { type: "en_route", label: "On the way", category: "movement", payoutDeltaEur: 0, trustDelta: 1, who: "driver",
    description: "Driver accepted and is heading to the pickup location. Starts live tracking." },
  { type: "arrived_pickup", label: "Arrived at pickup", category: "movement", payoutDeltaEur: 0, trustDelta: 2, who: "driver",
    description: "Driver reached the pickup within the proximity threshold. If they're too far, an override is required." },
  { type: "arrived_pickup_override", label: "Arrived — GPS override", category: "override", payoutDeltaEur: 0, trustDelta: -1, who: "driver",
    description: "Driver forced 'Arrived' from too far away. Logged for review." },
  { type: "in_progress", label: "Passenger on board", category: "movement", payoutDeltaEur: 0, trustDelta: 2, who: "driver",
    description: "Passenger picked up. Trip is now in progress." },
  { type: "completed", label: "Trip completed", category: "movement", payoutDeltaEur: 0, trustDelta: 5, who: "driver",
    description: "Driver marked the trip complete. Locks trip pricing and payout." },
  { type: "actual_dropoff", label: "Actual drop-off", category: "movement", payoutDeltaEur: 0, trustDelta: 0, who: "driver",
    description: "GPS-confirmed drop-off location, may differ from booked drop-off." },
  { type: "back_to_waiting", label: "Back to waiting", category: "waiting", payoutDeltaEur: 0, trustDelta: 0, who: "driver",
    description: "Driver resumed waiting after a partial move." },
  { type: "wait_started", label: "Waiting started", category: "waiting", payoutDeltaEur: 0, trustDelta: 0, who: "system",
    description: "Waiting-time meter began. Anchored to max(now, pickup_at) and requires driver within pickup proximity." },
  { type: "wait_ended", label: "Waiting ended", category: "waiting", payoutDeltaEur: 0, trustDelta: 0, who: "system",
    description: "Waiting meter stopped when passenger boarded or driver left the zone." },
  { type: "boarding_requested", label: "Boarding approval requested", category: "boarding", payoutDeltaEur: 0, trustDelta: 0, who: "driver",
    description: "Driver asked coordinator to confirm boarding when passenger identity or pax count is uncertain." },
  { type: "boarding_approved", label: "Boarding approved", category: "boarding", payoutDeltaEur: 0, trustDelta: 0, who: "coordinator",
    description: "Coordinator approved boarding request." },
  { type: "boarding_rejected", label: "Boarding rejected", category: "boarding", payoutDeltaEur: 0, trustDelta: 0, who: "coordinator",
    description: "Coordinator rejected boarding — driver must resolve before proceeding." },
  { type: "pax_no_show", label: "Passenger no-show", category: "incident", payoutDeltaEur: 10, trustDelta: 3, who: "driver",
    description: "Passenger didn't appear after the waiting window. Applies a €10 no-show adjustment; driver keeps trust for proper handling." },
  { type: "pax_cancelled", label: "Passenger cancelled", category: "incident", payoutDeltaEur: 5, trustDelta: 0, who: "both",
    description: "Passenger cancelled after driver was en route. Small compensation adjustment." },
  { type: "coord_status_override", label: "Coordinator status override", category: "override", payoutDeltaEur: 0, trustDelta: 0, who: "coordinator",
    description: "Coordinator manually corrected trip status. Does NOT affect driver trust score — audit trail only." },
  { type: "status_corrected", label: "Status corrected", category: "override", payoutDeltaEur: 0, trustDelta: 0, who: "coordinator",
    description: "Post-trip status correction from the coordinator dashboard." },
  { type: "navigate_opened", label: "Navigation opened", category: "system", payoutDeltaEur: 0, trustDelta: 0, who: "driver",
    description: "Driver launched Google Maps / native nav from the trip screen." },
  { type: "passenger_called", label: "Passenger called", category: "system", payoutDeltaEur: 0, trustDelta: 0, who: "driver",
    description: "Driver tapped the passenger call button." },
  { type: "pickup_snap", label: "Pickup GPS snap", category: "system", payoutDeltaEur: 0, trustDelta: 0, who: "system",
    description: "GPS coordinate captured at the moment of 'Arrived at pickup'." },
  { type: "dropoff_snap", label: "Drop-off GPS snap", category: "system", payoutDeltaEur: 0, trustDelta: 0, who: "system",
    description: "GPS coordinate captured at the moment of 'Trip completed'." },
  { type: "emergency_override", label: "Emergency override", category: "incident", payoutDeltaEur: 0, trustDelta: 0, who: "driver",
    description: "Driver invoked emergency override — flagged to coordinator immediately." },
  { type: "safety_concern", label: "Safety concern", category: "incident", payoutDeltaEur: 0, trustDelta: 0, who: "driver",
    description: "Driver flagged a safety concern. Coordinator is notified in real time." },
  { type: "breakdown", label: "Vehicle breakdown", category: "incident", payoutDeltaEur: 0, trustDelta: 0, who: "driver",
    description: "Vehicle breakdown reported — coordinator must reassign the trip." },
];

/**
 * Named live constants. Update the source in the app, and every article
 * that renders <Fact name="..." /> updates automatically on the next build.
 */
export const FACTS = {
  conflictBufferMin: {
    value: SCHEDULING_CONSTANTS.PAX_DROPOFF_BUFFER_MIN,
    unit: "min",
    label: "Handover buffer between back-to-back trips",
    description:
      "Minimum minutes we assume a driver needs to hand off passengers before their next pickup. Trips scheduled tighter than this trigger a red conflict badge.",
  },
  conflictTightMin: {
    value: SCHEDULING_CONSTANTS.TIGHT_THRESHOLD_MIN,
    unit: "min",
    label: "'Tight' slack warning",
    description: "Slack below this shows an amber warning even if the trip isn't a hard conflict.",
  },
  waitProximityMeters: {
    value: 150,
    unit: "m",
    label: "Waiting-time proximity",
    description:
      "Driver must be stationary within this distance of the pickup for the wait meter to accumulate.",
  },
  waitAnchoredTo: {
    value: "max(now, pickup_at)",
    unit: "",
    label: "Waiting start anchor",
    description:
      "Waiting time only starts at the booked pickup time — early arrivals don't earn waiting fees.",
  },
  etaPollSeconds: {
    value: 60,
    unit: "s",
    label: "ETA polling interval",
    description: "Coordinator ETA badges refresh every 60 seconds when the tab is visible.",
  },
  etaLiveFreshnessMin: {
    value: 5,
    unit: "min",
    label: "Live ETA freshness threshold",
    description: "ETAs older than this fall back to a planned/orange chip.",
  },
  noShowFeeEur: {
    value: 10,
    unit: "€",
    label: "No-show adjustment",
    description: "Auto-applied to the driver payout when a passenger doesn't appear.",
  },
  paxCancelFeeEur: {
    value: 5,
    unit: "€",
    label: "Late passenger cancellation compensation",
    description: "Small compensation when a passenger cancels after the driver is en route.",
  },
  routeDeviationMeters: {
    value: 60,
    unit: "m",
    label: "Live rerouting threshold",
    description: "If the driver deviates more than this from the planned route, we recompute ETA automatically.",
  },
  aiExtractionRetryMax: {
    value: 3,
    unit: "",
    label: "AI extraction retries",
    description: "How many times we retry a failed AI trip extraction with exponential backoff before refunding points.",
  },
} as const;

export type FactKey = keyof typeof FACTS;

/**
 * Visual signals the app renders. The AI guide uses this vocabulary to
 * answer "why is this red?" style questions. Add a row when you introduce
 * a new colored badge, pill, or animated state.
 */
export type Signal = {
  key: string;
  where: string;
  meaning: string;
  fixHint: string;
};

export const SIGNAL_REGISTRY: Signal[] = [
  {
    key: "trip.card.red-glow",
    where: "Coordinator dispatch — trip card",
    meaning:
      "Schedule conflict: the assigned driver can't reach this pickup on time given their previous trip end, handover buffer, and transit time.",
    fixHint:
      "Open the trip → Suggested drivers to auto-pick an available driver, or nudge the pickup time forward until the slack turns green.",
  },
  {
    key: "trip.card.amber-glow",
    where: "Coordinator dispatch — trip card",
    meaning: "Tight schedule: buffer is under the tight threshold but not a hard conflict.",
    fixHint: "Consider nudging the pickup or reassigning if traffic conditions worsen.",
  },
  {
    key: "eta.chip.green",
    where: "Trip card / dashboard",
    meaning: "Live traffic-aware ETA refreshed in the last few minutes.",
    fixHint: "No action needed.",
  },
  {
    key: "eta.chip.orange",
    where: "Trip card / dashboard",
    meaning: "Planned ETA — either not yet fetched live or stale beyond the freshness window.",
    fixHint: "Click 'Refresh ETA' on the trip. If it stays orange, check the Google Maps connector.",
  },
  {
    key: "waiting.chip",
    where: "Trip card",
    meaning: "Driver is stationary near pickup and the wait meter is accruing.",
    fixHint: "No action needed — passenger boarding will stop the meter.",
  },
  {
    key: "map.pin.purple",
    where: "Trip map",
    meaning: "Coordinator status override was applied at this point.",
    fixHint: "Open the pin to see who overrode, when, and why.",
  },
  {
    key: "driver.status-pill.red",
    where: "Driver mobile app",
    meaning: "Emergency or safety event flagged.",
    fixHint: "Coordinator: contact the driver immediately. Driver: use the primary action to update.",
  },
  {
    key: "ai-extraction.error",
    where: "AI trip extraction dialog",
    meaning: "AI model failed after retries. Points are refunded automatically.",
    fixHint: "Wait 30s and retry, or paste the trip manually. If it persists, the AI provider is likely rate-limited.",
  },
];
