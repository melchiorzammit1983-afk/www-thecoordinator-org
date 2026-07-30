// Bulk-jobs sheet template + parser for pastes from Excel / Google Sheets.
import * as XLSX from "xlsx";
import type { ParsedTrip } from "@/lib/parse-trips";
import { normalizePhone, isMeaningfulName } from "@/lib/parse-trips";

export const SHEET_HEADERS = [
  "Pickup Date",
  "Pickup Time",
  "Passenger Name",
  "Phone Number",
  "Email",
  "Pickup Address",
  "From Flight",
  "From Vessel",
  "Delivery Address",
  "To Flight",
  "To Vessel",
  "Pax Count",
  "Notes",
  "Vehicle",
  "Immigration Needed",
  "Transport Type",
  "Operation Name",
] as const;

const SAMPLE_ROWS: string[][] = [
  // Primary row for a 2-passenger trip — the second passenger is added via
  // the stacked continuation row right below (name only, everything else blank).
  ["2026-07-10", "08:30", "John Smith", "+35699123456", "john@example.com", "Hotel Cerviola, Marsaskala", "", "", "Malta International Airport", "KM101", "", "", "", "Sedan", "Yes", "Airport Transfer", "Everest Crew Change"],
  ["", "", "Maria Rossi", "", "", "", "", "", "", "", "", "", "", "", "", "", ""],
  // Vessel example + the Freeport exception: Immigration Needed is "Yes" but
  // the pickup is the Freeport, so no immigration stop gets added.
  ["2026-07-11", "14:00", "Ali Hassan", "+393331234567", "", "Malta Freeport", "", "Asso Venticinque", "Radisson Golden Sands", "", "", "1", "Guest uses a wheelchair", "Minivan", "Yes", "Shuttle", "Everest Crew Change"],
];

