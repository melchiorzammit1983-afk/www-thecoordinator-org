// Bulk-booking sheet template + parser for the Company/Agent portal's grid.
// Mirrors the coordinator's own bulk-trip template (src/lib/sheet-template.ts)
// — same xlsx library, same download/upload UX — with the booking grid's
// own column set instead of the trip-import one.
import * as XLSX from "xlsx";

export const BOOKING_SHEET_HEADERS = [
  "Passenger(s)", "Phone", "Email", "From", "To",
  "Pickup Date", "Pickup Time", "Room", "Flight", "Pax", "Notes",
] as const;

const SAMPLE_ROWS: string[][] = [
  ["John Smith, Maria Rossi", "+35699123456", "john@example.com", "Malta International Airport", "Hilton Malta", "2026-08-10", "14:30", "402", "FR1234", "2", "Late arrival, needs wheelchair"],
  ["Ali Hassan", "", "", "Valletta Cruise Port", "Corinthia Palace", "2026-08-11", "09:00", "", "", "1", ""],
];

const INSTRUCTIONS: string[][] = [
  ["How to use this template"],
  [""],
  ["1. Fill one row per booking (which may carry more than one passenger). Do NOT rename or reorder the header columns."],
  ["2. Passenger(s): one name, or several separated by commas (e.g. \"John Smith, Maria Rossi\")."],
  ["3. Pickup Date format: YYYY-MM-DD (e.g. 2026-08-10)."],
  ["4. Pickup Time format: 24h HH:MM (e.g. 14:30)."],
  ["5. Phone: include country code with + (e.g. +35699123456)."],
  ["6. Pax: total passenger count for this booking — leave it at or above the number of names you listed; extra seats beyond the named passengers show as \"Guest 2\", \"Guest 3\", etc."],
  ["7. Leave a cell blank if it doesn't apply (e.g. no flight, no room number)."],
  [""],
  ["When done, save the file and use the Upload button on the Bookings tab,"],
  ["or select your filled rows (including the header) and paste them directly into the grid."],
];

function buildWorkbook(): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();
  const rows: (string | number)[][] = [BOOKING_SHEET_HEADERS as unknown as string[], ...SAMPLE_ROWS];
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws["!cols"] = BOOKING_SHEET_HEADERS.map((h) => ({ wch: Math.max(14, h.length + 2) }));
  // Force the Phone column to Text so long numbers don't turn into
  // scientific notation ("3.9E+11") when copied/edited in Excel.
  const phoneColIdx = BOOKING_SHEET_HEADERS.indexOf("Phone");
  for (let r = 0; r <= SAMPLE_ROWS.length; r++) {
    const addr = XLSX.utils.encode_cell({ r, c: phoneColIdx });
    const cell = ws[addr];
    if (cell) { cell.t = "s"; cell.z = "@"; cell.v = String(cell.v ?? ""); }
  }
  XLSX.utils.book_append_sheet(wb, ws, "Bookings");
  const ins = XLSX.utils.aoa_to_sheet(INSTRUCTIONS);
  ins["!cols"] = [{ wch: 80 }];
  XLSX.utils.book_append_sheet(wb, ins, "Instructions");
  return wb;
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function downloadBookingExcelTemplate() {
  const wb = buildWorkbook();
  const buf = XLSX.write(wb, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
  triggerDownload(
    new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
    "booking-template.xlsx",
  );
}

export function downloadBookingCsvTemplate() {
  const rows = [BOOKING_SHEET_HEADERS as unknown as string[], ...SAMPLE_ROWS];
  const csv = rows
    .map((row) => row.map((c) => {
      const s = String(c ?? "");
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    }).join(","))
    .join("\n");
  triggerDownload(new Blob([csv], { type: "text/csv;charset=utf-8" }), "booking-template.csv");
}

// ---------- Upload parsing ----------

const HEADER_ALIASES: Record<string, string> = {
  name: "name", "guest name": "name", passenger: "name", "passenger name": "name",
  "passenger(s)": "name", passengers: "name", guests: "name", "guest names": "name",
  phone: "phone", "contact number": "phone", contact: "phone",
  email: "email", "guest email": "email",
  from: "from", "pickup address": "from", pickup: "from",
  to: "to", "drop-off address": "to", dropoff: "to", destination: "to", "delivery address": "to",
  "pickup date": "date", date: "date",
  "pickup time": "time", time: "time",
  room: "room", "room number": "room",
  flight: "flight", "flight number": "flight",
  pax: "pax", quantity: "pax", qty: "pax",
  notes: "notes", note: "notes",
};

function splitRow(line: string): string[] {
  if (line.includes("\t")) return line.split("\t");
  const out: string[] = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQ) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') inQ = false;
      else cur += c;
    } else if (c === '"') inQ = true;
    else if (c === ",") { out.push(cur); cur = ""; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

function normDate(s: string): string {
  const v = s.trim();
  if (!v) return "";
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(v);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, "0")}-${iso[3].padStart(2, "0")}`;
  const sl = /^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})$/.exec(v);
  if (sl) {
    let [, d, m, y] = sl;
    if (y.length === 2) y = `20${y}`;
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  // Excel serial date number
  const n = Number(v);
  if (Number.isFinite(n) && n > 20000 && n < 80000) {
    const d = XLSX.SSF?.parse_date_code?.(n);
    if (d) return `${d.y}-${String(d.m).padStart(2, "0")}-${String(d.d).padStart(2, "0")}`;
  }
  return "";
}

function normTime(s: string): string {
  const v = s.trim();
  if (!v) return "";
  const m = /^(\d{1,2}):(\d{2})(?::\d{2})?\s*(am|pm)?$/i.exec(v);
  if (m) {
    let h = parseInt(m[1], 10);
    const mm = m[2];
    const ap = m[3]?.toLowerCase();
    if (ap === "pm" && h < 12) h += 12;
    if (ap === "am" && h === 12) h = 0;
    return `${String(h).padStart(2, "0")}:${mm}`;
  }
  // Excel fractional-day time
  const n = Number(v);
  if (Number.isFinite(n) && n >= 0 && n < 1) {
    const total = Math.round(n * 24 * 60);
    const h = Math.floor(total / 60);
    const mm = total % 60;
    return `${String(h).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
  }
  return "";
}

