
## Goal
Turn today's "AI suggest groups" button into a broader **AI Auto-Coordinate** feature that plans the whole backlog (not just one day), proposes every action for one-click approval, is guarded by a **master switch** the coordinator controls, and consumes **points** on a schedule the admin picks.

Per your answers:
- **Autonomy:** propose-only — AI never mutates trips until the coordinator approves.
- **Runs:** manual "Run AI Auto-Coordinate now" button + one daily scheduled pass.
- **Points:** admin chooses metering mode (default: per action taken).
- **Switch:** single master toggle in AI Center.

---

## User-facing changes

### 1. Calendar toolbar
Replace `AiGroupSuggestionsButton` with `AiAutoCoordinateButton`:
- Label: "AI Auto-Coordinate" (Sparkles icon)
- Opens a dialog that runs a planning pass over **all unassigned jobs** (not filtered by the selected date).
- Dialog shows a **proposal list** grouped by action type:
  - Group trips (N groups)
  - Assign driver (N trips)
  - Reassign / rebalance (N trips)
- Each row: Accept / Skip. Footer: **Accept all** / **Skip all** / **Close**.
- Empty state: "Nothing to coordinate — you're all caught up."
- Disabled with tooltip when master switch is OFF or feature entitlement is off.

### 2. AI Center → Toggles
Add one new row above the existing toggles:
- **AI Auto-Coordinate** — "AI reviews unassigned trips and proposes groupings + driver assignments. Nothing runs without your approval."
- Stored as `auto_coordinate_enabled` on `ai_configuration`.

### 3. Admin → AI feature costs
The existing admin pricing table (`ai_feature_costs`) already supports per-feature `points_cost`. We add one new row `ai_auto_coordinate` and one **metering mode** column so admin picks how to charge:
- `per_action` (default) — deduct on each accepted proposal
- `per_run` — deduct once per planning pass
- `per_trip` — deduct per unique trip touched in the run

---

## Backend changes

### Server functions (`src/lib/coordinator.functions.ts`)
1. **`aiAutoCoordinate`** (`POST`, auth) — replaces `aiSuggestTripGroupings`:
   - Reads ALL company `jobs` with `driver_id IS NULL` and `pickup_at >= now() - 24h` (covers backlog + upcoming).
   - Checks `ai_configuration.auto_coordinate_enabled === true`; else throws.
   - Loads free-driver roster.
   - Calls Gemini with a single planner prompt → returns `{ proposals: [{ kind: "group"|"assign", trip_ids, driver_id?, reason }] }`.
   - Meters points based on admin mode:
     - `per_run` → `spendOrThrow` once here
     - `per_trip` → deduct `distinct_trip_count × cost`
     - `per_action` → **do not spend here**; deduct on accept
   - Returns proposals + `metering_mode` so the UI knows whether accept costs points.
2. **`applyAutoCoordinateProposal`** (`POST`, auth) — accepts one proposal:
   - `kind:"group"` → calls existing `groupJobs` logic
   - `kind:"assign"` → sets `driver_id` on the trip(s)
   - If `metering_mode === "per_action"`, `spendOrThrow` once here.
3. Keep `aiSuggestTripGroupings` exported as a thin wrapper for backward compatibility, or delete after removing calendar imports (delete is cleaner).

### Feature catalog (`src/lib/features.ts`)
- Rename `ai_group_suggestions` → `ai_auto_coordinate` (update label/description). Keep the old key as an alias in `FEATURE_CATALOG` for one release so existing entitlements/costs rows keep working, or write a data migration that renames the rows in `ai_feature_costs` and `company_feature_entitlements`. Plan uses the migration path — cleaner.

### Database (migration)
```text
ALTER TABLE ai_configuration
  ADD COLUMN auto_coordinate_enabled boolean NOT NULL DEFAULT false;

ALTER TABLE ai_feature_costs
  ADD COLUMN metering_mode text NOT NULL DEFAULT 'per_action'
    CHECK (metering_mode IN ('per_action','per_run','per_trip'));

-- Rename existing feature key
UPDATE ai_feature_costs           SET feature_key='ai_auto_coordinate' WHERE feature_key='ai_group_suggestions';
UPDATE company_feature_entitlements SET feature='ai_auto_coordinate'   WHERE feature='ai_group_suggestions';
UPDATE company_feature_price_overrides SET feature_key='ai_auto_coordinate' WHERE feature_key='ai_group_suggestions';

-- Seed default cost if missing
INSERT INTO ai_feature_costs (feature_key, points_cost, enabled, block_on_empty, metering_mode)
VALUES ('ai_auto_coordinate', 2, true, true, 'per_action')
ON CONFLICT (feature_key) DO NOTHING;
```
GRANT statements already exist on these tables — no new tables created.

### Daily scheduled pass
New `src/routes/api/public/cron/ai-auto-coordinate.ts` route:
- For each company with `auto_coordinate_enabled=true`, runs `aiAutoCoordinate` and stores the proposals on a lightweight cache (reuse `ai_command_log` with `mode='auto_coordinate'`) so the coordinator sees them next time they open the dialog.
- Scheduled via `pg_cron` daily at 06:30 UTC using the existing rollover-cron pattern already in the project.

---

## Files touched
- `src/components/coordinator/AiGroupSuggestionsButton.tsx` → rename/rewrite to `AiAutoCoordinateButton.tsx` (propose-list UI, per-row accept).
- `src/routes/_authenticated/coordinator.calendar.tsx` → swap import + feature-flag key + drop `date` prop.
- `src/routes/_authenticated/coordinator.ai-center.tsx` → add master toggle row.
- `src/lib/coordinator.functions.ts` → add `aiAutoCoordinate`, `applyAutoCoordinateProposal`; remove/alias `aiSuggestTripGroupings`; extend `AiConfig` shape + `saveAiConfig` validator with `auto_coordinate_enabled`.
- `src/lib/features.ts` → rename catalog entry.
- `src/components/admin/FeatureEntitlementsDialog.tsx` (if it edits costs) → surface `metering_mode` dropdown; otherwise add to admin pricing page.
- Migration: schema + data rename as above.
- New cron route + pg_cron schedule.

## What stays the same
- Existing entitlements, points ledger, and `spend_points` RPC — reused as-is.
- `groupJobs`, `auto_assign_job` RPC — reused inside `applyAutoCoordinateProposal`.
- No touch to the AI Command Bar, Rules, or other AI Center sections.

## Out of scope (ask again if needed)
- Full autopilot / auto-execute (you chose propose-only).
- Reassignment of already-assigned trips (current unassigned-only scope keeps risk low).
- Per-scope sub-toggles (you chose a single master switch).