const INSTRUCTIONS: string[][] = [
  ["How to use this template"],
  [""],
  ["1. Fill one row per trip. Do NOT rename or reorder the header columns."],
  ["2. Multiple passengers on the same trip: put the first passenger's row with all the trip's details filled in, then add one row per extra passenger directly underneath with ONLY the Passenger Name filled in (everything else on that row left blank). Pax Count adjusts automatically."],
  ["3. Pickup Date format: YYYY-MM-DD (e.g. 2026-07-10)."],
  ["4. Pickup Time format: 24h HH:MM (e.g. 08:30)."],
  ["5. Phone Number: include country code with + (e.g. +35699123456)."],
  ["6. From Flight / To Flight: flight code (e.g. KM101). From Vessel / To Vessel: vessel name (e.g. Asso Venticinque). Use whichever applies per side and leave the rest blank."],
  ["7. Pax Count: leave blank to auto-count from the passenger rows, or set a number to add unnamed extra seats."],
  ["8. Vehicle: e.g. Sedan, Minivan, Coach. Leave blank if not decided yet."],
  ["9. Immigration Needed: Yes or No. When Yes, an \"Immigration Office, Valletta\" stop is added to the trip automatically — unless Pickup Address is the Freeport, which never needs it."],
  ["10. Transport Type: free text (Airport Transfer, Shuttle, Cruise, VIP, etc.)."],
  ["11. Notes: any other detail the driver/coordinator should know (optional)."],
  ["12. Operation Name (optional): group separate trips (separate primary rows) under the same operation label."],
  ["13. Keep the Phone Number column formatted as Text (already preset) so long numbers don't turn into 3.9E+11 when copied."],
  ["14. Leave any box empty if you don't have that detail — don't guess."],
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
  // Force Phone Number column to Text so long phone numbers don't
  // become scientific notation ("3.93331E+11") when copied.
  const phoneColIdx = SHEET_HEADERS.indexOf("Phone Number");
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
    "thecoordinator-trips-template.xlsx",
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
  triggerDownload(new Blob([csv], { type: "text/csv;charset=utf-8" }), "thecoordinator-trips-template.csv");
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
  "customer name": "name",
  "passenger": "name",
  "passenger name": "name",
  "passenger(s)": "name",
  "name": "name",
  "contact number": "phone",
  "phone number": "phone",
  "phone": "phone",
  "contact": "phone",
  "email": "email",
  "email address": "email",
  "pickup address": "from",
  "pickup": "from",
  "from": "from",
  // Flight and vessel are separate columns per side in the template, but
  // both collapse into the same underlying from_flight/to_flight value —
  // a trip only ever has one "from" tracking code either way.
  "from flight": "from_flight",
  "flight/vessel (pickup)": "from_flight",
  "flight (pickup)": "from_flight",
  "flight pickup": "from_flight",
  "pickup flight": "from_flight",
  "from vessel": "from_vessel",
  "vessel (pickup)": "from_vessel",
  "vessel pickup": "from_vessel",
  "pickup vessel": "from_vessel",
  "delivery address": "to",
  "drop off": "to",
  "dropoff": "to",
  "drop-off address": "to",
  "to": "to",
  "to flight": "to_flight",
  "flight/vessel (drop-off)": "to_flight",
  "flight (drop-off)": "to_flight",
  "flight (dropoff)": "to_flight",
  "flight dropoff": "to_flight",
  "flight drop-off": "to_flight",
  "dropoff flight": "to_flight",
  "to vessel": "to_vessel",
  "vessel (drop-off)": "to_vessel",
  "vessel (dropoff)": "to_vessel",
  "vessel dropoff": "to_vessel",
  "dropoff vessel": "to_vessel",
  "pax count": "qty",
  "quantity": "qty",
  "qty": "qty",
  "pax": "qty",
  "notes": "notes",
  "note": "notes",
  "comments": "notes",
  "comment": "notes",
  "vehicle": "vehicle",
  "immigration needed": "immigration",
  "immigration": "immigration",
  "transport type": "type",
  "type": "type",
  "service": "type",
  "operation name": "operation_name",
  "operation": "operation_name",
  "job": "operation_name",
  "job name": "operation_name",
  "job title": "operation_name",
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
    // Assume canonical order (matches SHEET_HEADERS).
    ["date", "time", "name", "phone", "email", "from", "from_flight", "from_vessel", "to", "to_flight", "to_vessel", "qty", "notes", "vehicle", "immigration", "type", "operation_name"]
      .forEach((k, i) => { cols[k] = i; });
  }
  const dataLines = hasHeader ? lines.slice(1) : lines;
  const trips: ParsedTrip[] = [];

  // A trip's Pax Count is only known for certain once every stacked
  // continuation row underneath its primary row has been seen — so track
  // the explicit count (0 = none given) alongside the trip being built and
  // pad with "Guest N" only when the trip is finalized (a new primary row
  // starts, or we reach the end of the data).
  let current: ParsedTrip | null = null;
  let currentExplicitQty = 0;
  const finalize = () => {
    if (!current) return;
    const trip = current;
    const qty = Math.max(currentExplicitQty, trip.pax.length, 1);
    while (trip.pax.length < qty) {
      trip.pax.push(trip.pax.length === 0 ? "Guest" : `Guest ${trip.pax.length + 1}`);
    }
    if (!trip.date) trip.errors.push("Missing date");
    if (!trip.time) trip.errors.push("Missing time");
    if (!trip.from_location) trip.errors.push("Missing From");
    if (!trip.to_location) trip.errors.push("Missing To");
    trips.push(trip);
    current = null;
    currentExplicitQty = 0;
  };

  for (const line of dataLines) {
    const cells = splitRow(line).map((c) => c.trim());
    if (!cells.some((c) => c.length > 0)) continue;
    const get = (k: string) => (cols[k] != null ? cells[cols[k]] ?? "" : "");
    const name = get("name");
    const nameParts = name
      ? name.split(/\s*(?:,|;|\/| & | \+ | and )\s*/i).map((s) => s.trim()).filter(Boolean)
      : [];

    const rawDate = get("date").trim();
    const rawTime = get("time").trim();
    const from = get("from").trim();
    const to = get("to").trim();
    // A row with none of its own date/time/from/to is another passenger for
    // the trip started by the row above it, not a new trip.
    if (current && !rawDate && !rawTime && !from && !to) {
      for (const part of nameParts) {
        if (isMeaningfulName(part)) current.pax.push(part);
      }
      continue;
    }

    finalize();

    const date = normDate(rawDate);
    const time = normTime(rawTime);
    const phone = normalizePhone(expandScientific(get("phone")));
    const email = get("email").trim();
    const type = get("type").trim();
    const qtyRaw = get("qty").trim();
    currentExplicitQty = Math.max(0, Math.min(50, parseInt(qtyRaw, 10) || 0));
    const operation_name = get("operation_name").trim();
    // Flight and vessel are separate template columns per side but collapse
    // into the same from_flight/to_flight value — flight wins if both filled.
    const from_flight = get("from_flight").trim() || get("from_vessel").trim();
    const to_flight = get("to_flight").trim() || get("to_vessel").trim();
    const vehicle = get("vehicle").trim();
    const notes = get("notes").trim();
    const immigration_needed = /^y(es)?$/i.test(get("immigration").trim());

    const pax: string[] = [];
    for (const part of nameParts) {
      if (isMeaningfulName(part)) pax.push(part);
    }

    current = {
      date, time,
      from_location: from,
      to_location: to,
      clientcompanyname: "",
      operation_name,
      flightorship: type || from_flight || to_flight || "",
      from_flight,
      to_flight,
      vehicle,
      notes,
      email,
      immigration_needed,
      pax,
      contact_phone: phone,
      errors: [],
    };
  }
  finalize();
  return trips;
}
