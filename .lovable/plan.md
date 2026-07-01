## Problem

The driver portal loads (`/m/driver/$token`) but the dashboard body is empty — no trips to accept, no status buttons.

Root cause: `getDriverManifest` selects from `public.jobs` using the anon (publishable) Supabase client, but `jobs` has no `TO anon` SELECT policy. Row-Level Security silently returns `[]`, so the manifest renders "No trips today or tomorrow." even when the driver has assigned jobs. `pax` has the same gap.

Secondary issues:
- The manifest select omits `status`, so the current-step / next-status button logic can't work even when jobs load.
- The window is hard-limited to today+tomorrow. Any accepted trip further out, or an older pending-deletion trip, disappears.

## Fix (server only, minimal)

Update `src/lib/coordinator-public.functions.ts`:

1. `getDriverManifest` — after `resolveToken`, load jobs via `supabaseAdmin` (import inside the handler, same pattern already used by `loadDriverJob`). Token is already validated, so bypassing RLS is safe and scoped by `company_id` + optional `driver_id`.
2. Add `status` to the jobs select.
3. Broaden the window to `today` … `today + 7 days`, plus always include any job with `deletion_requested_at` set (so drivers can approve pending deletions).
4. Sort by `pickup_at` nulls last, then `date`/`time`.

No client changes required — `JobRow` already renders Accept / status-flow / Approve-deletion buttons and the `Job` type already declares `status?`.

## Verification

- Reload `/m/driver/<token>` in the preview: the driver should now see their assigned jobs with Accept + status-progress buttons.
- Coordinator-side changes (assigning a driver, requesting deletion) reflect on the next portal refresh.

## Out of scope

No schema change, no new RLS policies, no UI redesign — the existing dashboard already supports approval and status changes; it just had no data to render.
