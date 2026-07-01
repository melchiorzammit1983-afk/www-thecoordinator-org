// Parses WhatsApp-style multi-trip paste blocks into structured trips.
// A block starts at a line containing 📅 with an optional ⏰ time on the same line.

export type ParsedTrip = {
  date: string; // yyyy-mm-dd
  time: string; // HH:MM
  from_location: string;
  to_location: string;
  clientcompanyname: string;
  flightorship: string;
  from_flight: string;
  to_flight: string;
  pax: string[];
  errors: string[];
};

const MONTHS: Record<string, string> = {
  jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
  jul: "07", aug: "08", sep: "09", sept: "09", oct: "10", nov: "11", dec: "12",
};

// e.g. EK109, BA 245, LH1234, QR2A
const FLIGHT_RE = /\b([A-Z]{2,3})\s?(\d{1,4}[A-Z]?)\b/;

function stripLeadingBullets(s: string): string {
  return s.replace(/^[\s*•\-–—·]+/, "").replace(/^[\u{1F000}-\u{1FFFF}\u2600-\u27BF]+/u, "").trim();
}

function cleanName(s: string): string {
  return s.replace(/[\u{1F000}-\u{1FFFF}\u2600-\u27BF]/gu, "").replace(/\s+/g, " ").trim();
}

function extractFlight(s: string): string {
  const m = s.match(FLIGHT_RE);
  return m ? `${m[1]}${m[2]}`.toUpperCase() : "";
}

function parseDateTime(line: string): { date?: string; time?: string } {
  const dateMatch = line.match(/(\d{1,2})\s*([A-Za-z]{3,9})\s*(\d{4})/);
  const timeMatch = line.match(/(\d{1,2}):(\d{2})/);
  let date: string | undefined;
  if (dateMatch) {
    const d = dateMatch[1].padStart(2, "0");
    const m = MONTHS[dateMatch[2].slice(0, 3).toLowerCase()];
    if (m) date = `${dateMatch[3]}-${m}-${d}`;
  }
  let time: string | undefined;
  if (timeMatch) {
    const h = timeMatch[1].padStart(2, "0");
    time = `${h}:${timeMatch[2]}`;
  }
  return { date, time };
}

function afterColon(line: string): string {
  const idx = line.indexOf(":");
  return idx >= 0 ? line.slice(idx + 1).trim() : line.trim();
}

export function parseTrips(raw: string): ParsedTrip[] {
  const lines = raw.split(/\r?\n/);
  const blocks: string[][] = [];
  let current: string[] = [];
  for (const line of lines) {
    if (line.includes("📅")) {
      if (current.length) blocks.push(current);
      current = [line];
    } else if (current.length) {
      current.push(line);
    }
  }
  if (current.length) blocks.push(current);

  const trips: ParsedTrip[] = [];
  for (const block of blocks) {
    const trip: ParsedTrip = {
      date: "", time: "", from_location: "", to_location: "",
      clientcompanyname: "", flightorship: "",
      from_flight: "", to_flight: "",
      pax: [], errors: [],
    };
    let inNames = false;
    let lastSide: "from" | "to" | null = null;
    for (let i = 0; i < block.length; i++) {
      const rawLine = block[i];
      const line = rawLine.trim();
      if (!line) continue;
      if (line.includes("📅")) {
        const { date, time } = parseDateTime(line);
        if (date) trip.date = date;
        if (time) trip.time = time;
        inNames = false;
        continue;
      }
      if (line.includes("⏰") && !trip.time) {
        const { time } = parseDateTime(line);
        if (time) trip.time = time;
        continue;
      }
      if (line.includes("👤")) { inNames = true; continue; }
      if (line.includes("🏢")) {
        trip.clientcompanyname = cleanName(line.replace("🏢", ""));
        inNames = false; continue;
      }
      if (line.includes("📍")) {
        const rest = line.replace("📍", "").trim();
        if (/^from/i.test(rest)) { trip.from_location = afterColon(rest); lastSide = "from"; }
        else if (/^to/i.test(rest)) { trip.to_location = afterColon(rest); lastSide = "to"; }
        inNames = false; continue;
      }
      if (line.includes("✈") || /flight/i.test(line)) {
        const code = extractFlight(line) || cleanName(line.replace(/flight[:\s]*/i, ""));
        // Attach to whichever side we most recently saw; default to from.
        if (lastSide === "to") trip.to_flight = code;
        else trip.from_flight = code;
        trip.flightorship = code;
        inNames = false; continue;
      }
      if (line.includes("🛳") || /ship/i.test(line)) {
        const val = cleanName(line.replace(/ship[:\s]*/i, ""));
        if (lastSide === "to") trip.to_flight = val;
        else trip.from_flight = val;
        trip.flightorship = val;
        inNames = false; continue;
      }
      if (inNames) {
        const name = cleanName(stripLeadingBullets(line));
        if (name) trip.pax.push(name);
        continue;
      }
      // Stray line: if it looks like a flight code and we have no from, treat as inbound flight
      const stray = extractFlight(line);
      if (stray && !trip.from_flight && !trip.to_flight) {
        trip.from_flight = stray;
        trip.flightorship = stray;
      }
    }
    // Auto-fill: a flight number without an explicit From means it's an inbound pickup at the airport.
    if (trip.from_flight && !trip.from_location) trip.from_location = "Airport";
    if (trip.to_flight && !trip.to_location) trip.to_location = "Airport";

    if (!trip.date) trip.errors.push("Missing date");
    if (!trip.time) trip.errors.push("Missing time");
    if (!trip.from_location) trip.errors.push("Missing From");
    if (!trip.to_location) trip.errors.push("Missing To");
    trips.push(trip);
  }
  return trips;
}
