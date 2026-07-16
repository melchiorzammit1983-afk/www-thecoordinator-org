## 1. Fix "arrival_accuracy_m column not found"

Root cause: the Phase-1 migration that adds the eight `arrival_*` columns to `public.jobs` was never applied to the live database (verified — `information_schema` returns no `arrival_*` columns). `updateJobStatus` still tries to write them, so PostgREST rejects the update.

Two-part fix:

- **Re-run the missing migration** so `arrival_verified_at, arrival_lat, arrival_lng, arrival_accuracy_m, arrival_heading, arrival_speed_mps, arrival_street_address, arrival_distance_m` exist. Kept only for audit history — no code will write them after step 2.
- **Remove the arrival gate** in `src/lib/coordinator-public.functions.ts` (lines ~918-996): drop the whole `en_route → arrived` GPS validation block plus the now-unused `haversineMeters` helper and the `gps.constants` import. `updateJobStatus` will just set `status: "arrived"` (and the existing `driver_started_at` timestamping stays).
- Update `formatDriverStatusError` in `src/routes/m.driver.$token.tsx` to drop the `arrival_no_gps / arrival_weak_gps / arrival_outside_radius` cases (no longer thrown).

Result: driver taps "Arrived at pickup" and it always succeeds. No automation of arrival/departure detection remains.

## 2. Record every driver button press on the coordinator map

Today the status-change trigger `log_job_status_map_event` only logs `arrived_pickup / in_progress / completed / actual_dropoff`. We extend coverage so the coordinator sees every driver action as a pin on `TripEventsMap`.

- New server helper `logDriverAction({ token, job_id, action, lat?, lng?, accuracy_m?, notes?, meta? })` in `src/lib/coordinator-public.functions.ts`. Uses `loadDriverJob` for auth, resolves company_id/driver_id, inserts a `trip_map_events` row. Falls back to the latest `driver_locations` fix when the client can't provide coords.
- Driver client (`src/routes/m.driver.$token.tsx`) calls it on:
  - status buttons: `en_route`, `arrived`, `in_progress`, `completed`, back-to-waiting
  - waiting start/stop, boarding start/approve, no-show, pax cancel
  - emergency override submit (already logged via `audit_emergency_overrides_trg`, but also mirror to `trip_map_events` so it shows on the map)
  - "Navigate" opened, "Call passenger" tapped (informational pins)
- Extend the `event_type` vocabulary consumed by `TripEventsMap.tsx` with a small legend/icon per action (status = colored dot, waiting = clock, boarding = user-check, override = red triangle, info actions = light-gray dot).
- Coordinator hover tooltip already shows `event_type`, `occurred_at`, `notes`; we add a friendly label map so "Arrived at destination" etc. are readable.

Emergency overlay behavior is unchanged — the button still opens `EmergencyOverrideDialog`; we only add the map echo.

## 3. Driver UI polish (mobile-first, low-risk)

Scope limited to `src/routes/m.driver.$token.tsx` and its child sheets — no logic changes to workflows.

- **Primary action bar**: turn the current stacked status buttons into a single full-width sticky bottom bar with one large primary button showing the *next* action ("On the way" → "Arrived at pickup" → "Start trip" → "Complete trip"). Secondary actions (Navigate, Call, Chat, Emergency) collapse into an icon row above it.
- **Confirm-on-tap** for `Complete trip` only (prevents accidental completes). Others are instant.
- **Status pill** at the top with color + label ("En route · 12 min to Hilton").
- **"Next up" panel** keeps its stable height (already done) and gains a one-line ETA refresh timestamp ("updated 12s ago").
- **Emergency button** stays as a distinct red icon in the secondary row and inside the safety overlay — no automation, driver-triggered only.
- Larger tap targets (min 48 px), tabular numerals for time/distance, safe-area padding for iOS.

## Technical details

Files touched:

- `supabase/migrations/<new>_reapply_arrival_columns.sql` — idempotent re-run of the eight `arrival_*` columns (audit only, no writes going forward).
- `src/lib/coordinator-public.functions.ts` — delete arrival gate block; delete `haversineMeters`; add `logDriverAction` server fn.
- `src/lib/gps.constants.ts` — leave file (still imported for `ARRIVAL_GPS_FRESH_MS` used elsewhere? check and remove if unused).
- `src/routes/m.driver.$token.tsx` — remove arrival error strings; call `logDriverAction` on each driver action; restructure action bar.
- `src/components/coordinator/TripEventsMap.tsx` — add label/icon map for new `event_type` values.
- `src/components/driver/EmergencyOverrideDialog.tsx` — no change to flow; server side already logs, plus new `trip_map_events` echo through `logDriverAction`.

Non-goals: no changes to grouped-trip logic, RLS, billing, or the auto-next-job hook.

## Open question

Should the driver's "Navigate opened" and "Call passenger" taps also appear as pins, or only status/waiting/boarding/override events (map stays less noisy)? Default in this plan: include them but render as small light-gray dots the coordinator can filter off.
