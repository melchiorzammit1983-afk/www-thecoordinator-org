## Driver Dashboard — 5 upgrades

### 1. Coordinator alert when a driver rejects
- Extend `getCardSignalsCoord` to detect the "⚠️ Driver rejected" trip_message and surface a new `rejected` signal.
- On `coordinator.calendar.tsx`, subscribe to new trip_messages; when a driver-rejection message arrives play a short amber tone and fire a persistent `toast.warning` with an "Open" action that scrolls to the trip.
- Add an amber corner pulse on `TripCard` (distinct from red SOS / yellow client-change / blue unread).

### 2. Replace `confirm()` prompts with a Dialog
- Convert the "Approve deletion?" and "Remove this trip from your list?" `window.confirm` calls in `m.driver.$token.tsx` to shadcn `Dialog`s matching the reject-dialog style. Keeps mobile UX consistent (some in-app browsers suppress native confirms).

### 3. Manual "Share my location now" toggle
- Update `DriverLiveShare` so the driver can force-start GPS even without an active trip status. Persist the manual override in localStorage so it survives reloads until the driver turns it off or a trip completes.
- Show a clear status pill: "Sharing live" (green pulse) vs "Not sharing" with a big toggle button.

### 4. One-tap "Running late" quick action
- Add server fn `driverReportLate({ token, job_id, minutes, note? })` that:
  - Posts to `trip_messages` as `driver` ("🕒 Running ~{n} min late — {note}") so it reaches the coordinator chat.
  - Also writes a row to `driver_status_updates` (existing table) so it appears on the coordinator's card status stripe and in the client portal live view.
- UI: a "🕒 Running late" button on each accepted trip that opens a small sheet with 5 / 10 / 15 / 30 / 45 / custom-min chips + optional note.

### 5. Mark passenger as "no-show"
- Add `no_show` value handling in `markPaxOnboard` (or a new `markPaxNoShow({ token, job_id, pax_id })` server fn) that updates `pax.status = 'no_show'` and logs a trip_message so the coordinator sees who didn't turn up.
- In `TripExecutionDialog` (driver boarding sheet): add a secondary "No-show" button next to each pending passenger. Show a red "No-show" badge for that state and exclude no-shows from the "all onboard — ready to go" green banner (i.e. onboard + no_show counts as "cleared").
- On the coordinator side, `TripDetailsSheet` already lists pax — surface the no_show badge there and expose it in the CSV statement columns.

### Technical notes
- No new tables needed; reusing `trip_messages`, `driver_status_updates`, and the existing `pax.status` field (add `'no_show'` as an accepted value in the client & validators — DB column is text, no enum migration required; will verify during build).
- Realtime: subscribe to `trip_messages` (already used elsewhere) to drive #1's toast/sound.
- All changes are additive; no existing flows change behaviour.

### Files touched
- `src/lib/coordinator-public.functions.ts` — `driverReportLate`, `markPaxNoShow` (+ signal for rejection already covered by existing message text).
- `src/lib/coordinator.functions.ts` — extend `getCardSignalsCoord` with `rejected` flag.
- `src/routes/m.driver.$token.tsx` — dialogs, late sheet, no-show button, share-location toggle wiring.
- `src/components/driver/DriverLiveShare.tsx` — manual override.
- `src/components/coordinator/TripCard.tsx` — amber "rejected" pulse.
- `src/components/coordinator/TripDetailsSheet.tsx` — no-show badge.
- `src/routes/coordinator.calendar.tsx` — rejection toast + sound.
