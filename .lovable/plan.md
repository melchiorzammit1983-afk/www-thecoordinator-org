## Problem

`refreshJobLiveStatus` (and other AI features) fails with "Out of points" even when the company has plenty of general points. Root cause confirmed in `supabase/migrations/20260717101824_*.sql` lines 95-146: `spend_points` still routes any feature flagged `is_ai` through a separate AI wallet cascade (subscription AI allowance → `companies.ai_points_balance` → optional fallback to general → `insufficient_ai_points`). The "fallback to general" only fires when `ai_fallback_to_general = true`, so most companies with an empty AI wallet get blocked even though the main pool has credit.

## Fix

Unify AI and non-AI spend into a single path against the main pool — restoring the pre-AI-wallet behavior the user wants.

### 1. New migration: rewrite `spend_points`

Replace the function body with a single branch (the existing non-AI branch):

- Keep entitlement gate (`enabled`, `expires_at`, `monthly_cap`) unchanged.
- Delete the entire `IF _is_ai THEN … ELSE … END IF;` split.
- Always deduct `_cost` from `company_subscriptions.points_remaining_this_period` first, then fall back to `companies.points_balance`.
- When `_block` and neither source can cover it, raise `insufficient_points` (matches error strings already handled in `coordinator.functions.ts`).
- Keep ledger insert and `usage_this_period` bump.
- Leave `companies.ai_points_balance`, `ai_monthly_cap`, `ai_fallback_to_general`, and `company_subscriptions.ai_points_remaining_this_period` columns in place (no data loss; just unused by the RPC).

### 2. No frontend code changes required

`useMyBilling` / `usePointsRemaining` already sum only general balances. AI wallet UI was already removed in an earlier turn. Existing `catch` blocks in `coordinator.functions.ts` map `insufficient_points` → "Out of points — buy a top-up…", which is now the only failure mode.

### 3. Verification

- Manually invoke `refreshJobLiveStatus` on a test job after the migration; expect success when `points_balance > flight_vessel_tracking cost`.
- Confirm `points_ledger` records the deduction against the general pool.
- Confirm entitlement caps still block when configured.

Out of scope: removing the legacy AI columns/RPCs (`allocate_to_ai_wallet`, `admin_grant_ai_points`, `set_ai_monthly_cap`, `ai_points_balance`, etc.). They become dead code and can be dropped in a later cleanup — leaving them avoids touching unrelated admin/portal settings this turn.
