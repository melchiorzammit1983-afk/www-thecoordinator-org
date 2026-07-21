## Goal

Rework the coordinator's Create Trip flow so that after typing passenger names, each one becomes an editable row (phone + note per person). Add real multi-stop support inside the same dialog, and teach the AI assistant to read and edit both.

## 1. Passengers: one-by-one editing after Save

Today (`JobFormDialog.tsx` lines 455-465), on Create the coordinator only sees a bulk textarea. Phone/note per passenger is only available after the trip is created (via `PaxEditor`, line 1580+). Result: names are saved but no per-passenger phone/note capture in the same flow.

Change:
- Keep the paste textarea as the fast entry point.
- After the coordinator clicks Save on a new trip, do **not** close the dialog. Switch the dialog into a compact "Passenger details" view listing every parsed name as its own row with inline Phone + Note fields (reuse the existing `PaxEditor` list UI). Coordinator fills what they want, then taps "Done".
- Skippable — a "Skip, I'll do it later" link closes the dialog immediately.
- Names entered inline (typed into the "Add another" row) get the same row treatment.

Files: `src/components/coordinator/JobFormDialog.tsx` (new post-save step; reuse `PaxEditor` rendering), no schema change needed — pax rows already carry `phone`/`note`.

## 2. Multi-stop in the same dialog

Today: multi-stop only exists via `group_stops` after a group is created; `JobFormDialog` shows only From / To. Coordinator has no way to add intermediate stops at create time.

Change:
- Add a **Stops** section in Step 2 (Where) with an ordered list of intermediate stops. Each row: `AddressAutocomplete` + optional passenger count + drag handle + remove. "+ Add stop" appends a row.
- Persistence:
  - On create/save with ≥1 intermediate stop, auto-create a `groups` row for the job and insert `group_stops` rows: pickup as stop 0, each intermediate in order, drop-off as final stop.
  - On edit of a job that already has a `group_id`, load its stops via existing `listGroupStops` and let the coordinator add/remove/reorder in-place.
- Add a new authenticated server function `addGroupStop` in `src/lib/groups.functions.ts` (coordinator-scoped, mirrors `otgAddStop` shape) and `removeGroupStop`; reuse existing `reorderStops`.

Files: `src/components/coordinator/JobFormDialog.tsx` (new StopsEditor sub-component), `src/lib/groups.functions.ts` (add/remove stop fns).

## 3. AI assistant: read + edit passengers and stops

Currently the assistant can parse `pax` at create/update time but has no vocabulary for "add a phone to John", "remove passenger X", "add a stop at the Marina", "reorder stops".

Change in `src/lib/coordinator-assist.functions.ts`:
- Extend the `command_actions` action set with new verbs: `add_pax`, `update_pax` (phone/note), `remove_pax`, `add_stop`, `remove_stop`, `reorder_stops`.
- Include the currently-open trip's passenger list and (if grouped) its stop list in the assistant's context block so it can reference them by name/index.
- Add a small executor in the client's command runner (same place existing `command_actions` like group/ungroup/message-driver dispatch) that calls the new pax/stop server functions.
- Prompt guidance: examples like "add +356 9911 2233 to Elmer", "add a stop at St Julian's before the airport", "swap stops 2 and 3".

## 4. Verification

- Create trip with 3 names → after Save, 3 editable rows appear; add phone to one, note to another, close → reopen trip and confirm persisted.
- Create trip with pickup + 2 intermediate stops + drop-off → group is auto-created, stops persist in `group_stops` in correct order, `GroupStopsPanel` (existing) shows them.
- Chat "add +356 79 12 34 56 to <name>" on open trip → `PaxEditor` list refreshes with the phone.
- Chat "add a stop at the Marina before the airport" → new `group_stops` row appears in the right position.

## Technical notes

- Reusing `PaxEditor` for the post-save step means no new list UI to maintain; only wrap it in a "Passenger details" panel with a Done button.
- Auto-creating a `groups` row when intermediate stops exist keeps the rest of the app (route optimization, GroupStopsPanel, driver manifest) working unchanged — they already read from `group_stops`.
- New `addGroupStop`/`removeGroupStop` follow the existing pattern in `groups.functions.ts` (`requireSupabaseAuth` + `assertGroupCompany`), including a `record_trip_audit` call so the change appears on the trip map/timeline like every other coordinator action.
- Assistant vocabulary additions are additive to the existing `command_actions` kind — no schema change to the AI response contract.
