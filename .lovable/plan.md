## Goal

Every driver-facing event lands on the coordinator's trip map as a pin the moment it happens, with GPS + context, and the pins keep flowing even when the driver's device drops out mid-action. Events must also flow into the money side (waiting minutes/amount, override notes) so the pin math matches the payment math.

## Current state (what already works)

- `trip_map_events` table + `TripEventsMap` renders all 19 event types (icons/labels/colors already defined).
- Status pins (`arrived_pickup`, `in_progress`, `completed`, `actual_dropoff`) are auto-inserted by the DB trigger `log_job_status_map_event`.
- Client `logDriverAction()` in the driver app posts pins for: `en_route`, `arrived_pickup`, `in_progress`, `completed`, `back_to_waiting`, `wait_started`, `wait_ended`, `boarding_requested`, `boarding_approved`, `pax_no_show`, `pax_cancelled`, `navigate_opened`, `passenger_called`.
- Emergency overrides insert into `job_emergency_overrides` (which mirrors to `trip_audit_log`).
- `pickup_snap` / `dropoff_snap` are inserted by the snap functions.

## Gaps to close

1. **Client-only logging is unreliable** — if the driver taps "On the way" in a tunnel and the `logDriverAction` request fails, no pin ever lands. It has to be emitted server-side by the same handler that changes state.
2. **Wait session pins** are only client-side. Server-side auto-close paths (`closeOpenWaitSession` called from status change / emergency override) skip `wait_ended` entirely and never write `wait_started` at all if the client dropped.
3. **Emergency override / safety_concern / breakdown** never write to `trip_map_events`, so the map is missing exactly the pins that matter most for trust.
4. **Boarding & pax events** (`boarding_requested`, `boarding_approved`, `pax_no_show`, `pax_cancelled`) are only client-side — the server RPCs (`requestBoardingApproval`, `resolveBoardingApproval`, `markPaxNoShow`, cancel pax) don't emit map events.
5. **Live sync**: the sheet polls `trip-map` every 30 s. New pins should appear instantly instead of after the next poll.

## Implementation

### 1. Server-side event emitter helper

New file `src/lib/trip-map.server.ts` (server-only, not client-imported at module scope):

```ts
export async function insertTripMapEvent(sb, {
  jobId, companyId, driverId, eventType,
  lat, lng, accuracyM, notes, meta,
}) {
  // If lat/lng missing, fall back to the latest driver_locations fix for this job.
  // Never throws — logging must not block the primary action.
}
```

Used by every server function below.

### 2. Wait sessions

- `startWaitSession` → insert `wait_started` with `meta = { source, chargeable_from, free_ends_at }`.
- `stopWaitSession` → insert `wait_ended` with `meta = { elapsed_minutes, chargeable_minutes, calculated_amount, agreed_amount }`.
- `closeOpenWaitSession` helper (called from `updateJobStatus` transitions and emergency overrides) → also insert `wait_ended` with the same meta plus `reason` (`auto_status_change` / `auto_override`).

### 3. Emergency overrides (`submitEmergencyOverride`)

After the `job_emergency_overrides` insert, also insert into `trip_map_events` with:
- `event_type = safety_concern | breakdown | emergency_override` (mapped from `reason`)
- `lat/lng/accuracy_m` from the payload
- `notes = "{action label} — {reason label}{ note?}"`
- `meta = { from_status, to_status, reason, action, photo_url }`

### 4. Boarding & pax

- `requestBoardingApproval` → `boarding_requested`
- `resolveBoardingApproval` (approved path) → `boarding_approved`
- `markPaxNoShow` → `pax_no_show` (meta: pax id, name)
- Pax cancel path → `pax_cancelled`

### 5. Status transitions (`updateJobStatus`)

The DB trigger already covers `arrived_pickup`, `in_progress`, `completed`, `actual_dropoff`. Also emit `en_route` and `back_to_waiting` from the server handler (currently only the client logs these), so the pin exists even when the client request to `logDriverAction` fails.

### 6. Client-side logging stays

Keep the existing `logDriverAction` calls in the driver app — they add fresh device GPS/timestamp. Server-side inserts are idempotent-ish (duplicate pins within 5 s of the same `event_type` for the same `job_id` are suppressed by a small guard in `insertTripMapEvent`) so we don't end up with two pins per action.

### 7. Realtime instant sync

In `TripDetailsSheet` (and any place that reads `getTripMap`), subscribe to Postgres changes on `trip_map_events` filtered by `job_id` and invalidate the `["trip-map", jobId]` query on INSERT. Requires adding `trip_map_events` to `supabase_realtime` publication (migration). Falls back to the existing 30 s poll if realtime is unavailable.

### 8. Coordinator map polish (no design change)

- The pin popup already shows `notes` and `occurred_at`. Extend it to render key `meta` fields when present: waiting minutes/amount, override reason, pax name — so the map explains itself without opening another panel.

## Files touched

- `src/lib/trip-map.server.ts` (new, server-only)
- `src/lib/coordinator-public.functions.ts` — wait sessions, emergency override, pax no-show/cancel, boarding request, en_route/back_to_waiting emissions
- `src/lib/coordinator.functions.ts` — boarding approval resolution, any admin/coordinator-side status changes
- `src/components/coordinator/TripEventsMap.tsx` — richer popup content from `meta`
- `src/components/coordinator/TripDetailsSheet.tsx` — realtime subscription
- Migration: add `trip_map_events` to `supabase_realtime` publication (only if not already published)

## What stays out of scope

- No changes to how statuses/waiting/overrides work — only add the map-pin side effect.
- No new event types; the 19 listed are already in `EVENT_META`.
- No changes to the driver UI beyond the logging that already runs.