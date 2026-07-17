
# Driver Schedule Collision Detection

Warn the coordinator (and block, if they want) when assigning a trip to a driver whose existing trips would overlap once travel time + a passenger buffer are factored in.

## What the coordinator will see

1. **In the driver picker (assign / reassign dropdown)** — each driver row gets a status chip:
   - 🟢 **Free** — no conflict
   - 🟡 **Tight** — arrives with <5 min slack
   - 🔴 **Conflict** — arrives after next pickup, or previous trip not finished in time
   Hovering the chip shows the reasoning ("Finishes prev trip 8:05 + 10 min buffer → next pickup 8:10 → 5 min short").

2. **On the trip card / Trip Details sheet** — if the currently assigned driver has a conflict, show a red banner:
   *"Schedule conflict: driver is on trip #1234 until ~8:05. This 8:10 pickup needs ~25 min drive → arrives 8:30 (20 min late). [Reassign] [Override]"*

3. **On the calendar board** — trips assigned to the same driver get a subtle red left-rail if they collide with a sibling.

## How the math works

For each candidate driver, take their trips on the same day and sort by `pickup_at`. For each adjacent pair (prev → next):

```text
prev.end_estimate   = prev.pickup_at + prev.duration_sec (from route cache / Routes API)
handover_ready_at   = prev.end_estimate + PAX_DROPOFF_BUFFER (default 10 min)
transit_to_next     = Routes API: prev.dropoff → next.pickup (traffic-aware)
must_leave_by       = next.pickup_at − transit_to_next
slack_min           = (must_leave_by − handover_ready_at) / 60
```

- `slack_min >= 5` → Free
- `0 <= slack_min < 5` → Tight
- `slack_min < 0` → Conflict (magnitude = minutes late)

Buffers are admin-tunable (single row in `ai_configuration` or a new `company_scheduling_settings`): `pax_dropoff_buffer_min` (default 10), `tight_threshold_min` (default 5).

## Implementation

### 1. Server function — `src/lib/scheduling.functions.ts` (new)

- `checkDriverConflicts({ driver_id, job_id? })` — returns `{ conflicts: [{ withJobId, kind: 'late_arrival'|'overlap', slack_min, reason }], suggestion?: 'reassign' }`.
- `checkAssignmentPreview({ job_id, driver_id })` — same math run before commit; used by the picker.
- Uses `job_route_cache` first (already populated by existing route-insights work). Only calls Routes API for the transit leg when cache is missing/stale (>30 min). Batches with `computeRouteMatrix`.
- RLS-scoped via `requireSupabaseAuth`; only returns jobs the caller can already see.

### 2. Hook — `src/hooks/use-driver-conflicts.ts` (new)

Lightweight wrapper around `useQuery` keyed by `driver_id` + trip date, refetch every 60 s, invalidated on any job status/assignment mutation.

### 3. UI touchpoints (frontend only, small, isolated)

- `src/components/coordinator/DriverPicker.tsx` (or wherever the current select lives — will locate during build) → append `<ConflictChip />`.
- `src/components/coordinator/TripDetailsSheet.tsx` → new `<ScheduleConflictBanner />` at top when conflicts exist.
- `src/routes/_authenticated/coordinator.calendar.tsx` → tint the row rail red when the job is part of a conflict pair.
- Reuse existing `TrafficBadge` colour tokens (emerald / amber / red) — no new palette.

### 4. Blocking vs. warning

Non-blocking by default (banner + confirm modal on Save). Add a company setting later if the user wants a hard block; leaving that out of v1 to avoid workflow disruption per project rules.

## Out of scope for this pass

- Multi-driver auto-reassignment suggestions (only flags; doesn't auto-swap).
- Grouped/chained runs already share a driver — collision math skips within the same `group_id`.
- Push notification to driver about tight schedule (can follow after coordinator UX lands).

## Files to add / edit

- **New:** `src/lib/scheduling.functions.ts`, `src/hooks/use-driver-conflicts.ts`, `src/components/coordinator/ScheduleConflictBanner.tsx`, `src/components/coordinator/ConflictChip.tsx`
- **Edit:** `src/components/coordinator/TripDetailsSheet.tsx`, `src/routes/_authenticated/coordinator.calendar.tsx`, and the driver-assign control (located during build)
- **No migration required** for v1 (buffers hardcoded with sane defaults; can be lifted to `ai_configuration` later without breaking callers).
