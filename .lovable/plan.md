## Goal

Prevent double-booking a driver by extending the existing schedule-collision system with (1) a configurable per-company boarding buffer, (2) a hard confirmation step before assigning, (3) a driver-side warning chip, and (4) the same rule applied to AI Auto-Coordinate / auto-assign.

The math and Routes API infrastructure already exist in `src/lib/scheduling.functions.ts` (`evaluatePairs`, `previewAssignmentConflicts`, `suggestAlternativeDrivers`). We build on top of it — nothing about how trips or the map work changes.

## Changes

### 1. Configurable boarding buffer (per company)

- Add column `boarding_buffer_min` (int, default 10) to `companies` (single global default per coordinator company — no per-driver setup needed).
- New tiny server fn `getBoardingBufferMin` reads it inside `scheduling.functions.ts`; if unset, falls back to `10`.
- `evaluatePairs` accepts a `bufferMin` param instead of the hard-coded constant. All three server fns (`checkDriverConflicts`, `previewAssignmentConflicts`, `suggestAlternativeDrivers`) look it up once from the caller's company and pass it through.
- Coordinator can edit it in `coordinator.dispatch-rules.tsx` (existing page) — a single "Passenger boarding buffer (minutes)" field with a short explainer.

### 2. Warn + require confirmation on assignment

Any UI that sets a driver on a trip goes through the same guard:

- `JobFormDialog.tsx` — already runs `previewAssignmentConflicts` for the picker. On submit, if severity is `tight` or `conflict`, open a new `<ConflictConfirmDialog />` that shows: prev trip end time, drive time to next pickup, boarding buffer used, shortfall in minutes, and the top 3 alternative drivers from `suggestAlternativeDrivers`. Coordinator must click "Assign anyway" to proceed, or pick a suggested driver.
- `TripDetailsSheet.tsx` — reassign flow reuses the same dialog.
- `BulkActionBar.tsx` "assign to driver" reuses it once per conflicting trip (or a single summary dialog when >1 conflict).

Overrides are logged to `trip_audit_log` with reason "conflict_override" so we can see later who forced a known-bad assignment.

### 3. Driver-side warning chip

- `checkDriverConflicts` is already the source of truth. Add a lightweight public-ish read path the driver's PWA already uses (driver's own trips only, via the driver token route) — or, simpler: run `checkDriverConflicts` server-side keyed by the driver's own `driver_id` in the token loader and pass `perJob` down.
- In `m.driver.$token.tsx` trip card, when `perJob[jobId].severity !== "free"`, render a compact amber/red chip: "Tight — 3 min slack" or "Conflict — leaves 8 min short". Tapping opens a small sheet with the pair details (prev trip end, next pickup, drive time) so the driver can push back to the coordinator before hitting the road.

### 4. AI Auto-Coordinate / auto-assign respects the buffer

- In `src/lib/coordinator.functions.ts`, wherever the AI planner picks a driver for an unassigned trip, call `previewAssignmentConflicts` (already imported infra) for each candidate driver *before* proposing the assignment.
  - Skip drivers with severity `conflict`.
  - `tight` drivers are allowed but the proposal note surfaces "tight — X min slack" so the coordinator sees it in the proposal review UI.
  - If every candidate collides, the proposal falls back to "no eligible driver — needs manual review" instead of silently picking one.
- Same gate applied to the `auto_assign_enabled` path.

## Technical notes

- Only two new UI pieces: `ConflictConfirmDialog.tsx` (shared) and the driver-card chip.
- Schema change is a single `ALTER TABLE companies ADD COLUMN boarding_buffer_min integer NOT NULL DEFAULT 10;` migration.
- `docs-facts.ts` `PAX_DROPOFF_BUFFER_MIN` becomes dynamic (per company) — Fact rendering falls back to the default when no company context.
- Transit cache and Routes API usage do not change → no extra AI/Maps spend for the confirmation step (it re-uses the same in-memory cache hit from the picker preview).
- No changes to trip cards, grouping, map, pricing, or any other subsystem.

## Out of scope

- Per-driver custom buffers.
- Rerouting/rebalancing existing conflicts automatically — we only prevent new ones and surface existing ones.
- Changing the "tight vs conflict" thresholds (still 5 min slack for tight, <0 for conflict).
