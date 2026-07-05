# Driver Waiting Timer + Add-Only Price Adjustments

## User-visible behaviour

### Driver app (`/m/driver/…`)
- On any active job, once status becomes **Arrived** (or later `in_progress`), a big **Start waiting** button appears on the job card.
- Pressing it starts a live `HH:MM:SS` counter on the card. The button turns into **Stop waiting**.
- Auto-suggest prompts (toast with "Start waiting?" + one-tap Yes):
  - GPS speed has been < 3 km/h for **5 min** while status ∈ arrived/in_progress.
  - Pickup or drop-off location contains "airport" / matches known MLA codes AND status = arrived for **60 min**.
  Dismissing the toast snoozes it for 10 min. Never auto-starts — driver must confirm.
- Pressing **Stop waiting** opens a small sheet:
  - Total minutes (read-only).
  - **"Agreed waiting charge (€)"** number field — free-form, defaults blank, required to save (0 allowed with a note).
  - Optional note.
  - Save → creates a `job_adjustments` row `kind='waiting'` and closes the session.
- Below the timer, a **"Add charge"** menu with three actions the driver can log at any time while the trip is active: **Extra stop**, **Toll**, **Other**. Each opens the same amount+note sheet. All appear as line items on the driver's own trip summary (running total shown).
- Add-only rule: the driver cannot edit the quoted base fare; can only add adjustments. Delete works only on adjustments the driver just added and only while the trip is not yet completed.

### Coordinator side
- **Trip card (calendar + list + trip sheet)**: when the job has an open wait session, show a pulsing amber chip `⏱ Waiting 08:42` that ticks live. When the session is closed, the chip disappears and the adjustment shows in the trip pricing panel.
- **Live driver map**: the driver's pin renders with an amber pulsing ring and a `Waiting Xm · <driver>` label while a session is open.
- **"Waiting now" strip** at the top of the coordinator calendar/dashboard: one row per open session with driver name, job, elapsed, jump-to-trip link. Auto-hides when empty.
- **Threshold toast + push**: when an open session crosses **15 min** and again at **60 min**, coordinator sees an in-app toast and (if enabled) a push: *"Driver Marco is waiting 15 min at Malta Airport – Trip #…"*. Handled by a lightweight `pg_cron` job every minute — no per-second server work.
- **Trip pricing panel**: shows the base fare and any driver-added adjustments as separate line items with kind, amount, driver note, timestamp. Coordinator can approve/dispute later (not in scope here — just visible).

## Data model (single migration)

### `public.job_wait_sessions`
- `id uuid pk`, `job_id uuid fk jobs`, `driver_id uuid fk drivers`
- `started_at timestamptz`, `ended_at timestamptz null`
- `source text` — `manual | auto_stopped | auto_airport`
- `agreed_amount numeric(10,2) null`, `driver_note text null`, `currency text default 'EUR'`
- `created_at`, `updated_at`
- Partial unique index: only one open session per job (`WHERE ended_at IS NULL`).
- RLS: drivers can insert/update their own; coordinators of the job's company (owner/executor/origin/chain) can read.
- GRANTs to authenticated + service_role.

### `public.job_adjustments`
- `id uuid pk`, `job_id uuid fk jobs`, `driver_id uuid fk drivers`
- `kind text` — `waiting | extra_stop | toll | other`
- `label text null`, `amount numeric(10,2)`, `currency text default 'EUR'`
- `wait_session_id uuid null fk job_wait_sessions` (set when kind=waiting)
- `driver_note text null`, `source text default 'driver'`
- `created_at`
- RLS + GRANTs mirroring `job_wait_sessions`.

### `jobs` — no schema change
Existing statement/pricing surfaces read from `job_adjustments` via a view/query; base fare stays untouched.

## Server functions

New in `src/lib/coordinator-public.functions.ts` (called from the tokenised driver app):
- `startWaitSession({token, job_id, source})` — verifies driver owns job, refuses if job status ∉ arrived/in_progress or terminal, refuses if an open session exists, inserts row.
- `stopWaitSession({token, job_id, agreed_amount, note})` — closes the open session for that job, atomically inserts the `waiting` `job_adjustments` row linked to it. Zod: amount ≥ 0, ≤ 100 000; note ≤ 500 chars.
- `addTripAdjustment({token, job_id, kind, amount, label, note})` — kind ∈ extra_stop/toll/other. Refuses if job terminal or already invoiced.
- `deleteTripAdjustment({token, adjustment_id})` — only rows created by same driver, only while job not completed, and never rows with `kind='waiting'` linked to a closed session (waiting stays on record).
- `getDriverJobPricing({token, job_id})` — returns base + adjustments + running total for the driver's own summary.

