## Problem

When a coordinator opens a driver's **on-the-go (OTG)** trip in the trip editor and changes the pickup time or the coordinator company, nothing updates on the trip. Both fields silently no-op (time) or don't exist at all (company).

**Root cause (confirmed in code):**

1. **Time change is silently converted to a "change request".** OTG trips are inserted with `status = 'en_route'` and `driver_accepted_at = now()` (`src/lib/driver-otg.functions.ts:158-159`). `isJobLocked` in `src/lib/coordinator.functions.ts:170-175` treats any job with `driver_accepted_at` set *or* status past `pending` as locked, so `updateJob` (line 700) routes the edit through `createChangeRequest` instead of patching the row. The coordinator sees "Trip updated" but the actual `pickup_at / date / time` stay put until the driver approves. For an OTG trip that is still `needs_review = true`, this is wrong — the driver hasn't scheduled anything; they just started rolling and it's the coordinator's job to finalize the details.

2. **Coordinator company is not editable at all.** `JobFormDialog` never renders a company picker and `updateJob`'s input schema doesn't accept `company_id`, so a trip that the driver accidentally started under coordinator A can't be moved to coordinator B even though the driver's OTG start screen already supports that choice (`listOtgCoordinators`).

## Fix

### 1. Let coordinators freely edit an OTG trip until they mark it reviewed

Treat OTG-in-review as "not really locked" for the coordinator who owns it:

- In `src/lib/coordinator.functions.ts`, extend the `LockableJob`/`existing` select to include `created_by_driver` and `needs_review`.
- In `isJobLocked` (or at the `updateJob` call site), add: if `created_by_driver === true` AND `needs_review === true`, return `false` (not locked). Same treatment for the reassign path at line 1061 so the coordinator can also change/clear the driver on an OTG trip without approval friction.
- Once the coordinator hits **Mark reviewed** (`needs_review` flips to false), normal locking resumes — future edits still go through the driver-approval change-request flow as today. This matches the previously agreed rule: OTG trips are the coordinator's to finalize; approved trips need driver consent.

### 2. Add a coordinator-company field for OTG trips

- Add `company_id: z.string().uuid().optional()` to `jobInput` (used by `updateJob`).
- In `updateJob`, when the caller sends a `company_id` different from the current one, verify it's the caller's own company or a connected partner (reuse the `coordinator_connections` check pattern from `startOnTheGoTrip`, lines 130-138) and only allow the move while `created_by_driver && needs_review`. Include `company_id` in the update patch.
- In `src/components/coordinator/JobFormDialog.tsx`, when the loaded `job` has `created_by_driver && needs_review`, render a **Coordinator company** `<Select>` above the driver picker, populated from a small new server fn `listEditableOtgCoordinators` (mirrors `listOtgCoordinators` but keyed by the current user's company + active connections). Wire the chosen id into the update payload. Hide the field on all other trips.

### 3. Small UX cleanups discovered in the same area

- Show a subtle "OTG — editable until reviewed" hint next to the existing amber "needs review" banner so the coordinator understands why time/company are directly editable here but locked elsewhere.
- After `updateJob` succeeds on an OTG trip, invalidate `["driver-manifest"]` too (not just `["jobs"]`) so the driver's device picks up the new time/company without waiting for the next poll.

## Out of scope

- No change to how change-requests work for *approved* (non-OTG or already-reviewed) trips.
- No change to OTG creation, deletion, passenger/stop editors, or map logging.
- No schema migration — `company_id`, `created_by_driver`, `needs_review` already exist on `jobs`.
