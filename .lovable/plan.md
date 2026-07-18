## AI Watchtower — proactive alerts (opt-in, points-metered)

Every scan costs points, so the coordinator explicitly turns it on and picks how often it runs. Nothing scans in the background unless they enable it.

### 1. New paid feature
Add feature key `ai_watchtower_scan` to the billing catalog (default cost: 1 point per scan, admin-editable in `/admin/pricing` like other AI features). Each scan = one metered charge via existing `spend_points` RPC. If the company runs out of points → the toggle auto-pauses and shows a "Top up to resume" notice (reuses `RequestTopupDialog`).

### 2. New UI: Watchtower toggle
Replace/augment the current `AutoRefreshToggle` on the coordinator dashboard with a two-part control:
- **Auto-refresh** (free, existing) — data cleanup + flight status only.
- **AI Watchtower** (new, paid) — off by default. When on:
  - Shows live "N points/scan · next scan in Xs · Y points left today" chip.
  - Interval selector: 2 / 5 / 15 min (longer = cheaper).
  - Severity slider: Critical only ↔ Chatty (stored per user).
  - What to watch (checkboxes, saved to `localStorage` + server preference):
    - Flight/vessel disruptions
    - Trip execution issues (late driver, stalled trip, over-wait)
    - Driver schedule conflicts & workload imbalance
    - New-trip data problems
  - Master OFF kill-switch always visible.

### 3. Alert delivery
- **In-app popup card** inside the existing `CoordinatorAssistant` panel (new `AssistantAlert` response kind) with action buttons (Reassign, Notify client, Open trip, Dismiss). Reuses assistant infra, no new global component.
- **Bell badge** in header showing unread count; opens an Alert Center drawer with history (last 50).
- **Voice**: only critical alerts spoken, and only when assistant voice output is already unmuted.
- **Push to phone**: piggyback existing FCM `sendPushToUser` for critical alerts when tab is hidden. No new server cron — scans run client-side only, so no offline pushes when the browser is closed (keeps cost predictable).

### 4. Scan logic (server function `runWatchtowerScan`)
One server call per tick, metered once regardless of how many issues found. It:
1. Loads today's active jobs for the company (reuses existing loaders).
2. Runs cheap deterministic checks first (no AI cost): flight delta vs last snapshot, driver ETA vs pickup_at, wait sessions > threshold, `use-driver-conflicts` collisions, km/trip imbalance across drivers.
3. Only if deterministic checks find something notable, calls Gemini once to phrase the alert + suggest actions (single small prompt, batched).
4. Returns `{ alerts: [...], scanned_at }`. Client dedupes vs last scan (hash on `job_id+kind`) so unchanged issues don't re-fire.

### 5. Data model
- `watchtower_alerts` table: id, company_id, job_id, kind, severity, title, body, suggested_actions jsonb, status (new/acknowledged/dismissed/resolved), created_at, resolved_at. RLS: company scope.
- `watchtower_settings` (per user): enabled, interval_sec, severity_min, kinds[], last_scan_at.

### 6. Points & safety guardrails
- Show running cost estimate before enabling ("~48 points/hour at 5 min interval").
- Hard daily cap (default 200 scans/day, admin-configurable) — prevents runaway charges.
- Toggle disables itself on `spend_points` failure with a clear toast.
- Admin can globally disable via `company_feature_entitlements`.

### Technical section

Files to add:
- `src/lib/watchtower.functions.ts` — `runWatchtowerScan` (metered), `getWatchtowerSettings`, `saveWatchtowerSettings`, `listRecentAlerts`, `acknowledgeAlert`.
- `src/components/coordinator/WatchtowerToggle.tsx` — controls + interval/severity/kinds UI.
- `src/components/coordinator/AlertCenter.tsx` — bell + drawer.
- Migration: `watchtower_alerts`, `watchtower_settings`, feature entitlement row for `ai_watchtower_scan`.

Files to edit:
- `src/routes/_authenticated/coordinator.index.tsx` — mount `<WatchtowerToggle />` next to existing `AutoRefreshToggle`; mount `<AlertCenter />` in header.
- `src/components/coordinator/CoordinatorAssistant.tsx` — render `AssistantAlert` cards when the watchtower pushes into the assistant stream.
- `src/lib/features.ts` — register `ai_watchtower_scan`.
- `src/routes/_authenticated/admin.pricing.tsx` — surface new feature cost row (auto via existing loop).

Explicitly NOT touched: existing `AutoRefreshToggle` cleanup logic, driver app, workflow business rules.
