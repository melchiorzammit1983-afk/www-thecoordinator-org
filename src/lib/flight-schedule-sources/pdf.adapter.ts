import type { ImportSource, ImportSourceAdapter } from "@/lib/import-engine/types";
import type { FlightScheduleRecord } from "@/lib/flight-schedule-sources/types";
import { parseAirportScheduleLines } from "@/lib/flight-schedule-sources/airport-pdf-parse";

const recordFields = [
  "date",
  "direction",
  "airline",
  "flightNumber",
  "scheduledTime",
  "origin",
  "destination",
  "aircraftType",
] as const;

export const pdfScheduleColumns = [
  "Date",
  "Direction",
  "Airline",
  "Flight No",
  "Scheduled Time",
  "Origin",
  "Destination",
  "Aircraft Type",
];

/** Reads the pdf.js text layer back into visually ordered text lines. */
async function readPdfLines(file: File) {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = (
    await import("pdfjs-dist/build/pdf.worker.min.mjs?url")
  ).default;

  const document = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
  const lines: string[] = [];
  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const content = await page.getTextContent();
    const byRow = new Map<number, Array<{ x: number; text: string }>>();
    for (const item of content.items) {
      if (!("str" in item) || !item.str.trim()) continue;
      const y = Math.round(item.transform[5]);
      const row = byRow.get(y) ?? [];
      row.push({ x: item.transform[4], text: item.str.trim() });
      byRow.set(y, row);
    }
    const orderedRows = [...byRow.entries()].sort(([a], [b]) => b - a);
    for (const [, cells] of orderedRows) {
      lines.push(
        cells
          .sort((a, b) => a.x - b.x)
          .map((cell) => cell.text)
          .join("  "),
      );
    }
    page.cleanup();
  }
  await document.cleanup();
  return lines;
}

/**
 * Turns an airport fortnightly schedule PDF into the same tabular shape the
 * spreadsheet adapter produces, so the shared import workflow can preview,
 * validate and confirm it unchanged.
 */
export const pdfFlightScheduleAdapter: ImportSourceAdapter<FlightScheduleRecord> = {
  id: "pdf",
  acceptedFileTypes: ".pdf",
  supports: (file) => file.name.split(".").pop()?.toLowerCase() === "pdf",
  async read(file) {
    if (!this.supports(file)) throw new Error("Choose a PDF file.");
    const parsed = parseAirportScheduleLines(await readPdfLines(file));
    if (!parsed.flights.length)
      throw new Error(
        "No flights were found in this PDF. It must be an airport arrivals and departures schedule.",
      );
    return {
      fileName: file.name,
      columns: pdfScheduleColumns,
      rows: parsed.flights.map((flight) => [
        flight.date,
        flight.direction,
        flight.airline,
        flight.flightNumber,
        flight.scheduledTime,
        flight.origin,
        flight.destination,
        flight.aircraftType,
      ]),
    } satisfies ImportSource;
  },
  normalize(source: ImportSource, mappings: Record<string, string>) {
    return source.rows.map((row, index) => {
      const byColumn = Object.fromEntries(
        source.columns.map((column, columnIndex) => [column, row[columnIndex] ?? ""]),
      );
      const values = Object.fromEntries(
        recordFields.map((field) => [field, byColumn[mappings[field]] ?? ""]),
      ) as Omit<FlightScheduleRecord, "source">;
      return {
        ...values,
        source: { adapterId: this.id, fileName: source.fileName, rowNumber: index + 2 },
      };
    });
  },
};
