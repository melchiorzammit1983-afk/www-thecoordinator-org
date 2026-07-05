# Crew Change — Technical Blueprint

A dispatch/coordination platform for transport companies (Malta-based, multi-company B2B), built as a TanStack Start SSR app on Supabase (via Lovable Cloud), with AI features powered by Google Gemini.

---

## 1. Tech Stack

**Framework & runtime**
- React 19.2 + TanStack Start 1.168 (Vite 8, Nitro Worker runtime)
- TanStack Router 1.170 (file-based routing in `src/routes/`)
- TanStack Query 5.101 (canonical loader + `useSuspenseQuery` pattern)
- TypeScript 5.8 (strict)

**Styling & UI**
- Tailwind CSS v4 (`@tailwindcss/vite`, `src/styles.css`)
- shadcn/ui (full 46-component set in `src/components/ui/`) on top of Radix UI primitives
- `lucide-react` icons, `sonner` toasts, `vaul` drawers, `cmdk` command palette, `embla-carousel`, `recharts`, `react-day-picker`, `@dnd-kit`, `input-otp`, `react-resizable-panels`

**Forms**: `react-hook-form` + `zod` + `@hookform/resolvers`

**Backend (Lovable Cloud / Supabase)**
- `@supabase/supabase-js` 2.110
- Auth: email/password (coordinators + admins)
- Postgres with RLS, pgmq (email queue), pg_cron (rollover + AI auto-coordinate)
- Realtime channels for jobs, dispatch hops, driver locations, chat, SOS, entitlements

**AI**
- Direct Google Gemini REST (`GEMINI_API_KEY`), models `gemini-2.5-flash` and `gemini-2.5-flash-lite`
- `ai` + `@ai-sdk/openai-compatible` present for a Lovable AI Gateway provider (`src/lib/ai-gateway.server.ts`) — defined but not currently wired into coordinator flows
- `@mendable/firecrawl-js` for URL scraping during trip extraction

**Maps**: Google Maps browser + server keys (via Lovable connector) — Distance Matrix for ETAs, Static Maps for previews, JS API for live map
**Files**: `xlsx` (SheetJS) for statements/bulk import
**QR**: `@zxing/browser`, `@zxing/library`
**Mobile**: Capacitor (iOS/Android) + `@capacitor-community/background-geolocation` for driver live share
**Email**: `@lovable.dev/email-js` (Resend under the hood) driven by pgmq queues
**Webhooks**: `@lovable.dev/webhooks-js`
**Testing**: none configured

---

## 2. Core Features → Files

| Feature | Route file(s) | Server fn module |
|---|---|---|
| Marketing landing / sign-up | `routes/index.tsx`, `routes/request-access.tsx` | `admin.functions.ts` (`listAccessRequests` etc.) |
| Coordinator auth + shell | `routes/auth.tsx`, `routes/_authenticated/route.tsx`, `routes/_authenticated/coordinator.tsx` | `coordinator.functions.ts` (`getMyCompany`, `getMyFeatures`) |
| Dispatch board / calendar | `coordinator.calendar.tsx` + `components/coordinator/*` | `coordinator.functions.ts` (`listJobs`, `assignDriver`, `createJob`…) |
| Pending client bookings | `coordinator.pending.tsx` | `coordinator.functions.ts` (`listPendingBookings`, `approveBooking`, `rejectBooking`, `resolveModification`) |
| Drivers roster | `coordinator.drivers.tsx` | `coordinator.functions.ts` (`listDrivers`, `createDriver`) |
| Magic-link portal management | `coordinator.portal-links.tsx` | `coordinator.functions.ts` (`generateMagicLink`, `revokeMagicLink`, `extendMagicLink`) |
| B2B collaboration + multi-hop dispatch | `coordinator.collaborate.tsx`, `coordinator.incoming.tsx`, `components/coordinator/ChainTimeline.tsx`, `PriceProposalsPanel.tsx` | `collab.functions.ts` |
| Labels | `coordinator.labels.tsx`, `components/coordinator/LabelPicker.tsx`, `LabelChip.tsx` | `coordinator.functions.ts` (`listLabels`, `setJobLabels`) |
| Statements (XLSX) | `coordinator.statements.tsx` | `coordinator.functions.ts` (`buildStatement`) |
| Branding | `coordinator.branding.tsx`, `components/branding/*` | `coordinator.functions.ts` (`updateMyBranding`) |
| AI center + command bar + rules | `coordinator.ai-center.tsx`, `components/coordinator/AiAutoCoordinateButton.tsx`, `VoiceToTripButton.tsx` | `coordinator.functions.ts` (all `ai*` exports) |
| Billing / points / top-ups | `coordinator.billing.tsx`, `components/billing/*` | `billing.functions.ts` |
| Admin — companies, plans, pricing, entitlements | `_authenticated/admin.*.tsx`, `components/admin/*` | `admin.functions.ts` |
| Public booking form | `routes/c.$token.tsx` (also serves client trip portal) | `booking.functions.ts`, `coordinator-public.functions.ts` |
| Driver trip portal (magic link) | `routes/t.$token.tsx`, `routes/m.driver.$token.tsx`, `components/driver/*` | `coordinator-public.functions.ts` |
| Client trip portal + SOS + chat | `routes/c.$token.tsx`, `routes/m/client/$token.tsx`, `components/client/*`, `components/trip/*` | `coordinator-public.functions.ts` |
| Cron endpoints | `routes/api/public/cron/*.ts` | Supabase RPCs |
| Email queue worker | `routes/lovable/email/queue/process.ts` | pgmq + `@lovable.dev/email-js` |
| Mobile shell (bottom tabs, header, responsive dialog) | `components/mobile/*`, `hooks/use-scroll-direction.ts`, `hooks/use-mobile.tsx` | — |

