## Problem

The "Fix time" button on a flight-mismatched trip sets the pickup to the wrong time (13:55 flight became 11:55 pickup). Root cause: `rescheduleJobToFlight` in `src/lib/coordinator.functions.ts` reads the flight ISO with `.toISOString().slice(11,16)`, which gives UTC hours. In Malta summer (UTC+2) that shifts every fixed time back 2 hours.

Additionally, today the flight tracker only reacts when a flight is late or cancelled. Early flights are silently ignored, so drivers can be caught out.

## Changes

### 1. Fix the "Fix time" bug (Malta wall-clock everywhere)

In `rescheduleJobToFlight`, replace the UTC slice with a Malta-timezone formatter (reuse the existing helpers in `src/lib/time.ts` — same pattern `refreshMaltaFlightForJob` already uses to derive date/time). Result: a 13:55 Europe/Malta flight snaps pickup to `date=2026-07-06`, `time=13:55`, and `pickup_at` is the correct UTC instant.

Sweep the file for any other `.toISOString().slice(...)` that should be Malta wall-clock (e.g. `rescheduleJobToFlight` is the main offender; the flight-refresh path already handles TZ correctly). No changes to how times are stored — everything stays UTC in the DB and Malta wall-clock in the UI.

### 2. Detect early flights (>= 5 min earlier than scheduled)

In `refreshMaltaFlightForJob` (same file), when the board gives us a new estimated time:

```text
diff = scheduled - estimated   (minutes)
if diff >= 5      → flight_status = "early"
if |diff| < 5     → "on_time"
if estimated > scheduled + 5 → existing "delayed" path (unchanged)
```

Store `flight_status = "early"` with `flight_status_note = "EARLY → 13:30"` and update `flight_estimated_at`. No DB migration needed — `flight_status` is already free text.

### 3. Green flight line + "Fix time" prompt on the card

In `src/routes/_authenticated/coordinator.calendar.tsx` (the flight banner around line 1518 and the trip cards around line 1152):

- Treat `flight_status === "early"` as an "actionable" state alongside `delayed` / `time_mismatch`, so the card surfaces it and the "Fix time" button appears.
- Style: render the flight line in green (`text-emerald-600 dark:text-emerald-400`) instead of the amber/red used for late — the card itself stays neutral (not ember), because early is good news, not an alert.
- Text: `✈ EK109 Flight 13:30 (was 13:55) · pickup 13:55` so both times are visible.
- Tapping "Fix time" runs the existing (now-corrected) `rescheduleJobToFlight` and snaps pickup to the new flight time — matches your answer.

### 4. Notify the assigned driver (no auto-shift)

When `refreshMaltaFlightForJob` transitions a job into `"early"` and there is a `driver_id`, insert a system message into the existing `trip_messages` driver_coord thread:

```text
"Flight EK109 is EARLIER: now 13:30 (was 13:55). Pickup still 13:55 —
coordinator will confirm."
```

This piggybacks on the mechanism you already use for other status changes, so the driver gets a push via the existing `driver_push_subs` flow with no new infrastructure. Only fires once per transition (guard on `flight_status !== 'early'` before update).

### 5. Coordinator-triggered auto-shift (points-metered)

Add a new server function `autoShiftEarlyFlight({ id })` that:
- Verifies the job is `flight_status === "early"` and the caller owns the job.
- Calls `spend_points(company_id, 'auto_shift_early_flight', job_id, ...)` — a new feature key in `ai_feature_costs` (added via migration, default cost 1, `block_on_empty=true`).
- Runs the same snap logic as `rescheduleJobToFlight`.
- Inserts a driver system message: `"Pickup moved earlier to 13:30 (auto)"`.

On the calendar card, when a trip is in `"early"` state, show a second small button next to "Fix time" labelled "Auto-shift (1 pt)" that calls this function. Coordinators without points see the standard `insufficient_points` toast you already handle elsewhere.

## Technical details

Files touched:
- `src/lib/coordinator.functions.ts` — fix `rescheduleJobToFlight`; extend `refreshMaltaFlightForJob` early-detection + driver system message; add `autoShiftEarlyFlight`.
- `src/routes/_authenticated/coordinator.calendar.tsx` — treat `"early"` as an actionable state, green flight line, second "Auto-shift" button.
- One migration: insert `('auto_shift_early_flight', 1, true, true)` into `ai_feature_costs` (idempotent `ON CONFLICT DO NOTHING`).

No frontend framework changes, no new dependencies, no schema changes beyond the one seed row.

## Explicit non-goals

- No timezone selector — everything stays Malta time as you chose.
- No automatic pickup shift without coordinator tap.
- No changes to how late/cancelled flights behave today.
- No backfill of existing `flight_status` values.
