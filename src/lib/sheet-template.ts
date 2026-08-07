// Bulk-jobs sheet template + parser for pastes from Excel / Google Sheets.
// This is THE trip template for the whole app: coordinator "Add trip → Paste
// bulk", the company/agent portal bulk grid, and HR bulk booking all download
// and parse this exact layout. Column S ("Message to Copy") is a live formula
// that rebuilds the app's "Label - value" message for that row, so a user can
// copy one cell into WhatsApp/email and paste it straight back into any bulk
// box (see labeled-message-parser.ts).
import * as XLSX from "xlsx";
import type { ParsedTrip } from "@/lib/parse-trips";
import { normalizePhone, isMeaningfulName } from "@/lib/parse-trips";

export const SHEET_HEADERS = [
  "Client/Company",
  "Journey type",
  "Pickup Date (DD/MM/YYYY)",
  "Pickup Time (24h HH:MM)",

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
  "Operation Name",
  "Message to Copy",
] as const;

export const MESSAGE_COLUMN_INDEX = SHEET_HEADERS.indexOf("Message to Copy");

// Column letters follow SHEET_HEADERS order (A..S).
const COL = {
  company: "A", journey: "B", date: "C", time: "D", name: "E", phone: "F", email: "G",
  from: "H", fromFlight: "I", fromVessel: "J", to: "K", toFlight: "L", toVessel: "M",
  qty: "N", notes: "O", vehicle: "P", immigration: "Q", operation: "R",
} as const;

/** Live formula for the "Message to Copy" cell on a given spreadsheet row. */
export function messageFormula(rowNumber: number): string {
  const r = rowNumber;
  const parts: string[] = [
    `"Operation Name - "`, `${COL.operation}${r}`, `CHAR(10)`,
    `"date - "`, `${COL.date}${r}`, `CHAR(10)`,
    `"time - "`, `${COL.time}${r}`, `CHAR(10)`,
    `"Journey type - "`, `${COL.journey}${r}`, `CHAR(10)`,
    `"Company - "`, `${COL.company}${r}`, `CHAR(10)`,
    `"Passenger name and phone number - "`, `CHAR(10)`, `${COL.name}${r}`, `CHAR(10)`,
    `"Phone Number - "`, `CHAR(10)`, `${COL.phone}${r}`, `CHAR(10)`,
    `"email - "`, `${COL.email}${r}`, `CHAR(10)`,
    `"pick up address - "`, `${COL.from}${r}`, `CHAR(10)`,
    `"Flight from - "`, `${COL.fromFlight}${r}`, `CHAR(10)`,
    `"vessel from - "`, `${COL.fromVessel}${r}`, `CHAR(10)`,
    `"delivery address - "`, `${COL.to}${r}`, `CHAR(10)`,
    `"to Flight - "`, `${COL.toFlight}${r}`, `CHAR(10)`,
    `"to Vessel - "`, `${COL.toVessel}${r}`, `CHAR(10)`,
    `"pax count - "`, `${COL.qty}${r}`, `CHAR(10)`,
    `"vehicle - "`, `${COL.vehicle}${r}`, `CHAR(10)`,
    `"immigration needed - "`, `${COL.immigration}${r}`, `CHAR(10)`,
    `"Notes - "`, `${COL.notes}${r}`,
  ];
  return `CONCATENATE(${parts.join(",")})`;
}

