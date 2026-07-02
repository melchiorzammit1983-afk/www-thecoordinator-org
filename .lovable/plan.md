## Scope

Building on the client portal (`/t/$token`) we already ship, add pre-assignment flow, notifications, portal extras, and coordinator visibility. Everything is gated by the existing `client_trip_portal` admin feature flag.

## Phase 1 — Unassigned link flow

- `t.$token.tsx`: show status banner "Coordinator has your booking — driver assignment pending" when `driver_id` is null. Chat tab defaults to **Coordinator** (Driver tab hidden until assigned).
- Add **"Confirm I'll be there"** button → new column `jobs.client_confirmed_at`. Card shows a green ✓ badge on the coordinator side.
- When a driver is assigned, portal auto-refreshes (polling + realtime `jobs` row) and reveals driver name, phone, live map, and unlocks Driver chat tab.

## Phase 2 — Notifications

- **Web Push**: new `client_push_subscriptions` table (job_id, endpoint, keys). Add VAPID keys via `secrets.generate_secret` (`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`). Public register endpoint at `/api/public/push/register`. Service worker at `/public/sw.js`.
- Server helper `notifyClient(jobId, title, body, url)` triggered on: driver assigned, "On the way", "Arrived", coordinator chat message.
- **In-portal banner**: last-N notifications shown at top when the tab is reopened (fallback for users who deny push).

## Phase 3 — Portal extras

- **Trip history + saved profile**: reuse `client_link_identities` — add `client_profile` table keyed by device fingerprint (name, phone, preferred language). Portal lists past trips (`getClientTripHistory`).
- **Ratings**: `client_ratings` table (job_id, stars 1–5, comment). Post-completion prompt in portal. Coordinator sees on trip card + statement export.
- **Multi-language**: detect `navigator.language`, ship EN / IT / MT / DE / FR string bundles in `src/lib/i18n-client.ts`. Coordinator/driver messages get an on-demand "Translate" button using Lovable AI (Gemini Flash).
- **Branding**: new `companies.brand_logo_url`, `companies.brand_color`. Portal header uses them when present.

## Phase 4 — Coordinator visibility

- **Online/viewed badge**: `client_link_identities.last_seen_at` heartbeat every 30s while portal open. TripCard shows a green dot + "Client online" when <2 min ago.
- **Unread client chat counter**: already aggregated; split into `driver_unread` vs `client_unread` for a dedicated blue chip.
- **Client location pin**: `DriverLiveMap.tsx` overlays `client_locations` pins (already stored) alongside driver.
- **Follow-up inbox**: new `/coordinator/pending` tab "Client rebook requests" filtering `jobs.source='client_followup'` with one-click accept/edit.

## Technical Details

- All new tables: RLS, `GRANT`s, and access via server functions in `coordinator-public.functions.ts` (public, token-scoped) or `coordinator.functions.ts` (auth).
- Realtime enabled on `jobs`, `trip_messages`, `client_locations`, `client_link_identities` for both portal and coordinator.
- Web Push uses `web-push` package (Workers-compatible fork) OR fetch-based VAPID signing to stay edge-safe — will confirm at implementation time.
- Feature flag `client_trip_portal` hides every UI entry point when disabled.

## Delivery order

Suggest shipping Phase 1 + 4 first (highest value, no new deps), then Phase 2 (needs VAPID secrets), then Phase 3 (branding + i18n polish, ratings).

Shall I proceed with Phase 1 + 4 now?