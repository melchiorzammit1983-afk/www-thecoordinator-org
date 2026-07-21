
# Admin cleanup & billing sync

Goal: turn every "badge that acts like a switch" into a real Switch, make sure toggling actually gates the user, and merge the two overlapping cost pages so admins see one clear number per action — points charged vs. real Lovable-gateway cost — including flight tracking.

## Step 1 — Replace badge-buttons with real Switches
Files: `admin.ai-settings.tsx`, `admin.pricing.tsx`, `admin.topups.tsx` (if present).
- Swap every `<button><Badge>Enabled/Disabled</Badge></button>` pattern for shadcn `<Switch>` with a text label next to it.
- Rows affected: `ActionRow` (Enabled, Hard stop), `FeatureCostCard` (Enabled, Hard stop, Add-on), `PackRow` (Active, Reference), `PlanEditor` (Listed publicly).
- Semantics per user:
  - **Enabled**: on = charged & available, off = free & hidden from user surfaces.
  - **Hard stop → "Allow negative"**: rename to a single switch **"Allow when wallet is empty"** (on = allow negative / free-flow, off = block).
  - **Add-on**: on = user can toggle it in their dashboard, off = admin-controlled only.
  - **Reference rate**: on = this pack drives EUR display (only one at a time; server already enforces).

## Step 2 — Make Enabled/Add-on actually gate the UI
- Server: extend `getMyFeatures` / `useMyBilling.costs` payload to include `enabled` and `is_addon` (already present in `costs`, verify propagation).
- Client: in `useFeature(key)` and every `<IfFeature>` / `FeatureGate` call site, hide/disable the surface when `costs[key].enabled === false` regardless of admin entitlement.
- User settings (`/settings` feature-usage list): show only rows where `is_addon === true AND enabled === true`.
- Walk each active AI key from `ACTIVE_FEATURE_KEYS` and confirm its consumer respects the flag. Add a small server test route `/api/public/health/features` returning the resolved map for one company, so I can flip a switch and curl-verify it's off.

## Step 3 — Unified "Real cost vs charged" view (Lovable-synced)
Rewrite `admin.ai-costs.tsx` into one table, one row per feature_key:
```
Feature | Uses (30d) | Points charged | EUR charged | Lovable credits used | USD cost | Margin €
```
- Source: aggregate `ai_cost_events` (already has `real_cost_credits`, `real_cost_usd_cents`, `points_charged`).
- Add a top card **"Workspace credit spend, last 30d"** pulling from the same table's `real_cost_credits` sum, so the number matches what Lovable shows in Settings → Plans & credits.
- Remove the current dual-column dance; keep drilldown by clicking a row.

## Step 4 — Meter flight tracking properly
- `flight_status_extra_lookup` and `flight_vessel_tracking` already exist in `ai_feature_costs`. Confirm every AeroDataBox call site in `src/lib/*flight*` and `fetchLiveStatusViaGemini` wraps with `spend_points(feature_key)` + `recordAiCost(...)` with the model/usage or a fixed-cost fallback (AeroDataBox has no tokens → charge fixed points, record `real_cost_usd_cents` from an admin-set `est_cost_usd_cents`).
- Add a "Fixed cost per call (¢)" input to `ActionRow` (already exists as `est_cost_usd_cents`). Make sure it's used when `usage` is null.

## Step 5 — Every AI agent action → charge as `ai_agent_message`
- In the coordinator assistant (`coordinator-assist.functions.ts` and command executor), route every user-triggered chat turn through `spend_points('ai_agent_message', ...)` in addition to any per-tool cost. Admin sets the price on the AI Settings page (already listed in `ACTIVE_FEATURE_KEYS`).

## Step 6 — Merge & simplify
- Delete the duplicate "Feature point costs" card on the Pricing page (Step 3 owns it) — Pricing keeps Plans + Point Packs + Wallets only.
- AI Settings owns: per-action cost + enabled + allow-negative + fixed ¢ + free allowance.
- Verify each switch end-to-end after each step: flip in admin → reload user preview → confirm surface disappears / stops charging.

## Technical notes
- No schema changes needed; `ai_feature_costs` already has `enabled`, `block_on_empty`, `is_addon`, `est_cost_usd_cents`.
- Keep `PLAN_ORDER` / entitlement logic intact.
- Use existing `<Switch>` from `@/components/ui/switch`.
- No workflow changes to trip lifecycle, driver flow, or portal.

I'll execute Step 1 → 6 in order and self-test after each without waiting for approval, as you asked.
