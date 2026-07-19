// Bulk-jobs sheet template + parser for pastes from Excel / Google Sheets.
import * as XLSX from "xlsx";
import type { ParsedTrip } from "@/lib/parse-trips";
import { normalizePhone, isMeaningfulName } from "@/lib/parse-trips";

export const SHEET_HEADERS = [
  "Pickup Date",
  "Pickup Time",
  "Pickup Address",
  "Delivery Address",
  "Customer Name",
  "Contact Number",
  "Transport Type",
  "Quantity",
] as const;

const SAMPLE_ROWS: string[][] = [
  ["2026-07-10", "08:30", "Hotel Cerviola, Marsaskala", "Malta International Airport", "John Smith", "+35699123456", "Airport Transfer", "2"],
  ["2026-07-10", "14:00", "Valletta Cruise Port", "Radisson Golden Sands", "Maria Rossi", "+393331234567", "Shuttle", "4"],
];

const INSTRUCTIONS: string[][] = [
  ["How to use this template"],
  [""],
  ["1. Fill one row per trip. Do NOT rename or reorder the header columns."],
  ["2. Pickup Date format: YYYY-MM-DD (e.g. 2026-07-10)."],
  ["3. Pickup Time format: 24h HH:MM (e.g. 08:30)."],
  ["4. Contact Number: include country code with + (e.g. +35699123456)."],
  ["5. Transport Type: free text (Airport Transfer, Shuttle, Cruise, VIP, etc.)."],
  ["6. Quantity: number of passengers."],
  ["7. Keep the Contact Number column formatted as Text (already preset) so long numbers don't turn into 3.9E+11 when copied."],
  [""],
  ["When done, select your filled rows (including the header) and copy them."],
  ["Paste into the coordinator app under Add trip → Paste bulk."],
  [""],
  ["Google Sheets users: File → Import → Upload this file, then Replace spreadsheet."],
];

function buildWorkbook(): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();
  const rows: (string | number)[][] = [SHEET_HEADERS as unknown as string[], ...SAMPLE_ROWS];
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws["!cols"] = SHEET_HEADERS.map((h) => ({ wch: Math.max(14, h.length + 2) }));
  // Force Contact Number column (F) to Text so long phone numbers don't
  // become scientific notation ("3.93331E+11") when copied.
  const phoneColIdx = SHEET_HEADERS.indexOf("Contact Number");
  if (phoneColIdx >= 0) {
    for (let r = 0; r <= SAMPLE_ROWS.length; r++) {
      const addr = XLSX.utils.encode_cell({ r, c: phoneColIdx });
      const cell = ws[addr];
      if (cell) { cell.t = "s"; cell.z = "@"; cell.v = String(cell.v ?? ""); }
    }
  }
  XLSX.utils.book_append_sheet(wb, ws, "Trips");
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

export function downloadExcelTemplate() {
  const wb = buildWorkbook();
  const buf = XLSX.write(wb, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
  triggerDownload(
    new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
    "crewchange-trips-template.xlsx",
  );
}

export function downloadGoogleSheetsTemplate() {
  // CSV imports cleanly into Google Sheets via File → Import → Upload.
  const rows = [SHEET_HEADERS as unknown as string[], ...SAMPLE_ROWS];
  const csv = rows
    .map((r) => r.map((c) => {
      const s = String(c ?? "");
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    }).join(","))
    .join("\n");
  triggerDownload(new Blob([csv], { type: "text/csv;charset=utf-8" }), "crewchange-trips-template.csv");
}

// Read an uploaded .xlsx/.xls/.csv file and return a tab-separated string
// that parseSheetPaste can consume directly. First non-empty sheet is used.
export async function fileToSheetTsv(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });
  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name];
    if (!ws) continue;
    const rows = XLSX.utils.sheet_to_json<any[]>(ws, { header: 1, blankrows: false, raw: false });
    if (!rows.length) continue;
    return rows
      .map((r) => (Array.isArray(r) ? r.map((c) => String(c ?? "")).join("\t") : ""))
      .filter((l) => l.trim().length > 0)
      .join("\n");
  }
  return "";
}

// ---------- Paste parser (Excel / Google Sheets rows) ----------

