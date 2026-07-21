# Phase 4 — Public Booking Portal

A new *open* booking link the coordinator can share anywhere (e.g. WhatsApp, Facebook). Anyone with the link can book without an account. Submissions are **pending only** (no job, no points) until the coordinator accepts.

Additive — does not touch existing company/hotel portals or the per-trip client link.

## What the coordinator gets

- New tab **"Public booking"** on `/coordinator/portal-links` next to the existing Companies / Drivers / Clients tabs.
- Create a link: name (e.g. "Website form"), expiry (1h / 24h [default] / 7d / 30d / never), enable/disable, rotate token, delete.
- Copy branded URL `thecoordinator.org/b/{token}` (fallback `/b/{token}`).
- **Pending requests inbox** section on the same tab: each row shows requester name/phone/email, route, date/time, notes, pax count, and submitted-at.
  - **Edit & accept** → opens the existing `JobFormDialog` pre-filled → on save creates the job and charges `trip_created` via `spend_points` (same feature key as Phase 2).
  - **Reject** with optional reason.
  - Rejected/accepted rows collapse into a "Recent decisions" strip.

## What the public visitor gets

`/b/{token}` (a new public route):
- Booking form: from, to (AddressAutocomplete), date, time, pax count, primary passenger name + phone + email (optional), notes.
- Submit → creates a pending request, shows success screen with a **request reference** (short code).
- Chat panel (like existing `/t/{token}` client trip chat) scoped to *their* browser identity, so they can message the coordinator about their request(s).
- **History**: any past requests submitted from the same browser (identified by a `visitor_id` stored in localStorage and tied server-side on first submit) are shown as a list with status pills (Pending / Accepted / Rejected). Accepted rows link to the resulting per-trip `/t/{tripToken}` client page.

No login. No PII returned unless the request came from the same `visitor_id`.

## Data

New tables (RLS on; coordinator-scoped reads via `coordinator_company_id`, public writes only via server route with valid token):

- `public_booking_portals`
  - `id`, `coordinator_company_id`, `name`, `token` (unique), `enabled bool default true`, `expires_at timestamptz null` (default now()+24h at creation), `created_at`, `updated_at`
- `public_booking_requests`
  - `id`, `portal_id → public_booking_portals`, `visitor_id text` (browser-generated, ≤64 chars, hashed check), `payload jsonb` (route/date/time/pax/name/phone/email/notes), `status enum('pending','accepted','rejected','cancelled') default 'pending'`, `job_id → jobs null`, `decided_at`, `decided_reason text null`, `created_at`
- `public_booking_messages`
  - `id`, `portal_id`, `request_id null` (nullable so visitors can chat before submitting), `visitor_id`, `sender_role enum('visitor','coordinator')`, `body text`, `created_at`

Grants: `authenticated` full on all three; `service_role` all. No `anon` grants — public traffic goes exclusively through server routes using `supabaseAdmin` after token validation and rate-limit check (reuse `checkRateLimit` from `portal-token.server.ts`).

## Server surface

Auth-gated (`createServerFn` + `requireSupabaseAuth`) in a new `src/lib/public-portal.functions.ts`:
- `listPublicPortals`, `createPublicPortal`, `updatePublicPortal`, `rotatePublicPortal`, `deletePublicPortal`
- `listPublicBookingRequests({ status? })`
- `acceptPublicBookingRequest({ id, patch? })` — inserts job, calls `spend_points('trip_created', …)`, links `job_id`, sets `status='accepted'`, seeds pax + tracking token exactly like `acceptPortalBooking` does today. On `insufficient_points`, rollback job (same pattern as existing acceptPortalBooking).
- `rejectPublicBookingRequest({ id, reason? })`

Public HTTP routes in `src/routes/api/public/b/$token/`:
- `index.ts` — `GET` returns portal metadata + `bookings[]` filtered by `visitor_id` header, plus their messages.
- `submit.ts` — `POST` creates a pending request; rate-limited; validates token + expiry + enabled.
- `messages.ts` — `GET` (scoped by visitor_id) / `POST` (visitor → coordinator).

## Public UI route

`src/routes/b.$token.tsx` — self-contained public page (SSR-safe): form on top, "Your requests" list, chat drawer. Mobile-first. Generates and stores `visitor_id` in `localStorage` on first mount.

## Non-goals for this phase

- No visitor-side edit of pending requests (they can cancel via chat; coordinator edits before accepting).
- No email notifications (deferred; not requested).
- Phase 7 will wire AI actions for portal-link management + acknowledging pending items.

Reply "go" and I'll ship it.
