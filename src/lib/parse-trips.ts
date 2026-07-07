// Parses free-form multi-trip paste blocks into structured trips.
// Tolerates messages with or without emojis. Blocks are split on 📅 markers,
// or (when no emojis are present) on blank lines / any line containing a full date.

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
  contact_phone: string;
  errors: string[];
  // Optional Places metadata attached by the bulk auto-fix pass.
  from_place_id?: string | null;
  from_lat?: number | null;
  from_lng?: number | null;
  to_place_id?: string | null;
  to_lat?: number | null;
  to_lng?: number | null;
  // When set, records the original text before Google auto-fix so the
  // user can undo in the review UI. Only fields the auto-fix touched
  // are present.
  autoFixed?: {
    from_location?: string;
    to_location?: string;
  };
};

const PHONE_RE = /(\+?\d[\d\s().\-]{5,}\d)/;

// Strip decorative glyphs: emojis, arrows (⬅️ ➡️ ← → ↔), ascii arrows,
// bullets, and repeated punctuation from name-ish strings.
function stripDecor(s: string): string {
  return s
    .replace(/[\u{1F000}-\u{1FFFF}\u2600-\u27BF\uFE0F]/gu, "")
    .replace(/[←→↔⇐⇒⇔]/g, "")
    .replace(/(<-+|-+>|=+>|<=+)/g, "")
    .replace(/[\s*•\-–—·>|:,/\\]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// A pax name is meaningful only if, after stripping decor and any embedded
// phone, it still contains at least 2 unicode letters.
export function isMeaningfulName(s: string): boolean {
  const bare = stripDecor((s ?? "").toString());
  const letters = bare.match(/\p{L}/gu);
  return !!letters && letters.length >= 2;
}

export function normalizePhone(raw: string): string {
  const digits = (raw ?? "").replace(/[^\d+]/g, "");
  if (!digits) return "";
  const plus = digits.startsWith("+");
  const onlyDigits = digits.replace(/\+/g, "");
  if (onlyDigits.length < 7 || onlyDigits.length > 15) return "";
  return (plus ? "+" : "") + onlyDigits;
}

export function extractPhoneFromName(name: string): { cleanName: string; phone: string } {
  const s = (name ?? "").toString();
  const m = s.match(PHONE_RE);
  const phone = m ? normalizePhone(m[1]) : "";
  const withoutPhone = m && phone
    ? (s.slice(0, m.index!) + " " + s.slice(m.index! + m[1].length))
    : s;
  const cleaned = stripDecor(withoutPhone);
  return { cleanName: cleaned, phone };
}


const FLIGHT_CODE_RE = /(?:^|\s|#|✈|\bflight\b|\bflt\b)\s*([A-Za-z]{2})\s*-?\s*(\d{1,4})(?=$|\s|[,.;])/i;
export function extractFlightCode(text: string): { code: string | null; rest: string } {
  const raw = (text ?? "").trim();
  if (!raw) return { code: null, rest: "" };
  const m = FLIGHT_CODE_RE.exec(raw);
  if (!m) return { code: null, rest: raw };
  const code = `${m[1].toUpperCase()}${m[2]}`;
  const rest = (raw.slice(0, m.index) + " " + raw.slice(m.index + m[0].length))
    .replace(/\b(flight|flt)\b/gi, "")
    .replace(/[#✈]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return { code, rest };
}

const MONTHS: Record<string, string> = {
  jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
  jul: "07", aug: "08", sep: "09", sept: "09", oct: "10", nov: "11", dec: "12",
};

const FLIGHT_RE = /\b([A-Z]{2,3})\s?(\d{1,4}[A-Z]?)\b/;
const DATE_RE_LONG = /(\d{1,2})\s*([A-Za-z]{3,9})\s*(\d{2,4})/;
const DATE_RE_ISO = /\b(\d{4})-(\d{2})-(\d{2})\b/;
const DATE_RE_SLASH = /\b(\d{1,2})[\/\.-](\d{1,2})[\/\.-](\d{2,4})\b/;
const TIME_RE = /\b(\d{1,2}):(\d{2})\b/;

function stripLeadingBullets(s: string): string {
  return s.replace(/^[\s*•\-–—·>]+/, "")
    .replace(/^[\u{1F000}-\u{1FFFF}\u2600-\u27BF]+/u, "")
    .trim();
}

function stripEmoji(s: string): string {
  return s.replace(/[\u{1F000}-\u{1FFFF}\u2600-\u27BF]/gu, "");
}

function cleanName(s: string): string {
  return stripEmoji(s).replace(/\s+/g, " ").trim();
}

function extractFlight(s: string): string {
  const m = s.match(FLIGHT_RE);
  return m ? `${m[1]}${m[2]}`.toUpperCase() : "";
}

function parseDate(line: string): string | undefined {
  const iso = line.match(DATE_RE_ISO);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const long = line.match(DATE_RE_LONG);
  if (long) {
    const d = long[1].padStart(2, "0");
    const m = MONTHS[long[2].slice(0, 3).toLowerCase()];
    let y = long[3];
    if (y.length === 2) y = `20${y}`;
    if (m) return `${y}-${m}-${d}`;
  }
  const sl = line.match(DATE_RE_SLASH);
  if (sl) {
    const d = sl[1].padStart(2, "0");
    const m = sl[2].padStart(2, "0");
    let y = sl[3];
    if (y.length === 2) y = `20${y}`;
    return `${y}-${m}-${d}`;
  }
  return undefined;
}

function parseTime(line: string): string | undefined {
  const t = line.match(TIME_RE);
  if (!t) return undefined;
  return `${t[1].padStart(2, "0")}:${t[2]}`;
}

function hasDate(line: string): boolean {
  return !!parseDate(line);
}

function looksLikeName(line: string): boolean {
  const s = stripEmoji(stripLeadingBullets(line));
  if (!s) return false;
  if (/[:=]/.test(s)) return false;
  if (/\d/.test(s)) return false;
  const words = s.split(/\s+/);
  if (words.length < 2 || words.length > 6) return false;
  // Mostly alphabetic, mostly uppercase or title case
  const letters = s.replace(/[^A-Za-z]/g, "");
  if (letters.length < 4) return false;
  const upper = letters.replace(/[^A-Z]/g, "").length;
  return upper / letters.length > 0.5;
}

function splitBlocks(raw: string): string[][] {
  const lines = raw.split(/\r?\n/);
  const hasCalendarEmoji = lines.some((l) => l.includes("📅"));
  const blocks: string[][] = [];
  let current: string[] = [];
  const push = () => {
    if (current.some((l) => l.trim())) blocks.push(current);
    current = [];
  };
  for (const line of lines) {
    const isBoundary = hasCalendarEmoji
      ? line.includes("📅")
      : (current.length > 0 && (line.trim() === "" || hasDate(line)));
    if (isBoundary) {
      if (hasCalendarEmoji) {
        push();
        current = [line];
      } else {
        if (line.trim() === "") { push(); }
        else { push(); current = [line]; }
      }
    } else {
      current.push(line);
    }
  }
  push();
  return blocks;
}

export function parseTrips(raw: string): ParsedTrip[] {
  const blocks = splitBlocks(raw);
  const trips: ParsedTrip[] = [];

  for (const block of blocks) {
    const trip: ParsedTrip = {
      date: "", time: "", from_location: "", to_location: "",
      clientcompanyname: "", flightorship: "",
      from_flight: "", to_flight: "",
      pax: [], contact_phone: "", errors: [],
    };
    let inNames = false;
    let lastSide: "from" | "to" | null = null;

    for (const rawLine of block) {
      const line = rawLine.trim();
      if (!line) continue;

      // Date / time on any line
      const maybeDate = parseDate(line);
      if (maybeDate && !trip.date) trip.date = maybeDate;
      const maybeTime = parseTime(line);
      if (maybeTime && !trip.time) trip.time = maybeTime;

      if (line.includes("👤") || /^names?\s*[:\-]?\s*$/i.test(stripEmoji(line).trim())) {
        inNames = true;
        continue;
      }
      if (line.includes("🏢") || /^(client|company)\s*[:\-]/i.test(stripEmoji(line).trim())) {
        trip.clientcompanyname = cleanName(line.replace(/🏢/g, "").replace(/^(client|company)\s*[:\-]/i, ""));
        inNames = false; continue;
      }

      const noEmoji = stripEmoji(line).trim();
      const fromMatch = /^from\b\s*[:\-]?\s*(.*)$/i.exec(noEmoji);
      const toMatch = /^to\b\s*[:\-]?\s*(.*)$/i.exec(noEmoji);
      if (line.includes("📍") || fromMatch || toMatch) {
        const rest = noEmoji.replace(/^📍?/, "").trim();
        const fm = /^from\b\s*[:\-]?\s*(.*)$/i.exec(rest);
        const tm = /^to\b\s*[:\-]?\s*(.*)$/i.exec(rest);
        if (fm) { trip.from_location = fm[1].trim(); lastSide = "from"; inNames = false; continue; }
        if (tm) { trip.to_location = tm[1].trim(); lastSide = "to"; inNames = false; continue; }
      }

      if (line.includes("✈") || /^flight\b/i.test(noEmoji)) {
        const code = extractFlight(line) || cleanName(line.replace(/flight[:\s]*/i, ""));
        if (lastSide === "to") trip.to_flight = code; else trip.from_flight = code;
        trip.flightorship = code;
        inNames = false; continue;
      }
      if (line.includes("🛳") || /^ship\b/i.test(noEmoji)) {
        const val = cleanName(line.replace(/ship[:\s]*/i, ""));
        if (lastSide === "to") trip.to_flight = val; else trip.from_flight = val;
        trip.flightorship = val;
        inNames = false; continue;
      }

      if (inNames) {
        const rawName = cleanName(stripLeadingBullets(line));
        if (rawName) {
          const { cleanName: cn, phone } = extractPhoneFromName(rawName);
          if (phone && !trip.contact_phone) trip.contact_phone = phone;
          if (cn && isMeaningfulName(cn)) trip.pax.push(cn);
        }
        continue;
      }

      // Heuristic: standalone flight code line
      const stray = extractFlight(line);
      if (stray && !trip.from_flight && !trip.to_flight && !maybeDate && !maybeTime) {
        trip.from_flight = stray;
        trip.flightorship = stray;
        continue;
      }

      // Heuristic: line that looks like a person's name (no emoji markers used)
      if (looksLikeName(line)) {
        const rawName = cleanName(stripLeadingBullets(line));
        const { cleanName: cn, phone } = extractPhoneFromName(rawName);
        if (phone && !trip.contact_phone) trip.contact_phone = phone;
        if (cn && isMeaningfulName(cn)) trip.pax.push(cn);
      }
    }

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
