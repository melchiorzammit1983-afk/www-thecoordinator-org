# Monetization & AI Feature Expansion Plan

## Goal
Turn the app into a revenue engine: every AI feature is admin-gated, coordinators see locked features (FOMO), points fund overages, and the admin has a proper "sales cockpit" to price, trial, cap, and top up companies.

---

## 1. New AI features (all gated + metered)

| Feature key | What it does | Model | Point cost (default, admin-editable) |
|---|---|---|---|
| `ai_extraction` (exists) | Understand pasted text / images / PDFs / URLs into trips | `gemini-2.5-flash-lite` (text) / `gemini-2.5-flash` (media) | 1 per text, 3 per file/URL |
| `ai_group_suggestions` | Cluster unassigned trips by time & route proximity → propose vehicle groupings | `gemini-2.5-flash-lite` | 2 per run |
| `ai_daily_plan` (new) | "Plan my day" — orders each driver's assigned trips to minimize idle/backtrack, shows before/after minutes saved | `gemini-2.5-flash` | 5 per driver |
| `ai_reply_drafter` (new) | In trip chat, suggests 2–3 reply drafts to the last client message (multilingual, tone selector: friendly/formal) | `gemini-2.5-flash-lite` | 1 per generation |
| `ai_voice_to_trip` (new) | Record / upload voice note → transcribe + extract trip | `openai/gpt-4o-mini-transcribe` + `gemini-2.5-flash` | 4 per voice note |

All 5 keys registered in `src/lib/features.ts` catalog and enforced by the existing `useFeature` hook + `company_feature_entitlements` table.

---

## 2. Monetization model — Tiers + point overages

Three plans + a top-up shop. Point pack ≈ overage currency for anything above plan quota.

| Plan | Monthly price (admin sets) | Included points/mo | Features unlocked |
|---|---|---|---|
| **Starter** | 0 | 50 | dispatch, drivers, bulk_paste, chat |
| **Pro** | admin-set | 500 | + labels, statements, portal_links, live_tracking, ai_extraction, ai_group_suggestions, client_trip_portal |
| **Business** | admin-set | 2 000 | everything incl. flight_tracking, ai_daily_plan, ai_reply_drafter, ai_voice_to_trip, client_push, client_eta, client_sos, branding_advert |

Overages: once monthly points are burned, coordinator must buy a point pack or upgrade. Everything else is soft-blocked with a clear upgrade CTA.

---

## 3. Database changes

New enum values in `feature_name`: `ai_daily_plan`, `ai_reply_drafter`, `ai_voice_to_trip`.

New tables (public schema, with GRANTs + RLS as per project rules):

- `plans` — id, code (`starter`/`pro`/`business`), name, price_monthly, included_points, feature_keys[]. Admin-only write, authenticated read.
- `company_subscriptions` — company_id (unique), plan_id, current_period_start, current_period_end, points_remaining_this_period, status. Admin write, owner read.
- `point_packs` — id, name, points, price. Admin write, authenticated read.

Extensions to existing:
- `company_feature_entitlements`: already has `expires_at` → use for trial timers. Add `monthly_cap` int nullable + `usage_this_period` int default 0 for per-feature caps.
- `feature_costs`: extend seed for all AI keys above.
- `topup_requests`: add `pack_id` (optional) so coordinator can request a specific pack.

Cron/rollover: nightly server fn scans `company_subscriptions` where `current_period_end < now()`; resets `points_remaining_this_period` = plan.included_points, rolls period, zeroes per-feature `usage_this_period`.

---

## 4. Server functions (`src/lib/admin.functions.ts` + `coordinator.functions.ts`)

New/updated (all `requireSupabaseAuth` + role check):