---

## 3. File & Component Structure

### `src/routes/` (URL → purpose)

**Public**
- `/` marketing landing, `/auth` coordinator sign-in, `/admin-auth` admin sign-in, `/request-access` company sign-up form, `/sitemap.xml` SSR sitemap.

**Auth gate**
- `_authenticated/route.tsx` — layout that calls `supabase.auth.getUser()` in `beforeLoad`; redirects to `/auth` when missing.

**Coordinator** (all under `/coordinator`)
- `coordinator.tsx` layout (sidebar + mobile tab bar, feature-gated nav)
- `.index` dashboard, `.calendar` main dispatch board, `.pending` client bookings, `.drivers`, `.portal-links`, `.labels`, `.statements`, `.collaborate`, `.incoming`, `.my-driving`, `.branding`, `.ai-center`, `.billing`, `.refer`

**Admin** (`/admin`)
- `admin.tsx` layout, `.index` companies, `.requests` access queue, `.pricing` plans/packs/costs/entitlements, `.topups`, `.activity`, `.revenue`

**Token portals**
- `/t/:token` driver (desktop), `/m/driver/:token` driver (mobile), `/c/:token` client trip portal + booking form, `/m/client/:token` client bookings manager

**API / cron / platform**
- `/api/public/cron/ai-auto-coordinate` and `/api/public/cron/rollover-subscriptions` (pg_cron targets, `apikey` header check)
- `/lovable/email/queue/process` (email worker, `LOVABLE_API_KEY` bearer)

### `src/components/`

- `ui/` — 46 shadcn wrappers
- `admin/` — `CompanyBillingDialog`, `FeatureEntitlementsDialog`
- `billing/` — `FeatureGate` (upsell fallback), `IfFeature` (silent gate), `RequestTopupDialog` + `PointsBadge`
- `branding/` — `BrandLogo`, `BrandingBar` (advert banner in portals)
- `client/` — `EditBookingDialog`, `RecurringDialog`
- `coordinator/` — dispatch UI: `AiAutoCoordinateButton`, `AutoRefreshToggle`, `BulkActionBar`, `ChainTimeline` (multi-hop viz), `ChangePasswordDialog`, `DriverLiveMap`, `GroupDialog`, `JobFormDialog` (main trip CRUD), `LabelChip`, `LabelPicker`, `PaxSplitDialog`, `PriceProposalsPanel`, `TrafficBadge`, `TripDetailsSheet` (slide-in details), `TripProgress` (stepper), `VoiceToTripButton`
- `driver/` — `DriverLiveShare` (Capacitor bg geo), `DriverPricePanel`, `QrScanner`, `TripSummaryDialog`
- `mobile/` — `MobileHeader` (auto-hiding), `MobileTabBar` (5-slot bottom tabs), `ResponsiveDialog` (Dialog on desktop, Vaul Drawer on mobile)
- `trip/` — `ClientLiveMiniMap`, `TripChatDialog`

