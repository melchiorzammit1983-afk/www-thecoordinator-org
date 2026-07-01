# Driver portal: full trip details, chat, and UI refresh

## Problems in current build
1. Driver card only shows from/to, date/time, company. It hides room numbers, passenger names, pax count, notes, flight numbers/status, vehicle details — so the driver's view is not "the same as what the coordinator entered".
2. Passenger list is only reachable via the "Open trip" dialog and only after Accept. Driver can't see names before approval.
3. No communication channel between driver and coordinator on a specific trip.
4. Mobile UI is functional but visually plain (flat cards, no hierarchy, buttons wrap awkwardly on 375px).

## What I'll build

### 1. Full trip details visible to driver (before & after acceptance)
Extend `getDriverManifest` to also return, per job:
- All jobs columns already fetched **plus** `from_flight`, `to_flight`, `flight_status`, `flight_status_note`, `flight_status_updated_at`, `points_charged` (for notes), assigned driver name.
- Passenger roster inline: `pax` rows (`name`, `room_number`, `status`) — so names are visible on the card without opening the dialog and without needing to accept first.
- Linked `client_bookings` details (room_number, client name/surname, contact) merged where a pax is tied to a booking.

The card will render a compact "Passengers (N)" section always visible, listing names + room numbers. Onboard/scan actions stay gated behind Accept (only boarding requires acceptance; visibility does not).

### 2. Card layout — parity with coordinator input
Add to the card:
- Vehicle badge, flight badges (From flight ✈ / To flight ✈) with live status color (green on-time, amber delayed, red cancelled) sourced from `flight_status`.
- Room numbers next to each passenger.
- Notes/points_charged summary if present.
- Total pax count.

Every field the coordinator can enter in `JobFormDialog` will have a corresponding read-only display on the driver card, so the two views match 1:1.

### 3. Trip chat (driver ↔ coordinator)
New table `public.trip_messages`:
- `id`, `job_id` (FK jobs, cascade), `company_id`, `sender_kind` (`driver`|`coordinator`), `sender_label` (driver name or coordinator email), `body`, `created_at`, `read_by_driver_at`, `read_by_coordinator_at`.
- GRANTs + RLS: coordinators (company owner or admin) can select/insert on their company's rows. No direct anon/authenticated public policy — drivers reach it only via magic-link server functions using `supabaseAdmin` after token validation.

Server functions in `coordinator-public.functions.ts`:
- `listTripMessages({ token, job_id })` — driver reads (validates token + job ownership, marks coordinator messages read).
- `postTripMessage({ token, job_id, body })` — driver posts.

Server functions in `coordinator.functions.ts`:
- `listTripMessagesCoord({ job_id })` and `postTripMessageCoord({ job_id, body })` using `requireSupabaseAuth`.

UI:
- Driver: new "Messages" button on each card opening a chat sheet; unread badge from unread coordinator messages.
- Coordinator: chat button on `TripCard` in `coordinator.calendar.tsx` opening a similar sheet; unread badge from unread driver messages. Auto-refresh every 15s (polling — no realtime wiring needed).

### 4. Driver mobile UI refresh
Only presentation in `src/routes/m.driver.$token.tsx` and a new `TripCardDriver` component:
- Sticky header with driver name, seats, availability chip, and profile/statement buttons collapsed into an icon menu on small screens.
- Card: gradient border tinted by state (default / accepted-green / warning-amber / danger-red), rounded-2xl, subtle shadow, larger 18–22px type for from/to, monospace time chip, day-of-week pill.
- Action row uses a 2-column grid on ≤400px so buttons never wrap awkwardly; primary action (Accept → Open trip → next status) is full-width and prominent; secondary actions collapse into an overflow menu (Delete, Mark paid, Statement).
- Passenger list is a clean bulleted list with room chips; "Boarded" shown with a green check.
- Empty state gets an illustration/icon and friendlier copy.
- Uses existing design tokens only — no hardcoded colors.

## Technical notes
- Migration adds `trip_messages` table + policies + grants (single migration, GRANTs before RLS as required).
- No changes to auth/routing; magic-link flow unchanged.
- Coordinator chat UI added as a Dialog opened from `TripCard`, so no new routes.
- Polling every 10–15s via `useQuery` `refetchInterval` — keeps things simple.

## Out of scope
- Push notifications, realtime websockets.
- File/image attachments in chat (text only for now).
- Coordinator ↔ client chat (only driver ↔ coordinator per user request).