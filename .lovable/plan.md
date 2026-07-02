
## What you'll get

**Client portal (`/t/$token`) gains 5 features + a proper chat model.**

---

### 1. Push notifications (browser + PWA)
- Add a "Turn on alerts" button in the portal. Registers a Web Push subscription (VAPID) stored in a new `client_push_subs` table, keyed to the trip token + device.
- Coordinator server triggers push on: driver assigned, driver started trip, driver arriving (< 5 min ETA), SOS from another group member.
- Works even when the portal tab is closed (service worker). Also adds a minimal `manifest.webmanifest` so iOS/Android can "Add to Home Screen" and receive pushes.
- Admin toggle: new `client_push_notifications` feature flag.

### 2. Live ETA countdown
- Client portal shows "Driver arriving in **12 min**" pill next to the driver card, updated every 30s.
- Uses the existing driver GPS point + Google Distance Matrix API (already wired via `GOOGLE_MAPS_API_KEY`) to compute traffic-aware ETA to pickup coords.
- Falls back to straight-line distance if Maps fails. Coordinator card gets the same ETA badge.

### 6. Flight status card (terminal / gate / belt)
- Extend `checkFlightStatus` to also pull terminal, gate, baggage belt, and status text from AviationStack + Malta Airport board scraper.
- Store on `jobs` as `flight_terminal`, `flight_gate`, `flight_baggage_belt`.
- Portal renders a dedicated "Flight" card when a flight number is set, with big status color and the three fields. Coordinator TripDetailsSheet shows the same.

### 7. Emergency SOS
- Big red "SOS" button in portal (long-press 1.5s to prevent accidents). On trigger:
  - Captures GPS + sends to a new `client_sos_events` table.
  - Inserts an urgent `trip_messages` row (`sender_kind='client'`, tagged `is_sos=true`) into the private thread.
  - Fires push (via feature 1) to coordinator + assigned driver.
  - Coordinator dispatch board shows a pulsing red SOS banner on the affected card until acknowledged.

### 10. Offline mode
- Register a service worker that caches the portal shell + last successful `getClientTripPortal` response in IndexedDB.
- On offline load, the portal shows cached trip details with an "Offline — last updated X min ago" banner. Chat composer queues messages and flushes on reconnect.

---

### Chat model (fixing your concern)

**Current problem:** In a group, everyone sees the same chat feed — there's no private thread. If a passenger wants to message the coordinator without the whole group seeing, they can't.

**New two-thread model:**

| Thread | Scope | Who sees it |
|---|---|---|
| **Group chat** | Whole group (all sibling jobs) | All group members + coordinator + assigned driver |
| **Private chat** | Just this passenger's device identity | Only this passenger + coordinator (driver optional) |

Implementation:
- Add `thread_kind` (`group` | `private`) and `client_identity_id` columns to `trip_messages`.
- Portal chat tab gets two sub-tabs: **Group** (default when in a group) and **Private**. Solo trips only show one thread.
- Coordinator chat dialog gets the same split, plus a badge showing which passenger a private thread belongs to.
- Driver app: sees Group thread by default; can view individual passenger private threads on request.
- Unread counts on coordinator cards split into group / private / driver.

---

## Technical sketch

**New tables**
```text
client_push_subs        (token, device_id, endpoint, p256dh, auth, created_at)
client_sos_events       (id, job_id, token, device_id, pax_name, lat, lng, acknowledged_at, created_at)
```

**Migrations to existing tables**
```text
jobs           + flight_terminal, flight_gate, flight_baggage_belt
trip_messages  + thread_kind ('group'|'private'), client_identity_id (uuid), is_sos (bool)
```

**New feature flags** (admin togglable): `client_push_notifications`, `client_eta`, `client_sos`, `client_offline_mode`.

**New / updated server functions**
- `subscribeClientPush` / `unsubscribeClientPush`
- `getTripEta` (Distance Matrix wrapper, cached 20s)
- `triggerClientSOS`, `acknowledgeClientSOS`
- `listClientTripMessages` gains `thread_kind` param; `postClientTripMessage` gains `thread_kind`.
- `getUnreadCountsCoord` returns `{ driver, group, private, total }`.

**Secrets needed**
- `VAPID_PUBLIC_KEY` + `VAPID_PRIVATE_KEY` (I'll request via secure form when we switch to build).

**Files touched (main)**
- `src/routes/t.$token.tsx` (SOS button, ETA pill, flight card, offline banner, chat sub-tabs, push opt-in)
- `public/sw.js` + `public/manifest.webmanifest` (new)
- `src/lib/coordinator-public.functions.ts`, `src/lib/coordinator.functions.ts`
- `src/routes/_authenticated/coordinator.calendar.tsx` (SOS banner, ETA badge, split unread)
- `src/components/coordinator/TripChatDialog.tsx` (group/private tabs)
- `src/lib/features.ts` (4 new flags)

---

## Rollout order

1. DB migrations + feature flags.
2. Chat split (group/private) — smallest surface, unblocks the rest.
3. Flight status card (feature 6) — pure data addition.
4. ETA (feature 2).
5. SOS (feature 7).
6. Push notifications (feature 1) — needs VAPID secrets.
7. Offline mode (feature 10) — last because service worker changes cache behaviour.

Approve and I'll ship in that order.
