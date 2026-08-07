// Parses the app's own "Message to Copy" format — a fixed "Label - value"
// block the bulk-sheet template generates via formula in its last column,
// and that a coordinator/HR user can also paste directly (e.g. straight out
// of WhatsApp/email) without ever touching a spreadsheet. Deliberately
// separate from parse-trips.ts's freer-form paste parser: this format is
// rigid and label-driven, so matching it is a lookup, not a heuristic.
import type { ParsedTrip } from "@/lib/parse-trips";
import { extractPhoneFromName, isMeaningfulName } from "@/lib/parse-trips";

// Known labels, including the template's own typos ("vassel", "imigrasion")
// — a message copied straight out of the sheet must parse without editing.
// Longest-first match order matters (checked at use) so "vassel from" is
// never shadowed by a shorter accidental prefix.
const LABEL_ALIASES: Record<string, string> = {
  "operation name": "operation_name",
  "operation": "operation_name",
  "date": "date",
  "time": "time",
  // Never used for classification — the app derives journey type itself
  // from the addresses, same principle as everywhere else in the app.
  "journey type": "journey_type",
  "company": "company",
  "client": "company",
  "passenger name and phone number": "pax_header",
  "passenger names and phone numbers": "pax_header",
  "passenger name": "pax_header",
  "passengers": "pax_header",
  "email": "email",
  "pick up address": "from",
  "pickup address": "from",
  "flight from": "from_flight",
  "vassel from": "from_vessel",
  "vessel from": "from_vessel",
  "delivery address": "to",
  "to flight": "to_flight",
  "to vassel": "to_vessel",
  "to vessel": "to_vessel",
  "pax count": "qty",
  "imigrasion needed": "immigration",
  "immigration needed": "immigration",
  "notes": "notes",
};

const SORTED_ALIASES = Object.keys(LABEL_ALIASES).sort((a, b) => b.length - a.length);

function matchLabel(line: string): { field: string; value: string } | null {
  const lower = line.toLowerCase();
  for (const alias of SORTED_ALIASES) {
    if (lower.startsWith(alias)) {
      const value = line.slice(alias.length).replace(/^\s*[-:]\s*/, "").trim();
      return { field: LABEL_ALIASES[alias], value };
    }
  }
  return null;
}

function normDate(s: string): string {
  const v = s.trim();
  if (!v) return "";
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(v);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, "0")}-${iso[3].padStart(2, "0")}`;
  // The sheet writes DD/MM/YYYY (matches sheet-template.ts's own convention).
  const sl = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/.exec(v);
  if (sl) {
    let [, d, m, y] = sl;
    if (y.length === 2) y = `20${y}`;
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  return "";
}

function normTime(s: string): string {
  const m = /^(\d{1,2}):(\d{2})/.exec(s.trim());
  return m ? `${m[1].padStart(2, "0")}:${m[2]}` : "";
}

/** True when the pasted text is (or starts with) one of these messages, so
 * the caller can prefer this parser over the freer-form one. */
export function looksLikeLabeledMessage(raw: string): boolean {
  const first = raw.split(/\r?\n/).find((l) => l.trim());
  return !!first && matchLabel(first.trim())?.field === "operation_name";
}

/**
 * Splits on each new "Operation Name" line (the template always emits it
 * first) so pasting several rows' Message-to-Copy cells at once — e.g.
 * copying a whole column range out of the sheet — still yields one trip per
 * message instead of one merged mess.
 */
export function parseLabeledMessages(raw: string): ParsedTrip[] {
  const lines = raw.split(/\r?\n/);
  const blocks: string[][] = [];
  let current: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (matchLabel(trimmed)?.field === "operation_name" && current.length) {
      blocks.push(current);
      current = [];
    }
    if (trimmed) current.push(line);
  }
  if (current.length) blocks.push(current);

  return blocks.map((block) => {
    const fields: Record<string, string> = {};
    const pax: string[] = [];
    let contact_phone = "";
    let inPax = false;

    for (const rawLine of block) {
      const line = rawLine.trim();
      if (!line) continue;
      const match = matchLabel(line);
      if (match) {
        inPax = match.field === "pax_header";
        if (match.value) fields[match.field] = match.value;
        continue;
      }
      if (inPax) {
        const { cleanName, phone } = extractPhoneFromName(line);
        if (phone && !contact_phone) contact_phone = phone;
        if (cleanName && isMeaningfulName(cleanName)) pax.push(cleanName);
      }
      // An unrecognised line outside pax mode is dropped — most likely
      // blank formatting noise the formula's own line breaks introduced.
    }

    const from_flight = (fields.from_flight ?? "").trim();
    const from_vessel = (fields.from_vessel ?? "").trim();
    const to_flight = (fields.to_flight ?? "").trim();
    const to_vessel = (fields.to_vessel ?? "").trim();
    // Same collapsing rule as the tabular sheet parser: a Flight/Vessel
    // column pair per side collapses into one tracked code, flight wins if
    // both are filled, and which column had the value decides the provider.
    const trackedFrom = from_flight || from_vessel;
    const trackedTo = to_flight || to_vessel;
    const tracking_kind: "flight" | "vessel" =
      from_flight || to_flight ? "flight" : from_vessel || to_vessel ? "vessel" : "flight";

    const explicitQty = Math.max(0, Math.min(50, parseInt(fields.qty ?? "", 10) || 0));
    const qty = Math.max(explicitQty, pax.length, 1);
    while (pax.length < qty) {
      pax.push(pax.length === 0 ? "Guest" : `Guest ${pax.length + 1}`);
    }

    const trip: ParsedTrip = {
      date: normDate(fields.date ?? ""),
      time: normTime(fields.time ?? ""),
      from_location: (fields.from ?? "").trim(),
      to_location: (fields.to ?? "").trim(),
      clientcompanyname: (fields.company ?? "").trim(),
      operation_name: (fields.operation_name ?? "").trim() || undefined,
      flightorship: trackedFrom || trackedTo || "",
      from_flight: trackedFrom,
      to_flight: trackedTo,
      tracking_kind,
      vehicle: "",
      notes: (fields.notes ?? "").trim(),
      email: (fields.email ?? "").trim(),
      immigration_needed: /^y(es)?$/i.test((fields.immigration ?? "").trim()),
      pax,
      contact_phone,
      errors: [],
    };
    if (!trip.date) trip.errors.push("Missing date");
    if (!trip.time) trip.errors.push("Missing time");
    if (!trip.from_location) trip.errors.push("Missing From");
    if (!trip.to_location) trip.errors.push("Missing To");
    return trip;
  });
}
