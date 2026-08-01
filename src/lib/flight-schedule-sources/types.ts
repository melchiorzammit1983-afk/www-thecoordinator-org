import type { NormalizedImportRecord } from "@/lib/import-engine/types";

/**
 * The internal schedule shape shared by every source adapter. It is not a
 * database model: adapters produce it in memory for the import engine only.
 */
export type FlightScheduleRecord = NormalizedImportRecord & {
  date: string;
  direction: string;
  airline: string;
  flightNumber: string;
  scheduledTime: string;
  origin: string;
  destination: string;
  aircraftType: string;
};
