# Smart AI Upgrades — Final Plan

## 0. AI Points Wallet

### Spend cascade
`spend_points(company_id, feature_key)` — when `feature_key LIKE 'ai_%'`:
1. Subscription AI allowance (`company_subscriptions.ai_points_remaining_this_period`, monthly reset)
2. Admin-granted AI points (`companies.ai_points_balance`, no expiry)
3. General fallback (`companies.points_balance`) — only if `ai_fallback_to_general = true`

Enforces `companies.ai_monthly_cap` and increments `ai_points_used_this_period`. Blocks when all sources dry and `block_on_empty = true`.

### Rollout day 1 (chosen)
Migration copies each company's current `points_balance` → `ai_points_balance`, then zeroes `points_balance`. One-time `points_ledger` entry `feature_key='ai_wallet_migration'`. Coordinators see full balance on the new AI card immediately; general points start fresh (used only for non-AI features going forward).

### Coordinator controls (`/coordinator/billing`)
- AI wallet card: balance, monthly usage bar, cap slider (`ai_monthly_cap`), fallback toggle (`ai_fallback_to_general`).
- "Allocate general → AI" button (moves points, writes ledger).
- Usage table from `points_ledger` filtered to `ai_*` keys with feature breakdown.
- Top bar: `AiWalletBadge` (remaining pts, click → billing).

### Admin controls
- `/admin/companies/[id]`: **Grant AI points**, set per-company cap, view usage.
- `/admin/pricing`: new `plans.included_ai_points` column, editable AI-features table.

## 1. Per-feature AI point pricing

Reuse 13 existing `ai_*` keys already in `ai_feature_costs`. **Add** only the new ones:

| New key | Default |
|---|---|
| `ai_guide_chat` | 1 |
| `ai_guide_escalate` | 0 |
| `ai_bulk_clarify` | 1 |
| `ai_prompt_improve` | 1 |
| `ai_explain_answer` | 1 |
| `ai_dispatch_coach` | 2 |
| `ai_self_heal` | 2 |
| `ai_anomaly_scan` | 1 per firing alert |
| `ai_ops_digest` | 3 |
| `ai_prompt_suggest` | 0 (cached 5min) |
| `admin_ai_grant` | ledger tag only |
| `ai_wallet_migration` | ledger tag only |

All editable inline at `/admin/pricing → AI features`; per-company overrides via existing `company_feature_price_overrides`.

## 2. Driver Guide quota (chosen)

- New table `driver_ai_usage(driver_id, period_start, questions_used int, monthly_quota int default 30)`.
- Driver Guide chat: if within quota → free (increment counter); otherwise → charge `ai_guide_chat` to executor company wallet.
- Coordinator can raise/lower per-driver quota from `/coordinator/drivers`.
- Quota resets on `rollover_subscriptions`.

## 3. Low-balance alerts (chosen)

- **25% warning**: in-app banner + push to coordinator.
- **0% depletion**: banner + push to coordinator, push to admin, entry in admin "Companies out of AI" list at `/admin/ai-insights`.
- Cron `ai-balance-watch` every 30min compares balance vs cap.

## 4. Guide → Admin escalation

Guide asks 2-3 clarifying questions on low confidence, then offers **Escalate** (`ai_guide_escalate`, free). New `support_tickets` + `support_ticket_messages`. All tickets created at **priority='medium'**; admin re-prioritises in inbox. Push + email both ways. Routes: `/my-tickets`, `/admin/support`.

## 5. Admin AI Insights (`/admin/ai-insights`)

`help_ai_log` (retention 90 days) with route, confidence, thumbs, escalated_ticket_id. Weekly cluster cron → `ai_insight_clusters`. Buttons: **Draft Lovable prompt**, **Add to Help Center**. Also hosts "Companies out of AI" list from §3.

## 6. Prompt coaching (every AI surface)

