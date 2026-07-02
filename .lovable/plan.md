## Goal
Clicking a passenger row in `TripDetailsSheet` opens the trip chat filtered to that passenger — showing only their private thread (or the group thread if they haven't chosen an identity yet), with the passenger's name in the dialog title. The existing footer "Chat" button keeps its current behavior (all messages / group view).

## Changes

### 1. `src/lib/coordinator.functions.ts`
- `listTripMessagesCoord`: add optional `identity_id: string | null` and `thread_kind: "all" | "private" | "group"` input.
  - `all` (default, current behavior): return every message across sibling group jobs.
  - `private` + identity_id: return coordinator messages targeting that identity + client messages from that identity (both threads), plus driver messages (shared).
  - `group`: return only messages where `thread_kind = 'group'` (plus coordinator/driver group messages).
  - Only mark as read the messages actually returned.
- `postTripMessageCoord`: add optional `identity_id` and `thread_kind` (`"group" | "private"`). When `private` + identity_id, insert with `thread_kind='private'` and `client_identity_id=identity_id`; otherwise keep current group insert.

### 2. `src/components/trip/TripChatDialog.tsx`
- New optional props: `identityId?: string | null`, `threadKind?: "all" | "private" | "group"`, `paxName?: string | null`.
- Pass `identity_id` / `thread_kind` to `listTripMessagesCoord` and `postTripMessageCoord`. Include them in the queryKey.
- When `paxName` is set, title becomes `Chat with {paxName}` and description reflects private thread.

### 3. `src/components/coordinator/TripDetailsSheet.tsx`
- Add local state `paxChat: { paxId, name, identityId } | null`.
- Make each `<li>` in the passenger list a button (`role="button"`, keyboard-accessible) that sets `paxChat` from that pax's `paxActivity` entry.
- Render a second `TripChatDialog` instance controlled by `paxChat`, passing `identityId`, `paxName`, `threadKind = identityId ? "private" : "group"`.
- Existing footer Chat button unchanged (opens full thread).

## Out of scope
- No schema changes (identities/thread_kind columns already exist).
- Driver-side chat unchanged.
- No realtime subscription changes (10s poll already in dialog + 20s in sheet).