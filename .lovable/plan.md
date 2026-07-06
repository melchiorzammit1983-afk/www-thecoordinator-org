## Problem

`trip_messages` are keyed only by `job_id` + `thread_kind`. When a job is reassigned to a new driver:
- Driver ↔ Client (`driver_client`) and Driver ↔ Coordinator (`driver_coord`) private threads become visible to the new driver.
- The coordinator's "Driver chat" panel keeps showing the old driver's replies mixed with the new one.

Group thread should stay shared (new driver needs the context).

## Fix

Attach every message to the driver it belongs to, then filter private threads by that driver.

### 1. Schema (migration)

- Add `driver_id uuid null references public.drivers(id)` to `public.trip_messages`.
- Index `(job_id, thread_kind, driver_id)`.
- Backfill: for existing `driver_client` / `driver_coord` rows, set `driver_id = jobs.driver_id` (best effort — historical driver identity isn't tracked, so current assignee is the closest approximation). Group/private client rows stay `NULL`.
- No RLS change needed (all reads/writes go through service-role server functions that already gate by job/token).

### 2. Write path — stamp `driver_id`

In `src/lib/coordinator-public.functions.ts` (driver token side), when inserting a `trip_messages` row with `thread_kind` in `driver_client` | `driver_coord`, include `driver_id: link.subject_id`. Applies to:
- `postTripMessage` (driver typing in Client / Coordinator tab)
- System `driver_coord` inserts on accept/decline/wait/adjustments/SOS/etc. — use `job.driver_id` (already fetched).

In `src/lib/coordinator.functions.ts` (coordinator side), when inserting into the `driver` thread (`thread_kind: "driver_coord"` in `postTripMessageCoord` and the system insert around line 548), include `driver_id: job.driver_id` (fetch it alongside the existing job lookup).

### 3. Read path — filter by current driver

**Driver token (`listTripMessages` in `coordinator-public.functions.ts`)**
- For `driver_client` and `driver_coord`, add `.eq("driver_id", link.subject_id)`. New driver sees an empty private thread; old driver's history stays with them (still queryable if they revisit via their token, but their token access is already gated by `driver_id` check on the job, so reassignment cuts them off entirely — this only guarantees no cross-driver leakage if the same driver record is reassigned later).
- `group` thread: unchanged.

**Coordinator (`listTripMessagesCoord`)**
- When `thread_kind === "driver"`, filter to `driver_id = jobs.driver_id` (current assignee). Fetch current `driver_id` from the job in the same query and apply in-memory (matches existing style).
- Group / private client threads unchanged.

**Client token (`listClientTripMessages`)**
- For `driver_client`, add `.eq("driver_id", jobs.driver_id)` so the client only sees the current driver's private thread, not the previous one's.

### 4. Unread counters

- Coordinator unread (`getUnreadCountsForJobs`, line ~1834) and driver unread (`coordinator-public.functions.ts` line ~155) queries that touch `driver_coord` should also constrain to `driver_id = current job.driver_id` / `driver_id = link.subject_id` so a stale unread badge from the old driver doesn't linger.

### 5. UI

No component changes required — `TripChatDialog` already passes `thread_kind`; filtering is server-side.

## Files touched

- New migration `supabase/migrations/<ts>_trip_messages_driver_id.sql`
- `src/integrations/supabase/types.ts` (regenerated column)
- `src/lib/coordinator-public.functions.ts` — insert + read filters (driver + client sides)
- `src/lib/coordinator.functions.ts` — insert + read filters (coordinator side)

No frontend, no new dependencies.

## Explicit non-goals

- Not migrating past `driver_client`/`driver_coord` rows away from the currently-assigned driver (no historical assignment log exists).
- Not changing the group thread — reassigned drivers still see full group history, as requested.
