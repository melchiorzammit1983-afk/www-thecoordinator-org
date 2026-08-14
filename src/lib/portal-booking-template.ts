import {
  PORTAL_BOOKING_FIELDS,
  type NormalizedPortalBookingFields,
  type PortalBookingFieldKey,
} from "@/lib/portal-field-configuration";

const SAMPLE_VALUES: Record<PortalBookingFieldKey, string> = {
  pickup: "Malta International Airport",
  destination: "Valletta Waterfront",
  pickup_date: "2026-08-22",
  pickup_time: "09:40",
  passenger: "Example Passenger",
  contact_phone: "+356 9900 0000",
  operation_group: "",
  notes: "Optional booking notes",
};

export function portalTemplateColumns(fields: NormalizedPortalBookingFields) {
  return PORTAL_BOOKING_FIELDS
    .filter((field) => fields[field.key].mode !== "hidden")
    .map((field) => ({
      key: field.key,
      header: field.label,
      required: fields[field.key].mode === "required",
      sample: SAMPLE_VALUES[field.key],
    }));
}

function safeFileName(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "portal";
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function downloadPortalBookingTemplate(portalName: string, fields: NormalizedPortalBookingFields) {
  const XLSX = await import("xlsx");
  const columns = portalTemplateColumns(fields);
  const workbook = XLSX.utils.book_new();
  const bookings = XLSX.utils.aoa_to_sheet([
    columns.map((column) => column.header),
    columns.map((column) => column.sample),
  ]);
  bookings["!cols"] = columns.map((column) => ({ wch: Math.max(16, column.header.length + 4) }));
  if (columns.length) bookings["!autofilter"] = { ref: `A1:${XLSX.utils.encode_col(columns.length - 1)}1` };
  XLSX.utils.book_append_sheet(workbook, bookings, "Bookings");

  const instructions = XLSX.utils.aoa_to_sheet([
    [`${portalName || "Portal"} booking template`],
    ["Enter one booking per row. Do not rename or reorder the columns."],
    ["Pickup Date must use YYYY-MM-DD. Pickup Time must use 24-hour HH:MM."],
    ["Required fields must be completed. Optional fields may be left blank."],
    [],
    ["Column", "Requirement"],
    ...columns.map((column) => [column.header, column.required ? "Required" : "Optional"]),
  ]);
  instructions["!cols"] = [{ wch: 42 }, { wch: 18 }];
  XLSX.utils.book_append_sheet(workbook, instructions, "Instructions");

  const buffer = XLSX.write(workbook, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
  triggerDownload(
    new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
    `${safeFileName(portalName)}-booking-template.xlsx`,
  );
}
