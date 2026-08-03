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

/** Converts provider-supplied categories only; free text is never examined. */
export function classifyProviderEndpoint(placeTypes?: readonly string[] | null): JourneyEndpoint {
  const types = new Set(placeTypes ?? []);
  if (types.has("airport")) return "airport";
  if (types.has("ferry_terminal") || types.has("marina") || types.has("port")) return "port";
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
