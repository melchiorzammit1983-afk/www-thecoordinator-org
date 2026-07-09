# Batch A Implementation Plan
## Phase 2 — Waiting System · Phase 3 — Passenger Boarding System

**Prepared:** 2026-07-09  
**Status:** Pre-implementation  
**Scope:** Phase 2 (Waiting System) + Phase 3 (Passenger Boarding System)

---

## Table of Contents

1. [Current Waiting System Analysis](#1-current-waiting-system-analysis)
2. [Current Passenger Boarding Analysis](#2-current-passenger-boarding-analysis)
3. [Files That Will Be Modified](#3-files-that-will-be-modified)
4. [Database Changes Required](#4-database-changes-required)
5. [APIs Affected](#5-apis-affected)
6. [UI Changes Required](#6-ui-changes-required)
7. [Risks](#7-risks)
8. [Rollback Plan](#8-rollback-plan)
9. [Testing Strategy](#9-testing-strategy)

---

## 1. Current Waiting System Analysis

### What currently exists

| Layer | Current behaviour |
|---|---|
| **Trigger** | Driver manually taps "Start waiting" in `DriverWaitingPanel`. Auto-suggest toasts fire after 5 min of GPS stop or 60 min at an airport — but the driver must still tap Start. |
| **Free period** | Not implemented. The clock starts from `started_at` with no grace deduction. |
| **Rate / charge calc** | Agreed amount is typed by the driver at stop time (manual negotiation). No per-minute rate or live charge is computed. |
| **Stop trigger** | Driver manually taps "Stop waiting" and enters an amount. |
| **Coordinator view** | `TripWaitAdjustmentsPanel` in `TripDetailsSheet` shows a live elapsed timer and any saved adjustments — read-only. |
| **Coordinator proposal** | Not implemented. Coordinators have no way to propose a waiting-charge override. |
| **Driver approval** | Not implemented. No approval/rejection flow between coordinator and driver. |
| **Charge stop rule** | No enforced rule. Driver can stop the timer at any time, regardless of job status. |
| **Configuration** | No per-company `free_wait_minutes` or `waiting_rate_per_minute` columns exist yet. |

### Key tables

- **`job_wait_sessions`** — one open session per job (partial unique index). Stores `started_at`, `ended_at`, `agreed_amount`, `source`, `driver_note`.
- **`job_adjustments`** — line items: `waiting`, `extra_stop`, `toll`, `other`. Each waiting session produces one adjustment row when stopped.

### Gaps against Phase 2 requirements

| Requirement | Gap |
|---|---|
| Auto-start on `arrived` | Missing — only auto-suggest toasts exist |
| Free 5-min window | Missing |
| Configurable free time | Missing (no DB column) |
| Live waiting charges (rate × elapsed beyond free period) | Missing — no rate column, no live calc |
| Charges stop only when `en_route` | Missing — driver manually stops, any time |
| Coordinator proposes adjustment | Missing |
| Driver approves/rejects proposal | Missing |

---

## 2. Current Passenger Boarding Analysis

### What currently exists

| Layer | Current behaviour |
|---|---|
| **Driver UI** | `TripExecutionDialog` in `m.driver.$token.tsx` — full-page dialog listing all passengers. Each has "Confirm" (→ `onboard`) and "No-show" buttons, plus "Undo" to reset to `pending`. |
| **Boarding methods** | `markPaxOnboard` (manual or qr), `markPaxNoShow`, `markPaxPending` (undo). All are server functions in `coordinator-public.functions.ts`. |
| **pax_status ENUM** | `pending`, `verified`, `onboard`, `delayed`, `noshow`, `completed`. No `cancelled` value. |
| **Timestamps** | `boarded_at` and `boarded_method` exist on `pax`. No `noshow_at` or `cancelled_at`. |
| **Partial boarding approval** | Not implemented — driver can mark any subset and proceed. |
| **Coordinator approval flow** | Not implemented. |
| **Driver override timeout** | Not implemented. |
| **Enforcement** | No check that all passengers have a final status before allowing `in_progress`. |

### Gaps against Phase 3 requirements

| Requirement | Gap |
|---|---|
| `Cancelled` as a pax status | Missing from `pax_status` ENUM |
| All passengers must have a status | Missing — no enforcement gate |
| Record `noshow_at` | Missing column |
| Record `boarded_at` | ✅ Already exists |
| Partial boarding requires coordinator approval | Missing — flow does not exist |
| Driver may override after 5 min with no response | Missing |
| `Cancelled` pax recording | Missing |

---

## 3. Files That Will Be Modified

### New migrations (Supabase)

| File (to be created) | Purpose |
|---|---|
| `supabase/migrations/<ts>_phase2_waiting_system.sql` | Add `free_wait_minutes`, `waiting_rate_per_minute` to `companies`; add `auto_started_at`, `free_ends_at` to `job_wait_sessions`; add `coord_wait_proposals` table |
| `supabase/migrations/<ts>_phase3_pax_boarding.sql` | Add `cancelled` to `pax_status` ENUM; add `noshow_at`, `cancelled_at`, `boarding_approval_status`, `boarding_approval_requested_at` to `pax`; add `job_boarding_approvals` table |

### Source files — Server functions

| File | Change |
|---|---|
| `src/lib/coordinator-public.functions.ts` | Modify `updateJobStatus` to auto-start wait session on `arrived`; modify `stopWaitSession` to enforce `en_route` gate; add `proposeWaitAdjustment`, `respondWaitProposal`; add `markPaxCancelled`; add `requestBoardingApproval`; add `approveBoardingPartial` (driver override); enforce all-pax-status gate in `updateJobStatus` before allowing `in_progress` |
| `src/lib/coordinator.functions.ts` | Add `respondBoardingApproval` (coordinator approves/rejects partial boarding); add `listWaitProposals`, `respondToWaitProposal` |

### Source files — UI components

| File | Change |
|---|---|
| `src/components/driver/DriverWaitingPanel.tsx` | Add live charge display (elapsed beyond free window × rate); remove manual "Start waiting" button (auto-start, show state); retain "Stop waiting" only if manual-stop is permitted (else stop is auto on `en_route`); show pending coordinator proposals with Accept/Reject |
| `src/components/coordinator/TripDetailsSheet.tsx` | Expand `TripWaitAdjustmentsPanel` to show free window countdown and live charges; add "Propose adjustment" button for coordinator |
| `src/routes/m.driver.$token.tsx` | Add `Cancelled` button to `TripExecutionDialog`; add "Request boarding approval" flow when partial (not all pax boarded); add 5-min countdown for coordinator response; add driver override confirmation |

### Source files — Admin / Settings

| File | Change |
|---|---|
| `src/routes/_authenticated/admin.*.tsx` (admin settings) | Add `free_wait_minutes` and `waiting_rate_per_minute` per-company fields |
| `src/components/coordinator/` (new file) `WaitProposalPanel.tsx` | Coordinator panel to propose adjusted waiting amounts and see driver responses |

---

## 4. Database Changes Required

### Phase 2 — Waiting System

#### A. `companies` table — new columns

```sql
ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS free_wait_minutes   integer NOT NULL DEFAULT 5
    CHECK (free_wait_minutes >= 0 AND free_wait_minutes <= 120),
  ADD COLUMN IF NOT EXISTS waiting_rate_per_minute numeric(6,2) NOT NULL DEFAULT 0.00
    CHECK (waiting_rate_per_minute >= 0 AND waiting_rate_per_minute <= 1000);
```

- `free_wait_minutes` — per-company configurable grace period (default 5).
- `waiting_rate_per_minute` — rate charged per minute after free window (default 0.00 = manual).

#### B. `job_wait_sessions` table — new columns

```sql
ALTER TABLE public.job_wait_sessions
  ADD COLUMN IF NOT EXISTS auto_started boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS free_ends_at timestamptz;
```

- `auto_started` — flags sessions started automatically on `arrived`.
- `free_ends_at` — `started_at + free_wait_minutes * interval '1 minute'`; computed server-side at insert.

#### C. New table — `job_wait_proposals`

```sql
CREATE TABLE public.job_wait_proposals (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id        uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  session_id    uuid REFERENCES public.job_wait_sessions(id) ON DELETE CASCADE,
  proposed_by   uuid NOT NULL REFERENCES auth.users(id),   -- coordinator user
  company_id    uuid NOT NULL,
  proposed_amount numeric(10,2) NOT NULL
    CHECK (proposed_amount >= 0 AND proposed_amount <= 100000),
  note          text,
  status        text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','accepted','rejected')),
  driver_note   text,
  responded_at  timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
-- Indexes
CREATE INDEX job_wait_proposals_job_idx    ON public.job_wait_proposals (job_id);
CREATE INDEX job_wait_proposals_open_idx   ON public.job_wait_proposals (job_id) WHERE status = 'pending';
-- One open proposal per session at a time
CREATE UNIQUE INDEX job_wait_proposals_one_open
  ON public.job_wait_proposals (session_id) WHERE status = 'pending';
-- RLS
ALTER TABLE public.job_wait_proposals ENABLE ROW LEVEL SECURITY;
-- Coordinator (company) can read/write proposals for their jobs
-- Driver can read proposals for their jobs (via driver token — enforced server-side)
```

### Phase 3 — Passenger Boarding System

#### A. `pax_status` ENUM — add `cancelled`

```sql
ALTER TYPE public.pax_status ADD VALUE IF NOT EXISTS 'cancelled';
```

#### B. `pax` table — new columns

```sql
ALTER TABLE public.pax
  ADD COLUMN IF NOT EXISTS noshow_at    timestamptz,
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz;
```

#### C. New table — `job_boarding_approvals`

```sql
CREATE TABLE public.job_boarding_approvals (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id         uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  driver_id      uuid REFERENCES public.drivers(id) ON DELETE SET NULL,
  company_id     uuid NOT NULL,
  requested_at   timestamptz NOT NULL DEFAULT now(),
  responded_at   timestamptz,
  status         text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','approved','rejected','overridden')),
  override_at    timestamptz,      -- driver override after 5-min timeout
  coordinator_note text,
  driver_note    text,
  pax_summary    jsonb,            -- snapshot: { on_board: N, no_show: N, cancelled: N, pending: N }
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
-- Only one open approval per job at a time
CREATE UNIQUE INDEX job_boarding_approvals_one_open
  ON public.job_boarding_approvals (job_id) WHERE status = 'pending';
CREATE INDEX job_boarding_approvals_job_idx ON public.job_boarding_approvals (job_id);
ALTER TABLE public.job_boarding_approvals ENABLE ROW LEVEL SECURITY;
```

---

## 5. APIs Affected

### Phase 2 — Waiting System

| Function | Type | Change |
|---|---|---|
| `updateJobStatus` | Modified | On transition to `arrived`: auto-open a `job_wait_sessions` row (`auto_started=true`, compute `free_ends_at`). On transition to `en_route`: if any open wait session exists, close it automatically (log adjustment). |
| `startWaitSession` | Modified | Now secondary (manual override only). Reads `free_wait_minutes` from company to set `free_ends_at`. |
| `stopWaitSession` | Modified | Add guard: only allowed when status is `en_route`, `completed`, or `cancelled`. Auto-stop triggered by `en_route` transition removes manual requirement. |
| `getDriverJobPricing` | Modified | Return `free_ends_at`, `waiting_rate_per_minute`, computed `live_charge_eur` (elapsed beyond free window × rate) for live UI display. |
| `proposeWaitAdjustment` _(new)_ | New | Coordinator creates a `job_wait_proposals` row. Validates one open proposal per session. Sends real-time notification to driver. |
| `respondWaitProposal` _(new — driver)_ | New | Driver accepts or rejects. On accept, updates `job_wait_sessions.agreed_amount` and the corresponding `job_adjustments` row. |
| `listWaitProposals` _(new)_ | New | Used by both coordinator dashboard and driver panel. Returns open + recent proposals for a job. |

### Phase 3 — Passenger Boarding System

| Function | Type | Change |
|---|---|---|
| `markPaxNoShow` | Modified | Also sets `noshow_at = now()` on pax row. |
| `markPaxCancelled` _(new)_ | New | Sets `pax.status = 'cancelled'`, `cancelled_at = now()`. Only allowed while job is `arrived` or `in_progress`. |
| `requestBoardingApproval` _(new — driver)_ | New | Creates `job_boarding_approvals` row with pax summary snapshot. Validates not all pax have a final status. Pushes notification to coordinator. |
| `respondBoardingApproval` _(new — coordinator)_ | New | Coordinator approves or rejects. On approve, allows status transition to `in_progress`. |
| `driverOverrideBoardingApproval` _(new — driver)_ | New | Allowed only if `requested_at + 5 minutes < now()` and status is still `pending`. Sets `status = 'overridden'`, records `override_at`. |
| `updateJobStatus` | Modified | Gate on `in_progress` transition: check that all pax rows have a non-`pending` status, OR a `job_boarding_approvals` row exists with `status IN ('approved','overridden')`. If neither, raise `partial_boarding_needs_approval`. |

---

## 6. UI Changes Required

### Phase 2 — Driver: `DriverWaitingPanel`

| Change | Detail |
|---|---|
| Auto-start indicator | Replace "Start waiting" button with an informational banner: "Waiting timer started automatically at HH:MM" when `auto_started = true`. |
| Free window countdown | Show "Free waiting: X min remaining" or "Free window expired" pill during grace period. |
| Live charge display | Below the elapsed timer: "Estimated charge: €X.XX" — updates every second using `(elapsed_sec - free_secs) / 60 × rate_per_min`. Show zero during free window. |
| Stop waiting | Keep "Stop waiting" button but make it clear it will finalize with the live charge amount pre-filled. |
| Coordinator proposal | New section: "Coordinator has proposed €X.XX — Accept / Reject". Shows note if provided. |

### Phase 2 — Coordinator: `TripWaitAdjustmentsPanel` → `WaitProposalPanel`

| Change | Detail |
|---|---|
| Free window badge | Show "In free window" or "Chargeable since HH:MM" depending on `free_ends_at`. |
| Live charge estimate | Show computed charge in coordinator view (mirrors driver view). |
| "Propose adjustment" button | Opens a dialog: amount + note → calls `proposeWaitAdjustment`. Disabled if proposal already pending. |
| Proposal status | Show current proposal with driver response (pending / accepted / rejected). |

### Phase 3 — Driver: `TripExecutionDialog` in `m.driver.$token.tsx`

| Change | Detail |
|---|---|
| `Cancelled` button | Add third action alongside "Confirm" and "No-show". Triggers `markPaxCancelled`. |
| Status badges | Add `Cancelled` badge (orange/amber) alongside existing `Onboard` (green) and `No-show` (red). |
| All-pax enforcement | Before proceeding to `in_progress`, check locally that no pax is still `pending`. If partial, show "Request coordinator approval" button. |
| Partial boarding flow | "Request approval" → calls `requestBoardingApproval` → shows "Waiting for coordinator (X:XX remaining)". Shows override button after 5-min countdown. |
| Override confirmation | AlertDialog: "Coordinator hasn't responded in 5 minutes. Do you want to proceed?" |

### Phase 3 — Coordinator: `TripDetailsSheet` — new boarding approval section

| Change | Detail |
|---|---|
| Boarding approval alert | If a pending `job_boarding_approvals` exists for a job, show a high-priority alert card: "Driver is waiting for boarding approval — X on board, Y no-show, Z cancelled, W pending." |
| Approve / Reject buttons | Approve allows `in_progress`; Reject sends message to driver. |
| Real-time polling | Refetch every 5 seconds when any job is in `arrived` status. |

### Phase 2 + 3 — Admin / Company Settings

| Change | Detail |
|---|---|
| Company settings page | Add "Waiting Policy" section: `free_wait_minutes` (numeric input, 0–120) and `waiting_rate_per_minute` (currency input, €/min). |

---

## 7. Risks

### Phase 2 — Waiting System

| Risk | Severity | Mitigation |
|---|---|---|
| **Race condition — auto-start on arrived** | Medium | The existing partial unique index on `job_wait_sessions (job_id) WHERE ended_at IS NULL` prevents duplicate sessions. Server function checks for existing open session before inserting. |
| **Clock drift between client and server** | Low | All timestamps are computed server-side (`now()`). Client timer is display-only using `started_at` from server. |
| **Driver does not agree with auto-computed charge** | High | Coordinator proposal / driver approval flow resolves this. Driver can also manually adjust amount when stopping if rate is 0. |
| **Waiting charge not stopped when job is cancelled** | Medium | `updateJobStatus` must close any open `job_wait_sessions` row when transitioning to `cancelled`. |
| **`free_wait_minutes = 0` means immediate charging** | Low | This is valid business behaviour but must be clearly communicated in settings UI. |
| **Existing jobs without `free_ends_at`** | Low | Sessions created before this migration have `free_ends_at = NULL`. Backend must treat NULL as "no free window configured — use company default". |

### Phase 3 — Passenger Boarding System

| Risk | Severity | Mitigation |
|---|---|---|
| **Driver proceeds to `in_progress` without all pax statused** | High | Enforce gate in `updateJobStatus`. Gate checks: all pax rows have status ≠ `pending`, OR approved/overridden boarding approval exists. |
| **`cancelled` added to `pax_status` ENUM** | Low | PostgreSQL ENUM additions are irreversible but additive — no existing data is affected. |
| **5-min coordinator timeout unreliable on poor mobile connection** | Medium | Countdown is client-side display; override eligibility is validated server-side using `requested_at` timestamp. |
| **Coordinator is offline / unavailable** | High | Driver override after 5 min ensures operations are never permanently blocked. |
| **Double-tap override** | Low | Server validates `status = 'pending'` before setting `overridden`. UI disables button while mutation is pending. |
| **Existing pax rows have no `noshow_at` / `cancelled_at`** | None | Columns are nullable — no backfill needed. |

---

## 8. Rollback Plan

### Database rollback

All migrations are additive (new columns, new tables, new ENUM value). No existing column or constraint is modified.

| Step | Action |
|---|---|
| 1 | Drop `job_wait_proposals` table (no dependents). |
| 2 | Drop `job_boarding_approvals` table (no dependents). |
| 3 | Drop new columns from `pax` (`noshow_at`, `cancelled_at`). |
| 4 | Drop new columns from `job_wait_sessions` (`auto_started`, `free_ends_at`). |
| 5 | Drop new columns from `companies` (`free_wait_minutes`, `waiting_rate_per_minute`). |
| ⚠️ | `pax_status 'cancelled'` ENUM value **cannot be removed** once added. Ensure no rows use it before rollback, or leave it unused. |

### Application rollback

| Component | Rollback action |
|---|---|
| `coordinator-public.functions.ts` | Revert `updateJobStatus` and `stopWaitSession` changes; remove new functions. |
| `coordinator.functions.ts` | Remove `respondBoardingApproval`. |
| `DriverWaitingPanel.tsx` | Revert to previous version (restore manual start button, remove live charge display). |
| `TripDetailsSheet.tsx` | Remove boarding approval card; revert `TripWaitAdjustmentsPanel`. |
| `m.driver.$token.tsx` | Remove `Cancelled` pax button; remove partial boarding flow. |
| Company settings page | Remove waiting policy fields. |

### Feature flags (recommended)

Wrap both phases behind a per-company feature flag (e.g., `features.auto_waiting`, `features.boarding_approval`) so they can be toggled per company without a code rollback.

---

## 9. Testing Strategy

### Unit tests — Server functions

| Test | Coverage |
|---|---|
| `updateJobStatus('arrived')` creates open wait session | Happy path |
| `updateJobStatus('arrived')` with existing open session does not duplicate | Idempotency |
| `updateJobStatus('en_route')` closes open wait session and creates adjustment | Happy path |
| `updateJobStatus('in_progress')` with all pax `pending` and no approval → raises error | Gate enforcement |
| `updateJobStatus('in_progress')` with approval = `approved` → succeeds | Happy path |
| `proposeWaitAdjustment` with existing pending proposal → raises error | Unique constraint |
| `respondWaitProposal('accept')` updates `agreed_amount` on session and adjustment | Happy path |
| `respondWaitProposal('reject')` sets status to rejected, no amount change | Happy path |
| `markPaxCancelled` on completed job → raises error | Status guard |
| `driverOverrideBoardingApproval` before 5 min → raises error | Timeout guard |
| `driverOverrideBoardingApproval` after 5 min → succeeds | Happy path |

### Integration tests — Status flows

| Flow | Expected outcome |
|---|---|
| `pending` → `en_route` → `arrived` → auto-wait starts → `en_route` → wait auto-closes | Full waiting lifecycle |
| `arrived` with partial pax → driver requests approval → coordinator approves → `in_progress` | Full boarding lifecycle |
| `arrived` with partial pax → driver requests approval → coordinator silent 5+ min → driver overrides → `in_progress` | Override lifecycle |
| `arrived` with all pax marked → `in_progress` without approval → succeeds | Full-board fast path |

### Manual QA checklist — Driver (mobile)

- [ ] Timer starts automatically when I set status to Arrived
- [ ] Free window shows countdown (e.g. "4:23 free remaining")
- [ ] After free window, live charge shows in euros and ticks up
- [ ] I can mark passengers as On Board, No Show, or Cancelled
- [ ] If I try to go In Progress with pending passengers, I see "Request approval"
- [ ] After requesting approval, 5-min countdown runs; Override button appears after 5 min
- [ ] Coordinator proposal appears with Accept / Reject options
- [ ] Accepting a proposal pre-fills the agreed amount

### Manual QA checklist — Coordinator (desktop + mobile)

- [ ] Live timer visible in TripDetailsSheet while driver is waiting
- [ ] Free window badge updates in real time
- [ ] "Propose adjustment" button opens dialog; pending proposal shows as badge
- [ ] Boarding approval alert fires when driver requests it
- [ ] Approve/Reject buttons function correctly
- [ ] Company settings: free_wait_minutes and rate fields save correctly

### Regression checklist

- [ ] Existing wait sessions (no `free_ends_at`) display correctly without crashing
- [ ] Jobs with no pax transition to `in_progress` without requiring approval
- [ ] Stop waiting manually still works when auto-start is not used
- [ ] Existing `pax_status` values (pending, verified, onboard, delayed, noshow, completed) all still display correctly
- [ ] Coordinator can still view adjustments for completed trips
