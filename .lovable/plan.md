## Problem

When you accept an Inbound dispatch on `/coordinator/calendar`, the trip is removed from the Inbound section (correct) but appears to "disappear" because the calendar is still anchored on a different day than the trip's pickup date. `listJobs` filters by the visible day/week range, so the newly-owned trip is fetched only if its date falls in view.

## Fix

1. **Return the accepted job's date** from `respondToDispatch` in `src/lib/collab.functions.ts` (add `date` and `id` to the response payload on the "accepted" branch).

2. **Jump the calendar to that date on accept** in `src/routes/_authenticated/coordinator/calendar.tsx`:
   - In `InboundBoard`, accept `onAccepted(date, jobId)` from the parent.
   - After `respondMut` succeeds with `decision: "accepted"`, call `setAnchor(new Date(date))` and invalidate `["jobs"]` so the Unassigned column reloads with the trip visible.
   - Briefly highlight the just-accepted card (add `justAcceptedId` state; `TripCard` adds a `ring-2 ring-primary` when its id matches; clear after ~3s).

3. **Safety net for week view**: keep current week logic; anchoring to the trip's date automatically snaps to the correct week.

No schema or RLS changes. No changes to the driver/partner side.

## Files touched

- `src/lib/collab.functions.ts` — extend `respondToDispatch` return shape.
- `src/routes/_authenticated/coordinator/calendar.tsx` — pass callback, move anchor, highlight card.
