# Client Trip Portal + Portal-Links Upgrade

Two things in one build: a per-trip client link (works even before a driver is assigned) and a big upgrade to `/coordinator/portal-links` for recurring clients.

## Part A — Per-trip client link `/t/$token`

### 1. Sharing (from any card)

- Auto-create a `magic_links` row (`kind='client_trip'`) when a job is created; token stored in `jobs.client_link_token`.
- Group-aware: if a job has `group_id`, the link resolves to the whole stack.
- New "Share with client" WhatsApp button on **TripCard**, **GroupedStackCard**, **and unassigned cards**. "Copy client link" in the actions dropdown.
- Message: pickup summary + link.

### 2. What the client sees

- Header: company, pickup date/time, from → to, flight status pill (green/red) using existing `flight_status` fields.
- **Progress timeline** reusing `TripProgress` (Assigned → En route → On board → Completed).
- **Driver panel**:
  - Before assignment: "Driver being assigned — you'll get a notification here."
  - After assignment: driver name, tap-to-call phone, live map (reuses `DriverLiveMap`).
- **Grouped view**: stacked summary of legs with per-leg status.

### 3. Name selection (multi-pax trips)

- First visit shows all passenger names; client taps theirs.
- Selection stored in `localStorage` (`clientPax:{token}`) **and** persisted server-side in `client_link_identities (token, pax_id, device_id)`.
- Single-pax trips skip the picker. "Not you?" reset link.

### 4. Chat — always two tabs

- **Coordinator** tab: enabled immediately.
- **Driver** tab: visible but disabled with "Available once a driver is assigned" until `jobs.driver_id` is set. Then it lights up and a Web Push + in-portal banner fires.
- Extends `trip_messages`: new `sender_kind='client'` enum value; `sender_label` = chosen pax name.
- Coordinator side: existing `TripChatDialog` gets a "Client" filter; unread badges on `TripCard`.
- Driver side: mobile manifest gains a "Client" tab.

### 5. Location sharing (client → team)

- **Share live location**: reuses `DriverLiveShare` logic against new `client_locations` (mode='live'). Auto-stops on trip completion or after 6h idle.
- **Send my location now**: one-shot pin (mode='pin').
- Coordinator + driver see a distinct blue marker labelled with the pax name on `DriverLiveMap`.

### 6. Web Push notifications

- "Enable notifications" button on the portal. Uses standards-based Web Push (VAPID keys generated once, stored as secrets).
- Subscription rows stored per `(token, device_id)`.
- Triggers: driver assigned, status change (en route / on board / completed), new coordinator or driver message, trip cancelled/rescheduled.
- Service worker `public/client-portal-sw.js` scoped only to `/t/*` — does not touch existing SWs.

### 7. Request another transfer / trip change

- Portal has "Book another transfer" and (on an already-shared trip) "Request a change".
- Both create a `jobs` row with `status='pending'`, `company_id`/`created_by_user_id` copied from the original, `source='client_followup'` or `'client_change'`, `parent_job_id` = original.
- Shows in **Pending Approvals** with a "Client re-booking" or "Client change" tag; coordinator confirms/edits before it goes live.
- Uses the same 2-hour rule as today's client portal.

### 8. Admin feature gate

- New `client_portal` entitlement in `company_feature_entitlements`. When off, share buttons and portal disabled per company.

## Part B — `/coordinator/portal-links` upgrade

### 1. Per-client dashboard

- Clicking a portal link opens a dashboard: upcoming + past trips, live driver tracking, live chat threads across all trips for that client.
- The client-facing side of the recurring portal also gets the same "one screen with everything" view.

### 2. Passenger directory + booking templates

- New tables: `client_passengers` (per portal, saved passenger name/phone/room) and `client_booking_templates` (from/to/time/notes/pax list).
- Recurring portal client can pick from saved passengers when booking; one-tap "Book from template".
- Coordinator can also manage the directory on the portal-links page.

### 3. Branded portal + statement download

- Per-portal fields: logo, primary colour, welcome message.
- Rendered on the client side of the recurring portal AND on per-trip `/t/$token` when the trip belongs to that portal's client.
- "Download statement" (PDF/CSV) on the client-facing portal: pick date range, get list of trips.

### 4. Link controls & permissions

- Per-link: expiry date, revoke button, and permission switches:
  - `can_chat` (default on)
  - `can_share_location` (default on)
  - `can_rebook` (default on)
- Permissions enforced server-side in the client server functions and reflected in the UI.

## Technical section

