import type { ImportSource, ImportSourceAdapter } from "@/lib/import-engine/types";
import type { FlightScheduleRecord } from "@/lib/flight-schedule-sources/types";
import { spreadsheetFlightScheduleAdapter } from "@/lib/flight-schedule-sources/spreadsheet.adapter";
import { pdfFlightScheduleAdapter } from "@/lib/flight-schedule-sources/pdf.adapter";

const adapters = [pdfFlightScheduleAdapter, spreadsheetFlightScheduleAdapter];

export function flightScheduleSourceTypeFor(fileName: string): "pdf" | "spreadsheet" {
  return fileName.split(".").pop()?.toLowerCase() === "pdf" ? "pdf" : "spreadsheet";
}

function adapterFor(fileName: string) {
  return flightScheduleSourceTypeFor(fileName) === "pdf"
    ? pdfFlightScheduleAdapter
    : spreadsheetFlightScheduleAdapter;
}

/** Accepts either an airport schedule PDF or a spreadsheet export. */
export const flightScheduleSourceAdapter: ImportSourceAdapter<FlightScheduleRecord> = {
  id: "flight-schedule",
  acceptedFileTypes: ".pdf,.csv,.xls,.xlsx",
  supports: (file) => adapters.some((adapter) => adapter.supports(file)),
  read: (file) => adapterFor(file.name).read(file),
  normalize: (source: ImportSource, mappings: Record<string, string>) =>
    adapterFor(source.fileName).normalize(source, mappings),
};
