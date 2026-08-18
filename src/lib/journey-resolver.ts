/** Pure, shared Booking Journey Engine. It deliberately knows nothing about
 * passengers, schedules, stored jobs, or transport providers. */
export type JourneyEndpoint = "airport" | "port" | "local";
export type JourneyType =
  | "arrival_flight"
  | "departure_flight"
  | "ship_arrival"
  | "ship_departure"
  | "ship_to_flight"
  | "flight_to_ship"
  | "road_transfer";
export type PrimaryTransport = "flight" | "ship" | null;
export type OptionalConnection = "flight" | "ship" | null;

export type JourneyDecision = {
  journeyType: JourneyType;
  primaryTransport: PrimaryTransport;
  optionalConnection: OptionalConnection;
  trackingKind: "flight" | "vessel" | null;
};

/**
 * Validates the authoritative endpoint pair before it is passed to the pure
 * resolver. Legacy import/API contracts may opt into the explicit
 * local/local default, but a partial pair is never guessed.
 */
export function normalizeBookingEndpointTypes(
  input: { from_location_type?: JourneyEndpoint | null; to_location_type?: JourneyEndpoint | null },
  options: { defaultMissingToLocal?: boolean } = {},
): { fromLocationType: JourneyEndpoint; toLocationType: JourneyEndpoint } {
  const from = input.from_location_type ?? undefined;
  const to = input.to_location_type ?? undefined;
  if (from === undefined && to === undefined) {
    if (options.defaultMissingToLocal) {
      return { fromLocationType: "local", toLocationType: "local" };
    }
    throw new Error("Both endpoint types are required.");
  }
  if (from === undefined || to === undefined) {
    throw new Error("Both endpoint types are required.");
  }
  return { fromLocationType: from, toLocationType: to };
}

/** Converts provider-supplied categories only; free text is never examined. */
export function classifyProviderEndpoint(placeTypes?: readonly string[] | null): JourneyEndpoint {
  const types = new Set(placeTypes ?? []);
  if (types.has("airport")) return "airport";
  if (types.has("ferry_terminal") || types.has("marina") || types.has("port")) return "port";
  return "local";
}

const AIRPORT_TEXT_RE = /\b(airport|malta international airport|mia|luqa)\b/i;
const PORT_TEXT_RE = /\b(port|marina|terminal|shipyard|harbour|harbor|berth|pier|freeport)\b/i;

/**
 * Best-effort fallback for text that never went through Places — a bulk
 * paste or an uploaded sheet row, where there is no provider category to
 * read. This is intentionally separate from classifyProviderEndpoint (whose
 * whole contract is "free text is never examined") and must never replace
 * it on a path where real provider data is available; an interactive
 * address pick or a Port Directory selection always overrides this guess.
 * Matches a small fixed airport-keyword list first, then the company's own
 * named ports/berths (substring, either direction), then generic port
 * keywords. Anything unmatched stays "local" — same default as before this
 * existed, so a wrong guess is never worse than the prior behaviour.
 */
export function classifyBulkImportLocationText(
  text: string,
  ports?: readonly { name: string }[] | null,
): JourneyEndpoint {
  const t = (text ?? "").trim();
  if (!t) return "local";
  if (AIRPORT_TEXT_RE.test(t)) return "airport";
  const lower = t.toLowerCase();
  for (const p of ports ?? []) {
    const name = p.name?.trim().toLowerCase();
    if (name && (lower.includes(name) || name.includes(lower))) return "port";
  }
  if (PORT_TEXT_RE.test(t)) return "port";
  return "local";
}

const JOURNEYS: Record<JourneyType, JourneyDecision> = {
  arrival_flight: { journeyType: "arrival_flight", primaryTransport: "flight", optionalConnection: null, trackingKind: "flight" },
  departure_flight: { journeyType: "departure_flight", primaryTransport: "flight", optionalConnection: null, trackingKind: "flight" },
  ship_arrival: { journeyType: "ship_arrival", primaryTransport: "ship", optionalConnection: null, trackingKind: "vessel" },
  ship_departure: { journeyType: "ship_departure", primaryTransport: "ship", optionalConnection: null, trackingKind: "vessel" },
  ship_to_flight: { journeyType: "ship_to_flight", primaryTransport: "ship", optionalConnection: "flight", trackingKind: "vessel" },
  flight_to_ship: { journeyType: "flight_to_ship", primaryTransport: "flight", optionalConnection: "ship", trackingKind: "flight" },
  road_transfer: { journeyType: "road_transfer", primaryTransport: null, optionalConnection: null, trackingKind: null },
};

/** Returns a decision for a coordinator-selected journey override. */
export function resolveJourneyOverride(journeyType: JourneyType): JourneyDecision {
  return JOURNEYS[journeyType];
}

export function resolveBookingJourney(from: JourneyEndpoint, to: JourneyEndpoint): JourneyDecision {
  if (from === "airport" && to === "port") return JOURNEYS.flight_to_ship;
  if (from === "port" && to === "airport") return JOURNEYS.ship_to_flight;
  if (from === "airport" && to === "local") return JOURNEYS.arrival_flight;
  if (from === "local" && to === "airport") return JOURNEYS.departure_flight;
  if (from === "port" && to === "local") return JOURNEYS.ship_arrival;
  if (from === "local" && to === "port") return JOURNEYS.ship_departure;
  return JOURNEYS.road_transfer;
}
