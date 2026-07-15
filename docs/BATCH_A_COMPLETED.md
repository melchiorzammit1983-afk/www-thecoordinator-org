# Batch A — Completed

**Phases covered:** Phase 2 (Waiting System) + Phase 3 (Passenger Boarding System)  
**Completed:** 2026-07-15  
**Status:** ✅ Ready for testing and merge

---

## Table of Contents

1. [Objectives Completed](#1-objectives-completed)
2. [Files Modified](#2-files-modified)
3. [Database Changes](#3-database-changes)
4. [API Changes](#4-api-changes)
5. [Driver UI Changes](#5-driver-ui-changes)
6. [Coordinator UI Changes](#6-coordinator-ui-changes)
7. [Waiting System Workflow](#7-waiting-system-workflow)
8. [Passenger Boarding Workflow](#8-passenger-boarding-workflow)
9. [Approval Workflow](#9-approval-workflow)
10. [Override Workflow](#10-override-workflow)
11. [Known Risks](#11-known-risks)
12. [Rollback Instructions](#12-rollback-instructions)

---

## 1. Objectives Completed

### Phase 2 — Waiting System

| Objective | Status |
|---|---|
| Auto-start wait session on `arrived` status transition | ✅ Done |
| Per-company configurable free wait period (`free_wait_minutes`) | ✅ Done |
| Per-company configurable waiting rate (`waiting_rate_per_minute`) | ✅ Done |
| `free_ends_at` timestamp computed server-side on session open | ✅ Done |
| Live charge calculation: `(elapsed − free window) × rate` | ✅ Done |
| Auto-close wait session on `en_route` status transition | ✅ Done |
| `calculated_amount` (immutable, system-computed) stored on session close | ✅ Done |
| `agreed_amount` (final, updated only when coordinator proposal accepted) | ✅ Done |
| Coordinator can propose a waiting charge adjustment | ✅ Done |
| Driver can accept or reject coordinator proposals | ✅ Done |
| One-open-proposal-per-session uniqueness enforced | ✅ Done |

### Phase 3 — Passenger Boarding System

| Objective | Status |
|---|---|
| `cancelled` value added to `pax_status` ENUM | ✅ Done |
| `noshow_at` and `cancelled_at` timestamps on `pax` rows | ✅ Done |
| Driver can mark passengers as Cancelled | ✅ Done |
| All passengers must have a non-`pending` status before `in_progress` | ✅ Done |
| Driver can request coordinator approval for partial boarding | ✅ Done |
| Coordinator can approve or reject partial boarding | ✅ Done |
| Driver can override coordinator approval after 5-minute timeout | ✅ Done |
| `pax_summary` snapshot stored on boarding approval request | ✅ Done |
| One-open-approval-per-job uniqueness enforced | ✅ Done |

---

## 2. Files Modified

### New Migrations (Supabase)

| File | Purpose |
|---|---|
| `supabase/migrations/20260709144000_batch_a_step1_waiting_and_boarding_schema.sql` | Adds `free_wait_minutes`, `waiting_rate_per_minute` to `companies`; adds `auto_started`, `free_ends_at` to `job_wait_sessions`; creates `job_wait_proposals` table; adds `cancelled` to `pax_status` ENUM; adds `noshow_at`, `cancelled_at` to `pax`; creates `job_boarding_approvals` table |
| `supabase/migrations/20260709150000_batch_a_step2_waiting_logic.sql` | Adds `calculated_amount` (immutable system field) to `job_wait_sessions` |

### Server Functions

| File | Changes |
|---|---|
| `src/lib/coordinator-public.functions.ts` | Modified `updateJobStatus` (auto-start wait on `arrived`, auto-close wait on `en_route`, boarding gate on `in_progress`); added `markPaxCancelled`, `requestBoardingApproval`, `driverOverrideBoardingApproval`, `getBoardingApprovalStatusDriver`, `getWaitProposalsForDriver`, `respondWaitProposal` |
| `src/lib/coordinator.functions.ts` | Added `proposeWaitAdjustment`, `listWaitProposals`, `cancelWaitProposal`, `respondBoardingApproval`, `getBoardingApprovalStatus`, `listPendingBoardingApprovals` |

### UI Components

| File | Changes |
|---|---|
| `src/components/driver/DriverWaitingPanel.tsx` | Added live charge display, free window countdown, coordinator proposal accept/reject |
| `src/components/coordinator/TripDetailsSheet.tsx` | Added wait proposal panel (propose/cancel/view), boarding approval card (approve/reject) |
| `src/routes/m.driver.$token.tsx` | Added `Cancelled` pax action, partial boarding approval request flow, 5-min countdown, override confirmation dialog |
| `src/routes/_authenticated/coordinator.calendar.tsx` | Added pending boarding approvals banner polling |

---

## 3. Database Changes

### `companies` table — new columns

| Column | Type | Default | Constraint |
|---|---|---|---|
| `free_wait_minutes` | `integer NOT NULL` | `5` | `0 ≤ x ≤ 120` |
| `waiting_rate_per_minute` | `numeric(10,2) NOT NULL` | `0.00` | `0 ≤ x ≤ 100000` |

### `job_wait_sessions` table — new columns

| Column | Type | Default | Notes |
|---|---|---|---|
| `auto_started` | `boolean NOT NULL` | `false` | Set to `true` when session is opened by `updateJobStatus` |
| `free_ends_at` | `timestamptz` | `NULL` | `started_at + free_wait_minutes`; NULL when `free_wait_minutes = 0` |
| `calculated_amount` | `numeric(10,2)` | `NULL` | System-computed on close; immutable thereafter |

### New table — `job_wait_proposals`

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid PK` | |
| `job_id` | `uuid NOT NULL → jobs` | |
| `session_id` | `uuid → job_wait_sessions` | |
| `company_id` | `uuid` | |
| `proposed_by_user_id` | `uuid → auth.users` | Coordinator who proposed |
| `proposed_amount` | `numeric(10,2) NOT NULL` | `0 ≤ x ≤ 100000` |
| `note` | `text` | Optional coordinator note |
| `status` | `text NOT NULL` | `pending` / `accepted` / `rejected` |
| `driver_response_note` | `text` | Driver's optional response |
| `responded_at` | `timestamptz` | |
| `created_at` / `updated_at` | `timestamptz` | |

Indexes: `job_id`, `session_id`, open-by-job (partial), **unique** one-open-per-session (partial).  
RLS: read by company-scoped users; write by owning/executor company.

### `pax` table — new columns

| Column | Type | Notes |
|---|---|---|
| `noshow_at` | `timestamptz` | Set when driver marks no-show |
| `cancelled_at` | `timestamptz` | Set when driver marks cancelled |

### `pax_status` ENUM — new value

`cancelled` added (additive, irreversible).

### New table — `job_boarding_approvals`

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid PK` | |
| `job_id` | `uuid NOT NULL → jobs` | |
| `driver_id` | `uuid → drivers` | |
| `company_id` | `uuid` | |
| `requested_by_user_id` | `uuid → auth.users` | |
| `status` | `text NOT NULL` | `pending` / `approved` / `rejected` / `overridden` |
| `requested_at` | `timestamptz NOT NULL` | Used for 5-min override gate |
| `responded_at` | `timestamptz` | |
| `override_at` | `timestamptz` | Set when driver overrides |
| `coordinator_note` | `text` | |
| `driver_note` | `text` | |
| `pax_summary` | `jsonb` | Snapshot: `{on_board, no_show, cancelled, pending}` |
| `created_at` / `updated_at` | `timestamptz` | |

Indexes: `job_id`, `driver_id`, pending-by-job (partial), **unique** one-open-per-job (partial).  
RLS: read by company-scoped users; write by owning/executor company.

---

## 4. API Changes

### coordinator-public.functions.ts

| Function | Type | Description |
|---|---|---|
| `updateJobStatus` | Modified | On `arrived`: auto-open `job_wait_sessions` row. On `en_route`: auto-close open wait session. On `in_progress`: gate — all pax must be non-`pending`, OR an `approved`/`overridden` boarding approval must exist. |
| `markPaxCancelled` | New | Sets `pax.status = 'cancelled'`, `cancelled_at = now()`. Requires job status `arrived` or `in_progress`. |
| `requestBoardingApproval` | New | Creates `job_boarding_approvals` row with `pax_summary` snapshot. One open approval per job enforced. |
| `driverOverrideBoardingApproval` | New | Sets `status = 'overridden'`, `override_at = now()`. Only allowed if `requested_at + 5 min < now()` and status is still `pending`. |
| `getBoardingApprovalStatusDriver` | New | Returns current boarding approval status for the driver's job. |
| `getWaitProposalsForDriver` | New | Returns open and recent wait proposals for the driver's job. |
| `respondWaitProposal` | New | Driver accepts or rejects a coordinator wait proposal. On `accepted`, updates `job_wait_sessions.agreed_amount` and the corresponding `job_adjustments` row. |

### coordinator.functions.ts

| Function | Type | Description |
|---|---|---|
| `proposeWaitAdjustment` | New | Coordinator creates a `job_wait_proposals` row. Validates one open proposal per session. |
| `listWaitProposals` | New | Returns proposals (open + recent) for a job — used by coordinator panel. |
| `cancelWaitProposal` | New | Coordinator cancels a pending proposal. |
| `respondBoardingApproval` | New | Coordinator approves or rejects a pending boarding approval. |
| `getBoardingApprovalStatus` | New | Returns current boarding approval for a job — used by coordinator panel. |
| `listPendingBoardingApprovals` | New | Returns all jobs with pending boarding approvals for a company — used by coordinator calendar. |

---

## 5. Driver UI Changes

### `DriverWaitingPanel.tsx`

| Change | Detail |
|---|---|
| Auto-start indicator | Banner shows "Waiting timer started automatically at HH:MM" when `auto_started = true`. Manual "Start waiting" button hidden for auto-started sessions. |
| Free window countdown | "Free waiting: X min remaining" pill during grace period. "Free window expired" after grace. |
| Live charge display | "Estimated charge: €X.XX" — computed as `(elapsed_sec − free_secs) / 60 × rate_per_min`. Shows zero during free window. |
| Coordinator proposal | New section: "Coordinator has proposed €X.XX — Accept / Reject" with optional note. Polling every 10 s while session is open. |

### `m.driver.$token.tsx` — Passenger Boarding

| Change | Detail |
|---|---|
| `Cancelled` button | Third action alongside "Confirm" and "No-show" for each passenger. |
| `Cancelled` badge | Amber/orange badge displayed on cancelled passengers. |
| All-pax enforcement | Before proceeding to `in_progress`, checks locally that no pax is still `pending`. |
| Partial boarding request | "Request coordinator approval" button visible when any pax is `pending`. Calls `requestBoardingApproval`. |
| Countdown timer | "Waiting for coordinator — X:XX remaining" after request is sent. |
| Override button | Appears after 5-minute countdown. Opens confirmation dialog before calling `driverOverrideBoardingApproval`. |

---

## 6. Coordinator UI Changes

### `TripDetailsSheet.tsx` — Wait Proposals Panel

| Change | Detail |
|---|---|
| Free window badge | Shows "In free window" or "Chargeable since HH:MM" based on `free_ends_at`. |
| Live charge estimate | Mirrors the driver's computed charge display. |
| "Propose adjustment" button | Opens dialog: amount + optional note → calls `proposeWaitAdjustment`. Disabled when a proposal is already pending. |
| Proposal status | Shows current proposal status (pending / accepted / rejected) with driver's response note. |
| Cancel proposal | Coordinator can cancel a pending proposal. |

### `TripDetailsSheet.tsx` — Boarding Approval Panel

| Change | Detail |
|---|---|
| Approval alert card | High-priority alert shown when a `pending` boarding approval exists: "Driver is waiting for boarding approval — X on board, Y no-show, Z cancelled, W pending." |
| Approve / Reject buttons | Approve allows `in_progress` transition; Reject sends message to driver. |
| Coordinator note | Optional note field on both approve and reject. |

### `coordinator.calendar.tsx`

| Change | Detail |
|---|---|
| Pending boarding approvals banner | Polls `listPendingBoardingApprovals` every 30 s and shows an alert when any jobs need boarding approval. |

---

## 7. Waiting System Workflow

```
Driver marks → ARRIVED
      │
      ▼
job_wait_sessions row auto-inserted
  auto_started = true
  started_at   = now()
  free_ends_at = started_at + free_wait_minutes
      │
      ├── During free window ──────────────────────────────────────────────────
      │   Driver UI: "Free waiting: X min remaining"
      │   Charge accumulation: €0.00
      │
      └── After free_ends_at ──────────────────────────────────────────────────
          Driver UI: live charge = (elapsed − free_secs) / 60 × rate_per_min
          Coordinator UI: mirrors live charge, can propose adjustment
                │
                ▼
          [Optional] Coordinator proposes amount (job_wait_proposals)
                │
                ├── Driver ACCEPTS → agreed_amount updated on session + adjustment row
                └── Driver REJECTS → status = rejected; coordinator may re-propose
                                              │
                                              ▼
Driver marks → EN_ROUTE
      │
      ▼
Open job_wait_sessions row auto-closed
  ended_at          = now()
  calculated_amount = max(0, (elapsed_sec − free_secs) / 60 × rate)   ← immutable
  agreed_amount     = calculated_amount (unless overridden by accepted proposal)
job_adjustments row written for billing
```

---

## 8. Passenger Boarding Workflow

```
Job status: ARRIVED
      │
      ▼
Driver reviews passenger list
  For each passenger, driver can:
    [Confirm]   → pax.status = 'onboard',   boarded_at = now()
    [No-show]   → pax.status = 'noshow',    noshow_at  = now()
    [Cancelled] → pax.status = 'cancelled', cancelled_at = now()
      │
      ├── ALL passengers have a final status (onboard / noshow / cancelled)
      │   → Driver taps "Proceed" → updateJobStatus('in_progress') succeeds immediately
      │
      └── SOME passengers still 'pending'
          → Driver sees "Request coordinator approval" button
          → requestBoardingApproval() called
            pax_summary snapshot stored {on_board, no_show, cancelled, pending}
                │
                └── See Approval Workflow (§9)
```

---

## 9. Approval Workflow

```
requestBoardingApproval() called by driver
      │
      ▼
job_boarding_approvals row inserted (status = 'pending')
Coordinator sees alert in TripDetailsSheet + calendar banner
      │
      ├── Coordinator APPROVES (respondBoardingApproval 'approved')
      │     status = 'approved', responded_at = now()
      │     Driver proceeds: updateJobStatus('in_progress') succeeds
      │
      ├── Coordinator REJECTS (respondBoardingApproval 'rejected')
      │     status = 'rejected', responded_at = now()
      │     Driver returns to boarding screen to resolve remaining pax
      │
      └── Coordinator does NOT respond within 5 minutes
            → Driver override button becomes available (see Override Workflow §10)
```

---

## 10. Override Workflow

```
Boarding approval request sent (status = 'pending')
      │
      ▼
Driver waits — countdown timer shows time elapsed since request
      │
      ▼  (requested_at + 5 min < now())
"Override — proceed without approval" button appears
      │
      ▼  Driver confirms AlertDialog
driverOverrideBoardingApproval() called
      │  Server validates: status still 'pending' AND 5-min window elapsed
      ▼
job_boarding_approvals.status = 'overridden'
job_boarding_approvals.override_at = now()
Driver proceeds: updateJobStatus('in_progress') succeeds
  (gate accepts status IN ('approved', 'overridden'))
```

---

## 11. Known Risks

### Phase 2 — Waiting System

| Risk | Severity | Status |
|---|---|---|
| Race condition on auto-start (duplicate sessions) | Medium | Mitigated — partial unique index on `(job_id) WHERE ended_at IS NULL` prevents duplicates; server also checks for existing open session before insert |
| Clock drift between client and server | Low | Mitigated — all timestamps computed server-side; client timer is display-only |
| Driver disputes auto-computed charge | High | Mitigated — coordinator proposal / driver approval flow exists |
| Waiting charge not stopped on job cancellation | Medium | **Partial** — `updateJobStatus` closes open sessions on `en_route`; cancellation path should also call `closeOpenWaitSession` — verify in testing |
| `free_wait_minutes = 0` means immediate charging | Low | Expected behaviour; settings UI must document this clearly |
| Existing sessions without `free_ends_at` (pre-migration) | Low | Mitigated — backend treats `NULL` as "use company default"; no crashes observed |
| `calculated_amount` vs `agreed_amount` divergence | Low | By design — `calculated_amount` is immutable; `agreed_amount` changes only on accepted proposal |

### Phase 3 — Passenger Boarding System

| Risk | Severity | Status |
|---|---|---|
| Driver bypasses boarding gate | High | Mitigated — server-side gate in `updateJobStatus` enforces all-pax or approved/overridden approval |
| `cancelled` ENUM value irreversible | Low | Accepted — additive only; no existing data affected |
| 5-min coordinator timeout on poor mobile connection | Medium | Mitigated — countdown is client-side display; override eligibility validated server-side using `requested_at` |
| Coordinator offline / unavailable | High | Mitigated — driver override after 5 min ensures operations are never permanently blocked |
| Double-tap override | Low | Mitigated — server validates `status = 'pending'` before setting `overridden`; UI disables button while mutation is pending |
| Jobs with zero pax | None | Gate skips if no pax rows exist; transition proceeds normally |

---

## 12. Rollback Instructions

### ⚠️ Before rollback

Ensure no live jobs are using the `cancelled` pax status, active `job_wait_proposals`, or `job_boarding_approvals` rows. Rolling back with live data in these tables may cause orphaned records.

### Database rollback

Execute in order (each step is safe to run even if the previous step failed):

```sql
-- Step 1: Remove boarding approvals table (no downstream dependents)
DROP TABLE IF EXISTS public.job_boarding_approvals;

-- Step 2: Remove wait proposals table (no downstream dependents)
DROP TABLE IF EXISTS public.job_wait_proposals;

-- Step 3: Remove new pax columns
ALTER TABLE public.pax
  DROP COLUMN IF EXISTS noshow_at,
  DROP COLUMN IF EXISTS cancelled_at;

-- Step 4: Remove new wait session columns
ALTER TABLE public.job_wait_sessions
  DROP COLUMN IF EXISTS auto_started,
  DROP COLUMN IF EXISTS free_ends_at,
  DROP COLUMN IF EXISTS calculated_amount;

-- Step 5: Remove new company columns
ALTER TABLE public.companies
  DROP COLUMN IF EXISTS free_wait_minutes,
  DROP COLUMN IF EXISTS waiting_rate_per_minute;

-- ⚠️  Step 6 (pax_status ENUM):
-- PostgreSQL does NOT support removing ENUM values.
-- The 'cancelled' value will remain in the ENUM but will be unused.
-- Ensure no pax rows have status = 'cancelled' before rollback:
SELECT COUNT(*) FROM public.pax WHERE status = 'cancelled';
-- If count > 0, update or delete those rows first.
```

### Application rollback

| Component | Rollback action |
|---|---|
| `coordinator-public.functions.ts` | Revert `updateJobStatus` to remove auto-start, auto-close wait, and boarding gate. Remove `markPaxCancelled`, `requestBoardingApproval`, `driverOverrideBoardingApproval`, `getBoardingApprovalStatusDriver`, `getWaitProposalsForDriver`, `respondWaitProposal`. |
| `coordinator.functions.ts` | Remove `proposeWaitAdjustment`, `listWaitProposals`, `cancelWaitProposal`, `respondBoardingApproval`, `getBoardingApprovalStatus`, `listPendingBoardingApprovals`. |
| `DriverWaitingPanel.tsx` | Revert to previous version (restore manual start button, remove live charge display, remove coordinator proposal section). |
| `TripDetailsSheet.tsx` | Remove wait proposal panel and boarding approval card. |
| `m.driver.$token.tsx` | Remove `Cancelled` pax button, partial boarding approval request flow, countdown timer, and override confirmation dialog. |
| `coordinator.calendar.tsx` | Remove pending boarding approvals banner. |

### Feature flag recommendation

Wrap both phases behind per-company feature flags (e.g., `features.auto_waiting`, `features.boarding_approval`) so they can be toggled per company without a code rollback.
