
## What we're building

1. **Trip card shows planned ETA and live ETA side by side.** Planned = the cached hotel→airport route duration. Live = driver's current GPS → next stop, refreshed only on meaningful movement.
2. **Every driver event drops a pin on the trip map.** Arrived at pickup, in-progress, actual drop-off, pickup/drop-off GPS snaps, emergency overrides, plus a thin breadcrumb polyline of the actual path.
3. **After the trip is done, coordinator can replay it** on the same trip sheet, or open a "Trip report" for an exportable PDF (planned vs actual, deltas, all pins, audit timeline).

## Data layer

- New table `public.trip_map_events` (job_id, event_type, lat, lng, occurred_at, notes, meta jsonb) — the single source for pins. Written by a trigger on `jobs` status changes and by existing driver actions (arrive/snap/override) so we don't duplicate call sites.
- Reuse existing `driver_locations` for the breadcrumb — add an index on `(job_id, recorded_at)` and only draw points where `job_id` matches the trip.
- Reuse `jobs.route_duration_sec` / `route_computed_at` for planned ETA (already there).
- Add `jobs.live_eta_sec` and `jobs.live_eta_updated_at`, refreshed by the driver client when GPS moves >500m or every 2 min, whichever first.

## Card UI (calendar + dashboard + trip sheet)

Two small chips next to the arrow:

```text
Hotel Juliani → MLA    Plan 32m · Live 28m ▲4
```

- Live chip is green when ahead of plan, red when behind, grey pre-dispatch.
- Falls back to "—" placeholder so the chip never collapses (same fix pattern as the driver panel).

## Trip map (coordinator sheet)

- Existing map gains: A pin (planned pickup), B pin (planned drop-off), driver marker (live), breadcrumb polyline, plus event pins:
  - 🟢 Arrived at pickup
  - 🔵 On the way / in-progress
  - 🔴 Actual drop-off — outlined orange when >150 m from planned
  - 📍 Driver GPS snap (pickup or drop-off)
  - ⚠️ Emergency override
- Hover / tap a pin → popover with event type, timestamp, driver note, distance from planned.

## After-trip record

- Same map+timeline stays available on completed trips (read-only).
- New button **"Trip report"** on completed trips → server function renders a PDF with:
  - Header (client, driver, pickup/dropoff names, times)
  - Planned vs actual ETA + delta
  - Static map snapshot with all pins + breadcrumb
  - Chronological event list from `trip_audit_log` + `trip_map_events`
- Saved to `/mnt/documents`-equivalent storage bucket `trip-reports` (private), signed URL on download.

## Server functions / routes

- `recordTripMapEvent` (driver, authenticated) — inserts a row; called from existing "Arrived", status change, snap, and override handlers.
- `refreshLiveEta` (driver, throttled) — computes and writes `live_eta_sec`, gated by >500m movement or 2 min elapsed. Uses existing `computeDriverRoute`.
- `getTripMap` (coordinator, authenticated) — returns pins + breadcrumb + latest live ETA for a job.
- `generateTripReport` (coordinator) — builds PDF, stores in storage, returns signed URL.

## Feature/cost controls

- Live ETA and report generation both go through `spend_points` with new feature keys `live_eta_refresh` and `trip_report_pdf`, admin-togglable in Portal Settings (same pattern as `route_eta` / `address_name_resolve`).

## Rollout order

1. Migration: `trip_map_events`, new `jobs` columns, feature-cost rows, index on `driver_locations`.
2. Server functions + trigger wiring.
3. Card chips (planned + live).
4. Trip map pins + breadcrumb + hover popovers.
5. Live ETA refresh on driver client (movement-based).
6. Trip report PDF + download button.
7. Admin toggles + docs.

## Open follow-ups you may want later

- Push notification to coordinator when live ETA slips >5 min behind plan.
- "Compare to previous run" on the report for recurring trips.
- Email the PDF straight to the client after completion.