- `adminListPlans / adminUpsertPlan / adminDeletePlan`
- `adminListPointPacks / adminUpsertPointPack`
- `adminSetCompanyPlan(companyId, planId)` — creates subscription, credits included points
- `adminSetFeatureTrial(companyId, feature, days)` — sets `enabled=true, expires_at=now()+days`
- `adminSetFeatureCap(companyId, feature, monthlyCap)`
- `adminSetFeatureCost(feature, points)` — edits `feature_costs`
- `adminApproveTopup(id, points, packId?)` / `adminDeclineTopup(id)`
- `adminRevenueDashboard()` — returns per-company MRR (plan price), points sold last 30d, AI usage counts, top spenders
- `coordinatorRequestTopup(packId | customPoints, note)` — inserts into `topup_requests`
- `spendPoints(companyId, feature, jobId?, note?)` — atomic RPC: check cap, deduct from `points_remaining_this_period`, ledger insert, throw `feature_capped` / `insufficient_points` / `feature_disabled`
- `extractTripsFromText` etc. → call `spendPoints` before model call
- New AI functions: `suggestTripGroupings`, `planDriverDay(driverId, date)`, `draftChatReplies(tripId, tone)`, `voiceToTrip(audioBase64, mimeType)`

---

## 5. Frontend

### Coordinator side
- `useFeature(key)` → returns `{ enabled, remaining, cost, cappedAt, expiresAt, reason }`.
- New `<FeatureGate>` wrapper: renders children if enabled+funded, else shows locked overlay with:
  - lock icon, feature name, cost (`"3 points per use"`)
  - "Request top-up" button → dialog: choose pack or custom amount + note → creates `topup_request`
  - "Upgrade plan" button → opens plan comparison modal
- Wire the 4 new AI features into their UIs (Dispatch board "Suggest groups", per-driver "Plan day", chat "Draft reply", bulk-paste "🎙 Voice").
- Points balance chip in top bar; click → history from `points_ledger`.

### Admin side (`src/routes/admin/*`)
Company detail page gets a new **"Billing & Access"** tab:
1. Plan selector (Starter/Pro/Business) with prorate note
2. Points: current balance + "Grant N points" quick action
3. Feature grid: toggle enabled, set monthly cap, "Start 14-day trial" button (sets `expires_at`)
4. Recent usage: last 20 `points_ledger` rows filtered by feature
5. Pending top-up requests → approve/decline inline

New admin pages:
- `/admin/pricing` — edit plans, point packs, per-feature `feature_costs`
- `/admin/revenue` — dashboard: MRR, top spenders, feature adoption %, conversion funnel (trials started → converted)
- `/admin/topups` — global queue of pending `topup_requests`

---

## 6. Sales-driven UX details (max profit)
- Locked-feature overlays never hide the button → visible FOMO on every screen.
- After a trial expires, feature stays visible with "Trial ended — upgrade" CTA.
- Point-low banner at 20% remaining, hard banner at 0.
- Admin "Start trial" one-click → auto-emails coordinator "You've been gifted 14 days of AI Extraction".
- Revenue dashboard highlights companies at trial day 12 → sales prompt to close.

---

## 7. Out of scope (this plan)
- Real payment processor (Stripe/Paddle) — top-ups stay admin-approved manual for now; hooks are ready.
- Auto plan downgrade on non-payment.
- Per-user (inside a company) sub-limits.

---

## 8. Technical notes
- All new tables: `CREATE TABLE` → `GRANT` → `ENABLE RLS` → `CREATE POLICY` in same migration.
- `spendPoints` implemented as SECURITY DEFINER SQL fn to keep deduction atomic.
- `voiceToTrip` uses OpenAI transcribe then feeds transcript to existing extractor — reuses `extractTripsFromText`.
- Nightly rollover as a `createServerFn` invoked by pg_cron hitting `/api/public/cron/rollover-subscriptions` with a shared secret.
- All new AI calls follow existing pattern in `coordinator.functions.ts` (Lovable AI Gateway, gemini-2.5-flash-lite default, upgrade to flash for media).
