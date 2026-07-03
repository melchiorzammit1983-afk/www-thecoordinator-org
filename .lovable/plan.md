## Goal

In `TripDetailsSheet`'s passenger list, show each passenger's connection/availability status and let the coordinator tap the chat icon to message that specific passenger directly — even before they've picked their name. Messages queue into a private thread that automatically attaches to the passenger's identity the moment they open the link and pick their name. In the client portal (`/t/$token`), split chat into **Coordinator** and **Driver** tabs.

## What the user sees

**Coordinator side (passenger row):**
- Small presence dot next to each name:
  - **Grey** — never opened the link
  - **Yellow** — opened before, offline now
  - **Green** — online now (heartbeat in last 60s)
- Sublabel updates: "Never opened" / "Last seen 5m ago" / "Online now".
- Chat icon always enabled. Clicking opens `TripChatDialog` in **private queued mode** for that passenger slot — even if the pax has no `identity_id` yet.

**Client side (`/t/$token` portal chat area):**
- Two tabs: **Coordinator** and **Driver**.
  - Coordinator tab = merged messages from every coordinator in the chain, private-to-me thread.
  - Driver tab = messages with the currently assigned driver.
- Any queued messages the coordinator sent before pickup show up here the first time they open the tab.

## Technical plan

### Presence signal (heartbeat, no extra infra)

- Reuse existing `client_link_identities` table. Add columns:
  - `last_seen_at timestamptz`
  - `first_seen_at timestamptz`
- New public server fn `heartbeatClientIdentity({ token, identity_id })` — `/t/$token` calls it on mount and every 45s while the tab is visible. Sets `last_seen_at = now()` (and `first_seen_at` if null).
- New coordinator server fn `listPaxPresence(job_id)` returning per-pax `{ pax_id, identity_id, first_seen_at, last_seen_at, state: "never"|"away"|"online" }`. `state = online` if `last_seen_at > now() - 60s`, `away` if seen ever, else `never`. Cached 15s + realtime invalidation on `client_link_identities` changes for that job.

### Queued private thread before name pick

- `trip_messages` already supports `identity_id` (private) vs group. Add nullable `pax_id` column so a coordinator can address a message to a pax slot before an identity exists.
- New coordinator server fn `postTripMessageForPax({ job_id, pax_id, body })`: inserts with `thread_kind = 'private'`, `pax_id = <slot>`, `identity_id = null`.
- Modify `listTripMessagesCoord`: when called with `pax_id`, return all messages where `pax_id = X` OR (`identity_id` = the identity currently bound to that pax, if any).
- Attach-on-pick: when a pax picks their name in `/t/$token` and gets an `identity_id`, run `attachIdentityToPax(pax_id, identity_id)` — updates any queued `trip_messages` rows with that `pax_id` and null `identity_id` to set `identity_id`. From then on the same private thread continues seamlessly.
- Client-side private-thread read (`listTripMessages` for `/t/$token`): return messages where `identity_id = mine` OR (`pax_id = my_pax_id` AND `identity_id IS NULL`).

### UI wiring

- **`TripDetailsSheet.tsx`** passenger list:
  - Consume `listPaxPresence(job.id)` via `useQuery` with realtime invalidation.
  - Render presence dot + sublabel per row. Update chat button: always enabled, `onClick` opens `TripChatDialog` with `threadKind="private"`, and pass the new `pax_id` prop so it uses the queued-thread endpoints.
- **`TripChatDialog.tsx`**: add optional `paxId` prop. When set and `role === "coordinator"`, call `postTripMessageForPax` and `listTripMessagesCoord({ pax_id })`. Header shows "Chat with {paxName} · queued until they open the link" if no identity yet, otherwise "Chat with {paxName} · online/away/offline".
- **`/t/$token` portal** chat area: replace single thread with a two-tab shadcn `Tabs` (**Coordinator** / **Driver**). Coordinator tab uses existing private-thread reader; Driver tab filters `sender_kind IN ('driver','coordinator-with-driver-role')` for the assigned driver of that job (or just filters by `thread_kind='driver'` — see below). Add heartbeat effect.

### Driver tab scoping (simple)

- Add `thread_kind = 'driver'` value. Driver-portal `postTripMessage` writes with `thread_kind='driver'` (visible to assigned driver + client). Coordinator writes going into the Driver tab (from client side) also use `driver`. Coordinator↔pax stays `private`. Group thread unchanged.
- Client `listTripMessages` returns:
  - Coordinator tab: `thread_kind='private' AND (identity_id=mine OR (pax_id=mine AND identity_id IS NULL))`
  - Driver tab: `thread_kind IN ('driver','all') AND (identity_id IS NULL OR identity_id=mine)`

### Realtime

- Client portal + `TripDetailsSheet` subscribe to `trip_messages` filtered by `job_id`, invalidating the relevant query keys. Presence dot subscribes to `client_link_identities` changes for the job.

### Access + safety

- All new writes go through server functions with existing token/`assertJobInCompany` checks — no new RLS surface widening. `pax_id` is validated to belong to `job_id`. Client heartbeat validated by token + identity_id match (already the pattern for `postTripMessage`).

## Out of scope

- Typing indicators, read receipts, push notifications.
- Voice/media messages.
- Per-coordinator threads inside the Coordinator tab (single merged thread).
- Changing driver-side chat UI.

## Ask after build

Once live I'll ask: (a) whether the Coordinator tab should split per-coordinator when the chain has 3+ hops, and (b) whether we should send a "coordinator sent you a message" toast the first time a client opens their portal with queued messages waiting.
