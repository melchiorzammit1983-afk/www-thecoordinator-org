# Batch B Architecture Review
## Phase 4 — Driver Safety Mode · Phase 5 — Emergency Override

**Reviewed:** 2026-07-09  
**Reviewer:** Architecture review agent  
**Source document:** `docs/BATCH_B_IMPLEMENTATION_PLAN.md`  
**Status:** Pre-implementation — review complete

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Breaking Change Risks](#2-breaking-change-risks)
3. [Database Migration Risks](#3-database-migration-risks)
4. [Mobile App Risks](#4-mobile-app-risks)
5. [Driver Workflow Conflicts](#5-driver-workflow-conflicts)
6. [Status Transition Conflicts](#6-status-transition-conflicts)
7. [GPS Validation Conflicts](#7-gps-validation-conflicts)
8. [Waiting System Conflicts](#8-waiting-system-conflicts)
9. [Passenger Boarding Conflicts](#9-passenger-boarding-conflicts)
10. [Audit Logging Requirements for Phase 6](#10-audit-logging-requirements-for-phase-6)
11. [Group Trip Compatibility for Phase 7](#11-group-trip-compatibility-for-phase-7)
12. [Recommended Adjustments](#12-recommended-adjustments)
13. [Required Changes Before Implementation](#13-required-changes-before-implementation)
14. [Estimated Implementation Complexity](#14-estimated-implementation-complexity)
15. [Batch B Implementation Plan (Post-Blocking Resolution)](#15-batch-b-implementation-plan-post-blocking-resolution)

---

## 1. Executive Summary

The plan is well-structured and correctly identifies the main integration points with Batch A (Phase 2 waiting system, Phase 3 boarding gate). Phase 4 (Safety Mode) is low-risk and largely client-side. Phase 5 (Emergency Override) carries more risk due to its interactions with the waiting system, boarding approvals, group trips, and audit completeness.

**Twelve issues are identified.** Three are blocking (must be resolved before implementation), five are high-priority adjustments, and four are lower-priority improvements.

| Severity | Count |
|---|---|
| 🔴 Blocking — must fix before implementation | 3 |
| 🟠 High priority — fix before or during implementation | 5 |
| 🟡 Low priority — fix in same sprint or next | 4 |

---

## 2. Breaking Change Risks

### 2.1 `JobCard` — new required `isSafetyMode` prop

**Finding:** The plan modifies `JobCard` to accept an `isSafetyMode: boolean` prop. If this prop is typed as required (not optional), every other callsite that renders `JobCard` without passing `isSafetyMode` will break at compile time. The driver manifest is the primary callsite, but if `JobCard` is reused in coordinator views or other screens (e.g., admin trip preview), those will also need updates.

**Risk level:** 🟠 High (compile-time break if `JobCard` is reused elsewhere)

**Recommendation:** Type the prop as `isSafetyMode?: boolean` with a default of `false`. This keeps all existing callsites working without changes.

---

### 2.2 `DriverLiveShare.tsx` — new `onSpeedChange` prop

**Finding:** The prop is described as optional (`onSpeedChange?`), which is correct. Existing callers that do not pass `onSpeedChange` will continue to work unchanged. No breaking change if the optionality is preserved in implementation.

**Risk level:** ✅ None (as planned)

---

### 2.3 `emergencyOverrideJobStatus` — no modification to existing functions

**Finding:** The new server function does not modify `updateJobStatus`, `pushDriverLocation`, or any Phase 2/3 functions. It is purely additive. No breaking change.

**Risk level:** ✅ None

---

## 3. Database Migration Risks

### 3.1 Missing RLS policies and GRANT statements on `job_emergency_overrides`

**Finding:** The plan shows `ALTER TABLE public.job_emergency_overrides ENABLE ROW LEVEL SECURITY;` but contains only comments where policies should be. No `CREATE POLICY` statements or `GRANT` statements appear in the migration SQL. This means:

- RLS is enabled but no policies exist → all authenticated reads are denied by default.
- Coordinators querying `job_emergency_overrides` via the authenticated client would receive zero rows rather than an error.
- No `GRANT SELECT, INSERT, UPDATE ON ... TO authenticated;` or `GRANT ALL ON ... TO service_role;` statements are defined.

**Risk level:** 🔴 Blocking — coordinators cannot read overrides without policies.

**Required fix:** Add explicit RLS policies and GRANT statements to the migration. Minimum needed:

```sql
GRANT SELECT, INSERT, UPDATE, DELETE ON public.job_emergency_overrides TO authenticated;
GRANT ALL ON public.job_emergency_overrides TO service_role;

-- Company staff can read overrides for their own jobs.
CREATE POLICY "emergency_overrides_read_by_company"
  ON public.job_emergency_overrides FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.jobs j
      WHERE j.id = job_emergency_overrides.job_id
        AND (
          j.company_id       = private.company_of(auth.uid())
          OR j.executor_company_id = private.company_of(auth.uid())
        )
    )
  );

-- Drivers write only via service_role server function — no direct INSERT policy needed
-- for authenticated role. Service role bypasses RLS.
```

---

### 3.2 `safety_mode_threshold_kmh` column is premature

**Finding:** The column is added to `companies` in Phase 4, but the plan explicitly states "Phase 4 hardcodes this client-side; a later phase can read `companies.safety_mode_threshold_kmh` from the manifest payload." The column will exist in the database but will not be read by any code. This creates unused schema debt.

**Risk level:** 🟡 Low — additive, non-breaking, reversible

**Recommendation:** Either defer the migration to the phase that actually uses it, or add a comment in the migration that makes the intent explicit. Adding the column now is acceptable if it will be used in the next sprint, but it should not be exposed in `types.ts` as though it is used.

---

### 3.3 No `updated_at` on `job_emergency_overrides`

**Finding:** The table has no `updated_at` column and no update trigger. Emergency override rows are immutable by design (audit log), which is correct. However, if a future phase needs to mark an override as "acknowledged" or "reviewed" by a coordinator, the schema would need to be altered. This is a forward-compatibility consideration for Phase 6.

**Risk level:** 🟡 Low — can be added later with `ADD COLUMN IF NOT EXISTS`

**Recommendation:** Consider adding `acknowledged_at timestamptz` and `acknowledged_by_user_id uuid` as nullable columns now, even if unused, to make Phase 6 non-destructive.

---

### 3.4 No transaction atomicity in `emergencyOverrideJobStatus`

**Finding:** The plan describes the server function as a sequence of up to 10 steps (status update → override audit row → system chat message → wait session close). These are separate Supabase client calls. If the status update (step 4) succeeds but the audit row insert (step 5) fails, the job status will have changed with no audit trail. This violates the safety-critical audit guarantee.

**Risk level:** 🔴 Blocking — audit trail can silently fail while the status update succeeds.

**Required fix:** Wrap the status update, audit insert, and chat insert in a Postgres transaction using a database function or RPC call, or use a retry/compensate pattern for the audit insert. At minimum, the audit insert must happen before or be retried if the status update succeeds.

---

## 4. Mobile App Risks

### 4.1 `coords.speed` returns `-1` (not `null`) on some iOS devices

**Finding:** On native iOS via the Capacitor Geolocation plugin, an invalid speed from `CLLocation` is sometimes translated as `-1` rather than `null`. The plan states "If `coords.speed` is `null`, Safety Mode is `false`" — but does not handle negative values. A raw check of `speedMps >= 2.778` when `speedMps = -1` would correctly not activate Safety Mode, but a check like `speedMps !== null` used to pass to the hook would pass `-1` through as a valid value.

**Risk level:** 🟠 High — subtle bug on iOS in the `useSafetyMode` hook

**Required fix:** In `use-safety-mode.ts`, treat any non-positive speed as "no speed data":

```
isSafetyMode = speedMps != null && speedMps > 0 && speedMps >= thresholdMps
```

---

### 4.2 Stale speed when the screen locks (background operation)

**Finding:** When the phone screen locks, the Capacitor native plugin continues to push location via `pushDriverLocation`, but the web-layer `watchPosition` callback that drives `onSpeedChange` may pause or receive infrequent updates depending on the device. The `currentSpeedMps` state in `DriverManifest` would remain at the last known value. If the driver was at speed when the screen locked, `isSafetyMode` would remain `true` even after the car stops, keeping action buttons hidden when the driver picks up their phone.

**Risk level:** 🟠 High — Safety Mode could remain active after the vehicle has stopped.

**Required fix:** Implement a speed staleness timeout. If no `onSpeedChange` callback has fired in the last N seconds (e.g., 30 seconds), reset `currentSpeedMps` to `null`. This ensures Safety Mode deactivates when GPS updates cease.

---

### 4.3 Emergency Override dialog usability at speed

**Finding:** The `EmergencyOverrideDialog` has a two-step flow: step 1 (select reason and target status) → step 2 (confirmation). While the intention is safety, requiring two separate interactions to complete an emergency override while driving adds interaction complexity. The "Emergency" button is always visible and prominent, which is correct. However, the two-step modal is harder to use safely than a single confirmation screen.

**Risk level:** 🟡 Low — UX risk, not a technical defect

**Recommendation:** Ensure step 1 and step 2 use very large touch targets (minimum 56px / `h-14`) and that the confirmation step is a single large "Confirm" button visible without scrolling. This is especially important in the Android native WebView.

---

### 4.4 `SafetyModeOverlay` z-index and keyboard overlap on mobile

**Finding:** The banner is specified as `fixed top, z-50`. On iOS with a notch or Dynamic Island, `z-50` content at the top may overlap safe-area insets. On Android, the soft keyboard might push the overlay in unexpected ways if a dialog is open simultaneously.

**Risk level:** 🟡 Low

**Recommendation:** Use `safe-area-inset-top` padding on the overlay: `pt-[env(safe-area-inset-top)]` or equivalent Tailwind plugin classes. Test on an iPhone with notch and an Android device with a soft keyboard open.

---

## 5. Driver Workflow Conflicts

### 5.1 "Force En Route" from `in_progress` is a backward status transition

**Finding:** The plan allows `emergencyOverrideJobStatus` with `to_status = "en_route"` from any active status, including `in_progress`. However, going from `in_progress` back to `en_route` is a backward transition that creates several inconsistencies:

1. `driver_started_at` was set when the trip first reached `en_route`. After a backward override to `en_route`, the trip timer would be misleading — it would show elapsed time from the original departure.
2. Passengers may already have `boarded_at` timestamps and `status = 'onboard'`. Going back to `en_route` implies they were not yet boarded, but their records show them as boarded.
3. The coordinator sees the job as "going backward" in their dashboard without any automated indicator beyond the chat message.

**Risk level:** 🟠 High — data inconsistency risk on backward transitions

**Recommendation:** The server function should handle the `in_progress → en_route` case explicitly:
- Do **not** clear `driver_started_at` (it correctly records when the driver originally departed).
- Do **not** reset pax statuses (the coordinator can manually review).
- Add `"backward_override": true` to the system chat message body when the target status is earlier in the normal flow than the current status, to help coordinators understand the context.

---

### 5.2 "Force En Route" / "Force Arrived" from `completed` is not blocked

**Finding:** The plan states "Cannot override a `completed` or `cancelled` job (server validates)" — this is correct and should prevent any override from a terminal state. However, the validation logic is described informally ("Verify the job belongs to this driver and is in an active, non-completed state"). The implementation must explicitly enumerate the blocked terminal states: `completed`, `cancelled`. Any other status (even custom or legacy statuses) should be rejected.

**Risk level:** 🟠 High — if terminal state check is incomplete, a completed job could be re-opened

**Recommendation:** The server function input validation should check `job.status NOT IN ('completed', 'cancelled')` before proceeding. Add this as an explicit test case.

---

## 6. Status Transition Conflicts

### 6.1 `to_status` forward-only constraint is ambiguous and under-enforced

**Finding:** Section 4.2 states "Validate `to_status` is forward-only (cannot override backwards to a previous status, except `en_route` which may be needed after an erroneous `in_progress`)." However, the allowed list (`arrived`, `in_progress`, `en_route`, `completed`) permits all of these transitions:

| From | To | Type |
|---|---|---|
| `en_route` | `arrived` | Forward ✅ |
| `en_route` | `in_progress` | Forward (skip) ✅ |
| `en_route` | `completed` | Forward (skip) ✅ |
| `arrived` | `in_progress` | Forward ✅ |
| `arrived` | `en_route` | **Backward** ⚠️ |
| `arrived` | `completed` | Forward (skip) ✅ |
| `in_progress` | `completed` | Forward ✅ |
| `in_progress` | `arrived` | **Backward** ⚠️ |
| `in_progress` | `en_route` | **Backward** ⚠️ |
| `pending` | `arrived` | Forward (skip, but skips en_route) ✅ |
| `pending` | `completed` | Forward (skip everything) ✅ |

The current plan does not explicitly validate backward transitions except `en_route`. Going from `in_progress → arrived` is not a case covered by the plan's intent ("an erroneous advance") but is permitted by the allowed `to_status` list.

**Risk level:** 🟠 High — unexpected backward transitions should be restricted

**Recommendation:** Define an explicit allow-list of valid `(from_status, to_status)` pairs in the server function. Only explicitly designed transitions should be permitted. Reject any pair not in the list with a clear error code.

---

### 6.2 `grouped_count` and `grouped_at` are not cleared on emergency `completed`

**Finding:** In `updateJobStatus`, when a job completes normally, `grouped_count` and `grouped_at` are cleared (`patch.grouped_count = null; patch.grouped_at = null;`). In `emergencyOverrideJobStatus`, the plan only mentions setting `driver_completed_at` — it does not mention clearing these group metadata fields. A group trip that is force-completed would retain stale `grouped_count` / `grouped_at` values.

**Risk level:** 🟡 Low for Phase 5, higher for Phase 7

**Recommendation:** Add `grouped_count = null, grouped_at = null` to the status patch when `to_status === 'completed'` in `emergencyOverrideJobStatus`.

---

## 7. GPS Validation Conflicts

### 7.1 `arrival_verified_at` and telemetry fields are null after Force Arrived

**Finding:** This is acknowledged in the plan ("→ arrived: No auto-start. The override skips the normal `arrived` hooks"). The existing `arrival_gate` in `updateJobStatus` sets `arrival_verified_at`, `arrival_lat`, `arrival_lng`, `arrival_accuracy_m`, `arrival_heading`, `arrival_speed_mps`, `arrival_street_address`, and `arrival_distance_m` when the transition is GPS-verified. A Force Arrived override will leave all of these null.

Any Phase 6 reporting or audit query that relies on `arrival_verified_at IS NOT NULL` to count verified arrivals must distinguish between null-because-never-set and null-because-override. The reason this matters is forensic: a coordinator reviewing a completed trip cannot tell whether the null arrival telemetry was due to an override or a schema gap.

**Risk level:** 🟡 Low — informational only for Phase 5

**Recommendation:** When the server function writes a Force Arrived, record the override's `speed_mps` into `jobs.arrival_speed_mps` (even though unverified), and set `arrival_verified_at = null` as a deliberate null marker. Optionally add a `jobs.arrival_override_id uuid` foreign key to `job_emergency_overrides` so future queries can join to the reason. This is low cost and high forensic value for Phase 6.

---

### 7.2 `safety_mode_threshold_kmh` in DB but not in `getDriverManifest` payload

**Finding:** The column is added to `companies` but not exposed in `getDriverManifest`. The threshold is hardcoded client-side at `2.778 m/s` (10 km/h). A company that sets a different threshold in the DB would see no effect until a future phase adds it to the manifest. There is no mechanism to tell the coordinator that their custom threshold is being ignored.

**Risk level:** 🟡 Low — design debt, not an operational risk in Phase 4

**Recommendation:** Either do not add the migration in Phase 4 (defer to the phase that uses it), or add a comment to the migration warning that the column is not yet read by the application.

---

## 8. Waiting System Conflicts

### 8.1 `calculated_amount` is not computed when a wait session is force-closed

**Finding:** In the normal flow, `closeOpenWaitSession` (called on `en_route` or `in_progress`) computes the `calculated_amount` (rate × chargeable minutes beyond the free period) and sets it on the session at close time. This is the immutable system-computed charge that precedes any coordinator proposal.

The plan states that Force En Route and Force Complete auto-close open wait sessions. However, it does not mention computing `calculated_amount` during the emergency close. If the force-close calls `closeOpenWaitSession` (the same helper), the computed amount would be calculated correctly. If the force-close performs a raw `UPDATE job_wait_sessions SET ended_at = now()` without going through the helper, `calculated_amount` will remain null, breaking downstream billing.

**Risk level:** 🔴 Blocking — silent billing data loss if the helper is not called.

**Required fix:** The server function must call the same `closeOpenWaitSession` helper that `updateJobStatus` uses. Do not write a raw `ended_at` update. Verify that the helper correctly sets `calculated_amount` and confirm this in the test plan.

---

### 8.2 Pending `job_wait_proposals` are orphaned on Force Complete

**Finding:** If a coordinator has an open `job_wait_proposals` row (`status = 'pending'`) for a wait session and the driver uses Force Complete, the job completes, the wait session closes, but the wait proposal remains in `pending` status indefinitely. There is no cleanup mechanism for orphaned proposals.

**Risk level:** 🟡 Low for Phase 5 (rare case), Medium for Phase 6 reporting

**Recommendation:** In `emergencyOverrideJobStatus`, when `to_status === 'completed'`, close any pending wait proposals for this job's sessions by setting `status = 'superseded'` (requires a new ENUM value) or `status = 'rejected'` with a `driver_response_note = 'Emergency override — trip completed'`.

---

## 9. Passenger Boarding Conflicts

### 9.1 Pending `job_boarding_approvals` are not cleaned up on Force in_progress

**Finding:** When a driver uses Force in_progress, the boarding gate is bypassed. If a pending `job_boarding_approvals` row exists (the driver had previously requested coordinator approval), this row is left with `status = 'pending'` after the transition. The plan does not address orphaned boarding approvals.

This causes:
1. The coordinator's dashboard may still show a pending boarding approval request for a trip that is already in progress.
2. Phase 6 audit queries counting "pending approvals resolved" would over-count them as outstanding.
3. If the coordinator then approves the orphaned request, it would have no effect (the status is already `in_progress`) but would still insert/update the `job_boarding_approvals` row.

**Risk level:** 🟠 High — coordinator dashboard confusion, audit data contamination

**Required fix:** In `emergencyOverrideJobStatus`, when `to_status === 'in_progress'`, set any pending `job_boarding_approvals` row for this job to `status = 'overridden'` and set `override_at = now()`. The `overridden` status already exists in the ENUM (`CHECK (status IN ('pending', 'approved', 'rejected', 'overridden'))`), making this a clean fit.

---

### 9.2 Passengers with `pending` status remain after Force in_progress

**Finding:** After Force in_progress, some passengers may still have `pax.status = 'pending'` (not yet confirmed or no-showed). There is no mechanism in the plan to set these to a final status, and Phase 6 audit might expect all passengers to have a terminal status at trip completion.

**Risk level:** 🟡 Low — data hygiene issue, not an operational blocker for Phase 5

**Recommendation:** Document this as a known limitation of the emergency override. Optionally, when Force Complete is used, auto-set any remaining `pending` pax to a new status like `unknown` or leave them as-is with a note in the audit trail. Do not auto-set to `noshow` as that could be incorrect. The audit record in `job_emergency_overrides` provides the context.

---

## 10. Audit Logging Requirements for Phase 6

### 10.1 Location at time of override is not captured

**Finding:** The `job_emergency_overrides` table records `speed_mps` at time of override, but not `lat`/`lng`. For a safety-critical event (especially `breakdown` or `safety_concern`), knowing where the driver was when the override was triggered is forensically important. Phase 6 will likely require location data for override investigations.

**Recommendation:** Add `override_lat double precision` and `override_lng double precision` nullable columns to `job_emergency_overrides`. The client already has the driver's current coordinates from `DriverLiveShare`; passing them to the server function and recording them is straightforward.

---

### 10.2 Boarding state at time of override is not captured

**Finding:** When Force in_progress is used, the override record does not capture how many passengers were boarded, no-showed, or still pending at the time. The `pax_summary` field exists on `job_boarding_approvals` for this purpose but there is no equivalent on `job_emergency_overrides`.

**Recommendation:** Add a `pax_snapshot jsonb` nullable column to `job_emergency_overrides`. When `to_status === 'in_progress'`, populate it with the current pax statuses at the time of the call. This mirrors the `pax_summary` on `job_boarding_approvals` and gives Phase 6 auditors full context without querying across tables.

---

### 10.3 No coordinator alert beyond chat

**Finding:** The only real-time coordinator notification of an emergency override is the system chat message in the `driver_coord` thread. If the coordinator is not actively watching the chat (which is typical in a busy dispatch environment), the override may go unnoticed. Phase 6 plans to add reporting but there is no push notification or dashboard badge for overrides.

**Risk level:** 🟡 Low in Phase 5 (chat is sufficient for now)

**Recommendation:** The `job_emergency_overrides` table structure supports future alerting — no schema changes needed. However, consider whether the coordinator-side trip detail view should display an `⚠️ Override applied` badge when a `job_emergency_overrides` row exists for the job. This is a single query addition and would materially improve coordinator awareness.

---

### 10.4 No rate-limiting on emergency overrides per driver per trip

**Finding:** The plan identifies driver abuse risk (Section 9: "Driver abuses emergency override to bypass GPS gate repeatedly"). The mitigation is stated as "Repeat misuse is detectable from the audit table." However, no rate-limiting is implemented in Phase 5, and there is no maximum count or cooldown period.

**Risk level:** 🟡 Low in Phase 5

**Recommendation:** For Phase 5, add a server-side check: if more than N emergency overrides exist for the same `(job_id, driver_id)` within a 24-hour window, reject the override with an error code that prompts the driver to contact their coordinator. A reasonable N is 3. This does not need to be a complex rate-limiter — a simple `COUNT(*)` query on `job_emergency_overrides` is sufficient.

---

## 11. Group Trip Compatibility for Phase 7

### 11.1 Group dissolution does not run on emergency `completed`

**Finding:** In `updateJobStatus`, the group dissolution logic (lines 1021-1033) runs when `status = 'completed'`: it checks if all sibling trips in the `group_id` are completed or cancelled, and if so, clears `group_id`, `grouped_count`, and `grouped_at` across all siblings. This logic is not replicated in `emergencyOverrideJobStatus`.

This means:
1. A group trip that is force-completed will never trigger group dissolution, even if it was the last remaining active trip in the group.
2. `grouped_count` and `grouped_at` on the force-completed job and its siblings will remain stale.
3. Phase 7 group trip logic that inspects `group_id` to determine membership will see stale data.

**Risk level:** 🟠 High for Phase 7, Low for Phase 5 (groups still work operationally)

**Required fix:** Extract the group dissolution logic from `updateJobStatus` into a shared helper function (e.g., `dissolveGroupIfComplete`). Call it from both `updateJobStatus` and `emergencyOverrideJobStatus` when `to_status === 'completed'`. This is a refactor of existing logic, not new logic.

---

### 11.2 `emergencyOverrideJobStatus` processes only a single job

**Finding:** Phase 7 may introduce grouped status transitions (e.g., all trips in a group advance together). The current design of `emergencyOverrideJobStatus` is single-job. Phase 7 would need to decide whether a group emergency override applies to all siblings or just the specific job. This is a design question to resolve in Phase 7 planning, not a blocker for Phase 5.

**Risk level:** 🟡 Low — document as a known Phase 7 design decision

---

## 12. Recommended Adjustments

| # | Area | Adjustment | Priority |
|---|---|---|---|
| A1 | `JobCard` | Type `isSafetyMode` as optional (`boolean = false`) to prevent callsite breaks | 🟠 High |
| A2 | `use-safety-mode.ts` | Treat non-positive speed values (`<= 0`) as null — handles iOS `-1` return | 🔴 Blocking |
| A3 | `DriverLiveShare.tsx` | Implement a speed staleness timeout (e.g., 30 s of no updates → reset to null) | 🟠 High |
| A4 | `emergencyOverrideJobStatus` | Define an explicit `(from_status, to_status)` allow-list; reject unlisted pairs | 🟠 High |
| A5 | `emergencyOverrideJobStatus` | On `to_status = 'in_progress'`, set any pending `job_boarding_approvals` to `overridden` | 🟠 High |
| A6 | `emergencyOverrideJobStatus` | Call `closeOpenWaitSession` helper (not raw UPDATE) when force-closing wait sessions | 🔴 Blocking |
| A7 | Migration | Add RLS policies + GRANT statements for `job_emergency_overrides` | 🔴 Blocking |
| A8 | `emergencyOverrideJobStatus` | Call `dissolveGroupIfComplete` helper on `to_status = 'completed'` | 🟠 High |
| A9 | `job_emergency_overrides` | Add `override_lat`/`override_lng` columns for location forensics | 🟡 Low |
| A10 | `job_emergency_overrides` | Add `pax_snapshot jsonb` column; populate on Force in_progress | 🟡 Low |
| A11 | `emergencyOverrideJobStatus` | Add per-job rate limit (max 3 overrides per job per 24 h) | 🟡 Low |
| A12 | `emergencyOverrideJobStatus` | On `to_status = 'completed'`, clear `grouped_count`/`grouped_at` on the job | 🟡 Low |

---

## 13. Required Changes Before Implementation

The following three issues **must be resolved** before any code is written for Batch B. Implementing without these fixes introduces either silent data corruption (wait session billing, audit gaps) or a broken coordinator experience (RLS lock-out):

---

### R1 — RLS policies for `job_emergency_overrides` (Section 3.1)

The migration SQL must include `CREATE POLICY` statements and `GRANT` statements. Without them, the table is inaccessible to coordinators and the feature is only partially functional.

**Files affected:** New migration file `supabase/migrations/<ts>_batch_b_emergency_overrides.sql`

**Proposed solution (R1):**

1. Add explicit grants:
   - `GRANT SELECT, INSERT, UPDATE, DELETE ON public.job_emergency_overrides TO authenticated;`
   - `GRANT ALL ON public.job_emergency_overrides TO service_role;`
2. Add a read policy for authenticated company users tied to job ownership scope (same `company_id` / `executor_company_id` model used by existing Batch A policies).
3. Keep write-path controlled by server function via `service_role`; do not expose direct driver inserts via authenticated RLS.
4. Add migration comments clarifying that writes are server-mediated and audit rows are append-only.
5. Add migration verification checklist:
   - Authenticated coordinator can read rows for own company jobs.
   - Authenticated coordinator cannot read rows outside company scope.
   - Driver-side direct table insert is denied.
   - Server function insert succeeds.

---

### R2 — `closeOpenWaitSession` must be called, not bypassed (Section 8.1)

The `emergencyOverrideJobStatus` server function must use the existing `closeOpenWaitSession` helper to close wait sessions on Force En Route and Force Complete. A raw `ended_at` update would lose the `calculated_amount` computation, resulting in billing records with null charges.

**Files affected:** `src/lib/coordinator-public.functions.ts`

**Proposed solution (R2):**

1. In `emergencyOverrideJobStatus`, for override targets that terminate waiting (`to_status = 'en_route'` and `to_status = 'completed'`), call the existing `closeOpenWaitSession(...)` helper with the same arguments pattern used in `updateJobStatus`.
2. Prohibit direct `job_wait_sessions` raw updates in emergency flow (design rule: all wait closure paths must pass through one helper).
3. Ensure helper execution occurs in the same logical operation window as status override and audit insertion so closure and billing are not skipped.
4. Add explicit acceptance criteria:
   - Open session closes with `ended_at` set.
   - `calculated_amount` is computed and persisted.
   - Existing `agreed_amount` behavior remains unchanged.
   - No duplicate open sessions are created as side effects.

---

### R3 — iOS speed `-1` handling in `use-safety-mode.ts` (Section 4.1)

`useSafetyMode` must treat `speed <= 0` as no-data (same as `null`). Without this, a stopped iOS device reporting `speed = -1` would be filtered correctly by accident, but any explicit truthy check on the speed value would break. Making the guard explicit is required before shipping to iOS.

**Files affected:** `src/hooks/use-safety-mode.ts`

**Proposed solution (R3):**

1. Normalize incoming speed before threshold evaluation:
   - `null`, `undefined`, `NaN`, and `<= 0` values are treated as no-data.
2. Run Safety Mode threshold logic only on normalized positive speed values.
3. Keep default fail-open behavior: if speed is no-data, Safety Mode is off.
4. Add cross-platform acceptance criteria:
   - iOS invalid speed (`-1`) never activates Safety Mode.
   - Valid positive speeds on iOS/Android activate/deactivate correctly at threshold.
   - Browser `null` speed remains non-blocking.

---

## 14. Estimated Implementation Complexity

### Phase 4 — Driver Safety Mode

| Component | Complexity | Notes |
|---|---|---|
| `DriverLiveShare.tsx` — add `onSpeedChange` prop + staleness timeout | Low | Minimal prop addition; 1–2 h |
| `use-safety-mode.ts` — hook with iOS guard and threshold logic | Low | Pure logic, no async; 1–2 h |
| `SafetyModeOverlay.tsx` — banner component | Low | UI only; 1–2 h |
| `DriverManifest` + `JobCard` wiring | Medium | Prop threading, size changes, testing across devices; 3–5 h |
| **Phase 4 total** | **Medium** | **6–11 hours** |

### Phase 5 — Emergency Override

| Component | Complexity | Notes |
|---|---|---|
| Migration — `job_emergency_overrides` + RLS + GRANT | Medium | Includes policy definitions; 2–3 h |
| `EmergencyOverrideDialog.tsx` — two-step UI | Medium | Radio groups, confirmation step, large touch targets; 3–4 h |
| `emergencyOverrideJobStatus` — server function | High | 10-step logic, wait session close, boarding approval cleanup, group dissolution, backward transition handling, rate limit; 6–10 h |
| Regression testing — Phases 1, 2, 3 gates | Medium | Manual test matrix; 3–4 h |
| **Phase 5 total** | **High** | **14–21 hours** |

### Batch B total

| Phase | Estimate |
|---|---|
| Phase 4 | 6–11 hours |
| Phase 5 | 14–21 hours |
| **Total** | **20–32 hours** |

> Complexity ratings assume Batch A (Phase 2 + Phase 3) is fully implemented and all migrations are applied. If Batch A is still in progress, Phase 5 testing complexity increases by approximately 4–8 hours due to additional integration surface.

---

## 15. Batch B Implementation Plan (Post-Blocking Resolution)

This plan starts only after R1, R2, and R3 are design-locked as above.

### 15.1 Phase Order

1. **Phase 5 foundations first (blocking-safe core)**
   - Implement migration for `job_emergency_overrides` with full RLS + GRANT model (R1).
   - Implement server-side `emergencyOverrideJobStatus` skeleton with validation and audit insertion.
2. **Waiting-safe emergency flow**
   - Integrate `closeOpenWaitSession(...)` for emergency `en_route` / `completed` transitions (R2).
   - Add boarding approval cleanup (`pending -> overridden`) on emergency `in_progress`.
3. **Phase 4 Safety Mode**
   - Implement speed propagation (`DriverLiveShare -> DriverManifest`).
   - Implement `use-safety-mode` normalization guard for invalid/non-positive speed (R3).
   - Implement Safety Mode UI restrictions and overlay.
4. **Emergency driver UI**
   - Implement `EmergencyOverrideDialog` with reason + forced-status flow and confirmation.
   - Wire to mutation and manifest refresh.
5. **Regression + readiness**
   - Validate GPS gate, waiting auto-start/auto-close, boarding gate behavior in normal (non-emergency) flow.
   - Validate emergency paths and audit visibility to coordinators.

### 15.2 Delivery Batches

| Batch | Scope | Exit Criteria |
|---|---|---|
| B1 | R1 migration + policy correctness | Coordinator scoped read works; unauthorized read blocked |
| B2 | Emergency server function + R2 wait-safe closure | Force `en_route`/`completed` closes wait with `calculated_amount` |
| B3 | Safety Mode + R3 speed normalization | Invalid speed never activates Safety Mode; critical actions remain available |
| B4 | Emergency dialog + end-to-end driver/coordinator flow | Override updates status, creates audit row, posts system chat |
| B5 | Full regression and rollout readiness | No regressions in Phase 1/2/3 behavior; manual checklist passes |

### 15.3 Final Go/No-Go Checklist

- R1 accepted: RLS + GRANT behavior verified in staging.
- R2 accepted: all emergency wait closures use `closeOpenWaitSession`.
- R3 accepted: iOS `-1` and null speed handling verified.
- Emergency overrides visible to coordinators via chat + table.
- Normal status gates (GPS / boarding / waiting) unchanged outside emergency path.

*End of Batch B Architecture Review*
