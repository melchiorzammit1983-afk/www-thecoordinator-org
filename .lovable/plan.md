# Separate driver chats: driver↔client and driver↔coordinator

Today the driver app has a single trip chat where the coordinator, driver, and client all see every message. This adds two private side-channels so the driver can talk to the client without the coordinator seeing, and to the coordinator without the client seeing.

## Behavior

Driver app trip chat becomes a 3-tab thread selector:
- **Group** — everyone (existing behavior, unchanged)
- **Client** — driver ↔ client only. Coordinator does not see it.
- **Coordinator** — driver ↔ coordinator only. Client does not see it.

Coordinator's trip chat gets an extra tab: **Driver** (the driver↔coordinator private thread). The existing Group and per-passenger Private tabs stay unchanged. Coordinator never sees driver↔client messages.

Client's chat (t.$token.tsx) gets an extra tab: **Driver** (the driver↔client private thread). Client never sees driver↔coordinator messages.

Send/receive rules are enforced server-side, not just hidden in UI.

## Data model

Extend the `trip_messages.thread_kind` check constraint to allow two new values in addition to today's `group` / `private`:
- `driver_client` — driver ↔ client private
- `driver_coord` — driver ↔ coordinator private

No new columns, no new tables. `sender_kind` stays `driver | coordinator | client`. `read_by_driver_at` / `read_by_coordinator_at` are reused; client reads are already tracked per-identity elsewhere.

## Server functions

`src/lib/coordinator-public.functions.ts` (driver token endpoints):
- `listTripMessages` / `postTripMessage` accept `thread_kind: 'group' | 'driver_client' | 'driver_coord'` (default `group` to stay backward-compatible). Post writes that literal value.

`src/lib/coordinator.functions.ts` (coordinator):
- `listTripMessagesCoord` accepts a new `thread_kind` value `driver` that filters to `thread_kind = 'driver_coord'`. Existing `all` filter is updated to **exclude** `driver_client` so coordinator never sees driver↔client.
- `postTripMessageCoord` accepts `thread_kind: 'driver_coord'` and writes it (sender_kind `coordinator`).
- Coordinator unread badge query excludes `driver_client`.

`src/lib/coordinator-public.functions.ts` (client token endpoints in t.$token flow):
- `listClientTripMessages` / `postClientTripMessage` accept `thread_kind: 'group' | 'private' | 'driver_client'`. Client list queries always exclude `driver_coord`.

## UI

`src/components/trip/TripChatDialog.tsx`:
- Add a small segmented control at the top when `role === 'driver'`: Group / Client / Coordinator. Selected value is passed as `thread_kind` to list/post.
- When `role === 'coordinator'` and a new `threadKind === 'driver'` is passed, dialog talks to the driver↔coord thread; empty state text updated.

`src/routes/m.driver.$token.tsx`:
- Wire the new 3-tab selector through TripChatDialog. Default tab: Group.

`src/components/coordinator/TripDetailsSheet.tsx` (and coordinator.calendar chat entry points):
- Add a "Driver" tab alongside existing Group/passenger-private tabs. Only visible when the trip has an assigned driver.

`src/routes/t.$token.tsx`:
- Add a third pill "Driver" next to Private/Group. Uses `thread_kind: 'driver_client'`. Disabled with a hint if no driver assigned yet.

## Migration

```sql
ALTER TABLE public.trip_messages
  DROP CONSTRAINT IF EXISTS trip_messages_thread_kind_check;
ALTER TABLE public.trip_messages
  ADD CONSTRAINT trip_messages_thread_kind_check
  CHECK (thread_kind = ANY (ARRAY['group','private','driver_client','driver_coord']));
```

No RLS changes required — existing policies scope by `job_id` / company / driver token; the new values ride the same rows. Visibility per role is enforced in the server function filters above.
