## Goal

Once the assigned driver has accepted a trip (`driver_accepted_at` set) OR the trip has progressed past `pending` (assigned / en_route / arrived / in_progress), the coordinator can no longer edit it directly. Any change becomes a **change request** that the driver must approve or reject from the driver manifest — mirroring the existing 2-hour client-booking pattern.

## Locked actions

For a locked trip, these coordinator actions require driver approval:

- **Trip details** — from/to, pickup date/time, pax count, room number, vehicle, contact phone, flight numbers, `qr_strict_mode`, `tracking_enabled`.
- **Driver reassignment** — swap to another driver, or unassign.
- **Cancel / delete / hide** — soft `status="cancelled"`, `deleteJob` (already partially pending), hide.
- **Fare / price** — new price proposals or edits to agreed fare.

Labels and internal-only notes stay editable (not driver-visible).

## Lock trigger

A trip is **locked** when either is true:
- `driver_accepted_at IS NOT NULL`, OR
- `status <> 'pending'` (i.e. driver has already progressed it).

Admin accounts bypass the lock (existing `is_admin` check).

## Data model

New table `public.job_coord_change_requests`:

```text
id uuid pk
job_id uuid → jobs (cascade)
company_id uuid
requested_by uuid (auth user)
kind text  -- 'edit' | 'reassign' | 'cancel' | 'delete' | 'price'
requested_changes jsonb -- {from_location, to_location, pickup_at, driver_id, ...}
note text
status text default 'pending' -- pending | approved | rejected | cancelled
decided_at timestamptz
decided_by_driver_id uuid → drivers
decided_note text
created_at / updated_at
```

RLS: coordinators of the job's company can `SELECT`/`INSERT`/`UPDATE own`; driver reads/updates via the driver token path (service role, scoped by `job_id + driver_id`); admin all. Standard GRANTs.

Index: `(job_id, status)`.

## Server functions

New in `src/lib/coordinator.functions.ts`:

- `requestJobChange({ job_id, kind, requested_changes, note })` — creates a pending change request, posts a system `trip_messages` row in `driver_coord` thread ("Coordinator requested a change — please review"), returns the request.
- `listJobChangeRequests({ job_id })` — for the trip details sheet.
- `cancelJobChangeRequest({ id })` — coordinator withdraws a pending request.

Modify existing:

- `updateJob`, `assignDriver`, `updateJobStatus` (cancelled path), `deleteJob`, price-proposal write paths: **if locked**, do NOT mutate; instead delegate to `requestJobChange` under the appropriate `kind` and return `{ pending: true, request_id }`.
- `deleteJob` already has a pending flow for `driver_accepted_at` — refactor to reuse the new table so all approval flows live in one place. Keep `deletion_requested_at` for backwards compat until UI is migrated in the same PR.

New in `src/lib/coordinator-public.functions.ts` (token-authenticated driver endpoints):

- `listPendingCoordChangesForDriver({ token })` — pending requests for jobs assigned to the driver.
- `decideCoordChangeRequest({ token, request_id, approve, note })` — on approve, apply the `requested_changes` patch server-side using admin client, close the request, post system message; on reject, mark rejected with reason.

## UI

- **Trip details sheet** (`src/components/coordinator/TripDetailsSheet.tsx`): show a locked badge, list pending change requests with cancel button, disable direct-edit buttons in favor of "Request change".
- **JobFormDialog**: when opened for a locked trip, header shows "Change request — needs driver approval"; Save submits `requestJobChange` instead of `updateJob`. Fare/price panel same treatment.
- **Reassign driver menu**: same routing when locked.
- **Cancel / Delete**: rename to "Request cancellation" / "Request deletion" on locked trips.
- **Driver manifest** (`src/routes/m.driver.$token.tsx`): new "Coordinator requested a change" card per job showing the diff (before → after), Approve / Reject buttons + optional note. Toast + optimistic update.

## Notifications

- System `trip_messages` in `driver_coord` thread on request, approve, reject, cancel.
- Reuse existing push infra (`driver_push_subs`) — send a push on request creation.

## Copy / UX rules

- Locked badge in coordinator UI: "Driver accepted — changes need driver approval".
- Diff view lists only fields that changed vs current job.
- Coordinator can have at most one pending request of each `kind` per job (unique partial index on `(job_id, kind) where status='pending'`).

## Testing

- Assign + driver accepts → edit from/to → verify no direct DB change, pending request row created, driver sees it and can approve → job updated; reject → job untouched.
- Delete flow migrated: locked trip → deletion request → driver approves → job deleted.
- Reassign locked trip → new driver only sees the job after old driver approves.
- Admin edit on locked trip → still allowed (bypass).
- Unlocked (pending, no `driver_accepted_at`) → coordinator edits directly, no request created (regression).

## Out of scope

- Labels + internal notes remain directly editable.
- Emergency-override paths (driver-initiated) unchanged.
- No changes to client portal / 2-hour client rule.
