// Malta timezone helpers.
// Trip times are always entered and displayed as Europe/Malta wall-clock time,
// regardless of the device timezone.

export const MALTA_TZ = "Europe/Malta";

/**
 * Converts a Malta wall-clock date (YYYY-MM-DD) + time (HH:MM or HH:MM:SS)
 * into the correct UTC ISO string. DST-safe.
 */
export function maltaWallTimeToUtcIso(date: string, time: string): string {
  const [y, mo, d] = date.split("-").map(Number);
  const parts = time.split(":").map(Number);
  const hh = parts[0] ?? 0;
  const mm = parts[1] ?? 0;
  const ss = parts[2] ?? 0;
  if (
    !Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(d) ||
    !Number.isFinite(hh) || !Number.isFinite(mm) || !Number.isFinite(ss)
  ) {
    throw new Error("Invalid pickup date or time");
  }
  const guess = Date.UTC(y, mo - 1, d, hh, mm, ss);
  if (!Number.isFinite(guess)) throw new Error("Invalid pickup date or time");
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: MALTA_TZ,
    hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  const parts2 = fmt.formatToParts(new Date(guess));
  const get = (t: string) => Number(parts2.find((p) => p.type === t)!.value);
  let gotHour = get("hour");
  // Intl may format midnight as 24 in en-GB — normalize.
  if (gotHour === 24) gotHour = 0;
  const asMalta = Date.UTC(get("year"), get("month") - 1, get("day"), gotHour, get("minute"), get("second"));
  const offsetMs = asMalta - guess; // Malta − UTC at that instant
  return new Date(guess - offsetMs).toISOString();
}

export function formatMaltaDateTime(iso: string, opts: Intl.DateTimeFormatOptions = {}): string {
  return new Date(iso).toLocaleString([], { ...opts, timeZone: MALTA_TZ });
}

export function formatMaltaTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], {
    hour: "2-digit", minute: "2-digit", timeZone: MALTA_TZ,
  });
}

/**
 * Splits an ISO timestamp into a Malta wall-clock date (YYYY-MM-DD) and
 * time (HH:MM). Use when persisting `date`/`time` columns derived from a
 * UTC instant — plain `.toISOString().slice(...)` gives UTC hours and is
 * wrong by the Malta DST offset.
 */
export function isoToMaltaDateTime(iso: string): { date: string; time: string } {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) throw new Error("Invalid ISO timestamp");
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: MALTA_TZ, hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit",
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  let hh = get("hour");
  if (hh === "24") hh = "00";
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    time: `${hh}:${get("minute")}`,
  };
}

