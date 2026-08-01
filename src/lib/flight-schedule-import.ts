import {
  customRule,
  dateRule,
  duplicateRule,
  enumRule,
  regexRule,
  requiredFieldRule,
  timeRule,
} from "@/lib/import-engine/rules";
import type { ImportField, ValidationRule } from "@/lib/import-engine/types";
import type { FlightScheduleRecord } from "@/lib/flight-schedule-sources/types";

export const flightScheduleImportFields: ImportField[] = [
  {
    key: "flightNumber",
    label: "Flight Number",
    required: true,
    aliases: ["flight", "flight no", "flight number"],
  },
  {
    key: "date",
    label: "Date",
    required: true,
    aliases: ["flight date", "scheduled date", "date of flight", "departure date"],
  },
  {
    key: "direction",
    label: "Arrival / Departure",
    required: true,
    aliases: ["direction", "arrival/departure", "arr dep", "movement"],
  },
  {
    key: "scheduledTime",
    label: "Scheduled Time",
    required: true,
    aliases: [
      "time",
      "scheduled time",
      "arrival time",
      "departure time",
      "std",
      "sta",
      "eta",
      "etd",
    ],
  },
  {
    key: "origin",
    label: "Origin",
    required: true,
    aliases: ["from", "origin airport", "from airport", "departure airport"],
  },
  {
    key: "destination",
    label: "Destination",
    required: true,
    aliases: ["to", "destination airport", "to airport", "arrival airport"],
  },
  {
    key: "airline",
    label: "Airline",
    required: true,
    aliases: ["carrier", "operator", "airline name", "carrier name"],
  },
];

export const flightScheduleValidationRules: ValidationRule<FlightScheduleRecord>[] = [
  requiredFieldRule("flightNumber", "Flight Number"),
  requiredFieldRule("date", "Date"),
  requiredFieldRule("direction", "Arrival / Departure"),
  requiredFieldRule("scheduledTime", "Scheduled Time"),
  requiredFieldRule("airline", "Airline"),
  requiredFieldRule("origin", "Origin"),
  requiredFieldRule("destination", "Destination"),
  regexRule("flightNumber", /^[A-Z0-9]{2,4}\s?\d{1,4}[A-Z]?$/i, {
    normalise: (value) => value.toLocaleUpperCase().replace(/\s+/g, " ").trim(),
    severity: "warning",
    message: "Flight number format is unusual; verify it before a future import.",
  }),
  dateRule("date"),
  timeRule("scheduledTime"),
  enumRule("direction", ["Arrival", "Departure"], {
    message: "Use Arrival or Departure.",
  }),
  regexRule("origin", /^[A-Z]{3}$/, {
    normalise: (value) => value.toLocaleUpperCase(),
    message: "Origin must be a three-letter IATA airport code.",
  }),
  regexRule("destination", /^[A-Z]{3}$/, {
    normalise: (value) => value.toLocaleUpperCase(),
    message: "Destination must be a three-letter IATA airport code.",
  }),
  duplicateRule(["flightNumber", "date", "direction", "scheduledTime"]),
  customRule(({ values }) => {
    if (
      values.origin &&
      values.destination &&
      values.origin.toLocaleLowerCase() === values.destination.toLocaleLowerCase()
    ) {
      return [
        {
          rule: "same-airport",
          field: "destination",
          severity: "warning",
          message: "Origin and destination are the same.",
        },
      ];
    }
    return [];
  }),
];
