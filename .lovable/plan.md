
## Goals

1. When a driver taps **Arrived at pickup** while GPS shows they're far from the pickup, warn them and offer clear options — don't silently accept or hard-block.
2. Waiting time must count from **max(pickup_at, arrived_at)** — arriving early never earns wait charges; arriving late starts immediately.
3. When a driver changes something later (fixed a mistaken status, undoes an arrival, changes route), the coordinator's live board stays coherent, and the correction is preserved as a **map/audit event** rather than a destructive overwrite.

## 1. GPS-aware arrival confirmation (driver side)

Server: extend `updateJobStatus` in `src/lib/coordinator-public.functions.ts` to accept optional `{ lat, lng, accuracy_m, override_reason? }` and, for the `arrived` transition only, compute distance to `pickup_lat/lng` (fall back to geocoding pickup label if needed, cached).

- If distance ≤ `DEFAULT_ARRIVAL_RADIUS_M` (150 m) → accept as today.
- If distance > radius **and** no `override_reason` → return `{ ok: false, reason: "too_far_from_pickup", distance_m, radius_m }` instead of writing.
- If `override_reason` is present (`wrong_pin`, `blocked_access`, `passenger_meeting_elsewhere`, `other` + free-text) → accept, but write a `trip_map_events` row `arrived_pickup_override` with the reason + distance in `meta`. Also log via existing `logDriverAction` path so the coordinator map pin shows an amber flag.
- Missing/stale GPS (> `ARRIVAL_GPS_FRESH_MS`) → treat as "unknown distance" and go straight to the override prompt (no silent accept).

Client (`src/routes/m.driver.$token.tsx`): wrap the primary "Arrived at pickup" CTA. On `too_far_from_pickup`, open a bottom sheet (reuse ResponsiveDialog):

> "You're ~420 m from the pickup point. Are you sure you're here?"
> - **I'm at the right spot** (pin is wrong) → resend with `override_reason: "wrong_pin"`
> - **Passenger asked me to meet somewhere else** → `passenger_meeting_elsewhere`, optional note
> - **Can't get closer (access blocked)** → `blocked_access`
> - **Not yet — go back**

Pass current geolocation from the existing driver location hook so the server doesn't have to guess.

## 2. Waiting anchored to the trip time, not driver arrival

Change wait-session start logic in two places (both call sites in `coordinator-public.functions.ts`):

- **Auto-start on `arrived`** (lines ~1034-1059 in `updateJobStatus`)
- **Manual `startWaitSession`** (line 2529)

New behaviour:

- Compute `startedAt = max(now, job.pickup_at)`.
- Store the actual arrival timestamp in a new `arrived_at` column on `job_wait_sessions` (or reuse `meta` jsonb) so we can show both "Arrived 09:45 · Waiting starts 10:00".
- `free_ends_at = startedAt + freeWaitMinutes`.
- If `now < pickup_at`, the session row exists but `chargeable_from = pickup_at`; the driver UI shows a chip **"Waiting starts at 10:00"** counting down instead of a running meter.

`stopWaitSession` / `computeCalculatedAmount` already work off `started_at`, so no change once `started_at` is the anchored time.

Add a migration to introduce `job_wait_sessions.arrived_at timestamptz` (nullable) and backfill NULLs.

## 3. Coordinator sees corrections as history, not overwrites

Today `updateJobStatus` with `pending` from `arrived`/`en_route` clears `driver_started_at`/`driver_completed_at`. Instead:

- Keep those timestamps as-is and add a `trip_map_events` row of type `status_corrected` with `{from, to, reason?}` in `meta`.
- Add `back_to_pending` / `undo_arrival` / `undo_in_progress` to the `logDriverAction` enum so every driver correction is a map pin, colour-coded amber, with the original status in the tooltip.
- If an `arrived` is undone, **do not** delete the open wait session — close it with `ended_at = now`, `calculated_amount = 0`, `agreed_amount = 0`, `driver_note = "reverted"` so we keep the trace.
- Coordinator dashboard/calendar already subscribes to `trip_map_events` and job status; the corrected status flows through naturally. Add a small `↺ corrected` badge on the trip row when the latest `trip_map_events.event_type` is a `*_corrected`/`undo_*`.

## 4. Files to touch

- `src/lib/coordinator-public.functions.ts` — arrival guard, wait anchoring, correction logging, extend `logDriverAction` enum.
- `src/routes/m.driver.$token.tsx` — arrival confirmation sheet, "Waiting starts at HH:MM" chip, disabled state until pickup_at when tapping "Start waiting" manually before pickup_at (with same override).
- `src/components/driver/DriverWaitingPanel.tsx` — read the anchored chargeable-from and render the countdown vs. live meter.
- `src/components/coordinator/TripEventsMap.tsx` + `TripDetailsSheet.tsx` — new pin colour/icon for `arrived_pickup_override`, `status_corrected`, `undo_*`.
- `src/routes/_authenticated/coordinator.calendar.tsx` — small "corrected" chip on affected rows.
- New migration:
  - `alter table public.job_wait_sessions add column arrived_at timestamptz, add column chargeable_from timestamptz;`
  - default backfill: `chargeable_from = started_at`.

## 5. Out of scope for this pass

- No geofence auto-triggers (arrival stays manual, per your earlier instruction).
- No change to billing math itself — only the anchor moves.
- No coordinator-side "revert" button; corrections remain driver-initiated with coordinator visibility.
