## Goal
Make grouping a friendly, single-dialog action and render grouped trips as a stacked card that shows just the essentials.

## Group dialog (opens when you click Group with 2+ selected)
Fields, all optional except the confirm button:
- **Group name** — short label (e.g. "AM airport run"), stored on every job in the group.
- **Note for driver** — free-text, shared across the group.
- **Shared driver** — dropdown of drivers; if picked, assigns to every trip in the group in one shot.
- Order is auto: by date + time (earliest = first, latest = last). No manual reordering.

Submit → creates the group (`group_id` + `group_name` + `group_note`), fans out the driver if chosen, closes the dialog.

## Stacked card on the dispatch board
When 2+ jobs share a `group_id` they render as one collapsed stack in place of the individual cards:

```text
┌──────────────────────────────────┐
│ ⛬ AM airport run · 3 trips       │  ← group name + count
│ Driver: John Doe · 12 pax total  │  ← shared driver + total pax
├──────────────────────────────────┤
│ 07:15 · Hotel A → Airport · 4 pax│  ← one line per trip, ordered by time
│ 07:40 · Hotel B → Airport · 5 pax│
│ 08:10 · Hotel C → Airport · 3 pax│
└──────────────────────────────────┘
```

- Selection checkbox on the stack selects the whole group.
- Click the stack → expands inline into the full individual `TripCard`s (current behavior), with an "Ungroup" and "Collapse" button.
- Status color = worst status among members (red > orange > green).

## Data
Migration on `jobs`:
- `group_name text NULL`
- `group_note text NULL`
- (already have `group_id`, `grouped_count`, `grouped_at`)

`groupJobs` extended to accept `{ job_ids, name?, note?, driver_id? }` and write all three fields; if `driver_id` given, apply to every member.

## Files touched
- New migration (jobs.group_name, jobs.group_note)
- `src/lib/coordinator.functions.ts` — extend `groupJobs` params + selection columns
- `src/components/coordinator/BulkActionBar.tsx` — replace direct-click Group with a `GroupDialog`
- New `src/components/coordinator/GroupDialog.tsx`
- New `src/components/coordinator/GroupedStackCard.tsx`
- `src/routes/_authenticated/coordinator.calendar.tsx` — bucket jobs by `group_id`, render `GroupedStackCard` or `TripCard`; propagate expand state
- `src/routes/m.driver.$token.tsx` — driver manifest shows group name + note above the stacked trips

## Out of scope
- Manual drag-to-reorder inside a group (auto by time).
- Changing Merge behavior.
- Any pricing/points logic.

---

## What else I can do next (pick any, or none)
1. **Group chat** — one shared trip chat for the whole bundle instead of per-trip.
2. **Group share link** — one WhatsApp message covering all trips in the stack with a summary and single magic link.
3. **Auto-suggest groups** — highlight trips within X minutes to/from the same location as "suggested to group".
4. **Recolor by group** — assign each active group a subtle left-border color so the eye can track bundles across the board.
5. **Bulk unassign / bulk reschedule** — extend the bulk bar with time-shift and unassign-all.

Tell me which of these (if any) to fold into the same build, or approve the plan as-is.
