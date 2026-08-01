import type { ImportSource, ImportSourceAdapter } from "@/lib/import-engine/types";
import type { FlightScheduleRecord } from "@/lib/flight-schedule-sources/types";

const supportedExtensions = new Set(["csv", "xls", "xlsx"]);
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

function normaliseCell(value: unknown) {
  return String(value ?? "").trim();
}

export const spreadsheetFlightScheduleAdapter: ImportSourceAdapter<FlightScheduleRecord> = {
  id: "spreadsheet",
  acceptedFileTypes: ".csv,.xls,.xlsx",
  supports: (file) => {
    const extension = file.name.split(".").pop()?.toLowerCase();
    return Boolean(extension && supportedExtensions.has(extension));
  },
  async read(file) {
    if (!this.supports(file)) throw new Error("Choose a CSV, XLS, or XLSX file.");

    const XLSX = await import("xlsx");
    const workbook = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: false });
    const sheetName = workbook.SheetNames[0];
    const sheet = sheetName ? workbook.Sheets[sheetName] : undefined;
    if (!sheet) throw new Error("The file does not contain a worksheet.");

    const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
      header: 1,
      blankrows: false,
      defval: "",
      raw: false,
    });
    const nonEmpty = matrix.filter(
      (row) => Array.isArray(row) && row.some((cell) => normaliseCell(cell)),
    );
    const [headerRow, ...dataRows] = nonEmpty;
    const columns = (headerRow ?? []).map(normaliseCell);
    if (!columns.length || !columns.some(Boolean))
      throw new Error("The first row must contain column names.");
    if (new Set(columns.map((column) => column.toLocaleLowerCase())).size !== columns.length)
      throw new Error("Column names must be unique.");

    return {
      fileName: file.name,
      columns,
      rows: dataRows.map((row) => columns.map((_, index) => normaliseCell(row[index]))),
    };
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
