// Parses WhatsApp-style multi-trip paste blocks into structured trips.
// A block starts at a line containing 📅 with an optional ⏰ time on the same line.

export type ParsedTrip = {
  date: string; // yyyy-mm-dd
  time: string; // HH:MM
  from_location: string;
  to_location: string;
  clientcompanyname: string;
  flightorship: string;
  pax: string[];
  errors: string[];
};

const MONTHS: Record<string, string> = {
  jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
  jul: "07", aug: "08", sep: "09", sept: "09", oct: "10", nov: "11", dec: "12",
};

function stripLeadingBullets(s: string): string {
  // Remove leading bullet/emoji noise like "*🔁", "•🔁", "-", "•", "*", "🔁"
  return s.replace(/^[\s*•\-–—·]+/, "").replace(/^[\u{1F000}-\u{1FFFF}\u2600-\u27BF]+/u, "").trim();
}

function cleanName(s: string): string {
  return s.replace(/[\u{1F000}-\u{1FFFF}\u2600-\u27BF]/gu, "").replace(/\s+/g, " ").trim();
}

function parseDateTime(line: string): { date?: string; time?: string } {
  // Pull the first date-like "DD Mon YYYY" (allow weekday prefix) and first HH:MM
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
      clientcompanyname: "", flightorship: "", pax: [], errors: [],
    };
    let inNames = false;
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
        if (/^from/i.test(rest)) trip.from_location = afterColon(rest);
        else if (/^to/i.test(rest)) trip.to_location = afterColon(rest);
        inNames = false; continue;
      }
      if (line.includes("✈") || /flight/i.test(line)) {
        trip.flightorship = cleanName(line.replace(/flight[:\s]*/i, ""));
        inNames = false; continue;
      }
      if (line.includes("🛳") || /ship/i.test(line)) {
        trip.flightorship = cleanName(line.replace(/ship[:\s]*/i, ""));
        inNames = false; continue;
      }
      if (inNames) {
        const name = cleanName(stripLeadingBullets(line));
        if (name) trip.pax.push(name);
      }
    }
    if (!trip.date) trip.errors.push("Missing date");
    if (!trip.time) trip.errors.push("Missing time");
    if (!trip.from_location) trip.errors.push("Missing From");
    if (!trip.to_location) trip.errors.push("Missing To");
    trips.push(trip);
  }
  return trips;
}
