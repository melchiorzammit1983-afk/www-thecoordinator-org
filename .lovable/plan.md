Plan: Fix Auto-Coordinate so it sees all unassigned trips and picks any available driver when the named one can't take them

1. Repair the unassigned-trips query
- The current Auto-Coordinate query selects `name`, `surname`, and `quantity` columns that no longer exist on `jobs`, so the query errors and returns 0 trips — that's the real reason "No eligible unassigned trips found" appears.
- Replace those with the fields actually on trip cards: `trip_no`, `from_location`, `to_location`, `pickup_display_name`, `dropoff_display_name`, `pickup_at`, `date`, `time`, `status`, plus the joined `pax(name)` for passenger names.
- Exclude completed/cancelled trips so the plan matches what the coordinator sees on the board.
- Widen the time window: instead of "last 24h + null", include all active unassigned trips (past-hour to future). Keep the today-only filter when the directive says "today/tonight/this morning/etc".

2. Named target ("assign all unassigned to BaygorCab") — try target first, then fall back
- Keep the existing fuzzy name resolver.
- When the resolver finds a driver or partner, first try to assign every eligible unassigned trip to that target as before.
- For each trip the named target cannot take, fall back to the next available option, in this order:
  a. Any other driver on the coordinator's board whose `status` is not `offline` AND has no scheduling conflict with that trip (reuse the existing schedule-conflict helpers already used by the assignment collision banner).
  b. If no driver fits, an active Collaborate partner (dispatch).
- Emit a mix of proposals: primary `assign` to the named target for trips it can take, and additional `assign` / `dispatch` proposals for the leftovers, each with a clear `reason` explaining why the fallback was chosen ("BaygorCab has a conflict at 09:50 — assigning to next available driver X").
- Never overwrite already-assigned trips (the existing `.is("driver_id", null)` guard on apply stays).

3. No named target — same availability-first behaviour
- When the directive has no target (e.g. just "assign all unassigned trips"), skip the LLM for the simple case: walk the unassigned list in pickup order and hand each trip to the first available, non-conflicting driver; fall back to an active partner if none fits.
- Keep the LLM path as a fallback for genuinely ambiguous directives (grouping, etc.).

4. Chunking & limits
- Group the resulting `assign` proposals per driver into chunks of 50 trip_ids (matches the apply endpoint's cap) so a big backlog produces multiple accept-able cards.

5. Clearer empty-state messaging
- Distinguish three cases in the response so the dialog can show the right message:
  - No active unassigned trips at all.
  - Trips exist but no driver/partner is available (surface this explicitly instead of the generic "no safe proposal").
  - Named target not found (suggest the closest name matches).

6. Verify against live data
- After the fix, re-run the query for the current company and confirm it returns the ~9 active unassigned trip cards currently on the board.
- Confirm "assign all unassigned trips to BaygorCab" now returns real proposals, and that when BaygorCab is busy the plan proposes another available driver.

Files expected to change
- `src/lib/coordinator.functions.ts` — `runAutoCoordinate` query + resolver + fallback logic.
- `src/components/coordinator/AiAutoCoordinateButton.tsx` — surface the new empty-state messages.

No schema changes. No changes to the apply path's safety guards.