**DB migration:**

- `alter type sender_kind add value 'client'`.
- `alter table jobs add column client_link_token text unique, add column parent_job_id uuid references jobs(id), add column source text default 'coordinator'`.
- `create table client_link_identities(token text, pax_id uuid, device_id text, chosen_at timestamptz, primary key(token, device_id))` — no anon grants; all access via SECURITY DEFINER RPCs.
- `create table client_locations(id uuid pk, token text, pax_id uuid, job_id uuid, latitude, longitude, accuracy_m, mode text check (mode in ('live','pin')), captured_at timestamptz default now())` — anon insert only via RPC; select for authenticated members of the trip's company chain.
- `create table client_push_subscriptions(id uuid pk, token text, device_id text, endpoint text, p256dh text, auth text, created_at timestamptz)`.
- `alter table magic_links add column can_chat bool default true, can_share_location bool default true, can_rebook bool default true`.
- `create table client_passengers(id, magic_link_id, name, phone, room_number, notes)`.
- `create table client_booking_templates(id, magic_link_id, label, from_location, to_location, pickup_time, default_pax jsonb, notes)`.
- `alter table magic_links add column brand_logo_url text, brand_primary_color text, welcome_message text`.
- Add `client_portal` entitlement rows.
- All new public tables include GRANT + RLS blocks per project convention.

**Server fns (public, token-gated, no auth):**
- `getClientTripView({token, device_id?})`
- `chooseClientIdentity({token, pax_id, device_id})`
- `postClientMessage({token, device_id, thread:'driver'|'coordinator', body})`
- `listClientMessages({token, device_id, thread})`
- `pushClientLocation({token, device_id, lat, lng, accuracy, mode})`
- `submitClientFollowupBooking({token, device_id, kind:'new'|'change', ...fields})`
- `registerClientPushSubscription({token, device_id, endpoint, keys})`
- Recurring portal: `getPortalDashboard({token})`, `listPortalPassengers`, `savePortalPassenger`, `listPortalTemplates`, `savePortalTemplate`, `getPortalStatement({token, from, to})`.

**Server fns / server route:**
- Web push send: server route `src/routes/api/public/webhooks/push.ts` won't help here; use a `sendWebPush.server.ts` helper called from server fns on status/message changes. Uses `web-push` npm — check Worker compat before install; fallback is a small VAPID-signed `fetch` implementation (pure JS, Worker-safe).

**Coordinator UI:**
- `TripCard`, `GroupedStackCard`, unassigned column card: WhatsApp "Share with client" button + "Copy client link".
- `TripChatDialog`: 3-tab (Driver / Client / All), unread badges per thread.
- Portal-links page: dashboard drill-in, passenger directory, template editor, branding editor, permission switches, revoke/expire controls.

**Client UI:**
- New route `src/routes/t.$token.tsx` (public, mobile-first, real `head()` metadata).
- New route `src/routes/m/client/$token.dashboard.tsx` for the recurring-client dashboard view.
- Components: `ClientPaxPicker`, `ClientChatTabs`, `ClientLocationControls`, `ClientRebookForm`, `EnableNotificationsButton`, `ClientBrandHeader`, `ClientStatementDialog`.
- `DriverLiveMap` gains optional `clientPoints` prop for blue markers.

**Realtime:**
- Client portal subscribes to `jobs`, `driver_locations`, `trip_messages` filtered by job/group. On changes, refetches or updates map.

**Secrets:**
- `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (generated via `generate_secret` + one manual pair). Actually VAPID keys are a matched pair, so I'll ask you to click once to generate them via the secure form.

## What else could we add? Pick any

1. **ETA to pickup** using Google Maps Routes API from driver → pickup, refreshed each minute on the client portal.
2. **"I'm ready" button** for the client — auto-notifies the driver and can auto-advance status.
3. **Rating + comment** after completion (stored on the job, shown to coordinator).
4. **Multilingual portal** (EN / IT / MT auto-detected from browser).
5. **Auto-WhatsApp on assignment / en route** using the existing connector (in addition to Web Push).
6. **Photo of driver + vehicle** uploaded once by the driver, shown to the client for reassurance.
7. **Emergency / SOS button** on the portal that flags the coordinator.
8. **Add-passenger request** — client can ask to add a name; goes through pending approvals.
9. **QR code on the portal** the driver can scan at pickup to mark "on board" without opening chat.
10. **Trip receipt PDF** downloadable after completion.

Say which of 1–10 to include (or "just the base plan"), and I'll build.
