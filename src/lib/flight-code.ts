/**
 * Flight/vessel code parsing + validation.
 *
 * Pure utility — safe to import from server functions and React components.
 * No network, no dependencies.
 *
 * `parseFlightCode` recognises standard IATA carrier prefixes (2 letters, or
 * one letter + one digit — e.g. `LO`, `LH`, `KM`, `U2`, `W6`, `4U`) followed
 * by 1-4 digits and an optional operational suffix letter. A small built-in
 * airline table names the carriers coordinators see most often; unknown
 * carriers still parse `ok:true` but return `airline: undefined`.
 *
 * `looksLikeVessel` is a defensive check for values that clearly aren't
 * flight codes — used to catch cases like `ASSO VENTICINCUE` sitting in a
 * flight field.
 *
 * `suggestCorrections` emits the most common trivial fixes (uppercase, strip
 * whitespace, `O`↔`0` in the numeric part, strip leading zeros).
 */

// Curated IATA→name map covering the vast majority of carriers seen in
// Malta / Mediterranean crew-change operations. Not exhaustive — the point
// is to give a friendly airline name to the coordinator when we can, not to
// mirror the entire IATA registry.
export const IATA_AIRLINES: Record<string, string> = {
  LO: "LOT Polish Airlines",
  LH: "Lufthansa",
  KM: "Air Malta",
  FR: "Ryanair",
  U2: "easyJet",
  W6: "Wizz Air",
  BA: "British Airways",
  AF: "Air France",
  KL: "KLM",
  AZ: "ITA Airways",
  IB: "Iberia",
  TP: "TAP Air Portugal",
  SN: "Brussels Airlines",
  LX: "SWISS",
  OS: "Austrian Airlines",
  SK: "SAS",
  AY: "Finnair",
  DY: "Norwegian",
  TK: "Turkish Airlines",
  EK: "Emirates",
  QR: "Qatar Airways",
  EY: "Etihad",
  SU: "Aeroflot",
  MS: "EgyptAir",
  RJ: "Royal Jordanian",
  ME: "Middle East Airlines",
  SV: "Saudia",
  ET: "Ethiopian",
  KQ: "Kenya Airways",
  DL: "Delta",
  AA: "American Airlines",
  UA: "United",
  AC: "Air Canada",
  VS: "Virgin Atlantic",
  EI: "Aer Lingus",
  A3: "Aegean",
  OA: "Olympic Air",
  PC: "Pegasus",
  XQ: "SunExpress",
  VY: "Vueling",
  UX: "Air Europa",
  I2: "Iberia Express",
  DE: "Condor",
  EW: "Eurowings",
  HV: "Transavia",
  BT: "airBaltic",
  OK: "Czech Airlines",
  RO: "TAROM",
  JU: "Air Serbia",
  BG: "Biman Bangladesh",
  QS: "SmartWings",
  "4U": "Germanwings",
  "9U": "Air Moldova",
  "3U": "Sichuan Airlines",
  V7: "Volotea",
  FI: "Icelandair",
  LS: "Jet2",
  MT: "Thomas Cook",
  TO: "Transavia France",
  LG: "Luxair",
};

export type ParsedFlight = {
  ok: boolean;
  reason?: "empty" | "format" | "too_many_digits";
  raw: string;
  normalized?: string; // canonical uppercase, no spaces, no leading zeros
  iata?: string; // 2-char carrier
  number?: string; // digits only, no leading zeros
  suffix?: string; // optional trailing operational letter
  airline?: string; // human name if we know it
};

const FLIGHT_RE = /^\s*([A-Z][A-Z0-9]|[A-Z0-9][A-Z])\s*0*([0-9]{1,4})([A-Z]?)\s*$/i;

/**
 * Parse a raw user-entered flight code into a canonical form.
 * Returns `ok:false` with a `reason` when the shape isn't a plausible flight
 * number — callers should treat that as "prompt the user to fix it".
 */
export function parseFlightCode(input: string | null | undefined): ParsedFlight {
  const raw = (input ?? "").toString();
  const trimmed = raw.trim();
  if (!trimmed) return { ok: false, reason: "empty", raw };

  const m = trimmed.match(FLIGHT_RE);
  if (!m) return { ok: false, reason: "format", raw };

  const iata = m[1].toUpperCase();
  const number = m[2].replace(/^0+/, "") || "0";
  const suffix = (m[3] || "").toUpperCase();
  if (number.length > 4) return { ok: false, reason: "too_many_digits", raw };

  return {
    ok: true,
    raw,
    normalized: `${iata}${number}${suffix}`,
    iata,
    number,
    suffix: suffix || undefined,
    airline: IATA_AIRLINES[iata],
  };
}

/**
 * Best-effort check for values that clearly aren't flight codes. Used to
 * catch vessel names accidentally typed into flight fields (e.g. two
 * space-separated all-letter words, or IMO/MMSI numeric identifiers).
 */