### `src/lib/`

- `admin.functions.ts` — 30+ admin server fns (companies, coordinators, access requests, entitlements, plans, packs, feature costs, price overrides, topups, activity log, revenue)
- `coordinator.functions.ts` (~3500 lines) — dispatch data layer, jobs/pax/labels/groups/statements/chat/branding, all AI functions, magic-link management
- `coordinator-public.functions.ts` (~1700 lines) — token-validated public API for driver & client portals (no Supabase auth)
- `billing.functions.ts` — `listPlans`, `listPointPacks`, `listAiFeatureCosts`, `getMyBilling`, `listMyPointsHistory`, `requestTopup`
- `booking.functions.ts` — public booking submit (`getCompanyByLink`, `submitClientBooking`)
- `collab.functions.ts` — connections, invites, dispatch hops, price proposals
- `features.ts` — `FEATURE_CATALOG`, `FEATURE_KEYS`, `AI_FEATURE_KEYS`, `FeatureKey` union
- `parse-trips.ts` — free-form paste parser
- `sheet-template.ts` — XLSX bulk import
- `time.ts` — Europe/Malta timezone helpers
- `client-portal-cache.ts` — localStorage cache for offline client portal
- `linkify.tsx`, `utils.ts`, `error-capture.ts`, `error-page.ts`, `lovable-error-reporting.ts`, `ai-gateway.server.ts`

### `src/hooks/`

- `use-coordinator.ts` — `useMyCompany()` (15s stale)
- `use-features.ts` — `useFeatures`, `useFeature`, `useMyBilling`, `useFeatureCost`, `usePointsRemaining` (realtime channel on `company_feature_entitlements`)
- `use-mobile.tsx` — `useIsMobile()` @ 768px
- `use-scroll-direction.ts` — rAF-throttled up/down

### `src/integrations/supabase/`

- `client.ts` — browser singleton (publishable key)
- `client.server.ts` — admin singleton (service role, server-only, dynamic-imported)
- `auth-middleware.ts` — `requireSupabaseAuth` (per-request user-scoped client)
- `auth-attacher.ts` — client `functionMiddleware` that attaches Bearer to every server fn call
- `types.ts` — generated `Database` types

---

## 4. Data Flow & State Management

**Canonical read shape**: TanStack Query. Loaders call `context.queryClient.ensureQueryData(queryOptions)`; components read via `useQuery`/`useSuspenseQuery`. Server fns are called via `useServerFn`.

**Auth token flow**
1. Browser signs in via `supabase.auth.signInWithPassword` → session stored in localStorage.
2. `src/start.ts` registers `attachSupabaseAuth` as a client `functionMiddleware` → attaches `Authorization: Bearer <access_token>` to every `createServerFn` RPC.
3. Server `requireSupabaseAuth` middleware validates the JWT, builds a per-request Supabase client scoped as that user, and puts `{ supabase, userId }` on `context` — all queries run under RLS as the caller.

**Realtime layer** (Supabase channels; each hook/component sets up its own):
- `dispatch-live` on `jobs`/`job_dispatch_hops`/`trip_messages` (`coordinator.calendar.tsx`)
- `driver-locations-live` on `driver_locations` + `client_sos_events`
- `collab-chain` on `jobs`/`job_dispatch_hops`/`driver_status_updates` (`coordinator.incoming.tsx`)
- `chain-{jobId}` per-job (`ChainTimeline`)
- `driver-live-{driverId}` (`TripDetailsSheet`)
- Feature entitlements channel in `useFeatures` — invalidates the `["my-features"]` query on any change so hidden features disappear from the UI within seconds.

**Feature entitlement pipeline**
`admin toggle → company_feature_entitlements upsert → realtime broadcast → useFeatures invalidates → useFeature(key) flips → IfFeature/FeatureGate re-renders → coordinator nav filters items where features[item.feature] === false; if current route is disabled, useEffect redirects to /coordinator.`

**Points/spend pipeline**
`server fn calls spendSoft/spendOrThrow → RPC spend_points(company, feature_key, ...) → looks up feature_costs (with company_feature_price_overrides fallback) → decrements companies.points_balance → inserts points_ledger row. Errors: insufficient_points, feature_capped, feature_disabled.`

**Client-side state**: mostly React Query cache + local `useState` in dialogs; no Redux/Zustand. Coordinator layout uses `useMyCompany` + `useFeatures`. Portals use `client-portal-cache.ts` for offline fallback in localStorage.

