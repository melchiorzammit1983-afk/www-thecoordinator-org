## Add multi-select to dispatch cards

Add a checkbox to every `TripCard` so coordinators can select multiple trips and act on them in bulk.

### UI
- Add a checkbox in the top-left of each `TripCard` (next to the time). Clicking it toggles selection; card gets a highlighted ring when selected. Checkbox click does not open the details sheet.
- Selection state lives in `coordinator.calendar.tsx` as a `Set<string>` of job IDs (not persisted).
- When 1+ cards are selected, show a sticky **bulk action bar** at the bottom of the calendar with:
  - Count ("5 selected") + "Clear"
  - **Assign to driver…** (opens driver picker, calls existing assign RPC per job)
  - **Group / merge** (combines selected jobs' passengers into the first job, deletes the rest — only enabled when all selected share same date + from + to; otherwise disabled with tooltip)
  - **Add label…** (applies a trip label to all)
  - **Delete** (confirm dialog, calls existing `deleteJob` per job — respects driver-approval rule already in place)
- "Select all in column" checkbox in each column header (Unassigned / per-driver lanes).

### Files
- `src/components/coordinator/TripCard.tsx` — add `selected`, `onToggleSelect` props + checkbox.
- `src/routes/_authenticated/coordinator.calendar.tsx` — selection state, header select-all, render `BulkActionBar`, wire handlers to existing server functions.
- `src/components/coordinator/BulkActionBar.tsx` (new) — sticky bar with the actions above, driver picker, label picker, confirm dialogs.

### Notes
- No schema or server-function changes; bulk actions loop existing single-job RPCs (`assignDriver`, `deleteJob`, label apply, and a small new `mergeJobs` helper client-side that calls `splitPaxToNewJob` in reverse — or simply move pax via existing pax RPC then delete emptied jobs).
- Drag-and-drop still works; checkbox is a separate hit area.
