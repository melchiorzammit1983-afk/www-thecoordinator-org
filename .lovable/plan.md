# Driver: Grouped Runs (Multi-Stop) UX

Goal: when a driver receives multiple jobs sharing a `group_id`, treat them as a single **Run** in the driver app. Accepts happen per trip, but the moment all group members are accepted the app collapses them into one Run Card. Status actions (On the way / Arrived / In progress / Completed) apply to the whole run and drive a stop-by-stop flow.

## Behavior

1. **Accept — individually, auto-merge**
   - Grouped jobs still show as separate accept cards in the incoming list (with a small `Run · 3 stops` chip so the driver knows it's part of a bigger run).
   - Once every job in a group has `driver_response = accepted`, they merge into one **Run Card** in the driver dashboard. Partially-accepted groups keep showing the remaining trips to accept, with a progress hint (`2 of 3 accepted`).

2. **One status per run (applies to whole group)**
   - Run-level buttons: `On the way`, `Arrived`, `Start trip`, `Complete stop`.
   - `On the way` → sets all jobs in the group to `en_route` in one call.
   - `Arrived` / `Start trip` / `Complete stop` act on the **current stop only** and advance the pointer; each still writes its per-leg milestone into `trip_map_events` and job status, but the driver only sees "current stop" controls.
   - `Complete stop` on the last stop marks the whole run completed and fires the existing `AutoNextJobSheet` for the next run/job.

3. **Current stop highlighted (stop list view)**
   - Run Card shows a vertical stop list using the coordinator palette `#0EA5E9 / #22C55E / #F59E0B`:
     - **Current stop**: large card, expanded, showing address (business name preferred), pax, ETA, navigate + status buttons.
     - **Upcoming stops**: compact rows with number chip, name, pax; tap to preview (address + navigate) without changing the pointer.
     - **Done stops**: collapsed, muted, with completion time + drop-off pin snap.
   - Header shows `Stop 2 of 4 · Hilton → Corinthia · 12 min` with `tabular-nums` so it doesn't flash on ETA refresh (same stability treatment already used on the single-trip header).

4. **Instant reorder**
   - Drag handle on each upcoming stop (done + current are locked).
   - Reorder writes immediately via existing `reorderStops` server fn (no coordinator approval), and the coordinator's `GroupStopsPanel` sees it live.
   - Chain reflow (from → to per leg) recomputes automatically from the new order, matching the coordinator-side logic already in `coordinator.calendar.tsx`.

5. **Safety Mode compatibility**
   - When `useSafetyMode` engages, the Run Card collapses to only: current stop name, big Navigate button, and `Arrived` / `Complete` buttons. Reorder + upcoming list hide until unlocked.

## Files (technical)

- **New**: `src/components/driver/RunCard.tsx` — Run header, stop list, current-stop panel, reorder handles.
- **New**: `src/components/driver/RunStopRow.tsx` — Numbered chip + status states (done/current/upcoming).
- **New**: `src/hooks/use-driver-runs.ts` — Buckets the driver's assigned jobs by `group_id`, tracks accept progress, exposes `currentStopIndex`.
- **Edit**: `src/routes/m.driver.$token.tsx` — Replace the flat job list with `RunCard` for grouped jobs; ungrouped jobs keep their current card. Wire run-level status actions to fan out across group members.
- **Edit**: `src/lib/groups.functions.ts` — Add `advanceGroupStatus({ group_id, status })` server fn that updates all member jobs atomically and writes per-leg `trip_map_events`. Reuse existing `reorderStops` (already instant).
- **Edit**: `src/hooks/use-auto-next-job.ts` — Ignore completions that are mid-run (`group_id` with remaining stops); only fire the "next job" sheet when the whole run is done.

## Open follow-ups worth adding later (not in this build)

- Per-stop pax boarding checklist inside the current-stop panel (uses existing `group_stops` boarding fields).
- Voice announcement on stop advance (`use-driver-audio` already available).
- "Skip stop" with reason → creates a no-show event.

Confirm to build.
