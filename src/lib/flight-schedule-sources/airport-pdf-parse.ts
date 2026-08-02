/**
 * Parser for the Malta International Airport "Fortnightly Arrivals and
 * Departures Schedule" PDF. It works on plain text lines so the same logic can
 * run in the browser (pdf.js text layer) or in a script (pdftotext -layout).
 *
 * Layout of the source document:
 *   ARRIVALS
 *   01-08-2026
 *   AIRLINE            TYPE  ORIGIN  FLIGHT NO  STA
 *   Ryanair            7M8   SUF     FR 1277    0:20
 *
 * In the DEPARTURES section the airport-code column is the destination even
 * though the document still prints the "ORIGIN" header.
 */

export const HOME_AIRPORT = "MLA";

export type ParsedScheduleFlight = {
  rowNumber: number;
  date: string;
  direction: "Arrival" | "Departure";
  airline: string;
  aircraftType: string;
  flightNumber: string;
  scheduledTime: string;
  origin: string;
  destination: string;
};

export type ParsedSchedule = {
  flights: ParsedScheduleFlight[];
  coverageStart: string | null;
  coverageEnd: string | null;
  skippedLines: number;
};

const DATE_LINE = /^(\d{2})-(\d{2})-(\d{4})$/;
const COVERAGE_LINE = /FROM\s+(\d{2}-\d{2}-\d{4}).*TO\s+(\d{2}-\d{2}-\d{4})/i;
const FLIGHT_LINE =
  /^(.{2,80}?)\s{2,}([A-Z0-9]{2,4})\s{2,}([A-Z]{3})\s{2,}([A-Z0-9]{1,3})\s?(\d{1,4}[A-Z]?)\s{2,}(\d{1,2}):(\d{2})$/;

function toIsoDate(day: string, month: string, year: string) {
  return `${year}-${month}-${day}`;
}

function padTime(hours: string, minutes: string) {
  return `${hours.padStart(2, "0")}:${minutes}`;
}

/** Parses the airport schedule out of already-extracted text lines. */
export function parseAirportScheduleLines(lines: string[]): ParsedSchedule {
  const flights: ParsedScheduleFlight[] = [];
  let direction: "Arrival" | "Departure" | null = null;
  let date: string | null = null;
  let coverageStart: string | null = null;
  let coverageEnd: string | null = null;
  let skippedLines = 0;

  for (const rawLine of lines) {
    const line = rawLine.replace(/\u00a0/g, " ").replace(/\s+$/, "");
    const trimmed = line.trim();
    if (!trimmed) continue;

    const coverage = COVERAGE_LINE.exec(trimmed);
    if (coverage) {
      const [startDay, startMonth, startYear] = coverage[1].split("-");
      const [endDay, endMonth, endYear] = coverage[2].split("-");
      coverageStart = toIsoDate(startDay, startMonth, startYear);
      coverageEnd = toIsoDate(endDay, endMonth, endYear);
      continue;
    }

    if (/^ARRIVALS$/i.test(trimmed)) {
      direction = "Arrival";
      continue;
    }
    if (/^DEPARTURES$/i.test(trimmed)) {
      direction = "Departure";
      continue;
    }

    const dateMatch = DATE_LINE.exec(trimmed);
    if (dateMatch) {
      date = toIsoDate(dateMatch[1], dateMatch[2], dateMatch[3]);
      continue;
    }

    if (/^AIRLINE\b/i.test(trimmed)) continue;
    if (/^\d+$/.test(trimmed)) continue; // page numbers

    const flight = FLIGHT_LINE.exec(line.replace(/^\s+/, ""));
    if (!flight) {
      if (/\d{1,2}:\d{2}$/.test(trimmed)) skippedLines += 1;
      continue;
    }
    if (!direction || !date) {
      skippedLines += 1;
      continue;
    }

    const [, airline, aircraftType, airportCode, carrier, number, hours, minutes] = flight;
    flights.push({
      rowNumber: flights.length + 1,
      date,
      direction,
      airline: airline.trim(),
      aircraftType: aircraftType.trim(),
      flightNumber: `${carrier}${number}`.toLocaleUpperCase(),
      scheduledTime: padTime(hours, minutes),
      origin: direction === "Arrival" ? airportCode : HOME_AIRPORT,
      destination: direction === "Arrival" ? HOME_AIRPORT : airportCode,
    });
  }

  return { flights, coverageStart, coverageEnd, skippedLines };
}