const SAMPLE_ROWS: string[][] = [
  [
    "EXAMPLE - Valletta Tours", "road transfer", "08/11/2026", "08:45",
    "Maria Borg", "+35677000001", "maria@example.com",
    "Hilton Malta", "", "", "Valletta Cruise Port", "", "",
    "1", "Simple hotel-to-port transfer", "Mercedes V-Class", "no", "Example Road Transfer",
  ],
  [
    "EXAMPLE - Blue Sea Ltd", "arrival flight + connecting ship", "08/11/2026", "10:15",
    "David Smith\nAnna Smith", "+35677000002\n+35677000003", "david@example.com",
    "Malta International Airport", "KM613", "", "Valletta Cruise Port", "", "MSC World Europa",
    "2", "Meet at arrivals, assist to ship check-in", "Minibus", "yes", "Example Flight to Ship",
  ],
  [
    "EXAMPLE - Oceanic Crewing", "ship arrival + onward flight", "08/12/2026", "06:30",
    "Ali Hassan", "+393331234567", "",
    "Malta Freeport", "", "Asso Venticinque", "Malta International Airport", "KM101", "",
    "1", "Crew change, 2 large bags", "Sedan", "yes", "Example Ship to Flight",
  ],
];

const BLANK_ROWS = 200;

const INSTRUCTIONS: string[][] = [
  ["How to use this template"],
  [""],
  ["1. Fill one row per trip. Do NOT rename or reorder the header columns."],
  ["2. Multiple passengers on the same trip: put each passenger on its own line INSIDE the Passenger Name cell (Alt+Enter in Excel, Ctrl+Enter in Google Sheets) and their phone on the matching line of the Phone Number cell. You can also add extra rows underneath with only the Passenger Name filled in."],
  ["3. Pickup Date format: DD/MM/YYYY (e.g. 08/11/2026). YYYY-MM-DD also works."],
  ["4. Pickup Time format: 24h HH:MM (e.g. 08:45)."],
  ["5. Phone Number: include country code with + (e.g. +35677000001)."],
  ["6. Journey type is informational only — the app works out the real journey type from the addresses, flights and vessels you enter."],
  ["7. From Flight / To Flight: flight code (e.g. KM613). From Vessel / To Vessel: vessel name (e.g. MSC World Europa). Use whichever applies per side and leave the rest blank."],
  ["8. Pax Count: leave blank to auto-count from the passenger lines, or set a number to add unnamed extra seats."],
  ["9. Vehicle: e.g. Sedan, Minivan, Coach. Leave blank if not decided yet."],
  ["10. Immigration Needed: Yes or No. When Yes, an \"Immigration Office, Valletta\" stop is added automatically — unless Pickup Address is the Freeport, which never needs it."],
  ["11. Operation Name (optional): group separate trips under the same operation label."],
  ["12. Notes: any other detail the driver/coordinator should know (optional)."],
  ["13. Leave any box empty if you don't have that detail — don't guess. Incomplete rows are flagged for you after pasting."],
  [""],
  ["Message to Copy (column S)"],
  ["This column builds itself from the row as you type. Copy the cell and send it by WhatsApp/email — pasting that message back into any bulk paste box in the app recreates the same trip."],
  [""],
  ["When done, select your filled rows (including the header) and copy them."],
  ["Paste into the coordinator app under Add trip → Paste bulk, or into the bulk box in your portal."],
  [""],
  ["Google Sheets users: File → Import → Upload this file, then Replace spreadsheet."],
];

