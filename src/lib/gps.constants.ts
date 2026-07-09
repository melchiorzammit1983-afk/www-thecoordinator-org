/**
 * Shared GPS constants used across server functions and (where needed) client code.
 * Keep numeric thresholds in one place so a future admin-configurable override
 * only needs to change one source of truth.
 */

/** Default radius (metres) within which a driver must be to trigger a GPS-verified arrival. */
export const DEFAULT_ARRIVAL_RADIUS_M = 150;

/** Maximum age (ms) of a driver_locations ping that is still considered "fresh" for arrival validation. */
export const ARRIVAL_GPS_FRESH_MS = 120_000; // 2 minutes
