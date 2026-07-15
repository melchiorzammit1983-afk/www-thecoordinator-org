# Batch A — Manual Testing Guide

**Phases covered:** Phase 2 (Waiting System) + Phase 3 (Passenger Boarding System)  
**Environment:** Staging or local dev with Supabase migrations applied  
**Scope:** End-to-end scenarios that must pass before Batch A is merged to production

---

## Table of Contents

- [Test Setup](#test-setup)
- [Scenario 1 — All Passengers On Board](#scenario-1--arrived--waiting--all-passengers-on-board--en-route)
- [Scenario 2 — Partial Boarding with Coordinator Approval](#scenario-2--arrived--waiting--partial-boarding--coordinator-approval--en-route)
- [Scenario 3 — Driver Override After 5 Minutes](#scenario-3--arrived--waiting--partial-boarding--driver-override-after-5-minutes--en-route)
- [Scenario 4 — Passenger No Show](#scenario-4--passenger-no-show)
- [Scenario 5 — Passenger Cancelled](#scenario-5--passenger-cancelled)
- [Scenario 6 — Waiting Charge Proposal Accepted](#scenario-6--waiting-charge-proposal-accepted)
- [Scenario 7 — Waiting Charge Proposal Rejected](#scenario-7--waiting-charge-proposal-rejected)
- [Scenario 8 — Company Free Wait Time = 0](#scenario-8--company-free-wait-time--0)
- [Scenario 9 — Waiting Rate = 0](#scenario-9--waiting-rate--0)
- [Scenario 10 — Multiple Passengers With Mixed Statuses](#scenario-10--multiple-passengers-with-mixed-statuses)

---

## Test Setup

### Prerequisites

| Item | Details |
|------|---------|
| Environment | Staging or local dev with all Batch A migrations applied |
| Supabase access | Direct DB access (Supabase Studio or `psql`) to verify state |
| Driver access | Valid driver magic-link token for a job in `en_route` status |
| Coordinator access | Logged-in coordinator account in the same company |
| Browser | Open DevTools (Console + Network) during all tests |

### Apply migrations

Confirm all three migrations are present in Supabase before testing:

```sql
-- Confirm Batch A migrations are applied
SELECT name FROM supabase_migrations.schema_migrations
WHERE name LIKE '%batch_a%'
ORDER BY name;

-- Expected:
-- 20260709144000_batch_a_step1_waiting_and_boarding_schema
-- 20260709150000_batch_a_step2_waiting_logic
```

### Configure test company

```sql
-- Set a known waiting policy for testing
UPDATE public.companies
SET
  free_wait_minutes       = 5,
  waiting_rate_per_minute = 1.00,
  arrival_radius_m        = 500       -- relax radius for desk testing
WHERE id = '<your-company-uuid>';

-- Verify
SELECT id, name, free_wait_minutes, waiting_rate_per_minute, arrival_radius_m
FROM public.companies
WHERE id = '<your-company-uuid>';
```

### Create a standard test job

```sql
-- Create or identify a test job with passengers
-- Job must be in en_route status with a driver assigned
SELECT j.id AS job_id, j.status, j.driver_id, j.company_id,
       j.pickup_lat, j.pickup_lng
FROM public.jobs j
WHERE j.status = 'en_route'
  AND j.driver_id IS NOT NULL
  AND j.company_id = '<your-company-uuid>'
LIMIT 5;

-- Check passengers for the chosen job
SELECT id, name, status, boarded_at, noshow_at, cancelled_at
FROM public.pax
WHERE job_id = '<job-uuid>'
ORDER BY created_at;
```

### Insert a mock GPS location (to pass arrival gate)

```sql
-- Insert a GPS position within the arrival radius of the pickup point
INSERT INTO public.driver_locations
  (driver_id, job_id, latitude, longitude, accuracy_m, heading, speed_mps, captured_at)
VALUES
  ('<driver-uuid>', '<job-uuid>',
   <pickup_lat>,          -- same as or very close to job pickup_lat
   <pickup_lng>,          -- same as or very close to job pickup_lng
   10,                    -- accuracy in metres
   0,                     -- heading
   0,                     -- speed (stationary)
   NOW()
  );
```

### Reset a job between scenarios

```sql
-- Reset job to en_route so it can be re-used
UPDATE public.jobs SET status = 'en_route' WHERE id = '<job-uuid>';

-- Reset all pax to pending
UPDATE public.pax SET status = 'pending', boarded_at = NULL,
  noshow_at = NULL, cancelled_at = NULL WHERE job_id = '<job-uuid>';

-- Delete any open wait sessions
DELETE FROM public.job_wait_sessions
WHERE job_id = '<job-uuid>' AND ended_at IS NULL;

-- Delete any boarding approvals
DELETE FROM public.job_boarding_approvals WHERE job_id = '<job-uuid>';

-- Delete any wait proposals
DELETE FROM public.job_wait_proposals WHERE job_id = '<job-uuid>';
```

---

## Scenario 1 — Arrived → Waiting → All Passengers On Board → En Route

**Purpose:** Verify the happy path with no complications.

### Test Setup

- Job in `en_route`, 2 passengers in `pending`
- Company: `free_wait_minutes = 5`, `waiting_rate_per_minute = 1.00`
- GPS position inserted within arrival radius

### Driver Actions

1. Open driver manifest for the test job.
2. Tap **"Arrived"** to set status to `arrived`.
3. Observe the Waiting panel.
4. In the Boarding panel, tap **Confirm** for both passengers.
5. Tap **Proceed / En Route** (or the next status button).

### Expected Results

| # | Expected |
|---|---|
| 1 | Status changes to `arrived` |
| 2 | Waiting panel shows "Waiting timer started automatically at HH:MM" |
| 3 | Waiting panel shows "Free waiting: 4:5X remaining" (countdown) |
| 4 | Both passengers show green "Onboard" badges |
| 5 | "Proceed" button is enabled immediately (no approval needed) |
| 6 | Status changes to `in_progress` without error |
| 7 | Status can then be set to `en_route`, and the waiting panel closes |

### Database Verification

```sql
-- 1. Wait session was auto-created
SELECT id, auto_started, started_at, free_ends_at, ended_at,
       calculated_amount, agreed_amount
FROM public.job_wait_sessions
WHERE job_id = '<job-uuid>'
ORDER BY created_at DESC LIMIT 1;
-- auto_started = true
-- free_ends_at = started_at + 5 minutes
-- ended_at = NULL (still open at in_progress)

-- 2. Pax rows updated
SELECT id, name, status, boarded_at FROM public.pax
WHERE job_id = '<job-uuid>';
-- Both rows: status = 'onboard', boarded_at IS NOT NULL

-- 3. No boarding approval needed
SELECT * FROM public.job_boarding_approvals WHERE job_id = '<job-uuid>';
-- 0 rows

-- 4. Wait session closed on en_route
SELECT ended_at, calculated_amount
FROM public.job_wait_sessions WHERE job_id = '<job-uuid>';
-- ended_at IS NOT NULL
-- calculated_amount >= 0
```

---

## Scenario 2 — Arrived → Waiting → Partial Boarding → Coordinator Approval → En Route

**Purpose:** Verify the coordinator approval path for partial boarding.

### Test Setup

- Job in `en_route`, 3 passengers in `pending`
- Company: `free_wait_minutes = 5`, `waiting_rate_per_minute = 1.00`
- GPS position inserted within arrival radius
- Coordinator logged in on a separate browser/device

### Driver Actions

1. Tap **"Arrived"**.
2. In the Boarding panel, tap **Confirm** for 2 of the 3 passengers (leave 1 as `pending`).
3. Tap **Proceed**.
4. Observe the partial boarding warning.
5. Tap **"Request coordinator approval"**.
6. Observe the countdown timer.

### Coordinator Actions

1. Open the coordinator dashboard (TripDetailsSheet for the test job).
2. Observe the boarding approval alert card showing the pax summary.
3. Tap **Approve**.
4. Optionally add a coordinator note.

### Driver Actions (after approval)

7. Observe the countdown stops and a confirmation message appears.
8. Tap **Proceed** again.

### Expected Results

| # | Expected |
|---|---|
| 1 | Partial boarding warning appears when 1 pax is still `pending` |
| 2 | "Request coordinator approval" button is visible |
| 3 | After request, countdown shows "Waiting for coordinator — X:XX" |
| 4 | Coordinator sees alert: "Driver is waiting for boarding approval — 2 on board, 0 no-show, 0 cancelled, 1 pending" |
| 5 | Coordinator can approve with optional note |
| 6 | Driver view updates to show approval received |
| 7 | Status transitions to `in_progress` successfully |

### Database Verification

```sql
-- Boarding approval row
SELECT status, requested_at, responded_at, coordinator_note, pax_summary
FROM public.job_boarding_approvals
WHERE job_id = '<job-uuid>'
ORDER BY created_at DESC LIMIT 1;
-- status = 'approved'
-- responded_at IS NOT NULL
-- pax_summary = {"on_board": 2, "no_show": 0, "cancelled": 0, "pending": 1}

-- Pax statuses
SELECT name, status FROM public.pax WHERE job_id = '<job-uuid>';
-- 2 rows: status = 'onboard'
-- 1 row:  status = 'pending' (still pending — approval covered it)
```

---

## Scenario 3 — Arrived → Waiting → Partial Boarding → Driver Override After 5 Minutes → En Route

**Purpose:** Verify that a driver can override when coordinator does not respond within 5 minutes.

### Test Setup

- Job in `en_route`, 2 passengers in `pending`
- Company: `free_wait_minutes = 5`, `waiting_rate_per_minute = 1.00`
- GPS position inserted
- Coordinator logged in but will NOT respond

### Driver Actions

1. Tap **"Arrived"**.
2. Confirm 1 passenger; leave 1 as `pending`.
3. Tap **Proceed** → see partial warning.
4. Tap **"Request coordinator approval"**.
5. Wait for the 5-minute countdown to expire.  
   *(To accelerate testing, manually backdate the `requested_at` — see DB steps below.)*
6. Observe the **"Override — proceed without approval"** button appears.
7. Tap Override and confirm the alert dialog.

### Accelerate testing (backdate request)

```sql
-- Backdate the approval request by 6 minutes to trigger override eligibility
UPDATE public.job_boarding_approvals
SET requested_at = now() - INTERVAL '6 minutes'
WHERE job_id = '<job-uuid>' AND status = 'pending';
```

### Expected Results

| # | Expected |
|---|---|
| 1 | Override button is hidden during the first 5 minutes |
| 2 | Override button appears after 5 minutes (or after backdate) |
| 3 | Confirmation dialog: "Coordinator hasn't responded in 5 minutes. Do you want to proceed?" |
| 4 | After confirmation, status transitions to `in_progress` |
| 5 | No error thrown |

### Database Verification

```sql
SELECT status, override_at, responded_at
FROM public.job_boarding_approvals
WHERE job_id = '<job-uuid>'
ORDER BY created_at DESC LIMIT 1;
-- status     = 'overridden'
-- override_at IS NOT NULL
-- responded_at IS NULL (coordinator never responded)
```

---

## Scenario 4 — Passenger No Show

**Purpose:** Verify that marking a passenger as no-show records `noshow_at` and satisfies the boarding gate.

### Test Setup

- Job in `arrived`, 2 passengers in `pending`

### Driver Actions

1. In the Boarding panel, tap **No-show** for both passengers.
2. Tap **Proceed**.

### Expected Results

| # | Expected |
|---|---|
| 1 | Both passengers show red "No-show" badges |
| 2 | "Proceed" button is enabled (no approval needed — all pax have final status) |
| 3 | Status transitions to `in_progress` without error |

### Database Verification

```sql
SELECT name, status, noshow_at FROM public.pax
WHERE job_id = '<job-uuid>';
-- Both rows: status = 'noshow', noshow_at IS NOT NULL

-- No boarding approval created
SELECT COUNT(*) FROM public.job_boarding_approvals WHERE job_id = '<job-uuid>';
-- 0
```

---

## Scenario 5 — Passenger Cancelled

**Purpose:** Verify the new `Cancelled` pax action records `cancelled_at` and the new `cancelled` status displays correctly.

### Test Setup

- Job in `arrived`, 2 passengers in `pending`

### Driver Actions

1. In the Boarding panel, tap **Cancelled** for both passengers.
2. Observe the amber "Cancelled" badge.
3. Tap **Proceed**.

### Expected Results

| # | Expected |
|---|---|
| 1 | "Cancelled" button is visible alongside Confirm and No-show |
| 2 | Amber/orange "Cancelled" badge displayed |
| 3 | "Proceed" button is enabled (all pax have final status) |
| 4 | Status transitions to `in_progress` without error |

### Database Verification

```sql
SELECT name, status, cancelled_at FROM public.pax
WHERE job_id = '<job-uuid>';
-- Both rows: status = 'cancelled', cancelled_at IS NOT NULL

-- pax_status ENUM includes 'cancelled'
SELECT unnest(enum_range(NULL::public.pax_status));
-- Should include: pending, verified, onboard, delayed, noshow, cancelled, completed
```

---

## Scenario 6 — Waiting Charge Proposal Accepted

**Purpose:** Verify that when a coordinator proposes a waiting charge and the driver accepts, `agreed_amount` is updated but `calculated_amount` remains unchanged.

### Test Setup

- Job in `arrived` with an open wait session (auto-started)
- Company: `free_wait_minutes = 0`, `waiting_rate_per_minute = 2.00` (immediate charging for visibility)
- Wait at least 2 minutes so `calculated_amount` > 0 on close

### Coordinator Actions

1. Open TripDetailsSheet for the test job.
2. Observe the "Chargeable since HH:MM" badge.
3. Observe the live charge estimate (e.g., "Estimated charge: €4.00").
4. Click **"Propose adjustment"**.
5. Enter a different amount (e.g., `€3.00`) and an optional note ("Agreed with driver").
6. Submit the proposal.
7. Observe the proposal status badge shows "Pending".

### Driver Actions

1. Observe the Waiting panel: "Coordinator has proposed €3.00 — Accept / Reject".
2. Read the note.
3. Tap **Accept**.

### Expected Results

| # | Expected |
|---|---|
| 1 | Coordinator proposal dialog submits without error |
| 2 | "Propose adjustment" button becomes disabled while proposal is pending |
| 3 | Driver sees coordinator proposal with amount and note |
| 4 | Driver can accept |
| 5 | After acceptance, coordinator panel shows "Accepted — €3.00" |

### Database Verification

```sql
-- Wait proposal
SELECT proposed_amount, status, driver_response_note, responded_at
FROM public.job_wait_proposals
WHERE job_id = '<job-uuid>'
ORDER BY created_at DESC LIMIT 1;
-- status = 'accepted', proposed_amount = 3.00

-- Wait session: agreed_amount updated, calculated_amount unchanged
SELECT calculated_amount, agreed_amount
FROM public.job_wait_sessions
WHERE job_id = '<job-uuid>'
ORDER BY created_at DESC LIMIT 1;
-- calculated_amount = [system-computed value, e.g. 4.00]  ← never changes
-- agreed_amount = 3.00                                      ← updated by acceptance
```

---

## Scenario 7 — Waiting Charge Proposal Rejected

**Purpose:** Verify that when a driver rejects a proposal, `agreed_amount` is not changed.

### Test Setup

Same as Scenario 6 but driver will reject.

### Coordinator Actions

1. Propose a waiting charge (e.g., `€3.00`).

### Driver Actions

1. Observe the coordinator proposal.
2. Tap **Reject** with an optional response note.

### Expected Results

| # | Expected |
|---|---|
| 1 | Coordinator panel shows "Rejected" status with driver's note |
| 2 | "Propose adjustment" button re-enables (can propose again) |
| 3 | `agreed_amount` is NOT changed on the wait session |

### Database Verification

```sql
-- Wait proposal
SELECT proposed_amount, status, driver_response_note, responded_at
FROM public.job_wait_proposals
WHERE job_id = '<job-uuid>'
ORDER BY created_at DESC LIMIT 1;
-- status = 'rejected', responded_at IS NOT NULL

-- Wait session: agreed_amount unchanged from calculated_amount
SELECT calculated_amount, agreed_amount
FROM public.job_wait_sessions
WHERE job_id = '<job-uuid>'
ORDER BY created_at DESC LIMIT 1;
-- agreed_amount should equal calculated_amount (proposal was rejected)
```

---

## Scenario 8 — Company Free Wait Time = 0

**Purpose:** Verify that when `free_wait_minutes = 0`, the waiting charge starts immediately with no free window.

### Test Setup

```sql
UPDATE public.companies
SET free_wait_minutes = 0, waiting_rate_per_minute = 1.50
WHERE id = '<your-company-uuid>';
```

### Driver Actions

1. Set job to `arrived`.
2. Observe the Waiting panel immediately.

### Expected Results

| # | Expected |
|---|---|
| 1 | No "Free waiting: X min remaining" pill — the free window is not shown |
| 2 | Live charge starts accumulating from the moment `arrived` is set |
| 3 | At 2 minutes elapsed, charge ≈ €3.00 (2 × €1.50) |
| 4 | No crash or display error |

### Database Verification

```sql
SELECT started_at, free_ends_at, auto_started
FROM public.job_wait_sessions
WHERE job_id = '<job-uuid>'
ORDER BY created_at DESC LIMIT 1;
-- free_ends_at IS NULL (no free window when free_wait_minutes = 0)
-- auto_started = true
```

---

## Scenario 9 — Waiting Rate = 0

**Purpose:** Verify that when `waiting_rate_per_minute = 0`, no charge is accumulated regardless of elapsed time.

### Test Setup

```sql
UPDATE public.companies
SET free_wait_minutes = 5, waiting_rate_per_minute = 0
WHERE id = '<your-company-uuid>';
```

### Driver Actions

1. Set job to `arrived`.
2. Wait for the free window to expire (or backdate `free_ends_at`).
3. Observe the Waiting panel after free window.

### Expected Results

| # | Expected |
|---|---|
| 1 | "Free waiting: X min remaining" shows during grace period |
| 2 | After free window: charge shows "€0.00" |
| 3 | No error or NaN displayed |
| 4 | All other waiting panel functions (stop, proposals) work normally |

### Database Verification

```sql
-- After en_route transition
SELECT calculated_amount, agreed_amount
FROM public.job_wait_sessions
WHERE job_id = '<job-uuid>'
ORDER BY created_at DESC LIMIT 1;
-- calculated_amount = 0.00 (rate is 0)
-- agreed_amount = 0.00
```

---

## Scenario 10 — Multiple Passengers With Mixed Statuses

**Purpose:** Verify that when passengers have a mix of `onboard`, `noshow`, `cancelled`, and `pending`, the boarding gate and approval flow behave correctly.

### Test Setup

- Job in `arrived`, 5 passengers all in `pending`
- Company: `free_wait_minutes = 5`, `waiting_rate_per_minute = 1.00`

### Driver Actions

1. Tap **"Arrived"**.
2. Mark Passenger 1 → **Confirm** (onboard)
3. Mark Passenger 2 → **No-show**
4. Mark Passenger 3 → **Cancelled**
5. Leave Passenger 4 and Passenger 5 as `pending`.
6. Tap **Proceed**.
7. Observe the partial boarding prompt.
8. Tap **"Request coordinator approval"**.

### Coordinator Actions

1. Observe the approval alert: "1 on board, 1 no-show, 1 cancelled, 2 pending".
2. Tap **Approve**.

### Driver Actions

9. Observe approval received.
10. Tap **Proceed** → status `in_progress`.

### Expected Results

| # | Expected |
|---|---|
| 1 | Pax badges: green Onboard, red No-show, amber Cancelled |
| 2 | "Proceed" blocked (Passengers 4 and 5 are still pending) |
| 3 | Coordinator approval alert shows correct pax summary |
| 4 | After approval, status transitions to `in_progress` |

### Database Verification

```sql
-- Pax statuses
SELECT name, status, boarded_at, noshow_at, cancelled_at
FROM public.pax
WHERE job_id = '<job-uuid>'
ORDER BY name;
-- Pax 1: status = 'onboard',   boarded_at IS NOT NULL
-- Pax 2: status = 'noshow',    noshow_at IS NOT NULL
-- Pax 3: status = 'cancelled', cancelled_at IS NOT NULL
-- Pax 4: status = 'pending'
-- Pax 5: status = 'pending'

-- Boarding approval pax summary
SELECT pax_summary, status
FROM public.job_boarding_approvals
WHERE job_id = '<job-uuid>'
ORDER BY created_at DESC LIMIT 1;
-- status = 'approved'
-- pax_summary = {"on_board": 1, "no_show": 1, "cancelled": 1, "pending": 2}
```

---

## Regression Checklist

Before marking Batch A as ready for merge, verify all of the following:

### Waiting System

- [ ] Existing wait sessions (no `free_ends_at`) display correctly without crashes
- [ ] Manual "Stop waiting" still works when auto-start is used
- [ ] Coordinator can still view adjustments for completed trips
- [ ] Wait session closes on `en_route` transition
- [ ] `calculated_amount` is set once on session close and never changes thereafter
- [ ] `agreed_amount` updates only when a coordinator proposal is accepted

### Boarding System

- [ ] Jobs with zero pax transition to `in_progress` without requiring approval
- [ ] Jobs with all pax pre-confirmed transition to `in_progress` without requiring approval
- [ ] Existing `pax_status` values (pending, verified, onboard, delayed, noshow, completed) all display correctly
- [ ] `Cancelled` badge is amber/orange and visually distinct from `No-show` and `Onboard`
- [ ] Override button is hidden during the first 5 minutes after request
- [ ] Backdating `requested_at` reveals override button correctly

### Company Settings

- [ ] `free_wait_minutes` and `waiting_rate_per_minute` fields save correctly from settings UI
- [ ] Changing `free_wait_minutes` to 0 causes no free window on next arrival
- [ ] Changing `waiting_rate_per_minute` to 0 causes no charge accumulation

### Cross-functional

- [ ] No JavaScript errors in browser console during any scenario above
- [ ] No failed Supabase API calls in Network tab during any scenario above
- [ ] Coordinator calendar shows pending boarding approval banner when a request is open
- [ ] All new RLS policies allow expected reads/writes and block unexpected access