const HEADER_ALIASES: Record<string, string> = {
  "pickup date": "date",
  "date": "date",
  "pickup time": "time",
  "time": "time",
  "pickup address": "from",
  "pickup": "from",
  "from": "from",
  "delivery address": "to",
  "drop off": "to",
  "dropoff": "to",
  "drop-off address": "to",
  "to": "to",
  "customer name": "name",
  "passenger": "name",
  "passenger name": "name",
  "name": "name",
  "contact number": "phone",
  "phone": "phone",
  "contact": "phone",
  "transport type": "type",
  "type": "type",
  "service": "type",
  "quantity": "qty",
  "qty": "qty",
  "pax": "qty",
};

function splitRow(line: string): string[] {
  if (line.includes("\t")) return line.split("\t");
  // CSV split respecting quotes
  const out: string[] = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQ) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') inQ = false;
      else cur += c;
    } else {
      if (c === '"') inQ = true;
      else if (c === ",") { out.push(cur); cur = ""; }
      else cur += c;
    }
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
  // Excel serial number
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
  // Excel fractional day
  const n = Number(v);
  if (Number.isFinite(n) && n >= 0 && n < 1) {
    const total = Math.round(n * 24 * 60);
    const h = Math.floor(total / 60);
    const mm = total % 60;
    return `${String(h).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
  }
  return "";
}

export function looksLikeSheetPaste(raw: string): boolean {
  const first = raw.split(/\r?\n/).find((l) => l.trim());
  if (!first) return false;
  if (!/[\t,]/.test(first)) return false;
  const cells = splitRow(first).map((c) => c.trim());
  const lower = cells.map((c) => c.toLowerCase());
  if (lower.some((c) => c in HEADER_ALIASES)) return true;
  // Headerless template rows: at least 5 columns AND first cell parses as a date.
  if (cells.length >= 5 && normDate(cells[0])) return true;
  return false;
}

// Excel/Sheets can store long phone numbers as scientific notation on copy
// ("3.93331E+11"). Expand that back to a digit string before normalising.
function expandScientific(v: string): string {
  const s = v.trim();
  if (!/^-?\d+(\.\d+)?[eE][+-]?\d+$/.test(s)) return s;
  const n = Number(s);
  if (!Number.isFinite(n)) return s;
  return Math.round(n).toString();
}

export function parseSheetPaste(raw: string): ParsedTrip[] {
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
    // Assume canonical order.
    ["date", "time", "from", "to", "name", "phone", "type", "qty"].forEach((k, i) => { cols[k] = i; });
  }
  const dataLines = hasHeader ? lines.slice(1) : lines;
  const trips: ParsedTrip[] = [];
  for (const line of dataLines) {
    const cells = splitRow(line).map((c) => c.trim());
    if (!cells.some((c) => c.length > 0)) continue;
    const get = (k: string) => (cols[k] != null ? cells[cols[k]] ?? "" : "");
    const date = normDate(get("date"));
    const time = normTime(get("time"));
    const from = get("from");
    const to = get("to");
    const name = get("name");
    const phone = normalizePhone(expandScientific(get("phone")));
    const type = get("type");
    const qtyRaw = get("qty");
    const qty = Math.max(1, Math.min(50, parseInt(qtyRaw, 10) || (name ? 1 : 1)));

    const pax: string[] = [];
    // Support multiple names in one cell: "John Smith, Maria Rossi & Ali"
    const nameParts = name
      ? name.split(/\s*(?:,|;|\/| & | \+ | and )\s*/i).map((s) => s.trim()).filter(Boolean)
      : [];
    for (const part of nameParts) {
      if (isMeaningfulName(part)) pax.push(part);
    }
    // If quantity > names supplied, pad with generic labels so seat counts match.
    while (pax.length < qty) pax.push(pax.length === 0 ? "Guest" : `Guest ${pax.length + 1}`);

    const trip: ParsedTrip = {
      date, time,
      from_location: from,
      to_location: to,
      clientcompanyname: "",
      flightorship: type || "",
      from_flight: "",
      to_flight: "",
      pax,
      contact_phone: phone,
      errors: [],
    };
    if (!trip.date) trip.errors.push("Missing date");
    if (!trip.time) trip.errors.push("Missing time");
    if (!trip.from_location) trip.errors.push("Missing From");
    if (!trip.to_location) trip.errors.push("Missing To");
    trips.push(trip);
  }
  return trips;
}
