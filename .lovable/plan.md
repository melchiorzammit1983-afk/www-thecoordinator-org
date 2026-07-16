## Why ETA isn't showing today

The coordinator dashboard (`src/routes/_authenticated/coordinator/index.tsx`) renders trip rows via a local `TripRow` component that only prints `date · time · pax`. It never reads `route_duration_sec` / `live_eta_sec`, and `getDashboardActivity` doesn't select those columns — so even if the calendar has ETAs, the dashboard can't display them.

Two gaps:
1. `getDashboardActivity` selects only `id, from/to, date, time, pax_count, status` (+ display names). No ETA/traffic fields.
2. `TripRow` has no slot to render an ETA chip.

## Plan

**1. Expand `getDashboardActivity` (`src/lib/coordinator.functions.ts`)**
- Add `route_duration_sec, route_distance_m, route_computed_at, live_eta_sec, live_eta_updated_at, traffic_delay_minutes, traffic_severity, leave_by_at, pickup_at, driver_id` to both the `client_bookings → jobs` join and the `unassigned` jobs select.
- Pass those fields through in the returned `pending` / `unassigned` shapes.

**2. Add ETA chip to `TripRow` in `coordinator/index.tsx`**
- Prefer `live_eta_sec` (fresh <10 min) → else `route_duration_sec`. Format with existing `formatEtaMinutes` from `@/lib/trip-display`.
- Show a small chip next to the badge: e.g. `⏱ 32 min` with `tabular-nums`, plus `+Nm traffic` when `traffic_delay_minutes > 0` (reuse `TrafficBadge` compact variant).
- If neither value exists yet, render nothing (no shimmer — keeps layout stable).

**3. Trigger enrichment for the visible rows**
- Call `useEnrichVisibleJobs([...pending, ...unassigned], [["coord-dash-activity"]])` so the dashboard auto-fills missing display names + ETAs the first time a booking appears, matching the calendar behavior.

**4. Keep it dashboard-scoped**
- No changes to calendar, driver, or client views. No new server functions. No schema changes.

## Files touched
- `src/lib/coordinator.functions.ts` — extend `getDashboardActivity` select + return.
- `src/routes/_authenticated/coordinator.index.tsx` — enrichment hook + ETA chip in `TripRow`.
