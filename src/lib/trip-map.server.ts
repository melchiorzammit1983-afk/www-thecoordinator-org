/**
 * Server-only helper for auto-emitting `trip_map_events` pins from server
 * functions that mutate trip state (waiting, boarding, pax, overrides,
 * status transitions).
 *
 * Contract:
 *  - Never throws. Failing to log a map pin must never block the primary
 *    action (payment / status / wait math).
 *  - Falls back to the latest `driver_locations` GPS fix for the job when
 *    lat/lng aren't provided by the caller.
 *  - Deduplicates: skips inserting if the same `(job_id, event_type)` was
 *    logged in the last 5 s (prevents client + server double-pins for the
 *    same action).
 *
 * NOTE: This file must NOT be statically imported by client-reachable
 *  modules — it uses `supabaseAdmin`. Import it inside handlers only:
 *    const { insertTripMapEvent } = await import("@/lib/trip-map.server");
 */

export type TripMapEventType =
  | "en_route"
  | "arrived_pickup"
  | "in_progress"
  | "completed"
  | "actual_dropoff"
  | "back_to_waiting"
  | "wait_started"
  | "wait_ended"
  | "boarding_requested"
  | "boarding_approved"
  | "pax_no_show"
  | "pax_cancelled"
  | "navigate_opened"
  | "passenger_called"
  | "pickup_snap"
  | "dropoff_snap"
  | "emergency_override"
  | "safety_concern"
  | "breakdown";

export interface InsertTripMapEventArgs {
  jobId: string;
  companyId: string;
  driverId?: string | null;
  eventType: TripMapEventType;
  lat?: number | null;
  lng?: number | null;
  accuracyM?: number | null;
  notes?: string | null;
  meta?: Record<string, unknown> | null;
  /** Skip GPS fallback lookup — useful for events that never carry GPS. */
  skipGpsFallback?: boolean;
}

const DEDUP_WINDOW_MS = 5_000;

export async function insertTripMapEvent(
  sb: any,
  args: InsertTripMapEventArgs,
): Promise<void> {
  try {
    // Dedup: if the same event landed in the last 5 s, skip.
    try {
      const since = new Date(Date.now() - DEDUP_WINDOW_MS).toISOString();
      const { data: recent } = await sb
        .from("trip_map_events")
        .select("id")
        .eq("job_id", args.jobId)
        .eq("event_type", args.eventType)
        .gte("occurred_at", since)
        .limit(1);
      if (recent && recent.length > 0) return;
    } catch {
      /* dedup failures shouldn't block insert */
    }

    let lat = args.lat ?? null;
    let lng = args.lng ?? null;
    let acc = args.accuracyM ?? null;

    if (!args.skipGpsFallback && (lat == null || lng == null) && args.driverId) {
      try {
        const { data: last } = await sb
          .from("driver_locations")
          .select("latitude, longitude, accuracy_m")
          .eq("driver_id", args.driverId)
          .eq("job_id", args.jobId)
          .order("captured_at", { ascending: false })
          .limit(1);
        const p = last?.[0];
        if (p) {
          lat = (p.latitude as number) ?? lat;
          lng = (p.longitude as number) ?? lng;
          acc = (p.accuracy_m as number) ?? acc;
        }
      } catch {
        /* GPS lookup failure is fine */
      }
    }

    await sb.from("trip_map_events").insert({
      job_id: args.jobId,
      company_id: args.companyId,
      driver_id: args.driverId ?? null,
      event_type: args.eventType,
      lat,
      lng,
      accuracy_m: acc,
      notes: args.notes ?? null,
      meta: (args.meta ?? {}) as any,
    } as any);
  } catch {
    /* Never throw. */
  }
}
