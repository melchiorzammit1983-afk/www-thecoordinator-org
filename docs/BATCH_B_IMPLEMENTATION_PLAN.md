# Batch B Implementation Plan
## Phase 4 — Driver Safety Mode · Phase 5 — Emergency Override

**Prepared:** 2026-07-09  
**Status:** Pre-implementation  
**Scope:** Phase 4 (Driver Safety Mode) + Phase 5 (Emergency Override)

---

## Table of Contents

1. [Current System Analysis](#1-current-system-analysis)
2. [Files to Modify](#2-files-to-modify)
3. [Database Changes](#3-database-changes)
4. [API Changes](#4-api-changes)
5. [Driver Safety Mode Design](#5-driver-safety-mode-design)
6. [Emergency Override Design](#6-emergency-override-design)
7. [State Machine Changes](#7-state-machine-changes)
8. [UI Changes](#8-ui-changes)
9. [Risks](#9-risks)
10. [Rollback Plan](#10-rollback-plan)
11. [Testing Strategy](#11-testing-strategy)

---

## 1. Current System Analysis

### 1.1 Existing Trip Workflow

The driver trip lifecycle follows this status progression, enforced in `updateJobStatus` (`coordinator-public.functions.ts`):

```
pending → en_route → arrived → in_progress → completed
           ↑                                      ↓
           └─────────── cancelled ────────────────┘
```

Key gates already in place:
- **Arrival gate** (`en_route → arrived`): requires a GPS fix ≤ 2 min old, within the company arrival radius (default 150 m), with sufficient accuracy.
- **Back to waiting**: allowed from `en_route` or `arrived` only.
- **Waiting auto-start**: when `arrived`, a `job_wait_sessions` row is created automatically (Phase 2).
- **Waiting auto-stop**: when `en_route`, any open `job_wait_sessions` row is closed automatically (Phase 2).
- **Boarding gate** (`arrived → in_progress`): all pax must have a non-`pending` status, OR a `job_boarding_approvals` row with `status IN ('approved','overridden')` must exist (Phase 3).

### 1.2 Existing Driver Status Workflow

Status buttons are rendered inside `JobCard` in `src/routes/m.driver.$token.tsx`.

| Button | Condition shown | Calls |
|---|---|---|
| "On the way to pickup" | next in STATUS_FLOW | `updateJobStatus({ status: "en_route" })` |
| "Arrived at pickup" | next in STATUS_FLOW | `updateJobStatus({ status: "arrived" })` |
| "Passengers on board — en route" | next in STATUS_FLOW | `updateJobStatus({ status: "in_progress" })` |
| "Trip finished" | next in STATUS_FLOW | Opens `TripSummaryDialog` → `updateJobStatus({ status: "completed" })` |
| "Back to waiting" | status is `en_route` or `arrived` | `updateJobStatus({ status: "pending" })` |
| "Give back" (reject) | accepted, not `in_progress`/`completed` | `driverRejectJob` |
| "Running late" | accepted, not `completed` | `driverReportLate` |
| "Mark paid / Mark pending" | always shown | `setJobPaymentStatus` |
| "Hide" | always shown | `hideJobForDriver` |

### 1.3 Existing Driver UI Screens

| Component | Location | Purpose |
|---|---|---|
| `DriverManifest` | `src/routes/m.driver.$token.tsx` | Main driver page — job list + dashboard panels |
| `JobCard` | `src/routes/m.driver.$token.tsx` | Per-job card with route, status, action buttons |
| `TripExecutionDialog` | `src/routes/m.driver.$token.tsx` | Passenger boarding modal (Confirm / No-show / Undo) |
| `NavigateFullscreen` | `src/components/driver/NavigateFullscreen.tsx` | Full-screen turn-by-turn navigation overlay |
| `DriverDashboardMap` | `src/components/driver/DriverDashboardMap.tsx` | Live GPS map panel in the dashboard carousel |
| `DriverLiveShare` | `src/components/driver/DriverLiveShare.tsx` | Background GPS broadcaster (hidden component) |
| `DriverWaitingPanel` | `src/components/driver/DriverWaitingPanel.tsx` | Waiting timer, live charge, proposal accept/reject |
| `DriverPricePanel` | `src/components/driver/DriverPricePanel.tsx` | Pre-trip fare proposals |
| `TripSummaryDialog` | `src/components/driver/TripSummaryDialog.tsx` | Trip completion summary |

**Existing "locked while in motion" behaviour:** When `inMotion = true` (status is `en_route` or `in_progress`), the three-dot overflow menu is replaced with a disabled icon button labelled "Menu locked while in motion". This is a cosmetic lock only — the status action buttons and "Navigate" button remain fully active.

### 1.4 Existing GPS and Speed Tracking Capabilities

GPS data flows through three components on the client side, all using `navigator.geolocation.watchPosition` (web) or the Capacitor `Geolocation` plugin (native):

| Component | Speed exposed? | Pushed to server? |
|---|---|---|
| `DriverLiveShare.tsx` | ✅ `location.speed` → `speed_mps` | ✅ via `pushDriverLocation` every ~12 s or 20 m moved |
| `DriverDashboardMap.tsx` | ❌ only lat/lng | ❌ display only |
| `NavigateFullscreen.tsx` | ❌ only lat/lng | ❌ display only |

The `driver_locations` table stores `speed_mps` (metres per second) on every push. Speed data is therefore available client-side inside `DriverLiveShare` during a live GPS session, and available server-side for any logic that queries `driver_locations`.

**10 km/h threshold = 2.778 m/s** (the threshold for Safety Mode activation).

Speed is not currently surfaced in any driver UI element. `DriverLiveShare` is rendered as a hidden background component inside `DriverManifest`.

### 1.5 Existing Approval Workflows

| Table | Purpose | Parties | Timeout |
|---|---|---|---|
| `job_boarding_approvals` | Coordinator approves partial boarding | Coordinator approves, driver requests / overrides | 5 min driver override |
| `job_wait_proposals` | Coordinator proposes waiting charge adjustment | Coordinator proposes, driver accepts/rejects | None |

No emergency or unilateral driver override exists for any status transition.

### 1.6 Existing Audit Logging Capabilities

There is no dedicated audit table. The system uses `chat_messages` with `sender_kind = 'system'` and `thread_kind = 'driver_coord'` as an informal audit trail. System messages are inserted when:
- A driver is assigned to a job.
- A driver is expected to accept.
- A driver reports running late.

All system chat messages are viewable by coordinators in the trip chat.

### 1.7 Existing Trip Actions Available to Drivers

**Actions disabled when `inMotion = true` (current behaviour — cosmetic only):**
- Three-dot overflow menu (Edit profile, Download statement, Auto-read toggle)

**Actions always available regardless of motion:**
- Status progression buttons
- Navigate (Google Maps external link)
- Running late
- Chat coordinator
- Mark paid / pending
- Open Sign Board
- Passenger boarding (TripExecutionDialog)

**Actions constrained by trip status:**
- "Give back" — only before `in_progress` or `completed`
- "Back to waiting" — only from `en_route` or `arrived`
- "Approve deletion" — only when `deletion_requested_at` is set

---

## 2. Files to Modify

### 2.1 New Migrations (Supabase)

| File (to be created) | Purpose |
|---|---|
| `supabase/migrations/<ts>_batch_b_emergency_overrides.sql` | Create `job_emergency_overrides` table; add `safety_mode_threshold_kmh` to `companies` |

### 2.2 New Source Files

| File | Purpose |
|---|---|
| `src/hooks/use-safety-mode.ts` | React hook that reads live speed from `DriverLiveShare` (via callback) and returns `isSafetyMode: boolean` and `speedKmh: number \| null` |
| `src/components/driver/SafetyModeOverlay.tsx` | High-contrast, large-text safety banner rendered above trip cards when Safety Mode is active |
| `src/components/driver/EmergencyOverrideDialog.tsx` | Modal for selecting override reason and target status; calls `emergencyOverrideJobStatus` |

### 2.3 Modified Source Files

| File | Change |
|---|---|
| `src/components/driver/DriverLiveShare.tsx` | Accept an `onSpeedChange?: (speedMps: number \| null) => void` prop; call it whenever a new GPS point is emitted so the parent can track current speed |
| `src/routes/m.driver.$token.tsx` | Track current speed state lifted from `DriverLiveShare`; derive `isSafetyMode`; pass `isSafetyMode` to `JobCard`; render `SafetyModeOverlay`; wire `EmergencyOverrideDialog` |
| `src/lib/coordinator-public.functions.ts` | Add `emergencyOverrideJobStatus` server function |
| `src/integrations/supabase/types.ts` | Add `job_emergency_overrides` Row / Insert / Update types; add `safety_mode_threshold_kmh` to `companies` types |

---

## 3. Database Changes

### 3.1 New Table — `job_emergency_overrides`

```sql
CREATE TABLE public.job_emergency_overrides (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id           uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  driver_id        uuid REFERENCES public.drivers(id) ON DELETE SET NULL,
  company_id       uuid NOT NULL,
  from_status      text NOT NULL,            -- job status at the time of override
  to_status        text NOT NULL,            -- the status forced by the override
  reason           text NOT NULL,            -- one of the 7 canonical reasons
  reason_note      text,                     -- optional free-text detail
  speed_mps        double precision,         -- driver speed at time of override (if known)
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX job_emergency_overrides_job_idx  ON public.job_emergency_overrides (job_id);
CREATE INDEX job_emergency_overrides_time_idx ON public.job_emergency_overrides (created_at DESC);

ALTER TABLE public.job_emergency_overrides ENABLE ROW LEVEL SECURITY;
-- Coordinators/company roles can read overrides for their jobs.
-- Drivers can write (insert) via server function using service_role.
-- Service role has full access.
```

**Why a dedicated table:** Emergency overrides are safety-critical events. Recording them in a dedicated table (separate from `chat_messages`) allows reporting, filtering by driver, and future alerting without scanning unstructured text.

### 3.2 `companies` Table — New Column

```sql
ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS safety_mode_threshold_kmh integer NOT NULL DEFAULT 10
    CHECK (safety_mode_threshold_kmh >= 1 AND safety_mode_threshold_kmh <= 200);
```

- Default: 10 km/h (2.778 m/s).
- Allows per-company tuning (e.g., a stricter 5 km/h for bus operators).
- `NULL` is not permitted — a default always applies.

> **Note:** The threshold is stored server-side for reporting and future server-enforced safety checks, but Safety Mode activation in Phase 4 is driven client-side using the real-time GPS speed from `DriverLiveShare`. A future phase could enforce it server-side.

---

## 4. API Changes

### 4.1 Modified Function — `pushDriverLocation`

No schema change. `DriverLiveShare` already pushes `speed_mps` on every GPS point. The new `onSpeedChange` callback only affects the component's prop contract, not the server function.

### 4.2 New Server Function — `emergencyOverrideJobStatus`

**Location:** `src/lib/coordinator-public.functions.ts`

**Input:**
```typescript
{
  token:       string;          // driver magic-link token
  job_id:      string;          // UUID
  to_status:   "arrived" | "in_progress" | "en_route" | "completed";
  reason:      EmergencyReason; // one of 7 canonical values
  reason_note: string | null;   // free-text, max 500 chars
  speed_mps:   number | null;   // current speed at time of override
}
```

**`EmergencyReason` enum (7 values):**
```
"gps_issue" | "wrong_pickup_pin" | "passenger_different_pickup" |
"auto_status_failed" | "breakdown" | "safety_concern" | "other"
```

**Logic:**
1. Validate the driver token and resolve the job (`loadDriverJob`).
2. Verify the job belongs to this driver and is in an active, non-completed state.
3. Validate `to_status` is forward-only (cannot override backwards to a previous status, except `en_route` which may be needed after an erroneous `in_progress`). Specific allowed overrides:
   - `→ arrived` (bypass GPS arrival gate)
   - `→ in_progress` (bypass boarding gate)
   - `→ en_route` (allow re-entry after erroneous advance)
   - `→ completed` (bypass trip summary)
4. Set the forced `patch.status = to_status` on `public.jobs`.
5. Insert a row into `job_emergency_overrides` recording the override reason and speed.
6. Insert a system `chat_messages` row (`sender_kind: "system"`, `thread_kind: "driver_coord"`) so the coordinator sees the override immediately in the trip chat. Message format: `⚠️ Emergency override: driver forced status to "{to_status}" — Reason: {reason_label}`.
7. If `to_status === "arrived"` — do NOT auto-start a wait session (the driver is overriding; the arrival was not GPS-verified).
8. If `to_status === "in_progress"` — set `driver_started_at` if not already set.
9. If `to_status === "completed"` — set `driver_completed_at` if not already set.
10. Return `{ ok: true }`.

**Access:** Driver magic-link token. Validated server-side.  
**Does NOT require coordinator approval.** This is a unilateral driver action.

---

## 5. Driver Safety Mode Design

### 5.1 Activation Logic

Safety Mode is a **client-side only** state in Phase 4. It is derived from the speed reported by the device GPS and does not require a server round-trip to activate or deactivate.

```
isSafetyMode = currentSpeedMps >= (threshold_kmh / 3.6)
             = currentSpeedMps >= 2.778  (at default 10 km/h)
```

- **Source:** `DriverLiveShare` emits `speed_mps` from `GeolocationPosition.coords.speed` on every GPS update.
- **Propagation:** `DriverLiveShare` gains an `onSpeedChange` prop. `DriverManifest` lifts this speed into a `currentSpeedMps` state. The `isSafetyMode` boolean is derived from it.
- **Threshold:** Default 10 km/h. Phase 4 hardcodes this client-side; a later phase can read `companies.safety_mode_threshold_kmh` from the manifest payload.
- **Hysteresis:** Safety Mode activates when speed ≥ threshold for any single GPS reading. It deactivates only when speed drops below threshold. No debounce is needed for Phase 4 — the risk of a false activation from a noisy GPS ping is low and resolved within seconds as subsequent pings arrive.
- **No GPS speed:** If `coords.speed` is `null` (device does not report speed, or GPS is off), Safety Mode is `false`. Do not activate on missing data.

### 5.2 What Safety Mode Disables

These actions are disabled (buttons disabled/hidden) when `isSafetyMode === true`:

| Action | Why disabled |
|---|---|
| "Give back" (reject/return trip) | Trip management — requires driver attention off-road |
| "Back to waiting" | Status reversal — requires deliberate intent |
| "Mark paid / Mark pending" | Billing change — requires financial attention |
| Three-dot overflow menu | Settings/profile — not driving-critical |
| "Running late" report | Non-critical message — can wait until stopped |
| Trip hide/restore | Administrative — not time-sensitive |

> **Note:** There is no dedicated "Edit Trip" or "Change Route" button in the current driver UI. "Edit Trip" is a coordinator-side action only. "Change Route" does not exist as a driver action. The items above represent the full set of non-critical driver actions.

### 5.3 What Safety Mode Keeps Active

| Action | Always available in Safety Mode |
|---|---|
| Status progression buttons (en_route, arrived, in_progress, completed) | ✅ |
| "Open trip · Board passengers" (TripExecutionDialog) | ✅ |
| Navigate (Google Maps external) | ✅ |
| Navigate fullscreen (in-app turn-by-turn) | ✅ |
| Chat coordinator | ✅ |
| Emergency Override button (Phase 5) | ✅ |
| Open Sign Board | ✅ |

### 5.4 `use-safety-mode` Hook Design

```typescript
// src/hooks/use-safety-mode.ts

interface SafetyModeResult {
  isSafetyMode: boolean;
  speedKmh: number | null;
  speedMps: number | null;
}

function useSafetyMode(thresholdKmh: number = 10): SafetyModeResult
```

- Consumes a `speedMps` value passed from the parent (which receives it from `DriverLiveShare.onSpeedChange`).
- Returns `isSafetyMode`, `speedKmh` (for display), and `speedMps`.
- The hook itself is stateless — speed state lives in the parent (`DriverManifest`).

---

## 6. Emergency Override Design

### 6.1 Overview

Emergency Override allows a driver to force a job status transition, bypassing any gate (GPS arrival gate, boarding gate). It is an escape hatch for real-world situations where the automated workflow fails or does not match reality.

### 6.2 Override Reasons (7 canonical values)

| Value | Display label |
|---|---|
| `gps_issue` | GPS Issue |
| `wrong_pickup_pin` | Wrong Pickup Pin |
| `passenger_different_pickup` | Passenger Requested Different Pickup |
| `auto_status_failed` | Auto Status Failed |
| `breakdown` | Breakdown |
| `safety_concern` | Safety Concern |
| `other` | Other |

### 6.3 Override Actions (5 force transitions)

| Force action | `to_status` | Bypasses |
|---|---|---|
| Force Arrived | `arrived` | GPS arrival gate (distance/accuracy/freshness checks) |
| Force Passenger On Board | `in_progress` | Boarding gate (all-pax-status requirement) |
| Force En Route | `en_route` | Normal forward-only constraint |
| Force Drop Off _(completes the drop-off leg)_ | `in_progress` if re-entering from a pickup issue, or implicitly paired with Force Complete | — |
| Force Complete | `completed` | Trip summary dialog |

> "Force Drop Off" in the requirements maps to completing the in-progress leg and triggering the completion. In the state machine, it is equivalent to `→ completed` (the drop-off is the last physical leg). Implementation: "Force Drop Off" UI option calls `emergencyOverrideJobStatus` with `to_status = "completed"`.

### 6.4 `EmergencyOverrideDialog` Component

```
┌───────────────────────────────────────┐
│  ⚠️  Emergency Override               │
│  This will bypass automatic checks.   │
│  A record will be created for review. │
│                                       │
│  Select forced status:                │
│  ○ Force Arrived                      │
│  ○ Force Passenger On Board           │
│  ○ Force En Route                     │
│  ○ Force Drop Off (Complete)          │
│  ○ Force Complete                     │
│                                       │
│  Reason:                              │
│  ○ GPS Issue                          │
│  ○ Wrong Pickup Pin                   │
│  ○ Passenger Requested Different P…   │
│  ○ Auto Status Failed                 │
│  ○ Breakdown                          │
│  ○ Safety Concern                     │
│  ○ Other                              │
│                                       │
│  Additional details (optional):       │
│  [ free-text, max 500 chars         ] │
│                                       │
│        [Cancel]  [Confirm Override]   │
└───────────────────────────────────────┘
```

**Trigger:** An "Emergency" button (`AlertTriangle` icon) rendered in `JobCard` action buttons. Always visible when a trip is accepted and active (not completed/cancelled). When Safety Mode is active, this button gets additional visual prominence (larger, red background).

**Confirmation step:** Because this is a destructive bypass, the dialog has a two-step: selecting options (step 1) → confirmation summary (step 2) before the mutation fires.

**Post-override:** On success, a toast confirms the override, and the manifest refetches. The coordinator sees the system chat message immediately.

---

## 7. State Machine Changes

### 7.1 Normal State Machine (unchanged)

```
pending → en_route → arrived → in_progress → completed
```

Gates remain exactly as they are. The emergency override does not modify them.

### 7.2 Emergency Override Paths (new, parallel)

```
any_active_status --[emergencyOverride]--> arrived
any_active_status --[emergencyOverride]--> in_progress
any_active_status --[emergencyOverride]--> en_route
any_active_status --[emergencyOverride]--> completed
```

Constraints on overrides:
- Cannot override to `pending` (use "Back to waiting" instead).
- Cannot override a `completed` or `cancelled` job (server validates).
- Cannot override a job the driver does not own.
- All overrides are logged to `job_emergency_overrides` and broadcast as system chat messages.

### 7.3 Safety Mode State Machine

```
speedMps < threshold  →  normalMode
speedMps >= threshold →  safetyMode (client-side only, no server state)
```

Safety Mode has no effect on the server state machine. It only controls which client UI elements are interactive.

### 7.4 Wait Session Interaction with Emergency Overrides

| Override target | Wait session effect |
|---|---|
| `→ arrived` | **No auto-start.** The override skips the normal `arrived` hooks. Wait sessions are only auto-started on normal GPS-verified arrivals. |
| `→ en_route` | If an open wait session exists, it is **auto-closed** (same as normal `en_route` transition). |
| `→ in_progress` | No effect on wait sessions. |
| `→ completed` | Any open wait session is **auto-closed** with `ended_at = now()`. |

---

## 8. UI Changes

### 8.1 Safety Mode — `DriverManifest` (`m.driver.$token.tsx`)

| Change | Detail |
|---|---|
| Speed state | Add `currentSpeedMps` state; receive it from `DriverLiveShare` via `onSpeedChange` prop |
| `isSafetyMode` | Derived: `(currentSpeedMps ?? 0) >= 2.778` |
| `SafetyModeOverlay` | Render above all trip cards when `isSafetyMode === true`. Fixed position, high-contrast yellow/black banner: `🚗 Safety Mode · {speedKmh} km/h · Distracting options hidden` |

### 8.2 Safety Mode — `DriverLiveShare.tsx`

| Change | Detail |
|---|---|
| New prop | `onSpeedChange?: (speedMps: number \| null) => void` |
| Call site | On every GPS point received (native and web paths), call `onSpeedChange(speed_mps)` after adding to the queue |

### 8.3 Safety Mode — `JobCard`

| Change | Detail |
|---|---|
| New prop | `isSafetyMode: boolean` |
| Disabled in safety mode | "Give back", "Back to waiting", "Mark paid/pending", overflow menu, "Running late", hide/restore buttons — set `disabled` and add `aria-label` explaining why |
| Button sizing | When `isSafetyMode === true`, status action buttons increase to `h-16 text-xl` (large touch targets). Normal mode retains current `h-10 / h-11` sizing |
| Emergency button | Always-visible `<Button variant="destructive" size="sm">` with `<AlertTriangle />` icon. When `isSafetyMode === true`, grows to `h-16 text-lg` and renders `sm:col-span-2` |

### 8.4 Safety Mode — Visual Spec

| Element | Normal mode | Safety Mode |
|---|---|---|
| Status buttons | `h-10`, `text-sm` | `h-16`, `text-xl`, `font-bold` |
| Emergency button | `h-10`, outlined-destructive | `h-16`, filled-destructive, `text-lg` |
| Banner | Hidden | Fixed top, `bg-yellow-400 text-black font-bold text-lg px-4 py-3 rounded-b-xl z-50` |
| Disabled buttons | Visible but disabled | Hidden (`hidden` class) to reduce cognitive load while driving |

### 8.5 Emergency Override — `EmergencyOverrideDialog.tsx`

| Element | Detail |
|---|---|
| Trigger | `AlertTriangle` button in `JobCard`; `onClick={() => setEmergencyOpen(true)}` |
| Step 1 | Reason selector (radio buttons, large touch targets `py-3`); forced status selector; optional note textarea |
| Step 2 | Confirmation screen: "You are about to override to [status] because [reason]. This creates a permanent record." → Cancel / Confirm |
| Post-confirm | Calls `emergencyOverrideJobStatus` mutation; on success: toast "Emergency override applied — coordinator notified"; invalidate manifest |

### 8.6 Emergency Override — Coordinator Visibility

No new coordinator UI is built in Phase 5. The coordinator is informed via:
1. The **system chat message** in the trip's `driver_coord` thread (auto-created by the server function).
2. The **`job_emergency_overrides` table** (queryable by admin / future reporting phases).

---

## 9. Risks

| Risk | Severity | Mitigation |
|---|---|---|
| **GPS speed not available on all devices** | Medium | `coords.speed` is `null` on many Android devices and desktop browsers. Safety Mode does not activate on `null`. This is the correct fail-open behaviour — better to show all buttons than to hide them unnecessarily. |
| **Speed spike from a single bad GPS fix** | Low | A single noisy reading triggering Safety Mode for 1–2 seconds is acceptable — it is brief and restores automatically. A more complex hysteresis (e.g. 3 consecutive readings above threshold) can be added in a later iteration. |
| **Driver abuses emergency override to bypass GPS gate repeatedly** | Medium | Every override is logged with reason, speed, and timestamp in `job_emergency_overrides`. Coordinators see the system chat message immediately. Repeat misuse is detectable from the audit table. Future phase can add a coordinator alert for > N overrides per driver per day. |
| **Override to `arrived` skips wait session auto-start** | Low | Intentional design: a forced arrival is ambiguous. The driver can manually start waiting if needed (the manual start path still exists). |
| **Override to `completed` without billing finalisation** | Medium | The `TripSummaryDialog` is skipped when using Force Complete. Any open wait session is auto-closed. Billing (price panel) must be finalised separately. The coordinator is alerted via chat. |
| **Safety Mode hides "Give back" button while driver needs to return trip** | Low | The driver can stop or pull over, wait for speed to drop below 10 km/h, and then use the "Give back" button. A 5–10 second wait is acceptable for a non-emergency action. |
| **`emergencyOverrideJobStatus` called by an invalid/expired token** | Low | `loadDriverJob` validates the token and job ownership server-side, same as all existing driver functions. |
| **Two drivers override the same job concurrently** | Very Low | Unlikely in normal operation. The `status` update on `jobs` is a simple UPDATE. The last write wins. Both overrides are logged independently in `job_emergency_overrides`. |
| **`safety_mode_threshold_kmh` column not yet returned in `getDriverManifest`** | Low | Phase 4 hardcodes 10 km/h client-side. In a future phase, the threshold can be included in the manifest payload and passed down to `useSafetyMode`. |

---

## 10. Rollback Plan

### 10.1 Database Rollback

Both database changes are additive.

| Step | Action |
|---|---|
| 1 | Drop `job_emergency_overrides` table. No foreign key dependents. All rows are lost — only safe if no overrides have been issued in production. |
| 2 | `ALTER TABLE public.companies DROP COLUMN IF EXISTS safety_mode_threshold_kmh;` — safe, no dependents. |

### 10.2 Application Rollback

| Component | Rollback action |
|---|---|
| `coordinator-public.functions.ts` | Remove `emergencyOverrideJobStatus` function entirely. The server does not call it unless the client sends the request. |
| `m.driver.$token.tsx` | Remove `currentSpeedMps` state, `SafetyModeOverlay`, `isSafetyMode` prop pass-through, and `EmergencyOverrideDialog` from `JobCard`. Restore the original button layout. |
| `DriverLiveShare.tsx` | Remove `onSpeedChange` prop. The component continues to function unchanged without it. |
| New files | Delete `src/hooks/use-safety-mode.ts`, `src/components/driver/SafetyModeOverlay.tsx`, `src/components/driver/EmergencyOverrideDialog.tsx`. |
| `supabase/types.ts` | Remove `job_emergency_overrides` type block and `safety_mode_threshold_kmh` from `companies`. |

### 10.3 Feature Flag (Recommended)

Wrap Safety Mode and Emergency Override activation behind a per-company feature flag check in the manifest payload:
- `features.driver_safety_mode` — controls whether `isSafetyMode` is ever `true` client-side.
- `features.emergency_override` — controls whether the Emergency button is rendered.

This allows disabling either feature per company without a code deployment.

---

## 11. Testing Strategy

### 11.1 Unit Tests — Server Functions

| Test | Expected result |
|---|---|
| `emergencyOverrideJobStatus` — valid token, valid job, reason `gps_issue`, `to_status = arrived` | `{ ok: true }`, job status updated to `arrived`, one row in `job_emergency_overrides`, one system chat message inserted |
| `emergencyOverrideJobStatus` — invalid token | Throws `driver_link_required` |
| `emergencyOverrideJobStatus` — job not belonging to this driver | Throws authorization error |
| `emergencyOverrideJobStatus` — job already `completed` | Throws error (cannot override completed job) |
| `emergencyOverrideJobStatus` — `to_status = completed`, open wait session exists | Wait session closed automatically, `ended_at` set |
| `emergencyOverrideJobStatus` — `to_status = arrived`, no open wait session | No wait session created (intentional, differs from normal `arrived`) |
| `emergencyOverrideJobStatus` — `to_status = en_route`, open wait session exists | Wait session closed automatically |

### 11.2 Integration Tests — API Contracts

| Test | Coverage |
|---|---|
| Normal `updateJobStatus` with GPS gate — not affected by Phase 4/5 changes | Regression |
| `pushDriverLocation` with `speed_mps` payload — still accepted, no schema change | Regression |

### 11.3 Manual Testing — Driver Safety Mode

| Scenario | Steps | Expected |
|---|---|---|
| **Activate at 10 km/h** | Open driver manifest with an active trip. Simulate GPS speed ≥ 2.778 m/s. | Safety Mode banner appears. Non-critical buttons hidden. Status buttons grow. Emergency button grows. |
| **Deactivate on slowdown** | Speed drops below 2.778 m/s. | Banner disappears. All buttons restore to normal size and visibility. |
| **No GPS speed** | Device returns `coords.speed = null`. | Safety Mode does not activate. All buttons remain visible. |
| **Critical buttons always accessible** | Activate Safety Mode. | Status progression buttons, Navigate, Open trip, Chat, Emergency all still functional. |
| **Disabled buttons inaccessible** | Activate Safety Mode. Try "Give back". | Button hidden/disabled. Cannot be clicked. |

### 11.4 Manual Testing — Emergency Override

| Scenario | Steps | Expected |
|---|---|---|
| **Force Arrived (GPS issue)** | Trip in `en_route`. Tap Emergency button. Select "GPS Issue", "Force Arrived", confirm. | Job status becomes `arrived`. Toast shown. Coordinator sees system chat message "⚠️ Emergency override: driver forced status to 'arrived' — Reason: GPS Issue". Row in `job_emergency_overrides`. No wait session auto-started. |
| **Force Passenger On Board** | Trip in `arrived`. Tap Emergency button. Select "Auto Status Failed", "Force Passenger On Board", confirm. | Job status becomes `in_progress`. Audit row created. System chat message sent. |
| **Force Complete (Force Drop Off)** | Trip in `in_progress`. Tap Emergency button. Select "Breakdown", "Force Drop Off", confirm. | Job status becomes `completed`. Any open wait session closed. Audit row created. System chat message sent. |
| **Cancel in step 2** | Start override flow, reach confirmation, tap Cancel. | No status change. No audit row. |
| **Expired token** | Submit override with an invalid token. | Server error returned, toast displayed. No status change. |
| **Coordinator view** | After any override, open coordinator's trip chat. | System message visible immediately, clearly labelled as an emergency override with reason. |

### 11.5 Regression Testing

| Area | Checklist |
|---|---|
| Phase 1 GPS arrival gate | Still enforced on normal `updateJobStatus`. Not bypassed unless driver explicitly uses Emergency Override. |
| Phase 2 wait session auto-start on `arrived` | Only triggers on normal `arrived` transition, not emergency override. |
| Phase 2 wait session auto-close on `en_route` | Still triggers on both normal and emergency `en_route` transitions. |
| Phase 3 boarding gate on `in_progress` | Still enforced on normal `updateJobStatus`. Not bypassed unless driver uses Emergency Override. |
| Existing driver UI buttons | "Back to waiting", "Give back", "Mark paid" all work correctly when Safety Mode is off. |
| `DriverLiveShare` GPS broadcast | Adding `onSpeedChange` prop does not break GPS broadcasting. Speed data still reaches `driver_locations`. |