- **"How does the AI understand this?"** popover
- **Suggested prompt chips** (context-aware, 5min cache, free)
- **✨ Improve prompt** button (1 pt)
- **Explain this answer** on every reply (1 pt)
- Send button shows `AiFeatureCostBadge` ("1 pt") before click
- 3-slide first-time onboarding per AI feature
- `/help/ai-prompting` role-specific prompt library with copy buttons

## 7. Smart bulk paste

`parse-trips.ts` returns `{trips, questions, shortcuts, columnMap, confidencePerRow}`:
- Per-row confidence chips (<0.7 requires confirm)
- Inline clarifying questions (`ai_bulk_clarify`)
- Free-text filter ("Only landings", "Skip cancelled")
- `company_ai_shortcuts` learns per-company mappings, auto-injected next run
- Column mapping for tabular pastes

## 8. Proactive / bulletproof

- **Anomaly watcher** cron 10min → `ai_alerts` + banner + push (charges only on firing alert)
- **Nightly ops digest** cron 6am (3 pts)
- **AI dispatch coach** on trip create/reassign with driver reasoning (2 pts)
- **Self-healing**: conflict/arrival/ETA banners → **Fix with AI** one-click apply via `applyAiCommandActions` (2 pts)

## Technical section

**Migration (single)**:
- Columns: `companies.ai_points_balance/ai_monthly_cap/ai_fallback_to_general/ai_points_used_this_period`; `company_subscriptions.ai_points_remaining_this_period`; `plans.included_ai_points`
- New tables: `support_tickets`, `support_ticket_messages`, `help_ai_log`, `ai_insight_clusters`, `company_ai_shortcuts`, `ai_alerts`, `driver_ai_usage` — all with GRANTs + RLS
- Rewrite `spend_points` for AI cascade + cap enforcement
- Update `rollover_subscriptions` to reset AI allowance + driver quota
- New RPCs: `allocate_to_ai_wallet`, `admin_grant_ai_points`, `driver_ai_charge_or_quota`
- Seed 9 new `ai_feature_costs` rows (`ON CONFLICT DO NOTHING`)
- One-time balance migration copy for all companies

**Server fns**:
`src/lib/ai-wallet.functions.ts`, `support.functions.ts`, `ai-insights.functions.ts`, `ai-shortcuts.functions.ts`, `ai-alerts.functions.ts`, `ai-coach.functions.ts`. Extend `runAiCommand` with `{signal_type, job_id}`. `src/routes/api/help-chat.ts` returns `{answer, confidence, followups, sources_used}` and charges `ai_guide_chat` (with driver-quota short-circuit).

**Client**:
- `src/components/ai/`: `AiWalletBadge`, `AiFeatureCostBadge`, `AiHowItWorksPopover`, `AiSuggestedPrompts`, `AiImproveButton`, `AiExplainButton`, `AiOutOfPointsCard`
- Routes: `/coordinator/billing` (extended), `/my-tickets`, `/admin/support`, `/admin/ai-insights`, `/help/ai-prompting`

**Cron** (`/api/public/cron/`, apikey-authed):
- `ai-anomaly-scan.ts` (10min)
- `ai-balance-watch.ts` (30min)
- `ai-ops-digest.ts` (daily 6am)
- `ai-cluster-insights.ts` (weekly Sunday)

## Build order

1. **Migration** — wallet columns, tables, RLS+GRANTs, rewrite `spend_points`, seed costs, one-time balance copy
2. **AI wallet UI** — coordinator billing card + admin grant/cap + top-bar badge. *(Ships first so everything after is metered.)*
3. **Admin pricing panel** for AI feature costs
4. Escalation (tickets + inbox + thread + push/email)
5. Admin AI Insights (log → clustering → drafts + "out of AI" list)
6. Prompt coaching layer + `/help/ai-prompting`
7. Smart bulk paste upgrades
8. Proactive layer (anomaly → dispatch coach → self-heal → nightly digest)
9. Driver Guide quota + coordinator quota editor

Each step ships independently. All defaults editable from `/admin/pricing` with no code change.
