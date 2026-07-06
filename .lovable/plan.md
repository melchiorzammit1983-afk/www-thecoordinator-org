# Driver ETA on coordinator trip cards

Show a live "ETA Xm" chip beside the status on each coordinator trip card, driven by the same live location feed the map already uses. When the projected arrival is later than the scheduled pickup, turn the card amber and mark the chip "Late Xm".

## Scope

- Coordinator calendar trip cards only (the `JobCard` in `src/routes/_authenticated/coordinator.calendar.tsx`).
- Only for jobs with a driver in status `en_route` / `arrived` / `in_progress` and a recent GPS point with `eta_sec`.
- No changes to driver app, database, or server functions — ETA already flows through `listActiveDriverLocations` and is used in `TripDetailsSheet`.

## Behavior

- Card queries the existing `["live-locations"]` query (already refetched every 30s + realtime invalidation) and looks up its own `job.id`.
- Chip placement: inline with the status text near the top of the card (same row as the existing `job.status` label).
- Chip content:
  - `en_route`: `ETA 12m` (or `<1 min`, `1h 05m` for longer).
  - `arrived`: `Arrived` (green), no ETA.
  - `in_progress`: `Drop in 8m` using ETA to destination.
- Lateness (only meaningful pre-pickup, i.e. `en_route`):
  - Compute `projected_arrival = now + eta_sec`.
  - If `projected_arrival > job.pickup_at + 2 min` grace → chip turns amber and reads `Late Xm`.
  - Whole card gets an amber left border + subtle amber tint (reusing existing amber utility already used for waiting/flight-issue states) so it's visible in the list.
- If no live point in the last 90s → no chip (avoid stale/misleading ETA). Waiting session takes visual priority (waiting chip stays as-is).

## Files touched

- `src/routes/_authenticated/coordinator.calendar.tsx`
  - Small `useLiveEtaForJob(jobId)` helper reading the cached `["live-locations"]` query — no extra network calls, no new server fn.
  - New `<EtaChip job={job} />` rendered next to the status span (~line 863 and inside `JobCard` around lines 1500–1630 where status/flight badges live).
  - Extend the existing card amber-state logic (used for flight issues) with an `isLate` flag so the border/tint reuses the same class.

No new dependencies, no migrations, no schema changes.
