/**
 * Parser for HR's bulk crew paste (tab- or comma-separated, one crew member per line).
 * Column order: date | name | surname | phone | email | from | flight1 | flight2 | flight3
 *             | to | flight_from1 | flight_from2 | flight_from3 | nationality | ship
 *             | arrival_date | arrival_time
 *
 * `from`/`to` are the overall journey endpoints; flight_fromN is where legN departs from
 * (the destination of legN is flight_from(N+1), or `to` for the last leg).
 *
 * `arrival_date`/`arrival_time` (trailing, optional, appended after the original Phase 1
 * columns to stay backward-compatible with already-pasted lists) describe when the
 * Malta-landing leg touches down — this is what triggers Phase 3's auto trip creation.
 */

export type ParsedCrewLeg = {
  leg_number: 1 | 2 | 3;
  departure_date: string | null;
  arrival_date: string | null;
  arrival_time: string | null;
  from_location: string;
  to_location: string;
  flight_number: string | null;
};

export type ParsedCrewRow = {
  date: string;
  name: string;
  surname: string;
  phone: string;
  email: string;
  from: string;
  flight1: string;
  flight2: string;
  flight3: string;
  to: string;
  flight_from1: string;
  flight_from2: string;
  flight_from3: string;
  nationality: string;
  ship: string;
  arrival_date: string;
  arrival_time: string;
};

export type ParseCrewError = { line: number; raw: string; message: string };

const COLUMNS: (keyof ParsedCrewRow)[] = [
  "date", "name", "surname", "phone", "email", "from",
  "flight1", "flight2", "flight3", "to",
  "flight_from1", "flight_from2", "flight_from3", "nationality", "ship",
  "arrival_date", "arrival_time",
];

/** Malta is this app's home base — the leg landing here is what triggers trip auto-creation. */
export function isMaltaLocation(loc: string | null | undefined): boolean {
  const s = (loc ?? "").trim().toLowerCase();
  if (!s) return false;
  return s.includes("malta") || /\bmla\b/.test(s);
}

const HEADER_ALIASES = new Set(COLUMNS.map((c) => c.toLowerCase()));

function splitLine(line: string): string[] {
  // Tab-separated takes priority (Excel/Sheets paste); fall back to comma.
  const cells = line.includes("\t") ? line.split("\t") : line.split(",");
  return cells.map((c) => c.trim());
}

function looksLikeHeader(cells: string[]): boolean {
  const normalized = cells.map((c) => c.toLowerCase().replace(/[^a-z0-9_]/g, ""));
  return normalized.some((c) => HEADER_ALIASES.has(c));
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function parseBulkCrewPaste(text: string): { rows: ParsedCrewRow[]; errors: ParseCrewError[] } {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const rows: ParsedCrewRow[] = [];
  const errors: ParseCrewError[] = [];
  const seenEmails = new Set<string>();

  lines.forEach((line, i) => {
    const cells = splitLine(line);
    if (i === 0 && looksLikeHeader(cells)) return; // skip an optional header row

    if (cells.length < 5) {
      errors.push({ line: i + 1, raw: line, message: "Expected at least date, name, surname, phone, email" });
      return;
    }

    const row = {} as ParsedCrewRow;
    COLUMNS.forEach((key, idx) => {
      (row as any)[key] = (cells[idx] ?? "").trim();
    });

    if (!row.name || !row.surname) {
      errors.push({ line: i + 1, raw: line, message: "Missing name or surname" });
      return;
    }
    if (!row.email || !EMAIL_RE.test(row.email)) {
      errors.push({ line: i + 1, raw: line, message: `Invalid email: "${row.email}"` });
      return;
    }
    const emailKey = row.email.toLowerCase();
    if (seenEmails.has(emailKey)) {
      errors.push({ line: i + 1, raw: line, message: `Duplicate email in pasted list: ${row.email}` });
      return;
    }
    seenEmails.add(emailKey);
    rows.push(row);
  });

  return { rows, errors };
}

/** Explode a flat crew row into up to 3 itinerary legs for saving. */
export function crewRowToLegs(row: Pick<ParsedCrewRow, "date" | "from" | "to" | "flight1" | "flight2" | "flight3" | "flight_from1" | "flight_from2" | "flight_from3" | "arrival_date" | "arrival_time">): ParsedCrewLeg[] {
  const legs: ParsedCrewLeg[] = [];
  const hasLeg2 = !!(row.flight2 || row.flight_from2);
  const hasLeg3 = !!(row.flight3 || row.flight_from3);

  const leg1To = hasLeg2 ? row.flight_from2 || row.to : row.to;
  legs.push({
    leg_number: 1,
    departure_date: row.date || null,
    arrival_date: null,
    arrival_time: null,
    from_location: row.from,
    to_location: leg1To || row.to,
    flight_number: row.flight1 || null,
  });

  if (hasLeg2) {
    const leg2To = hasLeg3 ? row.flight_from3 || row.to : row.to;
    legs.push({
      leg_number: 2,
      departure_date: null,
      arrival_date: null,
      arrival_time: null,
      from_location: row.flight_from2 || "",
      to_location: leg2To || row.to,
      flight_number: row.flight2 || null,
    });
  }

  if (hasLeg3) {
    legs.push({
      leg_number: 3,
      departure_date: null,
      arrival_date: null,
      arrival_time: null,
      from_location: row.flight_from3 || "",
      to_location: row.to,
      flight_number: row.flight3 || null,
    });
  }

  // Attach the Malta arrival date/time to whichever leg actually lands there —
  // this is what src/lib/crew-trip-auto-create.ts keys trip creation off of.
  if (row.arrival_date || row.arrival_time) {
    const maltaLeg = [...legs].reverse().find((l) => isMaltaLocation(l.to_location)) ?? legs[legs.length - 1];
    if (maltaLeg) {
      maltaLeg.arrival_date = row.arrival_date || null;
      maltaLeg.arrival_time = row.arrival_time || null;
    }
  }

  return legs;
}
