## Availability Hours + Auto-Forward

Let coordinators and drivers publish opening hours. Off-hours (or unanswered) trips auto-jump to the next available party in the network, with configurable behavior and admin-controlled pricing.

### 1. Data model (new migration)

- `availability_schedules` — one row per owner (`owner_type` = `company` | `driver`, `owner_id`, `company_id`, `timezone`)
- `availability_windows` — weekly recurring windows (`schedule_id`, `weekday 0-6`, `start_time`, `end_time`)
- `availability_exceptions` — one-off closed/open days (holidays, extra shifts)
- `availability_policies` — per-coordinator settings:
  - `off_hours_mode`: `auto_forward` | `notify_then_forward` | `manual_pick`
  - `notify_timeout_min` (default 15, used by mode 2)
  - `unanswered_timeout_min` (default 15) — even during open hours, jump if no accept
  - `forwarding_enabled` boolean
  - `preferred_partner_ids uuid[]` (ordered list; empty = any connected partner)
- `dispatch_forward_events` — audit trail: `job_id`, `from_company_id`, `to_company_id`, `reason` (`off_hours` | `no_response` | `manual`), `points_charged`, `created_at`

All tables: GRANT to authenticated + service_role, RLS scoped to `company_id` via `has_role`/`company_of`.

### 2. Server functions (`src/lib/availability.functions.ts`)

- `getMySchedule({ owner_type })` / `saveMySchedule(...)` — for the settings UI
- `saveAvailabilityPolicy(...)` — coordinator picks mode + timeout + preferred partners
- `isOpenNow(owner_type, owner_id, at?)` — checks weekly windows + exceptions in owner's TZ
- `findNextAvailable({ job_id })` — returns ordered candidates: preferred partners first, then any connected partner currently `isOpenNow`, excluding already-tried companies
- `autoForwardJob({ job_id, reason })` — validates policy, spends points via `spend_points('trip_auto_forward', ...)`, updates `jobs.executor_company_id` + `job_dispatch_hops`, inserts `dispatch_forward_events`, notifies both parties
- Cron endpoint `src/routes/api/public/cron/auto-forward.ts` (already-authed via CRON_SECRET) — every 60s scans pending incoming dispatches whose `created_at + timeout` has passed unanswered and off-hours arrivals, calls `autoForwardJob`

### 3. Wire into existing dispatch flow

- On incoming dispatch (`respondToDispatch` / new dispatch creation):
  - If receiver is `off_hours_mode = auto_forward` and closed → forward immediately
  - If `notify_then_forward` and closed → send push, mark `forward_after = now + notify_timeout`, cron picks up
  - If `manual_pick` → show new "Forward to…" button in `coordinator.incoming.tsx` (partner picker)
- Same fallback runs when a trip is assigned to a driver who doesn't accept within `unanswered_timeout_min` — driver push includes an "Accept" action; timeout → forward to next available driver in same company, then to network.

### 4. UI

- **New route** `src/routes/_authenticated/coordinator.availability.tsx` — weekly grid editor (Mon–Sun rows, drag to set windows), exceptions list, policy card (radio: off-hours mode, sliders for timeouts, sortable preferred-partners list). Gated by `IfFeature feature="availability_autoforward"`.
- **Driver settings** — reuse the same editor inside `coordinator.drivers.tsx` (per-driver row action) and inside the driver mobile app (`m.driver.$token.tsx` → new "My hours" sheet).
- **Incoming card** (`coordinator.incoming.tsx`) — show "Forwarded from X (off-hours)" badge; add "Forward to…" button when mode is `manual_pick`.
- **Trip details** — new "Forwarding history" section rendering `dispatch_forward_events`.

### 5. Admin pricing (per your choice: base + per-forward)

- Register feature in `src/lib/features.ts`: `availability_autoforward`
- `ai_feature_costs` row: `feature_key='trip_auto_forward'`, default 2 points, editable in `admin.pricing.tsx`
- `company_feature_entitlements` gates the whole feature (monthly base fee handled by existing entitlements flow — admin sets base points/month in `admin.pricing.tsx` alongside the per-forward cost)
- `spend_points` is already wired to honor overrides and caps — no changes needed
- Admin panel gets a new row in `admin.pricing.tsx` for `trip_auto_forward` and a base-subscription editor in `FeatureEntitlementsDialog.tsx`

### 6. Help & signals

- New help article `coordinator-availability.tsx` in `src/content/help/` explaining hours, modes, pricing, and the forwarding audit trail
- Signal registry entry so "Ask the Guide" can explain the "Forwarded" badge

### Recommendations / things worth changing

1. **Timezone per schedule, not per company** — drivers travel; store TZ on `availability_schedules` so a driver's hours mean their local time.
2. **Forward cap per trip** — hard limit (e.g. 5 hops) to prevent infinite chains if everyone's closed; after the cap the trip returns to origin with a "no coverage" alert.
3. **Point refund on rejection** — if an auto-forward is rejected within 2 min, refund the forward points (protects coordinators from paying for dead-end forwards).
4. **Suggested default mode** = `notify_then_forward` with 15 min — safest for new users; they get a chance to grab the trip before losing it.
5. **Emergency override** — coordinators can always manually take a trip back from an auto-forward before the new owner accepts.

Reply with anything you want changed (data model, default mode, forward cap, pricing model) and I'll revise before implementation.
