# Hotel Room QR + Portal Upgrade

Turn the existing hotel portal into a self-service room-QR experience: guests scan a QR at their door or the reception desk, land on a mini-portal keyed to their room, and can book trips at hotel-set prices, redeem promos, and browse hotel offers. The hotel gets a small dashboard to run all of it.

## What's already there (reuse, don't rebuild)

- `portal_companies` (kind=`hotel`) — logo, slug, magic token, brand colour
- `portal_bookings` → auto-forwarded into `jobs` for coordinator dispatch
- `portal_statements`, `portal_threads`, `portal_payment_*` — statements + chat already work
- `/h/{slug}` public page + `/portal.{token}` hotel dashboard
- Coordinator settings page at `coordinator.portals.$id.tsx` for editing a portal

The plan below only adds what's missing.

## 1. Room QR + guest mini-portal

New table `portal_rooms` per hotel — `{portal_company_id, room_number, label, qr_token, active}`. Hotel bulk-generates rooms in the dashboard; each row has a printable QR sheet (PDF).

QR resolves to `/h/{slug}/r/{room_qr_token}` (public route). First visit asks name + optional email; the room and hotel are already known from the token. On submit we issue a **guest session** (new table `portal_guest_sessions`: `{id, portal_company_id, room_id, guest_name, email?, phone?, session_token, expires_at}`), store the token in `localStorage`, and drop them into a mini-portal at `/g/{session_token}`.

The mini-portal shows: **Book a ride** (zones + promos), **My trips** (live status, driver ETA, chat — reuse existing `pax_tracking_tokens` per booking), **Hotel offers**, and **Help**. Reception can also open the QR themselves and start a booking for a walk-in.

Rate-limit: 5 booking submissions/room/day (reuse `portal_rate_limits` shape). Sessions expire after configurable N days (default 7, matches typical stay).

## 2. Pricing — per-hotel mode + zones

Add to `portal_companies`:
- `pricing_mode` — `coordinator` | `hotel` | `hotel_markup` (default `coordinator` = today's behaviour)
- `currency` inherited or overridden

New table `portal_zones` — `{portal_company_id, name, sort_order, active}` (e.g. "Airport", "Valletta", "South ports").
New table `portal_zone_fares` — `{zone_id, pax_tier, price, coordinator_base_price?, markup?}` where `pax_tier` is `1-3`, `4-6`, `7+` etc.

Guest booking flow: pick destination zone → sees final price. Server records the fare snapshot on the `portal_booking` (`agreed_price`, plus a new `fare_breakdown jsonb` — zone id, base, markup, promo). Coordinator sees the hotel's chosen price on the job card.

Billing:
- `coordinator` mode → statement is coordinator→guest (today's behaviour)
- `hotel` mode → statement is coordinator→hotel at coordinator's rate; hotel collects from guest
- `hotel_markup` mode → statement shows base + markup lines; hotel pays coordinator the base

Coordinator's portal-edit page gets a new "Pricing" tab to set the mode + optional per-zone base for markup mode. Hotel dashboard gets a "Prices" tab to manage zones and fares (or the markup value).

## 3. Promos & packages

New tables:
- `portal_promos` — `{portal_company_id, code, kind: 'percent'|'amount', value, min_price?, applies_to: 'transport'|'offers'|'both', starts_at?, ends_at?, max_uses?, uses_count, active}`
- `portal_addons` — bundled add-ons offered at booking `{portal_company_id, title, description, price?, category, image_url?, active}` (e.g. "Restaurant voucher €25", "Spa hour €40"). Info-only; selection is stored as a note on the booking and shown to coordinator/driver.
- `portal_offers` — standalone offer cards for the "Hotel offers" page `{portal_company_id, title, description, image_url?, price?, cta_label?, cta_url?, sort_order, active}`. No trip needed — pure upsell surface.

Guest applies a promo code at booking → server validates, decrements `uses_count`, records `promo_code` + discount in `fare_breakdown`. Add-ons show as checkboxes below the fare with a total.

## 4. Hotel dashboard upgrades

Extend `/portal.{token}` with tabs:
- **Overview** (today's + this-week's bookings, revenue, top zones)
- **Rooms & QR** — generate rooms, print QR sheet PDF, deactivate/rotate a room's QR
- **Prices** — zones + fares (or markup)
- **Promos** — CRUD, usage counts
- **Add-ons & Offers** — CRUD with image upload
- **Bookings** (existing list, filtered by status)
- **Statements** (existing)
- **Branding** — logo upload + brand colour (already have `logo_url`; add proper upload UI)

Logo/image uploads use a new public `portal-media` storage bucket (owner check via signed server fn — hotel token in header).

## 5. Coordinator side

- Portal edit page (`coordinator.portals.$id.tsx`) gets Pricing + Promos tabs mirroring the hotel view, so coordinator can seed prices when onboarding a hotel.
- New job labels auto-added on portal bookings: `hotel:{slug}`, `zone:{zone}`, plus `promo:{code}` when used.
- Statements generator honours `pricing_mode` when building the monthly invoice.

## Technical notes

- All new tables in `public` schema, follow the `CREATE TABLE → GRANT → RLS → POLICY` structure. RLS: hotel dashboard reads via magic token in header (existing pattern in `portal.functions.ts`); guest mini-portal reads via session token; coordinator reads via `resolveCompany`.
- New server routes under `src/routes/api/public/portal/$token/` for QR-token booking so no auth is required from a scanned QR.
- Storage bucket `portal-media` — public read, upload gated by hotel-token server fn (no direct client upload from guest).
- QR sheet PDF generated client-side with `jspdf` + `qrcode` (already installed for trip-timeline PDFs).
- No changes to `jobs`, `client_bookings`, coordinator dispatch flow, or the AI assistant.

## Out of scope for this batch

- Payments (guests still pay hotel/coordinator out of band; billing lives in statements)
- Multi-language guest UI (English only in v1)
- Package/loyalty logic beyond promo codes + add-ons
- Native app for hotels (dashboard stays web-only)

## Rollout order

1. Migration: rooms, guest sessions, zones, fares, promos, addons, offers, `pricing_mode` on `portal_companies`, storage bucket + policies
2. Server fns: room CRUD, QR issue/rotate, guest session start, zone/fare/promo/addon/offer CRUD, guest booking with fare snapshot
3. Hotel dashboard tabs (Rooms/QR, Prices, Promos, Add-ons & Offers, Branding upload)
4. Guest QR landing + mini-portal (`/h/{slug}/r/{qr}` and `/g/{session}`)
5. Coordinator portal-edit Pricing/Promos tabs + statement generator update
6. QR sheet PDF export