function buildWorkbook(): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();
  const rows: string[][] = [
    SHEET_HEADERS as unknown as string[],
    ...SAMPLE_ROWS,
    ...Array.from({ length: BLANK_ROWS }, () => SHEET_HEADERS.map(() => "")),
  ];
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws["!cols"] = SHEET_HEADERS.map((h) =>
    h === "Message to Copy" ? { wch: 46 } : { wch: Math.max(16, h.length + 4) },
  );
  // Roomy header row + readable data rows (stacked passenger cells wrap).
  ws["!rows"] = [{ hpt: 30 }, ...Array.from({ length: rows.length - 1 }, () => ({ hpt: 18 }))];
  // Freeze the header row so it stays visible while filling long lists.
  ws["!freeze"] = { xSplit: "0", ySplit: "1", topLeftCell: "A2", activePane: "bottomLeft", state: "frozen" } as any;
  ws["!autofilter"] = { ref: `A1:${XLSX.utils.encode_col(SHEET_HEADERS.length - 1)}1` };

  const headerStyle = {
    font: { bold: true, sz: 11, color: { rgb: "FFFFFFFF" } },
    fill: { patternType: "solid", fgColor: { rgb: "FF1F3A5F" } },
    alignment: { horizontal: "center", vertical: "center", wrapText: true },
    border: {
      bottom: { style: "thin", color: { rgb: "FF11243B" } },
      right: { style: "thin", color: { rgb: "FF11243B" } },
    },
  };
  for (let c = 0; c < SHEET_HEADERS.length; c++) {
    const cell = ws[XLSX.utils.encode_cell({ r: 0, c })];
    if (cell) (cell as any).s = headerStyle;
  }

  const textCols = ["Phone Number", "Pickup Date (DD/MM/YYYY)", "Pickup Time (24h HH:MM)", "Pax Count"]
    .map((h) => SHEET_HEADERS.indexOf(h as (typeof SHEET_HEADERS)[number]))
    .filter((i) => i >= 0);

  for (let r = 1; r < rows.length; r++) {
    // Force these to Text so Excel can't reformat DD/MM/YYYY dates into its own
    // locale order, turn HH:MM into a time serial, or make phones 3.9E+11.
    for (const c of textCols) {
      const addr = XLSX.utils.encode_cell({ r, c });
      const cell = ws[addr];
      if (cell) {
        cell.t = "s";
        cell.z = "@";
        cell.v = String(cell.v ?? "");
        (cell as any).s = { alignment: { horizontal: "left", vertical: "top" }, numFmt: "@" };
      }
    }
    // Wrap long free-text cells (names, addresses, notes) instead of clipping.
    for (let c = 0; c < SHEET_HEADERS.length; c++) {
      const cell = ws[XLSX.utils.encode_cell({ r, c })];
      if (cell && !(cell as any).s) {
        (cell as any).s = { alignment: { vertical: "top", wrapText: true } };
      }
    }
    // Live "Message to Copy" formula on every sample + blank row.
    const msgAddr = XLSX.utils.encode_cell({ r, c: MESSAGE_COLUMN_INDEX });
    ws[msgAddr] = {
      t: "s",
      f: messageFormula(r + 1),
      v: "",
      s: { alignment: { vertical: "top", wrapText: true } },
    } as XLSX.CellObject;
  }
  ws["!ref"] = XLSX.utils.encode_range({
    s: { r: 0, c: 0 },
    e: { r: rows.length - 1, c: SHEET_HEADERS.length - 1 },
  });
  XLSX.utils.book_append_sheet(wb, ws, "Trips");
  const ins = XLSX.utils.aoa_to_sheet(INSTRUCTIONS);
  ins["!cols"] = [{ wch: 100 }];
  const insTitle = ins["A1"];
  if (insTitle) (insTitle as any).s = { font: { bold: true, sz: 14, color: { rgb: "FF1F3A5F" } } };
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

function csvCell(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function downloadGoogleSheetsTemplate() {
  // CSV imports cleanly into Google Sheets via File → Import → Upload, and
  // the "=CONCATENATE(...)" text stays a live formula after import.
  const dataRows = [
    ...SAMPLE_ROWS,
    ...Array.from({ length: BLANK_ROWS }, () => SHEET_HEADERS.map(() => "")),
  ];
  const lines = [
    (SHEET_HEADERS as unknown as string[]).map(csvCell).join(","),
    ...dataRows.map((r, i) =>
      [...r.map(csvCell), csvCell(`=${messageFormula(i + 2)}`)].join(","),
    ),
  ];
  triggerDownload(
    new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" }),
    "thecoordinator-trips-template.csv",
  );
}

// Read an uploaded .xlsx/.xls/.csv file and return a tab-separated string that
// parseSheetPaste can consume directly. Cells keep their embedded newlines
// (stacked passenger/phone cells) by being quoted, CSV-style.
export async function fileToSheetTsv(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });
  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name];
    if (!ws) continue;
    const rows = XLSX.utils.sheet_to_json<any[]>(ws, { header: 1, blankrows: false, raw: false });
    if (!rows.length) continue;
    const out = rows
      .filter((r) => Array.isArray(r) && r.some((c) => String(c ?? "").trim().length > 0))
      .map((r) =>
        r
          .map((c) => {
            const s = String(c ?? "");
            return /["\t\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
          })
          .join("\t"),
      )
      .join("\n");
    if (out.trim()) return out;
  }
  return "";
}

