
## Goal

Give the driver a **Cancel trip** button on their trip card that is available at **any status** (pending, en-route, arrived, in-progress). Tapping it does **not** cancel immediately — it sends a request to the coordinator, who must approve or reject. Mirrors the existing coordinator-side "request deletion → driver approves" flow, in reverse.

## What's already there

- Coordinator → Driver: `jobs.deletion_requested_at` + `driverApproveDeletion` (coord asks, driver approves).
- Coordinator → Driver edits: `job_coord_change_requests` table + `CoordChangeRequestsPanel` on driver side.
- Driver → Coordinator "Can't make it — Give back" already exists, but only **before** acceptance (`driverRejectJob`). Nothing exists for post-acceptance cancellation.

## Design

### 1. Database (single migration)

Add to `public.jobs`:
- `driver_cancel_requested_at timestamptz`
- `driver_cancel_requested_by uuid` (driver.id)
- `driver_cancel_reason text` (short enum-like string)
- `driver_cancel_note text` (free text)

Index: `create index on jobs (company_id) where driver_cancel_requested_at is not null;` so the coordinator inbox query is cheap.

No new table — this is a single pending flag on the job itself, same shape as `deletion_requested_at`.

### 2. Server functions

**Driver side** — new in `src/lib/coordinator-public.functions.ts`:

- `driverRequestCancel({ token, job_id, reason, note })`
  - Validates token → driver, verifies driver owns the job.
  - Rejects if status is already `cancelled` or `completed`.
  - Sets the four new fields.
  - Inserts a `trip_messages` row (`sender_kind: system`) so both sides see it in chat.
  - Records `trip_audit_log` event `driver_cancel_requested` (uses existing `record_trip_audit`).
  - Returns `{ ok: true }`.

- `driverWithdrawCancelRequest({ token, job_id })` — driver can retract before coord decides. Clears the fields, posts system message.

**Coordinator side** — new in `src/lib/coordinator.functions.ts`:

- `listPendingDriverCancels()` — returns jobs in the coordinator's company with `driver_cancel_requested_at is not null` (for a small inbox badge/panel).
- `decideDriverCancelRequest({ job_id, decision: "approve" | "reject", note? })`
  - `approve` → `status = 'cancelled'`, closes any open `job_wait_sessions`, clears `driver_cancel_requested_*`, posts system message, audit `driver_cancel_approved`.
  - `reject` → clears the four fields, posts system message, audit `driver_cancel_rejected`. Trip continues.

### 3. Driver UI (`src/routes/m.driver.$token.tsx`)

- Add a **red outline "Cancel trip"** button in `JobCard`, always shown when `job.status !== 'cancelled' && job.status !== 'completed'` and `job.driver_accepted_at` is set (post-acceptance). The existing pre-acceptance "Can't make it — Give back" stays as-is.
- When `job.driver_cancel_requested_at` is set: replace the button with a yellow "Waiting for coordinator approval to cancel…" pill + a "Withdraw request" link.
- Reuses the existing reason/note dialog pattern from `rejectOpen` (reasons: *No longer available*, *Vehicle issue*, *Passenger issue*, *Safety concern*, *Other*).
- Available even in Safety Mode (safety > convenience — but confirms via native dialog).

### 4. Coordinator UI

- On each job row / trip card in the dispatch list (`DispatchTripList` or equivalent), when `driver_cancel_requested_at` is set, show an amber banner:
  - "Driver requested cancellation — {reason}. {note}"
  - **Approve cancel** (destructive) + **Reject** buttons wired to `decideDriverCancelRequest`.
- Add the pending-cancel count to the existing `RouteOptimizationAlerts` / notification bell so coordinators see it in real time (piggybacks on the same realtime `jobs` channel — no new subscription).

### 5. Audit & chat coverage

Every state change (request / withdraw / approve / reject) posts a `trip_messages` system row AND calls `record_trip_audit` — so the immutable trip audit chain records the full lifecycle.

## Out of scope

- No auto-reassignment on approval. The trip becomes `cancelled`; coordinator can duplicate / reassign manually if needed.
- No payment/fare reversal logic — cancellation just changes status.
- No client-portal notification of a *pending* driver cancel (client sees it only if coord approves and status flips to cancelled).

## Files touched

- `supabase/migrations/…driver_cancel_request.sql` (new)
- `src/lib/coordinator-public.functions.ts` (add 2 fns)
- `src/lib/coordinator.functions.ts` (add 2 fns)
- `src/routes/m.driver.$token.tsx` (button + pending-state UI + dialog)
- Coordinator dispatch component that renders each trip row (banner + Approve/Reject) — will identify exact file during implementation (likely `src/components/coordinator/DispatchTripList.tsx` and/or `TripDetailsSheet.tsx`).

## Confirm before I build

1. **Button placement**: single "Cancel trip" button post-acceptance (keeping today's pre-acceptance "Give back"), or one unified button at every status?
2. **Coordinator can also force-cancel** without driver consent (today's behavior via status change), or should coordinator cancellations also become mutual after acceptance? I'll keep coordinator's existing power unchanged unless you say otherwise.