export type ParsedBookingRow = {
  name: string; phone: string; email: string;
  from: string; to: string;
  pickupAt: string; // "YYYY-MM-DDTHH:mm" (datetime-local value) or ""
  room: string; flight: string; pax: string; notes: string;
};

/** Parses TSV/CSV text (with or without a recognisable header row) into booking rows. */
export function parseBookingSheet(raw: string): ParsedBookingRow[] {
  const lines = raw.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return [];
  const headerCells = splitRow(lines[0]).map((c) => c.trim().toLowerCase());
  const hasHeader = headerCells.some((c) => c in HEADER_ALIASES);
  const cols: Record<string, number> = {};
  if (hasHeader) {
    headerCells.forEach((c, i) => {
      const key = HEADER_ALIASES[c];
      if (key && !(key in cols)) cols[key] = i;
    });
  } else {
    ["name", "phone", "email", "from", "to", "date", "time", "room", "flight", "pax", "notes"]
      .forEach((k, i) => { cols[k] = i; });
  }
  const dataLines = hasHeader ? lines.slice(1) : lines;
  const rows: ParsedBookingRow[] = [];
  for (const line of dataLines) {
    const cells = splitRow(line).map((c) => c.trim());
    if (!cells.some((c) => c.length > 0)) continue;
    const get = (k: string) => (cols[k] != null ? cells[cols[k]] ?? "" : "");
    const date = normDate(get("date"));
    const time = normTime(get("time"));
    rows.push({
      name: get("name"), phone: get("phone"), email: get("email"),
      from: get("from"), to: get("to"),
      pickupAt: date && time ? `${date}T${time}` : "",
      room: get("room"), flight: get("flight"),
      pax: get("pax").replace(/[^0-9]/g, "") || "1",
      notes: get("notes"),
    });
  }
  return rows;
}

// ---------- Status export ----------
// "Where do my bookings/trips stand right now" — one row per booking,
// including the live job status/driver once the coordinator has accepted it.

const STATUS_HEADERS = [
  "Batch", "Passenger(s)", "Pax", "From", "To", "Pickup", "Status", "Price", "Job status", "Driver", "Vehicle",
] as const;

function statusRow(b: any, jobsById: Map<string, any>): (string | number)[] {
  const job = b.job_id ? jobsById.get(b.job_id) : null;
  const payload = b.payload ?? {};
  const names = Array.isArray(payload.pax_names) && payload.pax_names.length
    ? payload.pax_names.join(", ")
    : `${payload.name ?? ""} ${payload.surname ?? ""}`.trim();
  return [
    b.batch_id ? String(b.batch_id).slice(0, 8) : "",
    names,
    payload.pax_count ?? 1,
    payload.from_location ?? "",
    payload.to_location ?? "",
    payload.pickup_at ? new Date(payload.pickup_at).toLocaleString() : "",
    String(b.status ?? "").replace("_", " "),
    b.agreed_price != null ? `${b.currency ?? "EUR"} ${Number(b.agreed_price).toFixed(2)}` : "",
    job?.status ?? "",
    job?.drivers?.name ?? "",
    [job?.drivers?.car_make_model, job?.drivers?.plate].filter(Boolean).join(" "),
  ];
}

function buildStatusRows(bookings: any[], jobs: any[]): (string | number)[][] {
  const jobsById = new Map(jobs.map((j) => [j.id, j]));
  return [STATUS_HEADERS as unknown as string[], ...bookings.map((b) => statusRow(b, jobsById))];
}

export function downloadBookingsStatusExcel(bookings: any[], jobs: any[]) {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(buildStatusRows(bookings, jobs));
  ws["!cols"] = STATUS_HEADERS.map((h) => ({ wch: Math.max(12, h.length + 2) }));
  XLSX.utils.book_append_sheet(wb, ws, "Bookings status");
  const buf = XLSX.write(wb, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
  triggerDownload(
    new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
    `bookings-status-${new Date().toISOString().slice(0, 10)}.xlsx`,
  );
}

export function downloadBookingsStatusCsv(bookings: any[], jobs: any[]) {
  const rows = buildStatusRows(bookings, jobs);
  const csv = rows
    .map((row) => row.map((c) => {
      const s = String(c ?? "");
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    }).join(","))
    .join("\n");
  triggerDownload(new Blob([csv], { type: "text/csv;charset=utf-8" }), `bookings-status-${new Date().toISOString().slice(0, 10)}.csv`);
}
