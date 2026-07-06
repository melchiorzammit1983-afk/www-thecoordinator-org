
# Company Portal — Full Build (revised for hotel-branded, privacy-first)

Free portal for hotels/agents/corporate. Shared magic link, no login. Every trip still routes through the coordinator. Passenger sees a **white-labeled hotel-branded** tracking page — the coordinator company is invisible to the guest. All three sides (passenger ↔ hotel ↔ coordinator) are pairwise private.

---

## 1. Privacy contract (the rule that drives everything)

Three isolated audiences per trip; nothing leaks across them:

- **Passenger** sees: hotel name + hotel logo, trip status, driver first name / vehicle / plate (only after assigned), ETA text (no live map by default), chat with hotel only.
- **Hotel** sees: booking + status + driver info, chat with passenger, chat with coordinator, statements, payment discussion thread. Never sees other hotels or coordinator internals.
- **Coordinator** sees: all bookings, all drivers, chat with hotel, chat with passenger (optional per policy). Never appears in the passenger UI branding.

No shared timeline, no cross-audience mentions, no "forwarded from" leakage. Enforced at the server-route layer (each endpoint takes exactly one token type and returns only that audience's projection) and at RLS (coordinator-only tables).

## 2. Data model (one migration)

Tables (public schema, RLS on, GRANTs in same migration):

- `portal_companies` — coordinator_company_id, name, kind (`hotel|agent|corporate`), contact_email, contact_phone, **logo_url** (Storage), **brand_color**, **display_name_for_passenger**, points_per_booking, monthly_seat_points, active (bool), **link_enabled** (bool), **link_expires_at** (nullable), magic_token, created_at, updated_at.
- `portal_bookings` — portal_company_id, job_id (nullable until accepted), status (`pending|accepted|rejected|change_requested|cancelled`), payload jsonb (pickup/drop/pax/flight/room/notes/**pax_phone_last4**), created_by_email, created_by_name, requires_approval, created_at, updated_at.
- `portal_change_requests` — portal_booking_id, job_id, kind (`edit|cancel|reschedule`), requested_changes jsonb, status, decided_by, decided_at.
- `portal_threads` — job_id, portal_company_id, **scope** (`hotel_coord` | `hotel_pax` | `coord_pax_optional`), created_at. Three separate rows per trip, one per audience pair. **Never joined in queries.**
- `portal_messages` — thread_id, sender_role (`portal|coordinator|passenger`), sender_label (display name for that audience — e.g. always "Reception" for coordinator→pax if enabled), body, created_at, read_by jsonb.
- `portal_payment_threads` + `portal_payment_messages` — separate from ops chat; scopes `hotel_pax` and `hotel_coord`; supports amount/currency fields for structured proposals.
- `pax_tracking_tokens` — job_id, token, phone_last4, booking_ref, **location_share_requested_at**, **location_share_granted_at**, **location_share_expires_at**, revoked_at.
- `portal_statements` — portal_company_id, period_start, period_end, totals jsonb, generated_at.
- `portal_link_events` — audit log of link on/off/expire actions.
- `admin_portal_settings` — singleton: default_points_per_booking, default_seat_points, allow_bulk, require_approval_within_hours (default 2), max_link_duration_hours, allow_coord_pax_chat (bool, default false).

Storage bucket: `portal-logos` (public, one file per portal_company id).

Realtime: enable on `portal_messages`, `portal_payment_messages`, `portal_bookings`, `portal_change_requests`.

RLS:
- Coordinator-only tables → policies keyed on `company_of(auth.uid()) = coordinator_company_id` + `is_admin`.
- No anon SELECT anywhere. All hotel + passenger reads go through server routes that verify the magic token / passenger token server-side and project only that audience's columns.

## 3. Access & link control

- **Hotel link**: `/portal/$token`. Server checks `link_enabled=true`, `link_expires_at IS NULL OR > now()`, `active=true`. If off/expired → friendly "This link is currently offline" page.
- **Hotel controls in dashboard Settings tab**: toggle link on/off, set expiry (1h/24h/7d/30d/custom/never), rotate token, upload logo, set brand color and passenger-facing display name.
- **Coordinator overrides**: can force-disable a portal, set max expiry (bounded by `admin_portal_settings.max_link_duration_hours`).
- **Passenger link**: `/track/$token`. View is public read-only for status + hotel branding. Chat + location share require entering **phone last-4 or booking reference** (validated against `pax_tracking_tokens`); returns short-lived signed JWT (2h) in `sessionStorage` for follow-up writes.

## 4. Passenger tracking page (`/track/$token`) — white-labeled

Renders as if from the hotel:

- Hotel logo (top), hotel `display_name_for_passenger` (default = hotel name), hotel brand color as accent.
- Status timeline: Requested → Confirmed → Driver assigned → En route → Arrived → In progress → Completed.
- After driver assigned: driver first name, vehicle make/model, plate, ETA **text only** (e.g. "arriving in ~7 min"). **No live map by default.**
- **"Share location" button** (guest → driver). Only when guest taps it, a one-way location share opens for the driver (writes to `pax_tracking_tokens.location_share_granted_at`, expires 30 min after trip complete). The passenger UI still shows text ETA, not a map, unless guest also asks to see the driver's location — that's an explicit second toggle, off by default.
- Chat labeled "Message [hotel name] Reception" — messages route ONLY to `hotel_pax` thread. Coordinator is invisible.
- No coordinator brand, no other trips, no pricing, no internal notes.

## 5. Hotel dashboard (`/portal/$token`)

Tabs:

1. **Bookings** — list (filterable), New booking form, Bulk CSV upload (client-parsed, capped 200 rows/POST, per-row server validation).
2. **Trips** — live status per trip, ETA text, driver info once assigned, "Copy passenger tracking link" button per trip.
3. **Chat** — per-trip, two panes: **Guest** thread + **Coordinator** thread. Explicitly labeled; no cross-posting.
4. **Payments** — per-trip payment discussion, two panes: **With Guest** + **With Coordinator**. Structured "propose amount" message option.
5. **Statements** — date-range picker, CSV download, printable HTML (browser print for PDF). Line items: date, guest name, from→to, status, agreed price, points charged.
6. **Settings** — logo upload, brand color, passenger display name, link on/off toggle, link expiry, rotate token, notification email.

## 6. Coordinator side (`_authenticated/`)

- `coordinator.portals.tsx` — list hotels, create, edit, set points_per_booking, override link state, view activity.
- `coordinator.portals.$id.tsx` — one hotel: bookings inbox, change-request queue, hotel chat, (optional) passenger chat if `allow_coord_pax_chat` enabled, statements, payment thread.
- Extend `TripDetailsSheet.tsx` with a **Portal** tab showing the coord↔hotel thread + coord↔pax thread (if enabled) for that job — kept as separate panes, never merged.

Admin: `admin.portal-settings.tsx` for global defaults and feature costs.

## 7. Approvals (per your earlier answers)

- New bookings: auto-created `pending`, coordinator Accepts (spends points, creates `jobs` row).
- Any edit: creates `portal_change_requests`; job untouched until approved.
- Edits within 2h of pickup: red-flag UI + require approval (mirrors existing `enforce_two_hour_rule`).
- Cancellations: always require approval; approved-within-1h-of-Accept refunds points via `admin_grant_points`.

## 8. Server surface

- `src/lib/portal.functions.ts` — coordinator-side with `requireSupabaseAuth`.
- `src/routes/api/public/portal/$token/*` — hotel actions. Every handler: Zod-validate → timing-safe token compare → `link_enabled+expiry` check → load `supabaseAdmin` inside the handler → return hotel-audience projection only.
- `src/routes/api/public/track/$token/*` — passenger status (public read), verify (POST last4/ref), post message (verified), request location share.
- Rate-limit table `portal_rate_limits(token, minute_bucket, count)` — reject at 60 writes/min.

## 9. Points / monetization

- Admin sets `default_points_per_booking` (seeded 3) + `default_seat_points` (0 = off).
- Coordinator overrides per hotel.
- Charge on Accept via existing `spend_points`. Refund on approved cancel within 1h.
- Weekly cron `charge_portal_seats_weekly` charges `monthly_seat_points/4` per active hotel.

## 10. Notifications

- Email (via `enqueue_email`): booking accepted/rejected, change decisions, magic link, statement ready, link toggled off by coordinator.
- Realtime: coordinator inbox badge, hotel dashboard live updates, passenger status changes.
- Passenger: no email (link is hotel-forwarded); realtime pushes to any open `/track` session.

---

## Non-goals

- No live driver map by default — text ETA only; map opens only if guest explicitly requests share and coordinator/driver location sharing is enabled (guarded per-trip).
- No cross-audience chat merging.
- No coordinator branding on passenger surface.
- No native app, no new payment provider.

## Technical notes

- Passenger JWT: HMAC (SUPABASE_SERVICE_ROLE_KEY), 2h TTL, `sessionStorage` only, never cookies.
- Logo upload via `portal-logos` public bucket, per-file RLS restricted so only coordinator + owning hotel token can write.
- Indexes: `portal_bookings(portal_company_id,status)`, `portal_messages(thread_id,created_at)`, `pax_tracking_tokens(token)`, `portal_companies(magic_token)`.
- All /api/public/* handlers: Zod validation, timing-safe compares, no coordinator PII in responses, structured 4xx errors.

## Deliverables

1 SQL migration, `portal-logos` bucket, `src/lib/portal.functions.ts`, `src/lib/portal-public.server.ts`, ~12 route files (portal + track + coordinator + admin), `TripDetailsSheet` Portal tab, admin settings page.
