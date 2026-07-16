# Periodic ETA polling for coordinator badges

## Goal
Keep the ETA chips on the coordinator dashboard (`/coordinator`) and calendar (`/coordinator/calendar`) fresh without a manual reload. Today `useEnrichVisibleJobs` only re-runs when the visible job id list changes, so a card that's been open for a few minutes shows stale "Live"/"Planned" values until the underlying query happens to refetch.

## Approach
Extend the existing `src/hooks/use-enrich-jobs.ts` hook with an internal polling loop. No new server work, no schema changes — the server function `backfillJobEnrichment` already knows how to refresh names + ETAs and the row-level React Query invalidation is already wired.

### Behaviour
- Every `POLL_MS` (default **60s**), re-evaluate which visible jobs need work and fire one batched backfill (max 40 ids, same as today).
- A job is considered "needs polling" when either:
  - `live_eta_updated_at` is older than `LIVE_STALE_MS` (default **90s**), OR
  - existing conditions in the hook (missing display name, missing/stale `route_duration_sec` > 30 min).
- Keep the current per-job debounce (60s) so bursts don't stack.
- Pause polling while `document.visibilityState === "hidden"` and resume on `visibilitychange` — no wasted calls / points when the tab is backgrounded.
- After a successful backfill, invalidate the caller-supplied React Query keys (already implemented) so the components re-read `live_eta_sec` / `live_eta_updated_at`.

### Consumers
- `src/routes/_authenticated/coordinator.index.tsx` — already calls `useEnrichVisibleJobs(enrichable, [["coord-dash-activity"]])`. No changes needed; polling kicks in automatically.
- `src/routes/_authenticated/coordinator.calendar.tsx` — already calls `useEnrichVisibleJobs(jobs, [["jobs"]])`. Same, no change needed.

## Technical details
1. In `src/hooks/use-enrich-jobs.ts`:
   - Add `EnrichableJob.live_eta_updated_at?: string | null` to the type.
   - Extract the "compute needsWork + dispatch" logic into a `runOnce()` closure inside the effect.
   - Set up `setInterval(runOnce, POLL_MS)` + a `visibilitychange` listener that clears/restarts the interval.
   - Keep the existing initial `runOnce()` on job-id-list change so first paint still enriches immediately.
   - Cleanup: `clearInterval` and remove the visibility listener on unmount / deps change.
2. No API surface change — both existing call sites keep working.
3. Guardrails already in place we're relying on:
   - Per-job 60s debounce prevents duplicate spend.
   - Server-side feature flags (`address_name_resolve`, `route_eta`) still gate charging.
   - `backfillJobEnrichment` skips jobs it can't improve, so idle rows cost nothing.

## Out of scope
- No changes to badge rendering or `describeEtaFreshness` copy.
- No realtime subscription for `jobs.live_eta_*` (heavier; can revisit if 60s polling isn't enough).
- No changes to `TripEventsMap`'s own trip-map query (it already has its own refresh).
