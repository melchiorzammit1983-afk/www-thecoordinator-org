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

const ROAD: JourneyDecision = { journeyType: "road_transfer", primaryTransport: null, optionalConnection: null, trackingKind: null };

export function resolveBookingJourney(from: JourneyEndpoint, to: JourneyEndpoint): JourneyDecision {
  if (from === "airport" && to === "port") return { journeyType: "flight_to_ship", primaryTransport: "flight", optionalConnection: "ship", trackingKind: "flight" };
  if (from === "port" && to === "airport") return { journeyType: "ship_to_flight", primaryTransport: "ship", optionalConnection: "flight", trackingKind: "vessel" };
  if (from === "airport" && to === "local") return { journeyType: "arrival_flight", primaryTransport: "flight", optionalConnection: null, trackingKind: "flight" };
  if (from === "local" && to === "airport") return { journeyType: "departure_flight", primaryTransport: "flight", optionalConnection: null, trackingKind: "flight" };
  if (from === "port" && to === "local") return { journeyType: "ship_arrival", primaryTransport: "ship", optionalConnection: null, trackingKind: "vessel" };
  if (from === "local" && to === "port") return { journeyType: "ship_departure", primaryTransport: "ship", optionalConnection: null, trackingKind: "vessel" };
  return ROAD;
}
