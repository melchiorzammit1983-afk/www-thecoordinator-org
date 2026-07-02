## Grouped-trip flag

Track a group on the merged trip so the card and the driver's manifest both show "Grouped", and clear the flag automatically once the trip is completed.

### DB
Add two columns on `public.jobs`:
- `grouped_count` int null — number of trips merged into this one (>=2 when grouped, null otherwise).
- `grouped_at` timestamptz null — when the merge happened.

No new tables, no policy changes.

### Merge behaviour (Bulk "Group")
`BulkActionBar` merge already moves pax into the earliest trip and deletes the others. Update it to also set `grouped_count = <total merged>` and `grouped_at = now()` on the keeper via a new server fn `setJobGrouped({ job_id, count })` (scoped to the coordinator's company).

If a coordinator groups again later, `count` accumulates (existing count + newly merged).

### Auto-ungroup on completion
When `jobs.status` moves to `completed` (or `finished` — whichever your enum uses; I'll match the current value used by "Trip finished"), clear `grouped_count` and `grouped_at`. Done inside the existing status-transition server fn so it happens no matter who triggers completion (coordinator or driver).

### UI

Coordinator `TripCard`:
- New small badge next to the pax badge: `⛬ Grouped · N trips` (uses primary color).
- Small "Grouped" line under the route when present.

Driver manifest (`src/routes/m.driver.$token.tsx` / mobile timeline):
- Same badge at the top of the trip block: `Grouped · N trips`.
- Passenger list stays as-is (they're already merged into one manifest).

Trip details sheet: show the grouped count in the header meta line.

### Files
- `supabase/migrations/*` — add columns.
- `src/lib/coordinator.functions.ts` — new `setJobGrouped` server fn; extend the status-update fn to null the columns on completion; include `grouped_count`, `grouped_at` in job selects.
- `src/components/coordinator/BulkActionBar.tsx` — call `setJobGrouped` after successful merge.
- `src/routes/_authenticated/coordinator.calendar.tsx` — `Job` type + badge in `TripCard`.
- `src/components/coordinator/TripDetailsSheet.tsx` — show grouped meta.
- Driver manifest route/components — show grouped badge.

### Note
Ungroup = the flag/badge disappears after completion. Passengers stay merged (the original source trips were removed at merge time); if you actually want the trip to split back into the originals after completion, say so and I'll switch to a "keep source trips as archived and restore on finish" model instead.
