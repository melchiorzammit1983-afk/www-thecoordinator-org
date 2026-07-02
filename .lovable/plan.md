
## Goal
Let admins toggle features per coordinator, optionally with an expiry (1 day, 7 days, or custom). Expired or disabled features disappear from that coordinator's dashboard and driver-facing surfaces.

## Feature catalog (initial set — matches sidebar + key flows)
- `dispatch` — Dispatch calendar
- `pending` — Pending approvals
- `drivers` — Drivers management
- `portal_links` — Magic link generator
- `labels` — Trip labels
- `statements` — Statement/report builder
- `collaborate` — Partner connections & multi-hop dispatch
- `my_driving` — Self-driving portal
- `live_tracking` — Live GPS map on cards
- `flight_tracking` — AviationStack integration
- `bulk_paste` — WhatsApp bulk trip paste
- `chat` — Trip chat with drivers

Every feature defaults to **enabled** so existing coordinators are unaffected.

## Database (migration)
New table `public.company_feature_entitlements`:
- `company_id uuid` → companies, `feature text` (from catalog), `enabled boolean default true`, `expires_at timestamptz null`, `created_by uuid`, `created_at`, `updated_at`.
- Unique `(company_id, feature)`.
- RLS: admins full access via `is_admin(auth.uid())`; company owner can `SELECT` own rows (read-only, to hydrate the UI). Standard GRANTs (`authenticated`, `service_role`).
- Helper SQL function `public.has_feature(_company uuid, _feature text)` → true if no row exists (default on) OR row is `enabled AND (expires_at IS NULL OR expires_at > now())`. `SECURITY DEFINER`, granted to `authenticated`.

## Backend (`src/lib/admin.functions.ts`)
- `listFeatureEntitlements({ companyId })` — admin only, returns catalog merged with rows.
- `setFeatureEntitlement({ companyId, feature, enabled, durationDays? })` — admin only, upserts; `durationDays` computes `expires_at = now() + interval`; `null` = permanent.
- `clearFeatureEntitlement({ companyId, feature })` — deletes row (reverts to default enabled).

## Backend (`src/lib/coordinator.functions.ts`)
- Extend `whoAmI` (or add `getMyFeatures`) to return a `features: Record<string, boolean>` map for the current company, computed from entitlements + expiry.
- Guard server functions of gated features (e.g. `createBulkJobs`, statement export, collaborate actions) with a `assertFeature(company, key)` helper that throws `feature_disabled`.

## Frontend
- **Coordinator layout** (`src/routes/_authenticated/coordinator.tsx`): fetch features via TanStack Query; filter `NAV` array to hide disabled items. Also gate route components (e.g. redirect to `/coordinator` with toast if a user hits a disabled URL directly).
- **Feature hook** `src/hooks/use-features.ts` exposes `useFeature(key)` for inline gating (bulk paste tab, chat button, live map, flight badges).
- **Driver portal**: chat and live-share are gated by the owning company's features (passed through `getDriverManifest` response).
- **Admin UI** (`src/routes/_authenticated/admin.index.tsx`): add a "Features" button per company row → opens `FeatureEntitlementsDialog`:
  - Table listing each feature with an Enabled switch, a duration select (Permanent / 1 day / 7 days / 30 days / Custom days), and an "Expires in Xh" badge when active.
  - Save calls `setFeatureEntitlement`; "Reset" calls `clearFeatureEntitlement`.
  - Live countdown recomputed on open.

## Expiry behavior
No cron needed — `has_feature` and the client hook both check `expires_at > now()` at read time, so features vanish automatically the moment they expire (next page load / query refetch). Query invalidation on 60s interval keeps the UI honest.

## Out of scope
- Per-driver entitlements (system is per-company/coordinator).
- Feature usage analytics.