---

## 5. Current Logic (Complex Features)

### a) Multi-hop B2B dispatch (`collab.functions.ts`)
- Job carries `company_id` (origin), `executor_company_id` (current holder), `origin_company_id`, and `dispatch_chain_company_ids[]`.
- `dispatchJobToPartner` verifies caller is the current executor, inserts a `job_dispatch_hops` row `{from, to, pending}`, updates `executor_company_id`, appends to chain array.
- Receiver's `/coordinator/incoming` lists jobs where `executor_company_id = me AND company_id ≠ me`; `respondToDispatch` accepts (hop → `accepted`) or rejects (delete hop, restore prior executor).
- `recallPartnerDispatch` mirrors reject for the sender.
- Realtime `ChainTimeline` subscribes to all three tables for a job so all parties see the same timeline.
- `job_price_proposals` runs a parallel negotiation ledger between hop endpoints.

### b) AI stack (all via raw Gemini REST, metered through `spend_points`)
- `callGemini(prompt, model, opts)` is the single helper — POSTs to `generativelanguage.googleapis.com/v1beta/models/{model}:generateContent`, parses JSON out of the text part.
- Company-specific system prompt is assembled by `buildSystemPrompt(companyId, base)` which prepends every enabled `company_ai_rules` row.
- Feature gating: `assertFeatureEnabled(companyId, key)` before spend; `spendOrThrow` deducts (or blocks) via RPC. `points_ledger` records every debit.
- `extractTripsFromText` accepts text + file (base64) + URL (Firecrawl scrape) and picks flash vs flash-lite based on whether media is present.
- `aiAutoCoordinate` reads today's unassigned trips + available drivers, returns grouping/assignment proposals; `applyAutoCoordinateProposal` writes them in a single pass.
- `aiVoiceNoteToTrip` sends base64 audio to `gemini-2.5-flash` multimodal.
- `runAiCommand` is a natural-language ops assistant — Gemini returns a JSON action plan, coordinator confirms, executor writes to DB; every prompt/response/status logged to `ai_command_log`.
- pg_cron hits `/api/public/cron/ai-auto-coordinate` (apikey header) periodically, which fans out `runAutoCoordinate` for every opted-in company.

### c) Magic-link portals (`coordinator-public.functions.ts`)
- Every public server fn takes `token` as its first arg and calls an internal `resolveMagicLink(token, kind)` that checks `magic_links` for `revoked_at IS NULL AND expires_at > now()`.
- Driver portal returns a manifest of jobs where `driver_id = link.subject_id`; supports per-job hide, status updates, pax boarding, per-driver chat, price counter-proposals, background location push.
- Client portal returns trip status + driver ETA (calls Google Distance Matrix, caches in `job_route_cache`); supports chat, web push (`client_push_subs`), SOS insert (`client_sos_events`), location push (`client_locations`), and multi-identity selection (`client_link_identities`).
- The `/m/client/:token` route is different — it authenticates against `companies.custom_link` (not magic_links) and manages the client's own `client_bookings` (edit / cancel / recurring).

### d) Email queue worker (`routes/lovable/email/queue/process.ts`)
- pg_cron POSTs to the route with a service-role bearer; the handler drains `auth_emails` (TTL 15 min) and `transactional_emails` (TTL 60 min) via `pgmq.read`.
- Per message: dedupe by `idempotency_key`, retry budget of 5 based on `email_send_log` real failures, expired messages → DLQ; success/failure recorded in `email_send_log`; global rate-limit cooldown state in `email_send_state` (singleton row).
- Actual delivery via `@lovable.dev/email-js` (Resend).

### e) Client booking → job promotion (`booking.functions.ts` + `coordinator.functions.ts`)
- Client `POST /c/:token` with the public form → `submitClientBooking` inserts a `client_bookings` row (`status = pending`); a DB trigger `validate_public_client_booking` locks server-controlled fields (status forced to `pending`) and validates lengths/email format.
- Coordinator sees count on dashboard, opens `/coordinator/pending`; `approveBooking` inserts a `jobs` row from the booking, sets booking `status = accepted` with `job_id`, and calls `spendSoft("trip_created")`.
- Modifications go through `client_booking_modifications` and `resolveModification` (a `enforce_two_hour_rule` trigger auto-routes late edits into modifications instead of direct updates).

