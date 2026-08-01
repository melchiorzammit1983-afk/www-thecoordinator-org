import type { ImportField, ImportValidationResult } from "@/lib/import-engine/types";
import type { FlightScheduleRecord } from "@/lib/flight-schedule-sources/types";

export const flightScheduleImportFields: ImportField[] = [
  {
    key: "flightNumber",
    label: "Flight Number",
    required: true,
    aliases: ["flight", "flight no", "flight number"],
  },
  { key: "date", label: "Date", required: true, aliases: ["flight date", "scheduled date"] },
  {
    key: "direction",
    label: "Arrival / Departure",
    required: true,
    aliases: ["direction", "type", "arrival/departure"],
  },
  {
    key: "scheduledTime",
    label: "Scheduled Time",
    required: true,
    aliases: ["time", "scheduled time", "std", "sta"],
  },
  { key: "origin", label: "Origin", required: true, aliases: ["from", "origin airport"] },
  {
    key: "destination",
    label: "Destination",
    required: true,
    aliases: ["to", "destination airport"],
  },
  { key: "airline", label: "Airline", required: true, aliases: ["carrier", "operator"] },
];

const datePattern = /^\d{4}-\d{1,2}-\d{1,2}$|^\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}$/;
const timePattern = /^([01]?\d|2[0-3]):[0-5]\d(?:\s?(?:am|pm))?$/i;

export function validateFlightScheduleRecord(values: FlightScheduleRecord): ImportValidationResult {
  const errors = [] as ImportValidationResult["errors"];
  const warnings = [] as ImportValidationResult["warnings"];
  if (values.date && !datePattern.test(values.date))
    errors.push({ field: "date", message: "Date must be YYYY-MM-DD or DD/MM/YYYY." });
  if (values.direction && !/^(arrival|departure|arr|dep)$/i.test(values.direction))
    errors.push({ field: "direction", message: "Use Arrival or Departure." });
  if (values.scheduledTime && !timePattern.test(values.scheduledTime))
    errors.push({
      field: "scheduledTime",
      message: "Scheduled Time must be a valid time (for example 14:30).",
    });
  if (values.flightNumber && !/^[A-Z0-9]{2,4}\s?\d{1,4}[A-Z]?$/i.test(values.flightNumber))
    warnings.push({
      field: "flightNumber",
      message: "Flight number format is unusual; verify it before a future import.",
    });
  if (
    values.origin &&
    values.destination &&
    values.origin.trim().toLocaleLowerCase() === values.destination.trim().toLocaleLowerCase()
  )
    warnings.push({ field: "destination", message: "Origin and destination are the same." });
  return { errors, warnings };
}
