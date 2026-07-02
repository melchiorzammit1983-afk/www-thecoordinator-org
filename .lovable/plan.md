## Goal
Make Group and Merge two distinct actions:
- **Group** = link cards into a reversible bundle. Each trip keeps its own from/to/flight/company. Assigning a driver or sharing applies to the whole bundle. Auto-dissolves on completion; coordinator can Ungroup manually.
- **Merge** = existing behavior (fold passengers into the earliest trip, permanent).

## Database
New migration on `jobs`:
- `group_id uuid NULL` — shared id for all trips in a bundle.
- Keep existing `grouped_count`, `grouped_at` (written on every job in the group).
- Index on `group_id`.

No destructive change to already-merged jobs.

## Backend
- `groupJobs(jobIds[])` — assigns a shared `group_id`, stamps `grouped_count`/`grouped_at` on each. Verifies same company + coordinator permission.
- `ungroupJobs(groupId)` — clears `group_id`, `grouped_count`, `grouped_at` on all members.
- Extend `assignDriver` / `shareJobToDriver` / magic-link creation: when target job has `group_id`, apply to every job in the group (same driver, one shared link token covering all members).
- Extend `updateJobStatus`: when the last non-completed job in a group flips to completed/cancelled, auto-clear `group_id` on all members.
- Keep existing merge path (`setJobGrouped`) untouched.

## UI
### BulkActionBar
Two distinct buttons on 2+ selection:
- **Group** (link icon) — calls `groupJobs`. Always enabled for 2+.
- **Merge** (combine icon) — existing flow, keep uniform-warning dialog.

### TripCard
- When `group_id` is set: show a "⛬ Grouped · N" chip and a colored left accent linking bundle members.
- Add **Ungroup** action in the card menu (visible only if `group_id` set).
- Selecting one grouped card shows a "Select whole group" affordance in the bulk bar.

### Driver manifest (`/m.driver.$token`)
- Render grouped trips under one collapsible header with count; each trip row still shows its own from/to/flight/pax.

## Out of scope
- No change to merge semantics.
- No new points/pricing logic.
- No schema changes to `magic_links` beyond writing one token that covers all group members when sharing.

## Files touched
- New migration (jobs.group_id + index)
- `src/lib/coordinator-public.functions.ts`, `src/lib/coordinator.functions.ts`
- `src/components/coordinator/BulkActionBar.tsx`
- `src/components/coordinator/TripCard.tsx`
- `src/routes/coordinator.calendar.tsx` (query invalidations)
- `src/routes/m.driver.$token.tsx`