// ---------- Paste parser (Excel / Google Sheets rows) ----------

const HEADER_ALIASES: Record<string, string> = {
  "client/company": "company",
  "client / company": "company",
  company: "company",
  client: "company",
  // Informational only — journey type is always derived from the addresses.
  "journey type": "journey_type",
  "journey": "journey_type",
  "pickup date": "date",
  "pickup date (dd/mm/yyyy)": "date",
  "date (dd/mm/yyyy)": "date",
  "date": "date",
  "pickup time": "time",
  "pickup time (24h hh:mm)": "time",
  "time (24h hh:mm)": "time",
  "time": "time",

  "customer name": "name",
  "passenger": "name",
  "passenger name": "name",
  "passenger names": "name",
  "passenger(s)": "name",
  "name": "name",
  "contact number": "phone",
  "phone number": "phone",
  "phone numbers": "phone",
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
  "from vassel": "from_vessel",
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
  "to vassel": "to_vessel",
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
  // Ignored on import — it is generated FROM the other columns.
  "message to copy": "message",
  "message": "message",
};

// Canonical headerless order — must mirror SHEET_HEADERS.
const HEADERLESS_ORDER = [
  "company", "journey_type", "date", "time", "name", "phone", "email",
  "from", "from_flight", "from_vessel", "to", "to_flight", "to_vessel",
  "qty", "notes", "vehicle", "immigration", "operation_name", "message",
];

/**
 * Split a paste into records, respecting quoted cells that contain newlines
 * (a stacked "Passenger Name" cell is one cell, not several rows).
 */
function splitRecords(text: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (inQ && text[i + 1] === '"') { cur += '""'; i++; continue; }
      inQ = !inQ;
      cur += c;
      continue;
    }
    if (!inQ && (c === "\n" || c === "\r")) {
      if (c === "\r" && text[i + 1] === "\n") i++;
      out.push(cur);
      cur = "";
      continue;
    }
    cur += c;
  }
  if (cur) out.push(cur);
  return out.filter((l) => l.trim().length > 0);
}

function splitRow(line: string, delimiter: "\t" | ","): string[] {
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
      else if (c === delimiter) { out.push(cur); cur = ""; }
      else cur += c;
    }
  }
  out.push(cur);
  return out;
}