New in `src/lib/coordinator.functions.ts`:
- `listOpenWaitSessions()` — coordinator scope; returns `[{job_id, driver_id, driver_name, started_at, elapsed_sec, from_location, to_location}]`. Powers the "Waiting now" strip + card chips.
- `listJobAdjustments({job_id})` — for the trip pricing panel.
- Extend `listActiveDriverLocations` result to include `wait_started_at` when there's an open session — the map pin uses this to render the amber ring without a second round-trip.

## Threshold notifications (pg_cron + tiny endpoint)

- New `/api/public/hooks/wait-thresholds` route.
- pg_cron job `wait-threshold-check` every minute → `net.http_post` to that endpoint with the anon key in `apikey`.
- Endpoint scans `job_wait_sessions WHERE ended_at IS NULL` and for each session crossing a threshold in the last minute (15 min, 60 min), inserts a `trip_messages` system row (`sender_kind='system'`, `thread_kind='group'`) with the waiting alert, and — if the coordinator has push enabled — enqueues a push via existing infra. Idempotent via a `notified_thresholds int[]` column on `job_wait_sessions` (added in the migration; e.g. `{15,60}`).

## Driver-side auto-suggest

Purely client-side in `src/routes/m.driver.$token.tsx`:
- Reuses the existing GPS watch inside `DriverLiveShare` — no new watchers.
- Tracks a rolling window of the last N speed samples; when `avg < 3 km/h` for 5 min AND active status arrived/in_progress AND no open session AND not snoozed → shows the "Start waiting?" toast with a Yes button that calls `startWaitSession`.
- Airport check: on status change to `arrived`, if `from_location` matches `/\b(airport|MLA|arrivals)\b/i` OR is inside a small bounding box around MLA, schedules a 60-min timeout that fires the same toast. Cleared on status change or wait started.
- Snooze = ref-held `Date.now()` gate.

## Coordinator UI wiring

- **`TripDetailsSheet.tsx`**: new "Pricing & adjustments" section listing `job_adjustments`. Shows amber "⏱ Waiting Xm" pill in the header while an open session exists (polled via `listOpenWaitSessions` every 5 s). Chip fades to a green "Wait recorded — €X" once closed.
- **`coordinator.calendar.tsx`**: add a `WaitingNowStrip` at the top; add the chip to each `JobCard`; extend the driver-live-map layer to render the amber pulsing ring from the enriched `listActiveDriverLocations` payload.
- **Toast on threshold**: coordinator app already subscribes to `trip_messages` for system rows — the wait alerts flow through automatically. Just make sure the toaster surfaces `sender_kind='system'` waiting messages with an amber icon.

## Files touched

- migration: new file (both tables, RLS, GRANTs, partial unique index, `notified_thresholds` column, indexes on `(job_id) WHERE ended_at IS NULL` and `(job_id)` for adjustments).
- `src/lib/coordinator-public.functions.ts` — new server fns.
- `src/lib/coordinator.functions.ts` — new server fns + extend `listActiveDriverLocations`.
- `src/routes/api/public/hooks/wait-thresholds.ts` — new route.
- Second migration schedules the pg_cron job.
- `src/routes/m.driver.$token.tsx` — waiting button/timer/sheet, auto-suggest hook, adjustments menu, driver pricing summary.
- `src/components/coordinator/TripDetailsSheet.tsx` — waiting chip + pricing panel.
- `src/routes/_authenticated/coordinator.calendar.tsx` — `WaitingNowStrip`, job-card chip, amber pin ring.
- `src/components/coordinator/DriverLiveMap.tsx` — render amber ring + label from new field.

## Explicitly out of scope

- Coordinator editing / disputing driver adjustments (visible only, approve later).
- Auto-billing rate (driver enters the agreed amount every time, per your choice).
- Passing waiting cost through to invoices/PDF exports — that follows the same shape but is a separate pass.
