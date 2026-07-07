// Shared helpers for rendering trip locations on cards, sheets, and portals.
//
// Rule: NEVER show plus-codes (VH79+7PC), bare lat/lng, or long "raw address"
// strings when we have a hotel/business name for the location. Coordinates
// remain stored on the row for routing.

// Google plus-code like "VH79+7PC" or "8FVC9G8V+"
const PLUS_CODE_RE = /^[23456789CFGHJMPQRVWX]{4,8}\+[23456789CFGHJMPQRVWXcfghjmpqrvwx]{2,7}(?:[,\s].*)?$/;
// Bare lat/lng pair, e.g. "35.937500, 14.375400"
const LATLNG_RE = /^-?\d{1,3}(?:\.\d+)?\s*,\s*-?\d{1,3}(?:\.\d+)?$/;

export function looksLikeCode(addr: string | null | undefined): boolean {
  const s = (addr ?? "").trim();
  if (!s) return false;
  if (PLUS_CODE_RE.test(s)) return true;
  if (LATLNG_RE.test(s)) return true;
  return false;
}

/**
 * Human-readable display name for a trip's pickup / dropoff.
 *
 * Priority:
 *   1. explicit display_name (from Google Places, cached on the trip row)
 *   2. if the raw text is a plus-code / lat-lng, "Location pin" fallback
 *   3. otherwise the raw address text
 */
export function displayLocation(
  address: string | null | undefined,
  displayName?: string | null | undefined,
): string {
  const raw = (address ?? "").trim();
  const name = (displayName ?? "").trim();
  if (name) return name;
  if (!raw) return "—";
  if (looksLikeCode(raw)) return "Location pin";
  return raw;
}

// Format ETA seconds → "≈ 28 min" / "≈ 1h 5m"
export function formatEta(seconds: number | null | undefined): string | null {
  if (seconds == null || !Number.isFinite(seconds) || seconds <= 0) return null;
  const totalMin = Math.max(1, Math.round(seconds / 60));
  if (totalMin < 60) return `≈ ${totalMin} min`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return m ? `≈ ${h}h ${m}m` : `≈ ${h}h`;
}

export type UrgencyTier = "red" | "orange" | "green" | null;

export type UrgencyThresholds = {
  green_min: number;
  orange_min: number;
  red_min: number;
};

export const DEFAULT_URGENCY: UrgencyThresholds = {
  green_min: 60,
  orange_min: 45,
  red_min: 30,
};

/**
 * Compute urgency tier for an unassigned / unaccepted trip based on pickup time.
 * Returns null when thresholds aren't reached or the trip is already handled.
 */
export function urgencyTier(
  pickupIso: string | null | undefined,
  opts: {
    assigned: boolean;   // has a driver_id
    accepted: boolean;   // driver has accepted
    now?: number;
    thresholds?: UrgencyThresholds;
  },
): UrgencyTier {
  if (!pickupIso) return null;
  if (opts.assigned && opts.accepted) return null;
  const t = opts.thresholds ?? DEFAULT_URGENCY;
  const now = opts.now ?? Date.now();
  const minutes = (new Date(pickupIso).getTime() - now) / 60_000;
  if (!Number.isFinite(minutes) || minutes < -5) return null; // long past
  if (minutes <= t.red_min) return "red";
  if (minutes <= t.orange_min) return "orange";
  if (minutes <= t.green_min) return "green";
  return null;
}

export function urgencyClasses(tier: UrgencyTier): string {
  switch (tier) {
    case "red":
      return "ring-2 ring-red-500 shadow-[0_0_16px_rgba(239,68,68,0.55)] animate-pulse";
    case "orange":
      return "ring-2 ring-orange-500 shadow-[0_0_14px_rgba(249,115,22,0.5)]";
    case "green":
      return "ring-2 ring-emerald-500 shadow-[0_0_12px_rgba(16,185,129,0.45)]";
    default:
      return "";
  }
}
