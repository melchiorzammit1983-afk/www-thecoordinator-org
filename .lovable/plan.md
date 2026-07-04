
# Monetization: Admin-Configurable Feature Pricing

Turn every valuable action in the app into a metered, revenue-producing event that admin can price globally or per-company, with decimal support and a hybrid block strategy so trip creation is never fully blocked.

## What admin gets

A new **Admin → Feature Pricing** tab listing every billable feature with:
- Label, key, category (Core / AI / Comms / Data)
- Cost in points (decimal, e.g. `1.50`)
- Enabled toggle
- "Block when out of points?" toggle (per feature — lets trip creation stay free-on-empty while AI features hard-block)

Inside **Company Billing dialog**, a new "Price overrides" section lets admin set a custom cost for that company on any feature (blank = use global).

## New billable actions (in addition to existing AI features)

| Key | Label | Default cost | Blocks on empty? |
|---|---|---|---|
| `trip_created` | Trip created | 1.50 | No (hybrid) |
| `trip_dispatched` | Trip dispatched to partner | 0.50 | No |
| `client_link_sent` | Client tracking link / SMS | 0.25 | Yes |
| `route_traffic_refresh` | Route + traffic recompute | 0.10 | Yes |
| `flight_status_refresh` | Flight status poll | 0.10 | Yes |

Defaults are seeded; admin can change any of them.

## Behaviour when balance hits zero

- Features marked **block_on_empty = true** → RPC raises `insufficient_points`, UI opens the top-up dialog.
- Features marked **block_on_empty = false** (trip creation, dispatch) → action proceeds, balance goes negative, ledger records the debt, admin sees a red "Owed: X pts" chip on the company row.

## Technical details

### Migration
- `ai_feature_costs` + `feature_costs` + `points_ledger.points_deducted` + `companies.points_balance` + `company_subscriptions.points_remaining_this_period` + `plans.included_points`: alter to `numeric(10,2)`.
- Add columns to `ai_feature_costs`: `category text`, `block_on_empty boolean default true`, `enabled boolean default true`.
- New table `company_feature_price_overrides (company_id, feature_key, points_cost numeric(10,2), unique(company_id, feature_key))` with admin-only RLS + GRANTs.
- Rewrite `spend_points` RPC:
  1. Resolve cost: override → global → 1.0 fallback.
  2. If `enabled = false` → raise `feature_disabled`.
  3. Deduct from `company_subscriptions.points_remaining_this_period`, then `companies.points_balance`.
  4. If both would go below zero AND `block_on_empty = true` → raise `insufficient_points`.
  5. If `block_on_empty = false` → allow negative on `companies.points_balance`, insert ledger row.
- Seed the 5 new feature rows.

### Server functions (`src/lib/admin.functions.ts`)
- `adminListFeaturePricing()` — returns global rows.
- `adminUpdateFeaturePricing({ feature_key, points_cost, enabled, block_on_empty, label, category })`.
- `adminSetCompanyPriceOverride({ company_id, feature_key, points_cost | null })`.
- `adminListCompanyPriceOverrides({ company_id })`.

### Metering wiring
Add `spend_points` calls in coordinator server functions:
- `trip_created` — inside job/booking insert paths (`createJob`, public booking accept).
- `trip_dispatched` — inside dispatch-hop insert.
- `client_link_sent` — inside client-link creation / SMS send.
- `route_traffic_refresh` — inside the route cache refresh path.
- `flight_status_refresh` — inside `flight_status_snapshots` insert.

Each call passes `job_id` where available so the ledger stays traceable.

### UI
- New route: `src/routes/_authenticated/admin.feature-pricing.tsx` — editable table (label, cost input step=0.01, category select, two toggles, save-per-row).
- `CompanyBillingDialog.tsx` — add "Price overrides" section: list of features with cost input + "Reset to global" button.
- Coordinator `PointsBadge` + `RequestTopupDialog` — show negative balance in red with "Amount owed" label when < 0.

### TypeScript
Regenerate `src/integrations/supabase/types.ts` after migration (auto). Update `Points` display helpers to format `numeric` as `1.50` (2 decimals, trim trailing zeros for whole numbers).

## Out of scope
- Auto-invoicing / Stripe billing on debt — surfaced to admin only, collected manually for now.
- Plan-level bundled discounts on new billable actions — plans keep working, decimals just reduce faster.
