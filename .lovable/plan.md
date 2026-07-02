## Card status signals & finished-trip collapse

Add three visual cues to TripCard on the dispatch board plus a slim collapsed state for completed trips.

### 1. Blue side stripe — unread messages
- Left-edge vertical bar, `w-1`, animated with a soft pulse (opacity 40→100%, 1.4s ease-in-out).
- Turns on when the card has any `trip_messages` from `sender_kind = 'client'` or `'driver'` with `read_by_coordinator_at IS NULL`.
- Small badge counter (top-left, above driver name) showing total unread count, split into two tiny dots if both client + driver unread (client = sky-500, driver = indigo-500).
- Clears the pulse the moment `listTripMessagesCoord` is opened (existing mark-read logic already handles it).

### 2. Yellow corner flash — client-driven changes
- Top-right corner triangle badge (`AlertCircle` icon in amber-400) with the same pulse animation.
- Triggers when any of these are unacknowledged by the coordinator:
  - Client edited pickup/details → 2-hour rule creates a row in `client_booking_modifications` (already exists) **or** booking status flipped to `modification_pending`.
  - Client requested follow-up trip → new `client_bookings` row where `created_via = 'client_portal_followup'` linked back to this job's client.
  - Client SOS event → row in `client_sos_events` with `resolved_at IS NULL` (red-600 icon override — SOS supersedes yellow).
- Click the corner → opens TripDetailsSheet scrolled to a new "Client activity" section listing the pending changes with **Approve / Dismiss** buttons.
- Ack is tracked by a new `acknowledged_at` column on `client_booking_modifications`, `client_sos_events`, and a `coordinator_acked_at` on the follow-up bookings.

### 3. Purple dot — driver status change since last view
- Small `h-2 w-2` violet-500 dot next to the TripProgress step badge.
- Fires when `jobs.status` transitions (on_the_way → onboard → completed) and `coordinator_last_viewed_at` on the job is older than the transition timestamp.
- New column `jobs.coordinator_last_viewed_at`; stamped when the coordinator opens TripDetailsSheet for that job. Cleared/updated so the dot only shows for genuinely new transitions.

### 4. Collapsed strip for finished trips
- When `status = 'completed'` or `cancelled`, TripCard renders a compact 1-line strip inside the same column slot:
  - Layout: `[HH:mm] From → To · Driver · ✓/✗`
  - Height ~28px, muted background, no drag handle, still clickable to open TripDetailsSheet.
- Grouped stacks collapse to a single strip labelled with the group name and ✓ count.
- Auto-refresh + realtime updates keep the collapse in sync.

### 5. Badge counter (extra signal)
- Combined unread pill on the card header showing total unread messages (client + driver) using existing `paxActivity.unread_count` sum plus driver messages. Hidden at zero.

### Technical notes
- New DB migration:
  - `ALTER TABLE public.jobs ADD COLUMN coordinator_last_viewed_at timestamptz, ADD COLUMN client_change_flag boolean DEFAULT false;`
  - `ALTER TABLE public.client_booking_modifications ADD COLUMN acknowledged_at timestamptz;`
  - `ALTER TABLE public.client_sos_events ADD COLUMN acknowledged_at timestamptz;` (kept separate from `resolved_at`).
  - Index: `CREATE INDEX ON public.trip_messages (job_id) WHERE read_by_coordinator_at IS NULL;`
- New server fn `getCardSignalsCoord({ job_ids })` returning `{ unread_client, unread_driver, has_client_change, has_sos, driver_status_changed, last_status_at }` per job. Called in a single batched query from `coordinator.calendar.tsx` alongside existing `paxActivity`, refreshed by the existing auto-refresh + realtime channels.
- `markJobViewedCoord({ job_id })` fires when TripDetailsSheet opens; updates `coordinator_last_viewed_at` and acks SOS/modifications/follow-ups the coordinator explicitly resolves.
- TripCard gets a `signals` prop; visual layers rendered as absolutely-positioned overlays inside the existing card wrapper (no layout shift).
- Collapsed strip is a separate `<CompletedStrip />` sub-component chosen via a `variant` switch inside TripCard so grouping/drag logic remains unchanged (drag disabled for completed).
- Pulse animation uses an inline `@keyframes` utility in `src/styles.css` (`.signal-pulse`) — reused for blue stripe and yellow corner.

### Files touched
- `src/components/coordinator/TripCard.tsx` — overlays, collapsed variant, badge counter, purple dot.
- `src/components/coordinator/TripDetailsSheet.tsx` — "Client activity" panel, ack buttons, view stamp on open.
- `src/lib/coordinator.functions.ts` — `getCardSignalsCoord`, `markJobViewedCoord`, `ackClientChangeCoord`.
- `src/routes/_authenticated/coordinator.calendar.tsx` — batch fetch signals, pass to TripCard, hook up realtime invalidations.
- `src/styles.css` — `.signal-pulse` keyframes.
- One Supabase migration for the new columns + index.