function detectDelimiter(text: string): "\t" | "," {
  return text.includes("\t") ? "\t" : ",";
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
  const records = splitRecords(raw);
  const first = records[0];
  if (!first) return false;
  const delimiter = detectDelimiter(raw);
  if (!first.includes(delimiter)) return false;
  const cells = splitRow(first, delimiter).map((c) => c.trim());
  const lower = cells.map((c) => c.toLowerCase());
  if (lower.some((c) => c in HEADER_ALIASES)) return true;
  // Headerless template rows: at least 5 columns AND a parseable date in the
  // first three cells (Client/Company and Journey type come before the date).
  if (cells.length >= 5 && cells.slice(0, 3).some((c) => normDate(c))) return true;
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

function splitCellLines(cell: string): string[] {
  return cell
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function splitNameCell(cell: string): string[] {
  // Newlines first (the template's stacked cell), then inline separators.
  const lines = splitCellLines(cell);
  const parts: string[] = [];
  for (const line of lines.length ? lines : [cell]) {
    line
      .split(/\s*(?:,|;|\/| & | \+ | and )\s*/i)
      .map((s) => s.trim())
      .filter(Boolean)
      .forEach((p) => parts.push(p));
  }
  return parts;
}

export function parseSheetPaste(raw: string): ParsedTrip[] {
  const records = splitRecords(raw);
  if (records.length === 0) return [];
  const delimiter = detectDelimiter(raw);
  const headerCells = splitRow(records[0], delimiter).map((c) => c.trim().toLowerCase());
  const hasHeader = headerCells.some((c) => c in HEADER_ALIASES);
  const cols: Record<string, number> = {};
  if (hasHeader) {
    headerCells.forEach((c, i) => {
      const key = HEADER_ALIASES[c];
      if (key && !(key in cols)) cols[key] = i;
    });
  } else {
    HEADERLESS_ORDER.forEach((k, i) => { cols[k] = i; });
  }
  const dataLines = hasHeader ? records.slice(1) : records;
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
    if (trip.pax_phones) {
      while (trip.pax_phones.length < trip.pax.length) trip.pax_phones.push("");
      trip.pax_phones.length = trip.pax.length;
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
    const cells = splitRow(line, delimiter).map((c) => c.trim());
    if (!cells.some((c) => c.length > 0)) continue;
    const get = (k: string) => (cols[k] != null ? cells[cols[k]] ?? "" : "");
    const nameParts = splitNameCell(get("name")).filter((p) => isMeaningfulName(p));
    const phoneParts = splitCellLines(get("phone")).map((p) => normalizePhone(expandScientific(p)));

    const rawDate = get("date").trim();
    const rawTime = get("time").trim();
    const from = get("from").trim();
    const to = get("to").trim();
    // A row with none of its own date/time/from/to is another passenger for
    // the trip started by the row above it, not a new trip.
    if (current && !rawDate && !rawTime && !from && !to) {
      nameParts.forEach((part, i) => {
        current!.pax.push(part);
        (current!.pax_phones ??= []).push(phoneParts[i] ?? "");
      });
      continue;
    }

    finalize();

    const date = normDate(rawDate);
    const time = normTime(rawTime);
    const email = get("email").trim();
    const type = get("type").trim() || get("journey_type").trim();
    const qtyRaw = get("qty").trim();
    currentExplicitQty = Math.max(0, Math.min(50, parseInt(qtyRaw, 10) || 0));
    const operation_name = get("operation_name").trim();
    // Flight and vessel are separate template columns per side but collapse
    // into the same from_flight/to_flight value — flight wins if both filled.
    const fromFlightCell = get("from_flight").trim();
    const fromVesselCell = get("from_vessel").trim();
    const toFlightCell = get("to_flight").trim();
    const toVesselCell = get("to_vessel").trim();
    const from_flight = fromFlightCell || fromVesselCell;
    const to_flight = toFlightCell || toVesselCell;
    // Which column the code came from is a reliable, explicit signal for how
    // to track it live — a flight code in a Vessel column (or vice versa)
    // otherwise gets tracked against the wrong provider and never resolves.
    const tracking_kind: "flight" | "vessel" =
      fromFlightCell || toFlightCell ? "flight" : fromVesselCell || toVesselCell ? "vessel" : "flight";
    const vehicle = get("vehicle").trim();
    const notes = get("notes").trim();
    const immigrationRaw = get("immigration").trim();
    const immigration_needed = /^y(es)?$/i.test(immigrationRaw);

    current = {
      date, time,
      from_location: from,
      to_location: to,
      clientcompanyname: get("company").trim(),
      operation_name,
      flightorship: type || from_flight || to_flight || "",
      from_flight,
      to_flight,
      tracking_kind,
      vehicle,
      notes,
      email,
      immigration_needed,
      immigration_required: /^y(es)?$/i.test(immigrationRaw)
        ? "yes"
        : /^n(o)?$/i.test(immigrationRaw)
          ? "no"
          : "unknown",
      pax: [...nameParts],
      pax_phones: nameParts.map((_, i) => phoneParts[i] ?? ""),
      contact_phone: phoneParts.find(Boolean) ?? "",
      errors: [],
    };
  }
  finalize();
  return trips;
}
