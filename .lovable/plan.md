
# Pricing & Packages Rewrite

Goal: one predictable revenue model, one place to configure it, and no dead switches.

## The model (what customers see)

- **One wallet.** Every action that costs money — AI, SMS, flight lookups, route calls, portal bookings — spends from the same monthly point balance. No separate "AI points" bucket.
- **14-day free trial** with full access to everything. No card required. After trial: pick a plan or read-only.
- **Three tiers:**

  |            | Starter          | Pro              | Business         |
  |------------|------------------|------------------|------------------|
  | Included points / month | small | medium | large |
  | Drivers    | up to N          | up to N          | unlimited        |
  | AI assistant | ✓              | ✓ + Watchtower   | ✓ + Watchtower + priority |
  | Hotel & Client portals | — | ✓ | ✓ |
  | Collaborate network | — | ✓ | ✓ |
  | Support    | email            | email + chat     | dedicated        |

  Exact numbers (points, driver caps, prices) get set from the admin UI, not hard-coded.

- **Soft block with grace.** When the monthly bag is empty, the next ~10 metered actions still run and go on the next invoice as overage, then it hard-blocks until top-up. Trip creation, driver status, and other non-metered essentials are never blocked.
- **Top-up packs** stay for one-off boosts; they add to the same wallet.

## The system underneath (what changes)

### Database
- Drop the `ai_points_remaining_this_period` column on `company_subscriptions` and `included_ai_points` on `plans` (unused after merge; `spend_points` already ignores them).
- Fold `ai_feature_costs` into a single `feature_catalog` table:
  `feature_key, label, category (ai|dispatch|comms|portal|maps|admin), points_cost, enabled, block_on_empty, metering_mode, min_plan_code, is_addon, sort_order`.
  Migrate rows from both `feature_costs` and `ai_feature_costs`; keep old table names as views for one release so existing code keeps building.
- Add `plans.driver_cap INT NULL`, `plans.trial_days INT NOT NULL DEFAULT 14`, `plans.description TEXT`, `plans.is_public BOOLEAN` (so we can hide legacy plans without deleting).
- Add `companies.trial_ends_at TIMESTAMPTZ`, `companies.grace_actions_remaining INT NOT NULL DEFAULT 10`, `companies.grace_reset_at TIMESTAMPTZ`.
- Rewrite `spend_points()` to: (1) check the plan gate (`feature_catalog.min_plan_code` vs the company's plan), (2) spend from `subscriptions.points_remaining_this_period`, then from `companies.points_balance`, then from grace, (3) raise `feature_not_in_plan` / `insufficient_points` cleanly. All in one place, no scattered checks.

### Admin console (one page, four tabs)
Route: `/admin/pricing` (rewrite the current mixed page).
1. **Plans** — list, edit, publish/unpublish. Fields: name, monthly price, included points, driver cap, trial days, description, feature keys.
2. **Features & costs** — one table of every metered action with its label, category, points, enabled toggle, min plan, and "block on empty" flag. Search + category filter.
3. **Point packs** — top-up SKUs (name, points, price, active).
4. **Company overrides** — search a company → edit `company_feature_price_overrides`, add/remove `company_feature_entitlements`, grant free points, extend trial, change plan.

Also on `/admin/revenue`: MRR by plan, active vs trialing vs past-due counts, top spenders, expiring trials this week.

### Coordinator side
- `/coordinator/billing` becomes the customer view: current plan, days left in trial, wallet balance, this-month usage by feature category, top-up buttons, plan switcher, invoices list.
- One small "wallet" chip in the header everywhere (points left · days in trial). Clicking opens the billing page. Removes the confusing double indicators today.
- Feature-gated UI (Portals, Watchtower, Collaborate) reads a single `useEntitlements()` hook. Locked features show a "Included in Pro" upsell instead of a broken button.

### Cleanup
- Delete unreachable toggles on `/admin/ai-settings` that duplicate the new features table.
- Deprecate `admin.pricing.tsx` old sections after the new page ships; keep a redirect for a release.
- Remove ai-wallet references from `AssistantBatch`, `use-billing.ts`, and the dashboard chip.

## Order of work
1. Migration: add columns, create `feature_catalog`, backfill from both cost tables, rewrite `spend_points`.
2. Admin console rewrite (Plans / Features / Packs / Overrides + Revenue widgets).
3. Coordinator `/billing` refresh + header wallet chip + `useEntitlements()` hook wired into feature-gated UI.
4. Trial + grace logic: nightly cron sets `status='past_due'` when trial expires; `spend_points` consumes and resets grace monthly.
5. Sweep the codebase: delete AI-wallet columns, retire duplicate switches, update seeds so the demo tier configuration is one canonical block.

## Technical notes
- All server fns live in `src/lib/pricing-admin.functions.ts` (admin) and existing `src/lib/pricing.functions.ts` gets `getEntitlements`, `getWalletStatus`, `listInvoices` for the coordinator side.
- No client-side price checks; every gate is enforced in `spend_points` and in the admin-managed feature catalog. The UI only reads.
- Payments stay on the current Stripe hookup; only the SKU list (plans + packs) is what changes.
- Backwards compatibility: existing `points_ledger` rows keep working; `feature_costs` and `ai_feature_costs` are turned into SQL views over `feature_catalog` so nothing that reads them breaks during the release.
