## Goal

Enhance flight tracking so the coordinator card visibly reflects two distinct problems:

1. **Time mismatch** — the flight's scheduled departure/arrival time doesn't match the trip pickup time. Card ring = red, badge shows the flight's actual time.
2. **Flight delay** — the flight time matched pickup but the airline reports a delay. Card ring = red, badge shows "DELAYED — new time HH:MM".

## Backend changes

`src/lib/coordinator.functions.ts` → `checkFlightStatus`:
- Capture `dep.scheduled`, `dep.estimated`, `arr.scheduled`, `arr.estimated` from AviationStack.
- Pick the relevant side: if `from_flight` is set → arrival (pax arriving before pickup); if `to_flight` is set → departure (pax being dropped for that flight).
- Compute `scheduledIso`, `estimatedIso`, `delayMin`.
- Compare `scheduledIso` vs `job.pickup_at`. If |diff| > 45 min → new status `time_mismatch` with note `Flight at HH:MM (pickup HH:MM)`.
- Otherwise apply existing delay/cancel logic (threshold stays 15 min) and store note as `New time HH:MM (+Nm)`.
- Persist two new columns: `flight_scheduled_at` (timestamptz), `flight_estimated_at` (timestamptz). Requires migration adding both nullable columns to `jobs` + updating the select list in `listJobs`, `buildStatement`, etc.

Migration:
```sql
ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS flight_scheduled_at timestamptz,
  ADD COLUMN IF NOT EXISTS flight_estimated_at timestamptz;
```
(No RLS change; inherits existing policies.)

## Frontend changes

`src/routes/_authenticated/coordinator.calendar.tsx`:
- Extend `Job` type with `flight_scheduled_at`, `flight_estimated_at`.
- Extend `problem` predicate and red-ring logic to include `flight_status === "time_mismatch"`.
- Update the flight badge:
  - `cancelled` → red "✈ CODE CANCELLED"
  - `time_mismatch` → red "✈ CODE — flight HH:MM ≠ pickup HH:MM"
  - `delayed` → amber-red "✈ CODE DELAYED → new HH:MM"
  - otherwise show plain code.
- Format times using existing pickup_at formatting helper (locale-safe, guarded).

No other UI/route changes. No changes to driver or client portals in this pass.

## Files touched

- `supabase` migration (2 new columns on `jobs`)
- `src/lib/coordinator.functions.ts` (checkFlightStatus + select lists)
- `src/routes/_authenticated/coordinator.calendar.tsx` (Job type, ring, badge)