export function looksLikeVessel(input: string | null | undefined): boolean {
  const s = (input ?? "").toString().trim();
  if (!s) return false;
  // IMO number: "IMO 1234567" or "IMO1234567"
  if (/^IMO\s*\d{6,7}$/i.test(s)) return true;
  // Two or more space-separated alpha words with no digits — typical vessel name
  if (/^[A-Z][A-Z\s'’.-]+$/i.test(s) && /\s/.test(s) && !/\d/.test(s)) return true;
  // MMSI: 9 digits, no letters
  if (/^\d{9}$/.test(s)) return true;
  return false;
}

/**
 * Return trivial one-tap fix candidates for a flight code the user probably
 * mistyped. Never mutates the input; always returns at most 4 suggestions
 * distinct from the original.
 */
export function suggestCorrections(input: string | null | undefined): string[] {
  const raw = (input ?? "").toString();
  if (!raw.trim()) return [];
  const out = new Set<string>();

  const upper = raw.toUpperCase().trim();
  const noSpace = upper.replace(/\s+/g, "");
  const stripLead0 = noSpace.replace(/^([A-Z0-9]{2})0+/, "$1");
  const zeroToO = noSpace.replace(/(\d+)/, (d) => d.replace(/0/g, "O"));
  const oToZero = noSpace.replace(/([A-Z][A-Z0-9])([A-Z0-9]*)/, (_m, head, tail: string) =>
    head + tail.replace(/O/g, "0"),
  );

  for (const candidate of [noSpace, stripLead0, oToZero, zeroToO]) {
    if (!candidate) continue;
    if (candidate === raw) continue;
    if (parseFlightCode(candidate).ok) out.add(candidate);
  }

  return Array.from(out).slice(0, 4);
}

/**
 * Human-friendly one-liner ("LOT Polish Airlines flight 673") to feed into a
 * grounded prompt or show in the fix dialog. Falls back to the raw code
 * when the carrier isn't in our table.
 */
export function describeFlight(parsed: ParsedFlight): string {
  if (!parsed.ok) return parsed.raw.trim();
  if (parsed.airline) return `${parsed.airline} flight ${parsed.number}${parsed.suffix ?? ""}`;
  return `flight ${parsed.iata}${parsed.number}${parsed.suffix ?? ""}`;
}

/**
 * Short inline warning for a flight-number field, or null when it looks fine.
 *
 * This is a FORMAT check only (does it look like a real IATA flight code) —
 * it runs before any lookup and can't confirm the flight actually
 * exists/operates on the given date (AeroDataBox does that, when configured
 * via `AERODATABOX_API_MARKET_KEY` or `AERODATABOX_API_KEY`; see
 * `fetchLiveStatusViaAeroDataBox` in coordinator.functions.ts). Never blocks
 * submission — callers just show this text next to the field.
 */
export function flightFormatWarning(input: string | null | undefined): string | null {
  const s = (input ?? "").toString().trim();
  if (!s) return null;
  if (looksLikeVessel(s)) return "Looks like a vessel name, not a flight number";
  const parsed = parseFlightCode(s);
  if (!parsed.ok) {
    const fix = suggestCorrections(s)[0];
    return fix ? `Doesn't look like a valid flight code — did you mean ${fix}?` : "Doesn't look like a valid flight code (e.g. FR1234)";
  }
  return null;
}

/**
 * Plain-English explanation of why a live-status lookup failed.
 *
 * These used to collapse into a single "couldn't find it, check the code"
 * message, which blamed the coordinator's data for what were really provider
 * problems — a rejected API key looked exactly like a flight that genuinely
 * isn't in the schedule data. Keep the causes distinct: a key/quota problem
 * is fixed by an admin, a bad code is fixed by the coordinator, and telling
 * them apart is the difference between a 30-second fix and an afternoon.
 *
 * Shared by the server (which persists this onto the trip row) and the
 * refresh button's toast, so the two can never drift.
 */
export function liveStatusFailureMessage(reason: string | null | undefined, code: string): string {
  switch (reason) {
    case "not_configured":
      return "Live flight tracking isn't configured yet";
    case "invalid_code":
      return `Couldn't recognise "${code}" as a flight code — check it`;
    case "vessel_in_flight_field":
      return `"${code}" looks like a vessel — move it to the vessel field`;
    case "aero_401":
    case "aero_403":
      // Almost always an unsubscribed marketplace account rather than a
      // malformed key: holding an account is not the same as selecting a plan.
      return "Flight provider rejected the API key — check the key and that the account is subscribed";
    case "aero_429":
      return "Flight provider quota reached — try again shortly";
    case "provider_unavailable":
      return "Flight provider is unavailable right now";
    case "aero_unreachable":
      return "Couldn't reach the flight provider — network or address problem";
    default: {
      // aero_http_<status>: any other non-2xx. Worth naming the code, since
      // 402 usually means the plan isn't active and 400/404 usually means
      // the request address is wrong — very different fixes.
      const m = /^aero_http_(\d{3})$/.exec(reason ?? "");
      if (m) {
        const status = m[1];
        const hint =
          status === "402"
            ? " — subscription not active"
            : status === "400" || status === "404"
              ? " — provider didn't recognise the request"
              : status.startsWith("5")
                ? " — provider having problems, try again shortly"
                : "";
        return `Flight provider returned HTTP ${status}${hint}`;
      }
      return `Couldn't find ${code} — the provider has no record of it for this date`;
    }
  }
}