### f) Mobile shell
- `coordinator.tsx` conditionally renders `MobileHeader` + `MobileTabBar` under `md:` and hides the desktop sidebar.
- `MobileTabBar` mirrors the desktop nav in 4 pinned slots (Dashboard, Dispatch, Drivers, Billing) + a "More" drawer that filters by `useFeatures`.
- `MobileHeader` uses `useScrollDirection` to translate itself off-screen on scroll-down.
- `ResponsiveDialog` swaps `Dialog` for a Vaul `Drawer` when `useIsMobile()` is true — the plan is to migrate existing dialogs (`JobFormDialog`, `TripDetailsSheet`, etc.) onto it incrementally.

---

## 6. Database Tables (46)

Grouped by concern (all in the `public` schema, all with RLS + explicit GRANTs, most user-facing tables also feed `admin_activity_log` via the `log_activity` trigger function):

- **Identity/tenancy**: `companies`, `admin_emails`, `company_coordinator_invites`, `access_requests`
- **Roster**: `drivers`, `groups`
- **Trips**: `jobs`, `pax`, `job_labels`, `trip_labels`, `job_assignment_events`, `job_route_cache`, `flight_status_snapshots`
- **Bookings (client-facing)**: `client_bookings`, `client_booking_modifications`, `client_link_identities`
- **Portals & realtime state**: `magic_links`, `driver_locations`, `driver_status_updates`, `client_locations`, `client_push_subs`, `client_sos_events`, `trip_messages`
- **B2B dispatch**: `connection_invites`, `coordinator_connections`, `job_dispatch_hops`, `job_price_proposals`
- **Billing**: `plans`, `point_packs`, `company_subscriptions`, `feature_costs`, `ai_feature_costs`, `company_feature_price_overrides`, `company_feature_entitlements`, `points_ledger`, `topup_requests`
- **AI**: `ai_configuration`, `company_ai_rules`, `ai_command_log`
- **Email**: `email_send_log`, `email_send_state`, `email_unsubscribe_tokens`, `suppressed_emails` (+ pgmq queues `auth_emails`, `transactional_emails`)
- **Audit**: `admin_activity_log`

Notable DB functions: `spend_points`, `set_company_plan`, `admin_grant_points`, `rollover_subscriptions`, `auto_assign_job`, `enforce_*` triggers for hop/driver/executor immutability, `email_queue_wake` / `email_queue_dispatch` (arm/disarm pg_cron based on queue depth via advisory locks).

---

## 7. Notable Conventions & Gotchas

- **No `src/pages/`** — file-based routing in `src/routes/` only.
- **All secrets are `process.env.*` inside handler bodies** (not module scope). `SUPABASE_SERVICE_ROLE_KEY` is never touched from the browser; `client.server.ts` is dynamic-imported from `.functions.ts` files.
- **AI calls go through raw Gemini REST**, not the Lovable AI Gateway module that exists in the repo. Consolidating is a possible future refactor.
- **Feature flags are opt-out** (default = true) — `getMyFeatures` only reads overrides from `company_feature_entitlements`.
- **Malta timezone is hard-coded** (`src/lib/time.ts`).
- **Bulk paste + XLSX import share `ParsedTrip`** but XLSX skips the AI normalization step used by paste.
- **Client portal has an offline cache** (`client-portal-cache.ts`) — helpful when reproducing "stale data" reports.
- **No unit or e2e tests exist.**

---

## 8. External Services

| Service | Where | Key env var |
|---|---|---|
| Supabase (Lovable Cloud) | everywhere | `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY` |
| Google Gemini | AI features | `GEMINI_API_KEY` |
| Google Maps | ETA, live map, static previews | `GOOGLE_MAPS_API_KEY`, `GOOGLE_MAPS_BROWSER_KEY` (via Lovable connector) |
| Firecrawl | URL scraping in AI extraction | `FIRECRAWL_API_KEY` (via Lovable connector) |
| Resend (via `@lovable.dev/email-js`) | transactional + auth emails | managed by Lovable |
| Lovable AI Gateway | provider defined but unused | `LOVABLE_API_KEY` |

---

## Approval

This plan is the deliverable itself — a complete, share-ready technical blueprint. Approving it doesn't schedule any code changes; if you want any part expanded (RLS policy map, a per-feature deep dive, a diagram, etc.), reply with what you'd like added.
